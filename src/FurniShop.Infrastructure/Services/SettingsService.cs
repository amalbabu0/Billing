using System.Text.Json;
using Dapper;
using FurniShop.Core;
using FurniShop.Core.Domain;
using FurniShop.Core.Security;
using FurniShop.Core.Settings;
using FurniShop.Core.Validation;
using FurniShop.Infrastructure.Database;
using FurniShop.Infrastructure.Security;
using Npgsql;

namespace FurniShop.Infrastructure.Services;

/// <summary>Typed application settings stored as JSON rows, plus GST / HSN / payment-method / numbering masters.</summary>
public sealed class SettingsService(Db db, UserSession session, AuditService audit)
{
    // Shared by every SettingsService on the same database (the web server builds one per request).
    private static readonly System.Collections.Concurrent.ConcurrentDictionary<string, (AppSettingsSnapshot Value, DateTime At)> Cache = new();

    public static readonly IReadOnlyDictionary<string, Type> Sections = new Dictionary<string, Type>
    {
        ["shop"] = typeof(ShopSettings), ["invoice"] = typeof(InvoiceSettings), ["tax"] = typeof(TaxSettings),
        ["delivery"] = typeof(DeliverySettings), ["inventory"] = typeof(InventorySettings), ["printer"] = typeof(PrinterSettings),
        ["whatsapp"] = typeof(WhatsAppSettings), ["security"] = typeof(SecuritySettings), ["backup"] = typeof(BackupSettings),
    };

    public event EventHandler? SettingsChanged;

    /// <summary>Returns cached settings (refreshed every 60 s so other tills pick up changes).</summary>
    public async Task<AppSettingsSnapshot> GetAsync(bool refresh = false)
    {
        if (!refresh && Cache.TryGetValue(db.ConnectionString, out var c) && DateTime.UtcNow - c.At < TimeSpan.FromSeconds(60)) return c.Value;
        await using var conn = await db.OpenAsync();
        var value = await LoadAsync(conn, null);
        Cache[db.ConnectionString] = (value, DateTime.UtcNow);
        return value;
    }

    internal static async Task<AppSettingsSnapshot> LoadAsync(NpgsqlConnection conn, NpgsqlTransaction? tx)
    {
        var rows = (await conn.QueryAsync<(string Key, string Value)>("select key, value::text from settings", transaction: tx))
            .ToDictionary(r => r.Key, r => r.Value);
        T Read<T>(string key) where T : new() =>
            rows.TryGetValue(key, out var json) ? JsonSerializer.Deserialize<T>(json) ?? new T() : new T();
        return new AppSettingsSnapshot
        {
            Shop = Read<ShopSettings>("shop"), Invoice = Read<InvoiceSettings>("invoice"), Tax = Read<TaxSettings>("tax"),
            Delivery = Read<DeliverySettings>("delivery"), Inventory = Read<InventorySettings>("inventory"),
            Printer = Read<PrinterSettings>("printer"), WhatsApp = Read<WhatsAppSettings>("whatsapp"),
            Security = Read<SecuritySettings>("security"), Backup = Read<BackupSettings>("backup"),
        };
    }

    public async Task SaveAsync<T>(string key, T value) where T : class
    {
        if (!Sections.TryGetValue(key, out var type) || type != typeof(T)) throw new ArgumentException($"Unknown settings section {key}");
        session.Demand(key == "backup" ? Perm.BackupManage : Perm.SettingsManage);
        Validate(value);

        await db.InTransactionAsync(async (conn, tx) =>
        {
            var current = await LoadAsync(conn, tx);
            if (value is InventorySettings inv && inv.AllowNegativeStock && !current.Inventory.AllowNegativeStock && !session.IsAdmin)
                throw new PermissionDeniedException("Only an admin can allow negative stock");

            var old = await conn.ExecuteScalarAsync<string?>("select value::text from settings where key = @key", new { key }, tx);
            var json = JsonSerializer.Serialize(value);
            await conn.ExecuteAsync("""
                insert into settings (key, value, updated_at, updated_by) values (@key, cast(@json as jsonb), now(), @uid)
                on conflict (key) do update set value = excluded.value, updated_at = now(), updated_by = excluded.updated_by
                """, new { key, json, uid = session.UserId }, tx);
            await audit.LogAsync(conn, tx, "UPDATE", "Settings", $"updated {key} settings", "settings", null, key,
                old is null ? null : JsonDocument.Parse(old).RootElement, value);
        });
        Cache.TryRemove(db.ConnectionString, out _);
        SettingsChanged?.Invoke(this, EventArgs.Empty);
    }

    private static void Validate(object value)
    {
        var v = new ValidationBuilder();
        switch (value)
        {
            case ShopSettings s:
                v.Require(s.ShopName, nameof(s.ShopName), "Shop name")
                 .Check(IndianStates.ByCode(s.StateCode) is not null, nameof(s.StateCode), "Select the shop's state.")
                 .Optional(s.Gstin, Validators.IsValidGstin, nameof(s.Gstin), "GSTIN is not valid.")
                 .Optional(s.Email, Validators.IsValidEmail, nameof(s.Email), "Email is not valid.")
                 .Optional(s.Pincode, Validators.IsValidPincode, nameof(s.Pincode), "PIN code must be 6 digits.");
                if (!string.IsNullOrWhiteSpace(s.Gstin) && Validators.IsValidGstin(s.Gstin))
                    v.Check(s.Gstin!.Trim()[..2] == s.StateCode, nameof(s.Gstin), "GSTIN state code does not match the shop's state.");
                break;
            case InvoiceSettings i:
                v.Check(i.DefaultDueDays is >= 0 and <= 365, nameof(i.DefaultDueDays), "Due days must be 0–365.")
                 .Check(i.QuotationValidityDays is >= 1 and <= 365, nameof(i.QuotationValidityDays), "Validity must be 1–365 days.")
                 .Check(i.DefaultPrintFormat is "A4" or "THERMAL", nameof(i.DefaultPrintFormat), "Choose A4 or Thermal.");
                break;
            case TaxSettings t:
                v.Check(t.DefaultGstRate is >= 0 and <= 100, nameof(t.DefaultGstRate), "GST rate must be 0–100.")
                 .Check(t.ChargesGstRate is >= 0 and <= 100, nameof(t.ChargesGstRate), "GST rate must be 0–100.");
                break;
            case DeliverySettings d:
                v.Check(d.DefaultDeliveryCharge >= 0 && d.DefaultInstallationCharge >= 0, nameof(d.DefaultDeliveryCharge), "Charges cannot be negative.");
                break;
            case SecuritySettings sec:
                v.Check(sec.MaxFailedLogins is >= 3 and <= 20, nameof(sec.MaxFailedLogins), "Allowed failed logins must be 3–20.")
                 .Check(sec.MinPasswordLength is >= 6 and <= 64, nameof(sec.MinPasswordLength), "Minimum password length must be 6–64.")
                 .Check(sec.IdleTimeoutMinutes is >= 0 and <= 480, nameof(sec.IdleTimeoutMinutes), "Idle timeout must be 0–480 minutes.");
                break;
            case PrinterSettings p:
                v.Check(p.ThermalWidthMm is 58 or 80, nameof(p.ThermalWidthMm), "Thermal width must be 58 or 80 mm.")
                 .Check(p.Copies is >= 1 and <= 5, nameof(p.Copies), "Copies must be 1–5.");
                break;
        }
        v.ThrowIfInvalid();
    }

    // ---------------- GST rates ----------------
    public Task<IReadOnlyList<GstRate>> GstRatesAsync(bool activeOnly = false) =>
        db.QueryAsync<GstRate>($"select * from gst_rates {(activeOnly ? "where is_active" : "")} order by rate");

    public async Task SaveGstRateAsync(GstRate rate)
    {
        session.Demand(Perm.SettingsManage);
        if (rate.Rate is < 0 or > 100) throw new ValidationException("Rate", "GST rate must be between 0 and 100.");
        await db.InTransactionAsync(async (conn, tx) =>
        {
            if (rate.IsDefault) await conn.ExecuteAsync("update gst_rates set is_default = false", transaction: tx);
            if (rate.Id == 0)
                rate.Id = await conn.ExecuteScalarAsync<long>(
                    "insert into gst_rates (name, rate, is_active, is_default) values (@Name, @Rate, @IsActive, @IsDefault) returning id", rate, tx);
            else
                await conn.ExecuteAsync("update gst_rates set name=@Name, rate=@Rate, is_active=@IsActive, is_default=@IsDefault where id=@Id", rate, tx);
            await audit.LogAsync(conn, tx, "SAVE", "Settings", $"saved GST rate {rate.Rate:0.##}%", "gst_rate", rate.Id, rate.Name, null, rate);
        });
    }

    // ---------------- HSN codes ----------------
    public Task<IReadOnlyList<HsnCode>> HsnCodesAsync() => db.QueryAsync<HsnCode>("select * from hsn_codes order by code");

    public async Task SaveHsnAsync(HsnCode hsn)
    {
        session.Demand(Perm.SettingsManage);
        new ValidationBuilder()
            .Check(!string.IsNullOrWhiteSpace(hsn.Code) && hsn.Code.Trim().All(char.IsDigit) && hsn.Code.Trim().Length is 4 or 6 or 8,
                nameof(hsn.Code), "HSN/SAC code must be 4, 6 or 8 digits.")
            .Require(hsn.Description, nameof(hsn.Description), "Description")
            .Check(hsn.DefaultGstRate is >= 0 and <= 100, nameof(hsn.DefaultGstRate), "GST rate must be 0–100.")
            .ThrowIfInvalid();
        hsn.Code = hsn.Code.Trim();
        await db.InTransactionAsync(async (conn, tx) =>
        {
            await conn.ExecuteAsync("""
                insert into hsn_codes (code, description, default_gst_rate, is_active) values (@Code, @Description, @DefaultGstRate, @IsActive)
                on conflict (code) do update set description = excluded.description, default_gst_rate = excluded.default_gst_rate, is_active = excluded.is_active
                """, hsn, tx);
            await audit.LogAsync(conn, tx, "SAVE", "Settings", $"saved HSN {hsn.Code}", "hsn", null, hsn.Code, null, hsn);
        });
    }

    // ---------------- Payment methods ----------------
    public Task<IReadOnlyList<PaymentMethod>> PaymentMethodsAsync(bool activeOnly = false) =>
        db.QueryAsync<PaymentMethod>($"select * from payment_methods {(activeOnly ? "where is_active" : "")} order by sort_order, name");

    public async Task SavePaymentMethodAsync(PaymentMethod m)
    {
        session.Demand(Perm.SettingsManage);
        new ValidationBuilder()
            .Check(Validators.IsValidCode(m.Code), nameof(m.Code), "Code must be letters/numbers.")
            .Require(m.Name, nameof(m.Name), "Name").ThrowIfInvalid();
        m.Code = m.Code.Trim().ToUpperInvariant();
        if (m.Code == PaymentMethodCode.Cash && !m.IsActive) throw new BusinessRuleException("Cash cannot be disabled.");
        await db.InTransactionAsync(async (conn, tx) =>
        {
            await conn.ExecuteAsync("""
                insert into payment_methods (code, name, is_active, sort_order, is_money) values (@Code, @Name, @IsActive, @SortOrder, @IsMoney)
                on conflict (code) do update set name = excluded.name, is_active = excluded.is_active, sort_order = excluded.sort_order
                """, m, tx);
            await audit.LogAsync(conn, tx, "SAVE", "Settings", $"saved payment method {m.Name}", "payment_method", null, m.Code, null, m);
        });
    }

    // ---------------- Document numbering ----------------
    public Task<IReadOnlyList<DocumentSequence>> SequencesAsync() =>
        db.QueryAsync<DocumentSequence>("select * from document_sequences order by doc_type");

    public async Task SaveSequenceAsync(DocumentSequence s)
    {
        session.Demand(Perm.SettingsManage);
        new ValidationBuilder()
            .Check(!string.IsNullOrWhiteSpace(s.Prefix) && s.Prefix.Trim().Length <= 10 && s.Prefix.Trim().All(c => char.IsLetterOrDigit(c) || c is '-' or '/'),
                nameof(s.Prefix), "Prefix must be up to 10 letters/digits.")
            .Check(s.Padding is >= 1 and <= 10, nameof(s.Padding), "Padding must be 1–10.")
            .Check(s.NextNumber >= 1, nameof(s.NextNumber), "Next number must be at least 1.")
            .ThrowIfInvalid();
        await db.InTransactionAsync(async (conn, tx) =>
        {
            var old = await conn.QuerySingleAsync<DocumentSequence>("select * from document_sequences where doc_type=@DocType for update", s, tx);
            // Protect against re-using numbers already issued in the current series.
            if (s.DocType == DocType.Invoice && s.NextNumber < old.NextNumber && s.Prefix.Trim() == old.Prefix && s.IncludeYear == old.IncludeYear)
                throw new BusinessRuleException("The invoice number cannot be moved backwards — invoice numbers must stay unique.");
            await conn.ExecuteAsync("update document_sequences set prefix=@Prefix, include_year=@IncludeYear, padding=@Padding, next_number=@NextNumber where doc_type=@DocType",
                new { Prefix = s.Prefix.Trim(), s.IncludeYear, s.Padding, s.NextNumber, s.DocType }, tx);
            await audit.LogAsync(conn, tx, "UPDATE", "Settings", $"changed numbering for {s.DocType}", "sequence", null, s.DocType, old, s);
        });
    }

    public static string Preview(DocumentSequence s, int year) =>
        SequenceService.Format(s.Prefix, s.IncludeYear, year, s.Padding, s.NextNumber);
}
