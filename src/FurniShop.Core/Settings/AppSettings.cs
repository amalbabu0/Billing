namespace FurniShop.Core.Settings;

/// <summary>Stored as JSON under key "shop".</summary>
public sealed class ShopSettings
{
    public string ShopName { get; set; } = "My Furniture Showroom";
    /// <summary>Legal name as registered for GST (shown on tax invoices when it differs from the trade name).</summary>
    public string? LegalName { get; set; }
    public string? Tagline { get; set; } = "Quality furniture for every home";
    public string Address { get; set; } = "";
    public string? City { get; set; }
    public string StateCode { get; set; } = "29";
    public string? Pincode { get; set; }
    public string? Phone { get; set; }
    public string? Email { get; set; }
    public string? Website { get; set; }
    public string? Gstin { get; set; }
    public string? Pan { get; set; }
    public long? LogoAttachmentId { get; set; }
    public string? BankName { get; set; }
    public string? BankAccount { get; set; }
    public string? BankIfsc { get; set; }
    public string? UpiId { get; set; }
}

/// <summary>Stored as JSON under key "invoice".</summary>
public sealed class InvoiceSettings
{
    public string Terms { get; set; } =
        "1. Goods once sold will not be taken back except as per the store return policy.\n" +
        "2. Warranty as per manufacturer terms; does not cover physical damage or misuse.\n" +
        "3. Delivery within city limits; floor charges extra where applicable.\n" +
        "4. Subject to local jurisdiction.";
    public string Footer { get; set; } = "Thank you for choosing us!";
    public int DefaultDueDays { get; set; } = 15;
    public int QuotationValidityDays { get; set; } = 15;
    public bool RoundOff { get; set; } = true;
    public bool ShowAmountInWords { get; set; } = true;
    public bool ShowBankDetails { get; set; } = true;
    public bool ShowSignatureBox { get; set; } = true;
    public string DefaultPrintFormat { get; set; } = "A4"; // A4 | THERMAL
    public string Title { get; set; } = "TAX INVOICE";
}

/// <summary>Stored as JSON under key "tax".</summary>
public sealed class TaxSettings
{
    public bool GstRegistered { get; set; } = true;
    public decimal DefaultGstRate { get; set; } = 18m;
    public bool DefaultPriceIncludesGst { get; set; } = true;
    /// <summary>GST rate applied to delivery and installation charges (charges are entered exclusive of GST).</summary>
    public decimal ChargesGstRate { get; set; } = 18m;
    public string? DefaultHsn { get; set; } = "9403";
}

/// <summary>Stored as JSON under key "delivery".</summary>
public sealed class DeliverySettings
{
    public decimal DefaultDeliveryCharge { get; set; } = 500m;
    public decimal DefaultInstallationCharge { get; set; } = 0m;
    public bool RequireOtp { get; set; } = false;
    public bool AutoCreateDelivery { get; set; } = true;
}

/// <summary>Stored as JSON under key "inventory".</summary>
public sealed class InventorySettings
{
    /// <summary>Only an admin can switch this on. When off, stock can never go below zero.</summary>
    public bool AllowNegativeStock { get; set; }
    public bool ReserveOnSalesOrderConfirm { get; set; } = true;
    public bool UpdateCostOnPurchase { get; set; } = true;
}

/// <summary>Stored as JSON under key "printer".</summary>
public sealed class PrinterSettings
{
    public string? A4PrinterName { get; set; }
    public string? ThermalPrinterName { get; set; }
    public int ThermalWidthMm { get; set; } = 80;
    public string? LabelPrinterName { get; set; }
    public int Copies { get; set; } = 1;
    public string PdfFolder { get; set; } = "";
}

/// <summary>Stored as JSON under key "whatsapp".</summary>
public sealed class WhatsAppSettings
{
    public string CountryCode { get; set; } = "91";
    public bool UseDesktopApp { get; set; } = false;

    public string QuotationTemplate { get; set; } =
        "Hello {customer},\nThank you for visiting {shop}.\nYour quotation {number} for {total} is valid until {valid_until}.\nPlease contact us at {shop_phone} to confirm your order.";
    public string InvoiceTemplate { get; set; } =
        "Hello {customer},\nYour invoice {number} for {total} has been generated.\nPaid: {paid}\nBalance: {balance}\nThank you for choosing {shop}.";
    public string ReceiptTemplate { get; set; } =
        "Hello {customer},\nWe have received {amount} via {method} (Receipt {number}) on {date}.\nOutstanding balance: {balance}.\nThank you — {shop}";
    public string ReminderTemplate { get; set; } =
        "Hello {customer},\nThis is a gentle reminder that {balance} is outstanding against invoice {number} (due {due_date}).\nPlease contact {shop_phone} for any queries. — {shop}";
    public string DeliveryTemplate { get; set; } =
        "Hello {customer},\nYour furniture delivery {number} is scheduled on {date} {slot}.\nDriver: {driver} {vehicle}\nDelivery OTP: {otp}\n— {shop}";
    public string OrderConfirmationTemplate { get; set; } =
        "Hello {customer},\nYour order {number} for {total} is confirmed.\nAdvance received: {paid}\nBalance: {balance}\nExpected delivery: {date}\nThank you — {shop}";
    public string ProductionReadyTemplate { get; set; } =
        "Hello {customer},\nGood news — your {product} ({number}) is ready.\nBalance to pay: {balance}\nWe will call you to fix a delivery date. — {shop}, {shop_phone}";
    public string DeliveryCompletedTemplate { get; set; } =
        "Hello {customer},\nYour delivery {number} was completed on {date}. Received by {receiver}.\nThank you for shopping with {shop}!";
    public string WarrantyReminderTemplate { get; set; } =
        "Hello {customer},\nThe warranty {number} on your {product} ends on {end_date}.\nIf anything needs attention, call us at {shop_phone} before then. — {shop}";
    public string ServiceUpdateTemplate { get; set; } =
        "Hello {customer},\nYour service request {number} for {product} {status}.\nFor help call {shop_phone}. — {shop}";
}

/// <summary>Stored as JSON under key "security".</summary>
public sealed class SecuritySettings
{
    public int MaxFailedLogins { get; set; } = 5;
    public int LockoutMinutes { get; set; } = 15;
    public int IdleTimeoutMinutes { get; set; } = 30;
    public int MinPasswordLength { get; set; } = 8;
    public int PasswordExpiryDays { get; set; } = 0;
}

/// <summary>Stored as JSON under key "backup".</summary>
public sealed class BackupSettings
{
    public string BackupFolder { get; set; } = "";
    public string? PgDumpPath { get; set; }
    public string? PgRestorePath { get; set; }
    public DateTime? LastBackupAt { get; set; }
    public int ReminderDays { get; set; } = 7;
}

/// <summary>Snapshot of all settings used by services.</summary>
public sealed class AppSettingsSnapshot
{
    public ShopSettings Shop { get; set; } = new();
    public InvoiceSettings Invoice { get; set; } = new();
    public TaxSettings Tax { get; set; } = new();
    public DeliverySettings Delivery { get; set; } = new();
    public InventorySettings Inventory { get; set; } = new();
    public PrinterSettings Printer { get; set; } = new();
    public WhatsAppSettings WhatsApp { get; set; } = new();
    public SecuritySettings Security { get; set; } = new();
    public BackupSettings Backup { get; set; } = new();
}
