using Dapper;
using FurniShop.Core.Domain;
using FurniShop.Core.Security;
using FurniShop.Infrastructure.Database;
using FurniShop.Infrastructure.Security;

namespace FurniShop.Infrastructure.Services;

public sealed record ChartPoint(string Label, decimal Value);

public sealed class DashboardData
{
    public decimal TodaySales { get; set; }
    public int TodayInvoices { get; set; }
    public decimal TodayCollections { get; set; }
    public int PendingPaymentInvoices { get; set; }
    public decimal TotalOutstanding { get; set; }
    public decimal OverdueAmount { get; set; }
    public decimal AdvancesHeld { get; set; }
    public int PendingDeliveries { get; set; }
    public int TodayDeliveries { get; set; }
    public int PendingCustomOrders { get; set; }
    public int OverdueCustomOrders { get; set; }
    public int LowStockCount { get; set; }
    public int OutOfStockCount { get; set; }
    public decimal ReservedUnits { get; set; }
    public decimal MonthSales { get; set; }
    public decimal LastMonthSales { get; set; }
    /// <summary>Null when the user cannot see cost / profit.</summary>
    public decimal? MonthGrossProfit { get; set; }
    public decimal? MonthNetProfit { get; set; }
    public int OpenSalesOrders { get; set; }
    public int OpenQuotations { get; set; }
    public List<ChartPoint> SalesLast30Days { get; set; } = new();
    public List<ChartPoint> SalesByCategory { get; set; } = new();
    public List<ChartPoint> PaymentMethods { get; set; } = new();
    public List<ChartPoint> TopProducts { get; set; } = new();
    public List<ChartPoint> MonthlyRevenue { get; set; } = new();
    public List<ChartPoint> MonthlyProfit { get; set; } = new();
    public List<InvoiceListItem> RecentInvoices { get; set; } = new();
    public List<Customer> RecentCustomers { get; set; } = new();
    public List<Payment> RecentPayments { get; set; } = new();
    public List<InventoryRow> LowStock { get; set; } = new();
}

public sealed class DashboardService(Db db, UserSession session)
{
    public async Task<DashboardData> LoadAsync()
    {
        session.Demand(Perm.DashboardView);
        var cost = session.CanSeeCost;
        await using var conn = await db.OpenAsync();
        var d = await conn.QuerySingleAsync<DashboardData>("""
            select
              coalesce((select sum(grand_total) from invoices where status = 'FINAL' and invoice_date = current_date),0) as today_sales,
              (select count(*) from invoices where status = 'FINAL' and invoice_date = current_date) as today_invoices,
              coalesce((select sum(case when direction='IN' then amount else -amount end) from payments where not is_voided and payment_date = current_date),0) as today_collections,
              (select count(*) from v_invoice_balances where balance > 0) as pending_payment_invoices,
              coalesce((select sum(balance) from v_invoice_balances where balance > 0),0) as total_outstanding,
              coalesce((select sum(balance) from v_invoice_balances where balance > 0 and due_date < current_date),0) as overdue_amount,
              coalesce((select sum(case when p.direction='IN' then a.amount else -a.amount end) from payment_allocations a
                        join payments p on p.id = a.payment_id and not p.is_voided where a.doc_type <> 'INVOICE'),0) as advances_held,
              (select count(*) from deliveries where status in ('PENDING','SCHEDULED','OUT_FOR_DELIVERY')) as pending_deliveries,
              (select count(*) from deliveries where status in ('SCHEDULED','OUT_FOR_DELIVERY') and scheduled_date = current_date) as today_deliveries,
              (select count(*) from custom_orders where status not in ('COMPLETED','CANCELLED')) as pending_custom_orders,
              (select count(*) from custom_orders where status not in ('COMPLETED','CANCELLED') and expected_completion_date < current_date) as overdue_custom_orders,
              (select count(*) from v_inventory where is_stock_item and product_status = 'ACTIVE' and available > 0 and available <= min_stock) as low_stock_count,
              (select count(*) from v_inventory where is_stock_item and product_status = 'ACTIVE' and available <= 0) as out_of_stock_count,
              coalesce((select sum(reserved) from inventory),0) as reserved_units,
              coalesce((select sum(grand_total) from invoices where status = 'FINAL' and invoice_date >= date_trunc('month', current_date)),0) as month_sales,
              coalesce((select sum(grand_total) from invoices where status = 'FINAL' and invoice_date >= date_trunc('month', current_date) - interval '1 month'
                        and invoice_date < date_trunc('month', current_date)),0) as last_month_sales,
              (select count(*) from sales_orders where status not in ('COMPLETED','CANCELLED','DRAFT')) as open_sales_orders,
              (select count(*) from quotations where status in ('DRAFT','SENT','CONFIRMED')) as open_quotations
            """);

        if (cost)
        {
            var p = await conn.QuerySingleAsync<(decimal Gross, decimal Expenses)>("""
                select coalesce((select sum(taxable_total - cost_total) from invoices where status = 'FINAL' and invoice_date >= date_trunc('month', current_date)),0),
                       coalesce((select sum(amount) from expenses where not is_deleted and expense_date >= date_trunc('month', current_date)),0)
                """);
            d.MonthGrossProfit = p.Gross;
            d.MonthNetProfit = p.Gross - p.Expenses;
        }

        d.SalesLast30Days = (await conn.QueryAsync<ChartPoint>("""
            select to_char(g::date, 'DD Mon') as label, coalesce(sum(i.grand_total),0) as value
            from generate_series(current_date - 29, current_date, interval '1 day') g
            left join invoices i on i.invoice_date = g::date and i.status = 'FINAL'
            group by g order by g
            """)).AsList();
        d.SalesByCategory = (await conn.QueryAsync<ChartPoint>("""
            select coalesce(c.name, 'Custom') as label, sum(it.line_total) as value
            from invoices i join invoice_items it on it.invoice_id = i.id left join product_variants v on v.id = it.variant_id
            left join products p on p.id = v.product_id left join categories c on c.id = p.category_id
            where i.status = 'FINAL' and i.invoice_date >= current_date - 90 group by 1 order by 2 desc limit 8
            """)).AsList();
        d.PaymentMethods = (await conn.QueryAsync<ChartPoint>("""
            select pm.name as label, sum(l.amount) as value from payments p join payment_lines l on l.payment_id = p.id join payment_methods pm on pm.code = l.method_code
            where not p.is_voided and p.direction = 'IN' and p.payment_date >= date_trunc('month', current_date) group by pm.name, pm.sort_order order by pm.sort_order
            """)).AsList();
        d.TopProducts = (await conn.QueryAsync<ChartPoint>("""
            select coalesce(p.name, it.description) as label, sum(it.quantity) as value
            from invoices i join invoice_items it on it.invoice_id = i.id left join product_variants v on v.id = it.variant_id left join products p on p.id = v.product_id
            where i.status = 'FINAL' and i.invoice_date >= current_date - 90 group by 1 order by 2 desc limit 6
            """)).AsList();
        d.MonthlyRevenue = (await conn.QueryAsync<ChartPoint>("""
            select to_char(m, 'Mon YY') as label, coalesce(sum(i.grand_total),0) as value
            from generate_series(date_trunc('month', current_date) - interval '11 months', date_trunc('month', current_date), interval '1 month') m
            left join invoices i on date_trunc('month', i.invoice_date) = m and i.status = 'FINAL' group by m order by m
            """)).AsList();
        if (cost)
            d.MonthlyProfit = (await conn.QueryAsync<ChartPoint>("""
                select to_char(m, 'Mon YY') as label,
                       coalesce((select sum(taxable_total - cost_total) from invoices i where i.status = 'FINAL' and date_trunc('month', i.invoice_date) = m),0)
                     - coalesce((select sum(amount) from expenses e where not e.is_deleted and date_trunc('month', e.expense_date) = m),0) as value
                from generate_series(date_trunc('month', current_date) - interval '11 months', date_trunc('month', current_date), interval '1 month') m order by m
                """)).AsList();

        if (session.Has(Perm.InvoiceView))
            d.RecentInvoices = (await conn.QueryAsync<InvoiceListItem>("""
                select i.id, i.number, i.status, i.invoice_date, i.due_date, i.customer_id, i.customer_name, i.grand_total,
                       coalesce(b.returned_amount,0) as returned_amount, coalesce(b.paid,0) as paid, coalesce(b.balance,0) as balance
                from invoices i left join v_invoice_balances b on b.invoice_id = i.id where i.status <> 'DRAFT'
                order by coalesce(i.finalized_at, i.created_at) desc limit 8
                """)).AsList();
        if (session.Has(Perm.CustomerView))
            d.RecentCustomers = (await conn.QueryAsync<Customer>("select * from customers where not is_deleted and not is_walk_in order by created_at desc limit 6")).AsList();
        if (session.Has(Perm.PaymentView))
            d.RecentPayments = (await conn.QueryAsync<Payment>("""
                select p.*, c.name as customer_name,
                       (select string_agg(pm.name, ' + ') from payment_lines l join payment_methods pm on pm.code = l.method_code where l.payment_id = p.id) as methods
                from payments p join customers c on c.id = p.customer_id order by p.created_at desc limit 8
                """)).AsList();
        if (session.Has(Perm.InventoryView))
            d.LowStock = (await conn.QueryAsync<InventoryRow>("""
                select * from v_inventory where is_stock_item and product_status = 'ACTIVE' and available <= min_stock order by available, product_name limit 8
                """)).AsList();
        if (!cost) d.LowStock.ForEach(r => r.CostPrice = null);
        return d;
    }
}

/// <summary>Global search across products, customers, documents and suppliers — only in modules the user can see.</summary>
public sealed class SearchService(Db db, UserSession session)
{
    public async Task<IReadOnlyList<SearchResult>> SearchAsync(string text, int perKind = 6)
    {
        if (!session.IsAuthenticated || string.IsNullOrWhiteSpace(text) || text.Trim().Length < 2) return Array.Empty<SearchResult>();
        var t = text.Trim();
        var parts = new List<string>();
        if (session.Has(Perm.ProductView))
            parts.Add("""
                (select 'Product' as kind, p.id, p.name || case when v.variant_name <> 'Standard' then ' — ' || v.variant_name else '' end as title,
                        v.sku || coalesce(' · ' || v.barcode, '') as subtitle, p.status as status
                 from product_variants v join products p on p.id = v.product_id
                 where not v.is_deleted and not p.is_deleted and (p.name ilike '%' || @t || '%' or v.sku ilike '%' || @t || '%' or v.barcode = @t or p.code ilike @t)
                 order by p.name limit @n)
                """);
        if (session.HasAny(Perm.CustomerView, Perm.InvoiceCreate))
            parts.Add("""
                (select 'Customer', id, name, coalesce(mobile, '') || coalesce(' · ' || city, ''), null from customers
                 where not is_deleted and (name ilike '%' || @t || '%' or mobile like '%' || @t || '%' or code ilike @t) order by name limit @n)
                """);
        if (session.HasAny(Perm.InvoiceView, Perm.InvoiceCreate))
            parts.Add("""
                (select 'Invoice', id, coalesce(number, 'Draft #' || id), customer_name || ' · ₹' || to_char(grand_total, 'FM99,99,99,990'), status from invoices
                 where number ilike '%' || @t || '%' or customer_mobile like '%' || @t || '%' order by id desc limit @n)
                """);
        if (session.Has(Perm.QuotationView))
            parts.Add("""
                (select 'Quotation', q.id, q.number, c.name, q.status from quotations q join customers c on c.id = q.customer_id
                 where q.number ilike '%' || @t || '%' order by q.id desc limit @n)
                """);
        if (session.Has(Perm.SalesOrderView))
            parts.Add("""
                (select 'Sales order', s.id, s.number, c.name, s.status from sales_orders s join customers c on c.id = s.customer_id
                 where s.number ilike '%' || @t || '%' order by s.id desc limit @n)
                """);
        if (session.Has(Perm.CustomOrderView))
            parts.Add("""
                (select 'Custom order', o.id, o.number, c.name || ' · ' || o.product_type, o.status from custom_orders o join customers c on c.id = o.customer_id
                 where o.number ilike '%' || @t || '%' or o.product_type ilike '%' || @t || '%' order by o.id desc limit @n)
                """);
        if (session.HasAny(Perm.SupplierView, Perm.PurchaseView))
            parts.Add("""
                (select 'Supplier', id, name, coalesce(mobile, '') || coalesce(' · ' || gstin, ''), null from suppliers
                 where not is_deleted and (name ilike '%' || @t || '%' or mobile like '%' || @t || '%' or gstin ilike @t) order by name limit @n)
                """);
        if (session.Has(Perm.PurchaseView))
            parts.Add("""
                (select 'Purchase', p.id, p.number, s.name || coalesce(' · bill ' || p.supplier_invoice_no, ''), p.status from purchases p join suppliers s on s.id = p.supplier_id
                 where p.number ilike '%' || @t || '%' or p.supplier_invoice_no ilike '%' || @t || '%' order by p.id desc limit @n)
                """);
        if (session.Has(Perm.DeliveryView))
            parts.Add("""
                (select 'Delivery', d.id, d.number, c.name, d.status from deliveries d join customers c on c.id = d.customer_id
                 where d.number ilike '%' || @t || '%' order by d.id desc limit @n)
                """);
        if (parts.Count == 0) return Array.Empty<SearchResult>();
        return await db.QueryAsync<SearchResult>(string.Join(" union all ", parts), new { t, n = perKind });
    }
}

public sealed class NotificationService(Db db, UserSession session)
{
    public Task<IReadOnlyList<Notification>> UnreadAsync(int limit = 30) =>
        db.QueryAsync<Notification>("""
            select * from notifications where not is_read and (user_id is null or user_id = @UserId) order by created_at desc limit @limit
            """, new { session.UserId, limit });

    public Task MarkReadAsync(long id) => db.ExecuteAsync("update notifications set is_read = true where id = @id", new { id });

    public Task MarkAllReadAsync() => db.ExecuteAsync("update notifications set is_read = true where not is_read and (user_id is null or user_id = @UserId)", new { session.UserId });

    /// <summary>Adds reminders for invoices that became overdue today and custom orders past their promised date (once per day).</summary>
    public async Task GenerateDailyAsync()
    {
        await db.ExecuteAsync("""
            insert into notifications (kind, title, message, ref_type, ref_id)
            select 'OVERDUE', 'Payment overdue', b.number || ' — ' || c.name || ' owes ₹' || to_char(b.balance, 'FM99,99,99,990.00'), 'INVOICE', b.invoice_id
            from v_invoice_balances b join customers c on c.id = b.customer_id
            where b.balance > 0 and b.due_date < current_date
              and not exists (select 1 from notifications n where n.ref_type = 'INVOICE' and n.ref_id = b.invoice_id and n.kind = 'OVERDUE' and n.created_at::date = current_date);
            insert into notifications (kind, title, message, ref_type, ref_id)
            select 'CUSTOM_DELAY', 'Custom order delayed', o.number || ' (' || o.product_type || ') was due ' || to_char(o.expected_completion_date, 'DD-Mon'), 'CUSTOM_ORDER', o.id
            from custom_orders o where o.status not in ('COMPLETED','CANCELLED') and o.expected_completion_date < current_date
              and not exists (select 1 from notifications n where n.ref_type = 'CUSTOM_ORDER' and n.ref_id = o.id and n.created_at::date = current_date);
            """);
    }
}
