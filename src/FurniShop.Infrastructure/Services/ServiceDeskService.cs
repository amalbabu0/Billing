using Dapper;
using FurniShop.Core;
using FurniShop.Core.Domain;
using FurniShop.Core.Security;
using FurniShop.Infrastructure.Database;
using FurniShop.Infrastructure.Security;
using Npgsql;

namespace FurniShop.Infrastructure.Services;

public sealed class WarrantyRecord
{
    public long Id { get; set; }
    public string Number { get; set; } = "";
    public long CustomerId { get; set; }
    public string? CustomerName { get; set; }
    public string? CustomerMobile { get; set; }
    public long? InvoiceId { get; set; }
    public string? InvoiceNumber { get; set; }
    public long? InvoiceItemId { get; set; }
    public long? CustomOrderId { get; set; }
    public string? CustomOrderNumber { get; set; }
    public long? VariantId { get; set; }
    public string ProductName { get; set; } = "";
    public string? SerialNo { get; set; }
    public DateTime StartDate { get; set; }
    public DateTime EndDate { get; set; }
    public string? Terms { get; set; }
    public bool IsVoid { get; set; }
    public string? VoidReason { get; set; }
    public DateTime CreatedAt { get; set; }
    public int ServiceTickets { get; set; }
    public int DaysLeft => (EndDate.Date - DateTime.Today).Days;
    /// <summary>ACTIVE, EXPIRING (≤ 30 days left), EXPIRED or VOID.</summary>
    public string State => IsVoid ? "VOID" : DaysLeft < 0 ? "EXPIRED" : DaysLeft <= 30 ? "EXPIRING" : "ACTIVE";
}

public sealed class WarrantyInput
{
    public long CustomerId { get; set; }
    public string ProductName { get; set; } = "";
    public string? SerialNo { get; set; }
    public DateTime StartDate { get; set; } = DateTime.Today;
    public int Months { get; set; } = 12;
    public string? Terms { get; set; }
    public long? InvoiceId { get; set; }
    public long? CustomOrderId { get; set; }
}

public sealed class ServiceTicket
{
    public long Id { get; set; }
    public string Number { get; set; } = "";
    public long CustomerId { get; set; }
    public string? CustomerName { get; set; }
    public string? CustomerMobile { get; set; }
    public long? WarrantyId { get; set; }
    public string? WarrantyNumber { get; set; }
    public DateTime? WarrantyEnd { get; set; }
    public long? InvoiceId { get; set; }
    public string? InvoiceNumber { get; set; }
    public string ProductName { get; set; } = "";
    public string? SerialNo { get; set; }
    public string Issue { get; set; } = "";
    public string? Address { get; set; }
    public string Status { get; set; } = ServiceStatus.New;
    public string Priority { get; set; } = "NORMAL";
    public bool UnderWarranty { get; set; }
    public string? TechnicianName { get; set; }
    public long? TechnicianUserId { get; set; }
    public DateTime? VisitDate { get; set; }
    public string? PartsUsed { get; set; }
    public decimal ServiceCharge { get; set; }
    public string? Resolution { get; set; }
    public long? ServiceInvoiceId { get; set; }
    public string? ServiceInvoiceNumber { get; set; }
    public DateTime? CompletedAt { get; set; }
    public string? CancelReason { get; set; }
    public string? CreatedByName { get; set; }
    public DateTime CreatedAt { get; set; }
}

public sealed class ServiceTicketInput
{
    public long Id { get; set; }
    public long CustomerId { get; set; }
    public long? WarrantyId { get; set; }
    public long? InvoiceId { get; set; }
    public string ProductName { get; set; } = "";
    public string? SerialNo { get; set; }
    public string Issue { get; set; } = "";
    public string? Address { get; set; }
    public string Priority { get; set; } = "NORMAL";
    /// <summary>Only used when no warranty is linked (e.g. goodwill repair).</summary>
    public bool? UnderWarranty { get; set; }
}

public sealed class ServiceCompleteInput
{
    public string Resolution { get; set; } = "";
    public string? PartsUsed { get; set; }
    /// <summary>GST-inclusive charge; billed on a service invoice when the job is not under warranty.</summary>
    public decimal ServiceCharge { get; set; }
    public List<PaymentLineInput> Payments { get; set; } = new();
}

public static class ServiceStatus
{
    public const string New = "NEW", Assigned = "ASSIGNED", Visit = "VISIT", Repair = "REPAIR", Qc = "QC", Completed = "COMPLETED", Cancelled = "CANCELLED";
    public static readonly string[] Flow = { New, Assigned, Visit, Repair, Qc, Completed };
}

/// <summary>
/// Warranty registrations and after-sales service. Warranties are created automatically when an invoice with
/// warranty products is finalised; a chargeable repair is billed on a normal GST service invoice.
/// </summary>
public sealed class ServiceDeskService(Db db, UserSession session, AuditService audit, InvoiceService invoices)
{
    public const string ServiceHsn = "998719"; // maintenance & repair of furniture
    private static string? Blank(string? s) => string.IsNullOrWhiteSpace(s) ? null : s.Trim();

    /// <summary>Called inside invoice finalisation: one registration per invoice line whose product carries a warranty (named customers only).</summary>
    internal static async Task RegisterForInvoiceAsync(NpgsqlConnection conn, NpgsqlTransaction tx, long invoiceId)
    {
        var items = await conn.QueryAsync<(long ItemId, long CustomerId, long? VariantId, string Description, DateTime Date, int Months, string? Terms, string? Serial)>("""
            select it.id, i.customer_id, it.variant_id, it.description, i.invoice_date, p.warranty_months, p.warranty_terms, it.serial_no
            from invoice_items it join invoices i on i.id = it.invoice_id
            join product_variants v on v.id = it.variant_id join products p on p.id = v.product_id
            join customers c on c.id = i.customer_id and not c.is_walk_in  -- anonymous counter sales: register manually if the buyer wants it
            where it.invoice_id = @invoiceId and p.warranty_months > 0
              and not exists (select 1 from warranties w where w.invoice_item_id = it.id)
            order by it.line_no
            """, new { invoiceId }, tx);
        foreach (var i in items)
        {
            var number = await SequenceService.NextAsync(conn, tx, DocType.Warranty, i.Date);
            await conn.ExecuteAsync("""
                insert into warranties (number, customer_id, invoice_id, invoice_item_id, variant_id, product_name, serial_no, start_date, end_date, terms)
                values (@number, @CustomerId, @invoiceId, @ItemId, @VariantId, @Description, @Serial, @Date, (@Date::date + make_interval(months => @Months) - interval '1 day')::date, @Terms)
                """, new { number, i.CustomerId, invoiceId, i.ItemId, i.VariantId, i.Description, i.Serial, i.Date, i.Months, i.Terms }, tx);
        }
    }

    internal static Task VoidForInvoiceAsync(NpgsqlConnection conn, NpgsqlTransaction tx, long invoiceId, string reason) =>
        conn.ExecuteAsync("update warranties set is_void = true, void_reason = @reason where invoice_id = @invoiceId and not is_void", new { invoiceId, reason }, tx);

    // ------------------------------------------------------------------ warranties
    private const string WarrantySelect = """
        select w.*, c.name as customer_name, c.mobile as customer_mobile, i.number as invoice_number, co.number as custom_order_number,
               (select count(*) from service_tickets t where t.warranty_id = w.id)::int as service_tickets
        from warranties w join customers c on c.id = w.customer_id left join invoices i on i.id = w.invoice_id left join custom_orders co on co.id = w.custom_order_id
        """;

    public async Task<PagedResult<WarrantyRecord>> WarrantiesAsync(ListQuery q)
    {
        session.DemandAny(Perm.WarrantyView, Perm.ServiceView);
        var where = """
            where (@CustomerId::bigint is null or w.customer_id = @CustomerId)
              and (@Status::text is null
                   or (@Status = 'ACTIVE' and not w.is_void and w.end_date >= current_date)
                   or (@Status = 'EXPIRING' and not w.is_void and w.end_date between current_date and current_date + 30)
                   or (@Status = 'EXPIRED' and not w.is_void and w.end_date < current_date)
                   or (@Status = 'VOID' and w.is_void))
              and (@Search::text is null or w.number ilike '%' || @Search || '%' or w.product_name ilike '%' || @Search || '%' or w.serial_no ilike '%' || @Search || '%'
                   or c.name ilike '%' || @Search || '%' or c.mobile like '%' || @Search || '%' or i.number ilike '%' || @Search || '%')
            """;
        var order = q.Status == "EXPIRING" ? "w.end_date" : "w.start_date desc, w.id desc";
        var args = new { q.CustomerId, q.Status, Search = Blank(q.Search), q.PageSize, q.Offset };
        await using var conn = await db.OpenAsync();
        var total = await conn.ExecuteScalarAsync<int>($"select count(*) from warranties w join customers c on c.id = w.customer_id left join invoices i on i.id = w.invoice_id {where}", args);
        var rows = (await conn.QueryAsync<WarrantyRecord>($"{WarrantySelect} {where} order by {order} limit @PageSize offset @Offset", args)).AsList();
        return new PagedResult<WarrantyRecord> { Items = rows, TotalCount = total, Page = q.Page, PageSize = q.PageSize };
    }

    public async Task<WarrantyRecord> WarrantyAsync(long id)
    {
        session.DemandAny(Perm.WarrantyView, Perm.ServiceView);
        return (await db.QueryAsync<WarrantyRecord>($"{WarrantySelect} where w.id = @id", new { id })).FirstOrDefault() ?? throw new NotFoundException("Warranty", id);
    }

    public async Task<long> RegisterAsync(WarrantyInput input)
    {
        session.Demand(Perm.ServiceManage);
        if (input.CustomerId == 0) throw new ValidationException("CustomerId", "Choose the customer.");
        if (string.IsNullOrWhiteSpace(input.ProductName)) throw new ValidationException("ProductName", "What is covered?");
        if (input.Months is < 1 or > 360) throw new ValidationException("Months", "Warranty period must be 1–360 months.");
        return await db.InTransactionAsync(async (conn, tx) =>
        {
            var number = await SequenceService.NextAsync(conn, tx, DocType.Warranty, input.StartDate);
            var id = await conn.ExecuteScalarAsync<long>("""
                insert into warranties (number, customer_id, invoice_id, custom_order_id, product_name, serial_no, start_date, end_date, terms)
                values (@number, @CustomerId, @InvoiceId, @CustomOrderId, @ProductName, @SerialNo, @StartDate, (@StartDate::date + make_interval(months => @Months) - interval '1 day')::date, @Terms)
                returning id
                """, new { number, input.CustomerId, input.InvoiceId, input.CustomOrderId, ProductName = input.ProductName.Trim(), SerialNo = Blank(input.SerialNo), StartDate = input.StartDate.Date, input.Months, Terms = Blank(input.Terms) }, tx);
            await audit.LogAsync(conn, tx, "CREATE", "Service", $"registered warranty {number} — {input.ProductName} ({input.Months} months)", "warranty", id, number);
            return id;
        });
    }

    /// <summary>Serial number / terms can be recorded after the sale (e.g. read from the product label at delivery).</summary>
    public async Task UpdateWarrantyAsync(long id, string? serialNo, string? terms)
    {
        session.Demand(Perm.ServiceManage);
        await db.InTransactionAsync(async (conn, tx) =>
        {
            var w = await conn.QuerySingleOrDefaultAsync<WarrantyRecord>("select * from warranties where id = @id for update", new { id }, tx) ?? throw new NotFoundException("Warranty", id);
            await conn.ExecuteAsync("update warranties set serial_no = @serial, terms = @terms where id = @id", new { serial = Blank(serialNo), terms = Blank(terms), id }, tx);
            if (w.InvoiceItemId is { } itemId)
                await conn.ExecuteAsync("update invoice_items set serial_no = @serial where id = @itemId", new { serial = Blank(serialNo), itemId }, tx);
            await audit.LogAsync(conn, tx, "UPDATE", "Service", $"updated warranty {w.Number}", "warranty", id, w.Number,
                new { w.SerialNo, w.Terms }, new { SerialNo = Blank(serialNo), Terms = Blank(terms) });
        });
    }

    public async Task VoidWarrantyAsync(long id, string reason)
    {
        session.Demand(Perm.ServiceManage);
        if (string.IsNullOrWhiteSpace(reason)) throw new ValidationException("Reason", "Enter the reason.");
        await db.InTransactionAsync(async (conn, tx) =>
        {
            var number = await conn.ExecuteScalarAsync<string?>("update warranties set is_void = true, void_reason = @reason where id = @id and not is_void returning number", new { id, reason }, tx)
                         ?? throw new BusinessRuleException("This warranty is already void.");
            await audit.LogAsync(conn, tx, "VOID", "Service", $"voided warranty {number} — {reason}", "warranty", id, number);
        });
    }

    // ------------------------------------------------------------------ service tickets
    private const string TicketSelect = """
        select t.*, c.name as customer_name, c.mobile as customer_mobile, w.number as warranty_number, w.end_date as warranty_end,
               i.number as invoice_number, si.number as service_invoice_number, u.full_name as created_by_name
        from service_tickets t join customers c on c.id = t.customer_id left join warranties w on w.id = t.warranty_id
        left join invoices i on i.id = t.invoice_id left join invoices si on si.id = t.service_invoice_id left join users u on u.id = t.created_by
        """;

    public async Task<PagedResult<ServiceTicket>> TicketsAsync(ListQuery q)
    {
        session.Demand(Perm.ServiceView);
        var where = """
            where (@CustomerId::bigint is null or t.customer_id = @CustomerId)
              and (@Status::text is null or t.status = @Status or (@Status = 'OPEN' and t.status not in ('COMPLETED','CANCELLED')))
              and (@Search::text is null or t.number ilike '%' || @Search || '%' or t.product_name ilike '%' || @Search || '%' or t.serial_no ilike '%' || @Search || '%'
                   or c.name ilike '%' || @Search || '%' or c.mobile like '%' || @Search || '%' or t.technician_name ilike '%' || @Search || '%')
            """;
        var args = new { q.CustomerId, q.Status, Search = Blank(q.Search), q.PageSize, q.Offset };
        await using var conn = await db.OpenAsync();
        var total = await conn.ExecuteScalarAsync<int>($"select count(*) from service_tickets t join customers c on c.id = t.customer_id {where}", args);
        var rows = (await conn.QueryAsync<ServiceTicket>($"""
            {TicketSelect} {where}
            order by case when t.status in ('COMPLETED','CANCELLED') then 1 else 0 end,
                     case t.priority when 'URGENT' then 0 when 'HIGH' then 1 when 'NORMAL' then 2 else 3 end, t.created_at desc
            limit @PageSize offset @Offset
            """, args)).AsList();
        return new PagedResult<ServiceTicket> { Items = rows, TotalCount = total, Page = q.Page, PageSize = q.PageSize };
    }

    public async Task<ServiceTicket> TicketAsync(long id)
    {
        session.Demand(Perm.ServiceView);
        return (await db.QueryAsync<ServiceTicket>($"{TicketSelect} where t.id = @id", new { id })).FirstOrDefault() ?? throw new NotFoundException("Service ticket", id);
    }

    public Task<IReadOnlyList<StatusHistoryEntry>> TicketHistoryAsync(long id) => History.ForAsync(db, DocType.Service, id);

    public async Task<long> SaveTicketAsync(ServiceTicketInput input)
    {
        session.Demand(Perm.ServiceManage);
        if (input.CustomerId == 0) throw new ValidationException("CustomerId", "Choose the customer.");
        if (string.IsNullOrWhiteSpace(input.ProductName)) throw new ValidationException("ProductName", "Which product needs service?");
        if (string.IsNullOrWhiteSpace(input.Issue)) throw new ValidationException("Issue", "Describe the problem.");
        if (input.Priority is not ("LOW" or "NORMAL" or "HIGH" or "URGENT")) throw new ValidationException("Priority", "Unknown priority.");
        return await db.InTransactionAsync(async (conn, tx) =>
        {
            var underWarranty = input.UnderWarranty ?? false;
            if (input.WarrantyId is { } wid)
            {
                var w = await conn.QuerySingleOrDefaultAsync<WarrantyRecord>("select * from warranties where id = @wid", new { wid }, tx) ?? throw new NotFoundException("Warranty", wid);
                if (w.CustomerId != input.CustomerId) throw new ValidationException("WarrantyId", "That warranty belongs to another customer.");
                underWarranty = w.State is "ACTIVE" or "EXPIRING";
                input.InvoiceId ??= w.InvoiceId;
                input.SerialNo ??= w.SerialNo;
            }
            var address = Blank(input.Address) ?? await conn.ExecuteScalarAsync<string?>("select nullif(concat_ws(', ', billing_address, city), '') from customers where id = @CustomerId", input, tx);
            long id; string number;
            if (input.Id == 0)
            {
                number = await SequenceService.NextAsync(conn, tx, DocType.Service);
                id = await conn.ExecuteScalarAsync<long>("""
                    insert into service_tickets (number, customer_id, warranty_id, invoice_id, product_name, serial_no, issue, address, priority, under_warranty, created_by)
                    values (@number, @CustomerId, @WarrantyId, @InvoiceId, @ProductName, @SerialNo, @Issue, @address, @Priority, @underWarranty, @uid) returning id
                    """, new { number, input.CustomerId, input.WarrantyId, input.InvoiceId, ProductName = input.ProductName.Trim(), SerialNo = Blank(input.SerialNo), Issue = input.Issue.Trim(), address, input.Priority, underWarranty, uid = session.UserId }, tx);
                await SalesDocumentBuilder.AddStatusHistoryAsync(conn, tx, DocType.Service, id, null, ServiceStatus.New, underWarranty ? "Under warranty" : "Chargeable", session.UserId);
            }
            else
            {
                var cur = await LockAsync(conn, tx, input.Id);
                if (cur.Status is ServiceStatus.Completed or ServiceStatus.Cancelled) throw new BusinessRuleException("This ticket is closed.");
                await conn.ExecuteAsync("""
                    update service_tickets set warranty_id = @WarrantyId, invoice_id = @InvoiceId, product_name = @ProductName, serial_no = @SerialNo, issue = @Issue,
                        address = @address, priority = @Priority, under_warranty = @underWarranty, updated_at = now() where id = @Id
                    """, new { input.WarrantyId, input.InvoiceId, ProductName = input.ProductName.Trim(), SerialNo = Blank(input.SerialNo), Issue = input.Issue.Trim(), address, input.Priority, underWarranty, input.Id }, tx);
                id = input.Id; number = cur.Number;
            }
            await audit.LogAsync(conn, tx, input.Id == 0 ? "CREATE" : "UPDATE", "Service", $"saved service ticket {number} — {input.ProductName}", "service", id, number);
            return id;
        });
    }

    public async Task AssignAsync(long id, DateTime visitDate, string? technicianName, long? technicianUserId)
    {
        session.Demand(Perm.ServiceManage);
        if (technicianUserId is null && string.IsNullOrWhiteSpace(technicianName)) throw new ValidationException("TechnicianName", "Choose the technician.");
        await db.InTransactionAsync(async (conn, tx) =>
        {
            var t = await LockAsync(conn, tx, id);
            if (t.Status is ServiceStatus.Completed or ServiceStatus.Cancelled) throw new BusinessRuleException("This ticket is closed.");
            technicianName = Blank(technicianName) ?? await conn.ExecuteScalarAsync<string>("select full_name from users where id = @technicianUserId", new { technicianUserId }, tx);
            var status = t.Status == ServiceStatus.New ? ServiceStatus.Assigned : t.Status;
            await conn.ExecuteAsync("update service_tickets set technician_name = @technicianName, technician_user_id = @technicianUserId, visit_date = @d, status = @status, updated_at = now() where id = @id",
                new { technicianName, technicianUserId, d = visitDate.Date, status, id }, tx);
            await SalesDocumentBuilder.AddStatusHistoryAsync(conn, tx, DocType.Service, id, t.Status, status, $"{technicianName}, visit {visitDate:dd-MMM-yyyy}", session.UserId);
            await audit.LogAsync(conn, tx, "ASSIGN", "Service", $"assigned {t.Number} to {technicianName} for {visitDate:dd-MMM-yyyy}", "service", id, t.Number);
        });
    }

    public async Task MoveAsync(long id, string status, string? note)
    {
        session.Demand(Perm.ServiceManage);
        if (status is not (ServiceStatus.Visit or ServiceStatus.Repair or ServiceStatus.Qc or ServiceStatus.Assigned)) throw new ValidationException("Status", "Use Complete or Cancel to close the ticket.");
        await db.InTransactionAsync(async (conn, tx) =>
        {
            var t = await LockAsync(conn, tx, id);
            if (t.Status is ServiceStatus.Completed or ServiceStatus.Cancelled) throw new BusinessRuleException("This ticket is closed.");
            if (t.TechnicianName is null) throw new BusinessRuleException("Assign a technician first.");
            await conn.ExecuteAsync("update service_tickets set status = @status, updated_at = now() where id = @id", new { status, id }, tx);
            await SalesDocumentBuilder.AddStatusHistoryAsync(conn, tx, DocType.Service, id, t.Status, status, Blank(note), session.UserId);
        });
    }

    /// <summary>Closes the job. A charge on a job outside warranty is billed on a GST service invoice (SAC 998719), with optional payment.</summary>
    public async Task<CheckoutResult?> CompleteAsync(long id, ServiceCompleteInput input)
    {
        session.Demand(Perm.ServiceManage);
        if (string.IsNullOrWhiteSpace(input.Resolution)) throw new ValidationException("Resolution", "Describe what was done.");
        if (input.ServiceCharge < 0) throw new ValidationException("ServiceCharge", "Charge cannot be negative.");
        return await db.InTransactionAsync<CheckoutResult?>(async (conn, tx) =>
        {
            var t = await LockAsync(conn, tx, id);
            if (t.Status is ServiceStatus.Completed or ServiceStatus.Cancelled) throw new BusinessRuleException("This ticket is closed.");
            if (t.TechnicianName is null) throw new BusinessRuleException("Assign a technician first.");
            CheckoutResult? bill = null;
            if (input.ServiceCharge > 0)
            {
                session.Demand(Perm.InvoiceCreate);
                var rate = (await SettingsService.LoadAsync(conn, tx)).Tax.ChargesGstRate;
                var draft = await invoices.SaveDraftAsync(conn, tx, new SalesDocumentInput
                {
                    CustomerId = t.CustomerId, Notes = $"Service ticket {t.Number}",
                    Lines = { new LineInput { Description = $"Repair / service — {t.ProductName} ({t.Number})", HsnCode = ServiceHsn, Quantity = 1, UnitPrice = input.ServiceCharge, PriceIncludesGst = true, GstRate = rate } },
                }, enforceDiscount: false);
                bill = await invoices.FinalizeAsync(conn, tx, draft, input.Payments, 0);
            }
            await conn.ExecuteAsync("""
                update service_tickets set status = 'COMPLETED', resolution = @Resolution, parts_used = @PartsUsed, service_charge = @ServiceCharge,
                    service_invoice_id = @invoiceId, payment_id = @paymentId, completed_at = now(), updated_at = now() where id = @id
                """, new { Resolution = input.Resolution.Trim(), PartsUsed = Blank(input.PartsUsed), input.ServiceCharge, invoiceId = bill?.InvoiceId, paymentId = bill?.PaymentId, id }, tx);
            await SalesDocumentBuilder.AddStatusHistoryAsync(conn, tx, DocType.Service, id, t.Status, ServiceStatus.Completed,
                bill is null ? Blank(input.Resolution) : $"Billed on {bill.InvoiceNumber}", session.UserId);
            await audit.LogAsync(conn, tx, "COMPLETE", "Service", $"completed service ticket {t.Number}{(bill is null ? "" : $" — billed {Money.Format(input.ServiceCharge)} on {bill.InvoiceNumber}")}", "service", id, t.Number);
            return bill;
        });
    }

    public async Task CancelTicketAsync(long id, string reason)
    {
        session.Demand(Perm.ServiceManage);
        if (string.IsNullOrWhiteSpace(reason)) throw new ValidationException("Reason", "Enter the reason.");
        await db.InTransactionAsync(async (conn, tx) =>
        {
            var t = await LockAsync(conn, tx, id);
            if (t.Status is ServiceStatus.Completed or ServiceStatus.Cancelled) throw new BusinessRuleException("This ticket is closed.");
            await conn.ExecuteAsync("update service_tickets set status = 'CANCELLED', cancel_reason = @reason, updated_at = now() where id = @id", new { id, reason }, tx);
            await SalesDocumentBuilder.AddStatusHistoryAsync(conn, tx, DocType.Service, id, t.Status, ServiceStatus.Cancelled, reason, session.UserId);
            await audit.LogAsync(conn, tx, "CANCEL", "Service", $"cancelled service ticket {t.Number} — {reason}", "service", id, t.Number);
        });
    }

    private static async Task<ServiceTicket> LockAsync(NpgsqlConnection conn, NpgsqlTransaction tx, long id) =>
        await conn.QuerySingleOrDefaultAsync<ServiceTicket>("select * from service_tickets where id = @id for update", new { id }, tx) ?? throw new NotFoundException("Service ticket", id);
}
