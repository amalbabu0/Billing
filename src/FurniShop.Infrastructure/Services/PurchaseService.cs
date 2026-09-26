using Dapper;
using FurniShop.Core;
using FurniShop.Core.Domain;
using FurniShop.Core.Security;
using FurniShop.Core.Tax;
using FurniShop.Infrastructure.Database;
using FurniShop.Infrastructure.Security;
using Npgsql;

namespace FurniShop.Infrastructure.Services;

/// <summary>
/// Purchases from suppliers. Completing a purchase adds the stock (PURCHASE_IN movements), updates
/// the variant's cost price and makes the amount payable to the supplier. Supplier payments are
/// allocated to purchases (oldest first unless a purchase is chosen).
/// </summary>
public sealed class PurchaseService(Db db, UserSession session, AuditService audit, InventoryService inventory)
{
    public async Task<long> SaveAsync(PurchaseInput input)
    {
        session.Demand(Perm.PurchaseManage);
        if (input.Lines.Count == 0) throw new ValidationException("Lines", "Add at least one item.");
        if (input.OtherCharges < 0) throw new ValidationException("OtherCharges", "Charges cannot be negative.");
        if (input.PaidNow < 0) throw new ValidationException("PaidNow", "Amount cannot be negative.");
        if (input.Date.Date > DateTime.Today) throw new ValidationException("Date", "Purchase date cannot be in the future.");

        return await db.InTransactionAsync(async (conn, tx) =>
        {
            var s = await SettingsService.LoadAsync(conn, tx);
            var supplier = await conn.QuerySingleOrDefaultAsync<Supplier>("select * from suppliers where id = @SupplierId and not is_deleted", input, tx)
                           ?? throw new ValidationException("SupplierId", "Select a supplier.");
            var interState = GstCalculator.IsInterState(s.Shop.StateCode, supplier.StateCode);

            var variants = (await conn.QueryAsync<(long Id, string Sku, string Name, bool IsStockItem)>("""
                select v.id, v.sku, p.name || case when v.variant_name <> 'Standard' then ' — ' || v.variant_name else '' end, p.is_stock_item
                from product_variants v join products p on p.id = v.product_id where v.id = any(@ids) and not v.is_deleted
                """, new { ids = input.Lines.Select(l => l.VariantId).Distinct().ToArray() }, tx)).ToDictionary(v => v.Id);

            var lines = new List<PurchaseLine>();
            var n = 0;
            foreach (var l in input.Lines)
            {
                n++;
                if (!variants.TryGetValue(l.VariantId, out var v)) throw new ValidationException("Lines", $"Line {n}: select a product.");
                if (!v.IsStockItem) throw new ValidationException("Lines", $"Line {n}: {v.Name} is not a stock item.");
                if (l.Quantity <= 0 || l.UnitCost < 0) throw new ValidationException("Lines", $"Line {n}: enter quantity and cost.");
                var r = GstCalculator.ComputeLine(new TaxLineInput(l.Quantity, l.UnitCost, false, l.GstRate, l.DiscountPercent), interState);
                lines.Add(new PurchaseLine
                {
                    LineNo = n, VariantId = l.VariantId, Description = string.IsNullOrWhiteSpace(l.Description) ? v.Name : l.Description.Trim(),
                    HsnCode = l.HsnCode, Quantity = l.Quantity, UnitCost = l.UnitCost, DiscountPercent = l.DiscountPercent, DiscountAmount = r.Discount,
                    TaxableAmount = r.Taxable, GstRate = l.GstRate, Cgst = r.Cgst, Sgst = r.Sgst, Igst = r.Igst, LineTotal = r.Total,
                });
            }
            var subtotal = lines.Sum(l => l.TaxableAmount + l.DiscountAmount);
            var discount = lines.Sum(l => l.DiscountAmount);
            var taxable = lines.Sum(l => l.TaxableAmount);
            var cgst = lines.Sum(l => l.Cgst); var sgst = lines.Sum(l => l.Sgst); var igst = lines.Sum(l => l.Igst);
            var exact = taxable + cgst + sgst + igst + Money.R2(input.OtherCharges);
            var grand = s.Invoice.RoundOff ? Money.ToRupee(exact) : exact;

            var args = new
            {
                input.Id, input.SupplierId, SupplierInvoiceNo = Core.Validation.Validators.Clean(input.SupplierInvoiceNo), Date = input.Date.Date,
                input.DueDate, IsInterState = interState, Subtotal = subtotal, DiscountTotal = discount, TaxableTotal = taxable,
                CgstTotal = cgst, SgstTotal = sgst, IgstTotal = igst, OtherCharges = Money.R2(input.OtherCharges), RoundOff = grand - exact,
                GrandTotal = grand, input.Notes, Uid = session.UserId, input.WarehouseId,
            };
            if (args.SupplierInvoiceNo is not null)
            {
                var dup = await conn.ExecuteScalarAsync<string?>("""
                    select number from purchases where supplier_id = @SupplierId and supplier_invoice_no = @SupplierInvoiceNo and id <> @Id and status <> 'CANCELLED'
                    """, args, tx);
                if (dup is not null) throw new ValidationException("SupplierInvoiceNo", $"This supplier bill is already entered as {dup}.");
            }

            long id; string number;
            if (input.Id == 0)
            {
                number = await SequenceService.NextAsync(conn, tx, DocType.Purchase, input.Date);
                id = await conn.ExecuteScalarAsync<long>("""
                    insert into purchases (number, supplier_id, supplier_invoice_no, purchase_date, due_date, status, is_inter_state, subtotal, discount_total,
                        taxable_total, cgst_total, sgst_total, igst_total, other_charges, round_off, grand_total, notes, created_by, warehouse_id)
                    values (@Number, @SupplierId, @SupplierInvoiceNo, @Date, @DueDate, 'DRAFT', @IsInterState, @Subtotal, @DiscountTotal,
                        @TaxableTotal, @CgstTotal, @SgstTotal, @IgstTotal, @OtherCharges, @RoundOff, @GrandTotal, @Notes, @Uid, @WarehouseId) returning id
                    """, new DynamicParameters(args).With("Number", number), tx);
            }
            else
            {
                var cur = await conn.QuerySingleOrDefaultAsync<(string Status, string Number)>("select status, number from purchases where id = @Id for update", input, tx);
                if (cur.Status is null) throw new NotFoundException("Purchase", input.Id);
                if (cur.Status != PurchaseStatus.Draft) throw new BusinessRuleException("Only draft purchases can be edited.");
                number = cur.Number;
                await conn.ExecuteAsync("""
                    update purchases set supplier_id=@SupplierId, supplier_invoice_no=@SupplierInvoiceNo, purchase_date=@Date, due_date=@DueDate,
                        is_inter_state=@IsInterState, subtotal=@Subtotal, discount_total=@DiscountTotal, taxable_total=@TaxableTotal, cgst_total=@CgstTotal,
                        sgst_total=@SgstTotal, igst_total=@IgstTotal, other_charges=@OtherCharges, round_off=@RoundOff, grand_total=@GrandTotal, notes=@Notes, warehouse_id=@WarehouseId
                    where id=@Id
                    """, args, tx);
                await conn.ExecuteAsync("delete from purchase_items where purchase_id = @Id", input, tx);
                id = input.Id;
            }
            foreach (var l in lines)
                await conn.ExecuteAsync("""
                    insert into purchase_items (purchase_id, line_no, variant_id, description, hsn_code, quantity, unit_cost, discount_percent, discount_amount,
                        taxable_amount, gst_rate, cgst, sgst, igst, line_total)
                    values (@id, @LineNo, @VariantId, @Description, @HsnCode, @Quantity, @UnitCost, @DiscountPercent, @DiscountAmount,
                        @TaxableAmount, @GstRate, @Cgst, @Sgst, @Igst, @LineTotal)
                    """, new { id, l.LineNo, l.VariantId, l.Description, l.HsnCode, l.Quantity, l.UnitCost, l.DiscountPercent, l.DiscountAmount, l.TaxableAmount, l.GstRate, l.Cgst, l.Sgst, l.Igst, l.LineTotal }, tx);

            await audit.LogAsync(conn, tx, input.Id == 0 ? "CREATE" : "UPDATE", "Purchases",
                $"{(input.Id == 0 ? "created" : "updated")} purchase {number} from {supplier.Name} — {Money.Format(grand)}", "purchase", id, number);

            if (input.Complete) await CompleteAsync(conn, tx, id, s.Inventory.UpdateCostOnPurchase);
            if (input.PaidNow > 0)
            {
                session.Demand(Perm.SupplierPay);
                if (!input.Complete) throw new BusinessRuleException("Complete the purchase before recording a payment.");
                await PayAsync(conn, tx, new SupplierPaymentInput
                {
                    SupplierId = input.SupplierId, Amount = input.PaidNow, Date = input.Date, MethodCode = input.PaidMethod,
                    Reference = input.PaidReference, PurchaseId = id, Notes = $"Paid with purchase {number}",
                });
            }
            return id;
        });
    }

    public async Task CompleteAsync(long id)
    {
        session.Demand(Perm.PurchaseManage);
        await db.InTransactionAsync(async (conn, tx) =>
        {
            var s = await SettingsService.LoadAsync(conn, tx);
            await CompleteAsync(conn, tx, id, s.Inventory.UpdateCostOnPurchase);
        });
    }

    private async Task CompleteAsync(NpgsqlConnection conn, NpgsqlTransaction tx, long id, bool updateCost)
    {
        var p = await conn.QuerySingleOrDefaultAsync<Purchase>("select * from purchases where id = @id for update", new { id }, tx)
                ?? throw new NotFoundException("Purchase", id);
        if (p.Status != PurchaseStatus.Draft) throw new BusinessRuleException("This purchase is already completed or cancelled.");
        var lines = await conn.QueryAsync<PurchaseLine>("select * from purchase_items where purchase_id = @id order by line_no", new { id }, tx);
        foreach (var l in lines)
        {
            // Effective cost per unit = taxable value after discount ÷ quantity (GST is input credit, not cost).
            var unitCost = Money.R2(l.TaxableAmount / l.Quantity);
            await inventory.ApplyAsync(conn, tx, l.VariantId, MovementType.PurchaseIn, l.Quantity, 0, 0, DocType.Purchase, id, p.Number, null, unitCost, p.WarehouseId);
            if (updateCost)
                await conn.ExecuteAsync("update product_variants set cost_price = @unitCost, updated_at = now() where id = @VariantId", new { unitCost, l.VariantId }, tx);
        }
        await conn.ExecuteAsync("update purchases set status = 'COMPLETED', completed_at = now(), completed_by = @uid where id = @id", new { uid = session.UserId, id }, tx);
        await audit.LogAsync(conn, tx, "COMPLETE", "Purchases", $"completed purchase {p.Number} — stock received ({lines.Count()} line(s), {Money.Format(p.GrandTotal)})",
            "purchase", id, p.Number);
    }

    public async Task CancelAsync(long id, string reason)
    {
        session.Demand(Perm.PurchaseManage);
        if (string.IsNullOrWhiteSpace(reason)) throw new ValidationException("Reason", "Enter the reason for cancelling.");
        await db.InTransactionAsync(async (conn, tx) =>
        {
            var p = await conn.QuerySingleOrDefaultAsync<Purchase>("select * from purchases where id = @id for update", new { id }, tx)
                    ?? throw new NotFoundException("Purchase", id);
            if (p.Status == PurchaseStatus.Cancelled) throw new BusinessRuleException("Already cancelled.");
            if (p.ReturnedTotal > 0) throw new BusinessRuleException("Goods from this purchase have been returned (debit note issued). It cannot be cancelled.");
            if (p.Status == PurchaseStatus.Completed)
            {
                var paid = await conn.ExecuteScalarAsync<decimal>("""
                    select coalesce(sum(a.amount),0) from supplier_payment_allocations a join supplier_payments sp on sp.id = a.supplier_payment_id and not sp.is_voided
                    where a.purchase_id = @id
                    """, new { id }, tx);
                if (paid > 0) throw new BusinessRuleException("Payments have been made against this purchase. Void them first.");
                var lines = await conn.QueryAsync<PurchaseLine>("select * from purchase_items where purchase_id = @id", new { id }, tx);
                foreach (var l in lines)
                    await inventory.ApplyAsync(conn, tx, l.VariantId, MovementType.PurchaseCancelOut, -l.Quantity, 0, 0, DocType.Purchase, id, p.Number, $"Purchase cancelled: {reason}", null, p.WarehouseId);
            }
            await conn.ExecuteAsync("update purchases set status = 'CANCELLED', cancelled_at = now(), cancel_reason = @reason where id = @id", new { reason, id }, tx);
            await audit.LogAsync(conn, tx, "CANCEL", "Purchases", $"cancelled purchase {p.Number} — {reason}", "purchase", id, p.Number);
        });
    }

    // ------------------------------------------------------------------ supplier payments
    public async Task<string> PayAsync(SupplierPaymentInput input)
    {
        session.Demand(Perm.SupplierPay);
        return await db.InTransactionAsync(async (conn, tx) => await PayAsync(conn, tx, input));
    }

    private async Task<string> PayAsync(NpgsqlConnection conn, NpgsqlTransaction tx, SupplierPaymentInput input)
    {
        if (input.Amount <= 0) throw new ValidationException("Amount", "Enter the amount paid.");
        if (!PaymentMethodCode.Money.Contains(input.MethodCode)) throw new ValidationException("MethodCode", "Select how the supplier was paid.");
        if (input.MethodCode == PaymentMethodCode.Cheque && string.IsNullOrWhiteSpace(input.Reference)) throw new ValidationException("Reference", "Enter the cheque number.");
        var number = await SequenceService.NextAsync(conn, tx, DocType.SupplierPayment, input.Date);
        var id = await conn.ExecuteScalarAsync<long>("""
            insert into supplier_payments (number, supplier_id, payment_date, amount, method_code, reference, notes, created_by)
            values (@number, @SupplierId, @Date, @Amount, @MethodCode, @Reference, @Notes, @uid) returning id
            """, new { number, input.SupplierId, Date = input.Date.Date, input.Amount, input.MethodCode, input.Reference, input.Notes, uid = session.UserId }, tx);

        var open = (await conn.QueryAsync<(long Id, decimal Balance)>("""
            select p.id, p.grand_total - p.returned_total - coalesce((select sum(a.amount) from supplier_payment_allocations a join supplier_payments sp on sp.id = a.supplier_payment_id and not sp.is_voided
                                                   where a.purchase_id = p.id), 0) as balance
            from purchases p where p.supplier_id = @SupplierId and p.status = 'COMPLETED' and (@PurchaseId::bigint is null or p.id = @PurchaseId)
            order by coalesce(p.due_date, p.purchase_date), p.id for update of p
            """, input, tx)).Where(p => p.Balance > 0);
        var remaining = input.Amount;
        foreach (var (pid, balance) in open)
        {
            if (remaining <= 0) break;
            var take = Math.Min(balance, remaining);
            await conn.ExecuteAsync("insert into supplier_payment_allocations (supplier_payment_id, purchase_id, amount) values (@id, @pid, @take)", new { id, pid, take }, tx);
            remaining -= take;
        }
        if (remaining > 0)
            await conn.ExecuteAsync("insert into supplier_payment_allocations (supplier_payment_id, purchase_id, amount) values (@id, null, @remaining)", new { id, remaining }, tx);

        var supplier = await conn.ExecuteScalarAsync<string>("select name from suppliers where id = @SupplierId", input, tx);
        await audit.LogAsync(conn, tx, "PAY", "Purchases", $"paid {Money.Format(input.Amount)} to supplier {supplier} ({number}, {input.MethodCode})",
            "supplier_payment", id, number, null, input);
        return number;
    }

    public async Task VoidPaymentAsync(long id, string reason)
    {
        session.Demand(Perm.PaymentVoid);
        if (string.IsNullOrWhiteSpace(reason)) throw new ValidationException("Reason", "Enter the reason.");
        await db.InTransactionAsync(async (conn, tx) =>
        {
            var p = await conn.QuerySingleOrDefaultAsync<SupplierPayment>("select * from supplier_payments where id = @id for update", new { id }, tx)
                    ?? throw new NotFoundException("Supplier payment", id);
            if (p.IsVoided) throw new BusinessRuleException("Already voided.");
            await conn.ExecuteAsync("update supplier_payments set is_voided = true, voided_by = @uid, voided_at = now(), void_reason = @reason where id = @id",
                new { uid = session.UserId, reason, id }, tx);
            await audit.LogAsync(conn, tx, "VOID", "Purchases", $"voided supplier payment {p.Number} ({Money.Format(p.Amount)}) — {reason}", "supplier_payment", id, p.Number);
        });
    }

    // ------------------------------------------------------------------ queries
    private const string Select = """
        select p.*, s.name as supplier_name, u.full_name as created_by_name, (select name from warehouses w where w.id = p.warehouse_id) as warehouse_name,
               coalesce((select sum(a.amount) from supplier_payment_allocations a join supplier_payments sp on sp.id = a.supplier_payment_id and not sp.is_voided
                         where a.purchase_id = p.id), 0) as paid
        from purchases p join suppliers s on s.id = p.supplier_id left join users u on u.id = p.created_by
        """;

    public async Task<PagedResult<Purchase>> ListAsync(ListQuery q, bool outstandingOnly = false)
    {
        session.Demand(Perm.PurchaseView);
        var where = $"""
            where (@From::date is null or p.purchase_date >= @From::date) and (@To::date is null or p.purchase_date <= @To::date)
              and (@Status::text is null or p.status = @Status) and (@SupplierId::bigint is null or p.supplier_id = @SupplierId)
              and (@Search::text is null or p.number ilike '%' || @Search || '%' or s.name ilike '%' || @Search || '%' or p.supplier_invoice_no ilike '%' || @Search || '%')
            """;
        var args = new { q.From, q.To, q.Status, q.SupplierId, Search = Blank(q.Search), q.PageSize, q.Offset };
        await using var conn = await db.OpenAsync();
        var sql = $"select * from ({Select} {where}) x {(outstandingOnly ? "where status = 'COMPLETED' and grand_total - returned_total > paid" : "")}";
        var total = await conn.ExecuteScalarAsync<int>($"select count(*) from ({sql}) c", args);
        var rows = await conn.QueryAsync<Purchase>($"{sql} order by purchase_date desc, id desc limit @PageSize offset @Offset", args);
        return new PagedResult<Purchase> { Items = rows.AsList(), TotalCount = total, Page = q.Page, PageSize = q.PageSize };
    }

    public async Task<Purchase> GetAsync(long id)
    {
        session.Demand(Perm.PurchaseView);
        await using var conn = await db.OpenAsync();
        var p = await conn.QuerySingleOrDefaultAsync<Purchase>($"{Select} where p.id = @id", new { id }) ?? throw new NotFoundException("Purchase", id);
        p.Lines = (await conn.QueryAsync<PurchaseLine>("""
            select pi.*, v.sku from purchase_items pi join product_variants v on v.id = pi.variant_id where purchase_id = @id order by line_no
            """, new { id })).AsList();
        return p;
    }

    public async Task<PagedResult<SupplierPayment>> ListPaymentsAsync(ListQuery q)
    {
        session.DemandAny(Perm.SupplierPay, Perm.PurchaseView);
        var where = """
            where (@SupplierId::bigint is null or sp.supplier_id = @SupplierId)
              and (@From::date is null or sp.payment_date >= @From::date) and (@To::date is null or sp.payment_date <= @To::date)
              and (@Search::text is null or sp.number ilike '%' || @Search || '%' or s.name ilike '%' || @Search || '%' or sp.reference ilike '%' || @Search || '%')
            """;
        var args = new { q.SupplierId, q.From, q.To, Search = Blank(q.Search), q.PageSize, q.Offset };
        await using var conn = await db.OpenAsync();
        var total = await conn.ExecuteScalarAsync<int>($"select count(*) from supplier_payments sp join suppliers s on s.id = sp.supplier_id {where}", args);
        var rows = await conn.QueryAsync<SupplierPayment>($"""
            select sp.*, s.name as supplier_name, u.full_name as created_by_name,
                   (select string_agg(coalesce(p.number, 'On account'), ', ') from supplier_payment_allocations a left join purchases p on p.id = a.purchase_id
                    where a.supplier_payment_id = sp.id) as applied_to
            from supplier_payments sp join suppliers s on s.id = sp.supplier_id left join users u on u.id = sp.created_by
            {where} order by sp.payment_date desc, sp.id desc limit @PageSize offset @Offset
            """, args);
        return new PagedResult<SupplierPayment> { Items = rows.AsList(), TotalCount = total, Page = q.Page, PageSize = q.PageSize };
    }

    private static string? Blank(string? s) => string.IsNullOrWhiteSpace(s) ? null : s.Trim();
}

/// <summary>Business expenses (rent, salary, electricity...). Soft-deleted with audit.</summary>
public sealed class ExpenseService(Db db, UserSession session, AuditService audit)
{
    public Task<IReadOnlyList<ExpenseCategory>> CategoriesAsync() => db.QueryAsync<ExpenseCategory>("select * from expense_categories order by name");

    public async Task SaveCategoryAsync(ExpenseCategory c)
    {
        session.Demand(Perm.SettingsManage);
        if (string.IsNullOrWhiteSpace(c.Name)) throw new ValidationException("Name", "Enter a name.");
        await db.InTransactionAsync(async (conn, tx) =>
        {
            if (c.Id == 0) await conn.ExecuteAsync("insert into expense_categories (name, is_active) values (@Name, @IsActive)", new { Name = c.Name.Trim(), c.IsActive }, tx);
            else await conn.ExecuteAsync("update expense_categories set name = @Name, is_active = @IsActive where id = @Id", new { Name = c.Name.Trim(), c.IsActive, c.Id }, tx);
            await audit.LogAsync(conn, tx, "SAVE", "Expenses", $"saved expense category {c.Name}");
        });
    }

    public async Task<long> SaveAsync(Expense e)
    {
        session.Demand(Perm.ExpenseManage);
        new Core.Validation.ValidationBuilder()
            .Check(e.CategoryId > 0, nameof(e.CategoryId), "Select a category.")
            .Check(e.Amount > 0, nameof(e.Amount), "Enter the amount.")
            .Check(e.ExpenseDate.Date <= DateTime.Today, nameof(e.ExpenseDate), "Date cannot be in the future.")
            .Check(PaymentMethodCode.Money.Contains(e.MethodCode), nameof(e.MethodCode), "Select the payment method.")
            .ThrowIfInvalid();
        return await db.InTransactionAsync(async (conn, tx) =>
        {
            if (e.Id == 0)
            {
                e.Number = await SequenceService.NextAsync(conn, tx, DocType.Expense, e.ExpenseDate);
                e.Id = await conn.ExecuteScalarAsync<long>("""
                    insert into expenses (number, category_id, expense_date, amount, method_code, description, reference, delivery_id, installation_id, created_by)
                    values (@Number, @CategoryId, @ExpenseDate, @Amount, @MethodCode, @Description, @Reference, @DeliveryId, @InstallationId, @uid) returning id
                    """, new { e.Number, e.CategoryId, ExpenseDate = e.ExpenseDate.Date, e.Amount, e.MethodCode, e.Description, e.Reference, e.DeliveryId, e.InstallationId, uid = session.UserId }, tx);
                await audit.LogAsync(conn, tx, "CREATE", "Expenses", $"recorded expense {e.Number} of {Money.Format(e.Amount)}", "expense", e.Id, e.Number, null, e);
            }
            else
            {
                var old = await conn.QuerySingleOrDefaultAsync<Expense>("select * from expenses where id = @Id and not is_deleted for update", e, tx)
                          ?? throw new NotFoundException("Expense", e.Id);
                await conn.ExecuteAsync("""
                    update expenses set category_id=@CategoryId, expense_date=@ExpenseDate, amount=@Amount, method_code=@MethodCode,
                        description=@Description, reference=@Reference where id=@Id
                    """, e, tx);
                await audit.LogAsync(conn, tx, "UPDATE", "Expenses", $"changed expense {old.Number}", "expense", e.Id, old.Number,
                    new { old.Amount, old.CategoryId, old.ExpenseDate }, new { e.Amount, e.CategoryId, e.ExpenseDate });
            }
            return e.Id;
        });
    }

    public async Task DeleteAsync(long id)
    {
        session.Demand(Perm.ExpenseManage);
        await db.InTransactionAsync(async (conn, tx) =>
        {
            var e = await conn.QuerySingleOrDefaultAsync<Expense>("update expenses set is_deleted = true, deleted_at = now(), deleted_by = @uid where id = @id and not is_deleted returning *",
                new { id, uid = session.UserId }, tx) ?? throw new NotFoundException("Expense", id);
            await audit.LogAsync(conn, tx, "DELETE", "Expenses", $"deleted expense {e.Number} ({Money.Format(e.Amount)})", "expense", id, e.Number, e, null);
        });
    }

    public async Task<PagedResult<Expense>> ListAsync(ListQuery q)
    {
        session.Demand(Perm.ExpenseView);
        var where = """
            where not e.is_deleted and (@From::date is null or e.expense_date >= @From::date) and (@To::date is null or e.expense_date <= @To::date)
              and (@CategoryId::bigint is null or e.category_id = @CategoryId)
              and (@Search::text is null or e.number ilike '%' || @Search || '%' or e.description ilike '%' || @Search || '%' or c.name ilike '%' || @Search || '%')
            """;
        var args = new { q.From, q.To, q.CategoryId, Search = Blank(q.Search), q.PageSize, q.Offset };
        await using var conn = await db.OpenAsync();
        const string from = "from expenses e join expense_categories c on c.id = e.category_id left join users u on u.id = e.created_by";
        var total = await conn.ExecuteScalarAsync<int>($"select count(*) {from} {where}", args);
        var rows = await conn.QueryAsync<Expense>($"select e.*, c.name as category_name, u.full_name as created_by_name {from} {where} order by e.expense_date desc, e.id desc limit @PageSize offset @Offset", args);
        return new PagedResult<Expense> { Items = rows.AsList(), TotalCount = total, Page = q.Page, PageSize = q.PageSize };
    }

    private static string? Blank(string? s) => string.IsNullOrWhiteSpace(s) ? null : s.Trim();
}
