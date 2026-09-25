using Dapper;
using FurniShop.Core;
using FurniShop.Core.Domain;
using FurniShop.Core.Security;
using FurniShop.Infrastructure.Database;
using FurniShop.Infrastructure.Security;
using Npgsql;

namespace FurniShop.Infrastructure.Services;

public sealed record StockLevels(decimal OnHand, decimal Reserved, decimal Damaged)
{
    public decimal Available => OnHand - Reserved;
}

public sealed class ReservedStockRow
{
    public long SalesOrderId { get; set; }
    public string SalesOrderNumber { get; set; } = "";
    public string CustomerName { get; set; } = "";
    public string Status { get; set; } = "";
    public DateTime OrderDate { get; set; }
    public DateTime? ExpectedDeliveryDate { get; set; }
    public long VariantId { get; set; }
    public string Sku { get; set; } = "";
    public string ProductName { get; set; } = "";
    public decimal ReservedQty { get; set; }
}

/// <summary>
/// The only place where stock quantities change. Every change writes an immutable movement row
/// with the resulting balances, inside the caller's transaction.
/// Stock model per variant: on_hand (physical sellable, includes reserved), reserved, damaged.
/// Available = on_hand − reserved; reserved stock is never sold to anyone else.
/// </summary>
public sealed class InventoryService(Db db, UserSession session, AuditService audit, SettingsService settings)
{
    internal async Task<StockLevels> ApplyAsync(NpgsqlConnection conn, NpgsqlTransaction tx, long variantId, string movementType,
        decimal onHandDelta, decimal reservedDelta, decimal damagedDelta, string? refType, long? refId, string? refNumber,
        string? note = null, decimal? unitCost = null)
    {
        var allowNegative = (await SettingsService.LoadAsync(conn, tx)).Inventory.AllowNegativeStock;

        await conn.ExecuteAsync("insert into inventory (variant_id) values (@variantId) on conflict do nothing", new { variantId }, tx);
        var cur = await conn.QuerySingleAsync<(decimal OnHand, decimal Reserved, decimal Damaged)>(
            "select on_hand, reserved, damaged from inventory where variant_id = @variantId for update", new { variantId }, tx);

        var onHand = cur.OnHand + onHandDelta;
        var reserved = cur.Reserved + reservedDelta;
        var damaged = cur.Damaged + damagedDelta;
        var label = await conn.ExecuteScalarAsync<string>(
            "select p.name || case when v.variant_name <> 'Standard' then ' — ' || v.variant_name else '' end || ' (' || v.sku || ')' from product_variants v join products p on p.id = v.product_id where v.id = @variantId",
            new { variantId }, tx) ?? $"variant {variantId}";

        if (reserved < 0) throw new BusinessRuleException($"Cannot release more stock than is reserved for {label}.");
        if (damaged < 0) throw new BusinessRuleException($"Only {cur.Damaged:0.##} damaged unit(s) of {label} are recorded.");
        if (reservedDelta > 0 && reserved > onHand)
            throw new BusinessRuleException($"Only {Math.Max(0, cur.OnHand - cur.Reserved):0.##} unit(s) of {label} are available to reserve.");
        if (onHandDelta < 0 && onHand < reserved && reserved > 0 && movementType != MovementType.ReservedSaleOut)
            throw new BusinessRuleException($"Only {Math.Max(0, cur.OnHand - cur.Reserved):0.##} unit(s) of {label} are available — the rest is reserved for other customers.");
        if (onHand < 0 && !allowNegative)
            throw new BusinessRuleException($"Insufficient stock for {label}. Available: {Math.Max(0, cur.OnHand - cur.Reserved):0.##}.");

        await conn.ExecuteAsync("""
            update inventory set on_hand = @onHand, reserved = @reserved, damaged = @damaged, updated_at = now() where variant_id = @variantId
            """, new { onHand, reserved, damaged, variantId }, tx);

        await conn.ExecuteAsync("""
            insert into inventory_movements (variant_id, movement_type, on_hand_delta, reserved_delta, damaged_delta,
                on_hand_after, reserved_after, damaged_after, unit_cost, ref_type, ref_id, ref_number, note, created_by)
            values (@variantId, @movementType, @onHandDelta, @reservedDelta, @damagedDelta, @onHand, @reserved, @damaged,
                @unitCost, @refType, @refId, @refNumber, @note, @uid)
            """, new { variantId, movementType, onHandDelta, reservedDelta, damagedDelta, onHand, reserved, damaged, unitCost, refType, refId, refNumber, note, uid = session.UserId }, tx);

        if (onHandDelta < 0 || reservedDelta > 0)
        {
            var min = await conn.ExecuteScalarAsync<decimal>(
                "select coalesce(v.min_stock, p.min_stock) from product_variants v join products p on p.id = v.product_id where v.id = @variantId", new { variantId }, tx);
            var available = onHand - reserved;
            if (available <= min)
                await conn.ExecuteAsync("""
                    insert into notifications (kind, title, message, ref_type, ref_id)
                    values (@kind, @title, @message, 'VARIANT', @variantId)
                    """, new
                {
                    kind = available <= 0 ? "OUT_OF_STOCK" : "LOW_STOCK",
                    title = available <= 0 ? "Out of stock" : "Low stock",
                    message = $"{label}: {available:0.##} available (minimum {min:0.##}).", variantId,
                }, tx);
        }
        return new StockLevels(onHand, reserved, damaged);
    }

    internal static Task<bool> IsStockItemAsync(NpgsqlConnection conn, NpgsqlTransaction tx, long variantId) =>
        conn.ExecuteScalarAsync<bool>("select p.is_stock_item from product_variants v join products p on p.id = v.product_id where v.id = @variantId", new { variantId }, tx);

    public async Task<StockLevels> LevelsAsync(long variantId)
    {
        var r = await db.QuerySingleOrDefaultAsync<(decimal OnHand, decimal Reserved, decimal Damaged)>(
            "select on_hand, reserved, damaged from inventory where variant_id = @variantId", new { variantId });
        return new StockLevels(r.OnHand, r.Reserved, r.Damaged);
    }

    /// <param name="state">null, LOW, OUT, RESERVED, DAMAGED, IN_STOCK</param>
    public async Task<PagedResult<InventoryRow>> ListAsync(ListQuery q, string? state = null)
    {
        session.DemandAny(Perm.InventoryView, Perm.ProductView);
        var where = """
            where is_stock_item
              and (@Search::text is null or product_name ilike '%' || @Search || '%' or sku ilike '%' || @Search || '%'
                   or barcode = @Search or variant_name ilike '%' || @Search || '%')
              and (@CategoryId::bigint is null or category_id = @CategoryId)
              and (@ProductId::bigint is null or product_id = @ProductId)
              and (@State::text is null
                   or (@State = 'LOW' and available > 0 and available <= min_stock)
                   or (@State = 'OUT' and available <= 0)
                   or (@State = 'RESERVED' and reserved > 0)
                   or (@State = 'DAMAGED' and damaged > 0)
                   or (@State = 'IN_STOCK' and available > 0))
            """;
        var order = q.SortBy switch
        {
            "available" => "available", "on_hand" => "on_hand", "reserved" => "reserved", "value" => "on_hand * cost_price",
            "sku" => "sku", "category" => "category_name", _ => "product_name",
        };
        var args = new { Search = Blank(q.Search), q.CategoryId, q.ProductId, State = state, q.PageSize, q.Offset };
        await using var conn = await db.OpenAsync();
        var total = await conn.ExecuteScalarAsync<int>($"select count(*) from v_inventory {where}", args);
        var rows = (await conn.QueryAsync<InventoryRow>(
            $"select * from v_inventory {where} order by {order} {(q.SortDescending && q.SortBy is not null ? "desc" : "asc")}, sku limit @PageSize offset @Offset", args)).AsList();
        if (!session.CanSeeCost) rows.ForEach(r => r.CostPrice = null);
        return new PagedResult<InventoryRow> { Items = rows, TotalCount = total, Page = q.Page, PageSize = q.PageSize };
    }

    public async Task<PagedResult<InventoryMovement>> MovementsAsync(ListQuery q, long? variantId = null, string? movementType = null)
    {
        session.Demand(Perm.InventoryView);
        var where = """
            where (@VariantId::bigint is null or m.variant_id = @VariantId)
              and (@Type::text is null or m.movement_type = @Type)
              and (@From::date is null or m.created_at >= @From::date)
              and (@To::date is null or m.created_at < @To::date + 1)
              and (@Search::text is null or v.sku ilike '%' || @Search || '%' or p.name ilike '%' || @Search || '%' or m.ref_number ilike '%' || @Search || '%')
            """;
        var args = new { VariantId = variantId, Type = movementType, q.From, q.To, Search = Blank(q.Search), q.PageSize, q.Offset };
        const string from = "from inventory_movements m join product_variants v on v.id = m.variant_id join products p on p.id = v.product_id left join users u on u.id = m.created_by";
        await using var conn = await db.OpenAsync();
        var total = await conn.ExecuteScalarAsync<int>($"select count(*) {from} {where}", args);
        var rows = (await conn.QueryAsync<InventoryMovement>($"""
            select m.*, v.sku, p.name || case when v.variant_name <> 'Standard' then ' — ' || v.variant_name else '' end as product_name,
                   u.full_name as created_by_name
            {from} {where} order by m.created_at desc, m.id desc limit @PageSize offset @Offset
            """, args)).AsList();
        if (!session.CanSeeCost) rows.ForEach(r => r.UnitCost = null);
        return new PagedResult<InventoryMovement> { Items = rows, TotalCount = total, Page = q.Page, PageSize = q.PageSize };
    }

    public Task<IReadOnlyList<ReservedStockRow>> ReservedAsync()
    {
        session.Demand(Perm.InventoryView);
        return db.QueryAsync<ReservedStockRow>("""
            select so.id as sales_order_id, so.number as sales_order_number, c.name as customer_name, so.status, so.order_date,
                   so.expected_delivery_date, i.variant_id, v.sku,
                   p.name || case when v.variant_name <> 'Standard' then ' — ' || v.variant_name else '' end as product_name,
                   i.reserved_qty
            from sales_order_items i
            join sales_orders so on so.id = i.sales_order_id
            join customers c on c.id = so.customer_id
            join product_variants v on v.id = i.variant_id
            join products p on p.id = v.product_id
            where i.reserved_qty > 0
            order by so.expected_delivery_date nulls last, so.order_date
            """);
    }

    public async Task<string> AdjustAsync(StockAdjustmentInput input)
    {
        session.Demand(Perm.InventoryAdjust);
        if (input.Quantity <= 0) throw new ValidationException("Quantity", "Quantity must be greater than zero.");
        if (string.IsNullOrWhiteSpace(input.Reason)) throw new ValidationException("Reason", "Enter a reason for the adjustment.");

        return await db.InTransactionAsync(async (conn, tx) =>
        {
            if (!await IsStockItemAsync(conn, tx, input.VariantId))
                throw new BusinessRuleException("This product is not tracked in inventory (made to order).");
            var number = await SequenceService.NextAsync(conn, tx, DocType.Adjustment);
            var id = await conn.ExecuteScalarAsync<long>("""
                insert into stock_adjustments (number, variant_id, adjustment_type, quantity, reason, created_by)
                values (@number, @VariantId, @AdjustmentType, @Quantity, @Reason, @uid) returning id
                """, new { number, input.VariantId, input.AdjustmentType, input.Quantity, Reason = input.Reason.Trim(), uid = session.UserId }, tx);

            var q = input.Quantity;
            StockLevels after;
            switch (input.AdjustmentType)
            {
                case AdjustmentType.Increase:
                    after = await ApplyAsync(conn, tx, input.VariantId, MovementType.AdjustmentIn, q, 0, 0, DocType.Adjustment, id, number, input.Reason, input.UnitCost);
                    break;
                case AdjustmentType.Decrease:
                    after = await ApplyAsync(conn, tx, input.VariantId, MovementType.AdjustmentOut, -q, 0, 0, DocType.Adjustment, id, number, input.Reason);
                    break;
                case AdjustmentType.MarkDamaged:
                    after = await ApplyAsync(conn, tx, input.VariantId, MovementType.Damage, -q, 0, q, DocType.Adjustment, id, number, input.Reason);
                    break;
                case AdjustmentType.DamageRepaired:
                    after = await ApplyAsync(conn, tx, input.VariantId, MovementType.DamageRepaired, q, 0, -q, DocType.Adjustment, id, number, input.Reason);
                    break;
                case AdjustmentType.DamageWriteOff:
                    after = await ApplyAsync(conn, tx, input.VariantId, MovementType.DamageWriteOff, 0, 0, -q, DocType.Adjustment, id, number, input.Reason);
                    break;
                case AdjustmentType.SetDisplay:
                    var onHand = await conn.ExecuteScalarAsync<decimal>("select on_hand from inventory where variant_id = @VariantId for update", input, tx);
                    if (q > onHand) throw new BusinessRuleException("Display quantity cannot exceed stock on hand.");
                    await conn.ExecuteAsync("update inventory set display_qty = @q where variant_id = @VariantId", new { q, input.VariantId }, tx);
                    after = await ApplyAsync(conn, tx, input.VariantId, MovementType.Display, 0, 0, 0, DocType.Adjustment, id, number, $"Display qty set to {q:0.##}. {input.Reason}");
                    break;
                default:
                    throw new ValidationException("AdjustmentType", "Unknown adjustment type.");
            }
            await audit.LogAsync(conn, tx, "ADJUST", "Inventory", $"adjusted stock ({input.AdjustmentType} {q:0.##}) — {input.Reason}",
                "variant", input.VariantId, number, null, new { input.AdjustmentType, input.Quantity, input.Reason, after.OnHand, after.Reserved, after.Damaged });
            return number;
        });
    }

    public async Task<decimal> StockValueAsync()
    {
        session.Demand(Perm.CostView);
        return await db.ScalarAsync<decimal>("select coalesce(sum(greatest(on_hand,0) * cost_price),0) from v_inventory where is_stock_item");
    }

    private static string? Blank(string? s) => string.IsNullOrWhiteSpace(s) ? null : s.Trim();
}
