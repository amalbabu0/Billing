using System.Data;
using Dapper;
using FurniShop.Core;
using FurniShop.Core.Security;
using FurniShop.Infrastructure.Database;
using FurniShop.Infrastructure.Security;

namespace FurniShop.Infrastructure.Services;

public sealed class ReportFilter
{
    public DateTime From { get; set; } = new(DateTime.Today.Year, DateTime.Today.Month, 1);
    public DateTime To { get; set; } = DateTime.Today;
    public long? CategoryId { get; set; }
    public long? ProductId { get; set; }
    public long? CustomerId { get; set; }
    public long? SupplierId { get; set; }
    /// <summary>day | week | month | year</summary>
    public string GroupBy { get; set; } = "day";
}

public sealed record ReportDefinition(string Key, string Group, string Title, string Permission, string Description,
    bool UsesDates = true, bool UsesCategory = false, bool UsesProduct = false, bool UsesCustomer = false, bool UsesSupplier = false,
    bool UsesGrouping = false, bool NeedsCost = false);

public sealed class ReportResult
{
    public required ReportDefinition Definition { get; init; }
    public required DataTable Table { get; init; }
    public required ReportFilter Filter { get; init; }
    /// <summary>Column names whose values are money (formatted ₹ in UI / exports).</summary>
    public HashSet<string> MoneyColumns { get; init; } = new();
    public List<(string Label, string Value)> Totals { get; init; } = new();
    public string Subtitle => Definition.UsesDates ? $"{Filter.From:dd-MMM-yyyy} to {Filter.To:dd-MMM-yyyy}" : $"As on {DateTime.Now:dd-MMM-yyyy HH:mm}";
}

/// <summary>All business reports. Each returns a DataTable so the UI grid and CSV / Excel / PDF exports share one source.</summary>
public sealed class ReportService(Db db, UserSession session)
{
    public static readonly IReadOnlyList<ReportDefinition> All = new List<ReportDefinition>
    {
        new("sales.period", "Sales", "Sales summary", Perm.ReportSales, "Daily / weekly / monthly / yearly sales", UsesCategory: true, UsesCustomer: true, UsesGrouping: true),
        new("sales.product", "Sales", "Product sales", Perm.ReportSales, "Quantity and value sold per product", UsesCategory: true, UsesProduct: true, UsesCustomer: true),
        new("sales.category", "Sales", "Category sales", Perm.ReportSales, "Sales by category"),
        new("sales.customer", "Sales", "Customer sales", Perm.ReportSales, "Sales, payments and balance per customer", UsesCustomer: true),
        new("sales.staff", "Sales", "Staff sales", Perm.ReportSales, "Invoices created per staff member"),
        new("sales.register", "Sales", "Invoice register", Perm.ReportSales, "Every invoice in the period", UsesCustomer: true),
        new("inv.current", "Inventory", "Current stock", Perm.ReportInventory, "On hand, reserved, available", UsesDates: false, UsesCategory: true),
        new("inv.low", "Inventory", "Low stock", Perm.ReportInventory, "At or below minimum stock", UsesDates: false, UsesCategory: true),
        new("inv.out", "Inventory", "Out of stock", Perm.ReportInventory, "Nothing available", UsesDates: false, UsesCategory: true),
        new("inv.reserved", "Inventory", "Reserved stock", Perm.ReportInventory, "Stock held for orders", UsesDates: false),
        new("inv.damaged", "Inventory", "Damaged stock", Perm.ReportInventory, "Damaged units", UsesDates: false, UsesCategory: true),
        new("inv.valuation", "Inventory", "Stock valuation", Perm.ReportInventory, "Value at cost and at selling price", UsesDates: false, UsesCategory: true, NeedsCost: true),
        new("inv.movement", "Inventory", "Stock movement", Perm.ReportInventory, "Every stock in / out", UsesCategory: true, UsesProduct: true),
        new("pay.method", "Payments", "Collections by method", Perm.ReportPayment, "Cash / UPI / card / bank / cheque"),
        new("pay.register", "Payments", "Payment register", Perm.ReportPayment, "Every receipt and refund", UsesCustomer: true),
        new("pay.outstanding", "Payments", "Outstanding & ageing", Perm.ReportPayment, "Customer dues with ageing buckets", UsesDates: false, UsesCustomer: true),
        new("pur.supplier", "Purchases", "Supplier purchases", Perm.ReportPurchase, "Purchases, payments and dues per supplier", UsesSupplier: true),
        new("pur.register", "Purchases", "Purchase register", Perm.ReportPurchase, "Every purchase in the period", UsesSupplier: true),
        new("gst.rate", "GST", "GST summary by rate", Perm.ReportGst, "Taxable value, CGST, SGST, IGST per rate"),
        new("gst.hsn", "GST", "HSN summary", Perm.ReportGst, "HSN-wise outward supplies"),
        new("gst.invoice", "GST", "GST by invoice", Perm.ReportGst, "B2B / B2C invoice-wise tax", UsesCustomer: true),
        new("gst.creditnotes", "GST", "Credit notes (returns)", Perm.ReportGst, "Tax reversed through sales returns"),
        new("gst.purchases", "GST", "Input GST (purchases)", Perm.ReportGst, "GST paid on purchases", UsesSupplier: true),
        new("profit.summary", "Profit", "Profit & loss", Perm.ReportProfit, "Sales − cost − expenses = net profit", UsesGrouping: true, NeedsCost: true),
        new("profit.invoice", "Profit", "Invoice margin", Perm.ReportProfit, "Margin on every invoice", UsesCustomer: true, NeedsCost: true),
        new("profit.product", "Profit", "Product margin", Perm.ReportProfit, "Margin per product", UsesCategory: true, NeedsCost: true),
        new("expense.category", "Profit", "Expenses by category", Perm.ExpenseView, "Business expenses"),
        new("sales.commission", "Sales", "Salesperson commission", Perm.ReportProfit, "Net sales (taxable, after returns) and commission per salesperson"),
        new("inv.analytics", "Inventory", "Stock movement analysis", Perm.ReportInventory, "Fast, slow, dead and overstock items with a reorder suggestion", UsesCategory: true),
    };

    public IReadOnlyList<ReportDefinition> Available() =>
        All.Where(r => session.Has(r.Permission) && (!r.NeedsCost || session.CanSeeCost)).ToList();

    public async Task<ReportResult> RunAsync(string key, ReportFilter f)
    {
        var def = All.FirstOrDefault(r => r.Key == key) ?? throw new ArgumentException($"Unknown report {key}");
        session.Demand(def.Permission);
        if (def.NeedsCost) session.Demand(Perm.CostView);
        if (f.To < f.From) throw new ValidationException("To", "The end date is before the start date.");
        var cost = session.CanSeeCost;
        var money = new HashSet<string>();
        var args = new { From = f.From.Date, To = f.To.Date, f.CategoryId, f.ProductId, f.CustomerId, f.SupplierId };
        var trunc = f.GroupBy is "week" or "month" or "year" ? f.GroupBy : "day";
        var periodLabel = trunc switch
        {
            "week" => "to_char(date_trunc('week', {0}), 'DD-Mon-YYYY') || ' (week)'",
            "month" => "to_char(date_trunc('month', {0}), 'Mon YYYY')",
            "year" => "to_char(date_trunc('year', {0}), 'YYYY')",
            _ => "to_char({0}, 'DD-Mon-YYYY')",
        };
        string P(string col) => string.Format(periodLabel, col);

        const string invFilter = """
            i.status = 'FINAL' and i.invoice_date between @From and @To and (@CustomerId::bigint is null or i.customer_id = @CustomerId)
            """;
        const string itemFilter = """
            and (@CategoryId::bigint is null or p.category_id = @CategoryId) and (@ProductId::bigint is null or p.id = @ProductId)
            """;

        string sql;
        switch (key)
        {
            case "sales.period":
                sql = $"""
                    select {P("i.invoice_date")} as "Period", count(distinct i.id) as "Invoices", sum(it.quantity) as "Items sold",
                           sum(it.taxable_amount) as "Taxable value", sum(it.cgst + it.sgst + it.igst) as "GST",
                           sum(it.line_total) as "Item value"
                    from invoices i join invoice_items it on it.invoice_id = i.id
                    left join product_variants v on v.id = it.variant_id left join products p on p.id = v.product_id
                    where {invFilter} and (@CategoryId::bigint is null or p.category_id = @CategoryId)
                    group by date_trunc('{trunc}', i.invoice_date), 1 order by date_trunc('{trunc}', i.invoice_date)
                    """;
                money.UnionWith(new[] { "Taxable value", "GST", "Item value" });
                break;
            case "sales.product":
                sql = $"""
                    select coalesce(p.name, it.description) as "Product", coalesce(v.sku, it.sku, '-') as "SKU", c.name as "Category",
                           sum(it.quantity - it.returned_qty) as "Net qty", sum(it.taxable_amount) as "Taxable value", sum(it.line_total) as "Total incl. GST"
                           {(cost ? ", sum(it.unit_cost * it.quantity) as \"Cost\", sum(it.taxable_amount - it.unit_cost * it.quantity) as \"Gross profit\"" : "")}
                    from invoices i join invoice_items it on it.invoice_id = i.id
                    left join product_variants v on v.id = it.variant_id left join products p on p.id = v.product_id left join categories c on c.id = p.category_id
                    where {invFilter} {itemFilter}
                    group by 1, 2, 3 order by sum(it.taxable_amount) desc
                    """;
                money.UnionWith(new[] { "Taxable value", "Total incl. GST", "Cost", "Gross profit" });
                break;
            case "sales.category":
                sql = $"""
                    select coalesce(c.name, 'Custom / other') as "Category", count(distinct i.id) as "Invoices", sum(it.quantity) as "Qty",
                           sum(it.taxable_amount) as "Taxable value", sum(it.line_total) as "Total incl. GST"
                    from invoices i join invoice_items it on it.invoice_id = i.id
                    left join product_variants v on v.id = it.variant_id left join products p on p.id = v.product_id left join categories c on c.id = p.category_id
                    where {invFilter} group by 1 order by sum(it.taxable_amount) desc
                    """;
                money.UnionWith(new[] { "Taxable value", "Total incl. GST" });
                break;
            case "sales.customer":
                sql = """
                    select c.name as "Customer", c.mobile as "Mobile", count(b.invoice_id) as "Invoices", coalesce(sum(b.grand_total),0) as "Sales",
                           coalesce(sum(b.returned_amount),0) as "Returns", coalesce(sum(b.paid),0) as "Paid", coalesce(sum(b.balance),0) as "Balance"
                    from customers c join v_invoice_balances b on b.customer_id = c.id
                    where b.invoice_date between @From and @To and (@CustomerId::bigint is null or c.id = @CustomerId)
                    group by c.id order by sum(b.grand_total) desc
                    """;
                money.UnionWith(new[] { "Sales", "Returns", "Paid", "Balance" });
                break;
            case "sales.staff":
                sql = $"""
                    select coalesce(u.full_name, 'System') as "Staff", count(*) as "Invoices", sum(i.taxable_total) as "Taxable value",
                           sum(i.grand_total) as "Invoice value", round(avg(i.grand_total), 2) as "Average bill"
                    from invoices i left join users u on u.id = i.created_by where {invFilter} group by 1 order by sum(i.grand_total) desc
                    """;
                money.UnionWith(new[] { "Taxable value", "Invoice value", "Average bill" });
                break;
            case "sales.register":
                sql = $"""
                    select i.number as "Invoice", i.invoice_date as "Date", i.customer_name as "Customer", i.customer_gstin as "GSTIN",
                           i.taxable_total as "Taxable", i.cgst_total as "CGST", i.sgst_total as "SGST", i.igst_total as "IGST",
                           i.grand_total as "Total", b.paid as "Paid", b.balance as "Balance"
                    from invoices i join v_invoice_balances b on b.invoice_id = i.id where {invFilter} order by i.invoice_date, i.number
                    """;
                money.UnionWith(new[] { "Taxable", "CGST", "SGST", "IGST", "Total", "Paid", "Balance" });
                break;
            case "inv.current" or "inv.low" or "inv.out" or "inv.damaged" or "inv.valuation":
            {
                var cond = key switch
                {
                    "inv.low" => "and available > 0 and available <= min_stock",
                    "inv.out" => "and available <= 0",
                    "inv.damaged" => "and damaged > 0",
                    _ => "",
                };
                var costCols = cost ? """, cost_price as "Cost price", greatest(on_hand,0) * cost_price as "Stock value (cost)" """ : "";
                sql = $"""
                    select sku as "SKU", product_name || case when variant_name <> 'Standard' then ' — ' || variant_name else '' end as "Product",
                           category_name as "Category", on_hand as "On hand", reserved as "Reserved", available as "Available",
                           damaged as "Damaged", min_stock as "Min stock", selling_price as "Selling price",
                           greatest(on_hand,0) * selling_price as "Stock value (MRP)" {costCols}
                    from v_inventory where is_stock_item and (@CategoryId::bigint is null or category_id = @CategoryId) {cond}
                    order by category_name, product_name, variant_name
                    """;
                money.UnionWith(new[] { "Selling price", "Stock value (MRP)", "Cost price", "Stock value (cost)" });
                break;
            }
            case "inv.reserved":
                sql = """
                    select so.number as "Sales order", c.name as "Customer", so.status as "Status", v.sku as "SKU", p.name as "Product",
                           i.reserved_qty as "Reserved", so.expected_delivery_date as "Expected delivery"
                    from sales_order_items i join sales_orders so on so.id = i.sales_order_id join customers c on c.id = so.customer_id
                    join product_variants v on v.id = i.variant_id join products p on p.id = v.product_id
                    where i.reserved_qty > 0 order by so.expected_delivery_date nulls last
                    """;
                break;
            case "inv.movement":
                sql = $"""
                    select m.created_at as "Date / time", v.sku as "SKU", p.name as "Product", m.movement_type as "Movement",
                           m.on_hand_delta as "Qty change", m.reserved_delta as "Reserved change", m.damaged_delta as "Damaged change",
                           m.on_hand_after as "On hand after", m.ref_number as "Reference", m.note as "Note", u.full_name as "By"
                    from inventory_movements m join product_variants v on v.id = m.variant_id join products p on p.id = v.product_id
                    left join users u on u.id = m.created_by
                    where m.created_at::date between @From and @To {itemFilter}
                    order by m.created_at, m.id
                    """;
                break;
            case "pay.method":
                sql = """
                    select pm.name as "Method", count(distinct p.id) as "Receipts",
                           sum(case when p.direction = 'IN' then l.amount else 0 end) as "Received",
                           sum(case when p.direction = 'OUT' then l.amount else 0 end) as "Refunded",
                           sum(case when p.direction = 'IN' then l.amount else -l.amount end) as "Net"
                    from payments p join payment_lines l on l.payment_id = p.id join payment_methods pm on pm.code = l.method_code
                    where not p.is_voided and p.payment_date between @From and @To
                    group by pm.name, pm.sort_order order by pm.sort_order
                    """;
                money.UnionWith(new[] { "Received", "Refunded", "Net" });
                break;
            case "pay.register":
                sql = """
                    select p.number as "Receipt", p.payment_date as "Date", c.name as "Customer", case when p.direction = 'IN' then 'Received' else 'Refund' end as "Type",
                           pm.name as "Method", l.reference as "Reference", l.amount as "Amount", u.full_name as "By",
                           case when p.is_voided then 'VOIDED: ' || p.void_reason else '' end as "Void"
                    from payments p join payment_lines l on l.payment_id = p.id join payment_methods pm on pm.code = l.method_code
                    join customers c on c.id = p.customer_id left join users u on u.id = p.created_by
                    where p.payment_date between @From and @To and (@CustomerId::bigint is null or p.customer_id = @CustomerId)
                    order by p.payment_date, p.id, l.id
                    """;
                money.Add("Amount");
                break;
            case "pay.outstanding":
                sql = """
                    select c.name as "Customer", c.mobile as "Mobile", b.number as "Invoice", b.invoice_date as "Invoice date", b.due_date as "Due date",
                           b.net_total as "Invoice value", b.paid as "Paid", b.balance as "Balance",
                           greatest(current_date - coalesce(b.due_date, b.invoice_date), 0) as "Days overdue",
                           case when coalesce(b.due_date, b.invoice_date) >= current_date then 'Not due'
                                when current_date - b.due_date <= 30 then '1-30 days'
                                when current_date - b.due_date <= 60 then '31-60 days'
                                when current_date - b.due_date <= 90 then '61-90 days' else '90+ days' end as "Ageing"
                    from v_invoice_balances b join customers c on c.id = b.customer_id
                    where b.balance > 0 and (@CustomerId::bigint is null or c.id = @CustomerId)
                    order by coalesce(b.due_date, b.invoice_date)
                    """;
                money.UnionWith(new[] { "Invoice value", "Paid", "Balance" });
                break;
            case "pur.supplier":
                sql = """
                    select s.name as "Supplier", s.gstin as "GSTIN",
                           (select count(*) from purchases p where p.supplier_id = s.id and p.status = 'COMPLETED' and p.purchase_date between @From and @To) as "Purchases",
                           coalesce((select sum(grand_total) from purchases p where p.supplier_id = s.id and p.status = 'COMPLETED' and p.purchase_date between @From and @To),0) as "Purchase value",
                           coalesce((select sum(amount) from supplier_payments sp where sp.supplier_id = s.id and not sp.is_voided and sp.payment_date between @From and @To),0) as "Paid in period",
                           coalesce((select sum(grand_total - returned_total) from purchases p where p.supplier_id = s.id and p.status = 'COMPLETED'),0)
                             - coalesce((select sum(amount) from supplier_payments sp where sp.supplier_id = s.id and not sp.is_voided),0) as "Total outstanding"
                    from suppliers s where not s.is_deleted and (@SupplierId::bigint is null or s.id = @SupplierId) order by 4 desc
                    """;
                money.UnionWith(new[] { "Purchase value", "Paid in period", "Total outstanding" });
                break;
            case "pur.register":
                sql = """
                    select p.number as "Purchase", p.purchase_date as "Date", s.name as "Supplier", p.supplier_invoice_no as "Supplier bill",
                           p.taxable_total as "Taxable", p.cgst_total + p.sgst_total + p.igst_total as "GST", p.grand_total as "Total", p.status as "Status"
                    from purchases p join suppliers s on s.id = p.supplier_id
                    where p.purchase_date between @From and @To and p.status <> 'DRAFT' and (@SupplierId::bigint is null or p.supplier_id = @SupplierId)
                    order by p.purchase_date, p.number
                    """;
                money.UnionWith(new[] { "Taxable", "GST", "Total" });
                break;
            case "gst.rate":
                // Delivery / installation charges are taxed at the configured charges rate and reported on their own line.
                sql = $"""
                    select 'Goods' as "Supply", it.gst_rate as "GST rate %", sum(it.taxable_amount) as "Taxable value", sum(it.cgst) as "CGST",
                           sum(it.sgst) as "SGST", sum(it.igst) as "IGST", sum(it.cgst + it.sgst + it.igst) as "Total GST"
                    from invoices i join invoice_items it on it.invoice_id = i.id where {invFilter} group by it.gst_rate
                    union all
                    select 'Delivery / installation charges', null::numeric, sum(i.delivery_charge + i.installation_charge),
                           sum(case when not i.is_inter_state then round(i.charges_tax / 2, 2) else 0 end),
                           sum(case when not i.is_inter_state then i.charges_tax - round(i.charges_tax / 2, 2) else 0 end),
                           sum(case when i.is_inter_state then i.charges_tax else 0 end), sum(i.charges_tax)
                    from invoices i where {invFilter} and (i.delivery_charge + i.installation_charge) > 0 having count(*) > 0
                    order by 1 desc, 2
                    """;
                money.UnionWith(new[] { "Taxable value", "CGST", "SGST", "IGST", "Total GST" });
                break;
            case "gst.hsn":
                sql = $"""
                    select coalesce(it.hsn_code, '-') as "HSN", coalesce(h.description, '') as "Description", it.gst_rate as "Rate %",
                           sum(it.quantity) as "Qty", sum(it.taxable_amount) as "Taxable value", sum(it.cgst) as "CGST", sum(it.sgst) as "SGST",
                           sum(it.igst) as "IGST", sum(it.line_total) as "Total value"
                    from invoices i join invoice_items it on it.invoice_id = i.id left join hsn_codes h on h.code = it.hsn_code
                    where {invFilter} group by 1, 2, 3 order by 1, 3
                    """;
                money.UnionWith(new[] { "Taxable value", "CGST", "SGST", "IGST", "Total value" });
                break;
            case "gst.invoice":
                sql = $"""
                    select i.number as "Invoice", i.invoice_date as "Date", i.customer_name as "Customer", coalesce(i.customer_gstin, '') as "GSTIN",
                           case when i.customer_gstin is not null then 'B2B' else 'B2C' end as "Type", i.place_of_supply as "Place of supply",
                           i.taxable_total as "Taxable value", i.cgst_total as "CGST", i.sgst_total as "SGST", i.igst_total as "IGST", i.grand_total as "Invoice value"
                    from invoices i where {invFilter} order by i.invoice_date, i.number
                    """;
                money.UnionWith(new[] { "Taxable value", "CGST", "SGST", "IGST", "Invoice value" });
                break;
            case "gst.creditnotes":
                sql = """
                    select r.number as "Credit note", r.return_date as "Date", i.number as "Original invoice", c.name as "Customer",
                           sum(round(ri.credit_amount * it.taxable_amount / nullif(it.line_total,0), 2)) as "Taxable value",
                           sum(round(ri.credit_amount * (it.cgst + it.sgst + it.igst) / nullif(it.line_total,0), 2)) as "GST reversed",
                           r.credit_amount as "Credit value"
                    from sales_returns r join sales_return_items ri on ri.return_id = r.id join invoice_items it on it.id = ri.invoice_item_id
                    join invoices i on i.id = r.invoice_id join customers c on c.id = r.customer_id
                    where r.return_date between @From and @To group by r.id, i.number, c.name order by r.return_date
                    """;
                money.UnionWith(new[] { "Taxable value", "GST reversed", "Credit value" });
                break;
            case "gst.purchases":
                sql = """
                    select p.number as "Purchase", p.purchase_date as "Date", s.name as "Supplier", s.gstin as "Supplier GSTIN", p.supplier_invoice_no as "Bill no",
                           p.taxable_total as "Taxable value", p.cgst_total as "CGST", p.sgst_total as "SGST", p.igst_total as "IGST", p.grand_total as "Total"
                    from purchases p join suppliers s on s.id = p.supplier_id
                    where p.status = 'COMPLETED' and p.purchase_date between @From and @To and (@SupplierId::bigint is null or p.supplier_id = @SupplierId)
                    order by p.purchase_date
                    """;
                money.UnionWith(new[] { "Taxable value", "CGST", "SGST", "IGST", "Total" });
                break;
            case "profit.summary":
                sql = $"""
                    with periods as (
                        select date_trunc('{trunc}', d)::date as period from generate_series(@From::date, @To::date, interval '1 day') d group by 1
                    ), sales as (
                        select date_trunc('{trunc}', i.invoice_date)::date as period, sum(i.taxable_total) as sales, sum(i.cost_total) as cost,
                               sum(i.delivery_charge + i.installation_charge) as charges
                        from invoices i where i.status = 'FINAL' and i.invoice_date between @From and @To group by 1
                    ), rets as (
                        select date_trunc('{trunc}', r.return_date)::date as period,
                               sum(round(ri.credit_amount * it.taxable_amount / nullif(it.line_total,0), 2)) as returned,
                               sum(case when ri.restock_action = 'RESTOCK' then ri.quantity * it.unit_cost else 0 end) as cost_back
                        from sales_returns r join sales_return_items ri on ri.return_id = r.id join invoice_items it on it.id = ri.invoice_item_id
                        where r.return_date between @From and @To group by 1
                    ), exp as (
                        select date_trunc('{trunc}', expense_date)::date as period, sum(amount) as expenses from expenses
                        where not is_deleted and expense_date between @From and @To group by 1
                    ), ops as (
                        select date_trunc('{trunc}', d)::date as period, sum(c) as ops from (
                            select coalesce(delivered_at::date, scheduled_date) as d, delivery_cost as c from deliveries where status = 'DELIVERED'
                            union all select completed_at::date, installation_cost from installations where status = 'COMPLETED') z
                        where d between @From and @To group by 1
                    )
                    select {P("pr.period")} as "Period",
                           coalesce(s.sales,0) - coalesce(r.returned,0) as "Net sales (ex-GST)",
                           coalesce(s.cost,0) - coalesce(r.cost_back,0) as "Cost of goods",
                           coalesce(s.sales,0) - coalesce(r.returned,0) - coalesce(s.cost,0) + coalesce(r.cost_back,0) as "Gross profit",
                           coalesce(e.expenses,0) as "Expenses", coalesce(o.ops,0) as "Delivery & install cost",
                           coalesce(s.sales,0) - coalesce(r.returned,0) - coalesce(s.cost,0) + coalesce(r.cost_back,0) - coalesce(e.expenses,0) - coalesce(o.ops,0) as "Net profit"
                    from periods pr left join sales s on s.period = pr.period left join rets r on r.period = pr.period
                    left join exp e on e.period = pr.period left join ops o on o.period = pr.period
                    order by pr.period
                    """;
                money.UnionWith(new[] { "Net sales (ex-GST)", "Cost of goods", "Gross profit", "Expenses", "Delivery & install cost", "Net profit" });
                break;
            case "profit.invoice":
                sql = $"""
                    select i.number as "Invoice", i.invoice_date as "Date", i.customer_name as "Customer", i.discount_total as "Discount",
                           i.taxable_total as "Sales (ex-GST)", i.cost_total as "Cost", i.taxable_total - i.cost_total as "Margin",
                           case when i.taxable_total > 0 then round((i.taxable_total - i.cost_total) * 100 / i.taxable_total, 1) end as "Margin %"
                    from invoices i where {invFilter} order by i.invoice_date, i.number
                    """;
                money.UnionWith(new[] { "Discount", "Sales (ex-GST)", "Cost", "Margin" });
                break;
            case "profit.product":
                sql = $"""
                    select coalesce(p.name, it.description) as "Product", c.name as "Category", sum(it.quantity) as "Qty",
                           sum(it.taxable_amount) as "Sales (ex-GST)", sum(it.unit_cost * it.quantity) as "Cost",
                           sum(it.taxable_amount - it.unit_cost * it.quantity) as "Margin",
                           case when sum(it.taxable_amount) > 0 then round(sum(it.taxable_amount - it.unit_cost * it.quantity) * 100 / sum(it.taxable_amount), 1) end as "Margin %"
                    from invoices i join invoice_items it on it.invoice_id = i.id
                    left join product_variants v on v.id = it.variant_id left join products p on p.id = v.product_id left join categories c on c.id = p.category_id
                    where {invFilter} {itemFilter} group by 1, 2 order by 6 desc
                    """;
                money.UnionWith(new[] { "Sales (ex-GST)", "Cost", "Margin" });
                break;
            case "expense.category":
                sql = """
                    select c.name as "Category", count(*) as "Entries", sum(e.amount) as "Amount"
                    from expenses e join expense_categories c on c.id = e.category_id
                    where not e.is_deleted and e.expense_date between @From and @To group by 1 order by 3 desc
                    """;
                money.Add("Amount");
                break;
            case "sales.commission":
                // Returns in the period are deducted at their taxable value, so commission is paid on what the shop keeps.
                sql = """
                    with sold as (
                        select coalesce(i.salesperson_id, 0) as uid, count(*) as invoices, sum(i.taxable_total) as taxable
                        from invoices i where i.status = 'FINAL' and i.invoice_date between @From and @To group by 1),
                    returned as (
                        select coalesce(i.salesperson_id, 0) as uid, sum(round(ri.quantity / it.quantity * it.taxable_amount, 2)) as taxable
                        from sales_returns r join sales_return_items ri on ri.return_id = r.id join invoice_items it on it.id = ri.invoice_item_id
                        join invoices i on i.id = r.invoice_id where r.return_date between @From and @To group by 1)
                    select coalesce(u.full_name, '(not recorded)') as "Salesperson", coalesce(s.invoices, 0) as "Invoices",
                           coalesce(s.taxable, 0) as "Sales (taxable)", coalesce(r.taxable, 0) as "Returns (taxable)",
                           coalesce(s.taxable, 0) - coalesce(r.taxable, 0) as "Net sales", coalesce(u.commission_percent, 0) as "Commission %",
                           round((coalesce(s.taxable, 0) - coalesce(r.taxable, 0)) * coalesce(u.commission_percent, 0) / 100, 2) as "Commission"
                    from sold s full join returned r on r.uid = s.uid left join users u on u.id = coalesce(s.uid, r.uid)
                    order by 5 desc
                    """;
                money.UnionWith(new[] { "Sales (taxable)", "Returns (taxable)", "Net sales", "Commission" });
                break;
            case "inv.analytics":
            {
                // Rate of sale over the chosen period drives the classification; the reorder suggestion covers 30 days of sales plus the minimum.
                var valueCol = cost ? """, round(on_hand * cost_price, 2) as "Stock value" """ : "";
                sql = $"""
                    with sales as (
                        select it.variant_id, sum(it.quantity) as qty
                        from invoice_items it join invoices i on i.id = it.invoice_id and i.status = 'FINAL' and i.invoice_date between @From and @To
                        where it.variant_id is not null group by 1),
                    lastever as (
                        select it.variant_id, max(i.invoice_date) as last_sale from invoice_items it join invoices i on i.id = it.invoice_id and i.status = 'FINAL' group by 1),
                    base as (
                        select v.variant_id, v.sku, v.product_name || case when v.variant_name <> 'Standard' then ' — ' || v.variant_name else '' end as item, v.category_name,
                               v.available, v.on_hand, v.min_stock, v.cost_price, coalesce(s.qty, 0) as sold,
                               coalesce(s.qty, 0) / greatest(1, (@To::date - @From::date + 1)) as per_day, le.last_sale
                        from v_inventory v left join sales s on s.variant_id = v.variant_id left join lastever le on le.variant_id = v.variant_id
                        where v.is_stock_item and v.product_status = 'ACTIVE' and (@CategoryId::bigint is null or v.category_id = @CategoryId)),
                    ranked as (select b.*, percent_rank() over (order by sold desc) as pr from base b)
                    select sku as "SKU", item as "Item", category_name as "Category", sold as "Sold in period", on_hand as "On hand",
                           case when per_day > 0 then round(on_hand / per_day) end as "Days of cover",
                           last_sale as "Last sold",
                           case when sold = 0 and on_hand > 0 then 'Dead' when sold = 0 then 'No stock, no sales'
                                when pr <= 0.2 then 'Fast'
                                when on_hand / per_day > 180 then 'Overstock'
                                when on_hand / per_day > 90 then 'Slow'
                                else 'Normal' end as "Movement",
                           greatest(0, ceil(per_day * 30 + min_stock - available)) as "Suggested reorder" {valueCol}
                    from ranked order by case when sold = 0 and on_hand > 0 then 0 else 1 end, sold desc, item
                    """;
                money.Add("Stock value");
                break;
            }
            default:
                throw new ArgumentException(key);
        }

        await using var conn = await db.OpenAsync();
        await using var reader = await conn.ExecuteReaderAsync(sql, args);
        var table = new DataTable(def.Title);
        table.Load(reader);
        var totals = new List<(string, string)>();
        foreach (DataColumn col in table.Columns)
            if (money.Contains(col.ColumnName) && col.DataType == typeof(decimal) && !col.ColumnName.Contains("price", StringComparison.OrdinalIgnoreCase)
                && col.ColumnName != "Average bill")
                totals.Add((col.ColumnName, Money.Format(table.AsEnumerable().Sum(r => r.IsNull(col) ? 0m : (decimal)r[col]))));

        return new ReportResult { Definition = def, Table = table, Filter = f, MoneyColumns = money, Totals = totals };
    }
}
