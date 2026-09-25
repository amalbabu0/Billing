using System.Data;
using System.Text;
using ClosedXML.Excel;
using FurniShop.Core;
using FurniShop.Core.Domain;
using FurniShop.Core.Messaging;
using FurniShop.Core.Security;
using FurniShop.Core.Settings;
using FurniShop.Core.Validation;
using FurniShop.Infrastructure.Services;

namespace FurniShop.Infrastructure.Documents;

/// <summary>
/// Builds printable documents (invoice, quotation, order confirmation, receipt, labels, reports),
/// renders them to PDF, exports tables to CSV / Excel / PDF and prepares WhatsApp messages.
/// </summary>
public sealed class DocumentService(AppServices app)
{
    // ------------------------------------------------------------------ models
    public async Task<PrintDocument> InvoiceModelAsync(long invoiceId)
    {
        var s = await app.Settings.GetAsync();
        var inv = await app.Invoices.GetAsync(invoiceId);
        var customer = await app.Customers.GetAsync(inv.CustomerId);
        var payments = inv.Status == InvoiceStatus.Final ? await app.Payments.ForDocumentAsync(DocType.Invoice, invoiceId) : Array.Empty<Payment>();
        var doc = await BaseModelAsync(s, inv, s.Invoice.Title);
        doc.Number = inv.Number ?? $"DRAFT-{inv.Id}";
        doc.Stamp = inv.Status switch { InvoiceStatus.Cancelled => "CANCELLED", InvoiceStatus.Draft => "DRAFT", _ => null };
        doc.BillTo = new PartyBlock
        {
            Heading = "BILL TO", Name = inv.CustomerName, Address = inv.BillingAddress, Mobile = customer.IsWalkIn ? null : inv.CustomerMobile,
            Gstin = inv.CustomerGstin, State = IndianStates.ByCode(customer.StateCode)?.Display,
        };
        if (!string.IsNullOrWhiteSpace(inv.DeliveryAddress) && inv.DeliveryAddress != inv.BillingAddress)
            doc.ShipTo = new PartyBlock { Heading = "DELIVER TO", Name = inv.CustomerName, Address = inv.DeliveryAddress, Mobile = inv.CustomerMobile };
        doc.Meta.Add(("Place of supply", IndianStates.ByCode(inv.PlaceOfSupply)?.Display ?? inv.PlaceOfSupply ?? ""));
        if (inv.DueDate.HasValue && inv.Balance > 0) doc.Meta.Add(("Due date", inv.DueDate.Value.ToString("dd-MMM-yyyy")));
        if (inv.SalesOrderNumber is not null) doc.Meta.Add(("Sales order", inv.SalesOrderNumber));
        if (inv.QuotationNumber is not null) doc.Meta.Add(("Quotation", inv.QuotationNumber));
        if (inv.CustomOrderNumber is not null) doc.Meta.Add(("Custom order", inv.CustomOrderNumber));
        if (inv.Status == InvoiceStatus.Cancelled) doc.Meta.Add(("Cancelled", $"{inv.CancelledAt:dd-MMM-yyyy} — {inv.CancelReason}"));
        if (inv.Status == InvoiceStatus.Final)
            doc.Payment = new PaymentBlock
            {
                Total = inv.GrandTotal, Returned = inv.ReturnedAmount, Paid = inv.Paid, Balance = inv.Balance, DueDate = inv.DueDate,
                History = payments.Where(p => !p.IsVoided).Select(p => new PaymentHistoryRow(p.PaymentDate, p.Number,
                    (p.Direction == PaymentDirection.Out ? "Refund — " : "") + (p.Methods ?? ""), p.Direction == PaymentDirection.Out ? -p.Amount : p.Amount)).ToList(),
            };
        return doc;
    }

    public async Task<PrintDocument> QuotationModelAsync(long id)
    {
        var s = await app.Settings.GetAsync();
        var q = await app.Quotations.GetAsync(id);
        var customer = await app.Customers.GetAsync(q.CustomerId);
        var doc = await BaseModelAsync(s, q, "QUOTATION");
        doc.Number = q.Number!;
        doc.BillTo = new PartyBlock { Heading = "QUOTATION FOR", Name = customer.Name, Address = InvoiceAddress(customer), Mobile = customer.Mobile, Gstin = customer.Gstin };
        if (q.ValidUntil.HasValue) doc.Meta.Add(("Valid until", q.ValidUntil.Value.ToString("dd-MMM-yyyy")));
        doc.Meta.Add(("Prepared by", q.CreatedByName ?? ""));
        doc.Stamp = q.Status is QuotationStatus.Cancelled or QuotationStatus.Rejected or QuotationStatus.Expired ? StatusStyle.Label(q.Status).ToUpperInvariant() : null;
        return doc;
    }

    public async Task<PrintDocument> SalesOrderModelAsync(long id)
    {
        var s = await app.Settings.GetAsync();
        var so = await app.SalesOrders.GetAsync(id);
        var customer = await app.Customers.GetAsync(so.CustomerId);
        var doc = await BaseModelAsync(s, so, "ORDER CONFIRMATION");
        doc.Number = so.Number!;
        doc.BillTo = new PartyBlock { Heading = "CUSTOMER", Name = customer.Name, Address = InvoiceAddress(customer), Mobile = customer.Mobile, Gstin = customer.Gstin };
        if (!string.IsNullOrWhiteSpace(so.DeliveryAddress)) doc.ShipTo = new PartyBlock { Heading = "DELIVER TO", Name = customer.Name, Address = so.DeliveryAddress, Mobile = customer.Mobile };
        if (so.ExpectedDeliveryDate.HasValue) doc.Meta.Add(("Expected delivery", so.ExpectedDeliveryDate.Value.ToString("dd-MMM-yyyy")));
        if (so.QuotationNumber is not null) doc.Meta.Add(("Quotation", so.QuotationNumber));
        doc.Meta.Add(("Status", StatusStyle.Label(so.Status)));
        var payments = await app.Payments.ForDocumentAsync(DocType.SalesOrder, id);
        doc.Payment = new PaymentBlock
        {
            Total = so.GrandTotal, Paid = so.AdvancePaid, Balance = so.Balance, AdvanceLabel = "Advance received",
            History = payments.Where(p => !p.IsVoided).Select(p => new PaymentHistoryRow(p.PaymentDate, p.Number, p.Methods ?? "", p.Amount)).ToList(),
        };
        doc.Title = "ORDER CONFIRMATION";
        doc.Stamp = so.Status == SalesOrderStatus.Cancelled ? "CANCELLED" : null;
        return doc;
    }

    private async Task<PrintDocument> BaseModelAsync(AppSettingsSnapshot s, SalesDocument src, string title) => new()
    {
        Title = title, Shop = s.Shop, InvoiceSettings = s.Invoice, Logo = await LogoAsync(s), Date = src.Date, Lines = src.Lines,
        InterState = src.IsInterState, Subtotal = src.Subtotal, Discount = src.DiscountTotal, Delivery = src.DeliveryCharge,
        Installation = src.InstallationCharge, Taxable = src.TaxableTotal, Cgst = src.CgstTotal, Sgst = src.SgstTotal, Igst = src.IgstTotal,
        ChargesTax = src.ChargesTax, ChargesRate = s.Tax.ChargesGstRate, RoundOff = src.RoundOff, GrandTotal = src.GrandTotal,
        Notes = src.Notes, Terms = src.Terms, ShowSignature = s.Invoice.ShowSignatureBox,
    };

    private static string? InvoiceAddress(Customer c) => InvoiceService.FullAddress(c);

    private async Task<byte[]?> LogoAsync(AppSettingsSnapshot s)
    {
        if (s.Shop.LogoAttachmentId is not { } id) return null;
        var a = await app.Attachments.GetAsync(id);
        return a is { Info.ContentType: "image/png" or "image/jpeg" } ? a.Value.Data : null;
    }

    public async Task<ReceiptDocument> ReceiptModelAsync(long paymentId)
    {
        var s = await app.Settings.GetAsync();
        var p = await app.Payments.GetAsync(paymentId);
        var summary = await app.Customers.SummaryAsync(p.CustomerId);
        var methods = (await app.Settings.PaymentMethodsAsync()).ToDictionary(m => m.Code, m => m.Name);
        return new ReceiptDocument
        {
            Title = p.Direction == PaymentDirection.Out ? "REFUND VOUCHER" : "PAYMENT RECEIPT", Shop = s.Shop, Logo = await LogoAsync(s),
            Number = p.Number, Date = p.PaymentDate, CustomerName = p.CustomerName ?? "", CustomerMobile = p.CustomerMobile, Amount = p.Amount,
            Modes = p.Lines.Select(l => (methods.GetValueOrDefault(l.MethodCode, l.MethodCode), l.Reference, l.Amount)).ToList(),
            AppliedTo = p.Allocations.GroupBy(a => a.DocNumber ?? "On account").Select(g => (g.Key, g.Sum(a => a.Amount))).Where(x => x.Item2 != 0).ToList(),
            OutstandingAfter = summary.Outstanding, AdvanceHeld = summary.AdvanceAmount, Notes = p.Notes,
            Stamp = p.IsVoided ? "VOIDED" : null,
        };
    }

    // ------------------------------------------------------------------ PDF rendering
    public async Task<byte[]> InvoicePdfAsync(long invoiceId, bool thermal = false)
    {
        var d = await InvoiceModelAsync(invoiceId);
        var s = await app.Settings.GetAsync();
        using var t = new PdfTarget($"Invoice {d.Number}");
        if (thermal) Layouts.Thermal(t, d, s.Printer.ThermalWidthMm, PdfTarget.Measurer());
        else Layouts.InvoiceA4(t, d);
        return t.ToBytes();
    }

    public async Task<byte[]> QuotationPdfAsync(long id)
    {
        var d = await QuotationModelAsync(id);
        using var t = new PdfTarget($"Quotation {d.Number}");
        Layouts.InvoiceA4(t, d);
        return t.ToBytes();
    }

    public async Task<byte[]> SalesOrderPdfAsync(long id)
    {
        var d = await SalesOrderModelAsync(id);
        using var t = new PdfTarget($"Order {d.Number}");
        Layouts.InvoiceA4(t, d);
        return t.ToBytes();
    }

    public async Task<byte[]> ReceiptPdfAsync(long paymentId)
    {
        var r = await ReceiptModelAsync(paymentId);
        using var t = new PdfTarget($"Receipt {r.Number}");
        Layouts.Receipt(t, r);
        return t.ToBytes();
    }

    public static byte[] LabelsPdf(IReadOnlyList<LabelItem> items, LabelFormat format, bool qr)
    {
        using var t = new PdfTarget("Labels");
        Layouts.Labels(t, items, format, qr);
        return t.ToBytes();
    }

    public async Task<List<LabelItem>> LabelItemsAsync(IEnumerable<(long VariantId, int Copies)> selection)
    {
        var s = await app.Settings.GetAsync();
        var list = new List<LabelItem>();
        foreach (var (variantId, copies) in selection)
        {
            var v = await app.Catalog.GetSellableAsync(variantId);
            if (v is null) continue;
            list.Add(new LabelItem
            {
                ShopName = s.Shop.ShopName, ProductName = v.ProductName, VariantName = v.VariantName, Sku = v.Sku,
                Code = string.IsNullOrWhiteSpace(v.Barcode) ? v.Sku : v.Barcode!, Price = v.SellingPrice, PriceIncludesGst = v.PriceIncludesGst, Copies = copies,
            });
        }
        return list;
    }

    /// <summary>Saves a PDF into the configured folder (Documents\FurniShop by default) and returns the full path.</summary>
    public async Task<string> SavePdfAsync(byte[] pdf, string name)
    {
        var s = await app.Settings.GetAsync();
        var folder = string.IsNullOrWhiteSpace(s.Printer.PdfFolder)
            ? Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.MyDocuments), "FurniShop", DateTime.Today.ToString("yyyy-MM"))
            : s.Printer.PdfFolder;
        Directory.CreateDirectory(folder);
        var safe = string.Concat(name.Select(ch => Path.GetInvalidFileNameChars().Contains(ch) ? '-' : ch));
        var path = Path.Combine(folder, safe + ".pdf");
        await File.WriteAllBytesAsync(path, pdf);
        return path;
    }

    // ------------------------------------------------------------------ WhatsApp messages
    private static Dictionary<string, string?> Base(AppSettingsSnapshot s, string customer) => new()
    {
        ["customer"] = FirstName(customer), ["shop"] = s.Shop.ShopName, ["shop_phone"] = s.Shop.Phone,
    };

    private static string FirstName(string name) => name.Split(' ', StringSplitOptions.RemoveEmptyEntries).FirstOrDefault() ?? name;

    public async Task<(string Mobile, string Message)> InvoiceMessageAsync(long invoiceId, bool reminder = false)
    {
        var s = await app.Settings.GetAsync();
        var inv = await app.Invoices.GetAsync(invoiceId);
        var c = await app.Customers.GetAsync(inv.CustomerId);
        var v = Base(s, inv.CustomerName);
        v["number"] = inv.Number; v["total"] = Money.Format(inv.GrandTotal); v["paid"] = Money.Format(inv.Paid); v["balance"] = Money.Format(inv.Balance);
        v["due_date"] = inv.DueDate?.ToString("dd-MMM-yyyy") ?? "-"; v["date"] = inv.Date.ToString("dd-MMM-yyyy");
        return (c.Whatsapp ?? c.Mobile ?? "", MessageTemplates.Render(reminder ? s.WhatsApp.ReminderTemplate : s.WhatsApp.InvoiceTemplate, v));
    }

    public async Task<(string Mobile, string Message)> OutstandingReminderAsync(long customerId)
    {
        var s = await app.Settings.GetAsync();
        var c = await app.Customers.GetAsync(customerId);
        var open = await app.Invoices.ListAsync(new ListQuery { CustomerId = customerId, PageSize = 100 }, "OUTSTANDING");
        var v = Base(s, c.Name);
        v["balance"] = Money.Format(open.Items.Sum(i => i.Balance));
        v["number"] = string.Join(", ", open.Items.Select(i => i.Number));
        v["due_date"] = open.Items.Where(i => i.DueDate.HasValue).Select(i => i.DueDate!.Value).DefaultIfEmpty(DateTime.Today).Min().ToString("dd-MMM-yyyy");
        return (c.Whatsapp ?? c.Mobile ?? "", MessageTemplates.Render(s.WhatsApp.ReminderTemplate, v));
    }

    public async Task<(string Mobile, string Message)> QuotationMessageAsync(long id)
    {
        var s = await app.Settings.GetAsync();
        var q = await app.Quotations.GetAsync(id);
        var c = await app.Customers.GetAsync(q.CustomerId);
        var v = Base(s, c.Name);
        v["number"] = q.Number; v["total"] = Money.Format(q.GrandTotal); v["valid_until"] = q.ValidUntil?.ToString("dd-MMM-yyyy") ?? "-";
        v["date"] = q.Date.ToString("dd-MMM-yyyy");
        return (c.Whatsapp ?? c.Mobile ?? "", MessageTemplates.Render(s.WhatsApp.QuotationTemplate, v));
    }

    public async Task<(string Mobile, string Message)> OrderConfirmationMessageAsync(long salesOrderId)
    {
        var s = await app.Settings.GetAsync();
        var so = await app.SalesOrders.GetAsync(salesOrderId);
        var c = await app.Customers.GetAsync(so.CustomerId);
        var v = Base(s, c.Name);
        v["number"] = so.Number; v["total"] = Money.Format(so.GrandTotal); v["paid"] = Money.Format(so.AdvancePaid); v["balance"] = Money.Format(so.Balance);
        v["date"] = so.ExpectedDeliveryDate?.ToString("dd-MMM-yyyy") ?? "to be confirmed";
        return (c.Whatsapp ?? c.Mobile ?? "", MessageTemplates.Render(s.WhatsApp.OrderConfirmationTemplate, v));
    }

    public async Task<(string Mobile, string Message)> CustomOrderConfirmationMessageAsync(long customOrderId)
    {
        var s = await app.Settings.GetAsync();
        var o = await app.CustomOrders.GetAsync(customOrderId);
        var c = await app.Customers.GetAsync(o.CustomerId);
        var v = Base(s, c.Name);
        v["number"] = $"{o.Number} (custom {o.ProductType})"; v["total"] = Money.Format(o.FinalPrice > 0 ? o.FinalPrice : o.EstimatedCost);
        v["paid"] = Money.Format(o.AdvancePaid); v["balance"] = Money.Format(o.Balance);
        v["date"] = o.ExpectedCompletionDate?.ToString("dd-MMM-yyyy") ?? "to be confirmed";
        return (c.Whatsapp ?? c.Mobile ?? "", MessageTemplates.Render(s.WhatsApp.OrderConfirmationTemplate, v));
    }

    public async Task<(string Mobile, string Message)> ReceiptMessageAsync(long paymentId)
    {
        var s = await app.Settings.GetAsync();
        var p = await app.Payments.GetAsync(paymentId);
        var c = await app.Customers.GetAsync(p.CustomerId);
        var summary = await app.Customers.SummaryAsync(p.CustomerId);
        var v = Base(s, c.Name);
        v["number"] = p.Number; v["amount"] = Money.Format(p.Amount); v["method"] = p.Methods; v["date"] = p.PaymentDate.ToString("dd-MMM-yyyy");
        v["balance"] = Money.Format(summary.Outstanding);
        return (c.Whatsapp ?? c.Mobile ?? "", MessageTemplates.Render(s.WhatsApp.ReceiptTemplate, v));
    }

    public async Task<(string Mobile, string Message)> DeliveryMessageAsync(long deliveryId, string? otp)
    {
        var s = await app.Settings.GetAsync();
        var d = await app.Deliveries.GetAsync(deliveryId);
        var c = await app.Customers.GetAsync(d.CustomerId);
        var v = Base(s, c.Name);
        v["number"] = d.Number; v["date"] = d.ScheduledDate?.ToString("dd-MMM-yyyy") ?? "-"; v["slot"] = d.TimeSlot; v["driver"] = d.DriverName;
        v["vehicle"] = string.IsNullOrWhiteSpace(d.VehicleNo) ? "" : $"({d.VehicleNo})"; v["otp"] = otp ?? "shared separately";
        return (d.ContactMobile ?? c.Whatsapp ?? c.Mobile ?? "", MessageTemplates.Render(s.WhatsApp.DeliveryTemplate, v));
    }

    public async Task<string> WhatsAppLinkAsync(string mobile, string message)
    {
        var s = await app.Settings.GetAsync();
        return MessageTemplates.WhatsAppLink(mobile, message, s.WhatsApp.CountryCode, s.WhatsApp.UseDesktopApp);
    }

    // ------------------------------------------------------------------ exports
    public void DemandExport() => app.Session.Demand(Perm.ExportData);

    public static byte[] ToCsv(DataTable table, ISet<string>? moneyColumns = null)
    {
        var sb = new StringBuilder();
        sb.AppendLine(string.Join(",", table.Columns.Cast<DataColumn>().Select(c => Csv(c.ColumnName))));
        foreach (DataRow row in table.Rows)
            sb.AppendLine(string.Join(",", table.Columns.Cast<DataColumn>().Select(c => Csv(row[c] switch
            {
                DBNull => "",
                decimal d => d.ToString(System.Globalization.CultureInfo.InvariantCulture),
                DateTime dt => dt.TimeOfDay == TimeSpan.Zero ? dt.ToString("yyyy-MM-dd") : dt.ToString("yyyy-MM-dd HH:mm"),
                var v => v.ToString() ?? "",
            }))));
        // UTF-8 BOM so Excel opens ₹ and Indian names correctly.
        return Encoding.UTF8.GetPreamble().Concat(Encoding.UTF8.GetBytes(sb.ToString())).ToArray();
    }

    /// <summary>Quotes a CSV cell and neutralises spreadsheet formula injection (=, +, -, @ at the start).</summary>
    private static string Csv(string s)
    {
        if (s.Length > 0 && s[0] is '=' or '+' or '@' or '\t' or '\r' && !decimal.TryParse(s, out _)) s = "'" + s;
        if (s.Length > 0 && s[0] == '-' && !decimal.TryParse(s, out _)) s = "'" + s;
        return s.IndexOfAny(new[] { ',', '"', '\n', '\r' }) >= 0 ? "\"" + s.Replace("\"", "\"\"") + "\"" : s;
    }

    public static byte[] ToExcel(DataTable table, string title, string subtitle, ISet<string>? moneyColumns = null)
    {
        using var wb = new XLWorkbook();
        var name = new string(title.Where(ch => !"[]:*?/\\".Contains(ch)).ToArray());
        var ws = wb.Worksheets.Add(name.Length > 31 ? name[..31] : name.Length == 0 ? "Report" : name);
        ws.Cell(1, 1).Value = title;
        ws.Cell(1, 1).Style.Font.Bold = true;
        ws.Cell(1, 1).Style.Font.FontSize = 14;
        ws.Cell(2, 1).Value = subtitle;
        var t = ws.Cell(4, 1).InsertTable(table, "Data", true);
        t.Theme = XLTableTheme.TableStyleLight9;
        for (var i = 0; i < table.Columns.Count; i++)
        {
            var col = table.Columns[i];
            if (moneyColumns?.Contains(col.ColumnName) == true) ws.Column(i + 1).Style.NumberFormat.Format = "[$₹-4009] #,##,##0.00";
            else if (col.DataType == typeof(DateTime)) ws.Column(i + 1).Style.NumberFormat.Format = "dd-mmm-yyyy";
        }
        ws.Columns().AdjustToContents(4, 200);
        using var ms = new MemoryStream();
        wb.SaveAs(ms);
        return ms.ToArray();
    }

    public async Task<byte[]> ToPdfAsync(DataTable table, string title, string subtitle, ISet<string> moneyColumns, IReadOnlyList<(string, string)> totals)
    {
        var s = await app.Settings.GetAsync();
        using var t = new PdfTarget(title);
        Layouts.Table(t, s.Shop.ShopName, title, subtitle, table, moneyColumns, totals);
        return t.ToBytes();
    }

    /// <summary>Converts any list of objects into a DataTable (for exporting list screens).</summary>
    public static DataTable ToTable<T>(IEnumerable<T> items, params (string Header, Func<T, object?> Value)[] columns)
    {
        var dt = new DataTable();
        var list = items.ToList();
        foreach (var (header, value) in columns)
        {
            var type = list.Select(value).FirstOrDefault(v => v is not null)?.GetType() ?? typeof(string);
            dt.Columns.Add(header, Nullable.GetUnderlyingType(type) ?? type);
        }
        foreach (var item in list) dt.Rows.Add(columns.Select(c => c.Value(item) ?? DBNull.Value).ToArray());
        return dt;
    }
}
