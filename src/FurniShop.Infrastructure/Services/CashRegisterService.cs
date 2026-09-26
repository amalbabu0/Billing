using Dapper;
using FurniShop.Core;
using FurniShop.Core.Domain;
using FurniShop.Core.Security;
using FurniShop.Infrastructure.Database;
using FurniShop.Infrastructure.Security;
using Npgsql;

namespace FurniShop.Infrastructure.Services;

public sealed class CashSession
{
    public long Id { get; set; }
    public DateTime BusinessDate { get; set; }
    public decimal OpeningCash { get; set; }
    public string? OpenedByName { get; set; }
    public DateTime OpenedAt { get; set; }
    public decimal? CashSales { get; set; }
    public decimal? CashRefunds { get; set; }
    public decimal? CashExpenses { get; set; }
    public decimal? CashSupplier { get; set; }
    public decimal? ExpectedCash { get; set; }
    public decimal? CountedCash { get; set; }
    public decimal? Difference { get; set; }
    public string Status { get; set; } = "OPEN";
    public string? ClosedByName { get; set; }
    public DateTime? ClosedAt { get; set; }
    public string? CloseNote { get; set; }
    public string? ApprovedByName { get; set; }
    public DateTime? ApprovedAt { get; set; }
    public string? ApprovalNote { get; set; }
    /// <summary>True when a difference is waiting for a manager's approval.</summary>
    public bool NeedsApproval => Status == "CLOSED";
}

public sealed class CashFigures
{
    public DateTime Date { get; set; }
    public decimal CashSales { get; set; }
    public decimal CashRefunds { get; set; }
    public decimal CashExpenses { get; set; }
    public decimal CashSupplier { get; set; }
    public int Receipts { get; set; }
    public decimal NonCash { get; set; }
    public decimal Net => CashSales - CashRefunds - CashExpenses - CashSupplier;
}

public sealed class CashDay
{
    public CashSession? Session { get; set; }
    public CashFigures Figures { get; set; } = new();
    public decimal? SuggestedOpening { get; set; }
    public decimal? Expected => Session is null ? null : Session.OpeningCash + Figures.Net;
    public List<CashMovementRow> Movements { get; set; } = new();
}

public sealed class CashMovementRow
{
    public DateTime At { get; set; }
    public string Kind { get; set; } = "";
    public string? Number { get; set; }
    public string? Party { get; set; }
    public decimal Amount { get; set; }
    public string? ByName { get; set; }
}

/// <summary>
/// Daily cash drawer: open with the float, and at closing compare the counted cash with what the books say
/// (opening + cash receipts − cash refunds − cash expenses − cash paid to suppliers). A difference needs approval.
/// </summary>
public sealed class CashRegisterService(Db db, UserSession session, AuditService audit)
{
    private static Task<CashFigures> FiguresAsync(NpgsqlConnection conn, NpgsqlTransaction? tx, DateTime date) =>
        conn.QuerySingleAsync<CashFigures>("""
            select @date::date as date,
                   coalesce((select sum(pl.amount) from payment_lines pl join payments p on p.id = pl.payment_id
                             where p.direction = 'IN' and not p.is_voided and p.payment_date = @date and pl.method_code = 'CASH'), 0) as cash_sales,
                   coalesce((select sum(pl.amount) from payment_lines pl join payments p on p.id = pl.payment_id
                             where p.direction = 'OUT' and not p.is_voided and p.payment_date = @date and pl.method_code = 'CASH'), 0) as cash_refunds,
                   coalesce((select sum(amount) from expenses where not is_deleted and expense_date = @date and method_code = 'CASH'), 0) as cash_expenses,
                   coalesce((select sum(amount) from supplier_payments where not is_voided and payment_date = @date and method_code = 'CASH'), 0) as cash_supplier,
                   (select count(*) from payments p where p.direction = 'IN' and not p.is_voided and p.payment_date = @date)::int as receipts,
                   coalesce((select sum(pl.amount) from payment_lines pl join payments p on p.id = pl.payment_id
                             join payment_methods m on m.code = pl.method_code and m.is_money
                             where p.direction = 'IN' and not p.is_voided and p.payment_date = @date and pl.method_code <> 'CASH'), 0) as non_cash
            """, new { date = date.Date }, tx);

    private const string SessionSelect = """
        select s.*, o.full_name as opened_by_name, c.full_name as closed_by_name, a.full_name as approved_by_name
        from cash_sessions s left join users o on o.id = s.opened_by left join users c on c.id = s.closed_by left join users a on a.id = s.approved_by
        """;

    public async Task<CashDay> DayAsync(DateTime? date = null)
    {
        session.DemandAny(Perm.CashManage, Perm.CashApprove);
        var d = (date ?? DateTime.Today).Date;
        await using var conn = await db.OpenAsync();
        var day = new CashDay
        {
            Session = await conn.QuerySingleOrDefaultAsync<CashSession>($"{SessionSelect} where s.business_date = @d", new { d }),
            Figures = await FiguresAsync(conn, null, d),
        };
        day.SuggestedOpening = await conn.ExecuteScalarAsync<decimal?>("select counted_cash from cash_sessions where business_date < @d and counted_cash is not null order by business_date desc limit 1", new { d });
        day.Movements = (await conn.QueryAsync<CashMovementRow>("""
            select p.created_at as at, case p.direction when 'IN' then 'Receipt' else 'Refund' end as kind, p.number, c.name as party,
                   case p.direction when 'IN' then pl.amount else -pl.amount end as amount, u.full_name as by_name
            from payment_lines pl join payments p on p.id = pl.payment_id join customers c on c.id = p.customer_id left join users u on u.id = p.created_by
            where not p.is_voided and p.payment_date = @d and pl.method_code = 'CASH'
            union all
            select e.created_at, 'Expense', e.number, ec.name, -e.amount, u.full_name
            from expenses e join expense_categories ec on ec.id = e.category_id left join users u on u.id = e.created_by
            where not e.is_deleted and e.expense_date = @d and e.method_code = 'CASH'
            union all
            select sp.created_at, 'Supplier payment', sp.number, s.name, -sp.amount, u.full_name
            from supplier_payments sp join suppliers s on s.id = sp.supplier_id left join users u on u.id = sp.created_by
            where not sp.is_voided and sp.payment_date = @d and sp.method_code = 'CASH'
            order by 1
            """, new { d })).AsList();
        return day;
    }

    public async Task<IReadOnlyList<CashSession>> HistoryAsync(int days = 60)
    {
        session.DemandAny(Perm.CashManage, Perm.CashApprove);
        return await db.QueryAsync<CashSession>($"{SessionSelect} where s.business_date >= current_date - @days order by s.business_date desc", new { days });
    }

    public async Task<long> OpenAsync(decimal openingCash, DateTime? date = null)
    {
        session.Demand(Perm.CashManage);
        if (openingCash < 0) throw new ValidationException("OpeningCash", "Opening cash cannot be negative.");
        var d = (date ?? DateTime.Today).Date;
        if (d > DateTime.Today) throw new ValidationException("Date", "Cannot open a future day.");
        return await db.InTransactionAsync(async (conn, tx) =>
        {
            if (await conn.ExecuteScalarAsync<bool>("select exists(select 1 from cash_sessions where business_date = @d)", new { d }, tx))
                throw new BusinessRuleException($"The register for {d:dd-MMM-yyyy} is already open.");
            var id = await conn.ExecuteScalarAsync<long>("insert into cash_sessions (business_date, opening_cash, opened_by) values (@d, @openingCash, @uid) returning id",
                new { d, openingCash, uid = session.UserId }, tx);
            await audit.LogAsync(conn, tx, "OPEN", "Payments", $"opened cash register for {d:dd-MMM-yyyy} with {Money.Format(openingCash)}", "cash_session", id, d.ToString("yyyy-MM-dd"));
            return id;
        });
    }

    /// <summary>Records the counted cash. No difference → approved straight away; otherwise it waits for approval.</summary>
    public async Task<CashSession> CloseAsync(DateTime date, decimal countedCash, string? note)
    {
        session.Demand(Perm.CashManage);
        if (countedCash < 0) throw new ValidationException("CountedCash", "Counted cash cannot be negative.");
        var d = date.Date;
        await db.InTransactionAsync(async (conn, tx) =>
        {
            var s = await conn.QuerySingleOrDefaultAsync<CashSession>("select * from cash_sessions where business_date = @d for update", new { d }, tx)
                    ?? throw new BusinessRuleException("Open the register for this day first.");
            if (s.Status != "OPEN") throw new BusinessRuleException("This day is already closed.");
            var f = await FiguresAsync(conn, tx, d);
            var expected = s.OpeningCash + f.Net;
            var diff = countedCash - expected;
            if (diff != 0 && string.IsNullOrWhiteSpace(note)) throw new ValidationException("Note", "Explain the difference between counted and expected cash.");
            var status = diff == 0 ? "APPROVED" : "CLOSED";
            await conn.ExecuteAsync("""
                update cash_sessions set cash_sales = @CashSales, cash_refunds = @CashRefunds, cash_expenses = @CashExpenses, cash_supplier = @CashSupplier,
                    expected_cash = @expected, counted_cash = @countedCash, difference = @diff, status = @status, closed_by = @uid, closed_at = now(), close_note = @note,
                    approved_by = case when @status = 'APPROVED' then @uid end, approved_at = case when @status = 'APPROVED' then now() end
                where id = @Id
                """, new { f.CashSales, f.CashRefunds, f.CashExpenses, f.CashSupplier, expected, countedCash, diff, status, uid = session.UserId, note = string.IsNullOrWhiteSpace(note) ? null : note.Trim(), s.Id }, tx);
            await audit.LogAsync(conn, tx, "CLOSE", "Payments",
                $"closed cash register for {d:dd-MMM-yyyy}: expected {Money.Format(expected)}, counted {Money.Format(countedCash)}{(diff == 0 ? "" : $", difference {Money.Format(diff)}")}",
                "cash_session", s.Id, d.ToString("yyyy-MM-dd"), null, new { expected, countedCash, diff });
            if (diff != 0)
                await conn.ExecuteAsync("insert into notifications (kind, title, message, ref_type, ref_id) values ('CASH', 'Cash difference to approve', @msg, 'CASH_SESSION', @Id)",
                    new { msg = $"{d:dd-MMM}: counted {Money.Format(countedCash)} vs expected {Money.Format(expected)} ({(diff > 0 ? "excess" : "short")} {Money.Format(Math.Abs(diff))}).", s.Id }, tx);
        });
        return (await DayAsync(d)).Session!;
    }

    public async Task ApproveAsync(DateTime date, string? note)
    {
        session.Demand(Perm.CashApprove);
        var d = date.Date;
        await db.InTransactionAsync(async (conn, tx) =>
        {
            var s = await conn.QuerySingleOrDefaultAsync<CashSession>("select * from cash_sessions where business_date = @d for update", new { d }, tx) ?? throw new NotFoundException("Cash register day", 0);
            if (s.Status != "CLOSED") throw new BusinessRuleException(s.Status == "OPEN" ? "Close the day before approving." : "Already approved.");
            await conn.ExecuteAsync("update cash_sessions set status = 'APPROVED', approved_by = @uid, approved_at = now(), approval_note = @note where id = @Id",
                new { uid = session.UserId, note = string.IsNullOrWhiteSpace(note) ? null : note.Trim(), s.Id }, tx);
            await audit.LogAsync(conn, tx, "APPROVE", "Payments", $"approved cash difference of {Money.Format(s.Difference ?? 0)} for {d:dd-MMM-yyyy}", "cash_session", s.Id, d.ToString("yyyy-MM-dd"));
        });
    }

    /// <summary>Re-opens a closed (not yet approved) day, e.g. after finding a missed receipt.</summary>
    public async Task ReopenAsync(DateTime date, string reason)
    {
        session.Demand(Perm.CashApprove);
        if (string.IsNullOrWhiteSpace(reason)) throw new ValidationException("Reason", "Enter the reason.");
        var d = date.Date;
        await db.InTransactionAsync(async (conn, tx) =>
        {
            var s = await conn.QuerySingleOrDefaultAsync<CashSession>("select * from cash_sessions where business_date = @d for update", new { d }, tx) ?? throw new NotFoundException("Cash register day", 0);
            if (s.Status == "OPEN") throw new BusinessRuleException("This day is still open.");
            await conn.ExecuteAsync("""
                update cash_sessions set status = 'OPEN', counted_cash = null, difference = null, expected_cash = null, closed_by = null, closed_at = null,
                    approved_by = null, approved_at = null, close_note = null where id = @Id
                """, s, tx);
            await audit.LogAsync(conn, tx, "REOPEN", "Payments", $"re-opened cash register for {d:dd-MMM-yyyy} — {reason}", "cash_session", s.Id, d.ToString("yyyy-MM-dd"),
                new { s.Status, s.CountedCash, s.Difference }, null);
        });
    }
}
