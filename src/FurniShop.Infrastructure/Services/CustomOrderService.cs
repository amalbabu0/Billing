using Dapper;
using FurniShop.Core;
using FurniShop.Core.Domain;
using FurniShop.Core.Security;
using FurniShop.Infrastructure.Database;
using FurniShop.Infrastructure.Security;

namespace FurniShop.Infrastructure.Services;

/// <summary>
/// Made-to-order furniture: Received → Production → Quality check → Ready → Delivery → Installation → Completed.
/// Advances are allocated to the custom order and move to the invoice generated from it.
/// </summary>
public sealed class CustomOrderService(Db db, UserSession session, AuditService audit, InvoiceService invoices, PaymentService payments)
{
    public async Task<long> SaveAsync(CustomOrder o)
    {
        session.Demand(Perm.CustomOrderManage);
        new Core.Validation.ValidationBuilder()
            .Check(o.CustomerId > 0, nameof(o.CustomerId), "Select a customer.")
            .Require(o.ProductType, nameof(o.ProductType), "Product type")
            .Check(o.EstimatedCost >= 0 && o.FinalPrice >= 0 && (o.ProductionCost ?? 0) >= 0, nameof(o.EstimatedCost), "Amounts cannot be negative.")
            .Check(o.EstimatedCost > 0 || o.FinalPrice > 0, nameof(o.EstimatedCost), "Enter the estimated cost or final price.")
            .Check(o.Width is null or > 0 && o.Height is null or > 0 && o.Depth is null or > 0, nameof(o.Width), "Dimensions must be positive.")
            .Check(o.Doors is null or >= 0 && o.Drawers is null or >= 0, nameof(o.Doors), "Doors / drawers cannot be negative.")
            .Check(o.GstRate is >= 0 and <= 100, nameof(o.GstRate), "GST rate must be 0–100.")
            .Check(o.DimensionUnit is "ft" or "in" or "cm" or "mm", nameof(o.DimensionUnit), "Unit must be ft, in, cm or mm.")
            .ThrowIfInvalid();

        return await db.InTransactionAsync(async (conn, tx) =>
        {
            var walkIn = await conn.ExecuteScalarAsync<bool>("select is_walk_in from customers where id = @CustomerId", o, tx);
            if (walkIn) throw new BusinessRuleException("Custom orders need a customer profile (name and mobile) — not the walk-in customer.");
            var canCost = session.CanSeeCost;
            CustomOrder? old = null;
            if (o.Id == 0)
            {
                o.Number = await SequenceService.NextAsync(conn, tx, DocType.CustomOrder, o.OrderDate);
                o.Id = await conn.ExecuteScalarAsync<long>("""
                    insert into custom_orders (number, customer_id, order_date, product_type, design, width, height, depth, dimension_unit, material, color,
                        fabric, finish, doors, drawers, special_requirements, reference_attachment_id, estimated_cost, final_price, production_cost,
                        hsn_code, gst_rate, price_includes_gst, expected_completion_date, status, requires_installation, delivery_address, notes, created_by)
                    values (@Number, @CustomerId, @OrderDate, @ProductType, @Design, @Width, @Height, @Depth, @DimensionUnit, @Material, @Color,
                        @Fabric, @Finish, @Doors, @Drawers, @SpecialRequirements, @ReferenceAttachmentId, @EstimatedCost, @FinalPrice, @ProductionCost,
                        @HsnCode, @GstRate, @PriceIncludesGst, @ExpectedCompletionDate, 'RECEIVED', @RequiresInstallation, @DeliveryAddress, @Notes, @Uid)
                    returning id
                    """, Params(o, canCost ? o.ProductionCost ?? 0 : 0), tx);
                await SalesDocumentBuilder.AddStatusHistoryAsync(conn, tx, DocType.CustomOrder, o.Id, null, CustomOrderStatus.Received, "Order received", session.UserId);
            }
            else
            {
                old = await conn.QuerySingleOrDefaultAsync<CustomOrder>("select * from custom_orders where id = @Id for update", o, tx)
                      ?? throw new NotFoundException("Custom order", o.Id);
                if (old.InvoiceId.HasValue) throw new BusinessRuleException("The order has been invoiced; it can no longer be edited.");
                if (old.Status is CustomOrderStatus.Completed or CustomOrderStatus.Cancelled) throw new BusinessRuleException("This order is closed.");
                if (old.CustomerId != o.CustomerId) throw new BusinessRuleException("The customer of a custom order cannot be changed.");
                await conn.ExecuteAsync("""
                    update custom_orders set product_type=@ProductType, design=@Design, width=@Width, height=@Height, depth=@Depth,
                        dimension_unit=@DimensionUnit, material=@Material, color=@Color, fabric=@Fabric, finish=@Finish, doors=@Doors, drawers=@Drawers,
                        special_requirements=@SpecialRequirements, reference_attachment_id=@ReferenceAttachmentId, estimated_cost=@EstimatedCost,
                        final_price=@FinalPrice, production_cost=@ProductionCost, hsn_code=@HsnCode, gst_rate=@GstRate,
                        price_includes_gst=@PriceIncludesGst, expected_completion_date=@ExpectedCompletionDate,
                        requires_installation=@RequiresInstallation, delivery_address=@DeliveryAddress, notes=@Notes, updated_at=now()
                    where id=@Id
                    """, Params(o, canCost ? o.ProductionCost ?? old.ProductionCost ?? 0 : old.ProductionCost ?? 0), tx);
            }
            await audit.LogAsync(conn, tx, old is null ? "CREATE" : "UPDATE", "Custom Orders",
                $"{(old is null ? "created" : "updated")} custom order {o.Number} ({o.ProductType}) — {Money.Format(o.FinalPrice > 0 ? o.FinalPrice : o.EstimatedCost)}",
                "custom_order", o.Id, o.Number, old is null ? null : new { old.EstimatedCost, old.FinalPrice, old.ExpectedCompletionDate },
                new { o.EstimatedCost, o.FinalPrice, o.ExpectedCompletionDate });
            return o.Id;
        });
    }

    private object Params(CustomOrder o, decimal productionCost) => new
    {
        o.Id, o.Number, o.CustomerId, OrderDate = o.OrderDate.Date, ProductType = o.ProductType.Trim(), o.Design, o.Width, o.Height, o.Depth, o.DimensionUnit,
        o.Material, o.Color, o.Fabric, o.Finish, o.Doors, o.Drawers, o.SpecialRequirements, o.ReferenceAttachmentId, o.EstimatedCost, o.FinalPrice,
        ProductionCost = productionCost, o.HsnCode, o.GstRate, o.PriceIncludesGst, o.ExpectedCompletionDate, o.RequiresInstallation,
        o.DeliveryAddress, o.Notes, Uid = session.UserId,
    };

    /// <summary>Moves the order to the next production stage (Installation is skipped when not required).</summary>
    public async Task<string> AdvanceAsync(long id, string? note = null)
    {
        session.Demand(Perm.CustomOrderManage);
        return await db.InTransactionAsync(async (conn, tx) =>
        {
            var o = await conn.QuerySingleOrDefaultAsync<CustomOrder>("select * from custom_orders where id = @id for update", new { id }, tx)
                    ?? throw new NotFoundException("Custom order", id);
            var next = CustomOrderStatus.Next(o.Status, o.RequiresInstallation)
                       ?? throw new BusinessRuleException("This order is already complete.");
            if (o.Status == CustomOrderStatus.Cancelled) throw new BusinessRuleException("This order is cancelled.");
            if (next == CustomOrderStatus.Delivery)
                throw new BusinessRuleException("Create the delivery from the order (Schedule delivery) — the status updates automatically.");
            if (o.Status is CustomOrderStatus.Delivery)
                throw new BusinessRuleException("Complete the delivery in the Delivery module (with proof) — the status updates automatically.");
            if (o.Status is CustomOrderStatus.Installation)
                throw new BusinessRuleException("Complete the installation job in Installation — the status updates automatically.");
            if (next == CustomOrderStatus.Ready && o.FinalPrice <= 0)
                throw new BusinessRuleException("Enter the final price before marking the order ready.");
            await conn.ExecuteAsync("update custom_orders set status = @next, updated_at = now() where id = @id", new { next, id }, tx);
            await SalesDocumentBuilder.AddStatusHistoryAsync(conn, tx, DocType.CustomOrder, id, o.Status, next, note, session.UserId);
            await audit.LogAsync(conn, tx, "STATUS", "Custom Orders", $"moved custom order {o.Number} to {StatusStyle.Label(next)}", "custom_order", id, o.Number,
                new { o.Status }, new { Status = next, Note = note });
            return next;
        });
    }

    public async Task CancelAsync(long id, string reason)
    {
        session.Demand(Perm.CustomOrderManage);
        if (string.IsNullOrWhiteSpace(reason)) throw new ValidationException("Reason", "Enter the reason for cancelling.");
        await db.InTransactionAsync(async (conn, tx) =>
        {
            var o = await conn.QuerySingleOrDefaultAsync<CustomOrder>("select * from custom_orders where id = @id for update", new { id }, tx)
                    ?? throw new NotFoundException("Custom order", id);
            if (o.InvoiceId.HasValue) throw new BusinessRuleException("The order has been invoiced — cancel the invoice first.");
            if (o.Status is CustomOrderStatus.Completed or CustomOrderStatus.Cancelled) throw new BusinessRuleException("This order is closed.");
            var paid = await PaymentService.PaidAsync(conn, tx, DocType.CustomOrder, id);
            if (paid > 0)
                await payments.TransferAsync(conn, tx, o.CustomerId, DocType.CustomOrder, id, DocType.OnAccount, null, paid, $"Custom order {o.Number} cancelled — advance kept on account");
            await conn.ExecuteAsync("update custom_orders set status = 'CANCELLED', cancel_reason = @reason, updated_at = now() where id = @id", new { reason, id }, tx);
            await conn.ExecuteAsync("update deliveries set status = 'CANCELLED' where custom_order_id = @id and status <> 'DELIVERED'", new { id }, tx);
            await SalesDocumentBuilder.AddStatusHistoryAsync(conn, tx, DocType.CustomOrder, id, o.Status, CustomOrderStatus.Cancelled, reason, session.UserId);
            await audit.LogAsync(conn, tx, "CANCEL", "Custom Orders", $"cancelled custom order {o.Number} — {reason} (advance {Money.Format(paid)} kept on account)", "custom_order", id, o.Number);
        });
    }

    /// <summary>Generates the GST invoice for the custom order (one line, not a stock item) and applies the advance.</summary>
    public async Task<CheckoutResult> GenerateInvoiceAsync(long id, IReadOnlyList<PaymentLineInput> paymentLines)
    {
        session.Demand(Perm.InvoiceCreate);
        return await db.InTransactionAsync(async (conn, tx) =>
        {
            var o = await conn.QuerySingleOrDefaultAsync<CustomOrder>("select * from custom_orders where id = @id for update", new { id }, tx)
                    ?? throw new NotFoundException("Custom order", id);
            if (o.InvoiceId.HasValue) throw new BusinessRuleException("This order has already been invoiced.");
            if (o.Status is CustomOrderStatus.Received or CustomOrderStatus.Production or CustomOrderStatus.QualityCheck or CustomOrderStatus.Cancelled)
                throw new BusinessRuleException("The order can be invoiced once it is Ready.");
            if (o.FinalPrice <= 0) throw new BusinessRuleException("Enter the final price first.");
            var s = await SettingsService.LoadAsync(conn, tx);
            var input = new SalesDocumentInput
            {
                CustomerId = o.CustomerId, Date = DateTime.Today, CustomOrderId = id, DeliveryAddress = o.DeliveryAddress,
                RequiresDelivery = true, RequiresInstallation = o.RequiresInstallation, Notes = $"Custom order {o.Number}",
                Lines =
                {
                    new LineInput
                    {
                        Description = Describe(o), HsnCode = o.HsnCode ?? s.Tax.DefaultHsn, Quantity = 1, UnitPrice = o.FinalPrice,
                        PriceIncludesGst = o.PriceIncludesGst, GstRate = o.GstRate,
                    },
                },
            };
            var invoiceId = await invoices.SaveDraftAsync(conn, tx, input, enforceDiscount: false);
            // Custom lines carry the production cost as their cost for margin reports.
            await conn.ExecuteAsync("update invoice_items set unit_cost = @ProductionCost where invoice_id = @invoiceId", new { o.ProductionCost, invoiceId }, tx);
            return await invoices.FinalizeAsync(conn, tx, invoiceId, paymentLines, 0);
        });
    }

    public static string Describe(CustomOrder o)
    {
        var parts = new List<string> { $"Custom {o.ProductType}" };
        if (!string.IsNullOrWhiteSpace(o.DimensionsText)) parts.Add(o.DimensionsText.Trim());
        parts.AddRange(new[] { o.Material, o.Finish, o.Color, o.Fabric }.Where(x => !string.IsNullOrWhiteSpace(x))!);
        if (o.Doors > 0) parts.Add($"{o.Doors} doors");
        if (o.Drawers > 0) parts.Add($"{o.Drawers} drawers");
        return string.Join(", ", parts) + $" ({o.Number})";
    }

    private const string Select = """
        select o.*, c.name as customer_name, c.mobile as customer_mobile, i.number as invoice_number, u.full_name as created_by_name,
               coalesce((select sum(case when p.direction = 'IN' then a.amount else -a.amount end) from payment_allocations a
                         join payments p on p.id = a.payment_id and not p.is_voided where a.doc_type = 'CUSTOM_ORDER' and a.doc_id = o.id), 0)
               + coalesce((select paid from v_invoice_balances b where b.invoice_id = o.invoice_id), 0) as advance_paid
        from custom_orders o join customers c on c.id = o.customer_id left join invoices i on i.id = o.invoice_id left join users u on u.id = o.created_by
        """;

    public async Task<CustomOrder> GetAsync(long id)
    {
        session.DemandAny(Perm.CustomOrderView, Perm.DeliveryView);
        var o = await db.QuerySingleOrDefaultAsync<CustomOrder>($"{Select} where o.id = @id", new { id }) ?? throw new NotFoundException("Custom order", id);
        if (!session.CanSeeCost) o.ProductionCost = null;
        return o;
    }

    /// <param name="stage">ACTIVE (received..quality check), READY (ready/delivery/installation), COMPLETED, or a status code.</param>
    public async Task<PagedResult<CustomOrder>> ListAsync(ListQuery q, string? stage = null)
    {
        session.Demand(Perm.CustomOrderView);
        var stageSql = stage switch
        {
            "ACTIVE" => "and o.status in ('RECEIVED','PRODUCTION','QUALITY_CHECK')",
            "READY" => "and o.status in ('READY','DELIVERY','INSTALLATION')",
            "COMPLETED" => "and o.status in ('COMPLETED','CANCELLED')",
            _ => "",
        };
        var where = $"""
            where (@Status::text is null or o.status = @Status) {stageSql}
              and (@CustomerId::bigint is null or o.customer_id = @CustomerId)
              and (@Search::text is null or o.number ilike '%' || @Search || '%' or c.name ilike '%' || @Search || '%' or c.mobile like '%' || @Search || '%'
                   or o.product_type ilike '%' || @Search || '%')
            """;
        var args = new { q.Status, q.CustomerId, Search = Blank(q.Search), q.PageSize, q.Offset };
        await using var conn = await db.OpenAsync();
        var total = await conn.ExecuteScalarAsync<int>($"select count(*) from custom_orders o join customers c on c.id = o.customer_id {where}", args);
        var rows = (await conn.QueryAsync<CustomOrder>($"{Select} {where} order by o.expected_completion_date nulls last, o.order_date desc limit @PageSize offset @Offset", args)).AsList();
        if (!session.CanSeeCost) rows.ForEach(r => r.ProductionCost = null);
        return new PagedResult<CustomOrder> { Items = rows, TotalCount = total, Page = q.Page, PageSize = q.PageSize };
    }

    public async Task<IReadOnlyList<StatusHistoryEntry>> HistoryAsync(long id)
    {
        await using var conn = await db.OpenAsync();
        return await SalesDocumentBuilder.HistoryAsync(conn, DocType.CustomOrder, id);
    }

    private static string? Blank(string? s) => string.IsNullOrWhiteSpace(s) ? null : s.Trim();
}
