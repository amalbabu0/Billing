using System.Security.Cryptography;
using Dapper;
using FurniShop.Core;
using FurniShop.Core.Domain;
using FurniShop.Core.Security;
using FurniShop.Infrastructure.Database;
using FurniShop.Infrastructure.Security;
using Npgsql;

namespace FurniShop.Infrastructure.Services;

/// <summary>
/// Deliveries: Pending → Scheduled → Out for delivery → Delivered (or Failed → rescheduled / Cancelled).
/// A delivery cannot be completed without the receiver's name and at least one proof
/// (verified OTP, signature, photo or remarks); the database enforces the same rule.
/// Completing a delivery moves the linked sales order / custom order forward and creates
/// an installation job when one is required.
/// </summary>
public sealed class DeliveryService(Db db, UserSession session, AuditService audit, AttachmentService attachments)
{
    internal static async Task<long> CreateForInvoiceAsync(NpgsqlConnection conn, NpgsqlTransaction tx, UserSession session, long invoiceId)
    {
        var inv = await conn.QuerySingleAsync<Invoice>("select * from invoices where id = @invoiceId", new { invoiceId }, tx);
        var items = await conn.QueryAsync<DeliveryItem>(
            "select variant_id, description, quantity - returned_qty as quantity from invoice_items where invoice_id = @invoiceId and quantity > returned_qty order by line_no", new { invoiceId }, tx);
        return await InsertAsync(conn, tx, session, new Delivery
        {
            CustomerId = inv.CustomerId, InvoiceId = invoiceId, SalesOrderId = inv.SalesOrderId, CustomOrderId = inv.CustomOrderId,
            DeliveryAddress = inv.DeliveryAddress ?? inv.BillingAddress ?? "", ContactMobile = inv.CustomerMobile, DeliveryCharge = inv.DeliveryCharge,
            Items = items.AsList(),
        });
    }

    private static async Task<long> InsertAsync(NpgsqlConnection conn, NpgsqlTransaction tx, UserSession session, Delivery d)
    {
        if (string.IsNullOrWhiteSpace(d.DeliveryAddress)) throw new ValidationException("DeliveryAddress", "Enter the delivery address.");
        if (d.Items.Count == 0) throw new ValidationException("Items", "Nothing to deliver.");
        d.Number = await SequenceService.NextAsync(conn, tx, DocType.Delivery);
        d.Status = d.ScheduledDate.HasValue ? DeliveryStatus.Scheduled : DeliveryStatus.Pending;
        d.Id = await conn.ExecuteScalarAsync<long>("""
            insert into deliveries (number, customer_id, invoice_id, sales_order_id, custom_order_id, delivery_address, contact_mobile, scheduled_date,
                time_slot, driver_name, driver_user_id, vehicle_no, delivery_charge, delivery_cost, status, notes, created_by)
            values (@Number, @CustomerId, @InvoiceId, @SalesOrderId, @CustomOrderId, @DeliveryAddress, @ContactMobile, @ScheduledDate,
                @TimeSlot, @DriverName, @DriverUserId, @VehicleNo, @DeliveryCharge, coalesce(@DeliveryCost, 0), @Status, @Notes, @Uid) returning id
            """, new
        {
            d.Number, d.CustomerId, d.InvoiceId, d.SalesOrderId, d.CustomOrderId, DeliveryAddress = d.DeliveryAddress.Trim(), d.ContactMobile, d.ScheduledDate,
            d.TimeSlot, d.DriverName, d.DriverUserId, d.VehicleNo, d.DeliveryCharge, d.DeliveryCost, d.Status, d.Notes, Uid = session.UserId,
        }, tx);
        foreach (var i in d.Items.Where(i => i.Quantity > 0))
            await conn.ExecuteAsync("insert into delivery_items (delivery_id, variant_id, description, quantity) values (@id, @VariantId, @Description, @Quantity)",
                new { id = d.Id, i.VariantId, i.Description, i.Quantity }, tx);
        await SalesDocumentBuilder.AddStatusHistoryAsync(conn, tx, DocType.Delivery, d.Id, null, d.Status, "Created", session.UserId);
        return d.Id;
    }

    /// <summary>Creates a delivery for a sales order (uses invoice lines if the order has been invoiced).</summary>
    public async Task<long> CreateForSalesOrderAsync(long salesOrderId, DateTime? scheduledDate = null)
    {
        session.DemandAny(Perm.DeliveryManage, Perm.SalesOrderManage);
        return await db.InTransactionAsync(async (conn, tx) =>
        {
            var so = await conn.QuerySingleOrDefaultAsync<SalesOrder>("select * from sales_orders where id = @salesOrderId for update", new { salesOrderId }, tx)
                     ?? throw new NotFoundException("Sales order", salesOrderId);
            if (so.Status is SalesOrderStatus.Draft or SalesOrderStatus.Cancelled) throw new BusinessRuleException("Confirm the order before scheduling delivery.");
            await EnsureNoOpenDeliveryAsync(conn, tx, "sales_order_id", salesOrderId);
            var items = (await conn.QueryAsync<DeliveryItem>(
                "select variant_id, description, quantity from sales_order_items where sales_order_id = @salesOrderId order by line_no", new { salesOrderId }, tx)).AsList();
            var mobile = await conn.ExecuteScalarAsync<string?>("select mobile from customers where id = @CustomerId", so, tx);
            var id = await InsertAsync(conn, tx, session, new Delivery
            {
                CustomerId = so.CustomerId, SalesOrderId = salesOrderId, InvoiceId = so.InvoiceId, DeliveryAddress = so.DeliveryAddress ?? "",
                ContactMobile = mobile, DeliveryCharge = so.DeliveryCharge, ScheduledDate = scheduledDate ?? so.ExpectedDeliveryDate, Items = items,
            });
            await audit.LogAsync(conn, tx, "CREATE", "Delivery", $"created delivery for sales order {so.Number}", "delivery", id);
            return id;
        });
    }

    public async Task<long> CreateForCustomOrderAsync(long customOrderId, DateTime? scheduledDate = null)
    {
        session.DemandAny(Perm.DeliveryManage, Perm.CustomOrderManage);
        return await db.InTransactionAsync(async (conn, tx) =>
        {
            var co = await conn.QuerySingleOrDefaultAsync<CustomOrder>("select * from custom_orders where id = @customOrderId for update", new { customOrderId }, tx)
                     ?? throw new NotFoundException("Custom order", customOrderId);
            if (co.Status is not (CustomOrderStatus.Ready or CustomOrderStatus.Delivery))
                throw new BusinessRuleException("The custom order must pass quality check and be Ready before delivery.");
            await EnsureNoOpenDeliveryAsync(conn, tx, "custom_order_id", customOrderId);
            var c = await conn.QuerySingleAsync<Customer>("select * from customers where id = @CustomerId", co, tx);
            var id = await InsertAsync(conn, tx, session, new Delivery
            {
                CustomerId = co.CustomerId, CustomOrderId = customOrderId, InvoiceId = co.InvoiceId,
                DeliveryAddress = co.DeliveryAddress ?? InvoiceService.FullAddress(c) ?? "", ContactMobile = c.Mobile, ScheduledDate = scheduledDate,
                Items = new List<DeliveryItem> { new() { Description = $"Custom {co.ProductType} ({co.Number})", Quantity = 1 } },
            });
            if (co.Status == CustomOrderStatus.Ready)
            {
                await conn.ExecuteAsync("update custom_orders set status = 'DELIVERY', updated_at = now() where id = @customOrderId", new { customOrderId }, tx);
                await SalesDocumentBuilder.AddStatusHistoryAsync(conn, tx, DocType.CustomOrder, customOrderId, co.Status, CustomOrderStatus.Delivery, "Delivery created", session.UserId);
            }
            await audit.LogAsync(conn, tx, "CREATE", "Delivery", $"created delivery for custom order {co.Number}", "delivery", id);
            return id;
        });
    }

    public async Task<long> CreateForInvoiceAsync(long invoiceId)
    {
        session.DemandAny(Perm.DeliveryManage, Perm.InvoiceCreate);
        return await db.InTransactionAsync(async (conn, tx) =>
        {
            var status = await conn.ExecuteScalarAsync<string>("select status from invoices where id = @invoiceId for update", new { invoiceId }, tx);
            if (status != InvoiceStatus.Final) throw new BusinessRuleException("Only finalised invoices can be delivered.");
            await EnsureNoOpenDeliveryAsync(conn, tx, "invoice_id", invoiceId);
            var id = await CreateForInvoiceAsync(conn, tx, session, invoiceId);
            await audit.LogAsync(conn, tx, "CREATE", "Delivery", $"created delivery for invoice", "delivery", id);
            return id;
        });
    }

    private static async Task EnsureNoOpenDeliveryAsync(NpgsqlConnection conn, NpgsqlTransaction tx, string column, long id)
    {
        var open = await conn.ExecuteScalarAsync<string?>(
            $"select number from deliveries where {column} = @id and status not in ('CANCELLED','FAILED') limit 1", new { id }, tx);
        if (open is not null) throw new BusinessRuleException($"Delivery {open} already exists for this document.");
    }

    /// <summary>Schedules (or reschedules) the delivery and issues a fresh OTP. Returns the OTP to share with the customer.</summary>
    public async Task<string> ScheduleAsync(long id, DateTime date, string? timeSlot, string? driverName, long? driverUserId, string? vehicleNo, decimal? deliveryCost,
        string? priority = null, string? route = null, int? routeOrder = null)
    {
        session.Demand(Perm.DeliveryManage);
        if (priority is not (null or "LOW" or "NORMAL" or "HIGH" or "URGENT")) throw new ValidationException("Priority", "Unknown priority.");
        if (routeOrder is < 1 or > 99) throw new ValidationException("RouteOrder", "Stop number must be 1–99.");
        if (date.Date < DateTime.Today) throw new ValidationException("ScheduledDate", "The delivery date cannot be in the past.");
        if (deliveryCost is < 0) throw new ValidationException("DeliveryCost", "Cost cannot be negative.");
        return await db.InTransactionAsync(async (conn, tx) =>
        {
            var d = await LockAsync(conn, tx, id);
            if (d.Status is DeliveryStatus.Delivered or DeliveryStatus.Cancelled) throw new BusinessRuleException("This delivery is closed.");
            var otp = RandomNumberGenerator.GetInt32(1000, 10000).ToString();
            await conn.ExecuteAsync("""
                update deliveries set scheduled_date = @date, time_slot = @timeSlot, driver_name = @driverName, driver_user_id = @driverUserId,
                    vehicle_no = @vehicleNo, delivery_cost = coalesce(@deliveryCost, delivery_cost), status = 'SCHEDULED', otp_hash = @hash, otp_verified = false,
                    priority = coalesce(@priority, priority), route = @route, route_order = @routeOrder, updated_at = now()
                where id = @id
                """, new { date = date.Date, timeSlot, driverName, driverUserId, vehicleNo, deliveryCost, hash = PasswordHasher.HashOtp(otp, id), id,
                    priority, route = string.IsNullOrWhiteSpace(route) ? null : route.Trim(), routeOrder }, tx);
            await SalesDocumentBuilder.AddStatusHistoryAsync(conn, tx, DocType.Delivery, id, d.Status, DeliveryStatus.Scheduled,
                $"{date:dd-MMM-yyyy} {timeSlot} — {driverName} {vehicleNo}", session.UserId);
            await audit.LogAsync(conn, tx, "SCHEDULE", "Delivery", $"scheduled delivery {d.Number} on {date:dd-MMM-yyyy}", "delivery", id, d.Number);
            return otp;
        });
    }

    public async Task DispatchAsync(long id)
    {
        session.Demand(Perm.DeliveryManage);
        await db.InTransactionAsync(async (conn, tx) =>
        {
            var d = await LockAsync(conn, tx, id);
            if (d.Status != DeliveryStatus.Scheduled) throw new BusinessRuleException("Schedule the delivery (date, driver, vehicle) before dispatching.");
            if (d.InvoiceId is null && d.SalesOrderId.HasValue)
                throw new BusinessRuleException("Generate the invoice for this order before the goods leave the showroom.");
            await conn.ExecuteAsync("update deliveries set status = 'OUT_FOR_DELIVERY', updated_at = now() where id = @id", new { id }, tx);
            await SalesDocumentBuilder.AddStatusHistoryAsync(conn, tx, DocType.Delivery, id, d.Status, DeliveryStatus.OutForDelivery, null, session.UserId);
            if (d.SalesOrderId.HasValue)
                await AdvanceSalesOrderAsync(conn, tx, d.SalesOrderId.Value, SalesOrderStatus.Dispatched, $"Dispatched via {d.Number}");
            await audit.LogAsync(conn, tx, "DISPATCH", "Delivery", $"dispatched delivery {d.Number}", "delivery", id, d.Number);
        });
    }

    public async Task CompleteAsync(DeliveryCompletion c)
    {
        session.Demand(Perm.DeliveryManage);
        if (string.IsNullOrWhiteSpace(c.ReceiverName)) throw new ValidationException("ReceiverName", "Enter the name of the person who received the goods.");
        await db.InTransactionAsync(async (conn, tx) =>
        {
            var s = await SettingsService.LoadAsync(conn, tx);
            var d = await LockAsync(conn, tx, c.DeliveryId);
            if (d.Status != DeliveryStatus.OutForDelivery) throw new BusinessRuleException("Only deliveries that are out for delivery can be completed.");

            var otpHash = await conn.ExecuteScalarAsync<string?>("select otp_hash from deliveries where id = @DeliveryId", c, tx);
            var otpVerified = false;
            if (!string.IsNullOrWhiteSpace(c.Otp))
            {
                if (otpHash is null || PasswordHasher.HashOtp(c.Otp, c.DeliveryId) != otpHash)
                    throw new ValidationException("Otp", "The OTP does not match. Ask the customer for the 4-digit delivery OTP.");
                otpVerified = true;
            }
            else if (s.Delivery.RequireOtp) throw new ValidationException("Otp", "Enter the delivery OTP given to the customer.");

            long? signatureId = null, photoId = null;
            if (c.SignaturePng is { Length: > 0 })
                signatureId = await attachments.SaveAsync(conn, tx, c.SignaturePng, "signature.png", "DELIVERY", c.DeliveryId, "SIGNATURE");
            if (c.PhotoBytes is { Length: > 0 })
                photoId = await attachments.SaveAsync(conn, tx, c.PhotoBytes, c.PhotoFileName ?? "photo.jpg", "DELIVERY", c.DeliveryId, "PHOTO");
            if (!otpVerified && signatureId is null && photoId is null && string.IsNullOrWhiteSpace(c.Remarks))
                throw new ValidationException("Proof", "Record proof of delivery: OTP, signature, photo or remarks.");

            await conn.ExecuteAsync("""
                update deliveries set status = 'DELIVERED', receiver_name = @ReceiverName, otp_verified = @otpVerified,
                    signature_attachment_id = @signatureId, photo_attachment_id = @photoId, remarks = @Remarks,
                    delivered_at = now(), delivered_by = @uid, updated_at = now()
                where id = @DeliveryId
                """, new { ReceiverName = c.ReceiverName.Trim(), otpVerified, signatureId, photoId, c.Remarks, uid = session.UserId, c.DeliveryId }, tx);
            await SalesDocumentBuilder.AddStatusHistoryAsync(conn, tx, DocType.Delivery, d.Id, d.Status, DeliveryStatus.Delivered,
                $"Received by {c.ReceiverName}{(otpVerified ? " (OTP verified)" : "")}", session.UserId);

            // Downstream workflow
            var needsInstall = false;
            if (d.SalesOrderId.HasValue)
            {
                needsInstall = await conn.ExecuteScalarAsync<bool>("select requires_installation from sales_orders where id = @SalesOrderId", d, tx);
                await AdvanceSalesOrderAsync(conn, tx, d.SalesOrderId.Value, SalesOrderStatus.Delivered, $"Delivered via {d.Number}");
            }
            else if (d.CustomOrderId.HasValue)
            {
                var co = await conn.QuerySingleAsync<CustomOrder>("select * from custom_orders where id = @CustomOrderId for update", d, tx);
                needsInstall = co.RequiresInstallation;
                var next = co.RequiresInstallation ? CustomOrderStatus.Installation : CustomOrderStatus.Completed;
                await conn.ExecuteAsync("update custom_orders set status = @next, updated_at = now() where id = @Id", new { next, co.Id }, tx);
                await SalesDocumentBuilder.AddStatusHistoryAsync(conn, tx, DocType.CustomOrder, co.Id, co.Status, next, $"Delivered via {d.Number}", session.UserId);
            }
            else if (d.InvoiceId.HasValue)
                needsInstall = await conn.ExecuteScalarAsync<bool>("select requires_installation from invoices where id = @InvoiceId", d, tx);

            if (needsInstall)
            {
                var exists = await conn.ExecuteScalarAsync<int>("select count(*) from installations where delivery_id = @Id and status <> 'CANCELLED'", d, tx);
                if (exists == 0)
                    await InstallationService.InsertAsync(conn, tx, session, new Installation
                    {
                        CustomerId = d.CustomerId, DeliveryId = d.Id, InvoiceId = d.InvoiceId, SalesOrderId = d.SalesOrderId,
                        CustomOrderId = d.CustomOrderId, Address = d.DeliveryAddress, Notes = $"Created on delivery {d.Number}",
                    });
            }
            else if (d.SalesOrderId.HasValue)
            {
                var invoiced = await conn.ExecuteScalarAsync<bool>("select invoice_id is not null from sales_orders where id = @SalesOrderId", d, tx);
                if (invoiced) await AdvanceSalesOrderAsync(conn, tx, d.SalesOrderId.Value, SalesOrderStatus.Completed, "Delivered — no installation required");
            }

            await audit.LogAsync(conn, tx, "DELIVER", "Delivery", $"marked delivery {d.Number} delivered (received by {c.ReceiverName})",
                "delivery", d.Id, d.Number, new { d.Status }, new { Status = DeliveryStatus.Delivered, c.ReceiverName, otpVerified, Signature = signatureId.HasValue, Photo = photoId.HasValue, c.Remarks });
        });
    }

    public async Task FailAsync(long id, string reason)
    {
        session.Demand(Perm.DeliveryManage);
        if (string.IsNullOrWhiteSpace(reason)) throw new ValidationException("Reason", "Enter why the delivery failed.");
        await db.InTransactionAsync(async (conn, tx) =>
        {
            var d = await LockAsync(conn, tx, id);
            if (d.Status is not (DeliveryStatus.OutForDelivery or DeliveryStatus.Scheduled)) throw new BusinessRuleException("Only scheduled or dispatched deliveries can fail.");
            await conn.ExecuteAsync("update deliveries set status = 'FAILED', remarks = @reason, updated_at = now() where id = @id", new { reason, id }, tx);
            await SalesDocumentBuilder.AddStatusHistoryAsync(conn, tx, DocType.Delivery, id, d.Status, DeliveryStatus.Failed, reason, session.UserId);
            await audit.LogAsync(conn, tx, "FAIL", "Delivery", $"marked delivery {d.Number} failed — {reason}", "delivery", id, d.Number);
        });
    }

    public async Task CancelAsync(long id, string reason)
    {
        session.Demand(Perm.DeliveryManage);
        await db.InTransactionAsync(async (conn, tx) =>
        {
            var d = await LockAsync(conn, tx, id);
            if (d.Status == DeliveryStatus.Delivered) throw new BusinessRuleException("A completed delivery cannot be cancelled.");
            await conn.ExecuteAsync("update deliveries set status = 'CANCELLED', notes = concat_ws(E'\n', notes, @reason), updated_at = now() where id = @id", new { reason, id }, tx);
            await SalesDocumentBuilder.AddStatusHistoryAsync(conn, tx, DocType.Delivery, id, d.Status, DeliveryStatus.Cancelled, reason, session.UserId);
            await audit.LogAsync(conn, tx, "CANCEL", "Delivery", $"cancelled delivery {d.Number} — {reason}", "delivery", id, d.Number);
        });
    }

    private async Task AdvanceSalesOrderAsync(NpgsqlConnection conn, NpgsqlTransaction tx, long soId, string to, string note)
    {
        var cur = await conn.ExecuteScalarAsync<string>("select status from sales_orders where id = @soId for update", new { soId }, tx);
        if (cur is SalesOrderStatus.Cancelled or SalesOrderStatus.Completed) return;
        if (Array.IndexOf(SalesOrderStatus.Flow, to) <= Array.IndexOf(SalesOrderStatus.Flow, cur)) return;
        await conn.ExecuteAsync("update sales_orders set status = @to, updated_at = now() where id = @soId", new { to, soId }, tx);
        await SalesDocumentBuilder.AddStatusHistoryAsync(conn, tx, DocType.SalesOrder, soId, cur, to, note, session.UserId);
    }

    private static async Task<Delivery> LockAsync(NpgsqlConnection conn, NpgsqlTransaction tx, long id) =>
        await conn.QuerySingleOrDefaultAsync<Delivery>("select * from deliveries where id = @id for update", new { id }, tx)
        ?? throw new NotFoundException("Delivery", id);

    // ------------------------------------------------------------------ queries
    private const string Select = """
        select d.*, c.name as customer_name, c.mobile as customer_mobile, i.number as invoice_number, so.number as sales_order_number,
               co.number as custom_order_number, d.otp_hash is not null as has_otp,
               (select string_agg(di.description || ' ×' || trim(to_char(di.quantity, 'FM999990.##')), ', ') from delivery_items di where di.delivery_id = d.id) as items_summary
        from deliveries d join customers c on c.id = d.customer_id
        left join invoices i on i.id = d.invoice_id left join sales_orders so on so.id = d.sales_order_id left join custom_orders co on co.id = d.custom_order_id
        """;

    public async Task<PagedResult<Delivery>> ListAsync(ListQuery q)
    {
        session.Demand(Perm.DeliveryView);
        var where = """
            where (@Status::text is null or d.status = @Status)
              and (@From::date is null or d.scheduled_date >= @From::date) and (@To::date is null or d.scheduled_date <= @To::date)
              and (@CustomerId::bigint is null or d.customer_id = @CustomerId)
              and (@Search::text is null or d.number ilike '%' || @Search || '%' or c.name ilike '%' || @Search || '%' or c.mobile like '%' || @Search || '%'
                   or i.number ilike '%' || @Search || '%' or so.number ilike '%' || @Search || '%' or d.driver_name ilike '%' || @Search || '%')
            """;
        var args = new { q.Status, q.From, q.To, q.CustomerId, Search = Blank(q.Search), q.PageSize, q.Offset };
        await using var conn = await db.OpenAsync();
        var total = await conn.ExecuteScalarAsync<int>($"""
            select count(*) from deliveries d join customers c on c.id = d.customer_id left join invoices i on i.id = d.invoice_id
            left join sales_orders so on so.id = d.sales_order_id {where}
            """, args);
        var order = q.Status == DeliveryStatus.Delivered ? "d.delivered_at desc"
            : "case d.priority when 'URGENT' then 0 when 'HIGH' then 1 else 2 end, d.scheduled_date nulls first, d.driver_name nulls last, d.route nulls last, d.route_order nulls last, d.created_at";
        var rows = await conn.QueryAsync<Delivery>($"{Select} {where} order by {order} limit @PageSize offset @Offset", args);
        return new PagedResult<Delivery> { Items = rows.AsList(), TotalCount = total, Page = q.Page, PageSize = q.PageSize };
    }

    public async Task<Delivery> GetAsync(long id)
    {
        session.Demand(Perm.DeliveryView);
        await using var conn = await db.OpenAsync();
        var d = await conn.QuerySingleOrDefaultAsync<Delivery>($"{Select} where d.id = @id", new { id }) ?? throw new NotFoundException("Delivery", id);
        d.Items = (await conn.QueryAsync<DeliveryItem>("select * from delivery_items where delivery_id = @id order by id", new { id })).AsList();
        return d;
    }

    public async Task<IReadOnlyList<Delivery>> ForDocumentAsync(string column, long id)
    {
        if (column is not ("invoice_id" or "sales_order_id" or "custom_order_id" or "customer_id")) throw new ArgumentException(column);
        await using var conn = await db.OpenAsync();
        return (await conn.QueryAsync<Delivery>($"{Select} where d.{column} = @id order by d.created_at", new { id })).AsList();
    }

    public async Task<IReadOnlyList<StatusHistoryEntry>> HistoryAsync(long id)
    {
        await using var conn = await db.OpenAsync();
        return await SalesDocumentBuilder.HistoryAsync(conn, DocType.Delivery, id);
    }

    private static string? Blank(string? s) => string.IsNullOrWhiteSpace(s) ? null : s.Trim();
}

/// <summary>Installations: Pending → Scheduled → Assigned → Completed.</summary>
public sealed class InstallationService(Db db, UserSession session, AuditService audit, AttachmentService attachments)
{
    internal static async Task<long> InsertAsync(NpgsqlConnection conn, NpgsqlTransaction tx, UserSession session, Installation i)
    {
        i.Number = await SequenceService.NextAsync(conn, tx, DocType.Installation);
        i.Id = await conn.ExecuteScalarAsync<long>("""
            insert into installations (number, customer_id, delivery_id, invoice_id, sales_order_id, custom_order_id, address, technician_name,
                technician_user_id, scheduled_date, status, installation_cost, notes, created_by)
            values (@Number, @CustomerId, @DeliveryId, @InvoiceId, @SalesOrderId, @CustomOrderId, @Address, @TechnicianName,
                @TechnicianUserId, @ScheduledDate, @Status, coalesce(@InstallationCost,0), @Notes, @Uid) returning id
            """, new
        {
            i.Number, i.CustomerId, i.DeliveryId, i.InvoiceId, i.SalesOrderId, i.CustomOrderId, i.Address, i.TechnicianName, i.TechnicianUserId,
            i.ScheduledDate, Status = i.ScheduledDate.HasValue ? InstallationStatus.Scheduled : InstallationStatus.Pending, i.InstallationCost, i.Notes,
            Uid = session.UserId,
        }, tx);
        await SalesDocumentBuilder.AddStatusHistoryAsync(conn, tx, DocType.Installation, i.Id, null, InstallationStatus.Pending, i.Notes, session.UserId);
        return i.Id;
    }

    public async Task<long> CreateAsync(Installation i)
    {
        session.Demand(Perm.InstallationManage);
        if (string.IsNullOrWhiteSpace(i.Address)) throw new ValidationException("Address", "Enter the installation address.");
        if (i.CustomerId == 0) throw new ValidationException("CustomerId", "Select a customer.");
        return await db.InTransactionAsync(async (conn, tx) =>
        {
            var id = await InsertAsync(conn, tx, session, i);
            await audit.LogAsync(conn, tx, "CREATE", "Installation", $"created installation {i.Number}", "installation", id, i.Number);
            return id;
        });
    }

    public async Task ScheduleAsync(long id, DateTime date, string? technicianName, long? technicianUserId, decimal? cost)
    {
        session.Demand(Perm.InstallationManage);
        if (cost is < 0) throw new ValidationException("InstallationCost", "Cost cannot be negative.");
        await db.InTransactionAsync(async (conn, tx) =>
        {
            var cur = await LockAsync(conn, tx, id);
            if (cur.Status is InstallationStatus.Completed or InstallationStatus.Cancelled) throw new BusinessRuleException("This installation is closed.");
            var status = string.IsNullOrWhiteSpace(technicianName) && technicianUserId is null ? InstallationStatus.Scheduled : InstallationStatus.Assigned;
            await conn.ExecuteAsync("""
                update installations set scheduled_date = @date, technician_name = @technicianName, technician_user_id = @technicianUserId,
                    installation_cost = coalesce(@cost, installation_cost), status = @status, updated_at = now() where id = @id
                """, new { date = date.Date, technicianName, technicianUserId, cost, status, id }, tx);
            await SalesDocumentBuilder.AddStatusHistoryAsync(conn, tx, DocType.Installation, id, cur.Status, status, $"{date:dd-MMM-yyyy} {technicianName}", session.UserId);
            await audit.LogAsync(conn, tx, "SCHEDULE", "Installation", $"scheduled installation {cur.Number} on {date:dd-MMM-yyyy} ({technicianName})", "installation", id, cur.Number);
        });
    }

    public async Task CompleteAsync(long id, string? notes, DateTime? completedAt = null, byte[]? photo = null, string? photoFileName = null, string? confirmedBy = null)
    {
        session.Demand(Perm.InstallationManage);
        await db.InTransactionAsync(async (conn, tx) =>
        {
            var cur = await LockAsync(conn, tx, id);
            if (cur.Status is not (InstallationStatus.Scheduled or InstallationStatus.Assigned))
                throw new BusinessRuleException("Schedule / assign the installation before completing it.");
            if (cur.DeliveryId.HasValue && await conn.ExecuteScalarAsync<string>("select status from deliveries where id = @DeliveryId", cur, tx) != DeliveryStatus.Delivered)
                throw new BusinessRuleException("The goods have not been delivered yet.");
            long? photoId = photo is { Length: > 0 } ? await attachments.SaveAsync(conn, tx, photo, photoFileName ?? "installation.jpg", "INSTALLATION", id, "PHOTO") : null;
            await conn.ExecuteAsync("""
                update installations set status = 'COMPLETED', completed_at = @at, completion_notes = @notes, completion_photo_id = coalesce(@photoId, completion_photo_id),
                    customer_confirmed_by = @confirmedBy, updated_at = now() where id = @id
                """, new { at = completedAt ?? DateTime.Now, notes, photoId, confirmedBy = string.IsNullOrWhiteSpace(confirmedBy) ? null : confirmedBy.Trim(), id }, tx);
            await SalesDocumentBuilder.AddStatusHistoryAsync(conn, tx, DocType.Installation, id, cur.Status, InstallationStatus.Completed, notes, session.UserId);

            if (cur.SalesOrderId.HasValue)
            {
                var so = await conn.QuerySingleAsync<(string Status, long? InvoiceId)>("select status, invoice_id from sales_orders where id = @SalesOrderId for update", cur, tx);
                if (so.Status == SalesOrderStatus.Delivered && so.InvoiceId.HasValue)
                {
                    await conn.ExecuteAsync("update sales_orders set status = 'COMPLETED', updated_at = now() where id = @SalesOrderId", cur, tx);
                    await SalesDocumentBuilder.AddStatusHistoryAsync(conn, tx, DocType.SalesOrder, cur.SalesOrderId.Value, so.Status, SalesOrderStatus.Completed, $"Installation {cur.Number} completed", session.UserId);
                }
            }
            if (cur.CustomOrderId.HasValue)
            {
                var st = await conn.ExecuteScalarAsync<string>("select status from custom_orders where id = @CustomOrderId for update", cur, tx);
                if (st == CustomOrderStatus.Installation)
                {
                    await conn.ExecuteAsync("update custom_orders set status = 'COMPLETED', updated_at = now() where id = @CustomOrderId", cur, tx);
                    await SalesDocumentBuilder.AddStatusHistoryAsync(conn, tx, DocType.CustomOrder, cur.CustomOrderId.Value, st, CustomOrderStatus.Completed, $"Installation {cur.Number} completed", session.UserId);
                }
            }
            await audit.LogAsync(conn, tx, "COMPLETE", "Installation", $"completed installation {cur.Number}", "installation", id, cur.Number);
        });
    }

    public async Task CancelAsync(long id, string reason)
    {
        session.Demand(Perm.InstallationManage);
        await db.InTransactionAsync(async (conn, tx) =>
        {
            var cur = await LockAsync(conn, tx, id);
            if (cur.Status == InstallationStatus.Completed) throw new BusinessRuleException("A completed installation cannot be cancelled.");
            await conn.ExecuteAsync("update installations set status = 'CANCELLED', notes = concat_ws(E'\n', notes, @reason), updated_at = now() where id = @id", new { reason, id }, tx);
            await SalesDocumentBuilder.AddStatusHistoryAsync(conn, tx, DocType.Installation, id, cur.Status, InstallationStatus.Cancelled, reason, session.UserId);
            await audit.LogAsync(conn, tx, "CANCEL", "Installation", $"cancelled installation {cur.Number} — {reason}", "installation", id, cur.Number);
        });
    }

    private static async Task<Installation> LockAsync(NpgsqlConnection conn, NpgsqlTransaction tx, long id) =>
        await conn.QuerySingleOrDefaultAsync<Installation>("select * from installations where id = @id for update", new { id }, tx)
        ?? throw new NotFoundException("Installation", id);

    public async Task<PagedResult<Installation>> ListAsync(ListQuery q)
    {
        session.Demand(Perm.InstallationView);
        var where = """
            where (@Status::text is null or n.status = @Status)
              and (@Search::text is null or n.number ilike '%' || @Search || '%' or c.name ilike '%' || @Search || '%' or n.technician_name ilike '%' || @Search || '%')
            """;
        var args = new { q.Status, Search = Blank(q.Search), q.PageSize, q.Offset };
        await using var conn = await db.OpenAsync();
        var total = await conn.ExecuteScalarAsync<int>($"select count(*) from installations n join customers c on c.id = n.customer_id {where}", args);
        var rows = await conn.QueryAsync<Installation>($"""
            select n.*, c.name as customer_name, c.mobile as customer_mobile, d.number as delivery_number, i.number as invoice_number, co.number as custom_order_number
            from installations n join customers c on c.id = n.customer_id left join deliveries d on d.id = n.delivery_id
            left join invoices i on i.id = n.invoice_id left join custom_orders co on co.id = n.custom_order_id
            {where} order by case n.status when 'COMPLETED' then 2 when 'CANCELLED' then 3 else 1 end, n.scheduled_date nulls first, n.created_at desc
            limit @PageSize offset @Offset
            """, args);
        return new PagedResult<Installation> { Items = rows.AsList(), TotalCount = total, Page = q.Page, PageSize = q.PageSize };
    }

    private static string? Blank(string? s) => string.IsNullOrWhiteSpace(s) ? null : s.Trim();
}
