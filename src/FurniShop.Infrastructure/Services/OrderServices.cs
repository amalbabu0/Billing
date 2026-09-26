using Dapper;
using FurniShop.Core;
using FurniShop.Core.Domain;
using FurniShop.Core.Security;
using FurniShop.Infrastructure.Database;
using FurniShop.Infrastructure.Security;
using Npgsql;

namespace FurniShop.Infrastructure.Services;

/// <summary>Quotations: Draft → Sent → Confirmed → Converted (to sales order).</summary>
public sealed class QuotationService(Db db, UserSession session, AuditService audit, SalesOrderService salesOrders)
{
    public async Task<long> SaveAsync(SalesDocumentInput input)
    {
        session.Demand(Perm.QuotationManage);
        return await db.InTransactionAsync(async (conn, tx) =>
        {
            var s = await SettingsService.LoadAsync(conn, tx);
            var built = await SalesDocumentBuilder.BuildAsync(conn, tx, session, s, input);
            var args = new DynamicParameters(SalesDocumentBuilder.TotalsArgs(built));
            args.AddDynamicParams(new
            {
                input.Id, CustomerId = built.Customer.Id, Date = input.Date.Date,
                ValidUntil = (input.ValidUntil ?? input.Date.AddDays(s.Invoice.QuotationValidityDays)).Date,
                input.Notes, Terms = input.Terms ?? s.Invoice.Terms, Uid = session.UserId,
            });
            long id;
            string number;
            if (input.Id == 0)
            {
                number = await SequenceService.NextAsync(conn, tx, DocType.Quotation, input.Date);
                args.Add("Number", number);
                id = await conn.ExecuteScalarAsync<long>("""
                    insert into quotations (number, customer_id, quote_date, valid_until, status, place_of_supply, is_inter_state, subtotal, discount_total,
                        taxable_total, cgst_total, sgst_total, igst_total, delivery_charge, installation_charge, charges_tax, round_off, grand_total,
                        notes, terms, created_by)
                    values (@Number, @CustomerId, @Date, @ValidUntil, 'DRAFT', @PlaceOfSupply, @IsInterState, @Subtotal, @DiscountTotal,
                        @TaxableTotal, @CgstTotal, @SgstTotal, @IgstTotal, @DeliveryCharge, @InstallationCharge, @ChargesTax, @RoundOff, @GrandTotal,
                        @Notes, @Terms, @Uid) returning id
                    """, args, tx);
                await SalesDocumentBuilder.AddStatusHistoryAsync(conn, tx, DocType.Quotation, id, null, QuotationStatus.Draft, "Created", session.UserId);
            }
            else
            {
                var cur = await conn.QuerySingleOrDefaultAsync<(string Status, string Number)>("select status, number from quotations where id = @Id for update", input, tx);
                if (cur.Status is null) throw new NotFoundException("Quotation", input.Id);
                if (cur.Status is not (QuotationStatus.Draft or QuotationStatus.Sent or QuotationStatus.Expired))
                    throw new BusinessRuleException($"A {StatusStyle.Label(cur.Status).ToLowerInvariant()} quotation cannot be edited.");
                number = cur.Number;
                await conn.ExecuteAsync($"""
                    update quotations set customer_id=@CustomerId, quote_date=@Date, valid_until=@ValidUntil, {SalesDocumentBuilder.TotalsSet},
                        notes=@Notes, terms=@Terms, status = case when status = 'EXPIRED' then 'DRAFT' else status end, updated_at=now()
                    where id=@Id
                    """, args, tx);
                await conn.ExecuteAsync("delete from quotation_items where quotation_id = @Id", input, tx);
                id = input.Id;
            }
            await SalesDocumentBuilder.InsertLinesAsync(conn, tx, "quotation_items", "quotation_id", id, built.Lines);
            await SalesDocumentBuilder.SetSalespersonAsync(conn, tx, "quotations", id, input, session.UserId);
            await audit.LogAsync(conn, tx, input.Id == 0 ? "CREATE" : "UPDATE", "Sales",
                $"{(input.Id == 0 ? "created" : "updated")} quotation {number} for {built.Customer.Name} — {Money.Format(built.Totals.GrandTotal)}",
                "quotation", id, number, null, new { built.Totals.GrandTotal, Lines = built.Lines.Count });
            return id;
        });
    }

    public async Task SetStatusAsync(long id, string status, string? note = null)
    {
        session.Demand(Perm.QuotationManage);
        if (status is not (QuotationStatus.Sent or QuotationStatus.Confirmed or QuotationStatus.Rejected or QuotationStatus.Cancelled or QuotationStatus.Draft))
            throw new ValidationException("Status", "Invalid status.");
        await db.InTransactionAsync(async (conn, tx) =>
        {
            var cur = await conn.QuerySingleOrDefaultAsync<(string Status, string Number)>("select status, number from quotations where id = @id for update", new { id }, tx);
            if (cur.Status is null) throw new NotFoundException("Quotation", id);
            if (cur.Status is QuotationStatus.Converted or QuotationStatus.Cancelled)
                throw new BusinessRuleException("This quotation is closed.");
            await conn.ExecuteAsync("update quotations set status = @status, updated_at = now() where id = @id", new { status, id }, tx);
            await SalesDocumentBuilder.AddStatusHistoryAsync(conn, tx, DocType.Quotation, id, cur.Status, status, note, session.UserId);
            await audit.LogAsync(conn, tx, "STATUS", "Sales", $"marked quotation {cur.Number} as {StatusStyle.Label(status)}", "quotation", id, cur.Number,
                new { Status = cur.Status }, new { Status = status });
        });
    }

    /// <summary>Creates a sales order from the quotation, copying every line and keeping references both ways.</summary>
    public async Task<long> ConvertToSalesOrderAsync(long id, DateTime? expectedDelivery = null, bool confirm = true)
    {
        session.Demand(Perm.SalesOrderManage);
        return await db.InTransactionAsync(async (conn, tx) =>
        {
            var q = await conn.QuerySingleOrDefaultAsync<Quotation>("select *, quote_date as date from quotations where id = @id for update", new { id }, tx)
                    ?? throw new NotFoundException("Quotation", id);
            if (q.Status is QuotationStatus.Converted) throw new BusinessRuleException("This quotation has already been converted.");
            if (q.Status is QuotationStatus.Cancelled or QuotationStatus.Rejected) throw new BusinessRuleException("A cancelled / rejected quotation cannot be converted.");
            var lines = await SalesDocumentBuilder.LoadLinesAsync(conn, tx, "quotation_items", "quotation_id", id, true);
            var input = new SalesDocumentInput
            {
                CustomerId = q.CustomerId, Date = DateTime.Today, Lines = lines.Select(LineInput.From).ToList(),
                DeliveryCharge = q.DeliveryCharge, InstallationCharge = q.InstallationCharge, PlaceOfSupply = q.PlaceOfSupply,
                Notes = q.Notes, Terms = q.Terms, ExpectedDeliveryDate = expectedDelivery, QuotationId = id,
                RequiresDelivery = true, RequiresInstallation = q.InstallationCharge > 0,
            };
            var soId = await salesOrders.SaveAsync(conn, tx, input, allowPriceOverride: true);
            var soNumber = await conn.ExecuteScalarAsync<string>("select number from sales_orders where id = @soId", new { soId }, tx);
            await conn.ExecuteAsync("update quotations set status = 'CONVERTED', sales_order_id = @soId, updated_at = now() where id = @id", new { soId, id }, tx);
            await SalesDocumentBuilder.AddStatusHistoryAsync(conn, tx, DocType.Quotation, id, q.Status, QuotationStatus.Converted, $"Sales order {soNumber}", session.UserId);
            await audit.LogAsync(conn, tx, "CONVERT", "Sales", $"converted quotation {q.Number} to sales order {soNumber}", "quotation", id, q.Number, null, new { SalesOrder = soNumber });
            if (confirm) await salesOrders.ConfirmAsync(conn, tx, soId);
            return soId;
        });
    }

    public async Task<Quotation> GetAsync(long id)
    {
        session.Demand(Perm.QuotationView);
        await using var conn = await db.OpenAsync();
        var q = await conn.QuerySingleOrDefaultAsync<Quotation>("""
            select q.*, q.quote_date as date, c.name as customer_name, c.mobile as customer_mobile, c.gstin as customer_gstin,
                   concat_ws(', ', c.billing_address, c.city, c.state, c.pincode) as billing_address, so.number as sales_order_number, u.full_name as created_by_name, (select full_name from users sp where sp.id = q.salesperson_id) as salesperson_name
            from quotations q join customers c on c.id = q.customer_id left join sales_orders so on so.id = q.sales_order_id left join users u on u.id = q.created_by
            where q.id = @id
            """, new { id }) ?? throw new NotFoundException("Quotation", id);
        q.Lines = await SalesDocumentBuilder.LoadLinesAsync(conn, null, "quotation_items", "quotation_id", id, session.CanSeeCost);
        return q;
    }

    public async Task<PagedResult<Quotation>> ListAsync(ListQuery lq)
    {
        session.Demand(Perm.QuotationView);
        await db.ExecuteAsync("update quotations set status = 'EXPIRED' where status in ('DRAFT','SENT') and valid_until < current_date");
        var where = """
            where (@From::date is null or q.quote_date >= @From::date) and (@To::date is null or q.quote_date <= @To::date)
              and (@Status::text is null or q.status = @Status) and (@CustomerId::bigint is null or q.customer_id = @CustomerId)
              and (@Search::text is null or q.number ilike '%' || @Search || '%' or c.name ilike '%' || @Search || '%' or c.mobile like '%' || @Search || '%')
            """;
        var args = new { lq.From, lq.To, lq.Status, lq.CustomerId, Search = Blank(lq.Search), lq.PageSize, lq.Offset };
        await using var conn = await db.OpenAsync();
        var total = await conn.ExecuteScalarAsync<int>($"select count(*) from quotations q join customers c on c.id = q.customer_id {where}", args);
        var rows = await conn.QueryAsync<Quotation>($"""
            select q.*, q.quote_date as date, c.name as customer_name, c.mobile as customer_mobile, so.number as sales_order_number, u.full_name as created_by_name, (select full_name from users sp where sp.id = q.salesperson_id) as salesperson_name
            from quotations q join customers c on c.id = q.customer_id left join sales_orders so on so.id = q.sales_order_id left join users u on u.id = q.created_by
            {where} order by q.quote_date desc, q.id desc limit @PageSize offset @Offset
            """, args);
        return new PagedResult<Quotation> { Items = rows.AsList(), TotalCount = total, Page = lq.Page, PageSize = lq.PageSize };
    }

    private static string? Blank(string? s) => string.IsNullOrWhiteSpace(s) ? null : s.Trim();
}

public sealed record ReservationResult(IReadOnlyList<string> Shortages)
{
    public bool FullyReserved => Shortages.Count == 0;
}

/// <summary>
/// Sales orders: Draft → Confirmed → Processing → Manufacturing → Ready → Dispatched → Delivered → Completed (or Cancelled).
/// Confirming reserves available stock; advances are allocated to the order and move to the invoice when it is billed.
/// </summary>
public sealed class SalesOrderService(Db db, UserSession session, AuditService audit, InventoryService inventory,
    PaymentService payments, InvoiceService invoices)
{
    public async Task<long> SaveAsync(SalesDocumentInput input)
    {
        session.Demand(Perm.SalesOrderManage);
        return await db.InTransactionAsync(async (conn, tx) => await SaveAsync(conn, tx, input, false));
    }

    internal async Task<long> SaveAsync(NpgsqlConnection conn, NpgsqlTransaction tx, SalesDocumentInput input, bool allowPriceOverride)
    {
        var s = await SettingsService.LoadAsync(conn, tx);
        var built = await SalesDocumentBuilder.BuildAsync(conn, tx, session, s, input, !allowPriceOverride);
        var args = new DynamicParameters(SalesDocumentBuilder.TotalsArgs(built));
        args.AddDynamicParams(new
        {
            input.Id, CustomerId = built.Customer.Id, Date = input.Date.Date, input.ExpectedDeliveryDate, input.QuotationId,
            DeliveryAddress = Core.Validation.Validators.Clean(input.DeliveryAddress) ?? InvoiceService.FullAddress(built.Customer),
            input.RequiresDelivery, input.RequiresInstallation, input.Notes, Terms = input.Terms ?? s.Invoice.Terms, Uid = session.UserId,
        });

        long id;
        string number;
        string? status = null;
        if (input.Id == 0)
        {
            number = await SequenceService.NextAsync(conn, tx, DocType.SalesOrder, input.Date);
            args.Add("Number", number);
            id = await conn.ExecuteScalarAsync<long>("""
                insert into sales_orders (number, customer_id, order_date, expected_delivery_date, status, quotation_id, place_of_supply, is_inter_state,
                    delivery_address, requires_delivery, requires_installation, subtotal, discount_total, taxable_total, cgst_total, sgst_total, igst_total,
                    delivery_charge, installation_charge, charges_tax, round_off, grand_total, notes, terms, created_by)
                values (@Number, @CustomerId, @Date, @ExpectedDeliveryDate, 'DRAFT', @QuotationId, @PlaceOfSupply, @IsInterState,
                    @DeliveryAddress, @RequiresDelivery, @RequiresInstallation, @Subtotal, @DiscountTotal, @TaxableTotal, @CgstTotal, @SgstTotal, @IgstTotal,
                    @DeliveryCharge, @InstallationCharge, @ChargesTax, @RoundOff, @GrandTotal, @Notes, @Terms, @Uid) returning id
                """, args, tx);
            await SalesDocumentBuilder.AddStatusHistoryAsync(conn, tx, DocType.SalesOrder, id, null, SalesOrderStatus.Draft,
                input.QuotationId.HasValue ? "Created from quotation" : "Created", session.UserId);
        }
        else
        {
            var cur = await conn.QuerySingleOrDefaultAsync<(string Status, string Number, long? InvoiceId, long CustomerId)>(
                "select status, number, invoice_id, customer_id from sales_orders where id = @Id for update", input, tx);
            if (cur.Status is null) throw new NotFoundException("Sales order", input.Id);
            if (cur.InvoiceId.HasValue) throw new BusinessRuleException("This order has been invoiced and cannot be edited.");
            if (cur.Status is not (SalesOrderStatus.Draft or SalesOrderStatus.Confirmed or SalesOrderStatus.Processing))
                throw new BusinessRuleException("The order can only be edited while Draft, Confirmed or Processing.");
            if (cur.CustomerId != built.Customer.Id && await PaymentService.PaidAsync(conn, tx, DocType.SalesOrder, input.Id) != 0)
                throw new BusinessRuleException("The customer cannot be changed after an advance has been received.");
            number = cur.Number;
            status = cur.Status;
            await ReleaseReservationsAsync(conn, tx, input.Id, number, "Order edited");
            await conn.ExecuteAsync($"""
                update sales_orders set customer_id=@CustomerId, order_date=@Date, expected_delivery_date=@ExpectedDeliveryDate,
                    delivery_address=@DeliveryAddress, requires_delivery=@RequiresDelivery, requires_installation=@RequiresInstallation,
                    {SalesDocumentBuilder.TotalsSet}, notes=@Notes, terms=@Terms, updated_at=now()
                where id=@Id
                """, args, tx);
            await conn.ExecuteAsync("delete from sales_order_items where sales_order_id = @Id", input, tx);
            id = input.Id;
        }
        await SalesDocumentBuilder.InsertLinesAsync(conn, tx, "sales_order_items", "sales_order_id", id, built.Lines, "source_quotation_item_id");
        await SalesDocumentBuilder.SetSalespersonAsync(conn, tx, "sales_orders", id, input, session.UserId);
        if (status is SalesOrderStatus.Confirmed or SalesOrderStatus.Processing)
            await ReserveAsync(conn, tx, id, number);

        var paid = await PaymentService.PaidAsync(conn, tx, DocType.SalesOrder, id);
        if (paid > built.Totals.GrandTotal)
            await payments.TransferAsync(conn, tx, built.Customer.Id, DocType.SalesOrder, id, DocType.OnAccount, null, paid - built.Totals.GrandTotal,
                $"Order {number} reduced — excess advance kept on account");

        await audit.LogAsync(conn, tx, input.Id == 0 ? "CREATE" : "UPDATE", "Sales",
            $"{(input.Id == 0 ? "created" : "updated")} sales order {number} for {built.Customer.Name} — {Money.Format(built.Totals.GrandTotal)}",
            "sales_order", id, number, null, new { built.Totals.GrandTotal, Lines = built.Lines.Count });
        return id;
    }

    public async Task<ReservationResult> ConfirmAsync(long id)
    {
        session.Demand(Perm.SalesOrderManage);
        return await db.InTransactionAsync(async (conn, tx) => await ConfirmAsync(conn, tx, id));
    }

    internal async Task<ReservationResult> ConfirmAsync(NpgsqlConnection conn, NpgsqlTransaction tx, long id)
    {
        var so = await conn.QuerySingleOrDefaultAsync<(string Status, string Number)>("select status, number from sales_orders where id = @id for update", new { id }, tx);
        if (so.Status is null) throw new NotFoundException("Sales order", id);
        if (so.Status != SalesOrderStatus.Draft) throw new BusinessRuleException("Only draft orders can be confirmed.");
        await conn.ExecuteAsync("update sales_orders set status = 'CONFIRMED', updated_at = now() where id = @id", new { id }, tx);
        await SalesDocumentBuilder.AddStatusHistoryAsync(conn, tx, DocType.SalesOrder, id, so.Status, SalesOrderStatus.Confirmed, null, session.UserId);
        var s = await SettingsService.LoadAsync(conn, tx);
        var result = s.Inventory.ReserveOnSalesOrderConfirm ? await ReserveAsync(conn, tx, id, so.Number) : new ReservationResult(Array.Empty<string>());
        await audit.LogAsync(conn, tx, "CONFIRM", "Sales", $"confirmed sales order {so.Number}" + (result.FullyReserved ? "" : $" (short: {string.Join(", ", result.Shortages)})"),
            "sales_order", id, so.Number);
        return result;
    }

    /// <summary>Reserves as much of each stock line as is available. Returns the lines still short (to purchase / manufacture).</summary>
    public async Task<ReservationResult> ReserveAsync(long id)
    {
        session.Demand(Perm.SalesOrderManage);
        return await db.InTransactionAsync(async (conn, tx) =>
        {
            var so = await conn.QuerySingleOrDefaultAsync<(string Status, string Number, long? InvoiceId)>("select status, number, invoice_id from sales_orders where id = @id for update", new { id }, tx);
            if (so.InvoiceId.HasValue || so.Status is SalesOrderStatus.Cancelled or SalesOrderStatus.Draft or SalesOrderStatus.Completed)
                throw new BusinessRuleException("Stock can only be reserved for confirmed, un-invoiced orders.");
            return await ReserveAsync(conn, tx, id, so.Number);
        });
    }

    private async Task<ReservationResult> ReserveAsync(NpgsqlConnection conn, NpgsqlTransaction tx, long id, string number)
    {
        var shortages = new List<string>();
        var items = await conn.QueryAsync<(long Id, long? VariantId, string Description, decimal Quantity, decimal ReservedQty)>(
            "select id, variant_id, description, quantity, reserved_qty from sales_order_items where sales_order_id = @id order by line_no for update", new { id }, tx);
        foreach (var it in items.Where(i => i.VariantId.HasValue))
        {
            if (!await InventoryService.IsStockItemAsync(conn, tx, it.VariantId!.Value)) continue;
            var need = it.Quantity - it.ReservedQty;
            if (need <= 0) continue;
            var levels = await conn.QuerySingleOrDefaultAsync<(decimal OnHand, decimal Reserved)>(
                "select on_hand, reserved from inventory where variant_id = @v for update", new { v = it.VariantId }, tx);
            var take = Math.Min(need, Math.Max(0, levels.OnHand - levels.Reserved));
            if (take > 0)
            {
                await inventory.ApplyAsync(conn, tx, it.VariantId.Value, MovementType.Reserve, 0, take, 0, DocType.SalesOrder, id, number, "Reserved for order");
                await conn.ExecuteAsync("update sales_order_items set reserved_qty = reserved_qty + @take where id = @Id", new { take, it.Id }, tx);
            }
            if (take < need) shortages.Add($"{it.Description} ×{need - take:0.##}");
        }
        return new ReservationResult(shortages);
    }

    private async Task ReleaseReservationsAsync(NpgsqlConnection conn, NpgsqlTransaction tx, long id, string number, string note)
    {
        var items = await conn.QueryAsync<(long Id, long VariantId, decimal ReservedQty)>(
            "select id, variant_id, reserved_qty from sales_order_items where sales_order_id = @id and reserved_qty > 0 for update", new { id }, tx);
        foreach (var it in items)
        {
            await inventory.ApplyAsync(conn, tx, it.VariantId, MovementType.Unreserve, 0, -it.ReservedQty, 0, DocType.SalesOrder, id, number, note);
            await conn.ExecuteAsync("update sales_order_items set reserved_qty = 0 where id = @Id", new { it.Id }, tx);
        }
    }

    public async Task ChangeStatusAsync(long id, string newStatus, string? note = null)
    {
        session.DemandAny(Perm.SalesOrderManage, Perm.DeliveryManage);
        if (!SalesOrderStatus.All.Contains(newStatus)) throw new ValidationException("Status", "Invalid status.");
        await db.InTransactionAsync(async (conn, tx) => await ChangeStatusAsync(conn, tx, id, newStatus, note));
    }

    internal async Task ChangeStatusAsync(NpgsqlConnection conn, NpgsqlTransaction tx, long id, string newStatus, string? note)
    {
        var so = await conn.QuerySingleOrDefaultAsync<SalesOrder>("select * from sales_orders where id = @id for update", new { id }, tx)
                 ?? throw new NotFoundException("Sales order", id);
        if (so.Status == newStatus) return;
        if (!SalesOrderStatus.IsOpen(so.Status)) throw new BusinessRuleException("This order is closed.");

        if (newStatus == SalesOrderStatus.Cancelled)
        {
            if (so.InvoiceId.HasValue) throw new BusinessRuleException("Cancel the invoice first — this order has been billed.");
            if (string.IsNullOrWhiteSpace(note)) throw new ValidationException("Reason", "Enter the reason for cancelling.");
            await ReleaseReservationsAsync(conn, tx, id, so.Number!, "Order cancelled");
            var paid = await PaymentService.PaidAsync(conn, tx, DocType.SalesOrder, id);
            if (paid > 0)
                await payments.TransferAsync(conn, tx, so.CustomerId, DocType.SalesOrder, id, DocType.OnAccount, null, paid,
                    $"Order {so.Number} cancelled — advance kept on account");
            await conn.ExecuteAsync("update sales_orders set status = 'CANCELLED', cancel_reason = @note, updated_at = now() where id = @id", new { note, id }, tx);
            await conn.ExecuteAsync("update deliveries set status = 'CANCELLED', updated_at = now() where sales_order_id = @id and status not in ('DELIVERED')", new { id }, tx);
        }
        else
        {
            var from = Array.IndexOf(SalesOrderStatus.Flow, so.Status);
            var to = Array.IndexOf(SalesOrderStatus.Flow, newStatus);
            if (to <= 0) throw new BusinessRuleException("Use Confirm to confirm a draft order.");
            if (so.Status == SalesOrderStatus.Draft) throw new BusinessRuleException("Confirm the order first.");
            if (to < from) throw new BusinessRuleException("An order cannot move back to an earlier stage.");
            if (newStatus is SalesOrderStatus.Delivered or SalesOrderStatus.Completed && so.RequiresDelivery)
            {
                var delivered = await conn.ExecuteScalarAsync<int>("select count(*) from deliveries where sales_order_id = @id and status = 'DELIVERED'", new { id }, tx);
                if (delivered == 0) throw new BusinessRuleException("Record the delivery (with proof) in Delivery before marking the order delivered.");
            }
            if (newStatus == SalesOrderStatus.Completed && !so.InvoiceId.HasValue)
                throw new BusinessRuleException("Generate the invoice before completing the order.");
            await conn.ExecuteAsync("update sales_orders set status = @newStatus, updated_at = now() where id = @id", new { newStatus, id }, tx);
        }
        await SalesDocumentBuilder.AddStatusHistoryAsync(conn, tx, DocType.SalesOrder, id, so.Status, newStatus, note, session.UserId);
        await audit.LogAsync(conn, tx, "STATUS", "Sales", $"changed sales order {so.Number} from {StatusStyle.Label(so.Status)} to {StatusStyle.Label(newStatus)}",
            "sales_order", id, so.Number, new { so.Status }, new { Status = newStatus, Note = note });
    }

    /// <summary>Generates the final GST invoice from the order: lines copied, reservation consumed, advance applied.</summary>
    public async Task<CheckoutResult> ConvertToInvoiceAsync(long id, IReadOnlyList<PaymentLineInput> paymentLines, DateTime? dueDate = null)
    {
        session.Demand(Perm.InvoiceCreate);
        return await db.InTransactionAsync(async (conn, tx) =>
        {
            var so = await conn.QuerySingleOrDefaultAsync<SalesOrder>("select *, order_date as date from sales_orders where id = @id for update", new { id }, tx)
                     ?? throw new NotFoundException("Sales order", id);
            if (so.InvoiceId.HasValue) throw new BusinessRuleException("This order has already been invoiced.");
            if (so.Status is SalesOrderStatus.Draft or SalesOrderStatus.Cancelled) throw new BusinessRuleException("Confirm the order before invoicing.");
            var lines = await SalesDocumentBuilder.LoadLinesAsync(conn, tx, "sales_order_items", "sales_order_id", id, true);
            var input = new SalesDocumentInput
            {
                CustomerId = so.CustomerId, Date = DateTime.Today, DueDate = dueDate, Lines = lines.Select(LineInput.From).ToList(),
                DeliveryCharge = so.DeliveryCharge, InstallationCharge = so.InstallationCharge, PlaceOfSupply = so.PlaceOfSupply,
                DeliveryAddress = so.DeliveryAddress, Notes = so.Notes, Terms = so.Terms, SalesOrderId = id, QuotationId = so.QuotationId,
                RequiresDelivery = so.RequiresDelivery, RequiresInstallation = so.RequiresInstallation,
            };
            // Prices were approved when the order was created, so the invoicing user is not re-checked for discount rights.
            var invoiceId = await invoices.SaveDraftAsync(conn, tx, input, enforceDiscount: false);
            var result = await invoices.FinalizeAsync(conn, tx, invoiceId, paymentLines, 0);
            await SalesDocumentBuilder.AddStatusHistoryAsync(conn, tx, DocType.SalesOrder, id, so.Status, so.Status, $"Invoice {result.InvoiceNumber} generated", session.UserId);
            return result;
        });
    }

    // ------------------------------------------------------------------ queries
    private const string Select = """
        select so.*, so.order_date as date, c.name as customer_name, c.mobile as customer_mobile, c.gstin as customer_gstin,
               concat_ws(', ', c.billing_address, c.city, c.state, c.pincode) as billing_address,
               q.number as quotation_number, i.number as invoice_number, u.full_name as created_by_name, (select full_name from users sp where sp.id = so.salesperson_id) as salesperson_name,
               coalesce((select sum(case when p.direction = 'IN' then a.amount else -a.amount end) from payment_allocations a
                         join payments p on p.id = a.payment_id and not p.is_voided where a.doc_type = 'SALES_ORDER' and a.doc_id = so.id), 0)
               + coalesce((select paid from v_invoice_balances b where b.invoice_id = so.invoice_id), 0) as advance_paid,
               exists (select 1 from sales_order_items it where it.sales_order_id = so.id and it.reserved_qty > 0) as stock_reserved
        from sales_orders so join customers c on c.id = so.customer_id
        left join quotations q on q.id = so.quotation_id left join invoices i on i.id = so.invoice_id left join users u on u.id = so.created_by
        """;

    public async Task<SalesOrder> GetAsync(long id)
    {
        session.DemandAny(Perm.SalesOrderView, Perm.DeliveryView);
        await using var conn = await db.OpenAsync();
        var so = await conn.QuerySingleOrDefaultAsync<SalesOrder>($"{Select} where so.id = @id", new { id }) ?? throw new NotFoundException("Sales order", id);
        so.Lines = await SalesDocumentBuilder.LoadLinesAsync(conn, null, "sales_order_items", "sales_order_id", id, session.CanSeeCost, "source_quotation_item_id as source_item_id");
        return so;
    }

    public async Task<IReadOnlyList<StatusHistoryEntry>> HistoryAsync(long id)
    {
        await using var conn = await db.OpenAsync();
        return await SalesDocumentBuilder.HistoryAsync(conn, DocType.SalesOrder, id);
    }

    public async Task<PagedResult<SalesOrder>> ListAsync(ListQuery q, bool openOnly = false)
    {
        session.DemandAny(Perm.SalesOrderView, Perm.DeliveryView);
        var where = $"""
            where (@From::date is null or so.order_date >= @From::date) and (@To::date is null or so.order_date <= @To::date)
              and (@Status::text is null or so.status = @Status) and (@CustomerId::bigint is null or so.customer_id = @CustomerId)
              {(openOnly ? "and so.status not in ('COMPLETED','CANCELLED')" : "")}
              and (@Search::text is null or so.number ilike '%' || @Search || '%' or c.name ilike '%' || @Search || '%' or c.mobile like '%' || @Search || '%')
            """;
        var args = new { q.From, q.To, q.Status, q.CustomerId, Search = Blank(q.Search), q.PageSize, q.Offset };
        await using var conn = await db.OpenAsync();
        var total = await conn.ExecuteScalarAsync<int>($"select count(*) from sales_orders so join customers c on c.id = so.customer_id {where}", args);
        var rows = await conn.QueryAsync<SalesOrder>($"{Select} {where} order by so.order_date desc, so.id desc limit @PageSize offset @Offset", args);
        return new PagedResult<SalesOrder> { Items = rows.AsList(), TotalCount = total, Page = q.Page, PageSize = q.PageSize };
    }

    private static string? Blank(string? s) => string.IsNullOrWhiteSpace(s) ? null : s.Trim();
}
