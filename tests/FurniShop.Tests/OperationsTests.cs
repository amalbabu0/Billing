using FurniShop.Core;
using FurniShop.Core.Domain;
using FurniShop.Infrastructure.Services;
using Xunit;

namespace FurniShop.Tests;

public class LocationAndProductionTests(DbFixture f) : IClassFixture<DbFixture>
{
    private async Task<decimal> AtAsync(long warehouseId, long variantId) =>
        await f.App.Db.ScalarAsync<decimal?>("select on_hand from warehouse_stock where warehouse_id = @warehouseId and variant_id = @variantId", new { warehouseId, variantId }) ?? 0;

    private async Task AssertLocationsSumAsync(long variantId)
    {
        var total = (await f.App.Inventory.LevelsAsync(variantId)).OnHand;
        var sum = await f.App.Db.ScalarAsync<decimal>("select coalesce(sum(on_hand), 0) from warehouse_stock where variant_id = @variantId", new { variantId });
        Assert.Equal(total, sum);
    }

    [DbFact]
    public async Task Transfers_move_stock_between_locations_without_double_counting()
    {
        var v = await f.ProductAsync("LOC-1", 20000, 12000, 10);
        var main = (await f.App.Locations.ListAsync()).Single(w => w.IsDefault).Id;
        var godown = await f.App.Locations.SaveAsync(new Warehouse { Code = "GDN", Name = "Peenya godown", Kind = "WAREHOUSE" });
        Assert.Equal(10m, await AtAsync(main, v));

        var t = await f.App.Locations.SaveTransferAsync(new TransferInput { FromWarehouseId = main, ToWarehouseId = godown, Lines = { new TransferLineInput { VariantId = v, Quantity = 6 } } });
        await f.App.Locations.DispatchAsync(t);
        // In transit: left the showroom, not yet in the godown, not sellable.
        Assert.Equal((4m, 0m), (await AtAsync(main, v), await AtAsync(godown, v)));
        Assert.Equal(4m, (await f.App.Inventory.LevelsAsync(v)).Available);
        var transit = await f.App.Locations.StockAsync(godown, v, null);
        Assert.Equal(6m, transit.Single().InTransit);
        await f.App.Locations.ReceiveAsync(t);
        Assert.Equal((4m, 6m), (await AtAsync(main, v), await AtAsync(godown, v)));
        Assert.Equal(10m, (await f.App.Inventory.LevelsAsync(v)).OnHand);

        // A transfer cannot take more than the source location holds.
        var t2 = await f.App.Locations.SaveTransferAsync(new TransferInput { FromWarehouseId = main, ToWarehouseId = godown, Lines = { new TransferLineInput { VariantId = v, Quantity = 5 } } });
        await Assert.ThrowsAsync<BusinessRuleException>(() => f.App.Locations.DispatchAsync(t2));

        // A counter sale takes from the showroom first, then from the godown.
        var c = await f.CustomerAsync("Loc Customer", "9876511111");
        await f.App.Invoices.CheckoutAsync(new SalesDocumentInput { CustomerId = c, Lines = { await f.LineAsync(v, 5) } }, new[] { DbFixture.Pay(PaymentMethodCode.Cash, 100000) });
        Assert.Equal((0m, 5m), (await AtAsync(main, v), await AtAsync(godown, v)));
        await AssertLocationsSumAsync(v);

        // Purchases land in the chosen location; cancelling a dispatched transfer puts goods back.
        var s = await f.App.Suppliers.SaveAsync(new Supplier { Name = "Loc Supplier", StateCode = "29" });
        await f.App.Purchases.SaveAsync(new PurchaseInput { SupplierId = s, WarehouseId = godown, Complete = true, Lines = { new PurchaseLineInput { VariantId = v, Quantity = 3, UnitCost = 12000, GstRate = 18 } } });
        Assert.Equal(8m, await AtAsync(godown, v));
        var t3 = await f.App.Locations.SaveTransferAsync(new TransferInput { FromWarehouseId = godown, ToWarehouseId = main, Lines = { new TransferLineInput { VariantId = v, Quantity = 2 } } });
        await f.App.Locations.DispatchAsync(t3);
        await f.App.Locations.CancelTransferAsync(t3, "Truck not available");
        Assert.Equal(8m, await AtAsync(godown, v));
        await AssertLocationsSumAsync(v);

        // A location holding stock cannot be deactivated.
        await Assert.ThrowsAsync<BusinessRuleException>(() => f.App.Locations.SaveAsync(new Warehouse { Id = godown, Code = "GDN", Name = "Peenya godown", Kind = "WAREHOUSE", IsActive = false }));
    }

    [DbFact]
    public async Task Bom_costs_a_product_and_production_consumes_materials_into_finished_stock()
    {
        var ply = await f.App.Production.SaveMaterialAsync(new RawMaterial { Name = "BWP plywood 18mm", Category = "Plywood", Unit = "sheet", CostPrice = 2400, OpeningStock = 10, MinStock = 2 });
        var hinge = await f.App.Production.SaveMaterialAsync(new RawMaterial { Name = "Soft-close hinge", Category = "Hardware", Unit = "piece", CostPrice = 150, OpeningStock = 20 });
        // Weighted average cost on receipt: (10 × 2400 + 10 × 2700) / 20 = 2550.
        await f.App.Production.StockAsync(new RawMaterialStockInput { RawMaterialId = ply, Type = "RECEIVE", Quantity = 10, UnitCost = 2700 });
        Assert.Equal(2550m, (await f.App.Production.MaterialAsync(ply)).CostPrice);

        var v = await f.ProductAsync("WRD-2D", 42000, 0, 0);
        await f.App.Production.SaveBomAsync(new Bom
        {
            VariantId = v, LabourCost = 6000, OtherCost = 1000,
            Lines = { new BomLine { RawMaterialId = ply, Quantity = 4, WastagePercent = 10 }, new BomLine { RawMaterialId = hinge, Quantity = 4 } },
        });
        var bom = await f.App.Production.BomAsync(v);
        Assert.Equal(4.4m, bom.Lines.Single(l => l.RawMaterialId == ply).GrossQuantity);
        Assert.Equal(4.4m * 2550 + 4 * 150, bom.MaterialCost);
        Assert.Equal(bom.MaterialCost + 7000, bom.TotalCost);

        // An order for 2 pulls BOM × 2 as its material plan.
        var po = await f.App.Production.SaveOrderAsync(new ProductionInput { VariantId = v, Quantity = 2 });
        var o = await f.App.Production.OrderAsync(po);
        Assert.Equal(8.8m, o.Materials.Single(m => m.RawMaterialId == ply).QuantityRequired);
        Assert.Equal(12000m, o.LabourCost);

        // Work cannot start before materials are issued.
        await Assert.ThrowsAsync<BusinessRuleException>(() => f.App.Production.MoveAsync(po, ProductionStatus.Cutting, null));
        await f.App.Production.IssueAsync(po, new[] { new IssueInput { RawMaterialId = ply, Quantity = 8.8m }, new IssueInput { RawMaterialId = hinge, Quantity = 8 } });
        Assert.Equal(20m - 8.8m, (await f.App.Production.MaterialAsync(ply)).Stock);
        await Assert.ThrowsAsync<BusinessRuleException>(() => f.App.Production.CompleteAsync(po, null)); // not through QC yet
        foreach (var s in new[] { ProductionStatus.Cutting, ProductionStatus.Assembly, ProductionStatus.Finishing, ProductionStatus.Qc })
            await f.App.Production.MoveAsync(po, s, null);
        await f.App.Production.CompleteAsync(po, "Passed QC");

        o = await f.App.Production.OrderAsync(po);
        Assert.Equal(ProductionStatus.Completed, o.Status);
        Assert.Equal(8.8m * 2550 + 8 * 150, o.MaterialCost);
        var levels = await f.App.Inventory.LevelsAsync(v);
        Assert.Equal(2m, levels.OnHand);
        var move = (await f.App.Inventory.MovementsAsync(new ListQuery { PageSize = 10 }, v)).Items.First();
        Assert.Equal(MovementType.ProductionIn, move.MovementType);
        Assert.Equal(Math.Round(o.TotalCost!.Value / 2, 2), move.UnitCost);

        // Raw material ledger is immutable.
        await Assert.ThrowsAnyAsync<Npgsql.PostgresException>(() => f.App.Db.ExecuteAsync("delete from raw_material_movements"));
    }

    [DbFact]
    public async Task Production_for_a_custom_order_drives_its_stages_and_cost_and_cancel_returns_materials()
    {
        var foam = await f.App.Production.SaveMaterialAsync(new RawMaterial { Name = "HR foam 40D", Category = "Foam", Unit = "sq.ft", CostPrice = 90, OpeningStock = 100 });
        var c = await f.CustomerAsync("Sofa Customer", "9876522222");
        var co = await f.App.CustomOrders.SaveAsync(new CustomOrder { CustomerId = c, ProductType = "L-shape sofa", EstimatedCost = 95000, GstRate = 18 });

        var po = await f.App.Production.SaveOrderAsync(new ProductionInput { CustomOrderId = co, LabourCost = 9000, Materials = new() { new ProductionMaterialInput { RawMaterialId = foam, QuantityRequired = 60 } } });
        Assert.Equal(CustomOrderStatus.Production, (await f.App.CustomOrders.GetAsync(co)).Status);
        await f.App.Production.IssueAsync(po, new[] { new IssueInput { RawMaterialId = foam, Quantity = 60 } });
        await f.App.Production.MoveAsync(po, ProductionStatus.Qc, null);
        await f.App.Production.CompleteAsync(po, null);
        var order = await f.App.CustomOrders.GetAsync(co);
        Assert.Equal(CustomOrderStatus.QualityCheck, order.Status);
        Assert.Equal(9000m + 60 * 90, order.ProductionCost);

        // Cancelling another order returns what was issued.
        var po2 = await f.App.Production.SaveOrderAsync(new ProductionInput { CustomOrderId = co, Description = "Extra cushions", Materials = new() { new ProductionMaterialInput { RawMaterialId = foam, QuantityRequired = 10 } } });
        await f.App.Production.IssueAsync(po2, new[] { new IssueInput { RawMaterialId = foam, Quantity = 10 } });
        Assert.Equal(30m, (await f.App.Production.MaterialAsync(foam)).Stock);
        await f.App.Production.CancelAsync(po2, "Customer changed mind");
        Assert.Equal(40m, (await f.App.Production.MaterialAsync(foam)).Stock);
        await Assert.ThrowsAsync<BusinessRuleException>(() => f.App.Production.IssueAsync(po2, new[] { new IssueInput { RawMaterialId = foam, Quantity = 1 } }));
    }
}
