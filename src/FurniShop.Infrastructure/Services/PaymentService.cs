using Dapper;
using FurniShop.Core;
using FurniShop.Core.Domain;
using FurniShop.Core.Security;
using FurniShop.Infrastructure.Database;
using FurniShop.Infrastructure.Security;
using Npgsql;

namespace FurniShop.Infrastructure.Services;

public sealed record AllocationRequest(string DocType, long? DocId, decimal Amount, string? Note = null);

/// <summary>
/// Customer money. A payment (receipt) can be split across methods (cash + UPI + card) and allocated
/// to invoices, sales orders (advances), custom orders (advances) or held on account.
/// Payments are never edited or deleted: corrections are voids (permission payment.void) and every
/// action is audited. Moving an advance to an invoice inserts a −/+ allocation pair on the same payment.
/// </summary>
public sealed class PaymentService(Db db, UserSession session, AuditService audit)
{
    // ------------------------------------------------------------------ balances
    /// <summary>Net money applied to a document (IN − OUT) from non-voided payments.</summary>
    internal static Task<decimal> PaidAsync(NpgsqlConnection conn, NpgsqlTransaction? tx, string docType, long? docId, long? customerId = null) =>
        conn.ExecuteScalarAsync<decimal>("""
            select coalesce(sum(case when p.direction = 'IN' then a.amount else -a.amount end), 0)
            from payment_allocations a join payments p on p.id = a.payment_id and not p.is_voided
            where a.doc_type = @docType
              and ((@docId::bigint is null and a.doc_id is null) or a.doc_id = @docId)
              and (@customerId::bigint is null or p.customer_id = @customerId)
            """, new { docType, docId, customerId }, tx);

    internal static async Task<(decimal Net, decimal Paid, decimal Balance)> InvoicePositionAsync(NpgsqlConnection conn, NpgsqlTransaction? tx, long invoiceId)
    {
        var r = await conn.QuerySingleOrDefaultAsync<(decimal Net, decimal Paid, decimal Balance)>(
            "select net_total, paid, balance from v_invoice_balances where invoice_id = @invoiceId", new { invoiceId }, tx);
        return r;
    }

    public async Task<decimal> OnAccountBalanceAsync(long customerId)
    {
        await using var conn = await db.OpenAsync();
        return await PaidAsync(conn, null, DocType.OnAccount, null, customerId);
    }

    // ------------------------------------------------------------------ recording
    internal async Task<(long Id, string Number)> RecordAsync(NpgsqlConnection conn, NpgsqlTransaction tx, string direction, long customerId,
        DateTime date, IReadOnlyList<PaymentLineInput> lines, IReadOnlyList<AllocationRequest> allocations, string? notes)
    {
        var moneyMethods = (await conn.QueryAsync<(string Code, bool IsMoney, bool IsActive)>("select code, is_money, is_active from payment_methods", transaction: tx))
            .ToDictionary(m => m.Code);
        foreach (var l in lines)
        {
            if (l.Amount <= 0) throw new ValidationException("Payments", "Payment amounts must be greater than zero.");
            if (!moneyMethods.TryGetValue(l.MethodCode, out var m) || !m.IsMoney) throw new ValidationException("Payments", $"'{l.MethodCode}' is not a valid payment method.");
            if (!m.IsActive) throw new ValidationException("Payments", $"Payment method {l.MethodCode} is disabled in Settings.");
            if (l.MethodCode == PaymentMethodCode.Cheque && string.IsNullOrWhiteSpace(l.Reference)) throw new ValidationException("Payments", "Enter the cheque number.");
            if (Money.R2(l.Amount) != l.Amount) throw new ValidationException("Payments", "Amounts can have at most 2 decimals.");
        }
        var total = lines.Sum(l => l.Amount);
        if (total <= 0) throw new ValidationException("Payments", "Enter an amount.");
        if (allocations.Sum(a => a.Amount) != total) throw new InvalidOperationException("Allocations must equal the payment total.");
        if (date.Date > DateTime.Today) throw new ValidationException("Date", "Payment date cannot be in the future.");

        var number = await SequenceService.NextAsync(conn, tx, direction == PaymentDirection.In ? DocType.Payment : DocType.Refund, date);
        var id = await conn.ExecuteScalarAsync<long>("""
            insert into payments (number, direction, customer_id, payment_date, amount, notes, created_by)
            values (@number, @direction, @customerId, @date, @total, @notes, @uid) returning id
            """, new { number, direction, customerId, date = date.Date, total, notes, uid = session.UserId }, tx);
        foreach (var l in lines)
            await conn.ExecuteAsync("""
                insert into payment_lines (payment_id, method_code, amount, reference, cheque_date, bank_name)
                values (@id, @MethodCode, @Amount, @Reference, @ChequeDate, @BankName)
                """, new { id, l.MethodCode, l.Amount, Reference = Core.Validation.Validators.Clean(l.Reference), l.ChequeDate, l.BankName }, tx);
        foreach (var a in allocations.Where(a => a.Amount != 0))
            await InsertAllocationAsync(conn, tx, id, a.DocType, a.DocId, a.Amount, a.Note);

        var methods = string.Join(", ", lines.Select(l => $"{l.MethodCode} {Money.Format(l.Amount)}"));
        await audit.LogAsync(conn, tx, direction == PaymentDirection.In ? "RECEIVE" : "REFUND", "Payments",
            $"{(direction == PaymentDirection.In ? "recorded payment" : "paid refund")} {number} of {Money.Format(total)} ({methods})",
            "payment", id, number, null, new { customerId, total, lines, allocations });
        return (id, number);
    }

    private Task InsertAllocationAsync(NpgsqlConnection conn, NpgsqlTransaction tx, long paymentId, string docType, long? docId, decimal amount, string? note) =>
        conn.ExecuteAsync("""
            insert into payment_allocations (payment_id, doc_type, doc_id, amount, note, created_by)
            values (@paymentId, @docType, @docId, @amount, @note, @uid)
            """, new { paymentId, docType, docId = docType == DocType.OnAccount ? null : docId, amount, note, uid = session.UserId }, tx);

    /// <summary>
    /// Moves money already received from one document to another (advance → invoice, invoice → on account…)
    /// by inserting a negative and a positive allocation on each source payment. Returns the amount moved.
    /// </summary>
    internal async Task<decimal> TransferAsync(NpgsqlConnection conn, NpgsqlTransaction tx, long customerId,
        string fromType, long? fromId, string toType, long? toId, decimal amount, string note)
    {
        if (amount <= 0) return 0;
        var available = await PaidAsync(conn, tx, fromType, fromId, customerId);
        amount = Math.Min(amount, available);
        if (amount <= 0) return 0;

        var sources = await conn.QueryAsync<(long PaymentId, decimal Net)>("""
            select a.payment_id, sum(a.amount) as net
            from payment_allocations a join payments p on p.id = a.payment_id and not p.is_voided and p.direction = 'IN'
            where p.customer_id = @customerId and a.doc_type = @fromType
              and ((@fromId::bigint is null and a.doc_id is null) or a.doc_id = @fromId)
            group by a.payment_id having sum(a.amount) > 0
            order by min(p.payment_date), a.payment_id
            """, new { customerId, fromType, fromId }, tx);

        var remaining = amount;
        foreach (var (paymentId, net) in sources)
        {
            if (remaining <= 0) break;
            var take = Math.Min(net, remaining);
            await InsertAllocationAsync(conn, tx, paymentId, fromType, fromId, -take, note);
            await InsertAllocationAsync(conn, tx, paymentId, toType, toId, take, note);
            remaining -= take;
        }
        return amount - remaining;
    }

    /// <summary>
    /// Works out where incoming money goes. Anything beyond what the target document needs is
    /// kept on account as customer advance, so a balance never goes negative.
    /// </summary>
    internal static async Task<List<AllocationRequest>> PlanAllocationsAsync(NpgsqlConnection conn, NpgsqlTransaction tx, long customerId,
        string? docType, long? docId, decimal amount)
    {
        var plan = new List<AllocationRequest>();
        var remaining = amount;

        // An order that has been invoiced takes further money on its invoice.
        if (docType == DocType.SalesOrder && docId.HasValue)
        {
            var inv = await conn.ExecuteScalarAsync<long?>("select invoice_id from sales_orders where id = @docId", new { docId }, tx);
            if (inv.HasValue) { docType = DocType.Invoice; docId = inv; }
        }
        if (docType == DocType.CustomOrder && docId.HasValue)
        {
            var inv = await conn.ExecuteScalarAsync<long?>("select invoice_id from custom_orders where id = @docId", new { docId }, tx);
            if (inv.HasValue) { docType = DocType.Invoice; docId = inv; }
        }

        switch (docType)
        {
            case DocType.Invoice:
            {
                var inv = await conn.QuerySingleOrDefaultAsync<(long CustomerId, string Status)>("select customer_id, status from invoices where id = @docId for update", new { docId }, tx);
                if (inv.Status != InvoiceStatus.Final) throw new BusinessRuleException("Payments can only be received against a finalised invoice.");
                if (inv.CustomerId != customerId) throw new BusinessRuleException("The invoice belongs to a different customer.");
                var pos = await InvoicePositionAsync(conn, tx, docId!.Value);
                var take = Math.Min(remaining, Math.Max(0, pos.Balance));
                if (take > 0) { plan.Add(new(DocType.Invoice, docId, take)); remaining -= take; }
                break;
            }
            case DocType.SalesOrder:
            {
                var so = await conn.QuerySingleOrDefaultAsync<(long CustomerId, string Status, decimal GrandTotal)>(
                    "select customer_id, status, grand_total from sales_orders where id = @docId for update", new { docId }, tx);
                if (so.Status is null) throw new NotFoundException("Sales order", docId!);
                if (so.Status == SalesOrderStatus.Cancelled) throw new BusinessRuleException("The sales order is cancelled.");
                if (so.CustomerId != customerId) throw new BusinessRuleException("The order belongs to a different customer.");
                var paid = await PaidAsync(conn, tx, DocType.SalesOrder, docId);
                var take = Math.Min(remaining, Math.Max(0, so.GrandTotal - paid));
                if (take > 0) { plan.Add(new(DocType.SalesOrder, docId, take, "Advance")); remaining -= take; }
                break;
            }
            case DocType.CustomOrder:
            {
                var co = await conn.QuerySingleOrDefaultAsync<(long CustomerId, string Status, decimal FinalPrice, decimal EstimatedCost)>(
                    "select customer_id, status, final_price, estimated_cost from custom_orders where id = @docId for update", new { docId }, tx);
                if (co.Status is null) throw new NotFoundException("Custom order", docId!);
                if (co.Status == CustomOrderStatus.Cancelled) throw new BusinessRuleException("The custom order is cancelled.");
                if (co.CustomerId != customerId) throw new BusinessRuleException("The order belongs to a different customer.");
                var price = co.FinalPrice > 0 ? co.FinalPrice : co.EstimatedCost;
                var paid = await PaidAsync(conn, tx, DocType.CustomOrder, docId);
                var take = Math.Min(remaining, Math.Max(0, price - paid));
                if (take > 0) { plan.Add(new(DocType.CustomOrder, docId, take, "Advance")); remaining -= take; }
                break;
            }
            case null:
            {
                var open = await conn.QueryAsync<(long InvoiceId, decimal Balance)>("""
                    select invoice_id, balance from v_invoice_balances where customer_id = @customerId and balance > 0
                    order by coalesce(due_date, invoice_date), invoice_date, invoice_id
                    """, new { customerId }, tx);
                foreach (var (invoiceId, balance) in open)
                {
                    if (remaining <= 0) break;
                    var take = Math.Min(remaining, balance);
                    plan.Add(new(DocType.Invoice, invoiceId, take));
                    remaining -= take;
                }
                break;
            }
            default:
                throw new ValidationException("DocType", "Unknown document type.");
        }
        if (remaining > 0) plan.Add(new(DocType.OnAccount, null, remaining, "Excess held as customer advance"));
        return plan;
    }

    // ------------------------------------------------------------------ public operations
    public async Task<(long Id, string Number)> ReceiveAsync(PaymentInput input)
    {
        session.Demand(Perm.PaymentReceive);
        return await db.InTransactionAsync(async (conn, tx) =>
        {
            var customer = await conn.QuerySingleOrDefaultAsync<Customer>("select * from customers where id = @CustomerId and not is_deleted", input, tx)
                           ?? throw new ValidationException("CustomerId", "Select a customer.");
            var lines = input.Lines.Where(l => l.Amount != 0).ToList();
            var plan = await PlanAllocationsAsync(conn, tx, customer.Id, input.DocType, input.DocId, lines.Sum(l => l.Amount));
            if (customer.IsWalkIn && plan.Any(p => p.DocType != DocType.Invoice))
                throw new BusinessRuleException("Advances cannot be held for the walk-in customer. Create a customer profile first.");
            return await RecordAsync(conn, tx, PaymentDirection.In, customer.Id, input.Date, lines, plan, input.Notes);
        });
    }

    /// <summary>Applies advance money held on account (or on an order) to an invoice.</summary>
    public async Task<decimal> ApplyAdvanceAsync(long customerId, long invoiceId, decimal amount)
    {
        session.Demand(Perm.PaymentReceive);
        return await db.InTransactionAsync(async (conn, tx) =>
        {
            var pos = await InvoicePositionAsync(conn, tx, invoiceId);
            var moved = await TransferAsync(conn, tx, customerId, DocType.OnAccount, null, DocType.Invoice, invoiceId,
                Math.Min(amount, Math.Max(0, pos.Balance)), "Advance adjusted against invoice");
            if (moved <= 0) throw new BusinessRuleException("No advance is available to adjust.");
            var number = await conn.ExecuteScalarAsync<string>("select number from invoices where id = @invoiceId", new { invoiceId }, tx);
            await audit.LogAsync(conn, tx, "ALLOCATE", "Payments", $"adjusted advance {Money.Format(moved)} against {number}", "invoice", invoiceId, number);
            return moved;
        });
    }

    /// <summary>Refund money the shop holds for the customer (on-account advance or an overpaid invoice).</summary>
    public async Task<(long Id, string Number)> RefundAsync(long customerId, decimal amount, PaymentLineInput method, string? notes,
        string docType = DocType.OnAccount, long? docId = null)
    {
        session.Demand(Perm.PaymentRefund);
        return await db.InTransactionAsync(async (conn, tx) =>
        {
            decimal available;
            if (docType == DocType.Invoice)
            {
                var pos = await InvoicePositionAsync(conn, tx, docId!.Value);
                available = Math.Max(0, pos.Paid - pos.Net);
            }
            else available = await PaidAsync(conn, tx, docType, docId, customerId);
            if (amount <= 0) throw new ValidationException("Amount", "Enter the refund amount.");
            if (amount > available) throw new BusinessRuleException($"Only {Money.Format(available)} can be refunded.");
            method.Amount = amount;
            return await RecordAsync(conn, tx, PaymentDirection.Out, customerId, DateTime.Today, new[] { method },
                new[] { new AllocationRequest(docType, docId, amount, "Refund") }, notes);
        });
    }

    public async Task VoidAsync(long paymentId, string reason)
    {
        session.Demand(Perm.PaymentVoid);
        if (string.IsNullOrWhiteSpace(reason)) throw new ValidationException("Reason", "Enter the reason for voiding this payment.");
        await db.InTransactionAsync(async (conn, tx) =>
        {
            var p = await conn.QuerySingleOrDefaultAsync<Payment>("select * from payments where id = @paymentId for update", new { paymentId }, tx)
                    ?? throw new NotFoundException("Payment", paymentId);
            if (p.IsVoided) throw new BusinessRuleException("This payment is already voided.");

            if (p.Direction == PaymentDirection.In)
            {
                // Voiding must not leave an advance negative (e.g. advance already refunded).
                var touched = await conn.QueryAsync<(string DocType, long? DocId, decimal Net)>("""
                    select doc_type, doc_id, sum(amount) from payment_allocations where payment_id = @paymentId group by doc_type, doc_id having sum(amount) <> 0
                    """, new { paymentId }, tx);
                foreach (var t in touched.Where(t => t.DocType != DocType.Invoice))
                {
                    var paid = await PaidAsync(conn, tx, t.DocType, t.DocId, p.CustomerId);
                    if (paid - t.Net < 0)
                        throw new BusinessRuleException("This payment's advance has already been refunded or used. Void the refund first.");
                }
            }
            await conn.ExecuteAsync("update payments set is_voided = true, voided_by = @uid, voided_at = now(), void_reason = @reason where id = @paymentId",
                new { uid = session.UserId, reason = reason.Trim(), paymentId }, tx);
            await audit.LogAsync(conn, tx, "VOID", "Payments", $"voided payment {p.Number} of {Money.Format(p.Amount)} — {reason}",
                "payment", paymentId, p.Number, new { p.Amount, p.IsVoided }, new { IsVoided = true, Reason = reason });
        });
    }

    // ------------------------------------------------------------------ queries
    private const string ListSelect = """
        select p.*, c.name as customer_name, c.mobile as customer_mobile, u.full_name as created_by_name,
               (select string_agg(pm.name || case when l.reference is not null then ' #' || l.reference else '' end, ' + ' order by l.id)
                from payment_lines l join payment_methods pm on pm.code = l.method_code where l.payment_id = p.id) as methods,
               (select string_agg(distinct coalesce(i.number, so.number, co.number, 'On account'), ', ')
                from payment_allocations a
                left join invoices i on a.doc_type = 'INVOICE' and i.id = a.doc_id
                left join sales_orders so on a.doc_type = 'SALES_ORDER' and so.id = a.doc_id
                left join custom_orders co on a.doc_type = 'CUSTOM_ORDER' and co.id = a.doc_id
                where a.payment_id = p.id and a.amount > 0) as applied_to
        from payments p join customers c on c.id = p.customer_id left join users u on u.id = p.created_by
        """;

    public async Task<PagedResult<Payment>> ListAsync(ListQuery q, string? method = null)
    {
        session.Demand(Perm.PaymentView);
        var where = """
            where (@From::date is null or p.payment_date >= @From::date) and (@To::date is null or p.payment_date <= @To::date)
              and (@CustomerId::bigint is null or p.customer_id = @CustomerId)
              and (@Status::text is null or (@Status = 'VOIDED' and p.is_voided) or (@Status = 'REFUND' and p.direction = 'OUT' and not p.is_voided)
                   or (@Status = 'RECEIVED' and p.direction = 'IN' and not p.is_voided))
              and (@Method::text is null or exists (select 1 from payment_lines l where l.payment_id = p.id and l.method_code = @Method))
              and (@Search::text is null or p.number ilike '%' || @Search || '%' or c.name ilike '%' || @Search || '%' or c.mobile like '%' || @Search || '%')
            """;
        var args = new { q.From, q.To, q.CustomerId, q.Status, Method = method, Search = Blank(q.Search), q.PageSize, q.Offset };
        await using var conn = await db.OpenAsync();
        var total = await conn.ExecuteScalarAsync<int>($"select count(*) from payments p join customers c on c.id = p.customer_id {where}", args);
        var rows = await conn.QueryAsync<Payment>($"{ListSelect} {where} order by p.payment_date desc, p.id desc limit @PageSize offset @Offset", args);
        return new PagedResult<Payment> { Items = rows.AsList(), TotalCount = total, Page = q.Page, PageSize = q.PageSize };
    }

    public async Task<Payment> GetAsync(long id)
    {
        session.DemandAny(Perm.PaymentView, Perm.PaymentReceive);
        await using var conn = await db.OpenAsync();
        var p = await conn.QuerySingleOrDefaultAsync<Payment>($"{ListSelect} where p.id = @id", new { id }) ?? throw new NotFoundException("Payment", id);
        p.Lines = (await conn.QueryAsync<PaymentLine>("select * from payment_lines where payment_id = @id order by id", new { id })).AsList();
        p.Allocations = (await conn.QueryAsync<PaymentAllocation>("""
            select a.*, coalesce(i.number, so.number, co.number, 'On account') as doc_number
            from payment_allocations a
            left join invoices i on a.doc_type = 'INVOICE' and i.id = a.doc_id
            left join sales_orders so on a.doc_type = 'SALES_ORDER' and so.id = a.doc_id
            left join custom_orders co on a.doc_type = 'CUSTOM_ORDER' and co.id = a.doc_id
            where a.payment_id = @id order by a.id
            """, new { id })).AsList();
        return p;
    }

    /// <summary>All payments touching a document (for invoice / order payment history).</summary>
    public async Task<IReadOnlyList<Payment>> ForDocumentAsync(string docType, long docId)
    {
        await using var conn = await db.OpenAsync();
        return (await conn.QueryAsync<Payment>($"""
            {ListSelect} where p.id in (select payment_id from payment_allocations where doc_type = @docType and doc_id = @docId)
            order by p.payment_date, p.id
            """, new { docType, docId })).AsList();
    }

    private static string? Blank(string? s) => string.IsNullOrWhiteSpace(s) ? null : s.Trim();
}
