using Dapper;
using FurniShop.Core;
using FurniShop.Core.Domain;
using FurniShop.Core.Security;
using FurniShop.Core.Validation;
using FurniShop.Infrastructure.Database;
using FurniShop.Infrastructure.Security;
using Npgsql;

namespace FurniShop.Infrastructure.Services;

// ============================================================================ models

public sealed class RawMaterial
{
    public long Id { get; set; }
    public string Code { get; set; } = "";
    public string Name { get; set; } = "";
    public string Category { get; set; } = "";
    public string Unit { get; set; } = "";
    public decimal? CostPrice { get; set; }
    public decimal Stock { get; set; }
    public decimal MinStock { get; set; }
    public decimal ReorderQty { get; set; }
    public long? SupplierId { get; set; }
    public string? SupplierName { get; set; }
    public long? WarehouseId { get; set; }
    public string? WarehouseName { get; set; }
    public string? Notes { get; set; }
    public bool IsActive { get; set; } = true;
    public decimal? StockValue => CostPrice is null ? null : Math.Round(Stock * CostPrice.Value, 2);
    public bool IsLow => Stock <= MinStock;
    /// <summary>Opening stock when creating.</summary>
    public decimal OpeningStock { get; set; }
}

public sealed class RawMaterialMovement
{
    public long Id { get; set; }
    public long RawMaterialId { get; set; }
    public string? MaterialName { get; set; }
    public string? Unit { get; set; }
    public string MovementType { get; set; } = "";
    public decimal QuantityDelta { get; set; }
    public decimal StockAfter { get; set; }
    public decimal? UnitCost { get; set; }
    public string? SupplierName { get; set; }
    public string? RefType { get; set; }
    public long? RefId { get; set; }
    public string? RefNumber { get; set; }
    public string? Note { get; set; }
    public string? CreatedByName { get; set; }
    public DateTime CreatedAt { get; set; }
}

public sealed class RawMaterialStockInput
{
    public long RawMaterialId { get; set; }
    /// <summary>RECEIVE, ADJUST_IN, ADJUST_OUT, WASTAGE</summary>
    public string Type { get; set; } = "RECEIVE";
    public decimal Quantity { get; set; }
    public decimal? UnitCost { get; set; }
    public long? SupplierId { get; set; }
    public string? Reference { get; set; }
    public string? Note { get; set; }
}

public sealed class Bom
{
    public long VariantId { get; set; }
    public string? ProductName { get; set; }
    public string? Sku { get; set; }
    public decimal LabourCost { get; set; }
    public decimal OtherCost { get; set; }
    public string? Notes { get; set; }
    public List<BomLine> Lines { get; set; } = new();
    public decimal MaterialCost => Lines.Sum(l => l.LineCost ?? 0);
    public decimal TotalCost => MaterialCost + LabourCost + OtherCost;
    public decimal? SellingPrice { get; set; }
    public decimal GstRate { get; set; }
    public bool PriceIncludesGst { get; set; }
    /// <summary>Selling price net of GST — the revenue a unit actually brings in.</summary>
    public decimal? NetPrice => SellingPrice is null ? null : PriceIncludesGst ? Math.Round(SellingPrice.Value / (1 + GstRate / 100m), 2) : SellingPrice;
}

public sealed class BomLine
{
    public long RawMaterialId { get; set; }
    public string? Code { get; set; }
    public string? Name { get; set; }
    public string? Unit { get; set; }
    public decimal Quantity { get; set; }
    public decimal WastagePercent { get; set; }
    public decimal? UnitCost { get; set; }
    public decimal? Stock { get; set; }
    public decimal GrossQuantity => Math.Round(Quantity * (1 + WastagePercent / 100m), 3);
    public decimal? LineCost => UnitCost is null ? null : Math.Round(GrossQuantity * UnitCost.Value, 2);
}

public sealed class BomSummary
{
    public long VariantId { get; set; }
    public string ProductName { get; set; } = "";
    public string Sku { get; set; } = "";
    public int Materials { get; set; }
    public decimal? TotalCost { get; set; }
    public decimal? SellingPrice { get; set; }
    public decimal? NetPrice { get; set; }
    public DateTime UpdatedAt { get; set; }
}

public sealed class ProductionOrder
{
    public long Id { get; set; }
    public string Number { get; set; } = "";
    public long? CustomOrderId { get; set; }
    public string? CustomOrderNumber { get; set; }
    public string? CustomerName { get; set; }
    public long? VariantId { get; set; }
    public string? Sku { get; set; }
    public string Description { get; set; } = "";
    public decimal Quantity { get; set; } = 1;
    public string Status { get; set; } = ProductionStatus.New;
    public string Priority { get; set; } = "NORMAL";
    public DateTime? DueDate { get; set; }
    public string? AssignedTo { get; set; }
    public long? WarehouseId { get; set; }
    public string? WarehouseName { get; set; }
    public decimal? LabourCost { get; set; }
    public decimal? OtherCost { get; set; }
    public decimal? MaterialCost { get; set; }
    public decimal? TotalCost => LabourCost is null ? null : LabourCost + OtherCost + MaterialCost;
    public string? Notes { get; set; }
    public DateTime? StartedAt { get; set; }
    public DateTime? CompletedAt { get; set; }
    public string? CancelReason { get; set; }
    public string? CreatedByName { get; set; }
    public DateTime CreatedAt { get; set; }
    public int MaterialLines { get; set; }
    public int MaterialsShort { get; set; }
    public List<ProductionMaterial> Materials { get; set; } = new();
}

public sealed class ProductionMaterial
{
    public long Id { get; set; }
    public long RawMaterialId { get; set; }
    public string? Code { get; set; }
    public string? Name { get; set; }
    public string? Unit { get; set; }
    public decimal QuantityRequired { get; set; }
    public decimal QuantityIssued { get; set; }
    public decimal? Stock { get; set; }
    public decimal Pending => Math.Max(0, QuantityRequired - QuantityIssued);
}

public sealed class ProductionInput
{
    public long Id { get; set; }
    public long? CustomOrderId { get; set; }
    public long? VariantId { get; set; }
    public string? Description { get; set; }
    public decimal Quantity { get; set; } = 1;
    public string Priority { get; set; } = "NORMAL";
    public DateTime? DueDate { get; set; }
    public string? AssignedTo { get; set; }
    public long? WarehouseId { get; set; }
    public decimal? LabourCost { get; set; }
    public decimal? OtherCost { get; set; }
    public string? Notes { get; set; }
    /// <summary>Materials; when empty on create and a BOM exists, the BOM × quantity is used.</summary>
    public List<ProductionMaterialInput>? Materials { get; set; }
}
public sealed class ProductionMaterialInput { public long RawMaterialId { get; set; } public decimal QuantityRequired { get; set; } }
public sealed class IssueInput { public long RawMaterialId { get; set; } public decimal Quantity { get; set; } }

public static class ProductionStatus
{
    public const string New = "NEW", Planning = "PLANNING", MaterialReady = "MATERIAL_READY", Cutting = "CUTTING", Assembly = "ASSEMBLY",
        Finishing = "FINISHING", Qc = "QC", Ready = "READY", Completed = "COMPLETED", Cancelled = "CANCELLED";
    public static readonly string[] Board = { New, Planning, MaterialReady, Cutting, Assembly, Finishing, Qc, Ready };
    public static int Rank(string s) => Array.IndexOf(Board, s) is var i and >= 0 ? i : s == Completed ? Board.Length : -1;
}

// ============================================================================ service

/// <summary>
/// Raw materials, bills of material and production orders. Materials are issued to an order from their own
/// immutable ledger; completing an order puts finished goods into stock (stock products) or books the
/// production cost on the custom order.
/// </summary>
public sealed class ProductionService(Db db, UserSession session, AuditService audit, InventoryService inventory)
{
    private static string? Blank(string? s) => string.IsNullOrWhiteSpace(s) ? null : s.Trim();

    // ------------------------------------------------------------------ raw materials
    private const string MaterialSelect = """
        select m.*, s.name as supplier_name, w.name as warehouse_name
        from raw_materials m left join suppliers s on s.id = m.supplier_id left join warehouses w on w.id = m.warehouse_id
        """;

    public async Task<PagedResult<RawMaterial>> MaterialsAsync(ListQuery q, string? category = null, bool lowOnly = false)
    {
        session.DemandAny(Perm.RawMaterialView, Perm.ProductionView);
        var where = """
            where m.is_active
              and (@Search::text is null or m.name ilike '%' || @Search || '%' or m.code ilike '%' || @Search || '%' or m.category ilike '%' || @Search || '%')
              and (@category::text is null or m.category = @category)
              and (not @lowOnly or m.stock <= m.min_stock)
            """;
        var order = q.SortBy switch { "stock" => "m.stock", "category" => "m.category, m.name", "value" => "m.stock * m.cost_price", "code" => "m.code", _ => "m.name" };
        var args = new { Search = Blank(q.Search), category = Blank(category), lowOnly, q.PageSize, q.Offset };
        await using var conn = await db.OpenAsync();
        var total = await conn.ExecuteScalarAsync<int>($"select count(*) from raw_materials m {where}", args);
        var rows = (await conn.QueryAsync<RawMaterial>($"{MaterialSelect} {where} order by {order} {(q.SortDescending && q.SortBy != null ? "desc" : "asc")} limit @PageSize offset @Offset", args)).AsList();
        HideCost(rows);
        return new PagedResult<RawMaterial> { Items = rows, TotalCount = total, Page = q.Page, PageSize = q.PageSize };
    }

    public async Task<IReadOnlyList<string>> MaterialCategoriesAsync() =>
        await db.QueryAsync<string>("select distinct category from raw_materials where is_active order by 1");

    public async Task<RawMaterial> MaterialAsync(long id)
    {
        session.DemandAny(Perm.RawMaterialView, Perm.ProductionView);
        var m = (await db.QueryAsync<RawMaterial>($"{MaterialSelect} where m.id = @id", new { id })).FirstOrDefault() ?? throw new NotFoundException("Raw material", id);
        HideCost(new[] { m });
        return m;
    }

    private void HideCost(IEnumerable<RawMaterial> rows) { if (!session.CanSeeCost) foreach (var r in rows) r.CostPrice = null; }

    public async Task<long> SaveMaterialAsync(RawMaterial m)
    {
        session.Demand(Perm.RawMaterialManage);
        new ValidationBuilder().Require(m.Name, nameof(m.Name), "Name").Require(m.Category, nameof(m.Category), "Category").Require(m.Unit, nameof(m.Unit), "Unit")
            .Check(m.MinStock >= 0 && m.ReorderQty >= 0 && m.OpeningStock >= 0, nameof(m.MinStock), "Quantities cannot be negative.")
            .Check((m.CostPrice ?? 0) >= 0, nameof(m.CostPrice), "Cost cannot be negative.").ThrowIfInvalid();
        return await db.InTransactionAsync(async (conn, tx) =>
        {
            if (string.IsNullOrWhiteSpace(m.Code))
                m.Code = "RM-" + (await conn.ExecuteScalarAsync<long>("select coalesce(max(id), 0) + 1 from raw_materials", transaction: tx)).ToString("0000");
            if (await conn.ExecuteScalarAsync<bool>("select exists(select 1 from raw_materials where lower(code) = lower(@Code) and id <> @Id)", m, tx))
                throw new ValidationException("Code", "Another material already uses this code.");
            long id;
            if (m.Id == 0)
            {
                id = await conn.ExecuteScalarAsync<long>("""
                    insert into raw_materials (code, name, category, unit, cost_price, min_stock, reorder_qty, supplier_id, warehouse_id, notes)
                    values (upper(@Code), @Name, @Category, @Unit, coalesce(@CostPrice, 0), @MinStock, @ReorderQty, @SupplierId, @WarehouseId, @Notes) returning id
                    """, m, tx);
                if (m.OpeningStock > 0)
                    await MoveAsync(conn, tx, id, "OPENING", m.OpeningStock, m.CostPrice, null, "RAW_MATERIAL", id, null, "Opening stock");
            }
            else
            {
                var costSql = session.CanSeeCost ? "cost_price = coalesce(@CostPrice, cost_price)," : "";
                await conn.ExecuteAsync($"""
                    update raw_materials set code = upper(@Code), name = @Name, category = @Category, unit = @Unit, {costSql} min_stock = @MinStock,
                        reorder_qty = @ReorderQty, supplier_id = @SupplierId, warehouse_id = @WarehouseId, notes = @Notes, is_active = @IsActive, updated_at = now()
                    where id = @Id
                    """, m, tx);
                id = m.Id;
            }
            await audit.LogAsync(conn, tx, m.Id == 0 ? "CREATE" : "UPDATE", "Production", $"saved raw material {m.Name}", "raw_material", id, m.Code);
            return id;
        });
    }

    /// <summary>Receiving updates the material's cost to the weighted average of old stock and the new lot.</summary>
    public async Task StockAsync(RawMaterialStockInput input)
    {
        session.Demand(Perm.RawMaterialManage);
        if (input.Quantity <= 0) throw new ValidationException("Quantity", "Enter a quantity above zero.");
        if (input.Type is not ("RECEIVE" or "ADJUST_IN" or "ADJUST_OUT" or "WASTAGE")) throw new ValidationException("Type", "Unknown stock entry.");
        if (input.Type != "RECEIVE" && string.IsNullOrWhiteSpace(input.Note)) throw new ValidationException("Note", "Enter the reason for this adjustment.");
        await db.InTransactionAsync(async (conn, tx) =>
        {
            var m = await conn.QuerySingleOrDefaultAsync<RawMaterial>("select * from raw_materials where id = @RawMaterialId for update", input, tx)
                    ?? throw new NotFoundException("Raw material", input.RawMaterialId);
            var delta = input.Type is "RECEIVE" or "ADJUST_IN" ? input.Quantity : -input.Quantity;
            if (input.Type == "RECEIVE" && input.UnitCost is > 0 && m.Stock + input.Quantity > 0)
            {
                var avg = Math.Round(((Math.Max(0, m.Stock) * (m.CostPrice ?? 0)) + input.Quantity * input.UnitCost.Value) / (Math.Max(0, m.Stock) + input.Quantity), 2);
                await conn.ExecuteAsync("update raw_materials set cost_price = @avg where id = @id", new { avg, id = m.Id }, tx);
            }
            await MoveAsync(conn, tx, m.Id, input.Type, delta, input.UnitCost, input.SupplierId ?? (input.Type == "RECEIVE" ? m.SupplierId : null),
                null, null, Blank(input.Reference), Blank(input.Note));
            await audit.LogAsync(conn, tx, "STOCK", "Production", $"{input.Type.ToLowerInvariant().Replace('_', ' ')} {input.Quantity:0.###} {m.Unit} of {m.Name}", "raw_material", m.Id, m.Code);
        });
    }

    private async Task<decimal> MoveAsync(NpgsqlConnection conn, NpgsqlTransaction tx, long materialId, string type, decimal delta, decimal? unitCost,
        long? supplierId, string? refType, long? refId, string? refNumber, string? note)
    {
        var cur = await conn.QuerySingleAsync<(decimal Stock, string Name, string Unit)>("select stock, name, unit from raw_materials where id = @materialId for update", new { materialId }, tx);
        var after = cur.Stock + delta;
        if (after < 0) throw new BusinessRuleException($"Only {cur.Stock:0.###} {cur.Unit} of {cur.Name} in stock.");
        await conn.ExecuteAsync("update raw_materials set stock = @after, updated_at = now() where id = @materialId", new { after, materialId }, tx);
        await conn.ExecuteAsync("""
            insert into raw_material_movements (raw_material_id, movement_type, quantity_delta, stock_after, unit_cost, supplier_id, ref_type, ref_id, ref_number, note, created_by)
            values (@materialId, @type, @delta, @after, @unitCost, @supplierId, @refType, @refId, @refNumber, @note, @uid)
            """, new { materialId, type, delta, after, unitCost, supplierId, refType, refId, refNumber, note, uid = session.UserId }, tx);
        if (delta < 0)
        {
            var min = await conn.ExecuteScalarAsync<decimal>("select min_stock from raw_materials where id = @materialId", new { materialId }, tx);
            if (after <= min)
                await conn.ExecuteAsync("""
                    insert into notifications (kind, title, message, ref_type, ref_id) values ('LOW_STOCK', 'Raw material low', @msg, 'RAW_MATERIAL', @materialId)
                    """, new { msg = $"{cur.Name}: {after:0.###} {cur.Unit} left (minimum {min:0.###}).", materialId }, tx);
        }
        return after;
    }

    public async Task<PagedResult<RawMaterialMovement>> MaterialMovementsAsync(ListQuery q, long? materialId)
    {
        session.DemandAny(Perm.RawMaterialView, Perm.ProductionView);
        var where = "where (@materialId::bigint is null or mm.raw_material_id = @materialId) and (@Status::text is null or mm.movement_type = @Status)";
        var args = new { materialId, q.Status, q.PageSize, q.Offset };
        await using var conn = await db.OpenAsync();
        var total = await conn.ExecuteScalarAsync<int>($"select count(*) from raw_material_movements mm {where}", args);
        var rows = (await conn.QueryAsync<RawMaterialMovement>($"""
            select mm.*, m.name as material_name, m.unit, s.name as supplier_name, u.full_name as created_by_name
            from raw_material_movements mm join raw_materials m on m.id = mm.raw_material_id
            left join suppliers s on s.id = mm.supplier_id left join users u on u.id = mm.created_by
            {where} order by mm.created_at desc, mm.id desc limit @PageSize offset @Offset
            """, args)).AsList();
        if (!session.CanSeeCost) rows.ForEach(r => r.UnitCost = null);
        return new PagedResult<RawMaterialMovement> { Items = rows, TotalCount = total, Page = q.Page, PageSize = q.PageSize };
    }

    // ------------------------------------------------------------------ BOM
    public async Task<IReadOnlyList<BomSummary>> BomsAsync(string? search)
    {
        session.DemandAny(Perm.RawMaterialView, Perm.ProductionView);
        var rows = (await db.QueryAsync<BomSummary>("""
            select b.variant_id, p.name || case when v.variant_name <> 'Standard' then ' — ' || v.variant_name else '' end as product_name, v.sku,
                   (select count(*) from bom_items i where i.bom_id = b.id)::int as materials,
                   b.labour_cost + b.other_cost + coalesce((select sum(round(i.quantity * (1 + i.wastage_percent / 100) * m.cost_price, 2))
                       from bom_items i join raw_materials m on m.id = i.raw_material_id where i.bom_id = b.id), 0) as total_cost,
                   coalesce(v.selling_price, p.selling_price) as selling_price,
                   case when p.price_includes_gst then round(coalesce(v.selling_price, p.selling_price) / (1 + p.gst_rate / 100), 2) else coalesce(v.selling_price, p.selling_price) end as net_price,
                   b.updated_at
            from boms b join product_variants v on v.id = b.variant_id join products p on p.id = v.product_id
            where @search::text is null or p.name ilike '%' || @search || '%' or v.sku ilike '%' || @search || '%'
            order by p.name
            """, new { search = Blank(search) })).AsList();
        if (!session.CanSeeCost) rows.ForEach(r => r.TotalCost = null);
        return rows;
    }

    public async Task<Bom> BomAsync(long variantId)
    {
        session.DemandAny(Perm.RawMaterialView, Perm.ProductionView);
        await using var conn = await db.OpenAsync();
        return await LoadBomAsync(conn, null, variantId);
    }

    private async Task<Bom> LoadBomAsync(NpgsqlConnection conn, NpgsqlTransaction? tx, long variantId)
    {
        var head = await conn.QuerySingleOrDefaultAsync<Bom>("""
            select v.id as variant_id, p.name || case when v.variant_name <> 'Standard' then ' — ' || v.variant_name else '' end as product_name, v.sku,
                   coalesce(b.labour_cost, 0) as labour_cost, coalesce(b.other_cost, 0) as other_cost, b.notes, coalesce(v.selling_price, p.selling_price) as selling_price,
                   p.gst_rate, p.price_includes_gst
            from product_variants v join products p on p.id = v.product_id left join boms b on b.variant_id = v.id where v.id = @variantId
            """, new { variantId }, tx) ?? throw new NotFoundException("Product variant", variantId);
        head.Lines = (await conn.QueryAsync<BomLine>("""
            select i.raw_material_id, m.code, m.name, m.unit, i.quantity, i.wastage_percent, m.cost_price as unit_cost, m.stock
            from boms b join bom_items i on i.bom_id = b.id join raw_materials m on m.id = i.raw_material_id where b.variant_id = @variantId order by m.name
            """, new { variantId }, tx)).AsList();
        if (!session.CanSeeCost) { head.Lines.ForEach(l => l.UnitCost = null); head.LabourCost = 0; head.OtherCost = 0; }
        return head;
    }

    public async Task SaveBomAsync(Bom bom)
    {
        session.Demand(Perm.RawMaterialManage);
        if (bom.LabourCost < 0 || bom.OtherCost < 0) throw new ValidationException("LabourCost", "Costs cannot be negative.");
        if (bom.Lines.Any(l => l.Quantity <= 0)) throw new ValidationException("Lines", "Every material needs a quantity above zero.");
        if (bom.Lines.Any(l => l.WastagePercent is < 0 or > 100)) throw new ValidationException("Lines", "Wastage must be 0–100%.");
        if (bom.Lines.GroupBy(l => l.RawMaterialId).Any(g => g.Count() > 1)) throw new ValidationException("Lines", "Each material can appear only once.");
        await db.InTransactionAsync(async (conn, tx) =>
        {
            var bomId = await conn.ExecuteScalarAsync<long>("""
                insert into boms (variant_id, labour_cost, other_cost, notes) values (@VariantId, @LabourCost, @OtherCost, @Notes)
                on conflict (variant_id) do update set labour_cost = excluded.labour_cost, other_cost = excluded.other_cost, notes = excluded.notes, updated_at = now()
                returning id
                """, bom, tx);
            await conn.ExecuteAsync("delete from bom_items where bom_id = @bomId", new { bomId }, tx);
            foreach (var l in bom.Lines)
                await conn.ExecuteAsync("insert into bom_items (bom_id, raw_material_id, quantity, wastage_percent) values (@bomId, @RawMaterialId, @Quantity, @WastagePercent)",
                    new { bomId, l.RawMaterialId, l.Quantity, l.WastagePercent }, tx);
            var sku = await conn.ExecuteScalarAsync<string>("select sku from product_variants where id = @VariantId", bom, tx);
            await audit.LogAsync(conn, tx, "UPDATE", "Production", $"saved bill of materials for {sku} ({bom.Lines.Count} material(s))", "bom", bom.VariantId, sku);
        });
    }

    // ------------------------------------------------------------------ production orders
    private const string OrderSelect = """
        select po.*, co.number as custom_order_number, coalesce(c.name, '') as customer_name, v.sku, w.name as warehouse_name, u.full_name as created_by_name,
               (select count(*) from production_materials pm where pm.production_order_id = po.id)::int as material_lines,
               (select count(*) from production_materials pm where pm.production_order_id = po.id and pm.quantity_issued < pm.quantity_required)::int as materials_short
        from production_orders po
        left join custom_orders co on co.id = po.custom_order_id left join customers c on c.id = co.customer_id
        left join product_variants v on v.id = po.variant_id left join warehouses w on w.id = po.warehouse_id left join users u on u.id = po.created_by
        """;

    public async Task<IReadOnlyList<ProductionOrder>> BoardAsync()
    {
        session.Demand(Perm.ProductionView);
        var rows = (await db.QueryAsync<ProductionOrder>($"""
            {OrderSelect} where po.status not in ('COMPLETED','CANCELLED') or po.completed_at > now() - interval '3 days'
            order by case po.priority when 'URGENT' then 0 when 'HIGH' then 1 when 'NORMAL' then 2 else 3 end, po.due_date nulls last, po.id
            """)).AsList();
        HideCost(rows);
        return rows;
    }

    public async Task<PagedResult<ProductionOrder>> OrdersAsync(ListQuery q)
    {
        session.Demand(Perm.ProductionView);
        var where = """
            where (@Status::text is null or po.status = @Status or (@Status = 'OPEN' and po.status not in ('COMPLETED','CANCELLED')))
              and (@Search::text is null or po.number ilike '%' || @Search || '%' or po.description ilike '%' || @Search || '%' or co.number ilike '%' || @Search || '%'
                   or c.name ilike '%' || @Search || '%' or po.assigned_to ilike '%' || @Search || '%')
            """;
        var args = new { q.Status, Search = Blank(q.Search), q.PageSize, q.Offset };
        await using var conn = await db.OpenAsync();
        var total = await conn.ExecuteScalarAsync<int>($"select count(*) from production_orders po left join custom_orders co on co.id = po.custom_order_id left join customers c on c.id = co.customer_id {where}", args);
        var rows = (await conn.QueryAsync<ProductionOrder>($"{OrderSelect} {where} order by po.created_at desc limit @PageSize offset @Offset", args)).AsList();
        HideCost(rows);
        return new PagedResult<ProductionOrder> { Items = rows, TotalCount = total, Page = q.Page, PageSize = q.PageSize };
    }

    public async Task<ProductionOrder> OrderAsync(long id)
    {
        session.Demand(Perm.ProductionView);
        await using var conn = await db.OpenAsync();
        var o = await conn.QuerySingleOrDefaultAsync<ProductionOrder>($"{OrderSelect} where po.id = @id", new { id }) ?? throw new NotFoundException("Production order", id);
        o.Materials = (await conn.QueryAsync<ProductionMaterial>("""
            select pm.*, m.code, m.name, m.unit, m.stock from production_materials pm join raw_materials m on m.id = pm.raw_material_id
            where pm.production_order_id = @id order by m.name
            """, new { id })).AsList();
        HideCost(new[] { o });
        return o;
    }

    public async Task<IReadOnlyList<ProductionOrder>> ForCustomOrderAsync(long customOrderId)
    {
        session.DemandAny(Perm.ProductionView, Perm.CustomOrderView);
        var rows = (await db.QueryAsync<ProductionOrder>($"{OrderSelect} where po.custom_order_id = @customOrderId order by po.id", new { customOrderId })).AsList();
        HideCost(rows);
        return rows;
    }

    private void HideCost(IEnumerable<ProductionOrder> rows)
    {
        if (session.CanSeeCost) return;
        foreach (var r in rows) { r.LabourCost = null; r.OtherCost = null; r.MaterialCost = null; }
    }

    public async Task<long> SaveOrderAsync(ProductionInput input)
    {
        session.Demand(Perm.ProductionManage);
        if (input.Quantity <= 0) throw new ValidationException("Quantity", "Enter a quantity above zero.");
        if (input.CustomOrderId is null && input.VariantId is null) throw new ValidationException("VariantId", "Choose the product to make or the custom order.");
        if (input.Priority is not ("LOW" or "NORMAL" or "HIGH" or "URGENT")) throw new ValidationException("Priority", "Unknown priority.");
        return await db.InTransactionAsync(async (conn, tx) =>
        {
            var description = Blank(input.Description);
            (string Number, string ProductType, string Status)? co = null;
            if (input.CustomOrderId is { } coId)
            {
                co = await conn.QuerySingleOrDefaultAsync<(string, string, string)>("select number, product_type, status from custom_orders where id = @coId for update", new { coId }, tx);
                if (co is null) throw new NotFoundException("Custom order", coId);
                if (co.Value.Status is CustomOrderStatus.Cancelled or CustomOrderStatus.Completed) throw new BusinessRuleException("This custom order is closed.");
                description ??= $"{co.Value.ProductType} for {co.Value.Number}";
            }
            if (input.VariantId is { } vid)
                description ??= await conn.ExecuteScalarAsync<string>("select p.name || case when v.variant_name <> 'Standard' then ' — ' || v.variant_name else '' end from product_variants v join products p on p.id = v.product_id where v.id = @vid", new { vid }, tx);
            if (description is null) throw new ValidationException("Description", "Describe what is being made.");

            long id; string number;
            if (input.Id == 0)
            {
                number = await SequenceService.NextAsync(conn, tx, DocType.ProductionOrder);
                decimal labour = input.LabourCost ?? 0, other = input.OtherCost ?? 0;
                var materials = input.Materials;
                if ((materials is null || materials.Count == 0) && input.VariantId is { } v2)
                {
                    var bom = await LoadBomAsync(conn, tx, v2);
                    materials = bom.Lines.Select(l => new ProductionMaterialInput { RawMaterialId = l.RawMaterialId, QuantityRequired = Math.Round(l.GrossQuantity * input.Quantity, 3) }).ToList();
                    if (input.LabourCost is null) labour = Math.Round(await conn.ExecuteScalarAsync<decimal>("select coalesce(labour_cost, 0) from boms where variant_id = @v2", new { v2 }, tx) * input.Quantity, 2);
                    if (input.OtherCost is null) other = Math.Round(await conn.ExecuteScalarAsync<decimal>("select coalesce(other_cost, 0) from boms where variant_id = @v2", new { v2 }, tx) * input.Quantity, 2);
                }
                id = await conn.ExecuteScalarAsync<long>("""
                    insert into production_orders (number, custom_order_id, variant_id, description, quantity, priority, due_date, assigned_to, warehouse_id,
                        labour_cost, other_cost, notes, created_by)
                    values (@number, @CustomOrderId, @VariantId, @description, @Quantity, @Priority, @DueDate, @AssignedTo, @WarehouseId, @labour, @other, @Notes, @uid)
                    returning id
                    """, new { number, input.CustomOrderId, input.VariantId, description, input.Quantity, input.Priority, input.DueDate, AssignedTo = Blank(input.AssignedTo),
                        input.WarehouseId, labour, other, input.Notes, uid = session.UserId }, tx);
                await ReplaceMaterialsAsync(conn, tx, id, materials ?? new());
                await SalesDocumentBuilder.AddStatusHistoryAsync(conn, tx, DocType.ProductionOrder, id, null, ProductionStatus.New, "Created", session.UserId);
                if (co is { } c && c.Status is CustomOrderStatus.Received or CustomOrderStatus.Design)
                {
                    await conn.ExecuteAsync("update custom_orders set status = 'PRODUCTION', updated_at = now() where id = @CustomOrderId", input, tx);
                    await SalesDocumentBuilder.AddStatusHistoryAsync(conn, tx, DocType.CustomOrder, input.CustomOrderId!.Value, c.Status, CustomOrderStatus.Production, $"Production order {number} raised", session.UserId);
                }
            }
            else
            {
                var cur = await LockAsync(conn, tx, input.Id);
                if (cur.Status is ProductionStatus.Completed or ProductionStatus.Cancelled) throw new BusinessRuleException("This production order is closed.");
                var costSql = session.CanSeeCost ? "labour_cost = coalesce(@LabourCost, labour_cost), other_cost = coalesce(@OtherCost, other_cost)," : "";
                await conn.ExecuteAsync($"""
                    update production_orders set description = @description, quantity = @Quantity, priority = @Priority, due_date = @DueDate, assigned_to = @AssignedTo,
                        warehouse_id = @WarehouseId, {costSql} notes = @Notes, updated_at = now() where id = @Id
                    """, new { description, input.Quantity, input.Priority, input.DueDate, AssignedTo = Blank(input.AssignedTo), input.WarehouseId, input.LabourCost, input.OtherCost, input.Notes, input.Id }, tx);
                if (input.Materials is not null) await ReplaceMaterialsAsync(conn, tx, input.Id, input.Materials);
                id = input.Id; number = cur.Number;
            }
            await audit.LogAsync(conn, tx, input.Id == 0 ? "CREATE" : "UPDATE", "Production", $"saved production order {number} — {description}", "production_order", id, number);
            return id;
        });
    }

    private static async Task ReplaceMaterialsAsync(NpgsqlConnection conn, NpgsqlTransaction tx, long id, List<ProductionMaterialInput> materials)
    {
        if (materials.Any(m => m.QuantityRequired < 0)) throw new ValidationException("Materials", "Quantities cannot be negative.");
        var issued = (await conn.QueryAsync<(long RawMaterialId, decimal Issued)>("select raw_material_id, quantity_issued from production_materials where production_order_id = @id", new { id }, tx))
            .ToDictionary(x => x.RawMaterialId, x => x.Issued);
        foreach (var (rm, qty) in issued)
            if (qty > 0 && !materials.Any(m => m.RawMaterialId == rm)) throw new BusinessRuleException("A material that has already been issued cannot be removed. Return it first.");
        foreach (var m in materials.GroupBy(x => x.RawMaterialId).Select(g => new ProductionMaterialInput { RawMaterialId = g.Key, QuantityRequired = g.Sum(x => x.QuantityRequired) }))
            await conn.ExecuteAsync("""
                insert into production_materials (production_order_id, raw_material_id, quantity_required) values (@id, @RawMaterialId, @QuantityRequired)
                on conflict (production_order_id, raw_material_id) do update set quantity_required = excluded.quantity_required
                """, new { id, m.RawMaterialId, m.QuantityRequired }, tx);
        await conn.ExecuteAsync("delete from production_materials where production_order_id = @id and quantity_issued = 0 and not (raw_material_id = any(@keep))",
            new { id, keep = materials.Select(m => m.RawMaterialId).ToArray() }, tx);
    }

    /// <summary>Issue (positive) or return (negative) raw material to/from a production order.</summary>
    public async Task IssueAsync(long id, IReadOnlyList<IssueInput> lines, bool isReturn = false)
    {
        session.Demand(Perm.ProductionManage);
        var items = lines.Where(l => l.Quantity > 0).ToList();
        if (items.Count == 0) throw new ValidationException("Lines", "Enter the quantity to " + (isReturn ? "return." : "issue."));
        await db.InTransactionAsync(async (conn, tx) =>
        {
            var o = await LockAsync(conn, tx, id);
            if (o.Status is ProductionStatus.Completed or ProductionStatus.Cancelled) throw new BusinessRuleException("This production order is closed.");
            foreach (var l in items)
            {
                var pm = await conn.QuerySingleOrDefaultAsync<ProductionMaterial>("select * from production_materials where production_order_id = @id and raw_material_id = @RawMaterialId for update",
                    new { id, l.RawMaterialId }, tx);
                if (pm is null)
                {
                    if (isReturn) throw new BusinessRuleException("That material was not issued to this order.");
                    await conn.ExecuteAsync("insert into production_materials (production_order_id, raw_material_id, quantity_required) values (@id, @RawMaterialId, 0)", new { id, l.RawMaterialId }, tx);
                    pm = new ProductionMaterial { RawMaterialId = l.RawMaterialId };
                }
                if (isReturn && l.Quantity > pm.QuantityIssued) throw new BusinessRuleException($"Only {pm.QuantityIssued:0.###} was issued.");
                var cost = await conn.ExecuteScalarAsync<decimal>("select cost_price from raw_materials where id = @RawMaterialId", l, tx);
                await MoveAsync(conn, tx, l.RawMaterialId, isReturn ? "RETURN" : "ISSUE", isReturn ? l.Quantity : -l.Quantity, cost, null, DocType.ProductionOrder, id, o.Number, null);
                var sign = isReturn ? -1 : 1;
                await conn.ExecuteAsync("update production_materials set quantity_issued = quantity_issued + @q where production_order_id = @id and raw_material_id = @RawMaterialId",
                    new { q = sign * l.Quantity, id, l.RawMaterialId }, tx);
                await conn.ExecuteAsync("update production_orders set material_cost = greatest(0, material_cost + @c), updated_at = now() where id = @id",
                    new { c = Math.Round(sign * l.Quantity * cost, 2), id }, tx);
            }
            await audit.LogAsync(conn, tx, isReturn ? "RETURN" : "ISSUE", "Production", $"{(isReturn ? "returned" : "issued")} {items.Count} material(s) for {o.Number}", "production_order", id, o.Number);
        });
    }

    /// <summary>Moves an order on the board. Work stages beyond "material ready" need every material issued.</summary>
    public async Task MoveAsync(long id, string status, string? note)
    {
        session.Demand(Perm.ProductionManage);
        if (ProductionStatus.Rank(status) < 0 || status == ProductionStatus.Completed) throw new ValidationException("Status", "Unknown board column.");
        await db.InTransactionAsync(async (conn, tx) =>
        {
            var o = await LockAsync(conn, tx, id);
            if (o.Status is ProductionStatus.Completed or ProductionStatus.Cancelled) throw new BusinessRuleException("This production order is closed.");
            if (o.Status == status) return;
            if (ProductionStatus.Rank(status) >= ProductionStatus.Rank(ProductionStatus.Cutting))
            {
                var shortCount = await conn.ExecuteScalarAsync<int>("select count(*) from production_materials where production_order_id = @id and quantity_issued < quantity_required", new { id }, tx);
                if (shortCount > 0) throw new BusinessRuleException($"{shortCount} material(s) are not fully issued yet. Issue them before work starts.");
            }
            await conn.ExecuteAsync("update production_orders set status = @status, started_at = coalesce(started_at, case when @started then now() end), updated_at = now() where id = @id",
                new { status, id, started = ProductionStatus.Rank(status) >= ProductionStatus.Rank(ProductionStatus.Cutting) }, tx);
            await SalesDocumentBuilder.AddStatusHistoryAsync(conn, tx, DocType.ProductionOrder, id, o.Status, status, Blank(note), session.UserId);
            await audit.LogAsync(conn, tx, "STATUS", "Production", $"moved {o.Number} to {status.Replace('_', ' ').ToLowerInvariant()}", "production_order", id, o.Number);
        });
    }

    /// <summary>
    /// Completes the order. Stock products: finished goods enter stock at production cost per unit.
    /// Custom orders: the production cost is recorded and the order moves on to quality check.
    /// </summary>
    public async Task CompleteAsync(long id, string? note)
    {
        session.Demand(Perm.ProductionManage);
        await db.InTransactionAsync(async (conn, tx) =>
        {
            var o = await LockAsync(conn, tx, id);
            if (o.Status is ProductionStatus.Completed or ProductionStatus.Cancelled) throw new BusinessRuleException("This production order is closed.");
            if (ProductionStatus.Rank(o.Status) < ProductionStatus.Rank(ProductionStatus.Qc))
                throw new BusinessRuleException("Finish quality check before completing the order.");
            var total = (o.LabourCost ?? 0) + (o.OtherCost ?? 0) + (o.MaterialCost ?? 0);
            if (o.VariantId is { } vid && await InventoryService.IsStockItemAsync(conn, tx, vid))
            {
                var unitCost = Math.Round(total / o.Quantity, 2);
                await inventory.ApplyAsync(conn, tx, vid, MovementType.ProductionIn, o.Quantity, 0, 0, DocType.ProductionOrder, id, o.Number,
                    Blank(note) ?? "Finished goods from production", unitCost > 0 ? unitCost : null, o.WarehouseId);
            }
            if (o.CustomOrderId is { } coId)
            {
                var coStatus = await conn.ExecuteScalarAsync<string>("select status from custom_orders where id = @coId for update", new { coId }, tx);
                var sum = await conn.ExecuteScalarAsync<decimal>("select coalesce(sum(labour_cost + other_cost + material_cost), 0) from production_orders where custom_order_id = @coId and status <> 'CANCELLED'", new { coId }, tx);
                await conn.ExecuteAsync("update custom_orders set production_cost = @sum, updated_at = now() where id = @coId", new { sum, coId }, tx);
                if (coStatus is CustomOrderStatus.Received or CustomOrderStatus.Design or CustomOrderStatus.Production)
                {
                    await conn.ExecuteAsync("update custom_orders set status = 'QUALITY_CHECK', updated_at = now() where id = @coId", new { coId }, tx);
                    await SalesDocumentBuilder.AddStatusHistoryAsync(conn, tx, DocType.CustomOrder, coId, coStatus, CustomOrderStatus.QualityCheck, $"Production {o.Number} completed", session.UserId);
                }
            }
            await conn.ExecuteAsync("update production_orders set status = 'COMPLETED', completed_at = now(), updated_at = now() where id = @id", new { id }, tx);
            await SalesDocumentBuilder.AddStatusHistoryAsync(conn, tx, DocType.ProductionOrder, id, o.Status, ProductionStatus.Completed, Blank(note), session.UserId);
            await conn.ExecuteAsync("insert into notifications (kind, title, message, ref_type, ref_id) values ('PRODUCTION', 'Production completed', @msg, 'PRODUCTION_ORDER', @id)",
                new { msg = $"{o.Number} — {o.Description} is ready.", id }, tx);
            await audit.LogAsync(conn, tx, "COMPLETE", "Production", $"completed production order {o.Number}", "production_order", id, o.Number);
        });
    }

    /// <summary>Cancelling returns every issued material to stock.</summary>
    public async Task CancelAsync(long id, string reason)
    {
        session.Demand(Perm.ProductionManage);
        if (string.IsNullOrWhiteSpace(reason)) throw new ValidationException("Reason", "Enter the reason for cancelling.");
        await db.InTransactionAsync(async (conn, tx) =>
        {
            var o = await LockAsync(conn, tx, id);
            if (o.Status is ProductionStatus.Completed or ProductionStatus.Cancelled) throw new BusinessRuleException("This production order is closed.");
            var issued = await conn.QueryAsync<ProductionMaterial>("select * from production_materials where production_order_id = @id and quantity_issued > 0", new { id }, tx);
            foreach (var pm in issued)
                await MoveAsync(conn, tx, pm.RawMaterialId, "RETURN", pm.QuantityIssued, null, null, DocType.ProductionOrder, id, o.Number, $"Order cancelled: {reason}");
            await conn.ExecuteAsync("update production_materials set quantity_issued = 0 where production_order_id = @id", new { id }, tx);
            await conn.ExecuteAsync("update production_orders set status = 'CANCELLED', cancel_reason = @reason, material_cost = 0, updated_at = now() where id = @id", new { id, reason }, tx);
            await SalesDocumentBuilder.AddStatusHistoryAsync(conn, tx, DocType.ProductionOrder, id, o.Status, ProductionStatus.Cancelled, reason, session.UserId);
            await audit.LogAsync(conn, tx, "CANCEL", "Production", $"cancelled production order {o.Number} — {reason}", "production_order", id, o.Number);
        });
    }

    public Task<IReadOnlyList<StatusHistoryEntry>> HistoryAsync(long id) => History.ForAsync(db, DocType.ProductionOrder, id);

    private static async Task<ProductionOrder> LockAsync(NpgsqlConnection conn, NpgsqlTransaction tx, long id) =>
        await conn.QuerySingleOrDefaultAsync<ProductionOrder>("select * from production_orders where id = @id for update", new { id }, tx)
        ?? throw new NotFoundException("Production order", id);
}
