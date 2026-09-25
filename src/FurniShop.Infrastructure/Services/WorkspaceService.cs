using Dapper;
using FurniShop.Core;
using FurniShop.Core.Domain;
using FurniShop.Core.Security;
using FurniShop.Infrastructure.Database;
using FurniShop.Infrastructure.Security;

namespace FurniShop.Infrastructure.Services;

// ============================================================================ models

public sealed class KpiValue
{
    public decimal Value { get; set; }
    public decimal? Previous { get; set; }
    public int Count { get; set; }
    public decimal? ChangePercent => Previous is null or 0 ? null : Math.Round((Value - Previous.Value) / Math.Abs(Previous.Value) * 100, 1);
}

public sealed class TrendPoint
{
    public DateTime Date { get; set; }
    public decimal Sales { get; set; }
    public decimal Collected { get; set; }
    public int Invoices { get; set; }
}

public sealed class ActivityItem
{
    public DateTime At { get; set; }
    public string? UserName { get; set; }
    public string Action { get; set; } = "";
    public string Module { get; set; } = "";
    public string Summary { get; set; } = "";
    public string? RecordType { get; set; }
    public long? RecordId { get; set; }
}

public sealed class Overview
{
    public DateTime From { get; set; }
    public DateTime To { get; set; }
    public string Granularity { get; set; } = "day";
    public KpiValue Sales { get; set; } = new();
    public KpiValue Collection { get; set; } = new();
    public KpiValue Outstanding { get; set; } = new();
    public decimal OverdueAmount { get; set; }
    public int PendingDeliveries { get; set; }
    public int DeliveriesToday { get; set; }
    public int PendingOrders { get; set; }
    public int CustomOrdersInProgress { get; set; }
    public decimal AverageInvoice { get; set; }
    public List<TrendPoint> Trend { get; set; } = new();
    public List<Delivery> UpcomingDeliveries { get; set; } = new();
    public List<InvoiceListItem> PendingPayments { get; set; } = new();
    public List<CustomOrder> CustomOrders { get; set; } = new();
    public List<InventoryRow> LowStock { get; set; } = new();
    public List<ActivityItem> Activity { get; set; } = new();
    public List<InvoiceListItem> RecentInvoices { get; set; } = new();
    public List<Payment> RecentPayments { get; set; } = new();
    public List<SalesOrder> RecentOrders { get; set; } = new();
}

public sealed class ProductFilter
{
    public string? Search { get; set; }
    public long? CategoryId { get; set; }
    public long? BrandId { get; set; }
    public string? Material { get; set; }
    public decimal? MinPrice { get; set; }
    public decimal? MaxPrice { get; set; }
    /// <summary>IN_STOCK / LOW / OUT / MADE_TO_ORDER.</summary>
    public string? Stock { get; set; }
    public decimal? GstRate { get; set; }
    public string? Status { get; set; }
    public string? SortBy { get; set; }
    public bool SortDescending { get; set; }
    public int Page { get; set; } = 1;
    public int PageSize { get; set; } = 25;
    public int Offset => Math.Max(0, (Page - 1) * PageSize);
}

public sealed class ProductRow
{
    public long Id { get; set; }
    public string Code { get; set; } = "";
    public string Name { get; set; } = "";
    public long CategoryId { get; set; }
    public string? CategoryName { get; set; }
    public string? BrandName { get; set; }
    public string? Material { get; set; }
    public string? Finish { get; set; }
    public string? Color { get; set; }
    public string? Dimensions { get; set; }
    public string Sku { get; set; } = "";
    public long? DefaultVariantId { get; set; }
    public int VariantCount { get; set; }
    public string? VariantNames { get; set; }
    public decimal SellingPrice { get; set; }
    public decimal? MaxPrice { get; set; }
    public decimal? CostPrice { get; set; }
    public decimal GstRate { get; set; }
    public bool PriceIncludesGst { get; set; }
    public decimal OnHand { get; set; }
    public decimal Reserved { get; set; }
    public decimal Available { get; set; }
    public decimal MinStock { get; set; }
    public bool IsStockItem { get; set; }
    public string Status { get; set; } = "";
    public long? ImageAttachmentId { get; set; }
    public string StockState => !IsStockItem ? "MADE_TO_ORDER" : Available <= 0 ? "OUT_OF_STOCK" : Available <= MinStock ? "LOW_STOCK" : "IN_STOCK";
}

public sealed class ProductFacets
{
    public List<Category> Categories { get; set; } = new();
    public List<Brand> Brands { get; set; } = new();
    public List<string> Materials { get; set; } = new();
    public List<decimal> GstRates { get; set; } = new();
}

public sealed class StockHistoryRow
{
    public DateTime Date { get; set; }
    public string DocType { get; set; } = "";
    public long DocId { get; set; }
    public string? DocNumber { get; set; }
    public string? Party { get; set; }
    public decimal Quantity { get; set; }
    public decimal? Rate { get; set; }
    public string? Note { get; set; }
}

public sealed class StockDetail
{
    public InventoryRow Item { get; set; } = new();
    public decimal? StockValue { get; set; }
    public List<StockHistoryRow> Purchases { get; set; } = new();
    public List<StockHistoryRow> Sales { get; set; } = new();
    public List<StockHistoryRow> Returns { get; set; } = new();
    public List<StockHistoryRow> Adjustments { get; set; } = new();
    public List<ReservedStockRow> Reservations { get; set; } = new();
    public List<InventoryMovement> Timeline { get; set; } = new();
}

public sealed class TimelineItem
{
    public DateTime At { get; set; }
    public string Kind { get; set; } = "";
    public long Id { get; set; }
    public string Title { get; set; } = "";
    public string? Detail { get; set; }
    public decimal? Amount { get; set; }
    public string? Status { get; set; }
}

// ============================================================================ service

/// <summary>Read models for the web workspace: dashboard, product browser, stock drawer, POS favourites, customer timeline.</summary>
public sealed class WorkspaceService(Db db, UserSession session, CatalogService catalog)
{
    // ------------------------------------------------------------------ dashboard
    public async Task<Overview> OverviewAsync(DateTime from, DateTime to)
    {
        session.Demand(Perm.DashboardView);
        from = from.Date; to = to.Date;
        if (to < from) (from, to) = (to, from);
        var days = (to - from).Days + 1;
        var prevTo = from.AddDays(-1);
        var prevFrom = prevTo.AddDays(-(days - 1));
        var granularity = days > 92 ? "month" : "day";
        var a = new { From = from, To = to, PrevFrom = prevFrom, PrevTo = prevTo };

        await using var conn = await db.OpenAsync();
        var o = new Overview { From = from, To = to, Granularity = granularity };
        var k = await conn.QuerySingleAsync<(decimal Sales, int Invoices, decimal PrevSales, decimal Collected, decimal PrevCollected,
            decimal Outstanding, int OutstandingCount, decimal Overdue, int PendingDeliveries, int DeliveriesToday, int PendingOrders, int CustomOrders)>("""
            select
              coalesce((select sum(grand_total) from invoices where status = 'FINAL' and invoice_date between @From and @To),0),
              (select count(*)::int from invoices where status = 'FINAL' and invoice_date between @From and @To),
              coalesce((select sum(grand_total) from invoices where status = 'FINAL' and invoice_date between @PrevFrom and @PrevTo),0),
              coalesce((select sum(case when direction='IN' then amount else -amount end) from payments where not is_voided and payment_date between @From and @To),0),
              coalesce((select sum(case when direction='IN' then amount else -amount end) from payments where not is_voided and payment_date between @PrevFrom and @PrevTo),0),
              coalesce((select sum(balance) from v_invoice_balances where balance > 0),0),
              (select count(*)::int from v_invoice_balances where balance > 0),
              coalesce((select sum(balance) from v_invoice_balances where balance > 0 and due_date < current_date),0),
              (select count(*)::int from deliveries where status in ('PENDING','SCHEDULED','OUT_FOR_DELIVERY')),
              (select count(*)::int from deliveries where status in ('SCHEDULED','OUT_FOR_DELIVERY') and scheduled_date = current_date),
              (select count(*)::int from sales_orders where status in ('CONFIRMED','PROCESSING','MANUFACTURING','READY','DISPATCHED')),
              (select count(*)::int from custom_orders where status not in ('COMPLETED','CANCELLED'))
            """, a);
        o.Sales = new KpiValue { Value = k.Sales, Previous = k.PrevSales, Count = k.Invoices };
        o.Collection = new KpiValue { Value = k.Collected, Previous = k.PrevCollected };
        o.Outstanding = new KpiValue { Value = k.Outstanding, Count = k.OutstandingCount };
        o.OverdueAmount = k.Overdue;
        o.PendingDeliveries = k.PendingDeliveries;
        o.DeliveriesToday = k.DeliveriesToday;
        o.PendingOrders = k.PendingOrders + k.CustomOrders;
        o.CustomOrdersInProgress = k.CustomOrders;
        o.AverageInvoice = k.Invoices == 0 ? 0 : Money.R2(k.Sales / k.Invoices);

        o.Trend = (await conn.QueryAsync<TrendPoint>($"""
            with g as (select generate_series(date_trunc('{granularity}', @From::date), @To::date, interval '1 {granularity}')::date as date)
            select g.date,
                   coalesce((select sum(grand_total) from invoices i where i.status = 'FINAL' and date_trunc('{granularity}', i.invoice_date) = g.date and i.invoice_date between @From and @To),0) as sales,
                   coalesce((select count(*) from invoices i where i.status = 'FINAL' and date_trunc('{granularity}', i.invoice_date) = g.date and i.invoice_date between @From and @To),0)::int as invoices,
                   coalesce((select sum(case when direction='IN' then amount else -amount end) from payments p where not p.is_voided
                             and date_trunc('{granularity}', p.payment_date) = g.date and p.payment_date between @From and @To),0) as collected
            from g order by g.date
            """, a)).AsList();

        if (session.Has(Perm.DeliveryView))
            o.UpcomingDeliveries = (await conn.QueryAsync<Delivery>("""
                select d.*, c.name as customer_name, c.mobile as customer_mobile, i.number as invoice_number, so.number as sales_order_number, co.number as custom_order_number,
                       (select string_agg(di.description || ' × ' || trim(to_char(di.quantity, 'FM999990.##')), ', ') from delivery_items di where di.delivery_id = d.id) as items_summary
                from deliveries d join customers c on c.id = d.customer_id
                left join invoices i on i.id = d.invoice_id left join sales_orders so on so.id = d.sales_order_id left join custom_orders co on co.id = d.custom_order_id
                where d.status in ('PENDING','SCHEDULED','OUT_FOR_DELIVERY')
                order by d.status = 'OUT_FOR_DELIVERY' desc, d.scheduled_date nulls last, d.id limit 6
                """)).AsList();
        if (session.Has(Perm.InvoiceView))
        {
            o.PendingPayments = (await conn.QueryAsync<InvoiceListItem>("""
                select i.id, i.number, i.status, i.invoice_date, i.due_date, i.customer_id, i.customer_name, i.customer_mobile, i.grand_total,
                       b.returned_amount, b.paid, b.balance, greatest(0, current_date - i.due_date) as days_overdue
                from v_invoice_balances b join invoices i on i.id = b.invoice_id where b.balance > 0
                order by (i.due_date < current_date) desc, b.balance desc limit 6
                """)).AsList();
            o.RecentInvoices = (await conn.QueryAsync<InvoiceListItem>("""
                select i.id, i.number, i.status, i.invoice_date, i.due_date, i.customer_id, i.customer_name, i.grand_total,
                       coalesce(b.returned_amount,0) as returned_amount, coalesce(b.paid,0) as paid, coalesce(b.balance,0) as balance
                from invoices i left join v_invoice_balances b on b.invoice_id = i.id where i.status <> 'DRAFT'
                order by coalesce(i.finalized_at, i.created_at) desc limit 6
                """)).AsList();
        }
        if (session.Has(Perm.CustomOrderView))
            o.CustomOrders = (await conn.QueryAsync<CustomOrder>($"""
                select o.*, c.name as customer_name, c.mobile as customer_mobile,
                       coalesce((select sum(case when p.direction='IN' then a.amount else -a.amount end) from payment_allocations a
                                 join payments p on p.id = a.payment_id and not p.is_voided where a.doc_type = 'CUSTOM_ORDER' and a.doc_id = o.id),0) as advance_paid
                from custom_orders o join customers c on c.id = o.customer_id where o.status not in ('COMPLETED','CANCELLED')
                order by o.expected_completion_date nulls last limit 6
                """)).AsList();
        if (session.Has(Perm.InventoryView))
        {
            o.LowStock = (await conn.QueryAsync<InventoryRow>("""
                select * from v_inventory where is_stock_item and product_status = 'ACTIVE' and available <= min_stock order by available, product_name limit 6
                """)).AsList();
            if (!session.CanSeeCost) o.LowStock.ForEach(r => r.CostPrice = null);
        }
        if (session.Has(Perm.PaymentView))
            o.RecentPayments = (await conn.QueryAsync<Payment>("""
                select p.*, c.name as customer_name,
                       (select string_agg(pm.name, ' + ') from payment_lines l join payment_methods pm on pm.code = l.method_code where l.payment_id = p.id) as methods
                from payments p join customers c on c.id = p.customer_id order by p.created_at desc limit 6
                """)).AsList();
        if (session.Has(Perm.SalesOrderView))
            o.RecentOrders = (await conn.QueryAsync<SalesOrder>("""
                select so.*, so.order_date as date, c.name as customer_name, c.mobile as customer_mobile,
                       coalesce((select sum(case when p.direction='IN' then a.amount else -a.amount end) from payment_allocations a
                                 join payments p on p.id = a.payment_id and not p.is_voided where a.doc_type = 'SALES_ORDER' and a.doc_id = so.id),0) as advance_paid
                from sales_orders so join customers c on c.id = so.customer_id where so.status <> 'DRAFT' order by so.created_at desc limit 6
                """)).AsList();
        // Activity: everyone sees their own; managers with audit rights see the whole shop.
        o.Activity = (await conn.QueryAsync<ActivityItem>("""
            select occurred_at as at, username as user_name, action, module, summary, record_type, record_id
            from audit_logs where action not in ('LOGIN','LOGOUT','LOGIN_FAILED') and (@all or user_id = @uid)
            order by occurred_at desc limit 8
            """, new { all = session.Has(Perm.AuditView), uid = session.UserId })).AsList();
        return o;
    }

    // ------------------------------------------------------------------ products
    public async Task<PagedResult<ProductRow>> ProductsAsync(ProductFilter f)
    {
        session.Demand(Perm.ProductView);
        var canCost = session.CanSeeCost;
        var where = """
            where not p.is_deleted
              and (@Status::text is null or p.status = @Status)
              and (@CategoryId::bigint is null or p.category_id = @CategoryId)
              and (@BrandId::bigint is null or p.brand_id = @BrandId)
              and (@Material::text is null or p.material ilike @Material)
              and (@MinPrice::numeric is null or p.selling_price >= @MinPrice)
              and (@MaxPrice::numeric is null or p.selling_price <= @MaxPrice)
              and (@GstRate::numeric is null or p.gst_rate = @GstRate)
              and (@Search::text is null or p.name ilike '%' || @Search || '%' or p.code ilike '%' || @Search || '%'
                   or exists (select 1 from product_variants v where v.product_id = p.id and not v.is_deleted and (v.sku ilike '%' || @Search || '%' or v.barcode = @Search)))
            """;
        var stock = f.Stock switch
        {
            "IN_STOCK" => "where is_stock_item and available > min_stock",
            "LOW" => "where is_stock_item and available > 0 and available <= min_stock",
            "OUT" => "where is_stock_item and available <= 0",
            "MADE_TO_ORDER" => "where not is_stock_item",
            _ => "",
        };
        var order = f.SortBy switch
        {
            "price" => "selling_price", "stock" => "available", "category" => "category_name", "sku" => "sku", "updated" => "updated_at", _ => "name",
        } + (f.SortDescending ? " desc" : " asc");
        var args = new
        {
            Search = Blank(f.Search), f.CategoryId, f.BrandId, Material = Blank(f.Material), f.MinPrice, f.MaxPrice, f.GstRate,
            Status = Blank(f.Status), f.PageSize, f.Offset,
        };
        var sql = $"""
            select * from (
                select p.id, p.code, p.name, p.category_id, c.name as category_name, b.name as brand_name, p.material, p.finish, p.color, p.dimensions,
                       p.selling_price, p.cost_price, p.gst_rate, p.price_includes_gst, p.min_stock, p.is_stock_item, p.status, p.updated_at,
                       coalesce(p.image_attachment_id, dv.image_attachment_id) as image_attachment_id,
                       coalesce(dv.sku, p.code) as sku, dv.id as default_variant_id,
                       (select count(*)::int from product_variants v where v.product_id = p.id and not v.is_deleted) as variant_count,
                       (select string_agg(v.variant_name, ' · ' order by v.is_default desc, v.id) from product_variants v
                        where v.product_id = p.id and not v.is_deleted and v.variant_name <> 'Standard') as variant_names,
                       (select max(coalesce(v.selling_price, p.selling_price)) from product_variants v where v.product_id = p.id and not v.is_deleted) as max_price,
                       coalesce(s.on_hand,0) as on_hand, coalesce(s.reserved,0) as reserved, coalesce(s.on_hand,0) - coalesce(s.reserved,0) as available
                from products p join categories c on c.id = p.category_id left join brands b on b.id = p.brand_id
                left join lateral (select v.id, v.sku, v.image_attachment_id from product_variants v where v.product_id = p.id and not v.is_deleted
                                   order by v.is_default desc, v.id limit 1) dv on true
                left join (select v.product_id, sum(i.on_hand) as on_hand, sum(i.reserved) as reserved
                           from inventory i join product_variants v on v.id = i.variant_id where not v.is_deleted group by v.product_id) s on s.product_id = p.id
                {where}
            ) x {stock}
            """;
        await using var conn = await db.OpenAsync();
        var total = await conn.ExecuteScalarAsync<int>($"select count(*) from ({sql}) c", args);
        var rows = (await conn.QueryAsync<ProductRow>($"{sql} order by {order}, id limit @PageSize offset @Offset", args)).AsList();
        if (!canCost) rows.ForEach(r => r.CostPrice = null);
        return new PagedResult<ProductRow> { Items = rows, TotalCount = total, Page = f.Page, PageSize = f.PageSize };
    }

    public async Task<ProductFacets> ProductFacetsAsync()
    {
        session.DemandAny(Perm.ProductView, Perm.InvoiceCreate, Perm.QuotationManage);
        await using var conn = await db.OpenAsync();
        return new ProductFacets
        {
            Categories = (await conn.QueryAsync<Category>("""
                select c.*, (select count(*)::int from products p where p.category_id = c.id and not p.is_deleted) as product_count
                from categories c where not c.is_deleted order by c.name
                """)).AsList(),
            Brands = (await conn.QueryAsync<Brand>("select * from brands where not is_deleted order by name")).AsList(),
            Materials = (await conn.QueryAsync<string>("select distinct material from products where not is_deleted and material is not null and material <> '' order by 1")).AsList(),
            GstRates = (await conn.QueryAsync<decimal>("select rate from gst_rates where is_active order by rate")).AsList(),
        };
    }

    /// <summary>Copies a product and its variants as a new inactive draft ("-COPY" codes, no barcodes, no stock).</summary>
    public async Task<long> DuplicateProductAsync(long id)
    {
        session.Demand(Perm.ProductManage);
        var p = await catalog.GetProductAsync(id);
        var suffix = "-COPY";
        for (var n = 2; await db.ScalarAsync<int>("select count(*) from products where lower(code) = lower(@c) and not is_deleted", new { c = p.Code + suffix }) > 0; n++)
            suffix = $"-COPY{n}";
        p.Id = 0;
        p.Code += suffix;
        p.Name += " (copy)";
        p.Status = "INACTIVE";
        foreach (var v in p.Variants)
        {
            v.Id = 0; v.ProductId = 0; v.Barcode = null; v.OpeningStock = 0;
            v.Sku += suffix;
        }
        return await catalog.SaveProductAsync(p);
    }

    // ------------------------------------------------------------------ stock drawer
    public async Task<StockDetail> StockDetailAsync(long variantId)
    {
        session.DemandAny(Perm.InventoryView, Perm.ProductView);
        var canCost = session.CanSeeCost;
        var inventory = session.Has(Perm.InventoryView);
        await using var conn = await db.OpenAsync();
        var item = await conn.QuerySingleOrDefaultAsync<InventoryRow>("select * from v_inventory where variant_id = @variantId", new { variantId })
                   ?? throw new NotFoundException("Product variant", variantId);
        if (!canCost) item.CostPrice = null;
        var d = new StockDetail { Item = item, StockValue = item.StockValue };
        var a = new { variantId };
        if (session.Has(Perm.PurchaseView))
            d.Purchases = (await conn.QueryAsync<StockHistoryRow>($"""
                select p.purchase_date as date, 'PURCHASE' as doc_type, p.id as doc_id, p.number as doc_number, s.name as party, it.quantity,
                       {(canCost ? "it.unit_cost" : "null::numeric")} as rate, p.supplier_invoice_no as note
                from purchase_items it join purchases p on p.id = it.purchase_id join suppliers s on s.id = p.supplier_id
                where it.variant_id = @variantId and p.status = 'COMPLETED' order by p.purchase_date desc, p.id desc limit 25
                """, a)).AsList();
        if (session.Has(Perm.InvoiceView))
            d.Sales = (await conn.QueryAsync<StockHistoryRow>("""
                select i.invoice_date as date, 'INVOICE' as doc_type, i.id as doc_id, i.number as doc_number, i.customer_name as party, it.quantity,
                       it.unit_price as rate, null as note
                from invoice_items it join invoices i on i.id = it.invoice_id
                where it.variant_id = @variantId and i.status = 'FINAL' order by i.invoice_date desc, i.id desc limit 25
                """, a)).AsList();
        if (session.HasAny(Perm.ReturnView, Perm.PurchaseView))
            d.Returns = (await conn.QueryAsync<StockHistoryRow>("""
                select * from (
                    select r.return_date as date, 'RETURN' as doc_type, r.id as doc_id, r.number as doc_number, c.name as party, ri.quantity,
                           null::numeric as rate, ri.condition || ' · ' || ri.restock_action as note
                    from sales_return_items ri join sales_returns r on r.id = ri.return_id join customers c on c.id = r.customer_id where ri.variant_id = @variantId
                    union all
                    select d.return_date, 'DEBIT_NOTE', d.id, d.number, s.name, -di.quantity, null, d.reason
                    from purchase_return_items di join purchase_returns d on d.id = di.return_id join suppliers s on s.id = d.supplier_id where di.variant_id = @variantId
                ) x order by date desc limit 25
                """, a)).AsList();
        if (inventory)
        {
            d.Adjustments = (await conn.QueryAsync<StockHistoryRow>("""
                select m.created_at as date, m.movement_type as doc_type, coalesce(m.ref_id, 0) as doc_id, m.ref_number as doc_number,
                       u.full_name as party, m.on_hand_delta + m.damaged_delta as quantity, null::numeric as rate, m.note
                from inventory_movements m left join users u on u.id = m.created_by
                where m.variant_id = @variantId and m.movement_type in ('OPENING','ADJUSTMENT_IN','ADJUSTMENT_OUT','DAMAGE','DAMAGE_REPAIRED','DAMAGE_WRITE_OFF','DISPLAY')
                order by m.created_at desc limit 25
                """, a)).AsList();
            d.Reservations = (await conn.QueryAsync<ReservedStockRow>("""
                select so.id as sales_order_id, so.number as sales_order_number, c.name as customer_name, so.status, so.order_date, so.expected_delivery_date,
                       it.variant_id, v.sku, it.description as product_name, it.reserved_qty
                from sales_order_items it join sales_orders so on so.id = it.sales_order_id join customers c on c.id = so.customer_id
                join product_variants v on v.id = it.variant_id
                where it.variant_id = @variantId and it.reserved_qty > 0 order by so.expected_delivery_date nulls last
                """, a)).AsList();
            d.Timeline = (await conn.QueryAsync<InventoryMovement>("""
                select m.*, u.full_name as created_by_name from inventory_movements m left join users u on u.id = m.created_by
                where m.variant_id = @variantId order by m.created_at desc, m.id desc limit 60
                """, a)).AsList();
            if (!canCost) d.Timeline.ForEach(t => t.UnitCost = null);
        }
        return d;
    }

    // ------------------------------------------------------------------ POS favourites & recents
    public async Task<IReadOnlyList<SellableItem>> FavoritesAsync()
    {
        session.DemandAny(Perm.InvoiceCreate, Perm.QuotationManage, Perm.SalesOrderManage);
        var ids = (await db.QueryAsync<long>("select variant_id from user_favorites where user_id = @UserId order by created_at", new { session.UserId })).ToArray();
        return await ItemsAsync(ids);
    }

    public async Task<bool> ToggleFavoriteAsync(long variantId)
    {
        session.DemandAny(Perm.InvoiceCreate, Perm.QuotationManage, Perm.SalesOrderManage);
        var removed = await db.ExecuteAsync("delete from user_favorites where user_id = @UserId and variant_id = @variantId", new { session.UserId, variantId });
        if (removed > 0) return false;
        await db.ExecuteAsync("insert into user_favorites (user_id, variant_id) values (@UserId, @variantId) on conflict do nothing", new { session.UserId, variantId });
        return true;
    }

    /// <summary>Variants this user sold most recently — the quickest way back to common items.</summary>
    public async Task<IReadOnlyList<SellableItem>> RecentAsync(int limit = 12)
    {
        session.DemandAny(Perm.InvoiceCreate, Perm.QuotationManage, Perm.SalesOrderManage);
        var ids = (await db.QueryAsync<long>("""
            select variant_id from (
                select it.variant_id, max(i.created_at) as last_at from invoice_items it join invoices i on i.id = it.invoice_id
                where i.created_by = @UserId and it.variant_id is not null and i.created_at > now() - interval '60 days'
                group by it.variant_id) x
            order by last_at desc limit @limit
            """, new { session.UserId, limit })).ToArray();
        if (ids.Length == 0) // new user: fall back to the shop's best sellers
            ids = (await db.QueryAsync<long>("""
                select it.variant_id from invoice_items it join invoices i on i.id = it.invoice_id
                where i.status = 'FINAL' and it.variant_id is not null and i.invoice_date > current_date - 90
                group by it.variant_id order by sum(it.quantity) desc limit @limit
                """, new { limit })).ToArray();
        return await ItemsAsync(ids);
    }

    private async Task<IReadOnlyList<SellableItem>> ItemsAsync(long[] ids)
    {
        var list = new List<SellableItem>();
        foreach (var id in ids)
            if (await catalog.GetSellableAsync(id) is { } item) list.Add(item);
        return list;
    }

    // ------------------------------------------------------------------ customer timeline
    public async Task<IReadOnlyList<TimelineItem>> CustomerTimelineAsync(long customerId, int limit = 60)
    {
        session.Demand(Perm.CustomerView);
        var parts = new List<string>();
        if (session.Has(Perm.InvoiceView))
            parts.Add("""
                select coalesce(finalized_at, created_at) as at, 'INVOICE' as kind, id, 'Invoice ' || coalesce(number, 'draft') as title,
                       (select count(*) || ' item(s)' from invoice_items it where it.invoice_id = i.id) as detail, grand_total as amount, status
                from invoices i where customer_id = @customerId
                """);
        if (session.Has(Perm.PaymentView))
            parts.Add("""
                select created_at, case when direction = 'IN' then 'PAYMENT' else 'REFUND' end, id,
                       case when direction = 'IN' then 'Payment ' else 'Refund ' end || number,
                       (select string_agg(pm.name, ' + ') from payment_lines l join payment_methods pm on pm.code = l.method_code where l.payment_id = p.id),
                       amount, case when is_voided then 'VOIDED' when direction = 'OUT' then 'REFUND' else 'RECEIVED' end
                from payments p where customer_id = @customerId
                """);
        if (session.Has(Perm.QuotationView))
            parts.Add("select created_at, 'QUOTATION', id, 'Quotation ' || number, null, grand_total, status from quotations where customer_id = @customerId");
        if (session.Has(Perm.SalesOrderView))
            parts.Add("select created_at, 'SALES_ORDER', id, 'Sales order ' || number, null, grand_total, status from sales_orders where customer_id = @customerId");
        if (session.Has(Perm.CustomOrderView))
            parts.Add("select created_at, 'CUSTOM_ORDER', id, 'Custom order ' || number, product_type, coalesce(nullif(final_price,0), estimated_cost), status from custom_orders where customer_id = @customerId");
        if (session.Has(Perm.DeliveryView))
            parts.Add("select coalesce(delivered_at, created_at), 'DELIVERY', id, 'Delivery ' || number, delivery_address, null::numeric, status from deliveries where customer_id = @customerId");
        if (session.Has(Perm.ReturnView))
            parts.Add("select created_at, 'RETURN', id, 'Return ' || number, reason, credit_amount, 'RETURNED' from sales_returns where customer_id = @customerId");
        if (parts.Count == 0) return Array.Empty<TimelineItem>();
        return await db.QueryAsync<TimelineItem>($"select * from ({string.Join(" union all ", parts)}) t order by at desc limit @limit", new { customerId, limit });
    }

    private static string? Blank(string? s) => string.IsNullOrWhiteSpace(s) ? null : s.Trim();
}
