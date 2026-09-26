using Dapper;
using FurniShop.Core;
using FurniShop.Core.Domain;
using FurniShop.Core.Security;
using FurniShop.Infrastructure.Database;
using FurniShop.Infrastructure.Security;
using Npgsql;

namespace FurniShop.Infrastructure.Services;

public sealed class LifecycleDoc
{
    public string Kind { get; set; } = "";
    public long Id { get; set; }
    public string? Number { get; set; }
    public DateTime? Date { get; set; }
    public string? Status { get; set; }
    public decimal? Amount { get; set; }
    public string? Detail { get; set; }
}

public sealed class LifecycleStage
{
    public string Key { get; set; } = "";
    public string Label { get; set; } = "";
    /// <summary>done, active, pending or skipped.</summary>
    public string State { get; set; } = "pending";
    public string? Detail { get; set; }
    public string? Kind { get; set; }
    public long? Id { get; set; }
}

public sealed class LifecycleEvent
{
    public DateTime At { get; set; }
    public string Kind { get; set; } = "";
    public long Id { get; set; }
    public string? Number { get; set; }
    public string Title { get; set; } = "";
    public string? Detail { get; set; }
    public string? Status { get; set; }
}

public sealed class Lifecycle
{
    public long CustomerId { get; set; }
    public string CustomerName { get; set; } = "";
    public string? CustomerMobile { get; set; }
    public string Title { get; set; } = "";
    public decimal Total { get; set; }
    public decimal Paid { get; set; }
    public decimal Balance { get; set; }
    public List<LifecycleStage> Stages { get; set; } = new();
    public List<LifecycleEvent> Events { get; set; } = new();
    public Dictionary<string, List<LifecycleDoc>> Documents { get; set; } = new();
}

/// <summary>
/// Order 360°: from any quotation, sales order, invoice or custom order, follows the links to every related record —
/// lead, quotation, order, advance, production, invoice, payments, delivery, installation, warranty, service and returns.
/// </summary>
public sealed class LifecycleService(Db db, UserSession session)
{
    private sealed class Ids
    {
        public long? Quotation { get; set; }
        public long? SalesOrder { get; set; }
        public long? Invoice { get; set; }
        public long? CustomOrder { get; set; }
    }

    public async Task<Lifecycle> ForAsync(string kind, long id)
    {
        session.DemandAny(Perm.InvoiceView, Perm.SalesOrderView, Perm.QuotationView, Perm.CustomOrderView);
        await using var conn = await db.OpenAsync();
        var ids = await ResolveAsync(conn, kind.ToUpperInvariant(), id);
        var r = new Lifecycle();
        void Add(string key, IEnumerable<LifecycleDoc> docs) { var l = docs.ToList(); if (l.Count > 0) r.Documents[key] = l; }

        var q = ids.Quotation is { } qid ? await conn.QuerySingleOrDefaultAsync<LifecycleDoc>(
            "select 'QUOTATION' as kind, id, number, quote_date as date, status, grand_total as amount, null as detail from quotations where id = @qid", new { qid }) : null;
        var so = ids.SalesOrder is { } sid ? await conn.QuerySingleOrDefaultAsync<LifecycleDoc>(
            "select 'SALES_ORDER' as kind, id, number, order_date as date, status, grand_total as amount, case when expected_delivery_date is not null then 'Delivery by ' || to_char(expected_delivery_date, 'DD Mon YYYY') end as detail from sales_orders where id = @sid", new { sid }) : null;
        var co = ids.CustomOrder is { } cid ? await conn.QuerySingleOrDefaultAsync<LifecycleDoc>(
            "select 'CUSTOM_ORDER' as kind, id, number, order_date as date, status, coalesce(nullif(final_price, 0), estimated_cost) as amount, product_type as detail from custom_orders where id = @cid", new { cid }) : null;
        var inv = ids.Invoice is { } iid ? await conn.QuerySingleOrDefaultAsync<LifecycleDoc>(
            "select 'INVOICE' as kind, id, coalesce(number, 'Draft') as number, invoice_date as date, status, grand_total as amount, null as detail from invoices where id = @iid", new { iid }) : null;
        if (q is not null) Add("quotation", new[] { q });
        if (so is not null) Add("salesOrder", new[] { so });
        if (co is not null) Add("customOrder", new[] { co });
        if (inv is not null) Add("invoice", new[] { inv });

        // Customer
        var customerId = await conn.ExecuteScalarAsync<long>("""
            select coalesce((select customer_id from invoices where id = @Invoice), (select customer_id from sales_orders where id = @SalesOrder),
                            (select customer_id from custom_orders where id = @CustomOrder), (select customer_id from quotations where id = @Quotation))
            """, new { ids.Invoice, ids.SalesOrder, ids.CustomOrder, ids.Quotation });
        var cust = await conn.QuerySingleAsync<(string Name, string? Mobile)>("select name, mobile from customers where id = @customerId", new { customerId });
        r.CustomerId = customerId; r.CustomerName = cust.Name; r.CustomerMobile = cust.Mobile;

        var lead = await conn.QueryAsync<LifecycleDoc>("""
            select 'LEAD' as kind, id, number, created_at::date as date, status, expected_value as amount, interested_products as detail
            from leads where customer_id = @customerId or quotation_id = @Quotation order by id
            """, new { customerId, ids.Quotation });
        Add("leads", lead);

        var production = session.HasAny(Perm.ProductionView, Perm.CustomOrderView) && ids.CustomOrder is not null
            ? await conn.QueryAsync<LifecycleDoc>("select 'PRODUCTION_ORDER' as kind, id, number, created_at::date as date, status, null::numeric as amount, description as detail from production_orders where custom_order_id = @CustomOrder order by id", ids)
            : Enumerable.Empty<LifecycleDoc>();
        Add("production", production);

        var payments = await conn.QueryAsync<LifecycleDoc>("""
            select distinct on (p.id) 'PAYMENT' as kind, p.id, p.number, p.payment_date as date, case when p.is_voided then 'VOIDED' when p.direction = 'OUT' then 'REFUND' else 'PAID' end as status,
                   case when p.direction = 'OUT' then -p.amount else p.amount end as amount,
                   (select string_agg(pm.name, ' + ') from payment_lines pl join payment_methods pm on pm.code = pl.method_code where pl.payment_id = p.id) as detail
            from payment_allocations a join payments p on p.id = a.payment_id
            where (a.doc_type = 'INVOICE' and a.doc_id = @Invoice) or (a.doc_type = 'SALES_ORDER' and a.doc_id = @SalesOrder) or (a.doc_type = 'CUSTOM_ORDER' and a.doc_id = @CustomOrder)
            order by p.id
            """, ids);
        Add("payments", payments);

        var deliveries = await conn.QueryAsync<LifecycleDoc>("""
            select 'DELIVERY' as kind, id, number, coalesce(delivered_at::date, scheduled_date, created_at::date) as date, status, null::numeric as amount,
                   case when status = 'DELIVERED' then 'Received by ' || receiver_name else concat_ws(' · ', to_char(scheduled_date, 'DD Mon'), driver_name) end as detail
            from deliveries where invoice_id = @Invoice or sales_order_id = @SalesOrder or custom_order_id = @CustomOrder order by id
            """, ids);
        Add("deliveries", deliveries);
        var deliveryIds = deliveries.Select(d => d.Id).ToArray();

        var installs = await conn.QueryAsync<LifecycleDoc>("""
            select 'INSTALLATION' as kind, id, number, coalesce(completed_at::date, scheduled_date, created_at::date) as date, status, null::numeric as amount, technician_name as detail
            from installations where invoice_id = @Invoice or sales_order_id = @SalesOrder or custom_order_id = @CustomOrder or delivery_id = any(@deliveryIds) order by id
            """, new { ids.Invoice, ids.SalesOrder, ids.CustomOrder, deliveryIds });
        Add("installations", installs);

        var warranties = session.HasAny(Perm.WarrantyView, Perm.ServiceView)
            ? await conn.QueryAsync<LifecycleDoc>("""
                select 'WARRANTY' as kind, id, number, start_date as date,
                       case when is_void then 'VOID' when end_date < current_date then 'EXPIRED' when end_date <= current_date + 30 then 'EXPIRING' else 'ACTIVE' end as status,
                       null::numeric as amount, product_name || ' · until ' || to_char(end_date, 'DD Mon YYYY') as detail
                from warranties where invoice_id = @Invoice or custom_order_id = @CustomOrder order by id
                """, ids)
            : Enumerable.Empty<LifecycleDoc>();
        Add("warranties", warranties);
        var warrantyIds = warranties.Select(w => w.Id).ToArray();

        var tickets = session.Has(Perm.ServiceView)
            ? await conn.QueryAsync<LifecycleDoc>("""
                select 'SERVICE' as kind, id, number, created_at::date as date, status, nullif(service_charge, 0) as amount, issue as detail
                from service_tickets where invoice_id = @Invoice or warranty_id = any(@warrantyIds) order by id
                """, new { ids.Invoice, warrantyIds })
            : Enumerable.Empty<LifecycleDoc>();
        Add("service", tickets);

        var returns = ids.Invoice is not null && session.HasAny(Perm.ReturnView, Perm.InvoiceView)
            ? await conn.QueryAsync<LifecycleDoc>("select 'RETURN' as kind, id, number, return_date as date, reason as status, credit_amount as amount, notes as detail from sales_returns where invoice_id = @Invoice order by id", ids)
            : Enumerable.Empty<LifecycleDoc>();
        Add("returns", returns);

        // Money position
        var main = inv ?? so ?? co ?? q!;
        r.Title = co?.Detail is { } pt ? $"{pt} — {co.Number}" : main.Number ?? "";
        r.Total = inv?.Amount ?? so?.Amount ?? co?.Amount ?? q?.Amount ?? 0;
        r.Paid = payments.Where(p => p.Status is "PAID" or "REFUND").Sum(p => p.Amount ?? 0);
        if (inv is not null && inv.Status == InvoiceStatus.Final)
        {
            var pos = await PaymentService.InvoicePositionAsync(conn, null, inv.Id);
            r.Paid = pos.Paid; r.Balance = pos.Balance; r.Total = pos.Net;
        }
        else r.Balance = Math.Max(0, r.Total - r.Paid);

        // Stages
        string St(bool done, bool active = false) => done ? "done" : active ? "active" : "pending";
        var paidAdvance = payments.Any(p => p.Status == "PAID" && (p.Date ?? DateTime.MaxValue) <= (inv?.Date ?? DateTime.MaxValue));
        var invFinal = inv?.Status == InvoiceStatus.Final;
        var delivered = deliveries.Any(d => d.Status == DeliveryStatus.Delivered);
        var needsInstall = installs.Any();
        var installed = installs.Any(i => i.Status == InstallationStatus.Completed);
        r.Stages.Add(new LifecycleStage { Key = "QUOTATION", Label = "Quotation", State = q is null ? "skipped" : "done", Detail = q?.Number, Kind = q?.Kind, Id = q?.Id });
        r.Stages.Add(new LifecycleStage { Key = "ORDER", Label = co is not null ? "Custom order" : "Order", State = (so ?? co) is null ? (inv is not null ? "skipped" : "pending") : "done", Detail = (so ?? co)?.Number, Kind = (so ?? co)?.Kind, Id = (so ?? co)?.Id });
        r.Stages.Add(new LifecycleStage { Key = "ADVANCE", Label = "Advance", State = (so ?? co) is null ? "skipped" : St(paidAdvance), Detail = (so ?? co) is not null && paidAdvance ? "Received" : null });
        if (co is not null)
        {
            var prodDone = production.Any(p => p.Status == ProductionStatus.Completed) || co.Status is CustomOrderStatus.QualityCheck or CustomOrderStatus.Ready or CustomOrderStatus.Delivery or CustomOrderStatus.Installation or CustomOrderStatus.Completed;
            r.Stages.Add(new LifecycleStage { Key = "PRODUCTION", Label = "Production", State = St(prodDone, co.Status is CustomOrderStatus.Design or CustomOrderStatus.Production || production.Any()), Detail = production.FirstOrDefault()?.Number, Kind = production.FirstOrDefault()?.Kind, Id = production.FirstOrDefault()?.Id });
            r.Stages.Add(new LifecycleStage { Key = "QC", Label = "Quality check", State = St(co.Status is CustomOrderStatus.Ready or CustomOrderStatus.Delivery or CustomOrderStatus.Installation or CustomOrderStatus.Completed, co.Status == CustomOrderStatus.QualityCheck) });
        }
        r.Stages.Add(new LifecycleStage { Key = "INVOICE", Label = "Invoice", State = St(invFinal, inv is not null), Detail = inv?.Number, Kind = inv?.Kind, Id = inv?.Id });
        r.Stages.Add(new LifecycleStage { Key = "PAYMENT", Label = "Payment", State = invFinal ? St(r.Balance <= 0.5m, true) : "pending", Detail = invFinal ? (r.Balance <= 0.5m ? "Fully paid" : $"{Money.Format(r.Balance)} due") : null });
        r.Stages.Add(new LifecycleStage { Key = "DELIVERY", Label = "Delivery", State = deliveries.Any() ? St(delivered, true) : (invFinal ? "skipped" : "pending"), Detail = deliveries.FirstOrDefault()?.Number, Kind = deliveries.FirstOrDefault()?.Kind, Id = deliveries.FirstOrDefault()?.Id });
        r.Stages.Add(new LifecycleStage { Key = "INSTALLATION", Label = "Installation", State = needsInstall ? St(installed, true) : "skipped", Detail = installs.FirstOrDefault()?.Number, Kind = installs.FirstOrDefault()?.Kind, Id = installs.FirstOrDefault()?.Id });
        r.Stages.Add(new LifecycleStage { Key = "WARRANTY", Label = "Warranty", State = warranties.Any() ? "done" : "skipped", Detail = warranties.Any() ? $"{warranties.Count()} registered" : null, Kind = warranties.FirstOrDefault()?.Kind, Id = warranties.FirstOrDefault()?.Id });
        if (tickets.Any())
            r.Stages.Add(new LifecycleStage { Key = "SERVICE", Label = "Service", State = tickets.All(t => t.Status is ServiceStatus.Completed or ServiceStatus.Cancelled) ? "done" : "active", Detail = $"{tickets.Count()} ticket(s)", Kind = "SERVICE", Id = tickets.Last().Id });

        // Timeline: status history of every linked document plus money and stock events.
        var refs = new List<(string, long)>();
        if (q is not null) refs.Add((DocType.Quotation, q.Id));
        if (so is not null) refs.Add((DocType.SalesOrder, so.Id));
        if (co is not null) refs.Add((DocType.CustomOrder, co.Id));
        refs.AddRange(production.Select(p => (DocType.ProductionOrder, p.Id)));
        refs.AddRange(deliveries.Select(d => (DocType.Delivery, d.Id)));
        refs.AddRange(installs.Select(i => (DocType.Installation, i.Id)));
        refs.AddRange(tickets.Select(t => (DocType.Service, t.Id)));
        refs.AddRange(lead.Select(l => (DocType.Lead, l.Id)));
        var numbers = r.Documents.Values.SelectMany(x => x).ToDictionary(d => (d.Kind, d.Id), d => d.Number);
        foreach (var (docType, docId) in refs)
        {
            var hist = await conn.QueryAsync<StatusHistoryEntry>("""
                select h.*, u.full_name as changed_by_name from status_history h left join users u on u.id = h.changed_by
                where h.doc_type = @docType and h.doc_id = @docId order by h.changed_at
                """, new { docType, docId });
            foreach (var h in hist)
                r.Events.Add(new LifecycleEvent
                {
                    At = h.ChangedAt, Kind = docType, Id = docId, Number = numbers.GetValueOrDefault((docType, docId)), Status = h.ToStatus,
                    Title = $"{Label(docType)} {StatusStyle.Label(h.ToStatus).ToLowerInvariant()}", Detail = JoinBy(h.Note, h.ChangedByName),
                });
        }
        if (inv is not null)
        {
            var at = await conn.ExecuteScalarAsync<DateTime?>("select coalesce(finalized_at, created_at) from invoices where id = @Id", inv);
            r.Events.Add(new LifecycleEvent { At = at ?? DateTime.Now, Kind = "INVOICE", Id = inv.Id, Number = inv.Number, Status = inv.Status, Title = inv.Status == InvoiceStatus.Final ? $"Invoice issued for {Money.Format(inv.Amount ?? 0)}" : $"Invoice {inv.Status!.ToLowerInvariant()}" });
        }
        foreach (var p in payments)
            r.Events.Add(new LifecycleEvent { At = p.Date ?? DateTime.Today, Kind = "PAYMENT", Id = p.Id, Number = p.Number, Status = p.Status, Title = p.Status == "REFUND" ? $"Refund {Money.Format(-(p.Amount ?? 0))}" : p.Status == "VOIDED" ? "Payment voided" : $"Payment {Money.Format(p.Amount ?? 0)}", Detail = p.Detail });
        foreach (var w in warranties)
            r.Events.Add(new LifecycleEvent { At = w.Date ?? DateTime.Today, Kind = "WARRANTY", Id = w.Id, Number = w.Number, Status = w.Status, Title = "Warranty registered", Detail = w.Detail });
        foreach (var x in returns)
            r.Events.Add(new LifecycleEvent { At = x.Date ?? DateTime.Today, Kind = "RETURN", Id = x.Id, Number = x.Number, Status = "RETURN", Title = $"Return — credit {Money.Format(x.Amount ?? 0)}", Detail = StatusStyle.Label(x.Status ?? "") });
        r.Events = r.Events.OrderByDescending(e => e.At).ThenByDescending(e => e.Id).ToList();
        return r;
    }

    private static string? JoinBy(string? note, string? by) => string.IsNullOrWhiteSpace(note) ? by is null ? null : $"by {by}" : by is null ? note : $"{note} · {by}";

    private static string Label(string docType) => docType switch
    {
        DocType.Quotation => "Quotation", DocType.SalesOrder => "Order", DocType.CustomOrder => "Custom order", DocType.ProductionOrder => "Production",
        DocType.Delivery => "Delivery", DocType.Installation => "Installation", DocType.Service => "Service ticket", DocType.Lead => "Lead", _ => docType,
    };

    private static async Task<Ids> ResolveAsync(NpgsqlConnection conn, string kind, long id)
    {
        var ids = new Ids();
        switch (kind)
        {
            case "INVOICE":
                var i = await conn.QuerySingleOrDefaultAsync<(long? So, long? Q, long? Co)>("select sales_order_id, quotation_id, custom_order_id from invoices where id = @id", new { id });
                ids.Invoice = id; ids.SalesOrder = i.So; ids.Quotation = i.Q; ids.CustomOrder = i.Co;
                if (!await conn.ExecuteScalarAsync<bool>("select exists(select 1 from invoices where id = @id)", new { id })) throw new NotFoundException("Invoice", id);
                break;
            case "SALES_ORDER":
                var s = await conn.QuerySingleOrDefaultAsync<(long Id, long? Q, long? Inv)>("select id, quotation_id, invoice_id from sales_orders where id = @id", new { id });
                if (s.Id == 0) throw new NotFoundException("Sales order", id);
                ids.SalesOrder = id; ids.Quotation = s.Q; ids.Invoice = s.Inv;
                break;
            case "QUOTATION":
                var q = await conn.QuerySingleOrDefaultAsync<(long Id, long? So)>("select id, sales_order_id from quotations where id = @id", new { id });
                if (q.Id == 0) throw new NotFoundException("Quotation", id);
                ids.Quotation = id; ids.SalesOrder = q.So;
                if (q.So is { } so) ids.Invoice = await conn.ExecuteScalarAsync<long?>("select invoice_id from sales_orders where id = @so", new { so });
                break;
            case "CUSTOM_ORDER":
                var c = await conn.QuerySingleOrDefaultAsync<(long Id, long? Inv)>("select id, invoice_id from custom_orders where id = @id", new { id });
                if (c.Id == 0) throw new NotFoundException("Custom order", id);
                ids.CustomOrder = id; ids.Invoice = c.Inv;
                break;
            default:
                throw new ValidationException("Kind", "Open the 360° view from a quotation, order, custom order or invoice.");
        }
        // An invoice cancelled and re-issued: follow the latest final invoice of the order.
        if (ids.Invoice is null && (ids.SalesOrder ?? ids.CustomOrder) is not null)
            ids.Invoice = await conn.ExecuteScalarAsync<long?>("select id from invoices where (sales_order_id = @SalesOrder or custom_order_id = @CustomOrder) order by (status = 'FINAL') desc, id desc limit 1", new { ids.SalesOrder, ids.CustomOrder });
        return ids;
    }
}
