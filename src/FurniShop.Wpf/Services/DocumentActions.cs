using FurniShop.Infrastructure.Documents;
using FurniShop.Wpf.Printing;
using FurniShop.Wpf.ViewModels;

namespace FurniShop.Wpf.Services;

/// <summary>Print / PDF / WhatsApp actions shared by the POS, detail screens and lists.</summary>
public static class DocumentActions
{
    private static Infrastructure.AppServices App => AppHost.App;
    private static ShellViewModel Shell => AppHost.Shell;

    public static async Task PrintInvoiceAsync(long invoiceId, bool? thermal = null, bool preview = false)
    {
        var s = await App.Settings.GetAsync();
        var useThermal = thermal ?? s.Invoice.DefaultPrintFormat == "THERMAL";
        var model = await App.Documents.InvoiceModelAsync(invoiceId);
        Action<IDocTarget> layout = useThermal
            ? t => Layouts.Thermal(t, model, s.Printer.ThermalWidthMm, new WpfTarget().NewPage(1000, 1000))
            : t => Layouts.InvoiceA4(t, model);
        Output($"Invoice {model.Number}", layout, preview, useThermal ? s.Printer.ThermalPrinterName : s.Printer.A4PrinterName, s.Printer.Copies);
    }

    public static async Task PrintQuotationAsync(long id, bool preview = false)
    {
        var s = await App.Settings.GetAsync();
        var model = await App.Documents.QuotationModelAsync(id);
        Output($"Quotation {model.Number}", t => Layouts.InvoiceA4(t, model), preview, s.Printer.A4PrinterName, 1);
    }

    public static async Task PrintSalesOrderAsync(long id, bool preview = false)
    {
        var s = await App.Settings.GetAsync();
        var model = await App.Documents.SalesOrderModelAsync(id);
        Output($"Order {model.Number}", t => Layouts.InvoiceA4(t, model), preview, s.Printer.A4PrinterName, 1);
    }

    public static async Task PrintReceiptAsync(long paymentId, bool preview = false)
    {
        var s = await App.Settings.GetAsync();
        var model = await App.Documents.ReceiptModelAsync(paymentId);
        Output($"Receipt {model.Number}", t => Layouts.Receipt(t, model), preview, s.Printer.A4PrinterName, 1);
    }

    public static async Task PrintLabelsAsync(IReadOnlyList<LabelItem> items, LabelFormat format, bool qr, bool preview)
    {
        var s = await App.Settings.GetAsync();
        Output("Labels", t => Layouts.Labels(t, items, format, qr), preview, format == LabelFormat.Roll50x25 ? s.Printer.LabelPrinterName : s.Printer.A4PrinterName, 1);
    }

    private static void Output(string title, Action<IDocTarget> layout, bool preview, string? printer, int copies)
    {
        if (preview) PrintService.Preview(title, layout);
        else if (PrintService.Print(title, layout, printer, copies)) Shell.Toast.Success($"{title} sent to printer.");
    }

    public static async Task<string> SavePdfAsync(byte[] pdf, string name, bool open = true)
    {
        var path = await App.Documents.SavePdfAsync(pdf, name);
        if (open) AppHost.OpenExternal(path);
        else Shell.Toast.Success($"Saved {System.IO.Path.GetFileName(path)}", () => AppHost.OpenExternal(path));
        return path;
    }

    public static async Task InvoicePdfAsync(long invoiceId, bool open = true)
    {
        var inv = await App.Invoices.GetAsync(invoiceId);
        await SavePdfAsync(await App.Documents.InvoicePdfAsync(invoiceId), $"{inv.Number ?? "Draft-" + inv.Id} {inv.CustomerName}", open);
    }

    /// <summary>
    /// Opens WhatsApp with the message pre-filled (wa.me click-to-chat). If a PDF is supplied it is saved and its
    /// folder opened so staff can attach it in WhatsApp — the link itself cannot carry attachments.
    /// </summary>
    public static async Task WhatsAppAsync((string Mobile, string Message) msg, Func<Task<(byte[] Pdf, string Name)>>? attachment = null)
    {
        var dialog = new WhatsAppDialogViewModel(msg.Mobile, msg.Message, attachment is not null);
        if (!await Shell.ShowDialogAsync(dialog)) return;
        var link = await App.Documents.WhatsAppLinkAsync(dialog.Mobile, dialog.Message);
        if (dialog.AttachPdf && attachment is not null)
        {
            var (pdf, name) = await attachment();
            var path = await App.Documents.SavePdfAsync(pdf, name);
            AppHost.ShowInFolder(path);
            Shell.Toast.Info("PDF saved — drag it into the WhatsApp chat to attach it.");
        }
        AppHost.OpenExternal(link);
        await App.Audit.LogAsync("WHATSAPP", "Messaging", $"opened WhatsApp message to {dialog.Mobile}");
    }
}
