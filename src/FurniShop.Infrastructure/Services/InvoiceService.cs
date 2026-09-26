using Dapper;
using FurniShop.Core;
using FurniShop.Core.Domain;
using FurniShop.Core.Security;
using FurniShop.Infrastructure.Database;
using FurniShop.Infrastructure.Security;
using Npgsql;

namespace FurniShop.Infrastructure.Services;

/// <summary>
/// GST invoices. A draft has no number and does not touch stock. Finalising assigns the next
/// gap-free number, removes stock (consuming the order's reservation first), snapshots cost for
/// profit reports, records the payment and, when needed, creates the delivery — all in one transaction.
/// </summary>
public sealed class InvoiceService(Db db, UserSession session, AuditService audit, SettingsService settings,
    InventoryService inventory, PaymentService payments)
{
    // ------------------------------------------------------------------ drafts
    public async Task<long> SaveDraftAsync(SalesDocumentInput input)
    {
        session.Demand(Perm.InvoiceCreate);
        return await db.InTransactionAsync(async (conn, tx) => await SaveDraftAsync(conn, tx, input));
    }

    internal async Task<long> SaveDraftAsync(NpgsqlConnection conn, NpgsqlTransaction tx, SalesDocumentInput input, bool enforceDiscount = true)
    {
        var s = await SettingsService.LoadAsync(conn, tx);
        var built = await SalesDocumentBuilder.BuildAsync(conn, tx, session, s, input, enforceDiscount);
        var c = built.Customer;
        var deliveryAddress = Core.Validation.Validators.Clean(input.DeliveryAddress)
            ?? await conn.ExecuteScalarAsync<string?>("select address || coalesce(', ' || city,'') || coalesce(' - ' || pincode,'') from customer_addresses where customer_id = @Id order by is_default desc, id limit 1", c, tx)
            ?? c.BillingAddress;
        var header = new DynamicParameters(SalesDocumentBuilder.TotalsArgs(built));
        header.AddDynamicParams(new
        {
            input.Id, Date = input.Date.Date, input.DueDate, CustomerId = c.Id, CustomerName = c.Name, CustomerMobile = c.Mobile,
            CustomerGstin = c.Gstin, BillingAddress = FullAddress(c), DeliveryAddress = deliveryAddress,
            input.SalesOrderId, input.QuotationId, input.CustomOrderId, input.Notes, Terms = input.Terms ?? s.Invoice.Terms,
            input.RequiresDelivery, input.RequiresInstallation, Uid = session.UserId,
        });

        long id;
        if (input.Id == 0)
        {
            id = await conn.ExecuteScalarAsync<long>("""
                insert into invoices (status, invoice_date, due_date, customer_id, customer_name, customer_mobile, customer_gstin, billing_address,
                    delivery_address, place_of_supply, is_inter_state, sales_order_id, quotation_id, custom_order_id, subtotal, discount_total,
                    taxable_total, cgst_total, sgst_total, igst_total, delivery_charge, installation_charge, charges_tax, round_off, grand_total,
                    notes, terms, requires_delivery, requires_installation, created_by)
                values ('DRAFT', @Date, @DueDate, @CustomerId, @CustomerName, @CustomerMobile, @CustomerGstin, @BillingAddress,
                    @DeliveryAddress, @PlaceOfSupply, @IsInterState, @SalesOrderId, @QuotationId, @CustomOrderId, @Subtotal, @DiscountTotal,
                    @TaxableTotal, @CgstTotal, @SgstTotal, @IgstTotal, @DeliveryCharge, @InstallationCharge, @ChargesTax, @RoundOff, @GrandTotal,
                    @Notes, @Terms, @RequiresDelivery, @RequiresInstallation, @Uid)
                returning id
                """, header, tx);
        }
        else
        {
            var status = await conn.ExecuteScalarAsync<string?>("select status from invoices where id = @Id for update", input, tx)
                         ?? throw new NotFoundException("Invoice", input.Id);
            if (status != InvoiceStatus.Draft) throw new BusinessRuleException("Only draft invoices can be edited.");
            await conn.ExecuteAsync($"""
                update invoices set invoice_date=@Date, due_date=@DueDate, customer_id=@CustomerId, customer_name=@CustomerName,
                    customer_mobile=@CustomerMobile, customer_gstin=@CustomerGstin, billing_address=@BillingAddress, delivery_address=@DeliveryAddress,
                    {SalesDocumentBuilder.TotalsSet}, notes=@Notes, terms=@Terms, requires_delivery=@RequiresDelivery,
                    requires_installation=@RequiresInstallation, updated_at=now()
                where id=@Id
                """, header, tx);
            await conn.ExecuteAsync("delete from invoice_items where invoice_id = @Id", input, tx);
            id = input.Id;
        }
        await SalesDocumentBuilder.InsertLinesAsync(conn, tx, "invoice_items", "invoice_id", id, built.Lines, "source_sales_order_item_id");
        return id;
    }

    public static string? FullAddress(Customer c) =>
        string.Join(", ", new[] { c.BillingAddress, c.City, c.State, c.Pincode }.Where(x => !string.IsNullOrWhiteSpace(x))) is { Length: > 0 } s ? s : null;

    public async Task DeleteDraftAsync(long id)
    {
        session.Demand(Perm.InvoiceCreate);
        await db.InTransactionAsync(async (conn, tx) =>
        {
            var n = await conn.ExecuteAsync("delete from invoices where id = @id and status = 'DRAFT'", new { id }, tx);
            if (n == 0) throw new BusinessRuleException("Only draft invoices can be deleted. Finalised invoices must be cancelled.");
            await audit.LogAsync(conn, tx, "DELETE", "Sales", $"discarded draft invoice #{id}", "invoice", id);
        });
    }

    // ------------------------------------------------------------------ finalise / checkout
    /// <summary>POS checkout: save the invoice, finalise it and record the payment in one transaction.</summary>
    public async Task<CheckoutResult> CheckoutAsync(SalesDocumentInput input, IReadOnlyList<PaymentLineInput> paymentLines, decimal useAdvance = 0, string? creditOverride = null)
    {
        session.Demand(Perm.InvoiceCreate);
        return await db.InTransactionAsync(async (conn, tx) =>
        {
            var id = await SaveDraftAsync(conn, tx, input);
            return await FinalizeAsync(conn, tx, id, paymentLines, useAdvance, creditOverride: creditOverride);
        });
    }

    public async Task<CheckoutResult> FinalizeAsync(long invoiceId, IReadOnlyList<PaymentLineInput> paymentLines, decimal useAdvance = 0, string? creditOverride = null)
    {
        session.Demand(Perm.InvoiceCreate);
        return await db.InTransactionAsync(async (conn, tx) => await FinalizeAsync(conn, tx, invoiceId, paymentLines, useAdvance, creditOverride: creditOverride));
    }

    /// <param name="creditOverride">Reason given by a user with <see cref="Perm.CreditOverride"/> to bill past the customer's credit limit.</param>
    internal async Task<CheckoutResult> FinalizeAsync(NpgsqlConnection conn, NpgsqlTransaction tx, long invoiceId,
        IReadOnlyList<PaymentLineInput> paymentLines, decimal useAdvance, long? creditFromInvoiceId = null, string? creditOverride = null)
    {
        var s = await SettingsService.LoadAsync(conn, tx);
        var inv = await conn.QuerySingleOrDefaultAsync<Invoice>("select *, invoice_date as date from invoices where id = @invoiceId for update", new { invoiceId }, tx)
                  ?? throw new NotFoundException("Invoice", invoiceId);
        if (inv.Status != InvoiceStatus.Draft) throw new BusinessRuleException("This invoice is already finalised.");
        var customer = await conn.QuerySingleAsync<Customer>("select * from customers where id = @CustomerId", inv, tx);
        var lines = await SalesDocumentBuilder.LoadLinesAsync(conn, tx, "invoice_items", "invoice_id", invoiceId, true, "source_sales_order_item_id as source_item_id");
        if (lines.Count == 0) throw new BusinessRuleException("The invoice has no items.");

        // 1. Number (locked sequence → unique and gap-free)
        var number = await SequenceService.NextAsync(conn, tx, DocType.Invoice, inv.Date);

        // 2. Stock out. Items from a sales order consume that order's reservation first.
        foreach (var l in lines.Where(l => l.VariantId.HasValue))
        {
            if (!await InventoryService.IsStockItemAsync(conn, tx, l.VariantId!.Value)) continue;
            var fromReserved = 0m;
            if (l.SourceItemId.HasValue)
            {
                var reserved = await conn.ExecuteScalarAsync<decimal>(
                    "select reserved_qty from sales_order_items where id = @SourceItemId for update", l, tx);
                fromReserved = Math.Min(reserved, l.Quantity);
                if (fromReserved > 0)
                {
                    await inventory.ApplyAsync(conn, tx, l.VariantId.Value, MovementType.ReservedSaleOut, -fromReserved, -fromReserved, 0,
                        DocType.Invoice, invoiceId, number, "Reserved stock sold", l.UnitCost);
                    await conn.ExecuteAsync("update sales_order_items set reserved_qty = reserved_qty - @fromReserved where id = @SourceItemId",
                        new { fromReserved, l.SourceItemId }, tx);
                }
            }
            var free = l.Quantity - fromReserved;
            if (free > 0)
                await inventory.ApplyAsync(conn, tx, l.VariantId.Value, MovementType.SaleOut, -free, 0, 0, DocType.Invoice, invoiceId, number, null, l.UnitCost);
        }

        var costTotal = lines.Sum(l => Money.R2((l.UnitCost ?? 0) * l.Quantity));
        await conn.ExecuteAsync("""
            update invoices set status = 'FINAL', number = @number, finalized_at = now(), finalized_by = @uid, cost_total = @costTotal, updated_at = now()
            where id = @invoiceId
            """, new { number, uid = session.UserId, costTotal, invoiceId }, tx);

        // 3. Money: advances from the order / custom order first, then customer on-account credit, then new payment.
        if (inv.SalesOrderId.HasValue)
            await payments.TransferAsync(conn, tx, inv.CustomerId, DocType.SalesOrder, inv.SalesOrderId, DocType.Invoice, invoiceId, inv.GrandTotal, $"Advance moved to {number}");
        if (inv.CustomOrderId.HasValue)
            await payments.TransferAsync(conn, tx, inv.CustomerId, DocType.CustomOrder, inv.CustomOrderId, DocType.Invoice, invoiceId, inv.GrandTotal, $"Advance moved to {number}");
        if (creditFromInvoiceId.HasValue)
        {
            // Exchange: money already paid on the original invoice (now overpaid after the return) moves to this invoice.
            var from = await PaymentService.InvoicePositionAsync(conn, tx, creditFromInvoiceId.Value);
            var excess = Math.Max(0, from.Paid - from.Net);
            await payments.TransferAsync(conn, tx, inv.CustomerId, DocType.Invoice, creditFromInvoiceId, DocType.Invoice, invoiceId,
                Math.Min(excess, inv.GrandTotal), $"Exchange credit applied to {number}");
        }
        if (useAdvance > 0)
        {
            var pos0 = await PaymentService.InvoicePositionAsync(conn, tx, invoiceId);
            await payments.TransferAsync(conn, tx, inv.CustomerId, DocType.OnAccount, null, DocType.Invoice, invoiceId,
                Math.Min(useAdvance, Math.Max(0, pos0.Balance)), $"Advance adjusted in {number}");
        }

        var result = new CheckoutResult { InvoiceId = invoiceId, InvoiceNumber = number };
        var money = paymentLines.Where(p => p.Amount > 0 && p.MethodCode != PaymentMethodCode.Credit).ToList();
        if (money.Count > 0)
        {
            session.Demand(Perm.PaymentReceive);
            var plan = await PaymentService.PlanAllocationsAsync(conn, tx, inv.CustomerId, DocType.Invoice, invoiceId, money.Sum(m => m.Amount));
            if (customer.IsWalkIn && plan.Any(p => p.DocType == DocType.OnAccount))
                throw new BusinessRuleException($"Amount received is more than the invoice total. Return the change to the customer.");
            var pay = await payments.RecordAsync(conn, tx, PaymentDirection.In, inv.CustomerId, inv.Date > DateTime.Today ? DateTime.Today : inv.Date, money, plan, $"Against {number}");
            result.PaymentId = pay.Id;
            result.PaymentNumber = pay.Number;
        }

        // 4. Business rule: credit sales need a real customer; credit limit is enforced when set.
        var pos = await PaymentService.InvoicePositionAsync(conn, tx, invoiceId);
        if (pos.Balance > 0)
        {
            if (customer.IsWalkIn)
                throw new BusinessRuleException("Credit / partial payment needs a customer. Select or create the customer before saving.");
            if (customer.CreditLimit > 0)
            {
                var outstanding = await conn.ExecuteScalarAsync<decimal>(
                    "select coalesce(sum(balance),0) from v_invoice_balances where customer_id = @CustomerId and balance > 0", inv, tx);
                if (outstanding > customer.CreditLimit)
                {
                    var canOverride = session.Has(Perm.CreditOverride);
                    if (!canOverride || string.IsNullOrWhiteSpace(creditOverride))
                        throw new CreditLimitException(
                            $"{customer.Name}'s credit limit is {Money.Format(customer.CreditLimit)}; with this bill they would owe {Money.Format(outstanding)}. " +
                            (canOverride ? "Enter a reason to approve the extra credit." : "Take more payment now, or ask a manager to approve."),
                            customer.CreditLimit, outstanding, canOverride);
                    await conn.ExecuteAsync("update invoices set credit_override_reason = @reason, credit_override_by = @uid where id = @invoiceId",
                        new { reason = creditOverride.Trim(), uid = session.UserId, invoiceId }, tx);
                    await audit.LogAsync(conn, tx, "CREDIT_OVERRIDE", "Sales",
                        $"approved credit beyond limit on {number} for {customer.Name} — owes {Money.Format(outstanding)} against a limit of {Money.Format(customer.CreditLimit)}: {creditOverride.Trim()}",
                        "invoice", invoiceId, number);
                }
            }
            if (inv.DueDate is null)
                await conn.ExecuteAsync("update invoices set due_date = invoice_date + @days where id = @invoiceId", new { days = s.Invoice.DefaultDueDays, invoiceId }, tx);
        }

        // 5. Warranty registrations for products that carry a warranty.
        await ServiceDeskService.RegisterForInvoiceAsync(conn, tx, invoiceId);

        // 6. Links back to the source documents.
        if (inv.SalesOrderId.HasValue)
            await conn.ExecuteAsync("update sales_orders set invoice_id = @invoiceId, updated_at = now() where id = @SalesOrderId", new { invoiceId, inv.SalesOrderId }, tx);
        if (inv.CustomOrderId.HasValue)
            await conn.ExecuteAsync("update custom_orders set invoice_id = @invoiceId, updated_at = now() where id = @CustomOrderId", new { invoiceId, inv.CustomOrderId }, tx);
        await conn.ExecuteAsync("""
            update deliveries set invoice_id = @invoiceId, updated_at = now()
            where invoice_id is null and ((sales_order_id = @SalesOrderId) or (custom_order_id = @CustomOrderId))
            """, new { invoiceId, inv.SalesOrderId, inv.CustomOrderId }, tx);

        // 7. Delivery (direct sales only — orders create their delivery from the order screen).
        if (inv.RequiresDelivery && s.Delivery.AutoCreateDelivery && inv.SalesOrderId is null && inv.CustomOrderId is null)
            result.DeliveryId = await DeliveryService.CreateForInvoiceAsync(conn, tx, session, invoiceId);

        await audit.LogAsync(conn, tx, "FINALIZE", "Sales",
            $"created invoice {number} for {inv.CustomerName} — {Money.Format(inv.GrandTotal)} (paid {Money.Format(pos.Paid)}, balance {Money.Format(pos.Balance)})",
            "invoice", invoiceId, number, null, new { inv.CustomerId, inv.GrandTotal, inv.TaxableTotal, pos.Paid, pos.Balance });
        return result;
    }

    // ------------------------------------------------------------------ cancel
    /// <summary>
    /// Cancels a finalised invoice. The invoice stays in the register with status CANCELLED;
    /// sold stock comes back; money received is kept as customer advance (refund it from Payments if needed).
    /// </summary>
    public async Task CancelAsync(long invoiceId, string reason)
    {
        session.Demand(Perm.InvoiceCancel);
        if (string.IsNullOrWhiteSpace(reason)) throw new ValidationException("Reason", "Enter the reason for cancelling.");
        await db.InTransactionAsync(async (conn, tx) =>
        {
            var inv = await conn.QuerySingleOrDefaultAsync<Invoice>("select * from invoices where id = @invoiceId for update", new { invoiceId }, tx)
                      ?? throw new NotFoundException("Invoice", invoiceId);
            if (inv.Status != InvoiceStatus.Final) throw new BusinessRuleException("Only finalised invoices can be cancelled.");
            if (await conn.ExecuteScalarAsync<int>("select count(*) from sales_returns where invoice_id = @invoiceId", new { invoiceId }, tx) > 0)
                throw new BusinessRuleException("This invoice has returns recorded against it and cannot be cancelled.");
            if (await conn.ExecuteScalarAsync<int>("select count(*) from deliveries where invoice_id = @invoiceId and status = 'DELIVERED'", new { invoiceId }, tx) > 0)
                throw new BusinessRuleException("The goods have been delivered. Record a sales return instead of cancelling.");

            var lines = await SalesDocumentBuilder.LoadLinesAsync(conn, tx, "invoice_items", "invoice_id", invoiceId, true);
            foreach (var l in lines.Where(l => l.VariantId.HasValue && l.Quantity - l.ReturnedQty > 0))
                if (await InventoryService.IsStockItemAsync(conn, tx, l.VariantId!.Value))
                    await inventory.ApplyAsync(conn, tx, l.VariantId.Value, MovementType.SaleCancelIn, l.Quantity - l.ReturnedQty, 0, 0,
                        DocType.Invoice, invoiceId, inv.Number, $"Invoice cancelled: {reason}");

            var pos = await PaymentService.InvoicePositionAsync(conn, tx, invoiceId);
            if (pos.Paid > 0)
                await payments.TransferAsync(conn, tx, inv.CustomerId, DocType.Invoice, invoiceId, DocType.OnAccount, null, pos.Paid,
                    $"Invoice {inv.Number} cancelled — kept as advance");

            await conn.ExecuteAsync("""
                update invoices set status = 'CANCELLED', cancelled_at = now(), cancelled_by = @uid, cancel_reason = @reason, updated_at = now()
                where id = @invoiceId
                """, new { uid = session.UserId, reason = reason.Trim(), invoiceId }, tx);
            await conn.ExecuteAsync("update sales_orders set invoice_id = null, updated_at = now() where invoice_id = @invoiceId", new { invoiceId }, tx);
            await conn.ExecuteAsync("update custom_orders set invoice_id = null, updated_at = now() where invoice_id = @invoiceId", new { invoiceId }, tx);
            await conn.ExecuteAsync("update deliveries set status = 'CANCELLED', updated_at = now() where invoice_id = @invoiceId and status <> 'DELIVERED'", new { invoiceId }, tx);
            await ServiceDeskService.VoidForInvoiceAsync(conn, tx, invoiceId, $"Invoice {inv.Number} cancelled");

            await audit.LogAsync(conn, tx, "CANCEL", "Sales", $"cancelled invoice {inv.Number} ({Money.Format(inv.GrandTotal)}) — {reason}",
                "invoice", invoiceId, inv.Number, new { Status = "FINAL", inv.GrandTotal, pos.Paid }, new { Status = "CANCELLED", Reason = reason, AdvanceKept = pos.Paid });
        });
    }

    // ------------------------------------------------------------------ queries
    private const string HeaderSelect = """
        select i.*, i.invoice_date as date, u.full_name as created_by_name, cu.full_name as cancelled_by_name,
               so.number as sales_order_number, q.number as quotation_number, co.number as custom_order_number,
               coalesce(b.returned_amount,0) as returned_amount, coalesce(b.paid,0) as paid
        from invoices i
        left join users u on u.id = i.created_by
        left join users cu on cu.id = i.cancelled_by
        left join sales_orders so on so.id = i.sales_order_id
        left join quotations q on q.id = i.quotation_id
        left join custom_orders co on co.id = i.custom_order_id
        left join v_invoice_balances b on b.invoice_id = i.id
        """;

    public async Task<Invoice> GetAsync(long id)
    {
        session.DemandAny(Perm.InvoiceView, Perm.InvoiceCreate);
        await using var conn = await db.OpenAsync();
        var inv = await conn.QuerySingleOrDefaultAsync<Invoice>($"{HeaderSelect} where i.id = @id", new { id }) ?? throw new NotFoundException("Invoice", id);
        inv.Lines = await SalesDocumentBuilder.LoadLinesAsync(conn, null, "invoice_items", "invoice_id", id, session.CanSeeCost, "source_sales_order_item_id as source_item_id");
        if (!session.CanSeeCost) inv.CostTotal = null;
        return inv;
    }

    public async Task<PagedResult<InvoiceListItem>> ListAsync(ListQuery q, string? paymentState = null)
    {
        session.DemandAny(Perm.InvoiceView, Perm.InvoiceCreate);
        var where = """
            where (@From::date is null or i.invoice_date >= @From::date) and (@To::date is null or i.invoice_date <= @To::date)
              and (@Status::text is null or i.status = @Status)
              and (@CustomerId::bigint is null or i.customer_id = @CustomerId)
              and (@Search::text is null or i.number ilike '%' || @Search || '%' or i.customer_name ilike '%' || @Search || '%'
                   or i.customer_mobile like '%' || @Search || '%')
              and (@PayState::text is null
                   or (@PayState = 'PAID' and i.status = 'FINAL' and coalesce(b.balance,0) <= 0)
                   or (@PayState = 'UNPAID' and i.status = 'FINAL' and coalesce(b.paid,0) <= 0 and b.balance > 0)
                   or (@PayState = 'PARTIALLY_PAID' and i.status = 'FINAL' and b.paid > 0 and b.balance > 0)
                   or (@PayState = 'OVERDUE' and i.status = 'FINAL' and b.balance > 0 and i.due_date < current_date)
                   or (@PayState = 'OUTSTANDING' and i.status = 'FINAL' and b.balance > 0))
            """;
        var order = q.SortBy switch
        {
            "total" => "i.grand_total", "balance" => "coalesce(b.balance,0)", "customer" => "i.customer_name", "number" => "i.number", "due" => "i.due_date", _ => "i.invoice_date",
        };
        var dir = q.SortDescending ? "desc nulls last" : "asc";
        var args = new { q.From, q.To, q.Status, q.CustomerId, Search = Blank(q.Search), PayState = paymentState, q.PageSize, q.Offset };
        await using var conn = await db.OpenAsync();
        const string from = "from invoices i left join v_invoice_balances b on b.invoice_id = i.id left join users u on u.id = i.created_by";
        var total = await conn.ExecuteScalarAsync<int>($"select count(*) {from} {where}", args);
        var rows = await conn.QueryAsync<InvoiceListItem>($"""
            select i.id, i.number, i.status, i.invoice_date, i.due_date, i.customer_id, i.customer_name, i.customer_mobile, i.grand_total,
                   coalesce(b.returned_amount,0) as returned_amount, coalesce(b.paid,0) as paid, coalesce(b.balance,0) as balance,
                   u.full_name as created_by_name,
                   case when b.balance > 0 and i.due_date < current_date then current_date - i.due_date else 0 end as days_overdue
            {from} {where} order by {order} {dir}, i.id desc limit @PageSize offset @Offset
            """, args);
        return new PagedResult<InvoiceListItem> { Items = rows.AsList(), TotalCount = total, Page = q.Page, PageSize = q.PageSize };
    }

    public async Task<IReadOnlyList<SalesReturn>> ReturnsForAsync(long invoiceId)
    {
        await using var conn = await db.OpenAsync();
        return (await conn.QueryAsync<SalesReturn>("select r.*, u.full_name as created_by_name from sales_returns r left join users u on u.id = r.created_by where invoice_id = @invoiceId order by id", new { invoiceId })).AsList();
    }

    private static string? Blank(string? s) => string.IsNullOrWhiteSpace(s) ? null : s.Trim();
}
