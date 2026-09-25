using System.Data;
using FurniShop.Core;
using FurniShop.Core.Domain;
using FurniShop.Core.Settings;
using FurniShop.Core.Tax;
using FurniShop.Core.Validation;

namespace FurniShop.Infrastructure.Documents;

public sealed class PartyBlock
{
    public string Heading { get; set; } = "BILL TO";
    public string Name { get; set; } = "";
    public string? Address { get; set; }
    public string? Mobile { get; set; }
    public string? Gstin { get; set; }
    public string? State { get; set; }
}

public sealed record PaymentHistoryRow(DateTime Date, string Number, string Mode, decimal Amount);

public sealed class PaymentBlock
{
    public decimal Total { get; set; }
    public decimal Returned { get; set; }
    public decimal Paid { get; set; }
    public decimal Balance { get; set; }
    public DateTime? DueDate { get; set; }
    public List<PaymentHistoryRow> History { get; set; } = new();
    public string? AdvanceLabel { get; set; }
}

/// <summary>Everything needed to print an invoice / quotation / order confirmation.</summary>
public sealed class PrintDocument
{
    public string Title { get; set; } = "TAX INVOICE";
    public ShopSettings Shop { get; set; } = new();
    public InvoiceSettings InvoiceSettings { get; set; } = new();
    public byte[]? Logo { get; set; }
    public string Number { get; set; } = "";
    public DateTime Date { get; set; }
    public List<(string Label, string Value)> Meta { get; set; } = new();
    public PartyBlock BillTo { get; set; } = new();
    public PartyBlock? ShipTo { get; set; }
    public List<DocumentLine> Lines { get; set; } = new();
    public bool InterState { get; set; }
    public decimal Subtotal { get; set; }
    public decimal Discount { get; set; }
    public decimal Delivery { get; set; }
    public decimal Installation { get; set; }
    public decimal Taxable { get; set; }
    public decimal Cgst { get; set; }
    public decimal Sgst { get; set; }
    public decimal Igst { get; set; }
    public decimal ChargesTax { get; set; }
    public decimal ChargesRate { get; set; }
    public decimal RoundOff { get; set; }
    public decimal GrandTotal { get; set; }
    public PaymentBlock? Payment { get; set; }
    public string? Notes { get; set; }
    public string? Terms { get; set; }
    public string? Stamp { get; set; }
    public bool ShowSignature { get; set; } = true;

    public IReadOnlyList<TaxSummaryRow> TaxSummary()
    {
        var rows = GstCalculator.Summarise(Lines.Select(l => (l.GstRate,
            new TaxLineResult(0, 0, 0, l.TaxableAmount, l.Cgst, l.Sgst, l.Igst, l.LineTotal)))).ToList();
        if (Delivery + Installation > 0)
        {
            var (c, s, i) = GstCalculator.Split(ChargesTax, InterState);
            var existing = rows.FindIndex(r => r.Rate == ChargesRate);
            var extra = new TaxSummaryRow(ChargesRate, Delivery + Installation, c, s, i);
            if (existing >= 0)
            {
                var r = rows[existing];
                rows[existing] = new TaxSummaryRow(r.Rate, r.Taxable + extra.Taxable, r.Cgst + extra.Cgst, r.Sgst + extra.Sgst, r.Igst + extra.Igst);
            }
            else rows.Add(extra);
        }
        return rows.OrderBy(r => r.Rate).ToList();
    }
}

public sealed class ReceiptDocument
{
    public string Title { get; set; } = "PAYMENT RECEIPT";
    public ShopSettings Shop { get; set; } = new();
    public byte[]? Logo { get; set; }
    public string Number { get; set; } = "";
    public DateTime Date { get; set; }
    public string CustomerName { get; set; } = "";
    public string? CustomerMobile { get; set; }
    public decimal Amount { get; set; }
    public List<(string Mode, string? Reference, decimal Amount)> Modes { get; set; } = new();
    public List<(string Doc, decimal Amount)> AppliedTo { get; set; } = new();
    public decimal OutstandingAfter { get; set; }
    public decimal AdvanceHeld { get; set; }
    public string? Notes { get; set; }
    public string? Stamp { get; set; }
}

public sealed class LabelItem
{
    public string ShopName { get; set; } = "";
    public string ProductName { get; set; } = "";
    public string? VariantName { get; set; }
    public string Code { get; set; } = "";
    public string Sku { get; set; } = "";
    public decimal Price { get; set; }
    public bool PriceIncludesGst { get; set; } = true;
    public int Copies { get; set; } = 1;
}

public enum LabelFormat { A4Sheet3x8, Roll50x25 }

/// <summary>Page layouts. All take a target so the same code prints to PDF and to a Windows printer.</summary>
public static class Layouts
{
    private const string Accent = "#6B4226";
    private const string AccentSoft = "#F5EEE7";
    private const string Border = "#DCCFC3";
    private const string Ink = "#1F1A17";
    private const string Muted = "#6E655E";
    private const string Danger = "#B42318";

    // ================================================================ A4 invoice / quotation / order
    public static void InvoiceA4(IDocTarget target, PrintDocument d)
    {
        const double m = 32;
        var pageNo = 1;
        var c = target.NewPage(PageSizes.A4Width, PageSizes.A4Height);
        var W = c.Width - 2 * m;
        var bottom = c.Height - 46;
        var y = Header(c, d, m, W);
        y = Parties(c, d, m, y + 10, W) + 12;

        // ---- items table
        var cols = d.InterState
            ? new[] { ("#", 18.0, TextAlign.Center), ("Item", 0.0, TextAlign.Left), ("HSN", 42.0, TextAlign.Left), ("Qty", 30.0, TextAlign.Right), ("Rate", 64.0, TextAlign.Right),
                      ("Disc.", 46.0, TextAlign.Right), ("Taxable", 68.0, TextAlign.Right), ("IGST", 56.0, TextAlign.Right), ("Amount", 72.0, TextAlign.Right) }
            : new[] { ("#", 18.0, TextAlign.Center), ("Item", 0.0, TextAlign.Left), ("HSN", 42.0, TextAlign.Left), ("Qty", 30.0, TextAlign.Right), ("Rate", 64.0, TextAlign.Right),
                      ("Disc.", 46.0, TextAlign.Right), ("Taxable", 68.0, TextAlign.Right), ("GST", 56.0, TextAlign.Right), ("Amount", 72.0, TextAlign.Right) };
        var fixedW = cols.Sum(x => x.Item2);
        cols[1].Item2 = W - fixedW;
        var xs = new double[cols.Length];
        { var acc = m; for (var i = 0; i < cols.Length; i++) { xs[i] = acc; acc += cols[i].Item2; } }

        double TableHeader(IDocCanvas cv, double ty)
        {
            cv.Rect(m, ty, W, 18, Accent);
            for (var i = 0; i < cols.Length; i++) cv.Text(cols[i].Item1, xs[i] + 4, ty + 5, 7.5, true, "#FFFFFF", cols[i].Item3, cols[i].Item2 - 8);
            return ty + 18;
        }

        y = TableHeader(c, y);
        var n = 0;
        foreach (var l in d.Lines)
        {
            n++;
            var desc = c.Wrap(l.Description, 8, cols[1].Item2 - 8, true);
            var sub = string.Join("  ", new[] { string.IsNullOrEmpty(l.Sku) ? null : "SKU " + l.Sku, l.ReturnedQty > 0 ? $"Returned {Money.Qty(l.ReturnedQty)}" : null }.Where(s => s is not null));
            var rowH = desc.Count * 10.4 + (sub.Length > 0 ? 9.5 : 0) + 8;
            if (y + rowH > bottom)
            {
                Footer(c, d, m, W, pageNo);
                c = target.NewPage(PageSizes.A4Width, PageSizes.A4Height);
                pageNo++;
                c.Text($"{d.Title} {d.Number} — continued", m, m, 9, true, Muted);
                y = TableHeader(c, m + 16);
            }
            if (n % 2 == 0) c.Rect(m, y, W, rowH, "#FBF8F5");
            var ty = y + 4;
            c.Text(n.ToString(), xs[0] + 2, ty, 8, false, Muted, TextAlign.Center, cols[0].Item2 - 4);
            for (var i = 0; i < desc.Count; i++) c.Text(desc[i], xs[1] + 4, ty + i * 10.4, 8, true, Ink);
            if (sub.Length > 0) c.Text(sub, xs[1] + 4, ty + desc.Count * 10.4, 6.8, false, Muted);
            c.Text(l.HsnCode ?? "", xs[2] + 4, ty, 7.5, false, Ink);
            c.Text(Money.Qty(l.Quantity), xs[3] + 4, ty, 8, false, Ink, TextAlign.Right, cols[3].Item2 - 8);
            c.Text(Money.Format(l.UnitPrice, false), xs[4] + 4, ty, 8, false, Ink, TextAlign.Right, cols[4].Item2 - 8);
            if (l.PriceIncludesGst) c.Text("incl. GST", xs[4] + 4, ty + 9.5, 6.3, false, Muted, TextAlign.Right, cols[4].Item2 - 8);
            var disc = l.DiscountPercent > 0 ? $"{l.DiscountPercent:0.##}%" : l.DiscountAmount > 0 ? Money.Format(l.DiscountAmount, false) : "-";
            c.Text(disc, xs[5] + 4, ty, 8, false, Ink, TextAlign.Right, cols[5].Item2 - 8);
            if (l.DiscountPercent > 0 && l.DiscountAmount > 0) c.Text("+" + Money.Format(l.DiscountAmount, false), xs[5] + 4, ty + 9.5, 6.3, false, Muted, TextAlign.Right, cols[5].Item2 - 8);
            c.Text(Money.Format(l.TaxableAmount, false), xs[6] + 4, ty, 8, false, Ink, TextAlign.Right, cols[6].Item2 - 8);
            c.Text($"{l.GstRate:0.##}%", xs[7] + 4, ty, 7.5, false, Muted, TextAlign.Right, cols[7].Item2 - 8);
            c.Text(Money.Format(l.Tax, false), xs[7] + 4, ty + 9.5, 7.5, false, Ink, TextAlign.Right, cols[7].Item2 - 8);
            c.Text(Money.Format(l.LineTotal, false), xs[8] + 4, ty, 8, true, Ink, TextAlign.Right, cols[8].Item2 - 8);
            y += rowH;
            c.Line(m, y, m + W, y, Border, 0.4);
        }

        // ---- totals block (needs ~220pt)
        var needed = 230 + (d.Payment?.History.Count ?? 0) * 11;
        if (y + needed > bottom)
        {
            Footer(c, d, m, W, pageNo);
            c = target.NewPage(PageSizes.A4Width, PageSizes.A4Height);
            pageNo++;
            c.Text($"{d.Title} {d.Number} — continued", m, m, 9, true, Muted);
            y = m + 18;
        }
        y += 10;
        var leftW = W * 0.56;
        var rightX = m + leftW + 14;
        var rightW = W - leftW - 14;

        // right: summary
        var ry = y;
        void Row(string label, decimal value, bool bold = false, string color = Ink, bool show = true)
        {
            if (!show) return;
            c.Text(label, rightX, ry, 8.5, bold, bold ? Ink : Muted);
            c.Text(Money.Format(value), rightX, ry, 8.5, bold, color, TextAlign.Right, rightW);
            ry += 14;
        }
        Row("Subtotal", d.Subtotal);
        Row("Discount", -d.Discount, show: d.Discount != 0);
        Row("Delivery charges", d.Delivery, show: d.Delivery != 0);
        Row("Installation charges", d.Installation, show: d.Installation != 0);
        Row("Taxable amount", d.Taxable, true);
        Row("CGST", d.Cgst, show: !d.InterState);
        Row("SGST", d.Sgst, show: !d.InterState);
        Row("IGST", d.Igst, show: d.InterState);
        Row("Round off", d.RoundOff, show: d.RoundOff != 0);
        c.Rect(rightX - 6, ry, rightW + 6, 24, Accent);
        c.Text("GRAND TOTAL", rightX, ry + 7, 10, true, "#FFFFFF");
        c.Text(Money.Format(d.GrandTotal), rightX, ry + 6.5, 11, true, "#FFFFFF", TextAlign.Right, rightW - 4);
        ry += 32;
        if (d.Payment is { } p)
        {
            Row("Returned (credit note)", -p.Returned, show: p.Returned != 0);
            Row(p.AdvanceLabel ?? "Amount paid", p.Paid, true, "#067647");
            Row("Balance due", p.Balance, true, p.Balance > 0 ? Danger : "#067647");
            if (p.DueDate.HasValue && p.Balance > 0)
            {
                c.Text($"Due by {p.DueDate:dd-MMM-yyyy}", rightX, ry, 8, true, Danger, TextAlign.Right, rightW);
                ry += 13;
            }
        }

        // left: amount in words, tax summary, bank
        var ly = y;
        if (d.InvoiceSettings.ShowAmountInWords)
        {
            c.Text("Amount in words", m, ly, 7.5, true, Muted);
            ly += 11;
            ly += c.Paragraph(Money.InWords(d.GrandTotal), m, ly, leftW, 8.5, true, Ink) + 8;
        }
        var ts = d.TaxSummary();
        if (ts.Count > 0)
        {
            var tcols = d.InterState ? new[] { "GST %", "Taxable", "IGST", "Total tax" } : new[] { "GST %", "Taxable", "CGST", "SGST", "Total tax" };
            var tw = leftW / tcols.Length;
            c.Rect(m, ly, leftW, 15, AccentSoft, Border);
            for (var i = 0; i < tcols.Length; i++) c.Text(tcols[i], m + i * tw + 4, ly + 4, 7, true, Accent, i == 0 ? TextAlign.Left : TextAlign.Right, tw - 8);
            ly += 15;
            foreach (var r in ts)
            {
                var vals = d.InterState
                    ? new[] { $"{r.Rate:0.##}%", Money.Format(r.Taxable, false), Money.Format(r.Igst, false), Money.Format(r.Total, false) }
                    : new[] { $"{r.Rate:0.##}%", Money.Format(r.Taxable, false), Money.Format(r.Cgst, false), Money.Format(r.Sgst, false), Money.Format(r.Total, false) };
                for (var i = 0; i < vals.Length; i++) c.Text(vals[i], m + i * tw + 4, ly + 3, 7.5, false, Ink, i == 0 ? TextAlign.Left : TextAlign.Right, tw - 8);
                ly += 13;
                c.Line(m, ly, m + leftW, ly, Border, 0.4);
            }
            ly += 8;
        }
        if (d.InvoiceSettings.ShowBankDetails && (!string.IsNullOrWhiteSpace(d.Shop.BankAccount) || !string.IsNullOrWhiteSpace(d.Shop.UpiId)))
        {
            c.Text("Bank / UPI details", m, ly, 7.5, true, Muted);
            ly += 11;
            if (!string.IsNullOrWhiteSpace(d.Shop.BankAccount))
            {
                c.Text($"{d.Shop.BankName}  A/c {d.Shop.BankAccount}  IFSC {d.Shop.BankIfsc}", m, ly, 8, false, Ink);
                ly += 11;
            }
            if (!string.IsNullOrWhiteSpace(d.Shop.UpiId))
            {
                c.Text($"UPI: {d.Shop.UpiId}", m, ly, 8, false, Ink);
                ly += 11;
            }
        }

        y = Math.Max(ly, ry) + 8;

        // payment history
        if (d.Payment is { History.Count: > 0 } ph)
        {
            c.Text("Payments received", m, y, 8, true, Accent);
            y += 12;
            foreach (var h in ph.History)
            {
                c.Text($"{h.Date:dd-MMM-yyyy}", m, y, 7.5, false, Muted);
                c.Text(h.Number, m + 70, y, 7.5, false, Ink);
                c.Text(h.Mode, m + 170, y, 7.5, false, Ink);
                c.Text(Money.Format(h.Amount), m + 320, y, 7.5, true, Ink, TextAlign.Right, 80);
                y += 11;
            }
            y += 6;
        }

        if (!string.IsNullOrWhiteSpace(d.Notes))
        {
            c.Text("Notes", m, y, 7.5, true, Muted);
            y += 11;
            y += c.Paragraph(d.Notes, m, y, W, 8, false, Ink) + 6;
        }

        // terms + signature
        var termsW = d.ShowSignature ? W * 0.6 : W;
        if (y + 80 > bottom)
        {
            Footer(c, d, m, W, pageNo);
            c = target.NewPage(PageSizes.A4Width, PageSizes.A4Height);
            pageNo++;
            y = m;
        }
        var termsTop = y;
        if (!string.IsNullOrWhiteSpace(d.Terms))
        {
            c.Text("Terms & conditions", m, y, 7.5, true, Muted);
            y += 11;
            y += c.Paragraph(d.Terms, m, y, termsW, 7, false, Muted);
        }
        if (d.ShowSignature)
        {
            var sx = m + W - 170;
            c.Text($"For {d.Shop.ShopName}", sx, termsTop, 8, true, Ink, TextAlign.Right, 170);
            c.Line(sx + 20, termsTop + 48, m + W, termsTop + 48, Muted, 0.6);
            c.Text("Authorised signatory", sx, termsTop + 52, 7.5, false, Muted, TextAlign.Right, 170);
            c.Text("Customer signature", m + W - 170 - 150, termsTop + 52, 7.5, false, Muted, TextAlign.Left, 120);
        }
        Footer(c, d, m, W, pageNo);
    }

    private static double Header(IDocCanvas c, PrintDocument d, double m, double W)
    {
        c.Rect(0, 0, c.Width, 6, Accent);
        var y = m;
        var x = m;
        if (d.Logo is { Length: > 0 })
        {
            c.Image(d.Logo, m, y, 58, 58);
            x = m + 68;
        }
        var leftW = W * 0.56 - (x - m);
        c.Text(d.Shop.ShopName, x, y, 17, true, Accent);
        var ly = y + 22;
        if (!string.IsNullOrWhiteSpace(d.Shop.Tagline)) { c.Text(d.Shop.Tagline!, x, ly, 8, false, Muted); ly += 11; }
        var addr = string.Join(", ", new[] { d.Shop.Address, d.Shop.City, IndianStates.NameOf(d.Shop.StateCode), d.Shop.Pincode }.Where(s => !string.IsNullOrWhiteSpace(s)));
        ly += c.Paragraph(addr, x, ly, leftW, 8, false, Ink, TextAlign.Left, 1.25);
        var contact = string.Join("   ", new[] { d.Shop.Phone is { Length: > 0 } ph ? "Ph: " + ph : null, d.Shop.Email, d.Shop.Website }.Where(s => !string.IsNullOrWhiteSpace(s)));
        if (contact.Length > 0) ly += c.Paragraph(contact, x, ly, leftW, 8, false, Ink, TextAlign.Left, 1.25);
        if (!string.IsNullOrWhiteSpace(d.Shop.Gstin)) { c.Text($"GSTIN: {d.Shop.Gstin}", x, ly, 8.5, true, Ink); ly += 11; }

        var rw = W * 0.40;
        var rx = m + W - rw;
        c.Text(d.Title, rx, y, 15, true, Accent, TextAlign.Right, rw);
        var ry = y + 22;
        void Meta(string label, string value)
        {
            c.Text(label, rx, ry, 8, false, Muted);
            c.Text(value, rx, ry, 8, true, Ink, TextAlign.Right, rw);
            ry += 12;
        }
        Meta("Number", d.Number);
        Meta("Date", d.Date.ToString("dd-MMM-yyyy"));
        foreach (var (label, value) in d.Meta.Where(mm => !string.IsNullOrWhiteSpace(mm.Value))) Meta(label, value);
        if (!string.IsNullOrEmpty(d.Stamp))
        {
            c.Rect(rx + rw - 110, ry + 2, 110, 20, null, Danger, 1.4);
            c.Text(d.Stamp, rx + rw - 110, ry + 7, 10, true, Danger, TextAlign.Center, 110);
            ry += 26;
        }
        var bottom = Math.Max(Math.Max(ly, ry), y + 60) + 6;
        c.Line(m, bottom, m + W, bottom, Accent, 1.2);
        return bottom;
    }

    private static double Parties(IDocCanvas c, PrintDocument d, double m, double y, double W)
    {
        var blocks = new List<PartyBlock> { d.BillTo };
        if (d.ShipTo is not null) blocks.Add(d.ShipTo);
        var bw = (W - 12) / 2;
        double Draw(PartyBlock p, double x, bool measureOnly)
        {
            var yy = y + 8;
            if (!measureOnly) c.Text(p.Heading, x + 8, yy, 7, true, Accent);
            yy += 11;
            if (!measureOnly) c.Text(p.Name, x + 8, yy, 10, true, Ink);
            yy += 14;
            if (!string.IsNullOrWhiteSpace(p.Address))
                yy += measureOnly ? c.ParagraphHeight(p.Address, bw - 16, 8, false, 1.25) : c.Paragraph(p.Address, x + 8, yy, bw - 16, 8, false, Ink, TextAlign.Left, 1.25);
            foreach (var (label, val) in new[] { ("Mobile", p.Mobile), ("GSTIN", p.Gstin), ("State", p.State) })
                if (!string.IsNullOrWhiteSpace(val))
                {
                    if (!measureOnly) { c.Text(label + ":", x + 8, yy, 8, false, Muted); c.Text(val!, x + 50, yy, 8, label == "GSTIN", Ink); }
                    yy += 11;
                }
            return yy - y + 6;
        }
        var h = blocks.Select((b, i) => Draw(b, m + i * (bw + 12), true)).Max();
        for (var i = 0; i < blocks.Count; i++)
        {
            var x = m + i * (bw + 12);
            c.Rect(x, y, bw, h, AccentSoft, Border);
            Draw(blocks[i], x, false);
        }
        return y + h;
    }

    private static void Footer(IDocCanvas c, PrintDocument d, double m, double W, int page)
    {
        var y = c.Height - 34;
        c.Line(m, y, m + W, y, Border, 0.6);
        c.Text(d.InvoiceSettings.Footer, m, y + 6, 8, true, Accent, TextAlign.Center, W);
        c.Text("This is a computer generated document.", m, y + 18, 6.5, false, Muted, TextAlign.Left, W);
        c.Text($"Page {page}", m, y + 18, 6.5, false, Muted, TextAlign.Right, W);
    }

    // ================================================================ thermal receipt (58 / 80 mm)
    public static void Thermal(IDocTarget target, PrintDocument d, int widthMm, IDocCanvas measurer)
    {
        var width = PageSizes.Mm(widthMm);
        // Pass 1 measures the height, pass 2 draws on a page of exactly that height.
        var probe = new MeasuringCanvas(measurer, width, 100_000);
        var height = DrawThermal(probe, d) + 12;
        DrawThermal(target.NewPage(width, height), d);
    }

    private static double DrawThermal(IDocCanvas c, PrintDocument d)
    {
        const double m = 7;
        var W = c.Width - 2 * m;
        var small = W < 170;
        var fs = small ? 7 : 8;
        var y = 8.0;
        y += c.Paragraph(d.Shop.ShopName, m, y, W, small ? 10 : 12, true, "#000000", TextAlign.Center);
        var addr = string.Join(", ", new[] { d.Shop.Address, d.Shop.City, d.Shop.Pincode }.Where(s => !string.IsNullOrWhiteSpace(s)));
        y += c.Paragraph(addr, m, y, W, fs - 0.5, false, "#000000", TextAlign.Center, 1.2);
        if (!string.IsNullOrWhiteSpace(d.Shop.Phone)) y += c.Paragraph("Ph: " + d.Shop.Phone, m, y, W, fs - 0.5, false, "#000000", TextAlign.Center);
        if (!string.IsNullOrWhiteSpace(d.Shop.Gstin)) y += c.Paragraph("GSTIN: " + d.Shop.Gstin, m, y, W, fs - 0.5, true, "#000000", TextAlign.Center);
        y += 3;
        Dash(c, m, ref y, W);
        c.Text(d.Title, m, y, fs + 1, true, "#000000", TextAlign.Center, W); y += fs + 5;
        if (!string.IsNullOrEmpty(d.Stamp)) { c.Text(d.Stamp, m, y, fs + 1, true, "#000000", TextAlign.Center, W); y += fs + 5; }
        c.Text($"No: {d.Number}", m, y, fs, true); c.Text(d.Date.ToString("dd-MM-yyyy"), m, y, fs, false, "#000000", TextAlign.Right, W); y += fs + 4;
        y += c.Paragraph($"Customer: {d.BillTo.Name}{(string.IsNullOrWhiteSpace(d.BillTo.Mobile) ? "" : " (" + d.BillTo.Mobile + ")")}", m, y, W, fs, false, "#000000");
        if (!string.IsNullOrWhiteSpace(d.BillTo.Gstin)) y += c.Paragraph("GSTIN: " + d.BillTo.Gstin, m, y, W, fs, false, "#000000");
        Dash(c, m, ref y, W);
        foreach (var l in d.Lines)
        {
            y += c.Paragraph(l.Description, m, y, W, fs, true, "#000000", TextAlign.Left, 1.2);
            c.Text($"{Money.Qty(l.Quantity)} x {Money.Format(l.UnitPrice, false)}{(l.DiscountPercent > 0 ? $" -{l.DiscountPercent:0.##}%" : "")}  GST {l.GstRate:0.##}%", m, y, fs - 0.5, false, "#000000");
            c.Text(Money.Format(l.LineTotal, false), m, y, fs, true, "#000000", TextAlign.Right, W);
            y += fs + 4;
        }
        Dash(c, m, ref y, W);
        void R(string label, decimal v, bool bold = false, bool show = true)
        {
            if (!show) return;
            c.Text(label, m, y, bold ? fs + 1 : fs, bold, "#000000");
            c.Text(Money.Format(v), m, y, bold ? fs + 1 : fs, bold, "#000000", TextAlign.Right, W);
            y += (bold ? fs + 1 : fs) + 4;
        }
        R("Subtotal", d.Subtotal);
        R("Discount", -d.Discount, show: d.Discount != 0);
        R("Delivery", d.Delivery, show: d.Delivery != 0);
        R("Installation", d.Installation, show: d.Installation != 0);
        R("Taxable", d.Taxable);
        R("CGST", d.Cgst, show: !d.InterState && d.Cgst != 0);
        R("SGST", d.Sgst, show: !d.InterState && d.Sgst != 0);
        R("IGST", d.Igst, show: d.InterState && d.Igst != 0);
        R("Round off", d.RoundOff, show: d.RoundOff != 0);
        Dash(c, m, ref y, W);
        R("TOTAL", d.GrandTotal, true);
        if (d.Payment is { } p)
        {
            foreach (var h in p.History) R($"  {h.Mode}", h.Amount);
            R("Paid", p.Paid);
            R("Balance", p.Balance, p.Balance > 0);
        }
        Dash(c, m, ref y, W);
        y += c.Paragraph(d.InvoiceSettings.Footer, m, y, W, fs, true, "#000000", TextAlign.Center);
        return y;
    }

    private static void Dash(IDocCanvas c, double m, ref double y, double W)
    {
        for (var x = m; x < m + W; x += 4) c.Line(x, y, Math.Min(x + 2, m + W), y, "#000000", 0.5);
        y += 5;
    }

    // ================================================================ payment receipt (A5)
    public static void Receipt(IDocTarget target, ReceiptDocument r)
    {
        const double m = 26;
        var c = target.NewPage(PageSizes.A5Width, PageSizes.A5Height);
        var W = c.Width - 2 * m;
        c.Rect(0, 0, c.Width, 5, Accent);
        var y = m;
        var x = m;
        if (r.Logo is { Length: > 0 }) { c.Image(r.Logo, m, y, 42, 42); x += 50; }
        c.Text(r.Shop.ShopName, x, y, 13, true, Accent);
        var addr = string.Join(", ", new[] { r.Shop.Address, r.Shop.City, r.Shop.Pincode }.Where(s => !string.IsNullOrWhiteSpace(s)));
        c.Paragraph(addr, x, y + 17, W - (x - m) - 120, 7.5, false, Muted);
        c.Text(r.Title, m, y, 11, true, Accent, TextAlign.Right, W);
        c.Text(r.Number, m, y + 15, 8.5, true, Ink, TextAlign.Right, W);
        c.Text(r.Date.ToString("dd-MMM-yyyy"), m, y + 27, 8, false, Muted, TextAlign.Right, W);
        y += 56;
        c.Line(m, y, m + W, y, Accent, 1);
        y += 12;
        c.Text(r.Title.StartsWith("REFUND") ? "Paid to" : "Received with thanks from", m, y, 8, false, Muted);
        y += 12;
        c.Text(r.CustomerName + (string.IsNullOrWhiteSpace(r.CustomerMobile) ? "" : $"  ({r.CustomerMobile})"), m, y, 11, true, Ink);
        y += 20;
        c.Rect(m, y, W, 40, AccentSoft, Border);
        c.Text("Amount", m + 10, y + 8, 8, false, Muted);
        c.Text(Money.Format(r.Amount), m + 10, y + 19, 15, true, Accent);
        c.Paragraph(Money.InWords(r.Amount), m + 170, y + 9, W - 180, 7.5, true, Ink);
        y += 52;
        c.Text("Mode", m, y, 7.5, true, Muted); c.Text("Reference", m + 110, y, 7.5, true, Muted); c.Text("Amount", m, y, 7.5, true, Muted, TextAlign.Right, W);
        y += 12;
        foreach (var (mode, reference, amount) in r.Modes)
        {
            c.Text(mode, m, y, 8.5, false, Ink); c.Text(reference ?? "-", m + 110, y, 8.5, false, Ink); c.Text(Money.Format(amount), m, y, 8.5, true, Ink, TextAlign.Right, W);
            y += 12;
        }
        y += 6;
        if (r.AppliedTo.Count > 0)
        {
            c.Text("Applied to", m, y, 7.5, true, Muted);
            y += 12;
            foreach (var (doc, amount) in r.AppliedTo)
            {
                c.Text(doc, m, y, 8.5, false, Ink); c.Text(Money.Format(amount), m, y, 8.5, false, Ink, TextAlign.Right, W);
                y += 12;
            }
        }
        y += 8;
        c.Line(m, y, m + W, y, Border);
        y += 8;
        c.Text("Balance outstanding after this receipt", m, y, 8.5, false, Muted);
        c.Text(Money.Format(r.OutstandingAfter), m, y, 8.5, true, r.OutstandingAfter > 0 ? Danger : "#067647", TextAlign.Right, W);
        y += 13;
        if (r.AdvanceHeld > 0)
        {
            c.Text("Advance held for the customer", m, y, 8.5, false, Muted);
            c.Text(Money.Format(r.AdvanceHeld), m, y, 8.5, true, Ink, TextAlign.Right, W);
            y += 13;
        }
        if (!string.IsNullOrWhiteSpace(r.Notes)) { y += 4; y += c.Paragraph("Note: " + r.Notes, m, y, W, 7.5, false, Muted); }
        if (!string.IsNullOrEmpty(r.Stamp))
        {
            c.Rect(m, y + 6, 90, 20, null, Danger, 1.4);
            c.Text(r.Stamp, m, y + 11, 10, true, Danger, TextAlign.Center, 90);
        }
        var sy = c.Height - 70;
        c.Text($"For {r.Shop.ShopName}", m, sy, 8, true, Ink, TextAlign.Right, W);
        c.Line(m + W - 140, sy + 36, m + W, sy + 36, Muted);
        c.Text("Authorised signatory", m, sy + 40, 7, false, Muted, TextAlign.Right, W);
    }

    // ================================================================ barcode / QR labels
    public static void Labels(IDocTarget target, IReadOnlyList<LabelItem> items, LabelFormat format, bool qr)
    {
        var expanded = items.SelectMany(i => Enumerable.Repeat(i, Math.Max(1, i.Copies))).ToList();
        if (format == LabelFormat.Roll50x25)
        {
            foreach (var it in expanded)
            {
                var c = target.NewPage(PageSizes.Mm(50), PageSizes.Mm(25));
                DrawLabel(c, it, 0, 0, c.Width, c.Height, qr);
            }
            return;
        }
        const int colsN = 3, rowsN = 8;
        var lw = PageSizes.Mm(70); var lh = PageSizes.Mm(37);
        IDocCanvas? page = null;
        for (var i = 0; i < expanded.Count; i++)
        {
            if (i % (colsN * rowsN) == 0) page = target.NewPage(PageSizes.A4Width, PageSizes.A4Height);
            var slot = i % (colsN * rowsN);
            var x = (page!.Width - colsN * lw) / 2 + slot % colsN * lw;
            var y = (page.Height - rowsN * lh) / 2 + slot / colsN * lh;
            page.Rect(x + 2, y + 2, lw - 4, lh - 4, null, "#E5E5E5", 0.3);
            DrawLabel(page, expanded[i], x + 4, y + 4, lw - 8, lh - 8, qr);
        }
    }

    private static void DrawLabel(IDocCanvas c, LabelItem it, double x, double y, double w, double h, bool qr)
    {
        var pad = 3.0;
        c.Text(it.ShopName, x + pad, y + pad, 5.5, true, Muted, TextAlign.Left, w - 2 * pad);
        var name = c.Wrap(it.ProductName + (string.IsNullOrWhiteSpace(it.VariantName) || it.VariantName == "Standard" ? "" : " — " + it.VariantName), 6.5, qr ? w - h - pad : w - 2 * pad, true);
        for (var i = 0; i < Math.Min(2, name.Count); i++) c.Text(name[i], x + pad, y + pad + 7 + i * 7.5, 6.5, true, Ink);
        var priceY = y + pad + 7 + Math.Min(2, name.Count) * 7.5 + 1;
        c.Text($"MRP {Money.Format(it.Price, true, 0)}{(it.PriceIncludesGst ? " incl. GST" : " + GST")}", x + pad, priceY, 7, true, Ink);
        if (qr)
        {
            var size = h - 2 * pad;
            Barcodes.DrawQr(c, Barcodes.Qr(it.Code), x + w - size - pad, y + pad, size);
            c.Text(it.Sku, x + pad, y + h - pad - 7, 6, false, Muted);
        }
        else
        {
            var barTop = priceY + 10;
            var barH = Math.Max(8, y + h - pad - 8 - barTop);
            Barcodes.DrawLinear(c, Barcodes.Linear(it.Code), x + pad, barTop, w - 2 * pad, barH);
            c.Text(it.Code, x + pad, barTop + barH + 1, 6, false, Ink, TextAlign.Center, w - 2 * pad);
        }
    }

    // ================================================================ report / export table
    public static void Table(IDocTarget target, string shopName, string title, string subtitle, DataTable table,
        ISet<string> moneyColumns, IReadOnlyList<(string Label, string Value)> totals)
    {
        var landscape = table.Columns.Count > 7;
        var pw = landscape ? PageSizes.A4Height : PageSizes.A4Width;
        var ph = landscape ? PageSizes.A4Width : PageSizes.A4Height;
        const double m = 28;
        var W = pw - 2 * m;
        var cols = table.Columns.Cast<DataColumn>().ToList();
        var isNum = cols.Select(col => col.DataType == typeof(decimal) || col.DataType == typeof(int) || col.DataType == typeof(long) || col.DataType == typeof(double)).ToArray();
        // Column widths: numbers narrower, text wider.
        var weights = cols.Select((col, i) => isNum[i] ? 1.0 : 1.8).ToArray();
        var widths = weights.Select(wt => W * wt / weights.Sum()).ToArray();
        var page = 0;
        IDocCanvas c = null!;
        double y = 0;

        void NewPage()
        {
            page++;
            c = target.NewPage(pw, ph);
            c.Text(shopName, m, m, 9, true, Accent);
            c.Text(title, m, m + 12, 13, true, Ink);
            c.Text(subtitle, m, m + 29, 8, false, Muted);
            c.Text($"Page {page}  ·  Generated {DateTime.Now:dd-MMM-yyyy HH:mm}", m, m + 29, 7, false, Muted, TextAlign.Right, W);
            y = m + 44;
            c.Rect(m, y, W, 16, Accent);
            var x = m;
            for (var i = 0; i < cols.Count; i++)
            {
                c.Text(Truncate(c, cols[i].ColumnName, 7, widths[i] - 6, true), x + 3, y + 4.5, 7, true, "#FFFFFF", isNum[i] ? TextAlign.Right : TextAlign.Left, widths[i] - 6);
                x += widths[i];
            }
            y += 16;
        }

        NewPage();
        var rowNo = 0;
        foreach (DataRow row in table.Rows)
        {
            if (y + 13 > ph - m) NewPage();
            if (rowNo++ % 2 == 1) c.Rect(m, y, W, 13, "#FAF7F4");
            var x = m;
            for (var i = 0; i < cols.Count; i++)
            {
                var text = FormatCell(row[i], moneyColumns.Contains(cols[i].ColumnName));
                c.Text(Truncate(c, text, 7, widths[i] - 6), x + 3, y + 3, 7, false, Ink, isNum[i] ? TextAlign.Right : TextAlign.Left, widths[i] - 6);
                x += widths[i];
            }
            y += 13;
        }
        if (table.Rows.Count == 0) { c.Text("No records for the selected filters.", m, y + 8, 9, false, Muted); y += 24; }
        if (totals.Count > 0)
        {
            if (y + 16 + totals.Count * 12 > ph - m) NewPage();
            y += 8;
            c.Line(m, y, m + W, y, Accent, 0.8);
            y += 6;
            foreach (var (label, value) in totals)
            {
                c.Text($"Total {label}", m, y, 8, false, Muted);
                c.Text(value, m, y, 8, true, Ink, TextAlign.Right, 260);
                y += 12;
            }
        }
    }

    public static string FormatCell(object? v, bool money) => v switch
    {
        null or DBNull => "",
        decimal d when money => Money.Format(d, false),
        decimal d => d == Math.Truncate(d) ? d.ToString("0") : d.ToString("0.##"),
        DateTime dt => dt.TimeOfDay == TimeSpan.Zero ? dt.ToString("dd-MMM-yyyy") : dt.ToString("dd-MMM-yyyy HH:mm"),
        bool b => b ? "Yes" : "No",
        _ => StatusLooksLike(v.ToString()!) ? StatusStyle.Label(v.ToString()) : v.ToString()!,
    };

    private static bool StatusLooksLike(string s) => s.Length > 2 && s.All(ch => char.IsUpper(ch) || ch == '_') && s.Contains('_');

    private static string Truncate(IDocCanvas c, string text, double size, double width, bool bold = false)
    {
        if (c.MeasureWidth(text, size, bold) <= width) return text;
        while (text.Length > 1 && c.MeasureWidth(text + "…", size, bold) > width) text = text[..^1];
        return text + "…";
    }
}
