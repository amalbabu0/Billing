using Dapper;
using FurniShop.Core;
using FurniShop.Core.Domain;
using FurniShop.Core.Security;
using FurniShop.Infrastructure.Database;
using FurniShop.Infrastructure.Security;
using Npgsql;

namespace FurniShop.Infrastructure.Services;

/// <summary>
/// Sales returns (credit notes) and exchanges.
/// Returned goods go back to sellable stock, to damaged stock, or nowhere, according to their condition.
/// The credit first reduces what the customer still owes on the invoice; any money the customer has
/// overpaid is refunded now or kept on account as an advance.
/// </summary>
public sealed class ReturnService(Db db, UserSession session, AuditService audit, InventoryService inventory,
    PaymentService payments, InvoiceService invoices)
{
    private sealed class ItemRow
    {
        public long Id { get; set; }
        public long InvoiceId { get; set; }
        public long? VariantId { get; set; }
        public string Description { get; set; } = "";
        public decimal Quantity { get; set; }
        public decimal ReturnedQty { get; set; }
        public decimal LineTotal { get; set; }
        public decimal UnitCost { get; set; }
    }

    public async Task<(long Id, string Number, decimal Credit)> CreateAsync(ReturnInput input)
    {
        session.Demand(Perm.ReturnManage);
        if (input.RefundAmount > 0) session.Demand(Perm.PaymentRefund);
        return await db.InTransactionAsync(async (conn, tx) =>
        {
            var r = await CreateReturnAsync(conn, tx, input, input.Reason, null);
            var inv = await conn.QuerySingleAsync<Invoice>("select * from invoices where id = @InvoiceId", input, tx);
            var pos = await PaymentService.InvoicePositionAsync(conn, tx, input.InvoiceId);
            var overpaid = Math.Max(0, pos.Paid - pos.Net);
            if (input.RefundAmount > overpaid)
                throw new BusinessRuleException($"The customer has paid {Money.Format(overpaid)} more than the invoice value after this return — that is the most that can be refunded.");
            if (input.RefundAmount > 0)
            {
                var refund = await payments.RecordAsync(conn, tx, PaymentDirection.Out, inv.CustomerId, input.Date,
                    new[] { new PaymentLineInput { MethodCode = input.RefundMethod, Amount = input.RefundAmount, Reference = input.RefundReference } },
                    new[] { new AllocationRequest(DocType.Invoice, input.InvoiceId, input.RefundAmount, $"Refund for return {r.Number}") },
                    $"Refund for return {r.Number}");
                await conn.ExecuteAsync("update sales_returns set refund_amount = @amt, refund_payment_id = @pid where id = @id",
                    new { amt = input.RefundAmount, pid = refund.Id, id = r.Id }, tx);
            }
            var leftover = overpaid - input.RefundAmount;
            if (leftover > 0)
            {
                var walkIn = await conn.ExecuteScalarAsync<bool>("select is_walk_in from customers where id = @CustomerId", inv, tx);
                if (walkIn) throw new BusinessRuleException($"Refund the full {Money.Format(overpaid)} — credit cannot be held for the walk-in customer.");
                await payments.TransferAsync(conn, tx, inv.CustomerId, DocType.Invoice, input.InvoiceId, DocType.OnAccount, null, leftover,
                    $"Return {r.Number} — credit kept as advance");
            }
            return r;
        });
    }

    internal async Task<(long Id, string Number, decimal Credit)> CreateReturnAsync(NpgsqlConnection conn, NpgsqlTransaction tx, ReturnInput input, string reason, long? exchangeId)
    {
        if (input.Lines.Count == 0 || input.Lines.All(l => l.Quantity <= 0)) throw new ValidationException("Lines", "Select the items and quantities being returned.");
        if (!ReturnReason.Selectable.Contains(reason) && reason != ReturnReason.Exchange) throw new ValidationException("Reason", "Select a return reason.");
        if (input.Date.Date > DateTime.Today) throw new ValidationException("Date", "Return date cannot be in the future.");

        var inv = await conn.QuerySingleOrDefaultAsync<Invoice>("select *, invoice_date as date from invoices where id = @InvoiceId for update", input, tx)
                  ?? throw new NotFoundException("Invoice", input.InvoiceId);
        if (inv.Status != InvoiceStatus.Final) throw new BusinessRuleException("Returns can only be made against finalised invoices.");
        if (input.Date.Date < inv.Date.Date) throw new ValidationException("Date", "Return date is before the invoice date.");

        var items = (await conn.QueryAsync<ItemRow>("select * from invoice_items where invoice_id = @InvoiceId for update", input, tx)).ToDictionary(i => i.Id);
        var number = await SequenceService.NextAsync(conn, tx, DocType.Return, input.Date);
        var lines = new List<(ItemRow Item, ReturnLineInput In, decimal Credit, string Action)>();
        foreach (var l in input.Lines.Where(l => l.Quantity > 0))
        {
            if (!items.TryGetValue(l.InvoiceItemId, out var it)) throw new ValidationException("Lines", "The item is not on this invoice.");
            if (l.Quantity > it.Quantity - it.ReturnedQty)
                throw new ValidationException("Lines", $"{it.Description}: only {it.Quantity - it.ReturnedQty:0.##} can be returned.");
            if (!ItemCondition.All.Contains(l.Condition)) throw new ValidationException("Lines", "Select the item condition.");
            var action = l.RestockAction ?? RestockAction.ForCondition(l.Condition);
            if (!RestockAction.All.Contains(action)) throw new ValidationException("Lines", "Invalid restock action.");
            if (action == RestockAction.Restock && l.Condition != ItemCondition.Good)
                throw new BusinessRuleException($"{it.Description}: damaged / defective items cannot go back to sellable stock.");
            // Last units returned take the exact remainder so the credit never drifts from the line total.
            var credit = l.Quantity == it.Quantity - it.ReturnedQty
                ? it.LineTotal - Money.R2(it.LineTotal * it.ReturnedQty / it.Quantity)
                : Money.R2(it.LineTotal * l.Quantity / it.Quantity);
            lines.Add((it, l, credit, action));
        }
        var totalCredit = lines.Sum(x => x.Credit);

        var id = await conn.ExecuteScalarAsync<long>("""
            insert into sales_returns (number, invoice_id, customer_id, return_date, reason, credit_amount, exchange_id, notes, created_by)
            values (@number, @InvoiceId, @CustomerId, @Date, @reason, @totalCredit, @exchangeId, @Notes, @uid) returning id
            """, new { number, input.InvoiceId, inv.CustomerId, Date = input.Date.Date, reason, totalCredit, exchangeId, input.Notes, uid = session.UserId }, tx);

        foreach (var (it, l, credit, action) in lines)
        {
            await conn.ExecuteAsync("""
                insert into sales_return_items (return_id, invoice_item_id, variant_id, quantity, condition, restock_action, credit_amount)
                values (@id, @itemId, @VariantId, @Quantity, @Condition, @action, @credit)
                """, new { id, itemId = it.Id, it.VariantId, l.Quantity, l.Condition, action, credit }, tx);
            await conn.ExecuteAsync("update invoice_items set returned_qty = returned_qty + @Quantity where id = @itemId", new { l.Quantity, itemId = it.Id }, tx);

            if (it.VariantId.HasValue && await InventoryService.IsStockItemAsync(conn, tx, it.VariantId.Value))
            {
                if (action == RestockAction.Restock)
                    await inventory.ApplyAsync(conn, tx, it.VariantId.Value, MovementType.ReturnIn, l.Quantity, 0, 0, DocType.Return, id, number, $"Returned ({reason})", it.UnitCost);
                else if (action == RestockAction.DamagedStock)
                    await inventory.ApplyAsync(conn, tx, it.VariantId.Value, MovementType.ReturnDamaged, 0, 0, l.Quantity, DocType.Return, id, number, $"Returned {l.Condition.ToLowerInvariant()} ({reason})", it.UnitCost);
            }
        }

        await audit.LogAsync(conn, tx, "RETURN", "Sales", $"recorded return {number} against {inv.Number} — credit {Money.Format(totalCredit)} ({StatusStyle.Label(reason)})",
            "sales_return", id, number, null, new { inv.Number, totalCredit, reason, Items = lines.Select(x => new { x.Item.Description, x.In.Quantity, x.In.Condition, x.Action }) });
        return (id, number, totalCredit);
    }

    /// <summary>What the customer will pay (or get back) for an exchange, before it is saved.</summary>
    public async Task<ExchangePreview> PreviewExchangeAsync(ExchangeInput input, decimal newInvoiceTotal)
    {
        await using var conn = await db.OpenAsync();
        var items = (await conn.QueryAsync<ItemRow>("select * from invoice_items where invoice_id = @OriginalInvoiceId", input)).ToDictionary(i => i.Id);
        var oldValue = input.ReturnLines.Where(l => l.Quantity > 0 && items.ContainsKey(l.InvoiceItemId))
            .Sum(l => Money.R2(items[l.InvoiceItemId].LineTotal * l.Quantity / items[l.InvoiceItemId].Quantity));
        var pos = await PaymentService.InvoicePositionAsync(conn, null, input.OriginalInvoiceId);
        var creditAvailable = Math.Max(0, pos.Paid - (pos.Net - oldValue));
        var applied = Math.Min(creditAvailable, newInvoiceTotal);
        return new ExchangePreview
        {
            OldValue = oldValue, NewValue = newInvoiceTotal, CreditAvailable = creditAvailable,
            Difference = newInvoiceTotal - applied, OldInvoiceOutstanding = Math.Max(0, pos.Balance - oldValue),
        };
    }

    /// <summary>
    /// Exchange = return old item(s) + new invoice, in one transaction. Money the customer already paid for
    /// the returned goods is applied to the new invoice; the customer pays only the difference.
    /// </summary>
    public async Task<Exchange> ExchangeAsync(ExchangeInput input)
    {
        session.Demand(Perm.ReturnManage);
        session.Demand(Perm.InvoiceCreate);
        return await db.InTransactionAsync(async (conn, tx) =>
        {
            var original = await conn.QuerySingleOrDefaultAsync<Invoice>("select * from invoices where id = @OriginalInvoiceId", input, tx)
                           ?? throw new NotFoundException("Invoice", input.OriginalInvoiceId);
            var number = await SequenceService.NextAsync(conn, tx, DocType.Exchange);
            var exchangeId = await conn.ExecuteScalarAsync<long>("""
                insert into exchanges (number, customer_id, original_invoice_id, old_value, new_value, difference, notes, created_by)
                values (@number, @CustomerId, @Id, 0, 0, 0, @notes, @uid) returning id
                """, new { number, original.CustomerId, original.Id, notes = input.Notes, uid = session.UserId }, tx);

            var ret = await CreateReturnAsync(conn, tx, new ReturnInput { InvoiceId = original.Id, Date = DateTime.Today, Lines = input.ReturnLines, Notes = $"Exchange {number}" },
                ReturnReason.Exchange, exchangeId);

            input.NewInvoice.CustomerId = original.CustomerId;
            input.NewInvoice.Id = 0;
            input.NewInvoice.Notes = string.Join(" ", new[] { input.NewInvoice.Notes, $"Exchange {number} against {original.Number}" }.Where(x => !string.IsNullOrWhiteSpace(x)));
            var newId = await invoices.SaveDraftAsync(conn, tx, input.NewInvoice);
            var result = await invoices.FinalizeAsync(conn, tx, newId, input.Payments, 0, creditFromInvoiceId: original.Id);

            var transferred = await conn.ExecuteScalarAsync<decimal>("""
                select coalesce(sum(a.amount),0) from payment_allocations a join payments p on p.id = a.payment_id and not p.is_voided
                where a.doc_type = 'INVOICE' and a.doc_id = @newId and a.note like 'Exchange credit%'
                """, new { newId }, tx);
            var newTotal = await conn.ExecuteScalarAsync<decimal>("select grand_total from invoices where id = @newId", new { newId }, tx);

            // Credit left over (new item cheaper than the old one): hold as advance, or refund in cash for walk-in customers.
            var oldPos = await PaymentService.InvoicePositionAsync(conn, tx, original.Id);
            var leftover = Math.Max(0, oldPos.Paid - oldPos.Net);
            if (leftover > 0)
            {
                var walkIn = await conn.ExecuteScalarAsync<bool>("select is_walk_in from customers where id = @CustomerId", original, tx);
                if (walkIn)
                {
                    session.Demand(Perm.PaymentRefund);
                    await payments.RecordAsync(conn, tx, PaymentDirection.Out, original.CustomerId, DateTime.Today,
                        new[] { new PaymentLineInput { MethodCode = PaymentMethodCode.Cash, Amount = leftover } },
                        new[] { new AllocationRequest(DocType.Invoice, original.Id, leftover, $"Exchange {number} refund") }, $"Exchange {number} refund");
                }
                else
                    await payments.TransferAsync(conn, tx, original.CustomerId, DocType.Invoice, original.Id, DocType.OnAccount, null, leftover,
                        $"Exchange {number} — balance credit kept as advance");
            }

            await conn.ExecuteAsync("""
                update exchanges set return_id = @retId, new_invoice_id = @newId, old_value = @oldValue, new_value = @newTotal,
                    transferred_amount = @transferred, difference = @diff where id = @exchangeId
                """, new { retId = ret.Id, newId, oldValue = ret.Credit, newTotal, transferred, diff = newTotal - transferred, exchangeId }, tx);
            await audit.LogAsync(conn, tx, "EXCHANGE", "Sales",
                $"recorded exchange {number}: returned {Money.Format(ret.Credit)} on {original.Number}, new invoice {result.InvoiceNumber} {Money.Format(newTotal)}, difference {Money.Format(newTotal - transferred)}",
                "exchange", exchangeId, number);
            return await GetExchangeAsync(conn, tx, exchangeId);
        });
    }

    private static async Task<Exchange> GetExchangeAsync(NpgsqlConnection conn, NpgsqlTransaction? tx, long id) =>
        await conn.QuerySingleAsync<Exchange>($"{ExchangeSelect} where e.id = @id", new { id }, tx);

    private const string ExchangeSelect = """
        select e.*, c.name as customer_name, oi.number as original_invoice_number, ni.number as new_invoice_number, r.number as return_number,
               u.full_name as created_by_name
        from exchanges e join customers c on c.id = e.customer_id join invoices oi on oi.id = e.original_invoice_id
        left join invoices ni on ni.id = e.new_invoice_id left join sales_returns r on r.id = e.return_id left join users u on u.id = e.created_by
        """;

    public async Task<PagedResult<SalesReturn>> ListAsync(ListQuery q)
    {
        session.Demand(Perm.ReturnView);
        var where = """
            where (@From::date is null or r.return_date >= @From::date) and (@To::date is null or r.return_date <= @To::date)
              and (@CustomerId::bigint is null or r.customer_id = @CustomerId)
              and (@Search::text is null or r.number ilike '%' || @Search || '%' or i.number ilike '%' || @Search || '%' or c.name ilike '%' || @Search || '%')
            """;
        var args = new { q.From, q.To, q.CustomerId, Search = Blank(q.Search), q.PageSize, q.Offset };
        const string from = "from sales_returns r join invoices i on i.id = r.invoice_id join customers c on c.id = r.customer_id left join users u on u.id = r.created_by";
        await using var conn = await db.OpenAsync();
        var total = await conn.ExecuteScalarAsync<int>($"select count(*) {from} {where}", args);
        var rows = await conn.QueryAsync<SalesReturn>($"select r.*, i.number as invoice_number, c.name as customer_name, u.full_name as created_by_name {from} {where} order by r.return_date desc, r.id desc limit @PageSize offset @Offset", args);
        return new PagedResult<SalesReturn> { Items = rows.AsList(), TotalCount = total, Page = q.Page, PageSize = q.PageSize };
    }

    public async Task<SalesReturn> GetAsync(long id)
    {
        session.Demand(Perm.ReturnView);
        await using var conn = await db.OpenAsync();
        var r = await conn.QuerySingleOrDefaultAsync<SalesReturn>("""
            select r.*, i.number as invoice_number, c.name as customer_name, u.full_name as created_by_name
            from sales_returns r join invoices i on i.id = r.invoice_id join customers c on c.id = r.customer_id left join users u on u.id = r.created_by where r.id = @id
            """, new { id }) ?? throw new NotFoundException("Return", id);
        r.Items = (await conn.QueryAsync<SalesReturnItem>("""
            select ri.*, ii.description from sales_return_items ri join invoice_items ii on ii.id = ri.invoice_item_id where ri.return_id = @id order by ri.id
            """, new { id })).AsList();
        return r;
    }

    public async Task<PagedResult<Exchange>> ListExchangesAsync(ListQuery q)
    {
        session.Demand(Perm.ReturnView);
        var where = "where (@Search::text is null or e.number ilike '%' || @Search || '%' or c.name ilike '%' || @Search || '%' or oi.number ilike '%' || @Search || '%')";
        var args = new { Search = Blank(q.Search), q.PageSize, q.Offset };
        await using var conn = await db.OpenAsync();
        var total = await conn.ExecuteScalarAsync<int>($"select count(*) from exchanges e join customers c on c.id = e.customer_id join invoices oi on oi.id = e.original_invoice_id {where}", args);
        var rows = await conn.QueryAsync<Exchange>($"{ExchangeSelect} {where} order by e.created_at desc limit @PageSize offset @Offset", args);
        return new PagedResult<Exchange> { Items = rows.AsList(), TotalCount = total, Page = q.Page, PageSize = q.PageSize };
    }

    private static string? Blank(string? s) => string.IsNullOrWhiteSpace(s) ? null : s.Trim();
}
