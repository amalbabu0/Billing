using System.Globalization;
using System.Text;
using ClosedXML.Excel;
using Dapper;
using FurniShop.Core;
using FurniShop.Core.Domain;
using FurniShop.Core.Security;
using FurniShop.Core.Validation;
using FurniShop.Infrastructure.Database;
using FurniShop.Infrastructure.Security;

namespace FurniShop.Infrastructure.Services;

public sealed class ImportRow
{
    public int Line { get; set; }
    /// <summary>CREATE, UPDATE or ERROR.</summary>
    public string Action { get; set; } = "CREATE";
    public List<string> Errors { get; set; } = new();
    public List<string> Warnings { get; set; } = new();
    public string Code { get; set; } = "";
    public string Name { get; set; } = "";
    public string Category { get; set; } = "";
    public string? Brand { get; set; }
    public string? Material { get; set; }
    public string? Color { get; set; }
    public string? Finish { get; set; }
    public string? Dimensions { get; set; }
    public string? HsnCode { get; set; }
    public decimal GstRate { get; set; } = 18;
    public bool PriceIncludesGst { get; set; } = true;
    public decimal? CostPrice { get; set; }
    public decimal SellingPrice { get; set; }
    public decimal DiscountPercent { get; set; }
    public decimal MinStock { get; set; }
    public int WarrantyMonths { get; set; }
    public decimal OpeningStock { get; set; }
    public bool IsStockItem { get; set; } = true;
    public string? Barcode { get; set; }
    public string? Description { get; set; }
}

public sealed class ImportPreview
{
    public List<ImportRow> Rows { get; set; } = new();
    public int Creates => Rows.Count(r => r.Action == "CREATE");
    public int Updates => Rows.Count(r => r.Action == "UPDATE");
    public int ErrorCount => Rows.Count(r => r.Action == "ERROR");
    public List<string> NewCategories { get; set; } = new();
    public List<string> NewBrands { get; set; } = new();
}

public sealed class ImportResult
{
    public int Created { get; set; }
    public int Updated { get; set; }
    public List<string> Failed { get; set; } = new();
}

public sealed class BulkProductUpdate
{
    public List<long> ProductIds { get; set; } = new();
    /// <summary>PRICE_PERCENT, PRICE_SET, GST, CATEGORY, STATUS, DISCOUNT, MIN_STOCK, HSN</summary>
    public string Action { get; set; } = "";
    public decimal? Value { get; set; }
    public string? Text { get; set; }
}

/// <summary>
/// Spreadsheet import of the catalogue (CSV or Excel): parse → validate → preview → commit. Existing product codes are
/// updated (prices, tax, category…; stock is never changed by an update), new codes are created with optional opening stock.
/// </summary>
public sealed class ProductImportService(Db db, UserSession session, AuditService audit, CatalogService catalog)
{
    public static readonly string[] Columns =
    {
        "Code", "Name", "Category", "Brand", "Material", "Color", "Finish", "Dimensions", "HSN", "GST %", "Price includes GST",
        "Cost price", "Selling price", "Discount %", "Min stock", "Warranty months", "Opening stock", "Stock item", "Barcode", "Description",
    };

    public static byte[] Template()
    {
        using var wb = new XLWorkbook();
        var ws = wb.AddWorksheet("Products");
        for (var i = 0; i < Columns.Length; i++) ws.Cell(1, i + 1).Value = Columns[i];
        object[] sample = { "SOF-CHS-01", "Chesterfield 3 Seater Sofa", "Sofa", "Royal Oak", "Sheesham + velvet", "Emerald", "Walnut", "84 x 36 x 32 in",
            "9401", 18, "Yes", 28000, 45000, 5, 1, 12, 2, "Yes", "", "Tufted back, removable cushions" };
        for (var i = 0; i < sample.Length; i++) ws.Cell(2, i + 1).Value = XLCellValue.FromObject(sample[i]);
        ws.Row(1).Style.Font.Bold = true;
        ws.Columns().AdjustToContents();
        using var ms = new MemoryStream();
        wb.SaveAs(ms);
        return ms.ToArray();
    }

    public async Task<ImportPreview> PreviewAsync(byte[] file, string fileName)
    {
        session.Demand(Perm.ProductImport);
        var table = fileName.EndsWith(".xlsx", StringComparison.OrdinalIgnoreCase) ? ReadExcel(file) : ReadCsv(file);
        if (table.Count < 2) throw new ValidationException("File", "The file has no product rows. Use the template: one header row, then one product per row.");
        if (table.Count > 5001) throw new ValidationException("File", "Import up to 5,000 products at a time.");
        var header = table[0].Select(h => h.Trim().ToLowerInvariant()).ToList();
        int Col(string name) => header.IndexOf(name.ToLowerInvariant());
        foreach (var required in new[] { "Code", "Name", "Category", "Selling price" })
            if (Col(required) < 0) throw new ValidationException("File", $"Column “{required}” is missing. Download the template to see the expected columns.");

        await using var conn = await db.OpenAsync();
        var cats = (await conn.QueryAsync<(long Id, string Name)>("select id, name from categories")).ToDictionary(c => c.Name.Trim().ToLowerInvariant(), c => c.Id);
        var brands = (await conn.QueryAsync<(long Id, string Name)>("select id, name from brands")).ToDictionary(c => c.Name.Trim().ToLowerInvariant(), c => c.Id);
        var existing = (await conn.QueryAsync<string>("select lower(code) from products where not is_deleted")).ToHashSet();
        var rates = (await conn.QueryAsync<decimal>("select rate from gst_rates where is_active")).ToHashSet();
        var barcodes = (await conn.QueryAsync<string>("select barcode from product_variants where barcode is not null and not is_deleted")).ToHashSet();
        var preview = new ImportPreview();
        var seen = new HashSet<string>();

        for (var r = 1; r < table.Count; r++)
        {
            var cells = table[r];
            string? Get(string name) { var i = Col(name); return i >= 0 && i < cells.Count && !string.IsNullOrWhiteSpace(cells[i]) ? cells[i].Trim() : null; }
            if (cells.All(string.IsNullOrWhiteSpace)) continue;
            var row = new ImportRow { Line = r + 1 };
            decimal Num(string name, decimal fallback, bool required = false)
            {
                var v = Get(name);
                if (v is null) { if (required) row.Errors.Add($"{name} is required."); return fallback; }
                var clean = v.Replace("₹", "").Replace(",", "").Replace("%", "").Trim();
                if (decimal.TryParse(clean, NumberStyles.Number, CultureInfo.InvariantCulture, out var d) && d >= 0) return d;
                row.Errors.Add($"{name} “{v}” is not a valid number."); return fallback;
            }
            bool Bool(string name, bool fallback)
            {
                var v = Get(name)?.ToLowerInvariant();
                return v switch { null => fallback, "yes" or "y" or "true" or "1" => true, "no" or "n" or "false" or "0" => false, _ => Invalid() };
                bool Invalid() { row.Errors.Add($"{name} must be Yes or No."); return fallback; }
            }
            row.Code = Get("Code") ?? ""; row.Name = Get("Name") ?? ""; row.Category = Get("Category") ?? "";
            row.Brand = Get("Brand"); row.Material = Get("Material"); row.Color = Get("Color"); row.Finish = Get("Finish"); row.Dimensions = Get("Dimensions");
            row.HsnCode = Get("HSN"); row.Barcode = Get("Barcode"); row.Description = Get("Description");
            row.GstRate = Num("GST %", 18); row.PriceIncludesGst = Bool("Price includes GST", true);
            row.CostPrice = Get("Cost price") is null ? null : Num("Cost price", 0);
            row.SellingPrice = Num("Selling price", 0, true); row.DiscountPercent = Num("Discount %", 0); row.MinStock = Num("Min stock", 0);
            row.WarrantyMonths = (int)Num("Warranty months", 0); row.OpeningStock = Num("Opening stock", 0); row.IsStockItem = Bool("Stock item", true);

            if (!Validators.IsValidCode(row.Code)) row.Errors.Add("Code is required (letters, digits, - _ / .).");
            if (string.IsNullOrWhiteSpace(row.Name)) row.Errors.Add("Name is required.");
            if (string.IsNullOrWhiteSpace(row.Category)) row.Errors.Add("Category is required.");
            if (!rates.Contains(row.GstRate)) row.Errors.Add($"GST {row.GstRate}% is not set up (Settings → Tax rates).");
            if (row.DiscountPercent > 100) row.Errors.Add("Discount cannot exceed 100%.");
            if (row.HsnCode is { } h && !(h.All(char.IsDigit) && h.Length is 4 or 6 or 8)) row.Errors.Add("HSN must be 4, 6 or 8 digits.");
            if (!seen.Add(row.Code.ToLowerInvariant()) && row.Code.Length > 0) row.Errors.Add("This code appears more than once in the file.");
            row.Action = existing.Contains(row.Code.ToLowerInvariant()) ? "UPDATE" : "CREATE";
            if (row.Action == "UPDATE" && row.OpeningStock > 0) row.Warnings.Add("Opening stock is ignored for existing products — use a stock adjustment.");
            if (row.Action == "CREATE" && row.Barcode is { } b && barcodes.Contains(b)) row.Errors.Add($"Barcode {b} is already used.");
            if (row.CostPrice is { } cp && cp > row.SellingPrice && row.SellingPrice > 0) row.Warnings.Add("Cost is higher than the selling price.");
            if (!session.CanSeeCost && row.CostPrice is not null) { row.CostPrice = null; row.Warnings.Add("Cost price ignored — your role cannot set costs."); }
            if (row.Category.Length > 0 && !cats.ContainsKey(row.Category.ToLowerInvariant()) && !preview.NewCategories.Contains(row.Category, StringComparer.OrdinalIgnoreCase)) preview.NewCategories.Add(row.Category);
            if (row.Brand is { } br && !brands.ContainsKey(br.ToLowerInvariant()) && !preview.NewBrands.Contains(br, StringComparer.OrdinalIgnoreCase)) preview.NewBrands.Add(br);
            if (row.Errors.Count > 0) row.Action = "ERROR";
            preview.Rows.Add(row);
        }
        return preview;
    }

    /// <summary>Applies previewed rows (rows with errors are skipped). Missing categories and brands are created.</summary>
    public async Task<ImportResult> CommitAsync(List<ImportRow> rows)
    {
        session.Demand(Perm.ProductImport);
        session.Demand(Perm.ProductManage);
        var result = new ImportResult();
        var good = rows.Where(r => r.Action != "ERROR" && r.Errors.Count == 0).ToList();
        var cats = (await db.QueryAsync<(long Id, string Name)>("select id, name from categories")).ToDictionary(c => c.Name.Trim().ToLowerInvariant(), c => c.Id);
        var brands = (await db.QueryAsync<(long Id, string Name)>("select id, name from brands")).ToDictionary(c => c.Name.Trim().ToLowerInvariant(), c => c.Id);
        foreach (var r in good)
        {
            try
            {
                if (!cats.TryGetValue(r.Category.ToLowerInvariant(), out var catId))
                    cats[r.Category.ToLowerInvariant()] = catId = await catalog.SaveCategoryAsync(new Category { Name = r.Category.Trim(), DefaultHsn = r.HsnCode, DefaultGstRate = r.GstRate });
                long? brandId = null;
                if (r.Brand is { } b)
                {
                    if (!brands.TryGetValue(b.ToLowerInvariant(), out var bid)) brands[b.ToLowerInvariant()] = bid = await catalog.SaveBrandAsync(new Brand { Name = b.Trim() });
                    brandId = bid;
                }
                var id = await db.ScalarAsync<long?>("select id from products where lower(code) = lower(@Code) and not is_deleted", r);
                Product p;
                if (id is { } pid)
                {
                    p = await catalog.GetProductAsync(pid);
                    p.Variants.Clear(); // keep existing variants untouched
                }
                else p = new Product { Code = r.Code.Trim() };
                p.Name = r.Name.Trim(); p.CategoryId = catId; p.BrandId = brandId; p.Material = r.Material; p.Color = r.Color; p.Finish = r.Finish; p.Dimensions = r.Dimensions;
                p.HsnCode = r.HsnCode; p.GstRate = r.GstRate; p.PriceIncludesGst = r.PriceIncludesGst; p.SellingPrice = r.SellingPrice; p.DiscountPercent = r.DiscountPercent;
                p.MinStock = r.MinStock; p.WarrantyMonths = r.WarrantyMonths; p.IsStockItem = r.IsStockItem; p.Description = r.Description ?? p.Description;
                if (r.CostPrice is not null) p.CostPrice = r.CostPrice;
                if (id is null)
                    p.Variants.Add(new ProductVariant { VariantName = "Standard", Sku = p.Code, Barcode = r.Barcode, IsDefault = true, OpeningStock = r.IsStockItem ? r.OpeningStock : 0 });
                await catalog.SaveProductAsync(p);
                if (id is null) result.Created++; else result.Updated++;
            }
            catch (Exception ex) when (ex is ValidationException or BusinessRuleException or Npgsql.PostgresException)
            {
                result.Failed.Add($"Row {r.Line} ({r.Code}): {(ex is ValidationException v ? string.Join(" ", v.Errors.Values) : ex.Message)}");
            }
        }
        await audit.LogAsync("IMPORT", "Products", $"imported products: {result.Created} created, {result.Updated} updated, {result.Failed.Count} failed");
        return result;
    }

    public async Task<int> BulkUpdateAsync(BulkProductUpdate u)
    {
        session.Demand(Perm.ProductManage);
        if (u.ProductIds.Count == 0) throw new ValidationException("ProductIds", "Select products first.");
        if (u.ProductIds.Count > 2000) throw new ValidationException("ProductIds", "Update up to 2,000 products at a time.");
        var ids = u.ProductIds.Distinct().ToArray();
        return await db.InTransactionAsync(async (conn, tx) =>
        {
            var v = u.Value ?? 0;
            string sql;
            switch (u.Action)
            {
                case "PRICE_PERCENT":
                    if (v is < -90 or > 500) throw new ValidationException("Value", "Change must be between −90% and +500%.");
                    sql = "update products set selling_price = round(selling_price * (1 + @v / 100)), updated_at = now() where id = any(@ids) and not is_deleted";
                    await conn.ExecuteAsync("update product_variants set selling_price = round(selling_price * (1 + @v / 100)), updated_at = now() where product_id = any(@ids) and selling_price is not null", new { v, ids }, tx);
                    break;
                case "PRICE_SET":
                    if (v < 0) throw new ValidationException("Value", "Price cannot be negative.");
                    sql = "update products set selling_price = @v, updated_at = now() where id = any(@ids) and not is_deleted"; break;
                case "GST":
                    if (!await conn.ExecuteScalarAsync<bool>("select exists(select 1 from gst_rates where rate = @v and is_active)", new { v }, tx)) throw new ValidationException("Value", $"GST {v}% is not set up.");
                    sql = "update products set gst_rate = @v, updated_at = now() where id = any(@ids) and not is_deleted"; break;
                case "DISCOUNT":
                    if (v is < 0 or > 100) throw new ValidationException("Value", "Discount must be 0–100%.");
                    sql = "update products set discount_percent = @v, updated_at = now() where id = any(@ids) and not is_deleted"; break;
                case "MIN_STOCK":
                    if (v < 0) throw new ValidationException("Value", "Minimum stock cannot be negative.");
                    sql = "update products set min_stock = @v, updated_at = now() where id = any(@ids) and not is_deleted"; break;
                case "CATEGORY":
                    if (!await conn.ExecuteScalarAsync<bool>("select exists(select 1 from categories where id = @v)", new { v }, tx)) throw new ValidationException("Value", "Choose a category.");
                    sql = "update products set category_id = @v::bigint, updated_at = now() where id = any(@ids) and not is_deleted"; break;
                case "STATUS":
                    if (u.Text is not ("ACTIVE" or "INACTIVE" or "DISCONTINUED")) throw new ValidationException("Text", "Choose active, inactive or discontinued.");
                    sql = "update products set status = @t, updated_at = now() where id = any(@ids) and not is_deleted"; break;
                case "HSN":
                    if (u.Text is not { } h || !(h.All(char.IsDigit) && h.Length is 4 or 6 or 8)) throw new ValidationException("Text", "HSN must be 4, 6 or 8 digits.");
                    sql = "update products set hsn_code = @t, updated_at = now() where id = any(@ids) and not is_deleted"; break;
                default:
                    throw new ValidationException("Action", "Unknown bulk action.");
            }
            var n = await conn.ExecuteAsync(sql, new { v, t = u.Text, ids }, tx);
            await audit.LogAsync(conn, tx, "BULK_UPDATE", "Products", $"bulk {u.Action.ToLowerInvariant().Replace('_', ' ')} → {(u.Text ?? v.ToString(CultureInfo.InvariantCulture))} on {n} product(s)",
                null, null, null, null, new { u.Action, u.Value, u.Text, ProductIds = ids });
            return n;
        });
    }

    // ------------------------------------------------------------------ parsing
    private static List<List<string>> ReadExcel(byte[] file)
    {
        using var wb = new XLWorkbook(new MemoryStream(file));
        var ws = wb.Worksheets.First();
        var range = ws.RangeUsed();
        if (range is null) return new();
        return range.Rows().Select(r => r.Cells().Select(c => c.GetFormattedString()).ToList()).ToList();
    }

    /// <summary>RFC-4180 CSV (quoted fields, doubled quotes, commas and newlines inside quotes). Accepts UTF-8 with or without BOM.</summary>
    private static List<List<string>> ReadCsv(byte[] file)
    {
        var text = Encoding.UTF8.GetString(file).TrimStart('﻿');
        var rows = new List<List<string>>();
        var row = new List<string>();
        var sb = new StringBuilder();
        var quoted = false;
        for (var i = 0; i < text.Length; i++)
        {
            var ch = text[i];
            if (quoted)
            {
                if (ch == '"' && i + 1 < text.Length && text[i + 1] == '"') { sb.Append('"'); i++; }
                else if (ch == '"') quoted = false;
                else sb.Append(ch);
            }
            else if (ch == '"') quoted = true;
            else if (ch == ',') { row.Add(sb.ToString()); sb.Clear(); }
            else if (ch is '\n' or '\r')
            {
                if (ch == '\r' && i + 1 < text.Length && text[i + 1] == '\n') i++;
                row.Add(sb.ToString()); sb.Clear(); rows.Add(row); row = new List<string>();
            }
            else sb.Append(ch);
        }
        if (sb.Length > 0 || row.Count > 0) { row.Add(sb.ToString()); rows.Add(row); }
        return rows;
    }
}
