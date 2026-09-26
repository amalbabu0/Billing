using FurniShop.Core.Domain;
using FurniShop.Infrastructure.Services;

namespace FurniShop.Infrastructure.Database;

/// <summary>
/// Demo data for the operations modules (locations, raw materials, BOM, production…), created through the real services.
/// Idempotent: each part runs only when its tables are still empty, so it can also top up an existing demo database.
/// </summary>
public sealed class DemoOperationsSeeder(AppServices app)
{
    private async Task<long?> VariantAsync(string sku) => await app.Db.ScalarAsync<long?>("select id from product_variants where sku = @sku", new { sku });

    public async Task SeedAsync(IProgress<string>? progress = null)
    {
        var today = DateTime.Today;
        if (await app.Db.ScalarAsync<int>("select count(*) from warehouses") == 1)
        {
            progress?.Report("Locations and transfers…");
            var godown = await app.Locations.SaveAsync(new Warehouse { Code = "GDN", Name = "Peenya godown", Kind = "WAREHOUSE", Address = "Plot 42, Peenya Industrial Area, Bengaluru" });
            await app.Locations.SaveAsync(new Warehouse { Code = "WKS", Name = "Workshop", Kind = "FACTORY", Address = "Behind showroom, Bengaluru" });
            var main = (await app.Locations.ListAsync()).Single(w => w.IsDefault).Id;
            var lines = new List<TransferLineInput>();
            foreach (var (sku, q) in new[] { ("MAT-ORT-Q6", 3m), ("CHR-DIN", 6m), ("OFF-ERG", 2m) })
                if (await VariantAsync(sku) is { } v && (await app.Inventory.LevelsAsync(v)).Available >= q) lines.Add(new TransferLineInput { VariantId = v, Quantity = q });
            if (lines.Count > 0)
            {
                var t1 = await app.Locations.SaveTransferAsync(new TransferInput { FromWarehouseId = main, ToWarehouseId = godown, VehicleNo = "KA-01-AB-4521", Notes = "Overflow stock", Lines = lines });
                await app.Locations.DispatchAsync(t1);
                await app.Locations.ReceiveAsync(t1);
                var back = await app.Locations.SaveTransferAsync(new TransferInput { FromWarehouseId = godown, ToWarehouseId = main, Lines = { new TransferLineInput { VariantId = lines[0].VariantId, Quantity = 1 } } });
                await app.Locations.DispatchAsync(back);
            }
        }

        if (await app.Db.ScalarAsync<int>("select count(*) from raw_materials") == 0)
        {
            progress?.Report("Raw materials, BOMs and production…");
            var supplier = await app.Db.ScalarAsync<long?>("select id from suppliers order by id limit 1");
            var rm = new Dictionary<string, long>();
            foreach (var (code, name, cat, unit, cost, stock, min) in new[]
                     {
                         ("TEAK-CFT", "Teak wood (seasoned)", "Teak wood", "cu.ft", 4200m, 38m, 10m),
                         ("PLY-18", "BWP plywood 18 mm (8×4)", "Plywood", "sheet", 2450m, 42m, 12m),
                         ("PLY-12", "BWP plywood 12 mm (8×4)", "Plywood", "sheet", 1850m, 6m, 8m),
                         ("MDF-18", "MDF board 18 mm", "MDF", "sheet", 1350m, 20m, 6m),
                         ("LAM-1MM", "Laminate 1 mm — walnut", "Laminate", "sheet", 1100m, 30m, 10m),
                         ("HNG-SC", "Soft-close hinge", "Hinges", "piece", 145m, 160m, 40m),
                         ("CHN-TEL", "Telescopic channel 18\"", "Channels", "pair", 320m, 24m, 20m),
                         ("HDL-SS", "SS handle 6\"", "Handles", "piece", 95m, 80m, 30m),
                         ("FOAM-40", "HR foam 40 density", "Foam", "sq.ft", 92m, 260m, 80m),
                         ("FAB-VLV", "Velvet upholstery fabric", "Fabric", "metre", 420m, 45m, 20m),
                         ("PU-POL", "PU polish (matt)", "Paint & polish", "litre", 780m, 18m, 5m),
                         ("FEV-SH", "Fevicol SH adhesive", "Adhesive", "kg", 260m, 12m, 5m),
                     })
                rm[code] = await app.Production.SaveMaterialAsync(new RawMaterial { Code = code, Name = name, Category = cat, Unit = unit, CostPrice = cost, OpeningStock = stock, MinStock = min, ReorderQty = min * 2, SupplierId = supplier });
            await app.Production.StockAsync(new RawMaterialStockInput { RawMaterialId = rm["PLY-18"], Type = "RECEIVE", Quantity = 20, UnitCost = 2520, SupplierId = supplier, Reference = "CH-7781" });
            await app.Production.StockAsync(new RawMaterialStockInput { RawMaterialId = rm["LAM-1MM"], Type = "WASTAGE", Quantity = 1, Note = "Scratched while cutting" });

            if (await VariantAsync("WRD-002") is { } wardrobe)
                await app.Production.SaveBomAsync(new Bom
                {
                    VariantId = wardrobe, LabourCost = 3200, OtherCost = 500, Notes = "Carcass in 18 mm, back panel 12 mm, laminate outside only",
                    Lines =
                    {
                        new BomLine { RawMaterialId = rm["PLY-18"], Quantity = 3, WastagePercent = 8 }, new BomLine { RawMaterialId = rm["PLY-12"], Quantity = 1, WastagePercent = 5 },
                        new BomLine { RawMaterialId = rm["LAM-1MM"], Quantity = 2, WastagePercent = 10 }, new BomLine { RawMaterialId = rm["HNG-SC"], Quantity = 4 },
                        new BomLine { RawMaterialId = rm["HDL-SS"], Quantity = 3 }, new BomLine { RawMaterialId = rm["FEV-SH"], Quantity = 1.5m },
                    },
                });
            if (await VariantAsync("SOF-CHS-GRN") is { } sofa)
                await app.Production.SaveBomAsync(new Bom
                {
                    VariantId = sofa, LabourCost = 9000, OtherCost = 1200,
                    Lines = { new BomLine { RawMaterialId = rm["TEAK-CFT"], Quantity = 2.5m, WastagePercent = 12 }, new BomLine { RawMaterialId = rm["FOAM-40"], Quantity = 48, WastagePercent = 5 }, new BomLine { RawMaterialId = rm["FAB-VLV"], Quantity = 11, WastagePercent = 8 } },
                });

            if (await VariantAsync("WRD-002") is { } w2)
            {
                var p1 = await app.Production.SaveOrderAsync(new ProductionInput { VariantId = w2, Quantity = 2, DueDate = today.AddDays(9), AssignedTo = "Raju (carpenter)", Priority = "NORMAL" });
                var o1 = await app.Production.OrderAsync(p1);
                await app.Production.IssueAsync(p1, o1.Materials.Select(m => new IssueInput { RawMaterialId = m.RawMaterialId, Quantity = m.QuantityRequired }).ToList());
                await app.Production.MoveAsync(p1, ProductionStatus.MaterialReady, null);
                await app.Production.MoveAsync(p1, ProductionStatus.Assembly, "Carcass cut and edge-banded");
            }
            var active = await app.Db.QueryAsync<long>("select id from custom_orders where status in ('RECEIVED','DESIGN','PRODUCTION') order by id");
            foreach (var coId in active.Take(2))
            {
                var p = await app.Production.SaveOrderAsync(new ProductionInput
                {
                    CustomOrderId = coId, DueDate = today.AddDays(12), AssignedTo = "Imran (workshop)", Priority = "HIGH", LabourCost = 12000, OtherCost = 1500,
                    Materials = new() { new ProductionMaterialInput { RawMaterialId = rm["PLY-18"], QuantityRequired = 6 }, new ProductionMaterialInput { RawMaterialId = rm["HNG-SC"], QuantityRequired = 8 }, new ProductionMaterialInput { RawMaterialId = rm["PU-POL"], QuantityRequired = 2 } },
                });
                await app.Production.IssueAsync(p, new[] { new IssueInput { RawMaterialId = rm["PLY-18"], Quantity = 6 } });
                await app.Production.MoveAsync(p, ProductionStatus.Planning, "Cutting list prepared");
            }
            if (await VariantAsync("SOF-CHS-GRN") is { } s2)
                await app.Production.SaveOrderAsync(new ProductionInput { VariantId = s2, Quantity = 1, DueDate = today.AddDays(18), Priority = "LOW" });
        }
    }
}
