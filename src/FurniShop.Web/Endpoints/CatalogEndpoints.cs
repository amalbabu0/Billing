using FurniShop.Core;
using FurniShop.Core.Domain;
using FurniShop.Core.Security;
using FurniShop.Infrastructure;
using FurniShop.Infrastructure.Documents;
using FurniShop.Infrastructure.Services;
using Microsoft.AspNetCore.Mvc;

using FurniShop.Web.Hosting;

namespace FurniShop.Web.Endpoints;

public static partial class Api
{
    public sealed record LabelRequest(List<LabelSelection> Items, string Format, bool Qr);
    public sealed record LabelSelection(long VariantId, int Copies);
    public sealed record AdjustRequest(long VariantId, string AdjustmentType, decimal Quantity, string Reason, decimal? UnitCost);

    private static void MapCatalog(RouteGroupBuilder api)
    {
        // ---------------- products
        api.MapGet("/products", async (QueryOf<ProductFilter> pf, AppServices app) =>
        {
            var f = pf.Value;
            f.Page = Math.Max(1, f.Page);
            f.PageSize = Math.Clamp(f.PageSize, 1, 500);
            return await app.Workspace.ProductsAsync(f);
        });
        api.MapGet("/products/facets", async (AppServices app) => await app.Workspace.ProductFacetsAsync());
        api.MapGet("/products/{id:long}", async (long id, AppServices app) => await app.Catalog.GetProductAsync(id));
        api.MapPost("/products", async (Product p, AppServices app) =>
        {
            p.Id = 0;
            var id = await app.Catalog.SaveProductAsync(p);
            return Results.Ok(await app.Catalog.GetProductAsync(id));
        });
        api.MapPut("/products/{id:long}", async (long id, Product p, AppServices app) =>
        {
            p.Id = id;
            await app.Catalog.SaveProductAsync(p);
            return Results.Ok(await app.Catalog.GetProductAsync(id));
        });
        api.MapDelete("/products/{id:long}", async (long id, AppServices app) => { await app.Catalog.DeleteProductAsync(id); return Results.NoContent(); });
        api.MapPost("/products/{id:long}/duplicate", async (long id, AppServices app) => new { id = await app.Workspace.DuplicateProductAsync(id) });

        // ---------------- categories & brands
        api.MapGet("/categories", async (AppServices app) => (await app.Workspace.ProductFacetsAsync()).Categories);
        api.MapPost("/categories", async (Category c, AppServices app) => { c.Id = 0; return new { id = await app.Catalog.SaveCategoryAsync(c) }; });
        api.MapPut("/categories/{id:long}", async (long id, Category c, AppServices app) => { c.Id = id; return new { id = await app.Catalog.SaveCategoryAsync(c) }; });
        api.MapDelete("/categories/{id:long}", async (long id, AppServices app) => { await app.Catalog.DeleteCategoryAsync(id); return Results.NoContent(); });

        api.MapGet("/brands", async (AppServices app) =>
        {
            app.Session.DemandAny(Perm.ProductView, Perm.InvoiceCreate);
            return await app.Db.QueryAsync<BrandRow>("""
                select b.*, (select count(*)::int from products p where p.brand_id = b.id and not p.is_deleted) as product_count
                from brands b where not b.is_deleted order by b.name
                """);
        });
        api.MapPost("/brands", async (Brand b, AppServices app) => { b.Id = 0; return new { id = await app.Catalog.SaveBrandAsync(b) }; });
        api.MapPut("/brands/{id:long}", async (long id, Brand b, AppServices app) => { b.Id = id; return new { id = await app.Catalog.SaveBrandAsync(b) }; });
        api.MapDelete("/brands/{id:long}", async (long id, AppServices app) => { await app.Catalog.DeleteBrandAsync(id); return Results.NoContent(); });

        // ---------------- variants & sellable items (POS / pickers)
        api.MapGet("/variants", async (QueryOf<ListQuery> lq, AppServices app) => await app.Catalog.ListVariantsAsync(lq.Value.Clamp()));
        api.MapGet("/sellable", async (string? search, long? categoryId, int? limit, AppServices app) =>
            await app.Catalog.SearchSellableAsync(search, categoryId, Math.Clamp(limit ?? 40, 1, 100)));
        api.MapGet("/sellable/code/{code}", async (string code, AppServices app) =>
            await app.Catalog.FindByCodeAsync(code) is { } item ? Results.Ok(item) : Problem(404, $"No product with barcode or SKU “{code}”.", "not_found"));
        api.MapGet("/sellable/{variantId:long}", async (long variantId, AppServices app) =>
        {
            app.Session.DemandAny(Perm.ProductView, Perm.InvoiceCreate, Perm.QuotationManage, Perm.PurchaseManage);
            return await app.Catalog.GetSellableAsync(variantId) is { } item ? Results.Ok(item) : Problem(404, "Product not found.", "not_found");
        });

        api.MapGet("/pos/favorites", async (AppServices app) => await app.Workspace.FavoritesAsync());
        api.MapPost("/pos/favorites/{variantId:long}", async (long variantId, AppServices app) => new { favorite = await app.Workspace.ToggleFavoriteAsync(variantId) });
        api.MapGet("/pos/recent", async (AppServices app) => await app.Workspace.RecentAsync());
        api.MapPost("/sales/preview", async (SalesDocumentInput input, AppServices app) => await app.Workspace.PreviewAsync(input));

        // ---------------- barcodes & labels
        api.MapPost("/barcodes/assign", async (AppServices app) => new { assigned = await app.Catalog.AssignMissingBarcodesAsync() });
        api.MapPost("/barcodes/labels", async (LabelRequest r, AppServices app) =>
        {
            app.Session.Demand(Perm.ProductView);
            if (r.Items.Count == 0 || r.Items.Sum(i => i.Copies) is <= 0 or > 2000) throw new ValidationException("Items", "Choose between 1 and 2000 labels.");
            var items = await app.Documents.LabelItemsAsync(r.Items.Select(i => (i.VariantId, Math.Clamp(i.Copies, 1, 500))));
            var format = r.Format == "roll" ? LabelFormat.Roll50x25 : LabelFormat.A4Sheet3x8;
            return Pdf(DocumentService.LabelsPdf(items, format, r.Qr), "labels");
        }).RequireRateLimiting("heavy");
    }

    public sealed class BrandRow
    {
        public long Id { get; set; }
        public string Name { get; set; } = "";
        public bool IsActive { get; set; }
        public int ProductCount { get; set; }
    }

    private static void MapInventory(RouteGroupBuilder api)
    {
        api.MapGet("/inventory", async (QueryOf<ListQuery> lq, string? state, AppServices app) => await app.Inventory.ListAsync(lq.Value.Clamp(), state));
        api.MapGet("/inventory/summary", async (AppServices app) =>
        {
            app.Session.DemandAny(Perm.InventoryView, Perm.ProductView);
            var s = await app.Db.QuerySingleOrDefaultAsync<InventorySummary>("""
                select coalesce(sum(available) filter (where available > 0),0) as available_units,
                       coalesce(sum(reserved),0) as reserved_units, coalesce(sum(damaged),0) as damaged_units,
                       count(*) filter (where available > 0 and available <= min_stock)::int as low_stock,
                       count(*) filter (where available <= 0)::int as out_of_stock,
                       count(*)::int as items,
                       sum(on_hand * cost_price) as stock_value
                from v_inventory where is_stock_item and product_status = 'ACTIVE'
                """) ?? new InventorySummary();
            if (!app.Session.CanSeeCost) s.StockValue = null;
            return s;
        });
        api.MapGet("/inventory/{variantId:long}", async (long variantId, AppServices app) => await app.Workspace.StockDetailAsync(variantId));
        api.MapGet("/inventory/movements", async (QueryOf<ListQuery> lq, long? variantId, string? type, string? group, AppServices app) =>
        {
            // "group" narrows to a family of movements (e.g. stock in) for the Stock In / Adjustment screens.
            if (group is null) return await app.Inventory.MovementsAsync(lq.Value.Clamp(), variantId, type);
            return await GroupedMovementsAsync(app, lq.Value.Clamp(), group);
        });
        api.MapGet("/inventory/reserved", async (AppServices app) => await app.Inventory.ReservedAsync());
        api.MapPost("/inventory/adjust", async (AdjustRequest r, AppServices app) => new
        {
            number = await app.Inventory.AdjustAsync(new StockAdjustmentInput
            {
                VariantId = r.VariantId, AdjustmentType = r.AdjustmentType, Quantity = r.Quantity, Reason = r.Reason, UnitCost = r.UnitCost,
            }),
            levels = await app.Inventory.LevelsAsync(r.VariantId),
        });
    }

    public sealed class InventorySummary
    {
        public decimal AvailableUnits { get; set; }
        public decimal ReservedUnits { get; set; }
        public decimal DamagedUnits { get; set; }
        public int LowStock { get; set; }
        public int OutOfStock { get; set; }
        public int Items { get; set; }
        public decimal? StockValue { get; set; }
    }

    private static async Task<PagedResult<InventoryMovement>> GroupedMovementsAsync(AppServices app, ListQuery q, string group)
    {
        app.Session.Demand(Perm.InventoryView);
        var types = group switch
        {
            "in" => new[] { MovementType.Opening, MovementType.PurchaseIn, MovementType.AdjustmentIn, MovementType.ReturnIn, MovementType.SaleCancelIn },
            "adjustments" => new[] { MovementType.AdjustmentIn, MovementType.AdjustmentOut, MovementType.Damage, MovementType.DamageRepaired, MovementType.DamageWriteOff, MovementType.Display },
            "damaged" => new[] { MovementType.Damage, MovementType.ReturnDamaged, MovementType.DamageRepaired, MovementType.DamageWriteOff },
            _ => throw new ValidationException("Group", "Unknown movement group."),
        };
        const string from = "from inventory_movements m join product_variants v on v.id = m.variant_id join products p on p.id = v.product_id left join users u on u.id = m.created_by";
        const string where = """
            where m.movement_type = any(@types) and (@From::date is null or m.created_at >= @From::date) and (@To::date is null or m.created_at < @To::date + 1)
              and (@Search::text is null or v.sku ilike '%' || @Search || '%' or p.name ilike '%' || @Search || '%' or m.ref_number ilike '%' || @Search || '%')
            """;
        var args = new { types, q.From, q.To, Search = string.IsNullOrWhiteSpace(q.Search) ? null : q.Search.Trim(), q.PageSize, q.Offset };
        var total = await app.Db.ScalarAsync<int>($"select count(*) {from} {where}", args);
        var rows = (await app.Db.QueryAsync<InventoryMovement>($"""
            select m.*, v.sku, p.name || case when v.variant_name <> 'Standard' then ' — ' || v.variant_name else '' end as product_name, u.full_name as created_by_name
            {from} {where} order by m.created_at desc, m.id desc limit @PageSize offset @Offset
            """, args)).ToList();
        if (!app.Session.CanSeeCost) rows.ForEach(r => r.UnitCost = null);
        return new PagedResult<InventoryMovement> { Items = rows, TotalCount = total, Page = q.Page, PageSize = q.PageSize };
    }
}
