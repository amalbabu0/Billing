using Dapper;
using FurniShop.Core;
using FurniShop.Core.Domain;
using FurniShop.Core.Security;
using FurniShop.Core.Validation;
using FurniShop.Infrastructure.Database;
using FurniShop.Infrastructure.Security;
using Npgsql;

namespace FurniShop.Infrastructure.Services;

public sealed class Lead
{
    public long Id { get; set; }
    public string Number { get; set; } = "";
    public string Name { get; set; } = "";
    public string? Mobile { get; set; }
    public string? Email { get; set; }
    public string? City { get; set; }
    public string? Source { get; set; }
    public string Status { get; set; } = LeadStatus.New;
    public long? SalespersonId { get; set; }
    public string? SalespersonName { get; set; }
    public string? InterestedProducts { get; set; }
    public decimal ExpectedValue { get; set; }
    public DateTime? NextFollowUp { get; set; }
    public long? CustomerId { get; set; }
    public string? CustomerName { get; set; }
    public long? QuotationId { get; set; }
    public string? LostReason { get; set; }
    public string? Notes { get; set; }
    public DateTime CreatedAt { get; set; }
    public DateTime UpdatedAt { get; set; }
    public int OpenFollowUps { get; set; }
}

public sealed class FollowUp
{
    public long Id { get; set; }
    public string RefType { get; set; } = "LEAD";
    public long RefId { get; set; }
    public string? RefLabel { get; set; }
    public long? CustomerId { get; set; }
    public string? CustomerName { get; set; }
    public string? Mobile { get; set; }
    public string Title { get; set; } = "";
    public DateTime DueDate { get; set; }
    public long? AssignedTo { get; set; }
    public string? AssignedName { get; set; }
    public string? Note { get; set; }
    public DateTime? DoneAt { get; set; }
    public string? Outcome { get; set; }
    public string? CreatedByName { get; set; }
    public DateTime CreatedAt { get; set; }
    public bool IsOverdue => DoneAt is null && DueDate.Date < DateTime.Today;
}

public sealed class FollowUpInput
{
    public string RefType { get; set; } = "LEAD";
    public long RefId { get; set; }
    public string Title { get; set; } = "";
    public DateTime DueDate { get; set; } = DateTime.Today.AddDays(1);
    public long? AssignedTo { get; set; }
    public string? Note { get; set; }
}

public sealed class LeadPipeline
{
    public string Status { get; set; } = "";
    public int Count { get; set; }
    public decimal Value { get; set; }
}

public static class LeadStatus
{
    public const string New = "NEW", Contacted = "CONTACTED", Quotation = "QUOTATION", Negotiation = "NEGOTIATION", Confirmed = "CONFIRMED", Converted = "CONVERTED", Lost = "LOST";
    public static readonly string[] Flow = { New, Contacted, Quotation, Negotiation, Confirmed, Converted };
}

/// <summary>Walk-in enquiries and prospects before they buy, and the follow-ups that keep them warm.</summary>
public sealed class CrmService(Db db, UserSession session, AuditService audit, CustomerService customers)
{
    private static string? Blank(string? s) => string.IsNullOrWhiteSpace(s) ? null : s.Trim();

    private const string LeadSelect = """
        select l.*, u.full_name as salesperson_name, c.name as customer_name,
               (select count(*) from follow_ups f where f.ref_type = 'LEAD' and f.ref_id = l.id and f.done_at is null)::int as open_follow_ups
        from leads l left join users u on u.id = l.salesperson_id left join customers c on c.id = l.customer_id
        """;

    public async Task<PagedResult<Lead>> LeadsAsync(ListQuery q, long? salespersonId = null)
    {
        session.Demand(Perm.LeadView);
        var where = """
            where (@Status::text is null or l.status = @Status or (@Status = 'OPEN' and l.status not in ('CONVERTED','LOST')))
              and (@salespersonId::bigint is null or l.salesperson_id = @salespersonId)
              and (@Search::text is null or l.number ilike '%' || @Search || '%' or l.name ilike '%' || @Search || '%' or l.mobile like '%' || @Search || '%'
                   or l.interested_products ilike '%' || @Search || '%' or l.city ilike '%' || @Search || '%')
            """;
        var args = new { q.Status, salespersonId, Search = Blank(q.Search), q.PageSize, q.Offset };
        await using var conn = await db.OpenAsync();
        var total = await conn.ExecuteScalarAsync<int>($"select count(*) from leads l {where}", args);
        var rows = (await conn.QueryAsync<Lead>($"{LeadSelect} {where} order by l.next_follow_up nulls last, l.updated_at desc limit @PageSize offset @Offset", args)).AsList();
        return new PagedResult<Lead> { Items = rows, TotalCount = total, Page = q.Page, PageSize = q.PageSize };
    }

    public async Task<IReadOnlyList<LeadPipeline>> PipelineAsync(long? salespersonId = null)
    {
        session.Demand(Perm.LeadView);
        return await db.QueryAsync<LeadPipeline>("""
            select status, count(*)::int as count, coalesce(sum(expected_value), 0) as value from leads
            where (@salespersonId::bigint is null or salesperson_id = @salespersonId)
              and (status not in ('CONVERTED','LOST') or updated_at > now() - interval '30 days')
            group by status
            """, new { salespersonId });
    }

    public async Task<Lead> LeadAsync(long id)
    {
        session.Demand(Perm.LeadView);
        return (await db.QueryAsync<Lead>($"{LeadSelect} where l.id = @id", new { id })).FirstOrDefault() ?? throw new NotFoundException("Lead", id);
    }

    public Task<IReadOnlyList<StatusHistoryEntry>> LeadHistoryAsync(long id) => History.ForAsync(db, DocType.Lead, id);

    public async Task<long> SaveLeadAsync(Lead l)
    {
        session.Demand(Perm.LeadManage);
        new ValidationBuilder().Require(l.Name, nameof(l.Name), "Name")
            .Optional(l.Mobile, Validators.IsValidMobile, nameof(l.Mobile), "Enter a 10-digit mobile number.")
            .Optional(l.Email, Validators.IsValidEmail, nameof(l.Email), "Email is not valid.")
            .Check(l.ExpectedValue >= 0, nameof(l.ExpectedValue), "Value cannot be negative.").ThrowIfInvalid();
        return await db.InTransactionAsync(async (conn, tx) =>
        {
            var mobile = Validators.Clean(l.Mobile) is { } m ? Validators.NormaliseMobile(m) : null;
            if (l.Id == 0 && mobile is not null)
            {
                var dup = await conn.ExecuteScalarAsync<string?>("select number from leads where mobile = @mobile and status not in ('CONVERTED','LOST')", new { mobile }, tx);
                if (dup is not null) throw new ValidationException("Mobile", $"An open lead ({dup}) already has this mobile number.");
            }
            long id; string number;
            var args = new { l.Id, Name = l.Name.Trim(), mobile, Email = Blank(l.Email), City = Blank(l.City), Source = Blank(l.Source), SalespersonId = l.SalespersonId ?? session.UserId,
                InterestedProducts = Blank(l.InterestedProducts), l.ExpectedValue, l.NextFollowUp, Notes = Blank(l.Notes) };
            if (l.Id == 0)
            {
                number = await SequenceService.NextAsync(conn, tx, DocType.Lead);
                id = await conn.ExecuteScalarAsync<long>("""
                    insert into leads (number, name, mobile, email, city, source, salesperson_id, interested_products, expected_value, next_follow_up, notes, created_by)
                    values (@number, @Name, @mobile, @Email, @City, @Source, @SalespersonId, @InterestedProducts, @ExpectedValue, @NextFollowUp, @Notes, @uid) returning id
                    """, new DynamicParameters(args).With("number", number).With("uid", session.UserId), tx);
                await SalesDocumentBuilder.AddStatusHistoryAsync(conn, tx, DocType.Lead, id, null, LeadStatus.New, args.Source is null ? null : $"Source: {args.Source}", session.UserId);
                if (l.NextFollowUp is { } due)
                    await AddFollowUpAsync(conn, tx, new FollowUpInput { RefType = "LEAD", RefId = id, Title = $"Call {args.Name}", DueDate = due, AssignedTo = args.SalespersonId });
            }
            else
            {
                number = await conn.ExecuteScalarAsync<string>("select number from leads where id = @Id for update", args, tx) ?? throw new NotFoundException("Lead", l.Id);
                await conn.ExecuteAsync("""
                    update leads set name = @Name, mobile = @mobile, email = @Email, city = @City, source = @Source, salesperson_id = @SalespersonId,
                        interested_products = @InterestedProducts, expected_value = @ExpectedValue, next_follow_up = @NextFollowUp, notes = @Notes, updated_at = now()
                    where id = @Id
                    """, args, tx);
                id = l.Id;
            }
            await audit.LogAsync(conn, tx, l.Id == 0 ? "CREATE" : "UPDATE", "Customers", $"saved lead {number} — {args.Name}", "lead", id, number);
            return id;
        });
    }

    public async Task MoveLeadAsync(long id, string status, string? note, string? lostReason = null)
    {
        session.Demand(Perm.LeadManage);
        if (!LeadStatus.Flow.Contains(status) && status != LeadStatus.Lost) throw new ValidationException("Status", "Unknown stage.");
        if (status == LeadStatus.Converted) throw new ValidationException("Status", "Use Convert to turn the lead into a customer.");
        if (status == LeadStatus.Lost && string.IsNullOrWhiteSpace(lostReason)) throw new ValidationException("LostReason", "Why was the lead lost?");
        await db.InTransactionAsync(async (conn, tx) =>
        {
            var cur = await conn.QuerySingleOrDefaultAsync<Lead>("select * from leads where id = @id for update", new { id }, tx) ?? throw new NotFoundException("Lead", id);
            if (cur.Status is LeadStatus.Converted) throw new BusinessRuleException("This lead is already a customer.");
            if (cur.Status == status) return;
            await conn.ExecuteAsync("update leads set status = @status, lost_reason = @lost, updated_at = now() where id = @id",
                new { status, lost = status == LeadStatus.Lost ? lostReason!.Trim() : null, id }, tx);
            if (status == LeadStatus.Lost)
                await conn.ExecuteAsync("update follow_ups set done_at = now(), outcome = 'Lead lost' where ref_type = 'LEAD' and ref_id = @id and done_at is null", new { id }, tx);
            await SalesDocumentBuilder.AddStatusHistoryAsync(conn, tx, DocType.Lead, id, cur.Status, status, status == LeadStatus.Lost ? lostReason : Blank(note), session.UserId);
            await audit.LogAsync(conn, tx, "STATUS", "Customers", $"moved lead {cur.Number} to {status.ToLowerInvariant()}", "lead", id, cur.Number);
        });
    }

    /// <summary>
    /// Turns the lead into a customer (or links an existing customer with the same mobile) so quotations and orders can be made.
    /// <paramref name="keepOpen"/> keeps the lead in the pipeline (e.g. quotation stage) instead of marking it converted.
    /// </summary>
    public async Task<long> ConvertAsync(long id, bool keepOpen = false)
    {
        session.Demand(Perm.LeadManage);
        session.Demand(Perm.CustomerManage);
        var lead = await LeadAsync(id);
        if (lead.Status == LeadStatus.Lost) throw new BusinessRuleException("Reopen the lead before converting it.");
        var customerId = lead.CustomerId;
        if (customerId is null && lead.Mobile is not null)
            customerId = await db.ScalarAsync<long?>("select id from customers where mobile = @Mobile and not is_deleted limit 1", lead);
        customerId ??= await customers.SaveAsync(new Customer { Name = lead.Name, Mobile = lead.Mobile, Email = lead.Email, City = lead.City, Notes = lead.InterestedProducts is null ? null : $"Interested in: {lead.InterestedProducts}" });
        await db.InTransactionAsync(async (conn, tx) =>
        {
            var status = keepOpen ? (lead.Status is LeadStatus.New or LeadStatus.Contacted ? LeadStatus.Quotation : lead.Status) : LeadStatus.Converted;
            await conn.ExecuteAsync("update leads set customer_id = @customerId, status = @status, updated_at = now() where id = @id", new { customerId, status, id }, tx);
            await conn.ExecuteAsync("update follow_ups set customer_id = @customerId where ref_type = 'LEAD' and ref_id = @id", new { customerId, id }, tx);
            if (status != lead.Status)
                await SalesDocumentBuilder.AddStatusHistoryAsync(conn, tx, DocType.Lead, id, lead.Status, status, keepOpen ? "Customer created for quotation" : "Converted to customer", session.UserId);
            await audit.LogAsync(conn, tx, "CONVERT", "Customers", $"linked lead {lead.Number} to a customer record", "lead", id, lead.Number);
        });
        return customerId.Value;
    }

    // ------------------------------------------------------------------ follow-ups
    private const string FollowSelect = """
        select f.*, u.full_name as assigned_name, cb.full_name as created_by_name,
               coalesce(c.name, l.name) as customer_name, coalesce(c.mobile, l.mobile) as mobile,
               case f.ref_type when 'LEAD' then l.number when 'QUOTATION' then q.number when 'INVOICE' then i.number when 'SALES_ORDER' then so.number
                    when 'CUSTOM_ORDER' then co.number when 'SERVICE' then st.number when 'CUSTOMER' then c.name end as ref_label
        from follow_ups f
        left join users u on u.id = f.assigned_to left join users cb on cb.id = f.created_by
        left join leads l on f.ref_type = 'LEAD' and l.id = f.ref_id
        left join quotations q on f.ref_type = 'QUOTATION' and q.id = f.ref_id
        left join invoices i on f.ref_type = 'INVOICE' and i.id = f.ref_id
        left join sales_orders so on f.ref_type = 'SALES_ORDER' and so.id = f.ref_id
        left join custom_orders co on f.ref_type = 'CUSTOM_ORDER' and co.id = f.ref_id
        left join service_tickets st on f.ref_type = 'SERVICE' and st.id = f.ref_id
        left join customers c on c.id = coalesce(f.customer_id, q.customer_id, i.customer_id, so.customer_id, co.customer_id, st.customer_id)
        """;

    /// <param name="scope">today (due today + overdue), upcoming, done, all</param>
    public async Task<IReadOnlyList<FollowUp>> FollowUpsAsync(string scope = "today", bool mine = false, string? refType = null, long? refId = null, int limit = 200, long? customerId = null)
    {
        session.DemandAny(Perm.LeadView, Perm.CustomerView);
        var where = scope switch
        {
            "today" => "f.done_at is null and f.due_date <= current_date",
            "upcoming" => "f.done_at is null and f.due_date > current_date",
            "done" => "f.done_at is not null",
            _ => "true",
        };
        return await db.QueryAsync<FollowUp>($"""
            {FollowSelect}
            where {where} and (not @mine or f.assigned_to = @uid) and (@refType::text is null or (f.ref_type = @refType and f.ref_id = @refId))
              and (@customerId::bigint is null or c.id = @customerId)
            order by case when f.done_at is null then 0 else 1 end, f.due_date {(scope == "done" ? "desc" : "asc")}, f.id
            limit @limit
            """, new { mine, uid = session.UserId, refType, refId, limit, customerId });
    }

    public async Task<long> AddFollowUpAsync(FollowUpInput input)
    {
        session.DemandAny(Perm.LeadManage, Perm.CustomerManage);
        return await db.InTransactionAsync(async (conn, tx) => await AddFollowUpAsync(conn, tx, input));
    }

    private async Task<long> AddFollowUpAsync(NpgsqlConnection conn, NpgsqlTransaction tx, FollowUpInput input)
    {
        if (string.IsNullOrWhiteSpace(input.Title)) throw new ValidationException("Title", "What needs to happen?");
        var customerId = input.RefType switch
        {
            "CUSTOMER" => input.RefId,
            "LEAD" => await conn.ExecuteScalarAsync<long?>("select customer_id from leads where id = @RefId", input, tx),
            "QUOTATION" => await conn.ExecuteScalarAsync<long?>("select customer_id from quotations where id = @RefId", input, tx),
            "INVOICE" => await conn.ExecuteScalarAsync<long?>("select customer_id from invoices where id = @RefId", input, tx),
            "SALES_ORDER" => await conn.ExecuteScalarAsync<long?>("select customer_id from sales_orders where id = @RefId", input, tx),
            "CUSTOM_ORDER" => await conn.ExecuteScalarAsync<long?>("select customer_id from custom_orders where id = @RefId", input, tx),
            "SERVICE" => await conn.ExecuteScalarAsync<long?>("select customer_id from service_tickets where id = @RefId", input, tx),
            _ => throw new ValidationException("RefType", "Unknown record type."),
        };
        var id = await conn.ExecuteScalarAsync<long>("""
            insert into follow_ups (ref_type, ref_id, customer_id, title, due_date, assigned_to, note, created_by)
            values (@RefType, @RefId, @customerId, @Title, @DueDate, @AssignedTo, @Note, @uid) returning id
            """, new { input.RefType, input.RefId, customerId, Title = input.Title.Trim(), DueDate = input.DueDate.Date, AssignedTo = input.AssignedTo ?? session.UserId, Note = Blank(input.Note), uid = session.UserId }, tx);
        if (input.RefType == "LEAD")
            await conn.ExecuteAsync("""
                update leads set next_follow_up = (select min(due_date) from follow_ups where ref_type = 'LEAD' and ref_id = @RefId and done_at is null), updated_at = now() where id = @RefId
                """, input, tx);
        return id;
    }

    public async Task CompleteFollowUpAsync(long id, string? outcome, DateTime? nextDate = null, string? nextTitle = null)
    {
        session.DemandAny(Perm.LeadManage, Perm.CustomerManage);
        await db.InTransactionAsync(async (conn, tx) =>
        {
            var f = await conn.QuerySingleOrDefaultAsync<FollowUp>("select * from follow_ups where id = @id for update", new { id }, tx) ?? throw new NotFoundException("Follow-up", id);
            if (f.DoneAt is not null) throw new BusinessRuleException("This follow-up is already done.");
            await conn.ExecuteAsync("update follow_ups set done_at = now(), outcome = @outcome where id = @id", new { outcome = Blank(outcome), id }, tx);
            if (nextDate is { } d)
                await AddFollowUpAsync(conn, tx, new FollowUpInput { RefType = f.RefType, RefId = f.RefId, Title = Blank(nextTitle) ?? f.Title, DueDate = d, AssignedTo = f.AssignedTo });
            else if (f.RefType == "LEAD")
                await conn.ExecuteAsync("""
                    update leads set next_follow_up = (select min(due_date) from follow_ups where ref_type = 'LEAD' and ref_id = @RefId and done_at is null), updated_at = now() where id = @RefId
                    """, f, tx);
            if (f.RefType == "LEAD" && Blank(outcome) is { } o)
                await SalesDocumentBuilder.AddStatusHistoryAsync(conn, tx, DocType.Lead, f.RefId, null, "NOTE", $"{f.Title}: {o}", session.UserId);
        });
    }
}
