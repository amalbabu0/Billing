using Dapper;
using FurniShop.Core;
using FurniShop.Core.Domain;
using FurniShop.Core.Security;
using FurniShop.Core.Validation;
using FurniShop.Infrastructure.Database;
using FurniShop.Infrastructure.Security;

namespace FurniShop.Infrastructure.Services;

public sealed class Warehouse
{
    public long Id { get; set; }
    public string Code { get; set; } = "";
    public string Name { get; set; } = "";
    public string Kind { get; set; } = "WAREHOUSE";
    public string? Address { get; set; }
    public bool IsDefault { get; set; }
    public bool IsActive { get; set; } = true;
    public decimal Units { get; set; }
    public decimal? StockValue { get; set; }
    public int Products { get; set; }
}

public sealed class LocationStockRow
{
    public long WarehouseId { get; set; }
    public string WarehouseName { get; set; } = "";
    public long VariantId { get; set; }
    public string Sku { get; set; } = "";
    public string ProductName { get; set; } = "";
    public string? VariantName { get; set; }
    public decimal OnHand { get; set; }
    public decimal Damaged { get; set; }
    public decimal InTransit { get; set; }
}

public sealed class StockTransfer
{
    public long Id { get; set; }
    public string Number { get; set; } = "";
    public long FromWarehouseId { get; set; }
    public string? FromName { get; set; }
    public long ToWarehouseId { get; set; }
    public string? ToName { get; set; }
    public string Status { get; set; } = "DRAFT";
    public DateTime TransferDate { get; set; }
    public string? VehicleNo { get; set; }
    public string? Notes { get; set; }
    public DateTime? DispatchedAt { get; set; }
    public DateTime? ReceivedAt { get; set; }
    public string? CancelReason { get; set; }
    public string? CreatedByName { get; set; }
    public DateTime CreatedAt { get; set; }
    public decimal TotalQty { get; set; }
    public int LineCount { get; set; }
    public List<StockTransferLine> Lines { get; set; } = new();
}

public sealed class StockTransferLine
{
    public long Id { get; set; }
    public long VariantId { get; set; }
    public string? Sku { get; set; }
    public string? Description { get; set; }
    public decimal Quantity { get; set; }
    public decimal? FromStock { get; set; }
}

public sealed class TransferInput
{
    public long Id { get; set; }
    public long FromWarehouseId { get; set; }
    public long ToWarehouseId { get; set; }
    public DateTime? Date { get; set; }
    public string? VehicleNo { get; set; }
    public string? Notes { get; set; }
    public List<TransferLineInput> Lines { get; set; } = new();
}
public sealed class TransferLineInput { public long VariantId { get; set; } public decimal Quantity { get; set; } }

public static class TransferStatus
{
    public const string Draft = "DRAFT", Dispatched = "DISPATCHED", InTransit = "IN_TRANSIT", Received = "RECEIVED", Cancelled = "CANCELLED";
}

/// <summary>
/// Showrooms, godowns and the factory, and stock transfers between them. Goods on a dispatched transfer have left
/// the source (not sellable) and join the destination only when received — so totals never double-count.
/// </summary>
public sealed class LocationService(Db db, UserSession session, AuditService audit, InventoryService inventory)
{
    public async Task<IReadOnlyList<Warehouse>> ListAsync(bool includeInactive = false)
    {
        session.DemandAny(Perm.InventoryView, Perm.WarehouseManage, Perm.PurchaseManage, Perm.ProductionView);
        var rows = (await db.QueryAsync<Warehouse>("""
            select w.*, coalesce(sum(ws.on_hand), 0) as units, count(ws.variant_id) filter (where ws.on_hand > 0)::int as products,
                   coalesce(sum(ws.on_hand * coalesce(v.cost_price, p.cost_price)), 0) as stock_value
            from warehouses w
            left join warehouse_stock ws on ws.warehouse_id = w.id
            left join product_variants v on v.id = ws.variant_id left join products p on p.id = v.product_id
            where @includeInactive or w.is_active
            group by w.id order by w.is_default desc, w.name
            """, new { includeInactive })).AsList();
        if (!session.CanSeeCost) rows.ForEach(r => r.StockValue = null);
        return rows;
    }

    public async Task<long> SaveAsync(Warehouse w)
    {
        session.Demand(Perm.WarehouseManage);
        var v = new ValidationBuilder().Require(w.Name, nameof(w.Name), "Name").Require(w.Code, nameof(w.Code), "Code")
            .Check(w.Kind is "SHOWROOM" or "WAREHOUSE" or "FACTORY", nameof(w.Kind), "Choose showroom, warehouse or factory.");
        v.ThrowIfInvalid();
        return await db.InTransactionAsync(async (conn, tx) =>
        {
            var dup = await conn.ExecuteScalarAsync<long?>("select id from warehouses where lower(code) = lower(@Code) and id <> @Id", w, tx);
            if (dup is not null) throw new ValidationException("Code", "Another location already uses this code.");
            long id;
            if (w.Id == 0)
                id = await conn.ExecuteScalarAsync<long>("insert into warehouses (code, name, kind, address, is_active) values (upper(@Code), @Name, @Kind, @Address, true) returning id", w, tx);
            else
            {
                var cur = await conn.QuerySingleOrDefaultAsync<Warehouse>("select * from warehouses where id = @Id for update", w, tx) ?? throw new NotFoundException("Location", w.Id);
                if (cur.IsDefault && !w.IsActive) throw new BusinessRuleException("The default location cannot be deactivated. Make another location the default first.");
                if (!w.IsActive && await conn.ExecuteScalarAsync<bool>("select exists(select 1 from warehouse_stock where warehouse_id = @Id and (on_hand <> 0 or damaged <> 0))", w, tx))
                    throw new BusinessRuleException("This location still holds stock. Transfer it out before deactivating.");
                await conn.ExecuteAsync("update warehouses set code = upper(@Code), name = @Name, kind = @Kind, address = @Address, is_active = @IsActive where id = @Id", w, tx);
                id = w.Id;
            }
            if (w.IsDefault)
            {
                await conn.ExecuteAsync("update warehouses set is_default = false where is_default and id <> @id", new { id }, tx);
                await conn.ExecuteAsync("update warehouses set is_default = true, is_active = true where id = @id", new { id }, tx);
            }
            await audit.LogAsync(conn, tx, w.Id == 0 ? "CREATE" : "UPDATE", "Inventory", $"saved location {w.Name}", "warehouse", id, w.Code);
            return id;
        });
    }

    /// <summary>Stock per location (with goods in transit towards each location).</summary>
    public async Task<IReadOnlyList<LocationStockRow>> StockAsync(long? warehouseId, long? variantId, string? search, int limit = 500)
    {
        session.Demand(Perm.InventoryView);
        return (await db.QueryAsync<LocationStockRow>("""
            with transit as (
                select t.to_warehouse_id as warehouse_id, i.variant_id, sum(i.quantity) as qty
                from stock_transfers t join stock_transfer_items i on i.transfer_id = t.id
                where t.status in ('DISPATCHED','IN_TRANSIT') group by 1, 2)
            select w.id as warehouse_id, w.name as warehouse_name, v.id as variant_id, v.sku, p.name as product_name,
                   nullif(v.variant_name, 'Standard') as variant_name, coalesce(ws.on_hand, 0) as on_hand, coalesce(ws.damaged, 0) as damaged,
                   coalesce(tr.qty, 0) as in_transit
            from warehouses w
            cross join product_variants v join products p on p.id = v.product_id and p.is_stock_item and not p.is_deleted
            left join warehouse_stock ws on ws.warehouse_id = w.id and ws.variant_id = v.id
            left join transit tr on tr.warehouse_id = w.id and tr.variant_id = v.id
            where w.is_active and not v.is_deleted
              and (@warehouseId::bigint is null or w.id = @warehouseId)
              and (@variantId::bigint is null or v.id = @variantId)
              and (@search::text is null or p.name ilike '%' || @search || '%' or v.sku ilike '%' || @search || '%')
              and (coalesce(ws.on_hand, 0) <> 0 or coalesce(ws.damaged, 0) <> 0 or coalesce(tr.qty, 0) <> 0 or @variantId::bigint is not null)
            order by p.name, v.sku, w.is_default desc, w.name
            limit @limit
            """, new { warehouseId, variantId, search = string.IsNullOrWhiteSpace(search) ? null : search.Trim(), limit })).AsList();
    }

    // ------------------------------------------------------------------ transfers
    private const string TransferSelect = """
        select t.*, f.name as from_name, d.name as to_name, u.full_name as created_by_name,
               (select coalesce(sum(quantity), 0) from stock_transfer_items where transfer_id = t.id) as total_qty,
               (select count(*) from stock_transfer_items where transfer_id = t.id)::int as line_count
        from stock_transfers t join warehouses f on f.id = t.from_warehouse_id join warehouses d on d.id = t.to_warehouse_id
        left join users u on u.id = t.created_by
        """;

    public async Task<PagedResult<StockTransfer>> TransfersAsync(ListQuery q)
    {
        session.DemandAny(Perm.InventoryView, Perm.WarehouseManage);
        var where = """
            where (@Status::text is null or t.status = @Status or (@Status = 'OPEN' and t.status in ('DRAFT','DISPATCHED','IN_TRANSIT')))
              and (@Search::text is null or t.number ilike '%' || @Search || '%' or f.name ilike '%' || @Search || '%' or d.name ilike '%' || @Search || '%')
            """;
        var args = new { q.Status, Search = string.IsNullOrWhiteSpace(q.Search) ? null : q.Search.Trim(), q.PageSize, q.Offset };
        await using var conn = await db.OpenAsync();
        var total = await conn.ExecuteScalarAsync<int>($"select count(*) from stock_transfers t join warehouses f on f.id = t.from_warehouse_id join warehouses d on d.id = t.to_warehouse_id {where}", args);
        var rows = (await conn.QueryAsync<StockTransfer>($"{TransferSelect} {where} order by t.created_at desc limit @PageSize offset @Offset", args)).AsList();
        return new PagedResult<StockTransfer> { Items = rows, TotalCount = total, Page = q.Page, PageSize = q.PageSize };
    }

    public async Task<StockTransfer> GetTransferAsync(long id)
    {
        session.DemandAny(Perm.InventoryView, Perm.WarehouseManage);
        await using var conn = await db.OpenAsync();
        var t = await conn.QuerySingleOrDefaultAsync<StockTransfer>($"{TransferSelect} where t.id = @id", new { id }) ?? throw new NotFoundException("Transfer", id);
        t.Lines = (await conn.QueryAsync<StockTransferLine>("""
            select i.id, i.variant_id, v.sku, p.name || case when v.variant_name <> 'Standard' then ' — ' || v.variant_name else '' end as description, i.quantity,
                   (select on_hand from warehouse_stock ws where ws.warehouse_id = @from and ws.variant_id = i.variant_id) as from_stock
            from stock_transfer_items i join product_variants v on v.id = i.variant_id join products p on p.id = v.product_id
            where i.transfer_id = @id order by i.id
            """, new { id, from = t.FromWarehouseId })).AsList();
        return t;
    }

    public async Task<long> SaveTransferAsync(TransferInput input)
    {
        session.Demand(Perm.WarehouseManage);
        if (input.FromWarehouseId == input.ToWarehouseId) throw new ValidationException("ToWarehouseId", "Choose two different locations.");
        var lines = input.Lines.Where(l => l.Quantity > 0).GroupBy(l => l.VariantId).Select(g => new TransferLineInput { VariantId = g.Key, Quantity = g.Sum(x => x.Quantity) }).ToList();
        if (lines.Count == 0) throw new ValidationException("Lines", "Add at least one product with a quantity.");
        return await db.InTransactionAsync(async (conn, tx) =>
        {
            foreach (var wid in new[] { input.FromWarehouseId, input.ToWarehouseId })
                if (!await conn.ExecuteScalarAsync<bool>("select exists(select 1 from warehouses where id = @wid and is_active)", new { wid }, tx))
                    throw new ValidationException("FromWarehouseId", "Choose active locations.");
            long id; string number;
            if (input.Id == 0)
            {
                number = await SequenceService.NextAsync(conn, tx, DocType.Transfer);
                id = await conn.ExecuteScalarAsync<long>("""
                    insert into stock_transfers (number, from_warehouse_id, to_warehouse_id, transfer_date, vehicle_no, notes, created_by)
                    values (@number, @FromWarehouseId, @ToWarehouseId, coalesce(@Date, current_date), @VehicleNo, @Notes, @uid) returning id
                    """, new { number, input.FromWarehouseId, input.ToWarehouseId, input.Date, input.VehicleNo, input.Notes, uid = session.UserId }, tx);
            }
            else
            {
                var cur = await conn.QuerySingleOrDefaultAsync<StockTransfer>("select * from stock_transfers where id = @Id for update", input, tx) ?? throw new NotFoundException("Transfer", input.Id);
                if (cur.Status != TransferStatus.Draft) throw new BusinessRuleException("Only draft transfers can be edited.");
                await conn.ExecuteAsync("""
                    update stock_transfers set from_warehouse_id = @FromWarehouseId, to_warehouse_id = @ToWarehouseId, transfer_date = coalesce(@Date, transfer_date),
                        vehicle_no = @VehicleNo, notes = @Notes where id = @Id
                    """, input, tx);
                await conn.ExecuteAsync("delete from stock_transfer_items where transfer_id = @Id", input, tx);
                id = input.Id; number = cur.Number;
            }
            foreach (var l in lines)
            {
                if (!await InventoryService.IsStockItemAsync(conn, tx, l.VariantId)) throw new BusinessRuleException("Only stock items can be transferred.");
                await conn.ExecuteAsync("insert into stock_transfer_items (transfer_id, variant_id, quantity) values (@id, @VariantId, @Quantity)", new { id, l.VariantId, l.Quantity }, tx);
            }
            await audit.LogAsync(conn, tx, input.Id == 0 ? "CREATE" : "UPDATE", "Inventory", $"saved stock transfer {number}", "transfer", id, number);
            return id;
        });
    }

    public async Task DispatchAsync(long id)
    {
        session.Demand(Perm.WarehouseManage);
        await db.InTransactionAsync(async (conn, tx) =>
        {
            var t = await LockAsync(conn, tx, id);
            if (t.Status != TransferStatus.Draft) throw new BusinessRuleException("Only draft transfers can be dispatched.");
            var lines = await conn.QueryAsync<StockTransferLine>("select * from stock_transfer_items where transfer_id = @id", new { id }, tx);
            foreach (var l in lines)
                await inventory.ApplyAsync(conn, tx, l.VariantId, MovementType.TransferOut, -l.Quantity, 0, 0, DocType.Transfer, id, t.Number,
                    $"To {await NameAsync(conn, tx, t.ToWarehouseId)}", null, t.FromWarehouseId);
            await conn.ExecuteAsync("update stock_transfers set status = 'DISPATCHED', dispatched_at = now() where id = @id", new { id }, tx);
            await SalesDocumentBuilder.AddStatusHistoryAsync(conn, tx, DocType.Transfer, id, t.Status, TransferStatus.Dispatched, null, session.UserId);
            await audit.LogAsync(conn, tx, "DISPATCH", "Inventory", $"dispatched stock transfer {t.Number}", "transfer", id, t.Number);
        });
    }

    public async Task MarkInTransitAsync(long id)
    {
        session.Demand(Perm.WarehouseManage);
        await db.InTransactionAsync(async (conn, tx) =>
        {
            var t = await LockAsync(conn, tx, id);
            if (t.Status != TransferStatus.Dispatched) throw new BusinessRuleException("Only dispatched transfers can be marked in transit.");
            await conn.ExecuteAsync("update stock_transfers set status = 'IN_TRANSIT' where id = @id", new { id }, tx);
            await SalesDocumentBuilder.AddStatusHistoryAsync(conn, tx, DocType.Transfer, id, t.Status, TransferStatus.InTransit, null, session.UserId);
        });
    }

    public async Task ReceiveAsync(long id)
    {
        session.Demand(Perm.WarehouseManage);
        await db.InTransactionAsync(async (conn, tx) =>
        {
            var t = await LockAsync(conn, tx, id);
            if (t.Status is not (TransferStatus.Dispatched or TransferStatus.InTransit)) throw new BusinessRuleException("Only dispatched transfers can be received.");
            var lines = await conn.QueryAsync<StockTransferLine>("select * from stock_transfer_items where transfer_id = @id", new { id }, tx);
            foreach (var l in lines)
                await inventory.ApplyAsync(conn, tx, l.VariantId, MovementType.TransferIn, l.Quantity, 0, 0, DocType.Transfer, id, t.Number,
                    $"From {await NameAsync(conn, tx, t.FromWarehouseId)}", null, t.ToWarehouseId);
            await conn.ExecuteAsync("update stock_transfers set status = 'RECEIVED', received_at = now() where id = @id", new { id }, tx);
            await SalesDocumentBuilder.AddStatusHistoryAsync(conn, tx, DocType.Transfer, id, t.Status, TransferStatus.Received, null, session.UserId);
            await audit.LogAsync(conn, tx, "RECEIVE", "Inventory", $"received stock transfer {t.Number}", "transfer", id, t.Number);
        });
    }

    /// <summary>Cancelling a dispatched transfer returns the goods to the source location.</summary>
    public async Task CancelTransferAsync(long id, string reason)
    {
        session.Demand(Perm.WarehouseManage);
        if (string.IsNullOrWhiteSpace(reason)) throw new ValidationException("Reason", "Enter the reason for cancelling.");
        await db.InTransactionAsync(async (conn, tx) =>
        {
            var t = await LockAsync(conn, tx, id);
            if (t.Status is TransferStatus.Received or TransferStatus.Cancelled) throw new BusinessRuleException("This transfer is closed.");
            if (t.Status is TransferStatus.Dispatched or TransferStatus.InTransit)
            {
                var lines = await conn.QueryAsync<StockTransferLine>("select * from stock_transfer_items where transfer_id = @id", new { id }, tx);
                foreach (var l in lines)
                    await inventory.ApplyAsync(conn, tx, l.VariantId, MovementType.TransferIn, l.Quantity, 0, 0, DocType.Transfer, id, t.Number,
                        $"Transfer cancelled: {reason}", null, t.FromWarehouseId);
            }
            await conn.ExecuteAsync("update stock_transfers set status = 'CANCELLED', cancel_reason = @reason where id = @id", new { id, reason }, tx);
            await SalesDocumentBuilder.AddStatusHistoryAsync(conn, tx, DocType.Transfer, id, t.Status, TransferStatus.Cancelled, reason, session.UserId);
            await audit.LogAsync(conn, tx, "CANCEL", "Inventory", $"cancelled stock transfer {t.Number} — {reason}", "transfer", id, t.Number);
        });
    }

    public Task<IReadOnlyList<StatusHistoryEntry>> TransferHistoryAsync(long id) => History.ForAsync(db, DocType.Transfer, id);

    private static async Task<StockTransfer> LockAsync(Npgsql.NpgsqlConnection conn, Npgsql.NpgsqlTransaction tx, long id) =>
        await conn.QuerySingleOrDefaultAsync<StockTransfer>("select * from stock_transfers where id = @id for update", new { id }, tx) ?? throw new NotFoundException("Transfer", id);

    private static Task<string> NameAsync(Npgsql.NpgsqlConnection conn, Npgsql.NpgsqlTransaction tx, long id) =>
        conn.ExecuteScalarAsync<string>("select name from warehouses where id = @id", new { id }, tx)!;
}
