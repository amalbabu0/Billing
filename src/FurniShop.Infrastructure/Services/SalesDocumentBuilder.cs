using Dapper;
using FurniShop.Core;
using FurniShop.Core.Domain;
using FurniShop.Core.Security;
using FurniShop.Core.Settings;
using FurniShop.Core.Tax;
using FurniShop.Infrastructure.Security;
using Npgsql;

namespace FurniShop.Infrastructure.Services;

internal sealed record BuiltDocument(List<DocumentLine> Lines, DocumentTotals Totals, bool InterState, string? PlaceOfSupply, Customer Customer);

/// <summary>
/// Shared logic for quotations, sales orders and invoices: validates lines against the catalog,
/// enforces the discount permission, snapshots cost, computes GST and totals, and writes item rows.
/// </summary>
internal static class SalesDocumentBuilder
{
    private sealed class VariantInfo
    {
        public long Id { get; set; }
        public string ProductName { get; set; } = "";
        public string VariantName { get; set; } = "";
        public string Sku { get; set; } = "";
        public string? HsnCode { get; set; }
        public decimal GstRate { get; set; }
        public bool PriceIncludesGst { get; set; }
        public decimal SellingPrice { get; set; }
        public decimal CostPrice { get; set; }
        public decimal DiscountPercent { get; set; }
        public bool IsDeleted { get; set; }
        public string PricingMode { get; set; } = "FIXED";
        public decimal? PricingRate { get; set; }
    }

    public static async Task<BuiltDocument> BuildAsync(NpgsqlConnection conn, NpgsqlTransaction tx, UserSession session,
        AppSettingsSnapshot settings, SalesDocumentInput input, bool enforceDiscount = true)
    {
        if (input.Lines.Count == 0) throw new ValidationException("Lines", "Add at least one item.");
        if (input.DeliveryCharge < 0 || input.InstallationCharge < 0) throw new ValidationException("Charges", "Charges cannot be negative.");

        var customer = await conn.QuerySingleOrDefaultAsync<Customer>("select * from customers where id = @CustomerId and not is_deleted", input, tx)
                       ?? throw new ValidationException("CustomerId", "Select a customer.");

        var pos = Core.Validation.Validators.Clean(input.PlaceOfSupply) ?? customer.StateCode ?? settings.Shop.StateCode;
        var interState = GstCalculator.IsInterState(settings.Shop.StateCode, pos);

        var validRates = (await conn.QueryAsync<decimal>("select rate from gst_rates", transaction: tx)).ToHashSet();
        // Group pricing (dealer, designer, wholesale…): its discount is allowed on top of each product's standard discount limit.
        var groupDiscount = await conn.ExecuteScalarAsync<decimal?>("select discount_percent from customer_groups where code = @CustomerGroup and is_active", customer, tx) ?? 0;
        var ids = input.Lines.Where(l => l.VariantId.HasValue).Select(l => l.VariantId!.Value).Distinct().ToArray();
        var variants = (await conn.QueryAsync<VariantInfo>("""
            select v.id, p.name as product_name, v.variant_name, v.sku, p.hsn_code, p.gst_rate, p.price_includes_gst,
                   coalesce(v.selling_price, p.selling_price) as selling_price, coalesce(v.cost_price, p.cost_price) as cost_price,
                   p.discount_percent, (v.is_deleted or p.is_deleted) as is_deleted, v.pricing_mode, v.pricing_rate
            from product_variants v join products p on p.id = v.product_id where v.id = any(@ids)
            """, new { ids }, tx)).ToDictionary(v => v.Id);

        var lines = new List<DocumentLine>();
        var inputs = new List<TaxLineInput>();
        var n = 0;
        foreach (var l in input.Lines)
        {
            n++;
            VariantInfo? v = null;
            if (l.VariantId.HasValue && (!variants.TryGetValue(l.VariantId.Value, out v) || v.IsDeleted))
                throw new ValidationException("Lines", $"Line {n}: product no longer exists.");
            if (l.Quantity <= 0) throw new ValidationException("Lines", $"Line {n}: quantity must be greater than zero.");
            if (l.UnitPrice < 0) throw new ValidationException("Lines", $"Line {n}: price cannot be negative.");
            if (l.DiscountPercent is < 0 or > 100 || l.DiscountAmount < 0) throw new ValidationException("Lines", $"Line {n}: invalid discount.");

            var rate = settings.Tax.GstRegistered ? l.GstRate : 0m;
            if (!validRates.Contains(rate)) throw new ValidationException("Lines", $"Line {n}: GST rate {rate:0.##}% is not configured in Settings → Tax.");

            var description = string.IsNullOrWhiteSpace(l.Description)
                ? v is null ? "" : v.VariantName == "Standard" ? v.ProductName : $"{v.ProductName} — {v.VariantName}"
                : l.Description.Trim();
            if (description.Length == 0) throw new ValidationException("Lines", $"Line {n}: description is required.");

            var taxInput = new TaxLineInput(l.Quantity, l.UnitPrice, l.PriceIncludesGst, rate, l.DiscountPercent, l.DiscountAmount);
            TaxLineResult result;
            try { result = GstCalculator.ComputeLine(taxInput, interState); }
            catch (ArgumentOutOfRangeException ex) { throw new ValidationException("Lines", $"Line {n}: {ex.Message.Split(" (Parameter")[0]}"); }

            if (v is not null && enforceDiscount && !session.Has(Perm.InvoiceDiscount))
            {
                // Compare the net unit price with the list price (or measured rate) less the larger of product and customer-group discount.
                var list = v.PricingMode != "FIXED" && v.PricingRate is { } rateList ? rateList : v.SellingPrice;
                if (v.PriceIncludesGst != l.PriceIncludesGst)
                    list = v.PriceIncludesGst ? GstCalculator.ExcludeTax(list, v.GstRate) : Money.R2(list * (100 + v.GstRate) / 100m);
                var allowed = Math.Max(v.DiscountPercent, groupDiscount);
                var minUnit = list * (1 - allowed / 100m);
                var netUnit = (l.PriceIncludesGst ? result.Total : result.Taxable) / l.Quantity;
                if (netUnit < minUnit - 0.01m)
                    throw new PermissionDeniedException($"{Perm.InvoiceDiscount}: discount on {description} exceeds the allowed {allowed:0.##}% — ask a manager");
            }

            inputs.Add(taxInput);
            lines.Add(new DocumentLine
            {
                LineNo = n, VariantId = l.VariantId, Description = description, Sku = v?.Sku ?? Core.Validation.Validators.Clean(l.Sku),
                HsnCode = Core.Validation.Validators.Clean(l.HsnCode) ?? v?.HsnCode ?? settings.Tax.DefaultHsn,
                Quantity = l.Quantity, UnitPrice = l.UnitPrice, PriceIncludesGst = l.PriceIncludesGst, GstRate = rate,
                DiscountPercent = l.DiscountPercent, DiscountAmount = l.DiscountAmount,
                TaxableAmount = result.Taxable, Cgst = result.Cgst, Sgst = result.Sgst, Igst = result.Igst, LineTotal = result.Total,
                UnitCost = v?.CostPrice ?? 0, SourceItemId = l.SourceItemId,
            });
        }

        var chargesRate = settings.Tax.GstRegistered ? settings.Tax.ChargesGstRate : 0m;
        var totals = GstCalculator.ComputeDocument(inputs, interState,
            new DocumentChargesInput(input.DeliveryCharge, input.InstallationCharge, chargesRate), settings.Invoice.RoundOff);
        return new BuiltDocument(lines, totals, interState, pos, customer);
    }

    /// <summary>
    /// Records who gets credit for the sale: the chosen salesperson, else the one on the source quotation / order, else the person saving it.
    /// </summary>
    public static Task SetSalespersonAsync(NpgsqlConnection conn, NpgsqlTransaction tx, string table, long id, SalesDocumentInput input, long? userId) =>
        conn.ExecuteAsync($"""
            update {table} set salesperson_id = coalesce(@SalespersonId,
                (select salesperson_id from sales_orders where id = @SalesOrderId),
                (select salesperson_id from quotations where id = @QuotationId),
                salesperson_id, @userId)
            where id = @id
            """, new { input.SalespersonId, input.SalesOrderId, input.QuotationId, userId, id }, tx);

    /// <summary>Header parameters shared by the three document tables.</summary>
    public static object TotalsArgs(BuiltDocument b) => new
    {
        IsInterState = b.InterState, PlaceOfSupply = b.PlaceOfSupply,
        b.Totals.Subtotal, b.Totals.DiscountTotal, b.Totals.TaxableTotal,
        CgstTotal = b.Totals.CgstTotal, SgstTotal = b.Totals.SgstTotal, IgstTotal = b.Totals.IgstTotal,
        b.Totals.DeliveryCharge, b.Totals.InstallationCharge, b.Totals.ChargesTax, b.Totals.RoundOff, b.Totals.GrandTotal,
    };

    public const string TotalsSet = """
        is_inter_state=@IsInterState, place_of_supply=@PlaceOfSupply, subtotal=@Subtotal, discount_total=@DiscountTotal,
        taxable_total=@TaxableTotal, cgst_total=@CgstTotal, sgst_total=@SgstTotal, igst_total=@IgstTotal,
        delivery_charge=@DeliveryCharge, installation_charge=@InstallationCharge, charges_tax=@ChargesTax,
        round_off=@RoundOff, grand_total=@GrandTotal
        """;

    public static async Task InsertLinesAsync(NpgsqlConnection conn, NpgsqlTransaction tx, string table, string fk, long docId,
        IEnumerable<DocumentLine> lines, string? sourceColumn = null)
    {
        var src = sourceColumn is null ? "" : $", {sourceColumn}";
        var srcVal = sourceColumn is null ? "" : ", @SourceItemId";
        foreach (var l in lines)
        {
            l.Id = await conn.ExecuteScalarAsync<long>($"""
                insert into {table} ({fk}, line_no, variant_id, description, sku, hsn_code, quantity, unit_price, price_includes_gst,
                    discount_percent, discount_amount, taxable_amount, gst_rate, cgst, sgst, igst, line_total, unit_cost{src})
                values (@DocId, @LineNo, @VariantId, @Description, @Sku, @HsnCode, @Quantity, @UnitPrice, @PriceIncludesGst,
                    @DiscountPercent, @DiscountAmount, @TaxableAmount, @GstRate, @Cgst, @Sgst, @Igst, @LineTotal, @UnitCost{srcVal})
                returning id
                """, new
            {
                DocId = docId, l.LineNo, l.VariantId, l.Description, l.Sku, l.HsnCode, l.Quantity, l.UnitPrice, l.PriceIncludesGst,
                l.DiscountPercent, l.DiscountAmount, l.TaxableAmount, l.GstRate, l.Cgst, l.Sgst, l.Igst, l.LineTotal,
                UnitCost = l.UnitCost ?? 0, l.SourceItemId,
            }, tx);
        }
    }

    public static async Task<List<DocumentLine>> LoadLinesAsync(NpgsqlConnection conn, NpgsqlTransaction? tx, string table, string fk, long docId,
        bool canSeeCost, string? extraColumns = null)
    {
        var lines = (await conn.QueryAsync<DocumentLine>(
            $"select *{(extraColumns is null ? "" : ", " + extraColumns)} from {table} where {fk} = @docId order by line_no", new { docId }, tx)).AsList();
        if (!canSeeCost) lines.ForEach(l => l.UnitCost = null);
        return lines;
    }

    public static Task AddStatusHistoryAsync(NpgsqlConnection conn, NpgsqlTransaction tx, string docType, long docId, string? from, string to, string? note, long? userId) =>
        conn.ExecuteAsync("""
            insert into status_history (doc_type, doc_id, from_status, to_status, note, changed_by)
            values (@docType, @docId, @from, @to, @note, @userId)
            """, new { docType, docId, from, to, note, userId }, tx);

    public static async Task<IReadOnlyList<StatusHistoryEntry>> HistoryAsync(NpgsqlConnection conn, string docType, long docId) =>
        (await conn.QueryAsync<StatusHistoryEntry>("""
            select h.*, u.full_name as changed_by_name from status_history h left join users u on u.id = h.changed_by
            where h.doc_type = @docType and h.doc_id = @docId order by h.changed_at, h.id
            """, new { docType, docId })).AsList();
}
