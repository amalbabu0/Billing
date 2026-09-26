using Dapper;
using FurniShop.Core.Security;
using FurniShop.Infrastructure.Database;
using FurniShop.Infrastructure.Security;
using Npgsql;

namespace FurniShop.Infrastructure.Services;

public sealed class PeriodFigures
{
    public DateTime From { get; set; }
    public DateTime To { get; set; }
    public decimal Sales { get; set; }
    public decimal Taxable { get; set; }
    public int Invoices { get; set; }
    public decimal AverageInvoice => Invoices == 0 ? 0 : Math.Round(Sales / Invoices, 2);
    public decimal Collected { get; set; }
    public decimal Returns { get; set; }
    public decimal? GrossMargin { get; set; }
    public decimal? MarginPercent => GrossMargin is null || Taxable == 0 ? null : Math.Round(GrossMargin.Value / Taxable * 100, 1);
    public int NewCustomers { get; set; }
    public int Quotations { get; set; }
    public int QuotationsConverted { get; set; }
    public decimal? ConversionPercent => Quotations == 0 ? null : Math.Round(QuotationsConverted * 100m / Quotations, 1);
    public decimal CustomOrderValue { get; set; }
    public List<DailyPoint> Daily { get; set; } = new();
}

public sealed class DailyPoint { public DateTime Date { get; set; } public decimal Sales { get; set; } }

public sealed class RankedRow
{
    public string Name { get; set; } = "";
    public decimal Current { get; set; }
    public decimal Previous { get; set; }
    public decimal? ChangePercent => Previous == 0 ? null : Math.Round((Current - Previous) / Previous * 100, 1);
}

public sealed class AnalyticsResult
{
    public PeriodFigures Current { get; set; } = new();
    public PeriodFigures Previous { get; set; } = new();
    public List<RankedRow> Categories { get; set; } = new();
    public List<RankedRow> Products { get; set; } = new();
    public List<RankedRow> Salespeople { get; set; } = new();
    public List<RankedRow> PaymentMethods { get; set; } = new();
}

/// <summary>Two periods side by side, all read from saved documents. Margin only for roles that may see cost.</summary>
public sealed class AnalyticsService(Db db, UserSession session)
{
    public async Task<AnalyticsResult> CompareAsync(DateTime from, DateTime to, DateTime? compareFrom = null, DateTime? compareTo = null)
    {
        session.Demand(Perm.ReportSales);
        if (to < from) (from, to) = (to, from);
        var days = (to.Date - from.Date).Days + 1;
        var pFrom = (compareFrom ?? from.AddDays(-days)).Date;
        var pTo = (compareTo ?? from.AddDays(-1)).Date;
        await using var conn = await db.OpenAsync();
        var r = new AnalyticsResult { Current = await FiguresAsync(conn, from.Date, to.Date), Previous = await FiguresAsync(conn, pFrom, pTo) };
        var args = new { cf = from.Date, ct = to.Date, pf = pFrom, pt = pTo };
        r.Categories = (await conn.QueryAsync<RankedRow>("""
            select c.name, sum(case when i.invoice_date between @cf and @ct then it.taxable_amount else 0 end) as current,
                   sum(case when i.invoice_date between @pf and @pt then it.taxable_amount else 0 end) as previous
            from invoice_items it join invoices i on i.id = it.invoice_id and i.status = 'FINAL'
            join product_variants v on v.id = it.variant_id join products p on p.id = v.product_id join categories c on c.id = p.category_id
            where i.invoice_date between least(@cf, @pf) and greatest(@ct, @pt)
            group by c.name having sum(case when i.invoice_date between @cf and @ct then it.taxable_amount else 0 end) > 0
                or sum(case when i.invoice_date between @pf and @pt then it.taxable_amount else 0 end) > 0
            order by 2 desc limit 10
            """, args)).AsList();
        r.Products = (await conn.QueryAsync<RankedRow>("""
            select it.description as name, sum(case when i.invoice_date between @cf and @ct then it.taxable_amount else 0 end) as current,
                   sum(case when i.invoice_date between @pf and @pt then it.taxable_amount else 0 end) as previous
            from invoice_items it join invoices i on i.id = it.invoice_id and i.status = 'FINAL'
            where i.invoice_date between least(@cf, @pf) and greatest(@ct, @pt)
            group by it.description having sum(case when i.invoice_date between @cf and @ct then it.taxable_amount else 0 end) > 0
            order by 2 desc limit 10
            """, args)).AsList();
        r.Salespeople = (await conn.QueryAsync<RankedRow>("""
            select coalesce(u.full_name, 'Not recorded') as name, sum(case when i.invoice_date between @cf and @ct then i.taxable_total else 0 end) as current,
                   sum(case when i.invoice_date between @pf and @pt then i.taxable_total else 0 end) as previous
            from invoices i left join users u on u.id = i.salesperson_id
            where i.status = 'FINAL' and i.invoice_date between least(@cf, @pf) and greatest(@ct, @pt)
            group by 1 order by 2 desc
            """, args)).AsList();
        r.PaymentMethods = (await conn.QueryAsync<RankedRow>("""
            select m.name, sum(case when p.payment_date between @cf and @ct then pl.amount else 0 end) as current,
                   sum(case when p.payment_date between @pf and @pt then pl.amount else 0 end) as previous
            from payment_lines pl join payments p on p.id = pl.payment_id and not p.is_voided and p.direction = 'IN' join payment_methods m on m.code = pl.method_code
            where p.payment_date between least(@cf, @pf) and greatest(@ct, @pt)
            group by m.name order by 2 desc
            """, args)).AsList();
        return r;
    }

    private async Task<PeriodFigures> FiguresAsync(NpgsqlConnection conn, DateTime from, DateTime to)
    {
        var f = await conn.QuerySingleAsync<PeriodFigures>("""
            select @from as from, @to as to,
                   coalesce(sum(grand_total), 0) as sales, coalesce(sum(taxable_total), 0) as taxable, count(*)::int as invoices,
                   coalesce(sum(taxable_total - cost_total), 0) as gross_margin
            from invoices where status = 'FINAL' and invoice_date between @from and @to
            """, new { from, to });
        f.Collected = await conn.ExecuteScalarAsync<decimal>("select coalesce(sum(case when direction = 'IN' then amount else -amount end), 0) from payments where not is_voided and payment_date between @from and @to", new { from, to });
        f.Returns = await conn.ExecuteScalarAsync<decimal>("select coalesce(sum(credit_amount), 0) from sales_returns where return_date between @from and @to", new { from, to });
        f.NewCustomers = await conn.ExecuteScalarAsync<int>("select count(*)::int from customers where not is_walk_in and created_at::date between @from and @to", new { from, to });
        f.Quotations = await conn.ExecuteScalarAsync<int>("select count(*)::int from quotations where quote_date between @from and @to", new { from, to });
        f.QuotationsConverted = await conn.ExecuteScalarAsync<int>("select count(*)::int from quotations where quote_date between @from and @to and (status = 'CONVERTED' or sales_order_id is not null)", new { from, to });
        f.CustomOrderValue = await conn.ExecuteScalarAsync<decimal>("select coalesce(sum(coalesce(nullif(final_price, 0), estimated_cost)), 0) from custom_orders where status <> 'CANCELLED' and order_date between @from and @to", new { from, to });
        f.Daily = (await conn.QueryAsync<DailyPoint>("""
            select d::date as date, coalesce((select sum(grand_total) from invoices where status = 'FINAL' and invoice_date = d::date), 0) as sales
            from generate_series(@from::date, @to::date, interval '1 day') d order by 1
            """, new { from, to })).AsList();
        if (!session.CanSeeCost) f.GrossMargin = null;
        return f;
    }
}
