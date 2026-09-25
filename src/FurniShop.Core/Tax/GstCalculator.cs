namespace FurniShop.Core.Tax;

/// <summary>One document line as entered by the user.</summary>
/// <param name="UnitPrice">Price per unit in the basis given by <paramref name="PriceIncludesGst"/>.</param>
/// <param name="DiscountPercent">Percentage discount on the gross line value.</param>
/// <param name="DiscountAmount">Additional flat discount on the line, in the same basis as the price.</param>
public sealed record TaxLineInput(
    decimal Quantity,
    decimal UnitPrice,
    bool PriceIncludesGst,
    decimal GstRate,
    decimal DiscountPercent = 0,
    decimal DiscountAmount = 0);

/// <summary>Computed line. All values except <see cref="GrossInput"/> are exclusive of GST unless named Total.</summary>
public sealed record TaxLineResult(
    decimal GrossInput,     // qty × price in the entered basis
    decimal GrossTaxable,   // gross value before discount, exclusive of GST
    decimal Discount,       // discount, exclusive of GST
    decimal Taxable,        // taxable value after discount
    decimal Cgst,
    decimal Sgst,
    decimal Igst,
    decimal Total)          // taxable + GST
{
    public decimal Tax => Cgst + Sgst + Igst;
}

public sealed record DocumentChargesInput(decimal DeliveryCharge, decimal InstallationCharge, decimal ChargesGstRate);

public sealed record DocumentTotals(
    decimal Subtotal,          // Σ gross taxable of items (ex-GST, before discount)
    decimal DiscountTotal,     // Σ item discount (ex-GST)
    decimal ItemsTaxable,      // Subtotal − Discount
    decimal DeliveryCharge,    // ex-GST
    decimal InstallationCharge,// ex-GST
    decimal TaxableTotal,      // ItemsTaxable + charges
    decimal CgstTotal,
    decimal SgstTotal,
    decimal IgstTotal,
    decimal ChargesTax,        // part of the GST totals that comes from the charges
    decimal RoundOff,
    decimal GrandTotal,
    IReadOnlyList<TaxLineResult> Lines)
{
    public decimal TaxTotal => CgstTotal + SgstTotal + IgstTotal;
}

/// <summary>A tax summary row (per GST rate) printed at the bottom of a tax invoice.</summary>
public sealed record TaxSummaryRow(decimal Rate, decimal Taxable, decimal Cgst, decimal Sgst, decimal Igst)
{
    public decimal Total => Cgst + Sgst + Igst;
}

/// <summary>
/// The single implementation of GST maths used by quotations, sales orders,
/// invoices, custom orders and purchases.
/// Intra-state supply: GST is split equally into CGST + SGST.
/// Inter-state supply: the full GST is IGST.
/// </summary>
public static class GstCalculator
{
    public static TaxLineResult ComputeLine(TaxLineInput input, bool interState)
    {
        if (input.Quantity <= 0) throw new ArgumentOutOfRangeException(nameof(input), "Quantity must be greater than zero.");
        if (input.UnitPrice < 0) throw new ArgumentOutOfRangeException(nameof(input), "Price cannot be negative.");
        if (input.GstRate is < 0 or > 100) throw new ArgumentOutOfRangeException(nameof(input), "GST rate must be between 0 and 100.");
        if (input.DiscountPercent is < 0 or > 100) throw new ArgumentOutOfRangeException(nameof(input), "Discount % must be between 0 and 100.");
        if (input.DiscountAmount < 0) throw new ArgumentOutOfRangeException(nameof(input), "Discount cannot be negative.");

        var gross = Money.R2(input.Quantity * input.UnitPrice);
        var discount = Money.R2(gross * input.DiscountPercent / 100m) + Money.R2(input.DiscountAmount);
        if (discount > gross) throw new ArgumentOutOfRangeException(nameof(input), "Discount cannot exceed the line value.");
        var net = gross - discount;

        decimal taxable, tax, grossTaxable;
        if (input.PriceIncludesGst)
        {
            taxable = ExcludeTax(net, input.GstRate);
            tax = net - taxable;
            grossTaxable = ExcludeTax(gross, input.GstRate);
        }
        else
        {
            taxable = net;
            tax = Money.R2(taxable * input.GstRate / 100m);
            grossTaxable = gross;
        }

        var (cgst, sgst, igst) = Split(tax, interState);
        return new TaxLineResult(gross, grossTaxable, grossTaxable - taxable, taxable, cgst, sgst, igst, taxable + tax);
    }

    public static DocumentTotals ComputeDocument(
        IEnumerable<TaxLineInput> lines, bool interState, DocumentChargesInput charges, bool roundOff)
    {
        var results = lines.Select(l => ComputeLine(l, interState)).ToList();
        if (charges.DeliveryCharge < 0 || charges.InstallationCharge < 0)
            throw new ArgumentOutOfRangeException(nameof(charges), "Charges cannot be negative.");

        var subtotal = results.Sum(r => r.GrossTaxable);
        var discount = results.Sum(r => r.Discount);
        var itemsTaxable = results.Sum(r => r.Taxable);
        var cgst = results.Sum(r => r.Cgst);
        var sgst = results.Sum(r => r.Sgst);
        var igst = results.Sum(r => r.Igst);

        var delivery = Money.R2(charges.DeliveryCharge);
        var installation = Money.R2(charges.InstallationCharge);
        var chargesTaxable = delivery + installation;
        var chargesTax = Money.R2(chargesTaxable * charges.ChargesGstRate / 100m);
        var (cc, cs, ci) = Split(chargesTax, interState);
        cgst += cc; sgst += cs; igst += ci;

        var taxableTotal = itemsTaxable + chargesTaxable;
        var exact = taxableTotal + cgst + sgst + igst;
        var grand = roundOff ? Money.ToRupee(exact) : exact;
        return new DocumentTotals(subtotal, discount, itemsTaxable, delivery, installation, taxableTotal,
            cgst, sgst, igst, chargesTax, grand - exact, grand, results);
    }

    /// <summary>Groups taxable value and tax by GST rate (for the invoice tax summary and GST reports).</summary>
    public static IReadOnlyList<TaxSummaryRow> Summarise(IEnumerable<(decimal Rate, TaxLineResult Line)> lines) =>
        lines.GroupBy(x => x.Rate)
             .OrderBy(g => g.Key)
             .Select(g => new TaxSummaryRow(g.Key, g.Sum(x => x.Line.Taxable), g.Sum(x => x.Line.Cgst), g.Sum(x => x.Line.Sgst), g.Sum(x => x.Line.Igst)))
             .ToList();

    /// <summary>Taxable value contained in a GST-inclusive amount.</summary>
    public static decimal ExcludeTax(decimal inclusiveAmount, decimal rate) =>
        rate == 0 ? inclusiveAmount : Money.R2(inclusiveAmount * 100m / (100m + rate));

    public static (decimal Cgst, decimal Sgst, decimal Igst) Split(decimal tax, bool interState)
    {
        if (interState) return (0, 0, tax);
        var cgst = Money.R2(tax / 2m);
        return (cgst, tax - cgst, 0);
    }

    /// <summary>True when the place of supply differs from the shop's state (→ IGST).</summary>
    public static bool IsInterState(string? shopStateCode, string? placeOfSupplyStateCode) =>
        !string.IsNullOrWhiteSpace(shopStateCode) && !string.IsNullOrWhiteSpace(placeOfSupplyStateCode)
        && !string.Equals(shopStateCode.Trim(), placeOfSupplyStateCode.Trim(), StringComparison.OrdinalIgnoreCase);
}
