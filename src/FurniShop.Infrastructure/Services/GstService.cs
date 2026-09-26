using System.Text.RegularExpressions;
using ClosedXML.Excel;
using Dapper;
using FurniShop.Core;
using FurniShop.Core.Domain;
using FurniShop.Core.Security;
using FurniShop.Core.Validation;
using FurniShop.Infrastructure.Database;
using FurniShop.Infrastructure.Security;
using Npgsql;

namespace FurniShop.Infrastructure.Services;

// ============================================================================ models

public sealed class GstFilter
{
    public DateTime From { get; set; } = new(DateTime.Today.Year, DateTime.Today.Month, 1);
    public DateTime To { get; set; } = DateTime.Today;
    public string? Search { get; set; }
    /// <summary>"B2B" (with GSTIN), "B2C" (without) or null.</summary>
    public string? Type { get; set; }
    public string? Gstin { get; set; }
    public long? CustomerId { get; set; }
    public long? SupplierId { get; set; }
    public string? StateCode { get; set; }
    public decimal? Rate { get; set; }
    /// <summary>Invoice status (FINAL / CANCELLED); null = both.</summary>
    public string? Status { get; set; }
    /// <summary>PAID / PARTIAL / UNPAID / OVERDUE.</summary>
    public string? PaymentState { get; set; }
    public string? SortBy { get; set; }
    public bool SortDescending { get; set; }
    public int Page { get; set; } = 1;
    public int PageSize { get; set; } = 50;
    public int Offset => Math.Max(0, (Page - 1) * PageSize);
}

public sealed class TaxAmounts
{
    public int Count { get; set; }
    public decimal Taxable { get; set; }
    public decimal Cgst { get; set; }
    public decimal Sgst { get; set; }
    public decimal Igst { get; set; }
    public decimal Total { get; set; }
    public decimal Tax => Cgst + Sgst + Igst;
}

public sealed class GstPeriodRow
{
    public DateTime Period { get; set; }
    public decimal OutputTax { get; set; }
    public decimal InputTax { get; set; }
    public decimal Net => OutputTax - InputTax;
}

public sealed class GstDashboard
{
    public DateTime From { get; set; }
    public DateTime To { get; set; }
    public bool Registered { get; set; }
    public string? Gstin { get; set; }
    public TaxAmounts Sales { get; set; } = new();
    public TaxAmounts B2b { get; set; } = new();
    public TaxAmounts B2c { get; set; } = new();
    public TaxAmounts CreditNotes { get; set; } = new();
    public TaxAmounts Purchases { get; set; } = new();
    public TaxAmounts DebitNotes { get; set; } = new();
    public int CancelledInvoices { get; set; }
    public decimal OutputTax => Sales.Tax - CreditNotes.Tax;
    public decimal InputTax => Purchases.Tax - DebitNotes.Tax;
    /// <summary>Positive: GST payable; negative: input credit carried forward.</summary>
    public decimal NetPosition => OutputTax - InputTax;
    public List<GstPeriodRow> Trend { get; set; } = new();
    public List<GstRateRow> Rates { get; set; } = new();
}

public sealed class GstSaleRow
{
    public long Id { get; set; }
    public string Number { get; set; } = "";
    public DateTime Date { get; set; }
    public long CustomerId { get; set; }
    public string CustomerName { get; set; } = "";
    public string? CustomerGstin { get; set; }
    public string? PlaceOfSupply { get; set; }
    public string? PlaceOfSupplyName => IndianStates.NameOf(PlaceOfSupply);
    public bool IsInterState { get; set; }
    public decimal Taxable { get; set; }
    public decimal Cgst { get; set; }
    public decimal Sgst { get; set; }
    public decimal Igst { get; set; }
    public decimal TotalGst => Cgst + Sgst + Igst;
    public decimal InvoiceTotal { get; set; }
    public string Status { get; set; } = "";
    public string? PaymentState { get; set; }
    public string Type => string.IsNullOrEmpty(CustomerGstin) ? "B2C" : "B2B";
}

public sealed class GstPurchaseRow
{
    public long Id { get; set; }
    public string Number { get; set; } = "";
    public DateTime Date { get; set; }
    public long SupplierId { get; set; }
    public string SupplierName { get; set; } = "";
    public string? SupplierGstin { get; set; }
    public string? SupplierInvoiceNo { get; set; }
    public string? PlaceOfSupply { get; set; }
    public string? PlaceOfSupplyName => IndianStates.NameOf(PlaceOfSupply);
    public decimal Taxable { get; set; }
    public decimal Cgst { get; set; }
    public decimal Sgst { get; set; }
    public decimal Igst { get; set; }
    public decimal TotalGst => Cgst + Sgst + Igst;
    public decimal PurchaseTotal { get; set; }
    public string? PaymentState { get; set; }
}

public sealed class GstNoteRow
{
    public long Id { get; set; }
    public string Number { get; set; } = "";
    public DateTime Date { get; set; }
    public long PartyId { get; set; }
    public string PartyName { get; set; } = "";
    public string? PartyGstin { get; set; }
    public long OriginalId { get; set; }
    public string? OriginalNumber { get; set; }
    public string? PlaceOfSupply { get; set; }
    public string? PlaceOfSupplyName => IndianStates.NameOf(PlaceOfSupply);
    public string Reason { get; set; } = "";
    public decimal Taxable { get; set; }
    public decimal Cgst { get; set; }
    public decimal Sgst { get; set; }
    public decimal Igst { get; set; }
    public decimal TotalGst => Cgst + Sgst + Igst;
    public decimal NoteTotal { get; set; }
}

public sealed class GstHsnRow
{
    public string Hsn { get; set; } = "";
    public string? Description { get; set; }
    public string? Products { get; set; }
    public decimal Rate { get; set; }
    public decimal Quantity { get; set; }
    public decimal Taxable { get; set; }
    public decimal Cgst { get; set; }
    public decimal Sgst { get; set; }
    public decimal Igst { get; set; }
    public decimal TotalTax => Cgst + Sgst + Igst;
    public decimal TotalValue { get; set; }
}

public sealed class GstRateRow
{
    public string Supply { get; set; } = "Goods";
    public decimal? Rate { get; set; }
    public int Invoices { get; set; }
    public decimal Taxable { get; set; }
    public decimal Cgst { get; set; }
    public decimal Sgst { get; set; }
    public decimal Igst { get; set; }
    public decimal TotalTax => Cgst + Sgst + Igst;
}

public sealed class TaxLedgerRow
{
    public DateTime Period { get; set; }
    public decimal Output { get; set; }
    public decimal CreditNotes { get; set; }
    public decimal Input { get; set; }
    public decimal DebitNotes { get; set; }
    public decimal NetOutput => Output - CreditNotes;
    public decimal NetInput => Input - DebitNotes;
    public decimal Net => NetOutput - NetInput;
}

public sealed class RegisterRow
{
    public long Id { get; set; }
    public string Number { get; set; } = "";
    public DateTime Date { get; set; }
    public string CustomerName { get; set; } = "";
    public string? CustomerGstin { get; set; }
    public decimal Taxable { get; set; }
    public decimal Tax { get; set; }
    public decimal InvoiceTotal { get; set; }
    public string Status { get; set; } = "";
    public DateTime? CancelledAt { get; set; }
    public string? CancelReason { get; set; }
}

public sealed class InvoiceRegister
{
    public List<RegisterRow> Rows { get; set; } = new();
    public int Issued { get; set; }
    public int Cancelled { get; set; }
    public string? FirstNumber { get; set; }
    public string? LastNumber { get; set; }
    /// <summary>Numbers missing from a series (should always be empty — numbering is gap-free).</summary>
    public List<string> Gaps { get; set; } = new();
}

public sealed class GstPage<T>
{
    public IReadOnlyList<T> Items { get; init; } = Array.Empty<T>();
    public int TotalCount { get; init; }
    public int Page { get; init; }
    public int PageSize { get; init; }
    public TaxAmounts Totals { get; init; } = new();
}

// ============================================================================ service

/// <summary>
/// GST &amp; tax: dashboards, listings and GSTR-style exports. Everything is read from the stored document
/// tax columns written by <see cref="Core.Tax.GstCalculator"/> — nothing is recomputed here, so reports
/// always agree with the printed invoices.
/// </summary>
public sealed class GstService(Db db, UserSession session)
{
    /// <summary>Inter-state B2C invoices above this value are reported individually (GSTR-1 table 5, "B2C Large").</summary>
    public const decimal B2cLargeLimit = 100000m;

    private const string Final = "i.status = 'FINAL'";

    private const string SalesWhere = """
        i.status <> 'DRAFT' and i.invoice_date between @From and @To
          and (@Status::text is null or i.status = @Status)
          and (@CustomerId::bigint is null or i.customer_id = @CustomerId)
          and (@StateCode::text is null or i.place_of_supply = @StateCode)
          and (@Type::text is null or (@Type = 'B2B' and i.customer_gstin is not null) or (@Type = 'B2C' and i.customer_gstin is null))
          and (@Gstin::text is null or i.customer_gstin ilike '%' || @Gstin || '%')
          and (@Rate::numeric is null or exists (select 1 from invoice_items r where r.invoice_id = i.id and r.gst_rate = @Rate))
          and (@Search::text is null or i.number ilike '%' || @Search || '%' or i.customer_name ilike '%' || @Search || '%'
               or i.customer_gstin ilike '%' || @Search || '%')
        """;

    private const string PaymentStateSql = """
        case when i.status <> 'FINAL' then i.status
             when coalesce(b.balance, 0) <= 0 then 'PAID'
             when i.due_date < current_date then 'OVERDUE'
             when coalesce(b.paid, 0) > 0 then 'PARTIAL' else 'UNPAID' end
        """;

    private static object Args(GstFilter f) => new
    {
        From = f.From.Date, To = f.To.Date, Search = Blank(f.Search), Type = Blank(f.Type)?.ToUpperInvariant(), Gstin = Blank(f.Gstin),
        f.CustomerId, f.SupplierId, StateCode = Blank(f.StateCode), f.Rate, Status = Blank(f.Status), PaymentState = Blank(f.PaymentState),
        f.PageSize, f.Offset,
    };

    private void Demand() => session.Demand(Perm.ReportGst);

    // ------------------------------------------------------------------ dashboard
    public async Task<GstDashboard> DashboardAsync(DateTime from, DateTime to)
    {
        Demand();
        var a = new { From = from.Date, To = to.Date };
        await using var conn = await db.OpenAsync();
        var shop = (await SettingsService.LoadAsync(conn, null)).Shop;
        var tax = (await SettingsService.LoadAsync(conn, null)).Tax;
        var d = new GstDashboard { From = from.Date, To = to.Date, Registered = tax.GstRegistered, Gstin = shop.Gstin };

        const string sums = "count(*) as count, coalesce(sum({0}taxable_total),0) as taxable, coalesce(sum({0}cgst_total),0) as cgst, coalesce(sum({0}sgst_total),0) as sgst, coalesce(sum({0}igst_total),0) as igst, coalesce(sum({0}grand_total),0) as total";
        var s = string.Format(sums, "i.");
        d.Sales = await conn.QuerySingleAsync<TaxAmounts>($"select {s} from invoices i where {Final} and i.invoice_date between @From and @To", a);
        d.B2b = await conn.QuerySingleAsync<TaxAmounts>($"select {s} from invoices i where {Final} and i.customer_gstin is not null and i.invoice_date between @From and @To", a);
        d.B2c = await conn.QuerySingleAsync<TaxAmounts>($"select {s} from invoices i where {Final} and i.customer_gstin is null and i.invoice_date between @From and @To", a);
        d.CancelledInvoices = await conn.ExecuteScalarAsync<int>("select count(*) from invoices where status = 'CANCELLED' and invoice_date between @From and @To", a);
        d.CreditNotes = await conn.QuerySingleAsync<TaxAmounts>($"""
            select count(distinct n.id) as count, coalesce(sum(n.taxable),0) as taxable, coalesce(sum(n.cgst),0) as cgst, coalesce(sum(n.sgst),0) as sgst,
                   coalesce(sum(n.igst),0) as igst, coalesce(sum(n.total),0) as total
            from ({CreditNoteLines}) n where n.date between @From and @To
            """, a);
        d.Purchases = await conn.QuerySingleAsync<TaxAmounts>(
            $"select {string.Format(sums, "p.")} from purchases p where p.status = 'COMPLETED' and p.purchase_date between @From and @To", a);
        d.DebitNotes = await conn.QuerySingleAsync<TaxAmounts>(
            $"select {string.Format(sums, "d.")} from purchase_returns d where d.return_date between @From and @To", a);

        // Monthly trend across the selected range (at least the last 6 months so the chart is meaningful).
        var trendFrom = new DateTime(Math.Min(from.Ticks, to.AddMonths(-5).Ticks)).Date;
        trendFrom = new DateTime(trendFrom.Year, trendFrom.Month, 1);
        d.Trend = (await conn.QueryAsync<GstPeriodRow>($"""
            with months as (select generate_series(@F::date, date_trunc('month', @To::date)::date, interval '1 month')::date as period),
            o as (select date_trunc('month', invoice_date)::date as period, sum(cgst_total + sgst_total + igst_total) as tax
                  from invoices where status = 'FINAL' and invoice_date between @F and @To group by 1),
            c as (select date_trunc('month', n.date)::date as period, sum(n.cgst + n.sgst + n.igst) as tax from ({CreditNoteLines}) n
                  where n.date between @F and @To group by 1),
            p as (select date_trunc('month', purchase_date)::date as period, sum(cgst_total + sgst_total + igst_total) as tax
                  from purchases where status = 'COMPLETED' and purchase_date between @F and @To group by 1),
            dn as (select date_trunc('month', return_date)::date as period, sum(cgst_total + sgst_total + igst_total) as tax
                  from purchase_returns where return_date between @F and @To group by 1)
            select m.period, coalesce(o.tax,0) - coalesce(c.tax,0) as output_tax, coalesce(p.tax,0) - coalesce(dn.tax,0) as input_tax
            from months m left join o using (period) left join c using (period) left join p using (period) left join dn using (period)
            order by m.period
            """, new { F = trendFrom, a.To })).AsList();
        d.Rates = (await RatesAsync(conn, from, to, "sales")).ToList();
        return d;
    }

    // Credit note lines with GST split proportionally from the original invoice line (exact for full-line returns).
    private const string CreditNoteLines = """
        select r.id, r.number, r.return_date as date, r.customer_id, r.invoice_id, r.reason, it.gst_rate,
               round(it.taxable_amount * ri.quantity / it.quantity, 2) as taxable,
               round(it.cgst * ri.quantity / it.quantity, 2) as cgst,
               round(it.sgst * ri.quantity / it.quantity, 2) as sgst,
               round(it.igst * ri.quantity / it.quantity, 2) as igst,
               ri.credit_amount as total
        from sales_returns r join sales_return_items ri on ri.return_id = r.id join invoice_items it on it.id = ri.invoice_item_id
        """;

    // ------------------------------------------------------------------ sales listing
    public async Task<GstPage<GstSaleRow>> SalesAsync(GstFilter f)
    {
        Demand();
        var order = f.SortBy switch
        {
            "number" => "i.number", "customer" => "i.customer_name", "taxable" => "i.taxable_total", "tax" => "(i.cgst_total + i.sgst_total + i.igst_total)",
            "total" => "i.grand_total", "pos" => "i.place_of_supply", _ => "i.invoice_date",
        } + (f.SortDescending ? " desc" : " asc") + ", i.id" + (f.SortDescending ? " desc" : "");
        var payFilter = Blank(f.PaymentState) is null ? "" : $"and ({PaymentStateSql}) = @PaymentState";
        var from = $"from invoices i left join v_invoice_balances b on b.invoice_id = i.id where {SalesWhere} {payFilter}";
        await using var conn = await db.OpenAsync();
        var args = Args(f);
        var totals = await conn.QuerySingleAsync<TaxAmounts>($"""
            select count(*) as count,
                   coalesce(sum(i.taxable_total) filter (where {Final}),0) as taxable, coalesce(sum(i.cgst_total) filter (where {Final}),0) as cgst,
                   coalesce(sum(i.sgst_total) filter (where {Final}),0) as sgst, coalesce(sum(i.igst_total) filter (where {Final}),0) as igst,
                   coalesce(sum(i.grand_total) filter (where {Final}),0) as total
            {from}
            """, args);
        var rows = await conn.QueryAsync<GstSaleRow>($"""
            select i.id, i.number, i.invoice_date as date, i.customer_id, i.customer_name, i.customer_gstin, i.place_of_supply, i.is_inter_state,
                   i.taxable_total as taxable, i.cgst_total as cgst, i.sgst_total as sgst, i.igst_total as igst, i.grand_total as invoice_total,
                   i.status, {PaymentStateSql} as payment_state
            {from} order by {order} limit @PageSize offset @Offset
            """, args);
        return new GstPage<GstSaleRow> { Items = rows.AsList(), TotalCount = totals.Count, Page = f.Page, PageSize = f.PageSize, Totals = totals };
    }

    // ------------------------------------------------------------------ purchase listing
    public async Task<GstPage<GstPurchaseRow>> PurchasesAsync(GstFilter f)
    {
        Demand();
        var order = f.SortBy switch
        {
            "number" => "p.number", "supplier" => "s.name", "taxable" => "p.taxable_total", "tax" => "(p.cgst_total + p.sgst_total + p.igst_total)",
            "total" => "p.grand_total", _ => "p.purchase_date",
        } + (f.SortDescending ? " desc" : " asc") + ", p.id";
        const string paid = """
            coalesce((select sum(a.amount) from supplier_payment_allocations a join supplier_payments sp on sp.id = a.supplier_payment_id and not sp.is_voided
                      where a.purchase_id = p.id), 0)
            """;
        var state = $"""
            case when p.grand_total - p.returned_total - {paid} <= 0 then 'PAID'
                 when p.due_date < current_date then 'OVERDUE'
                 when {paid} > 0 then 'PARTIAL' else 'UNPAID' end
            """;
        var where = $"""
            from purchases p join suppliers s on s.id = p.supplier_id
            where p.status = 'COMPLETED' and p.purchase_date between @From and @To
              and (@SupplierId::bigint is null or p.supplier_id = @SupplierId)
              and (@StateCode::text is null or s.state_code = @StateCode)
              and (@Type::text is null or (@Type = 'B2B' and s.gstin is not null) or (@Type = 'B2C' and s.gstin is null))
              and (@Gstin::text is null or s.gstin ilike '%' || @Gstin || '%')
              and (@Rate::numeric is null or exists (select 1 from purchase_items r where r.purchase_id = p.id and r.gst_rate = @Rate))
              and (@Search::text is null or p.number ilike '%' || @Search || '%' or s.name ilike '%' || @Search || '%'
                   or s.gstin ilike '%' || @Search || '%' or p.supplier_invoice_no ilike '%' || @Search || '%')
              {(Blank(f.PaymentState) is null ? "" : $"and ({state}) = @PaymentState")}
            """;
        await using var conn = await db.OpenAsync();
        var args = Args(f);
        var totals = await conn.QuerySingleAsync<TaxAmounts>($"""
            select count(*) as count, coalesce(sum(p.taxable_total),0) as taxable, coalesce(sum(p.cgst_total),0) as cgst, coalesce(sum(p.sgst_total),0) as sgst,
                   coalesce(sum(p.igst_total),0) as igst, coalesce(sum(p.grand_total),0) as total {where}
            """, args);
        var rows = await conn.QueryAsync<GstPurchaseRow>($"""
            select p.id, p.number, p.purchase_date as date, p.supplier_id, s.name as supplier_name, s.gstin as supplier_gstin, p.supplier_invoice_no,
                   s.state_code as place_of_supply, p.taxable_total as taxable, p.cgst_total as cgst, p.sgst_total as sgst, p.igst_total as igst,
                   p.grand_total as purchase_total, {state} as payment_state
            {where} order by {order} limit @PageSize offset @Offset
            """, args);
        return new GstPage<GstPurchaseRow> { Items = rows.AsList(), TotalCount = totals.Count, Page = f.Page, PageSize = f.PageSize, Totals = totals };
    }

    // ------------------------------------------------------------------ credit / debit notes
    public async Task<GstPage<GstNoteRow>> CreditNotesAsync(GstFilter f)
    {
        Demand();
        var where = """
            where n.date between @From and @To and (@CustomerId::bigint is null or n.customer_id = @CustomerId)
              and (@Type::text is null or (@Type = 'B2B' and i.customer_gstin is not null) or (@Type = 'B2C' and i.customer_gstin is null))
              and (@Search::text is null or n.number ilike '%' || @Search || '%' or i.number ilike '%' || @Search || '%'
                   or i.customer_name ilike '%' || @Search || '%' or i.customer_gstin ilike '%' || @Search || '%')
            """;
        var grouped = $"""
            select n.id, n.number, n.date, n.customer_id as party_id, i.customer_name as party_name, i.customer_gstin as party_gstin,
                   n.invoice_id as original_id, i.number as original_number, i.place_of_supply, n.reason,
                   sum(n.taxable) as taxable, sum(n.cgst) as cgst, sum(n.sgst) as sgst, sum(n.igst) as igst, sum(n.total) as note_total
            from ({CreditNoteLines}) n join invoices i on i.id = n.invoice_id {where}
            group by n.id, n.number, n.date, n.customer_id, i.customer_name, i.customer_gstin, n.invoice_id, i.number, i.place_of_supply, n.reason
            """;
        return await NotesPageAsync(grouped, f);
    }

    public async Task<GstPage<GstNoteRow>> DebitNotesAsync(GstFilter f)
    {
        Demand();
        var sql = """
            select d.id, d.number, d.return_date as date, d.supplier_id as party_id, s.name as party_name, s.gstin as party_gstin,
                   d.purchase_id as original_id, coalesce(p.supplier_invoice_no, p.number) as original_number, s.state_code as place_of_supply, d.reason,
                   d.taxable_total as taxable, d.cgst_total as cgst, d.sgst_total as sgst, d.igst_total as igst, d.grand_total as note_total
            from purchase_returns d join purchases p on p.id = d.purchase_id join suppliers s on s.id = d.supplier_id
            where d.return_date between @From and @To and (@SupplierId::bigint is null or d.supplier_id = @SupplierId)
              and (@Search::text is null or d.number ilike '%' || @Search || '%' or p.number ilike '%' || @Search || '%'
                   or s.name ilike '%' || @Search || '%' or s.gstin ilike '%' || @Search || '%')
            """;
        return await NotesPageAsync(sql, f);
    }

    private async Task<GstPage<GstNoteRow>> NotesPageAsync(string sql, GstFilter f)
    {
        await using var conn = await db.OpenAsync();
        var args = Args(f);
        var totals = await conn.QuerySingleAsync<TaxAmounts>($"""
            select count(*) as count, coalesce(sum(taxable),0) as taxable, coalesce(sum(cgst),0) as cgst, coalesce(sum(sgst),0) as sgst,
                   coalesce(sum(igst),0) as igst, coalesce(sum(note_total),0) as total from ({sql}) x
            """, args);
        var rows = await conn.QueryAsync<GstNoteRow>($"select * from ({sql}) x order by date {(f.SortDescending ? "desc" : "asc")}, id limit @PageSize offset @Offset", args);
        return new GstPage<GstNoteRow> { Items = rows.AsList(), TotalCount = totals.Count, Page = f.Page, PageSize = f.PageSize, Totals = totals };
    }

    // ------------------------------------------------------------------ HSN & rate summaries
    public async Task<IReadOnlyList<GstHsnRow>> HsnSummaryAsync(DateTime from, DateTime to, string side = "sales", string? search = null)
    {
        Demand();
        var a = new { From = from.Date, To = to.Date, Search = Blank(search) };
        var sql = side == "purchases"
            ? """
              select coalesce(it.hsn_code, '—') as hsn, max(h.description) as description, it.gst_rate as rate,
                     string_agg(distinct pr.name, ', ') as products, sum(it.quantity) as quantity, sum(it.taxable_amount) as taxable,
                     sum(it.cgst) as cgst, sum(it.sgst) as sgst, sum(it.igst) as igst, sum(it.line_total) as total_value
              from purchases p join purchase_items it on it.purchase_id = p.id
              join product_variants v on v.id = it.variant_id join products pr on pr.id = v.product_id
              left join hsn_codes h on h.code = it.hsn_code
              where p.status = 'COMPLETED' and p.purchase_date between @From and @To
                and (@Search::text is null or it.hsn_code ilike @Search || '%' or pr.name ilike '%' || @Search || '%')
              group by 1, 3 order by 1, 3
              """
            : """
              select coalesce(it.hsn_code, '—') as hsn, max(h.description) as description, it.gst_rate as rate,
                     string_agg(distinct coalesce(pr.name, it.description), ', ') as products, sum(it.quantity) as quantity,
                     sum(it.taxable_amount) as taxable, sum(it.cgst) as cgst, sum(it.sgst) as sgst, sum(it.igst) as igst, sum(it.line_total) as total_value
              from invoices i join invoice_items it on it.invoice_id = i.id
              left join product_variants v on v.id = it.variant_id left join products pr on pr.id = v.product_id
              left join hsn_codes h on h.code = it.hsn_code
              where i.status = 'FINAL' and i.invoice_date between @From and @To
                and (@Search::text is null or it.hsn_code ilike @Search || '%' or pr.name ilike '%' || @Search || '%' or it.description ilike '%' || @Search || '%')
              group by 1, 3 order by 1, 3
              """;
        return await db.QueryAsync<GstHsnRow>(sql, a);
    }

    public async Task<IReadOnlyList<GstRateRow>> RateSummaryAsync(DateTime from, DateTime to, string side = "sales")
    {
        Demand();
        await using var conn = await db.OpenAsync();
        return (await RatesAsync(conn, from, to, side)).AsList();
    }

    private static Task<IEnumerable<GstRateRow>> RatesAsync(NpgsqlConnection conn, DateTime from, DateTime to, string side) =>
        conn.QueryAsync<GstRateRow>(side == "purchases"
            ? """
              select 'Goods' as supply, it.gst_rate as rate, count(distinct p.id) as invoices, sum(it.taxable_amount) as taxable,
                     sum(it.cgst) as cgst, sum(it.sgst) as sgst, sum(it.igst) as igst
              from purchases p join purchase_items it on it.purchase_id = p.id
              where p.status = 'COMPLETED' and p.purchase_date between @From and @To group by it.gst_rate order by it.gst_rate
              """
            : """
              select * from (
                  select 'Goods' as supply, it.gst_rate as rate, count(distinct i.id) as invoices, sum(it.taxable_amount) as taxable,
                         sum(it.cgst) as cgst, sum(it.sgst) as sgst, sum(it.igst) as igst
                  from invoices i join invoice_items it on it.invoice_id = i.id
                  where i.status = 'FINAL' and i.invoice_date between @From and @To group by it.gst_rate
                  union all
                  -- charges carry no stored rate; it is implied by tax ÷ taxable (whole-number GST slabs)
                  select 'Delivery & installation', round(100 * i.charges_tax / (i.delivery_charge + i.installation_charge)), count(*),
                         sum(i.delivery_charge + i.installation_charge),
                         sum(case when not i.is_inter_state then round(i.charges_tax / 2, 2) else 0 end),
                         sum(case when not i.is_inter_state then i.charges_tax - round(i.charges_tax / 2, 2) else 0 end),
                         sum(case when i.is_inter_state then i.charges_tax else 0 end)
                  from invoices i where i.status = 'FINAL' and i.invoice_date between @From and @To and (i.delivery_charge + i.installation_charge) > 0
                  group by 2
              ) x order by supply desc, rate
              """, new { From = from.Date, To = to.Date });

    // ------------------------------------------------------------------ tax ledger (output / input / CGST / SGST / IGST)
    /// <summary>Monthly output vs input tax. <paramref name="component"/> = CGST / SGST / IGST limits it to one head; null = all GST.</summary>
    public async Task<IReadOnlyList<TaxLedgerRow>> TaxLedgerAsync(DateTime from, DateTime to, string? component = null)
    {
        Demand();
        var (inv, line, hdr) = component?.ToUpperInvariant() switch
        {
            "CGST" => ("cgst_total", "cgst", "cgst_total"),
            "SGST" => ("sgst_total", "sgst", "sgst_total"),
            "IGST" => ("igst_total", "igst", "igst_total"),
            _ => ("cgst_total + sgst_total + igst_total", "cgst + sgst + igst", "cgst_total + sgst_total + igst_total"),
        };
        return await db.QueryAsync<TaxLedgerRow>($"""
            with months as (select generate_series(date_trunc('month', @From::date)::date, date_trunc('month', @To::date)::date, interval '1 month')::date as period),
            o as (select date_trunc('month', invoice_date)::date as period, sum({inv}) as v from invoices where status = 'FINAL' and invoice_date between @From and @To group by 1),
            c as (select date_trunc('month', n.date)::date as period, sum(n.{line.Replace(" + ", " + n.")}) as v from ({CreditNoteLines}) n where n.date between @From and @To group by 1),
            p as (select date_trunc('month', purchase_date)::date as period, sum({hdr}) as v from purchases where status = 'COMPLETED' and purchase_date between @From and @To group by 1),
            d as (select date_trunc('month', return_date)::date as period, sum({hdr}) as v from purchase_returns where return_date between @From and @To group by 1)
            select m.period, coalesce(o.v,0) as output, coalesce(c.v,0) as credit_notes, coalesce(p.v,0) as input, coalesce(d.v,0) as debit_notes
            from months m left join o using (period) left join c using (period) left join p using (period) left join d using (period)
            order by m.period
            """, new { From = from.Date, To = to.Date });
    }

    // ------------------------------------------------------------------ invoice register
    public async Task<InvoiceRegister> RegisterAsync(DateTime from, DateTime to, string? search = null)
    {
        Demand();
        var rows = (await db.QueryAsync<RegisterRow>("""
            select i.id, i.number, i.invoice_date as date, i.customer_name, i.customer_gstin, i.taxable_total as taxable,
                   i.cgst_total + i.sgst_total + i.igst_total as tax, i.grand_total as invoice_total, i.status, i.cancelled_at, i.cancel_reason
            from invoices i where i.number is not null and i.invoice_date between @From and @To
              and (@Search::text is null or i.number ilike '%' || @Search || '%' or i.customer_name ilike '%' || @Search || '%')
            order by i.number
            """, new { From = from.Date, To = to.Date, Search = Blank(search) })).AsList();
        var reg = new InvoiceRegister
        {
            Rows = rows, Issued = rows.Count, Cancelled = rows.Count(r => r.Status == InvoiceStatus.Cancelled),
            FirstNumber = rows.FirstOrDefault()?.Number, LastNumber = rows.LastOrDefault()?.Number,
        };
        if (Blank(search) is null) reg.Gaps = FindGaps(rows.Select(r => r.Number));
        return reg;
    }

    /// <summary>Series = everything before the trailing digits (e.g. "INV-2026-"); reports missing numbers inside each series.</summary>
    internal static List<string> FindGaps(IEnumerable<string> numbers)
    {
        var gaps = new List<string>();
        foreach (var series in numbers.Select(n => Regex.Match(n, @"^(.*?)(\d+)$")).Where(m => m.Success)
                     .GroupBy(m => m.Groups[1].Value))
        {
            var width = series.First().Groups[2].Value.Length;
            var values = series.Select(m => long.Parse(m.Groups[2].Value)).Distinct().OrderBy(v => v).ToList();
            for (var i = 1; i < values.Count && gaps.Count < 50; i++)
                for (var v = values[i - 1] + 1; v < values[i] && gaps.Count < 50; v++)
                    gaps.Add(series.Key + v.ToString().PadLeft(width, '0'));
        }
        return gaps;
    }

    // ------------------------------------------------------------------ export
    /// <summary>
    /// GSTR-1 style workbook for the accountant: B2B, B2C Large, B2C Small, credit notes (registered / unregistered),
    /// HSN summary, documents issued, plus purchases and debit notes for input-credit reconciliation.
    /// </summary>
    public async Task<byte[]> ExportWorkbookAsync(DateTime from, DateTime to)
    {
        session.Demand(Perm.ReportGst);
        session.Demand(Perm.ExportData);
        var all = new GstFilter { From = from, To = to, Status = InvoiceStatus.Final, PageSize = 100000 };
        var sales = (await SalesAsync(all)).Items;
        var credit = (await CreditNotesAsync(new GstFilter { From = from, To = to, PageSize = 100000 })).Items;
        var purchases = (await PurchasesAsync(new GstFilter { From = from, To = to, PageSize = 100000 })).Items;
        var debit = (await DebitNotesAsync(new GstFilter { From = from, To = to, PageSize = 100000 })).Items;
        var hsn = await HsnSummaryAsync(from, to);
        var register = await RegisterAsync(from, to);
        await using var conn = await db.OpenAsync();
        var s = await SettingsService.LoadAsync(conn, null);
        var rateLines = (await conn.QueryAsync<(long InvoiceId, decimal Rate, decimal Taxable, decimal Cgst, decimal Sgst, decimal Igst)>("""
            select it.invoice_id, it.gst_rate, sum(it.taxable_amount), sum(it.cgst), sum(it.sgst), sum(it.igst)
            from invoice_items it join invoices i on i.id = it.invoice_id
            where i.status = 'FINAL' and i.invoice_date between @From and @To group by 1, 2
            """, new { From = from.Date, To = to.Date })).ToLookup(r => r.InvoiceId);

        using var wb = new XLWorkbook();
        var period = $"{from:dd-MMM-yyyy} to {to:dd-MMM-yyyy}";

        Sheet(wb, "Summary", period, new[] { "Particulars", "Count", "Taxable value", "CGST", "SGST", "IGST", "Total tax" },
            new object?[][]
            {
                Row("Outward supplies (B2B)", sales.Where(x => x.Type == "B2B")),
                Row("Outward supplies (B2C)", sales.Where(x => x.Type == "B2C")),
                new object?[] { "Credit notes issued", credit.Count, credit.Sum(x => x.Taxable), credit.Sum(x => x.Cgst), credit.Sum(x => x.Sgst), credit.Sum(x => x.Igst), credit.Sum(x => x.TotalGst) },
                new object?[] { "Inward supplies (purchases)", purchases.Count, purchases.Sum(x => x.Taxable), purchases.Sum(x => x.Cgst), purchases.Sum(x => x.Sgst), purchases.Sum(x => x.Igst), purchases.Sum(x => x.TotalGst) },
                new object?[] { "Debit notes issued", debit.Count, debit.Sum(x => x.Taxable), debit.Sum(x => x.Cgst), debit.Sum(x => x.Sgst), debit.Sum(x => x.Igst), debit.Sum(x => x.TotalGst) },
            }, moneyFrom: 2);

        object?[] Row(string label, IEnumerable<GstSaleRow> rows)
        {
            var l = rows.ToList();
            return new object?[] { label, l.Count, l.Sum(x => x.Taxable), l.Sum(x => x.Cgst), l.Sum(x => x.Sgst), l.Sum(x => x.Igst), l.Sum(x => x.TotalGst) };
        }

        // B2B — one row per invoice per rate (GSTR-1 table 4)
        Sheet(wb, "B2B", period, new[] { "GSTIN of recipient", "Receiver name", "Invoice number", "Invoice date", "Invoice value", "Place of supply", "Reverse charge", "Rate", "Taxable value", "CGST", "SGST", "IGST" },
            sales.Where(x => x.Type == "B2B").SelectMany(x => rateLines[x.Id].Select(r => new object?[]
            {
                x.CustomerGstin, x.CustomerName, x.Number, x.Date, x.InvoiceTotal, Pos(x.PlaceOfSupply), "N", r.Rate, r.Taxable, r.Cgst, r.Sgst, r.Igst,
            })), moneyFrom: 8, dateCols: new[] { 4 }, moneyCols: new[] { 5 });

        // B2C Large — inter-state invoices above the limit to unregistered persons (table 5)
        Sheet(wb, "B2CL", period, new[] { "Invoice number", "Invoice date", "Invoice value", "Place of supply", "Rate", "Taxable value", "IGST" },
            sales.Where(x => x.Type == "B2C" && x.IsInterState && x.InvoiceTotal > B2cLargeLimit).SelectMany(x => rateLines[x.Id].Select(r => new object?[]
            {
                x.Number, x.Date, x.InvoiceTotal, Pos(x.PlaceOfSupply), r.Rate, r.Taxable, r.Igst,
            })), moneyFrom: 6, dateCols: new[] { 2 }, moneyCols: new[] { 3 });

        // B2C Small — aggregated by place of supply and rate (table 7)
        var b2cs = sales.Where(x => x.Type == "B2C" && !(x.IsInterState && x.InvoiceTotal > B2cLargeLimit))
            .SelectMany(x => rateLines[x.Id].Select(r => (x.PlaceOfSupply, x.IsInterState, r)))
            .GroupBy(t => (t.PlaceOfSupply, t.IsInterState, t.r.Rate))
            .OrderBy(g => g.Key.PlaceOfSupply).ThenBy(g => g.Key.Rate)
            .Select(g => new object?[] { g.Key.IsInterState ? "Inter-state" : "Intra-state", Pos(g.Key.PlaceOfSupply), g.Key.Rate,
                g.Sum(t => t.r.Taxable), g.Sum(t => t.r.Cgst), g.Sum(t => t.r.Sgst), g.Sum(t => t.r.Igst) });
        Sheet(wb, "B2CS", period, new[] { "Supply type", "Place of supply", "Rate", "Taxable value", "CGST", "SGST", "IGST" }, b2cs, moneyFrom: 4);

        Sheet(wb, "CDNR", period, new[] { "GSTIN of recipient", "Receiver name", "Note number", "Note date", "Original invoice", "Place of supply", "Reason", "Note value", "Taxable value", "CGST", "SGST", "IGST" },
            credit.Where(x => !string.IsNullOrEmpty(x.PartyGstin)).Select(x => new object?[]
            {
                x.PartyGstin, x.PartyName, x.Number, x.Date, x.OriginalNumber, Pos(x.PlaceOfSupply), x.Reason, x.NoteTotal, x.Taxable, x.Cgst, x.Sgst, x.Igst,
            }), moneyFrom: 8, dateCols: new[] { 4 });
        Sheet(wb, "CDNUR", period, new[] { "Customer", "Note number", "Note date", "Original invoice", "Place of supply", "Reason", "Note value", "Taxable value", "CGST", "SGST", "IGST" },
            credit.Where(x => string.IsNullOrEmpty(x.PartyGstin)).Select(x => new object?[]
            {
                x.PartyName, x.Number, x.Date, x.OriginalNumber, Pos(x.PlaceOfSupply), x.Reason, x.NoteTotal, x.Taxable, x.Cgst, x.Sgst, x.Igst,
            }), moneyFrom: 7, dateCols: new[] { 3 });

        Sheet(wb, "HSN", period, new[] { "HSN", "Description", "UQC", "Total quantity", "Rate", "Total value", "Taxable value", "CGST", "SGST", "IGST" },
            hsn.Select(x => new object?[] { x.Hsn, x.Description, "NOS-NUMBERS", x.Quantity, x.Rate, x.TotalValue, x.Taxable, x.Cgst, x.Sgst, x.Igst }),
            moneyFrom: 6, moneyCols: new[] { 6 });

        var docs = register.Rows.GroupBy(r => Regex.Match(r.Number, @"^(.*?)\d+$").Groups[1].Value)
            .Select(g => new object?[] { "Invoices for outward supply", g.Min(r => r.Number), g.Max(r => r.Number), g.Count(), g.Count(r => r.Status == InvoiceStatus.Cancelled) })
            .Concat(credit.Count == 0 ? Array.Empty<object?[]>() : new[] { new object?[] { "Credit notes", credit.Min(c => c.Number), credit.Max(c => c.Number), credit.Count, 0 } });
        Sheet(wb, "Docs", period, new[] { "Nature of document", "Sr. no. from", "Sr. no. to", "Total number", "Cancelled" }, docs);

        Sheet(wb, "Purchases (ITC)", period, new[] { "Supplier GSTIN", "Supplier", "Supplier bill", "Our ref", "Date", "Place of supply", "Taxable value", "CGST", "SGST", "IGST", "Total" },
            purchases.Select(x => new object?[] { x.SupplierGstin, x.SupplierName, x.SupplierInvoiceNo, x.Number, x.Date, Pos(x.PlaceOfSupply), x.Taxable, x.Cgst, x.Sgst, x.Igst, x.PurchaseTotal }),
            moneyFrom: 7, dateCols: new[] { 5 });
        Sheet(wb, "Debit notes", period, new[] { "Supplier GSTIN", "Supplier", "Note number", "Date", "Against bill", "Reason", "Taxable value", "CGST", "SGST", "IGST", "Total" },
            debit.Select(x => new object?[] { x.PartyGstin, x.PartyName, x.Number, x.Date, x.OriginalNumber, x.Reason, x.Taxable, x.Cgst, x.Sgst, x.Igst, x.NoteTotal }),
            moneyFrom: 7, dateCols: new[] { 4 });

        wb.Worksheet(1).Cell(1, 1).Value = $"{s.Shop.ShopName} — GST summary";
        wb.Worksheet(1).Cell(2, 1).Value = $"GSTIN {s.Shop.Gstin ?? "not registered"} · {period}";
        using var ms = new MemoryStream();
        wb.SaveAs(ms);
        return ms.ToArray();
    }

    private static string Pos(string? code) => code is null ? "" : $"{code}-{IndianStates.NameOf(code)}";

    private static void Sheet(XLWorkbook wb, string name, string period, string[] headers, IEnumerable<object?[]> rows,
        int moneyFrom = int.MaxValue, int[]? dateCols = null, int[]? moneyCols = null)
    {
        var ws = wb.AddWorksheet(name);
        ws.Cell(1, 1).Value = name;
        ws.Cell(1, 1).Style.Font.Bold = true;
        ws.Cell(1, 1).Style.Font.FontSize = 13;
        ws.Cell(2, 1).Value = period;
        ws.Cell(2, 1).Style.Font.FontColor = XLColor.Gray;
        for (var c = 0; c < headers.Length; c++)
        {
            var cell = ws.Cell(4, c + 1);
            cell.Value = headers[c];
            cell.Style.Font.Bold = true;
            cell.Style.Fill.BackgroundColor = XLColor.FromHtml("#EEF2F6");
        }
        var r = 5;
        foreach (var row in rows)
        {
            for (var c = 0; c < row.Length; c++)
            {
                var cell = ws.Cell(r, c + 1);
                var col = c + 1;
                switch (row[c])
                {
                    case null: break;
                    case DateTime dt: cell.Value = dt; cell.Style.DateFormat.Format = "dd-mmm-yyyy"; break;
                    case decimal m: cell.Value = m; if (col >= moneyFrom || moneyCols?.Contains(col) == true) cell.Style.NumberFormat.Format = "#,##,##0.00"; break;
                    case int i: cell.Value = i; break;
                    case long l: cell.Value = l; break;
                    // Text such as GSTINs and invoice numbers stays text (and cannot start a formula).
                    default: cell.SetValue(row[c]!.ToString()!.TrimStart('=', '+', '-', '@')); break;
                }
            }
            r++;
        }
        ws.SheetView.FreezeRows(4);
        ws.Columns().AdjustToContents(4, Math.Max(4, r), 8, 48);
    }

    private static string? Blank(string? s) => string.IsNullOrWhiteSpace(s) ? null : s.Trim();
}

// ============================================================================ purchase returns (debit notes)

public sealed class PurchaseReturnLineInput
{
    public long PurchaseItemId { get; set; }
    public decimal Quantity { get; set; }
    /// <summary>True when the pieces being sent back are ones already recorded as damaged.</summary>
    public bool FromDamaged { get; set; }
}

public sealed class PurchaseReturnInput
{
    public long PurchaseId { get; set; }
    public DateTime Date { get; set; } = DateTime.Today;
    public string Reason { get; set; } = "";
    public string? Notes { get; set; }
    public List<PurchaseReturnLineInput> Lines { get; set; } = new();
}

public sealed class PurchaseReturn
{
    public long Id { get; set; }
    public string Number { get; set; } = "";
    public long PurchaseId { get; set; }
    public string? PurchaseNumber { get; set; }
    public long SupplierId { get; set; }
    public string? SupplierName { get; set; }
    public DateTime ReturnDate { get; set; }
    public string Reason { get; set; } = "";
    public decimal TaxableTotal { get; set; }
    public decimal CgstTotal { get; set; }
    public decimal SgstTotal { get; set; }
    public decimal IgstTotal { get; set; }
    public decimal GrandTotal { get; set; }
    public string? Notes { get; set; }
    public string? CreatedByName { get; set; }
    public DateTime CreatedAt { get; set; }
}

/// <summary>
/// Goods sent back to a supplier. Issues a GST debit note, removes the stock (from sellable or damaged),
/// and reduces the amount payable on the purchase — all in one transaction.
/// </summary>
public sealed class PurchaseReturnService(Db db, UserSession session, AuditService audit, InventoryService inventory)
{
    public async Task<(long Id, string Number)> CreateAsync(PurchaseReturnInput input)
    {
        session.Demand(Perm.PurchaseManage);
        new ValidationBuilder()
            .Require(input.Reason, "Reason", "Reason")
            .Check(input.Lines.Any(l => l.Quantity > 0), "Lines", "Enter the quantity being returned.")
            .Check(input.Date.Date <= DateTime.Today, "Date", "The date cannot be in the future.")
            .ThrowIfInvalid();

        return await db.InTransactionAsync(async (conn, tx) =>
        {
            var p = await conn.QuerySingleOrDefaultAsync<Purchase>("select * from purchases where id = @PurchaseId for update", input, tx)
                    ?? throw new NotFoundException("Purchase", input.PurchaseId);
            if (p.Status != PurchaseStatus.Completed) throw new BusinessRuleException("Only completed purchases can be returned.");
            if (input.Date.Date < p.PurchaseDate) throw new ValidationException("Date", "The return date is before the purchase date.");
            var items = (await conn.QueryAsync<(long Id, long VariantId, string Description, string? HsnCode, decimal Quantity, decimal ReturnedQty,
                    decimal GstRate, decimal TaxableAmount, decimal Cgst, decimal Sgst, decimal Igst)>(
                "select id, variant_id, description, hsn_code, quantity, returned_qty, gst_rate, taxable_amount, cgst, sgst, igst from purchase_items where purchase_id = @id for update",
                new { id = p.Id }, tx)).ToDictionary(i => i.Id);

            var number = await SequenceService.NextAsync(conn, tx, DocType.DebitNote, input.Date);
            var lines = new List<(long ItemId, long VariantId, string Description, string? Hsn, decimal Qty, decimal Rate, decimal Taxable, decimal Cgst, decimal Sgst, decimal Igst, bool Damaged)>();
            foreach (var l in input.Lines.Where(l => l.Quantity > 0))
            {
                if (!items.TryGetValue(l.PurchaseItemId, out var it)) throw new ValidationException("Lines", "An item does not belong to this purchase.");
                var left = it.Quantity - it.ReturnedQty;
                if (l.Quantity > left) throw new ValidationException("Lines", $"{it.Description}: only {left:0.##} can be returned.");
                // Full remaining quantity → exact remaining amounts, so repeated partial returns never drift by a paisa.
                var full = l.Quantity == left;
                decimal Part(decimal total, decimal alreadyShare) => full ? total - alreadyShare : Money.R2(total * l.Quantity / it.Quantity);
                var ratio = it.ReturnedQty / it.Quantity;
                lines.Add((it.Id, it.VariantId, it.Description, it.HsnCode, l.Quantity, it.GstRate,
                    Part(it.TaxableAmount, Money.R2(it.TaxableAmount * ratio)), Part(it.Cgst, Money.R2(it.Cgst * ratio)),
                    Part(it.Sgst, Money.R2(it.Sgst * ratio)), Part(it.Igst, Money.R2(it.Igst * ratio)), l.FromDamaged));
            }
            var taxable = lines.Sum(l => l.Taxable);
            var cgst = lines.Sum(l => l.Cgst); var sgst = lines.Sum(l => l.Sgst); var igst = lines.Sum(l => l.Igst);
            var grand = taxable + cgst + sgst + igst;
            if (p.ReturnedTotal + grand > p.GrandTotal) grand = p.GrandTotal - p.ReturnedTotal; // round-off guard

            var id = await conn.ExecuteScalarAsync<long>("""
                insert into purchase_returns (number, purchase_id, supplier_id, return_date, reason, is_inter_state, taxable_total, cgst_total, sgst_total, igst_total, grand_total, notes, created_by)
                values (@number, @PurchaseId, @SupplierId, @Date, @Reason, @IsInterState, @taxable, @cgst, @sgst, @igst, @grand, @Notes, @uid) returning id
                """, new { number, PurchaseId = p.Id, p.SupplierId, Date = input.Date.Date, Reason = input.Reason.Trim(), p.IsInterState, taxable, cgst, sgst, igst, grand, input.Notes, uid = session.UserId }, tx);

            foreach (var l in lines)
            {
                await conn.ExecuteAsync("""
                    insert into purchase_return_items (return_id, purchase_item_id, variant_id, description, hsn_code, quantity, gst_rate, taxable_amount, cgst, sgst, igst, line_total)
                    values (@id, @ItemId, @VariantId, @Description, @Hsn, @Qty, @Rate, @Taxable, @Cgst, @Sgst, @Igst, @Total)
                    """, new { id, l.ItemId, l.VariantId, l.Description, l.Hsn, l.Qty, l.Rate, l.Taxable, l.Cgst, l.Sgst, l.Igst, Total = l.Taxable + l.Cgst + l.Sgst + l.Igst }, tx);
                await conn.ExecuteAsync("update purchase_items set returned_qty = returned_qty + @Qty where id = @ItemId", new { l.Qty, l.ItemId }, tx);
                await inventory.ApplyAsync(conn, tx, l.VariantId, MovementType.PurchaseReturnOut,
                    l.Damaged ? 0 : -l.Qty, 0, l.Damaged ? -l.Qty : 0, DocType.DebitNote, id, number, $"Returned to supplier: {input.Reason.Trim()}");
            }
            await conn.ExecuteAsync("update purchases set returned_total = returned_total + @grand where id = @id", new { grand, id = p.Id }, tx);
            var supplier = await conn.ExecuteScalarAsync<string>("select name from suppliers where id = @SupplierId", p, tx);
            await audit.LogAsync(conn, tx, "CREATE", "Purchases",
                $"issued debit note {number} to {supplier} against {p.Number} — {Money.Format(grand)} ({input.Reason.Trim()})",
                "purchase_return", id, number, null, new { input.PurchaseId, input.Reason, Lines = input.Lines });
            return (id, number);
        });
    }

    public async Task<PagedResult<PurchaseReturn>> ListAsync(ListQuery q)
    {
        session.Demand(Perm.PurchaseView);
        var where = """
            where (@From::date is null or d.return_date >= @From::date) and (@To::date is null or d.return_date <= @To::date)
              and (@SupplierId::bigint is null or d.supplier_id = @SupplierId)
              and (@Search::text is null or d.number ilike '%' || @Search || '%' or s.name ilike '%' || @Search || '%' or p.number ilike '%' || @Search || '%')
            """;
        var args = new { q.From, q.To, q.SupplierId, Search = string.IsNullOrWhiteSpace(q.Search) ? null : q.Search.Trim(), q.PageSize, q.Offset };
        await using var conn = await db.OpenAsync();
        const string from = "from purchase_returns d join suppliers s on s.id = d.supplier_id join purchases p on p.id = d.purchase_id left join users u on u.id = d.created_by";
        var total = await conn.ExecuteScalarAsync<int>($"select count(*) {from} {where}", args);
        var rows = await conn.QueryAsync<PurchaseReturn>($"""
            select d.*, s.name as supplier_name, p.number as purchase_number, u.full_name as created_by_name {from} {where}
            order by d.return_date desc, d.id desc limit @PageSize offset @Offset
            """, args);
        return new PagedResult<PurchaseReturn> { Items = rows.AsList(), TotalCount = total, Page = q.Page, PageSize = q.PageSize };
    }

    public async Task<IReadOnlyList<PurchaseReturn>> ForPurchaseAsync(long purchaseId)
    {
        session.Demand(Perm.PurchaseView);
        return await db.QueryAsync<PurchaseReturn>("""
            select d.*, u.full_name as created_by_name from purchase_returns d left join users u on u.id = d.created_by
            where d.purchase_id = @purchaseId order by d.id
            """, new { purchaseId });
    }
}
