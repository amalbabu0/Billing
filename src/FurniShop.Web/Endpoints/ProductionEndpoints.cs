using FurniShop.Core;
using FurniShop.Core.Domain;
using FurniShop.Core.Security;
using FurniShop.Infrastructure;
using FurniShop.Infrastructure.Services;
using FurniShop.Web.Hosting;

namespace FurniShop.Web.Endpoints;

public static partial class Api
{
    public sealed record MoveRequest(string Status, string? Note);
    public sealed record IssueRequest(List<IssueInput> Lines, bool Return);

    private static void MapProduction(RouteGroupBuilder api)
    {
        // ---------------- locations & transfers
        api.MapGet("/warehouses", async (bool? all, AppServices app) => await app.Locations.ListAsync(all ?? false));
        api.MapPost("/warehouses", async (Warehouse w, AppServices app) => { w.Id = 0; return new { id = await app.Locations.SaveAsync(w) }; });
        api.MapPut("/warehouses/{id:long}", async (long id, Warehouse w, AppServices app) => { w.Id = id; return new { id = await app.Locations.SaveAsync(w) }; });
        api.MapGet("/warehouses/stock", async (long? warehouseId, long? variantId, string? search, AppServices app) => await app.Locations.StockAsync(warehouseId, variantId, search));
        api.MapGet("/transfers", async (QueryOf<ListQuery> lq, AppServices app) => await app.Locations.TransfersAsync(lq.Value.Clamp()));
        api.MapGet("/transfers/{id:long}", async (long id, AppServices app) =>
            new { transfer = await app.Locations.GetTransferAsync(id), history = await app.Locations.TransferHistoryAsync(id) });
        api.MapPost("/transfers", async (TransferInput t, AppServices app) => { t.Id = 0; return new { id = await app.Locations.SaveTransferAsync(t) }; });
        api.MapPut("/transfers/{id:long}", async (long id, TransferInput t, AppServices app) => { t.Id = id; return new { id = await app.Locations.SaveTransferAsync(t) }; });
        api.MapPost("/transfers/{id:long}/dispatch", async (long id, AppServices app) => { await app.Locations.DispatchAsync(id); return Results.NoContent(); });
        api.MapPost("/transfers/{id:long}/in-transit", async (long id, AppServices app) => { await app.Locations.MarkInTransitAsync(id); return Results.NoContent(); });
        api.MapPost("/transfers/{id:long}/receive", async (long id, AppServices app) => { await app.Locations.ReceiveAsync(id); return Results.NoContent(); });
        api.MapPost("/transfers/{id:long}/cancel", async (long id, ReasonRequest r, AppServices app) => { await app.Locations.CancelTransferAsync(id, r.Reason); return Results.NoContent(); });

        // ---------------- raw materials & BOM
        api.MapGet("/raw-materials", async (QueryOf<ListQuery> lq, string? category, bool? low, AppServices app) => await app.Production.MaterialsAsync(lq.Value.Clamp(), category, low ?? false));
        api.MapGet("/raw-materials/categories", async (AppServices app) => await app.Production.MaterialCategoriesAsync());
        api.MapGet("/raw-materials/movements", async (QueryOf<ListQuery> lq, long? materialId, AppServices app) => await app.Production.MaterialMovementsAsync(lq.Value.Clamp(), materialId));
        api.MapGet("/raw-materials/{id:long}", async (long id, AppServices app) => await app.Production.MaterialAsync(id));
        api.MapPost("/raw-materials", async (RawMaterial m, AppServices app) => { m.Id = 0; return new { id = await app.Production.SaveMaterialAsync(m) }; });
        api.MapPut("/raw-materials/{id:long}", async (long id, RawMaterial m, AppServices app) => { m.Id = id; return new { id = await app.Production.SaveMaterialAsync(m) }; });
        api.MapPost("/raw-materials/stock", async (RawMaterialStockInput i, AppServices app) => { await app.Production.StockAsync(i); return Results.NoContent(); });
        api.MapGet("/boms", async (string? search, AppServices app) => await app.Production.BomsAsync(search));
        api.MapGet("/boms/{variantId:long}", async (long variantId, AppServices app) => await app.Production.BomAsync(variantId));
        api.MapPut("/boms/{variantId:long}", async (long variantId, Bom b, AppServices app) => { b.VariantId = variantId; await app.Production.SaveBomAsync(b); return Results.NoContent(); });

        // ---------------- production orders
        api.MapGet("/production/board", async (AppServices app) => await app.Production.BoardAsync());
        api.MapGet("/production", async (QueryOf<ListQuery> lq, AppServices app) => await app.Production.OrdersAsync(lq.Value.Clamp()));
        api.MapGet("/production/{id:long}", async (long id, AppServices app) =>
            new { order = await app.Production.OrderAsync(id), history = await app.Production.HistoryAsync(id) });
        api.MapGet("/custom-orders/{id:long}/production", async (long id, AppServices app) => await app.Production.ForCustomOrderAsync(id));
        api.MapPost("/production", async (ProductionInput i, AppServices app) => { i.Id = 0; return new { id = await app.Production.SaveOrderAsync(i) }; });
        api.MapPut("/production/{id:long}", async (long id, ProductionInput i, AppServices app) => { i.Id = id; return new { id = await app.Production.SaveOrderAsync(i) }; });
        api.MapPost("/production/{id:long}/issue", async (long id, IssueRequest r, AppServices app) => { await app.Production.IssueAsync(id, r.Lines ?? new(), r.Return); return Results.NoContent(); });
        api.MapPost("/production/{id:long}/move", async (long id, MoveRequest r, AppServices app) => { await app.Production.MoveAsync(id, r.Status, r.Note); return Results.NoContent(); });
        api.MapPost("/production/{id:long}/complete", async (long id, NoteRequest r, AppServices app) => { await app.Production.CompleteAsync(id, r.Note); return Results.NoContent(); });
        api.MapPost("/production/{id:long}/cancel", async (long id, ReasonRequest r, AppServices app) => { await app.Production.CancelAsync(id, r.Reason); return Results.NoContent(); });
    }
}
