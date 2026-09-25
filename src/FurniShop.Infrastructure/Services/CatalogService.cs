using Dapper;
using FurniShop.Core;
using FurniShop.Core.Domain;
using FurniShop.Core.Security;
using FurniShop.Core.Validation;
using FurniShop.Infrastructure.Database;
using FurniShop.Infrastructure.Security;
using Npgsql;

namespace FurniShop.Infrastructure.Services;

/// <summary>Categories, brands, products and variants.</summary>
public sealed class CatalogService(Db db, UserSession session, AuditService audit, InventoryService inventory)
{
    // ------------------------------------------------------------------ categories
    public Task<IReadOnlyList<Category>> CategoriesAsync(bool activeOnly = false) =>
        db.QueryAsync<Category>($"""
            select c.*, (select count(*) from products p where p.category_id = c.id and not p.is_deleted) as product_count
            from categories c where not c.is_deleted {(activeOnly ? "and c.is_active" : "")} order by c.name
            """);

    public async Task<long> SaveCategoryAsync(Category c)
    {
        session.Demand(Perm.ProductManage);
        new ValidationBuilder().Require(c.Name, nameof(c.Name), "Category name")
            .Check(c.DefaultGstRate is null or (>= 0 and <= 100), nameof(c.DefaultGstRate), "GST rate must be 0–100.")
            .Check(c.ParentId is null || c.ParentId != c.Id, nameof(c.ParentId), "A category cannot be its own parent.")
            .ThrowIfInvalid();
        c.Name = c.Name.Trim();
        return await db.InTransactionAsync(async (conn, tx) =>
        {
            await EnsureUniqueAsync(conn, tx, "select count(*) from categories where lower(name) = lower(@Name) and id <> @Id and not is_deleted", c, "Name", "A category with this name already exists.");
            if (c.Id == 0)
                c.Id = await conn.ExecuteScalarAsync<long>("""
                    insert into categories (name, parent_id, description, default_hsn, default_gst_rate, is_active)
                    values (@Name, @ParentId, @Description, @DefaultHsn, @DefaultGstRate, @IsActive) returning id
                    """, c, tx);
            else
                await conn.ExecuteAsync("""
                    update categories set name=@Name, parent_id=@ParentId, description=@Description, default_hsn=@DefaultHsn,
                        default_gst_rate=@DefaultGstRate, is_active=@IsActive where id=@Id
                    """, c, tx);
            await audit.LogAsync(conn, tx, "SAVE", "Products", $"saved category {c.Name}", "category", c.Id, c.Name, null, c);
            return c.Id;
        });
    }

    public async Task DeleteCategoryAsync(long id)
    {
        session.Demand(Perm.ProductDelete);
        await db.InTransactionAsync(async (conn, tx) =>
        {
            var used = await conn.ExecuteScalarAsync<int>("select count(*) from products where category_id = @id and not is_deleted", new { id }, tx);
            if (used > 0) throw new BusinessRuleException($"This category has {used} product(s). Move them to another category first.");
            var name = await conn.ExecuteScalarAsync<string>("update categories set is_deleted = true where id = @id returning name", new { id }, tx);
            await audit.LogAsync(conn, tx, "DELETE", "Products", $"deleted category {name}", "category", id, name);
        });
    }

    // ------------------------------------------------------------------ brands
    public Task<IReadOnlyList<Brand>> BrandsAsync() => db.QueryAsync<Brand>("select * from brands where not is_deleted order by name");

    public async Task<long> SaveBrandAsync(Brand b)
    {
        session.Demand(Perm.ProductManage);
        new ValidationBuilder().Require(b.Name, nameof(b.Name), "Brand name").ThrowIfInvalid();
        b.Name = b.Name.Trim();
        return await db.InTransactionAsync(async (conn, tx) =>
        {
            await EnsureUniqueAsync(conn, tx, "select count(*) from brands where lower(name) = lower(@Name) and id <> @Id and not is_deleted", b, "Name", "This brand already exists.");
            if (b.Id == 0)
                b.Id = await conn.ExecuteScalarAsync<long>("insert into brands (name, is_active) values (@Name, @IsActive) returning id", b, tx);
            else
                await conn.ExecuteAsync("update brands set name=@Name, is_active=@IsActive where id=@Id", b, tx);
            await audit.LogAsync(conn, tx, "SAVE", "Products", $"saved brand {b.Name}", "brand", b.Id, b.Name);
            return b.Id;
        });
    }

    public async Task DeleteBrandAsync(long id)
    {
        session.Demand(Perm.ProductDelete);
        await db.InTransactionAsync(async (conn, tx) =>
        {
            await conn.ExecuteAsync("update products set brand_id = null where brand_id = @id", new { id }, tx);
            var name = await conn.ExecuteScalarAsync<string>("update brands set is_deleted = true where id = @id returning name", new { id }, tx);
            await audit.LogAsync(conn, tx, "DELETE", "Products", $"deleted brand {name}", "brand", id, name);
        });
    }

    // ------------------------------------------------------------------ products
    public async Task<PagedResult<Product>> ListProductsAsync(ListQuery q, bool includeInactive = true)
    {
        session.Demand(Perm.ProductView);
        var where = $"""
            where not p.is_deleted {(includeInactive ? "" : "and p.status = 'ACTIVE'")}
              and (@Status::text is null or p.status = @Status)
              and (@CategoryId::bigint is null or p.category_id = @CategoryId)
              and (@Search::text is null or p.name ilike '%' || @Search || '%' or p.code ilike '%' || @Search || '%'
                   or exists (select 1 from product_variants v where v.product_id = p.id and not v.is_deleted
                              and (v.sku ilike '%' || @Search || '%' or v.barcode = @Search)))
            """;
        var order = q.SortBy switch
        {
            "code" => "p.code", "price" => "p.selling_price", "stock" => "on_hand", "category" => "c.name", "updated" => "p.updated_at", _ => "p.name",
        };
        var dir = q.SortBy is null ? "asc" : q.SortDescending ? "desc" : "asc";
        var args = new { q.Status, q.CategoryId, Search = Blank(q.Search), q.PageSize, q.Offset };
        await using var conn = await db.OpenAsync();
        var total = await conn.ExecuteScalarAsync<int>($"select count(*) from products p {where}", args);
        var rows = (await conn.QueryAsync<Product>($"""
            select p.*, c.name as category_name, b.name as brand_name,
                   (select count(*) from product_variants v where v.product_id = p.id and not v.is_deleted) as variant_count,
                   coalesce(s.on_hand,0) as on_hand, coalesce(s.reserved,0) as reserved, coalesce(s.on_hand,0) - coalesce(s.reserved,0) as available,
                   (select v.barcode from product_variants v where v.product_id = p.id and v.is_default and not v.is_deleted limit 1) as barcode
            from products p
            join categories c on c.id = p.category_id
            left join brands b on b.id = p.brand_id
            left join (select v.product_id, sum(i.on_hand) as on_hand, sum(i.reserved) as reserved
                       from inventory i join product_variants v on v.id = i.variant_id where not v.is_deleted group by v.product_id) s on s.product_id = p.id
            {where} order by {order} {dir}, p.id limit @PageSize offset @Offset
            """, args)).AsList();
        if (!session.CanSeeCost) rows.ForEach(r => r.CostPrice = null);
        return new PagedResult<Product> { Items = rows, TotalCount = total, Page = q.Page, PageSize = q.PageSize };
    }

    public async Task<Product> GetProductAsync(long id)
    {
        session.Demand(Perm.ProductView);
        await using var conn = await db.OpenAsync();
        var p = await conn.QuerySingleOrDefaultAsync<Product>("""
            select p.*, c.name as category_name, b.name as brand_name from products p
            join categories c on c.id = p.category_id left join brands b on b.id = p.brand_id
            where p.id = @id and not p.is_deleted
            """, new { id }) ?? throw new NotFoundException("Product", id);
        p.Variants = (await conn.QueryAsync<ProductVariant>("""
            select v.*, coalesce(i.on_hand,0) as on_hand, coalesce(i.reserved,0) as reserved, coalesce(i.damaged,0) as damaged
            from product_variants v left join inventory i on i.variant_id = v.id
            where v.product_id = @id and not v.is_deleted order by v.is_default desc, v.id
            """, new { id })).AsList();
        p.OnHand = p.Variants.Sum(v => v.OnHand);
        p.Reserved = p.Variants.Sum(v => v.Reserved);
        p.Available = p.OnHand - p.Reserved;
        if (!session.CanSeeCost)
        {
            p.CostPrice = null;
            p.Variants.ForEach(v => v.CostPrice = null);
        }
        return p;
    }

    /// <summary>
    /// Creates or updates a product with its variants. A product always keeps at least one variant;
    /// when the list is empty a default "Standard" variant carrying the product code is created.
    /// Opening stock for new variants is recorded as an OPENING stock movement.
    /// </summary>
    public async Task<long> SaveProductAsync(Product p)
    {
        session.Demand(Perm.ProductManage);
        ValidateProduct(p);
        var canCost = session.CanSeeCost;

        return await db.InTransactionAsync(async (conn, tx) =>
        {
            Product? old = null;
            if (p.Id != 0)
            {
                old = await conn.QuerySingleOrDefaultAsync<Product>("select * from products where id = @Id and not is_deleted for update", p, tx)
                      ?? throw new NotFoundException("Product", p.Id);
                // Users who cannot see cost cannot change it either.
                if (!canCost || p.CostPrice is null) p.CostPrice = old.CostPrice;
            }
            else if (!canCost || p.CostPrice is null) p.CostPrice = 0;

            await EnsureUniqueAsync(conn, tx, "select count(*) from products where lower(code) = lower(@Code) and id <> @Id and not is_deleted", p, "Code", "Another product already uses this code.");

            if (p.Id == 0)
            {
                p.Id = await conn.ExecuteScalarAsync<long>("""
                    insert into products (code, name, category_id, brand_id, material, color, size, dimensions, weight_kg, finish, fabric,
                        warranty_months, hsn_code, gst_rate, price_includes_gst, cost_price, selling_price, discount_percent, min_stock,
                        description, status, is_stock_item, image_attachment_id, created_by)
                    values (@Code, @Name, @CategoryId, @BrandId, @Material, @Color, @Size, @Dimensions, @WeightKg, @Finish, @Fabric,
                        @WarrantyMonths, @HsnCode, @GstRate, @PriceIncludesGst, @CostPrice, @SellingPrice, @DiscountPercent, @MinStock,
                        @Description, @Status, @IsStockItem, @ImageAttachmentId, @uid) returning id
                    """, new DynamicParameters(p).With("uid", session.UserId), tx);
            }
            else
            {
                await conn.ExecuteAsync("""
                    update products set code=@Code, name=@Name, category_id=@CategoryId, brand_id=@BrandId, material=@Material, color=@Color,
                        size=@Size, dimensions=@Dimensions, weight_kg=@WeightKg, finish=@Finish, fabric=@Fabric, warranty_months=@WarrantyMonths,
                        hsn_code=@HsnCode, gst_rate=@GstRate, price_includes_gst=@PriceIncludesGst, cost_price=@CostPrice,
                        selling_price=@SellingPrice, discount_percent=@DiscountPercent, min_stock=@MinStock, description=@Description,
                        status=@Status, is_stock_item=@IsStockItem, image_attachment_id=@ImageAttachmentId, updated_at=now()
                    where id=@Id
                    """, p, tx);
            }

            // ---- variants
            if (p.Variants.Count == 0)
            {
                var existingDefault = await conn.QuerySingleOrDefaultAsync<ProductVariant>(
                    "select * from product_variants where product_id = @Id and not is_deleted order by is_default desc, id limit 1", p, tx);
                p.Variants.Add(existingDefault ?? new ProductVariant { VariantName = "Standard", Sku = p.Code, IsDefault = true });
                if (existingDefault is not null && string.IsNullOrWhiteSpace(existingDefault.Sku)) existingDefault.Sku = p.Code;
            }
            if (!p.Variants.Any(v => v.IsDefault)) p.Variants[0].IsDefault = true;

            var dupSku = p.Variants.GroupBy(v => v.Sku.Trim().ToLowerInvariant()).FirstOrDefault(g => g.Count() > 1);
            if (dupSku is not null) throw new ValidationException("Variants", $"SKU '{dupSku.Key}' is used by more than one variant.");
            var dupBarcode = p.Variants.Where(v => !string.IsNullOrWhiteSpace(v.Barcode)).GroupBy(v => v.Barcode!.Trim()).FirstOrDefault(g => g.Count() > 1);
            if (dupBarcode is not null) throw new ValidationException("Variants", $"Barcode '{dupBarcode.Key}' is used by more than one variant.");

            var keepIds = new List<long>();
            foreach (var v in p.Variants)
            {
                v.ProductId = p.Id;
                v.Sku = v.Sku.Trim();
                v.Barcode = Validators.Clean(v.Barcode);
                v.VariantName = string.IsNullOrWhiteSpace(v.VariantName) ? "Standard" : v.VariantName.Trim();
                await EnsureUniqueAsync(conn, tx, "select count(*) from product_variants where lower(sku) = lower(@Sku) and id <> @Id and not is_deleted", v, "Sku", $"SKU {v.Sku} is already used by another product.");
                if (v.Barcode is not null)
                    await EnsureUniqueAsync(conn, tx, "select count(*) from product_variants where barcode = @Barcode and id <> @Id and not is_deleted", v, "Barcode", $"Barcode {v.Barcode} is already used by another product.");

                if (v.Id == 0)
                {
                    if (!canCost) v.CostPrice = null;
                    v.Id = await conn.ExecuteScalarAsync<long>("""
                        insert into product_variants (product_id, variant_name, sku, barcode, size, color, material, fabric, finish, configuration,
                            design, dimensions, cost_price, selling_price, min_stock, image_attachment_id, is_default, is_active)
                        values (@ProductId, @VariantName, @Sku, @Barcode, @Size, @Color, @Material, @Fabric, @Finish, @Configuration,
                            @Design, @Dimensions, @CostPrice, @SellingPrice, @MinStock, @ImageAttachmentId, @IsDefault, @IsActive) returning id
                        """, v, tx);
                    await conn.ExecuteAsync("insert into inventory (variant_id) values (@Id) on conflict do nothing", v, tx);
                    if (v.OpeningStock > 0 && p.IsStockItem)
                    {
                        session.Demand(Perm.InventoryAdjust);
                        await inventory.ApplyAsync(conn, tx, v.Id, MovementType.Opening, v.OpeningStock, 0, 0, "PRODUCT", p.Id, p.Code,
                            "Opening stock", v.CostPrice ?? p.CostPrice);
                    }
                }
                else
                {
                    var oldCost = await conn.ExecuteScalarAsync<decimal?>("select cost_price from product_variants where id = @Id and product_id = @ProductId", v, tx);
                    if (!canCost) v.CostPrice = oldCost;
                    var n = await conn.ExecuteAsync("""
                        update product_variants set variant_name=@VariantName, sku=@Sku, barcode=@Barcode, size=@Size, color=@Color,
                            material=@Material, fabric=@Fabric, finish=@Finish, configuration=@Configuration, design=@Design,
                            dimensions=@Dimensions, cost_price=@CostPrice, selling_price=@SellingPrice, min_stock=@MinStock,
                            image_attachment_id=@ImageAttachmentId, is_default=@IsDefault, is_active=@IsActive, updated_at=now()
                        where id=@Id and product_id=@ProductId
                        """, v, tx);
                    if (n == 0) throw new NotFoundException("Variant", v.Id);
                }
                keepIds.Add(v.Id);
            }

            // Variants removed in the editor are soft-deleted, but only when they hold no stock.
            var removed = (await conn.QueryAsync<(long Id, string Sku, decimal OnHand, decimal Reserved)>("""
                select v.id, v.sku, coalesce(i.on_hand,0), coalesce(i.reserved,0) from product_variants v left join inventory i on i.variant_id = v.id
                where v.product_id = @pid and not v.is_deleted and not (v.id = any(@keep))
                """, new { pid = p.Id, keep = keepIds.ToArray() }, tx)).AsList();
            foreach (var r in removed)
            {
                if (r.OnHand != 0 || r.Reserved != 0)
                    throw new BusinessRuleException($"Variant {r.Sku} still has stock ({r.OnHand:0.##}). Adjust stock to zero before removing it.");
                await conn.ExecuteAsync("update product_variants set is_deleted = true, updated_at = now() where id = @Id", new { r.Id }, tx);
            }

            await audit.LogAsync(conn, tx, old is null ? "CREATE" : "UPDATE", "Products",
                $"{(old is null ? "created" : "updated")} product {p.Name} ({p.Code})", "product", p.Id, p.Code,
                old is null ? null : Scrub(old, canCost), Scrub(p, canCost));
            return p.Id;
        });
    }

    private static object Scrub(Product p, bool canCost) => new
    {
        p.Code, p.Name, p.CategoryId, p.BrandId, p.HsnCode, p.GstRate, p.PriceIncludesGst, p.SellingPrice,
        CostPrice = canCost ? p.CostPrice : null, p.DiscountPercent, p.MinStock, p.Status, p.IsStockItem,
        Variants = p.Variants.Select(v => new { v.Id, v.VariantName, v.Sku, v.Barcode, v.SellingPrice }).ToList(),
    };

    private static void ValidateProduct(Product p)
    {
        new ValidationBuilder()
            .Require(p.Name, nameof(p.Name), "Product name")
            .Check(Validators.IsValidCode(p.Code), nameof(p.Code), "Product code / SKU is required (letters, digits, - _ / .).")
            .Check(p.CategoryId > 0, nameof(p.CategoryId), "Select a category.")
            .Check(p.SellingPrice >= 0, nameof(p.SellingPrice), "Selling price cannot be negative.")
            .Check(p.CostPrice is null or >= 0, nameof(p.CostPrice), "Cost price cannot be negative.")
            .Check(p.GstRate is >= 0 and <= 100, nameof(p.GstRate), "GST rate must be 0–100.")
            .Check(p.DiscountPercent is >= 0 and <= 100, nameof(p.DiscountPercent), "Discount must be 0–100%.")
            .Check(p.MinStock >= 0, nameof(p.MinStock), "Minimum stock cannot be negative.")
            .Check(p.WarrantyMonths >= 0, nameof(p.WarrantyMonths), "Warranty cannot be negative.")
            .Check(p.Status is "ACTIVE" or "INACTIVE" or "DISCONTINUED", nameof(p.Status), "Invalid status.")
            .Optional(p.HsnCode, h => h.All(char.IsDigit) && h.Length is 4 or 6 or 8, nameof(p.HsnCode), "HSN must be 4, 6 or 8 digits.")
            .Check(p.Variants.All(v => Validators.IsValidCode(v.Sku)), "Variants", "Every variant needs a valid SKU.")
            .Check(p.Variants.All(v => v.SellingPrice is null or >= 0 && v.CostPrice is null or >= 0), "Variants", "Variant prices cannot be negative.")
            .Check(p.Variants.All(v => v.OpeningStock >= 0), "Variants", "Opening stock cannot be negative.")
            .ThrowIfInvalid();
        p.Code = p.Code.Trim();
        p.Name = p.Name.Trim();
        p.HsnCode = Validators.Clean(p.HsnCode);
    }

    public async Task DeleteProductAsync(long id)
    {
        session.Demand(Perm.ProductDelete);
        await db.InTransactionAsync(async (conn, tx) =>
        {
            var stock = await conn.ExecuteScalarAsync<decimal>("""
                select coalesce(sum(abs(i.on_hand) + i.reserved),0) from inventory i join product_variants v on v.id = i.variant_id where v.product_id = @id and not v.is_deleted
                """, new { id }, tx);
            if (stock > 0) throw new BusinessRuleException("This product still has stock or reservations. Adjust stock to zero or mark it Discontinued instead.");
            var p = await conn.QuerySingleOrDefaultAsync<Product>("update products set is_deleted = true, deleted_at = now(), status = 'DISCONTINUED' where id = @id and not is_deleted returning *", new { id }, tx)
                    ?? throw new NotFoundException("Product", id);
            await conn.ExecuteAsync("update product_variants set is_deleted = true where product_id = @id", new { id }, tx);
            await audit.LogAsync(conn, tx, "DELETE", "Products", $"deleted product {p.Name} ({p.Code})", "product", id, p.Code, Scrub(p, false), null);
        });
    }

    // ------------------------------------------------------------------ sellable items (POS / pickers)
    private const string SellableSelect = """
        select v.id as variant_id, p.id as product_id, p.name as product_name, v.variant_name, v.sku, v.barcode,
               c.name as category_name, p.category_id, p.hsn_code, p.gst_rate, p.price_includes_gst,
               coalesce(v.selling_price, p.selling_price) as selling_price, coalesce(v.cost_price, p.cost_price) as cost_price,
               p.discount_percent, coalesce(i.on_hand,0) as on_hand, coalesce(i.reserved,0) as reserved,
               coalesce(i.on_hand,0) - coalesce(i.reserved,0) as available, p.is_stock_item,
               coalesce(v.material, p.material) as material, coalesce(v.color, p.color) as color,
               coalesce(v.dimensions, p.dimensions) as dimensions, coalesce(v.image_attachment_id, p.image_attachment_id) as image_attachment_id
        from product_variants v
        join products p on p.id = v.product_id
        join categories c on c.id = p.category_id
        left join inventory i on i.variant_id = v.id
        where not v.is_deleted and v.is_active and not p.is_deleted and p.status = 'ACTIVE'
        """;

    public async Task<IReadOnlyList<SellableItem>> SearchSellableAsync(string? search, long? categoryId = null, int limit = 60)
    {
        session.DemandAny(Perm.ProductView, Perm.InvoiceCreate, Perm.QuotationManage, Perm.PurchaseManage);
        var rows = (await db.QueryAsync<SellableItem>($"""
            {SellableSelect}
              and (@categoryId::bigint is null or p.category_id = @categoryId)
              and (@search::text is null or p.name ilike '%' || @search || '%' or v.sku ilike '%' || @search || '%'
                   or v.barcode = @search or v.variant_name ilike '%' || @search || '%' or p.code ilike '%' || @search || '%')
            order by (v.barcode = @search or lower(v.sku) = lower(@search)) desc nulls last, p.name, v.is_default desc, v.variant_name
            limit @limit
            """, new { search = Blank(search), categoryId, limit })).ToList();
        if (!session.CanSeeCost) rows.ForEach(r => r.CostPrice = null);
        return rows;
    }

    /// <summary>Exact lookup by barcode or SKU — used by barcode scanners in POS and purchases.</summary>
    public async Task<SellableItem?> FindByCodeAsync(string code)
    {
        session.DemandAny(Perm.ProductView, Perm.InvoiceCreate, Perm.QuotationManage, Perm.PurchaseManage);
        if (string.IsNullOrWhiteSpace(code)) return null;
        var item = await db.QuerySingleOrDefaultAsync<SellableItem>($"""
            {SellableSelect} and (v.barcode = @code or lower(v.sku) = lower(@code)) order by (v.barcode = @code) desc limit 1
            """, new { code = code.Trim() });
        if (item is not null && !session.CanSeeCost) item.CostPrice = null;
        return item;
    }

    public async Task<SellableItem?> GetSellableAsync(long variantId)
    {
        var item = await db.QuerySingleOrDefaultAsync<SellableItem>($"{SellableSelect.Replace("and v.is_active and not p.is_deleted and p.status = 'ACTIVE'", "")} and v.id = @variantId", new { variantId });
        if (item is not null && !session.CanSeeCost) item.CostPrice = null;
        return item;
    }

    /// <summary>All variants (for the Variants screen and barcode labels).</summary>
    public async Task<PagedResult<SellableItem>> ListVariantsAsync(ListQuery q)
    {
        session.Demand(Perm.ProductView);
        var where = """
            where not v.is_deleted and not p.is_deleted
              and (@CategoryId::bigint is null or p.category_id = @CategoryId)
              and (@Search::text is null or p.name ilike '%' || @Search || '%' or v.sku ilike '%' || @Search || '%' or v.barcode = @Search or v.variant_name ilike '%' || @Search || '%')
            """;
        var baseSql = SellableSelect[..SellableSelect.IndexOf("where not v.is_deleted", StringComparison.Ordinal)];
        var args = new { q.CategoryId, Search = Blank(q.Search), q.PageSize, q.Offset };
        await using var conn = await db.OpenAsync();
        var total = await conn.ExecuteScalarAsync<int>($"select count(*) from product_variants v join products p on p.id = v.product_id {where}", args);
        var rows = (await conn.QueryAsync<SellableItem>($"{baseSql} {where} order by p.name, v.variant_name limit @PageSize offset @Offset", args)).AsList();
        if (!session.CanSeeCost) rows.ForEach(r => r.CostPrice = null);
        return new PagedResult<SellableItem> { Items = rows, TotalCount = total, Page = q.Page, PageSize = q.PageSize };
    }

    /// <summary>Assigns EAN-13 style internal barcodes (prefix 200 = in-store use) to variants without one.</summary>
    public async Task<int> AssignMissingBarcodesAsync()
    {
        session.Demand(Perm.ProductManage);
        return await db.InTransactionAsync(async (conn, tx) =>
        {
            var ids = (await conn.QueryAsync<long>("select id from product_variants where barcode is null and not is_deleted order by id for update", transaction: tx)).AsList();
            foreach (var id in ids)
            {
                var code = Ean13.Internal(id);
                await conn.ExecuteAsync("update product_variants set barcode = @code, updated_at = now() where id = @id", new { code, id }, tx);
            }
            if (ids.Count > 0) await audit.LogAsync(conn, tx, "UPDATE", "Products", $"generated barcodes for {ids.Count} variant(s)");
            return ids.Count;
        });
    }

    private static async Task EnsureUniqueAsync(NpgsqlConnection conn, NpgsqlTransaction tx, string sql, object args, string field, string message)
    {
        if (await conn.ExecuteScalarAsync<int>(sql, args, tx) > 0) throw new ValidationException(field, message);
    }

    private static string? Blank(string? s) => string.IsNullOrWhiteSpace(s) ? null : s.Trim();
}

/// <summary>EAN-13 helpers for in-store barcodes.</summary>
public static class Ean13
{
    public static string Internal(long id) => WithCheckDigit("200" + id.ToString().PadLeft(9, '0'));

    public static string WithCheckDigit(string twelve)
    {
        if (twelve.Length != 12 || !twelve.All(char.IsDigit)) throw new ArgumentException("EAN-13 needs 12 digits before the check digit.");
        var sum = 0;
        for (var i = 0; i < 12; i++) sum += (twelve[i] - '0') * (i % 2 == 0 ? 1 : 3);
        return twelve + (char)('0' + (10 - sum % 10) % 10);
    }

    public static bool IsValid(string code) => code.Length == 13 && code.All(char.IsDigit) && WithCheckDigit(code[..12]) == code;
}

internal static class DapperExtensions
{
    public static DynamicParameters With(this DynamicParameters p, string name, object? value)
    {
        p.Add(name, value);
        return p;
    }
}
