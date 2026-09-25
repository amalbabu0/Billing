using Dapper;
using FurniShop.Core;
using FurniShop.Core.Domain;
using FurniShop.Core.Security;
using FurniShop.Core.Validation;
using FurniShop.Infrastructure.Database;
using FurniShop.Infrastructure.Security;
using Npgsql;

namespace FurniShop.Infrastructure.Services;

/// <summary>Customers, customer addresses and the customer ledger.</summary>
public sealed class CustomerService(Db db, UserSession session, AuditService audit)
{
    public async Task<PagedResult<Customer>> ListAsync(ListQuery q, bool onlyWithOutstanding = false)
    {
        session.Demand(Perm.CustomerView);
        var where = $"""
            where not c.is_deleted
              and (@Search::text is null or c.name ilike '%' || @Search || '%' or c.mobile like '%' || @Search || '%'
                   or c.code ilike '%' || @Search || '%' or c.gstin ilike '%' || @Search || '%' or c.city ilike '%' || @Search || '%')
              {(onlyWithOutstanding ? "and coalesce(b.outstanding,0) > 0" : "")}
            """;
        const string join = """
            left join (select customer_id, sum(grand_total) as total, sum(greatest(balance,0)) as outstanding, max(invoice_date) as last_date
                       from v_invoice_balances group by customer_id) b on b.customer_id = c.id
            """;
        var order = q.SortBy switch
        {
            "outstanding" => "coalesce(b.outstanding,0)", "purchases" => "coalesce(b.total,0)", "recent" => "b.last_date", "created" => "c.created_at", _ => "c.name",
        };
        var dir = q.SortBy is null ? "asc" : q.SortDescending ? "desc nulls last" : "asc";
        var args = new { Search = Blank(q.Search), q.PageSize, q.Offset };
        await using var conn = await db.OpenAsync();
        var total = await conn.ExecuteScalarAsync<int>($"select count(*) from customers c {join} {where}", args);
        var rows = await conn.QueryAsync<Customer>($"""
            select c.*, coalesce(b.total,0) as total_purchases, coalesce(b.outstanding,0) as outstanding, b.last_date as last_purchase_date
            from customers c {join} {where} order by c.is_walk_in desc, {order} {dir}, c.id limit @PageSize offset @Offset
            """, args);
        return new PagedResult<Customer> { Items = rows.AsList(), TotalCount = total, Page = q.Page, PageSize = q.PageSize };
    }

    /// <summary>Quick picker search (POS customer box): name, mobile, code.</summary>
    public async Task<IReadOnlyList<Customer>> SearchAsync(string? text, int limit = 20)
    {
        session.DemandAny(Perm.CustomerView, Perm.InvoiceCreate);
        return await db.QueryAsync<Customer>("""
            select * from customers where not is_deleted
              and (@t::text is null or name ilike '%' || @t || '%' or mobile like '%' || @t || '%' or code ilike @t)
            order by is_walk_in desc, name limit @limit
            """, new { t = Blank(text), limit });
    }

    public async Task<Customer> GetAsync(long id)
    {
        session.DemandAny(Perm.CustomerView, Perm.InvoiceCreate, Perm.DeliveryView);
        await using var conn = await db.OpenAsync();
        var c = await conn.QuerySingleOrDefaultAsync<Customer>("select * from customers where id = @id", new { id })
                ?? throw new NotFoundException("Customer", id);
        c.Addresses = (await conn.QueryAsync<CustomerAddress>("select * from customer_addresses where customer_id = @id order by is_default desc, id", new { id })).AsList();
        return c;
    }

    public Task<Customer> WalkInAsync() =>
        db.QuerySingleOrDefaultAsync<Customer>("select * from customers where is_walk_in and not is_deleted order by id limit 1")!;

    public async Task<long> SaveAsync(Customer c)
    {
        session.Demand(Perm.CustomerManage);
        c.Mobile = Validators.NormaliseMobile(c.Mobile) ?? Validators.Clean(c.Mobile);
        c.Whatsapp = Validators.NormaliseMobile(c.Whatsapp) ?? Validators.Clean(c.Whatsapp) ?? c.Mobile;
        c.Gstin = Validators.Clean(c.Gstin)?.ToUpperInvariant();
        c.Email = Validators.Clean(c.Email);
        c.Pincode = Validators.Clean(c.Pincode);
        if (c.StateCode is null && c.Gstin is { Length: >= 2 }) c.StateCode = c.Gstin[..2];
        c.State = IndianStates.NameOf(c.StateCode) ?? c.State;
        new ValidationBuilder()
            .Require(c.Name, nameof(c.Name), "Customer name")
            .Check(c.IsWalkIn || Validators.IsValidMobile(c.Mobile), nameof(c.Mobile), "Enter a valid 10-digit mobile number.")
            .Optional(c.Whatsapp, Validators.IsValidMobile, nameof(c.Whatsapp), "WhatsApp number is not valid.")
            .Optional(c.Email, Validators.IsValidEmail, nameof(c.Email), "Email is not valid.")
            .Optional(c.Pincode, Validators.IsValidPincode, nameof(c.Pincode), "PIN code must be 6 digits.")
            .Optional(c.Gstin, Validators.IsValidGstin, nameof(c.Gstin), "GSTIN is not valid (check the 15 characters).")
            .Check(c.Gstin is null || c.StateCode is null || c.Gstin[..2] == c.StateCode, nameof(c.StateCode), "State does not match the GSTIN state code.")
            .Check(c.CreditLimit >= 0, nameof(c.CreditLimit), "Credit limit cannot be negative.")
            .Check(c.Addresses.All(a => !string.IsNullOrWhiteSpace(a.Address)), "Addresses", "Every delivery address needs an address line.")
            .ThrowIfInvalid();
        c.Name = c.Name.Trim();

        return await db.InTransactionAsync(async (conn, tx) =>
        {
            if (c.Mobile is not null && !c.IsWalkIn)
            {
                var other = await conn.QuerySingleOrDefaultAsync<string>(
                    "select name from customers where mobile = @Mobile and id <> @Id and not is_deleted and not is_walk_in", c, tx);
                if (other is not null) throw new ValidationException(nameof(c.Mobile), $"This mobile number already belongs to {other}.");
            }
            Customer? old = null;
            if (c.Id == 0)
            {
                c.Code = await SequenceService.NextAsync(conn, tx, DocType.Customer);
                c.Id = await conn.ExecuteScalarAsync<long>("""
                    insert into customers (code, name, mobile, whatsapp, email, billing_address, city, state, state_code, pincode, gstin, notes, credit_limit, created_by)
                    values (@Code, @Name, @Mobile, @Whatsapp, @Email, @BillingAddress, @City, @State, @StateCode, @Pincode, @Gstin, @Notes, @CreditLimit, @CreatedBy) returning id
                    """, new { c.Code, c.Name, c.Mobile, c.Whatsapp, c.Email, c.BillingAddress, c.City, c.State, c.StateCode, c.Pincode, c.Gstin, c.Notes, c.CreditLimit, CreatedBy = session.UserId }, tx);
            }
            else
            {
                old = await conn.QuerySingleOrDefaultAsync<Customer>("select * from customers where id = @Id and not is_deleted for update", c, tx)
                      ?? throw new NotFoundException("Customer", c.Id);
                if (old.IsWalkIn) { c.IsWalkIn = true; }
                await conn.ExecuteAsync("""
                    update customers set name=@Name, mobile=@Mobile, whatsapp=@Whatsapp, email=@Email, billing_address=@BillingAddress, city=@City,
                        state=@State, state_code=@StateCode, pincode=@Pincode, gstin=@Gstin, notes=@Notes, credit_limit=@CreditLimit, updated_at=now()
                    where id=@Id
                    """, c, tx);
            }

            var keep = new List<long>();
            if (c.Addresses.Count(a => a.IsDefault) != 1 && c.Addresses.Count > 0)
            {
                c.Addresses.ForEach(a => a.IsDefault = false);
                c.Addresses[0].IsDefault = true;
            }
            foreach (var a in c.Addresses)
            {
                a.CustomerId = c.Id;
                a.State = IndianStates.NameOf(a.StateCode) ?? a.State;
                if (a.Id == 0)
                    a.Id = await conn.ExecuteScalarAsync<long>("""
                        insert into customer_addresses (customer_id, label, address, city, state, state_code, pincode, landmark, is_default)
                        values (@CustomerId, @Label, @Address, @City, @State, @StateCode, @Pincode, @Landmark, @IsDefault) returning id
                        """, a, tx);
                else
                    await conn.ExecuteAsync("""
                        update customer_addresses set label=@Label, address=@Address, city=@City, state=@State, state_code=@StateCode, pincode=@Pincode,
                            landmark=@Landmark, is_default=@IsDefault where id=@Id and customer_id=@CustomerId
                        """, a, tx);
                keep.Add(a.Id);
            }
            await conn.ExecuteAsync("delete from customer_addresses where customer_id = @id and not (id = any(@keep))", new { id = c.Id, keep = keep.ToArray() }, tx);

            await audit.LogAsync(conn, tx, old is null ? "CREATE" : "UPDATE", "Customers",
                $"{(old is null ? "created" : "updated")} customer {c.Name} ({c.Code})", "customer", c.Id, c.Code, Snapshot(old), Snapshot(c));
            return c.Id;
        });
    }

    private static object? Snapshot(Customer? c) => c is null ? null : new { c.Name, c.Mobile, c.Whatsapp, c.Email, c.BillingAddress, c.StateCode, c.Pincode, c.Gstin, c.CreditLimit };

    /// <summary>Soft delete. Customers with any financial history cannot be deleted.</summary>
    public async Task DeleteAsync(long id)
    {
        session.Demand(Perm.CustomerDelete);
        await db.InTransactionAsync(async (conn, tx) =>
        {
            var c = await conn.QuerySingleOrDefaultAsync<Customer>("select * from customers where id = @id and not is_deleted for update", new { id }, tx)
                    ?? throw new NotFoundException("Customer", id);
            if (c.IsWalkIn) throw new BusinessRuleException("The walk-in customer cannot be deleted.");
            var docs = await conn.ExecuteScalarAsync<int>("""
                select (select count(*) from invoices where customer_id = @id and status <> 'DRAFT')
                     + (select count(*) from payments where customer_id = @id)
                     + (select count(*) from sales_orders where customer_id = @id and status not in ('CANCELLED'))
                     + (select count(*) from custom_orders where customer_id = @id and status not in ('CANCELLED'))
                """, new { id }, tx);
            if (docs > 0) throw new BusinessRuleException("This customer has invoices, orders or payments and cannot be deleted. The history must be kept.");
            await conn.ExecuteAsync("update customers set is_deleted = true, deleted_at = now() where id = @id", new { id }, tx);
            await audit.LogAsync(conn, tx, "DELETE", "Customers", $"deleted customer {c.Name} ({c.Code})", "customer", id, c.Code, Snapshot(c), null);
        });
    }

    public async Task<CustomerSummary> SummaryAsync(long customerId)
    {
        session.DemandAny(Perm.CustomerView, Perm.PaymentView);
        await using var conn = await db.OpenAsync();
        return await SummaryAsync(conn, null, customerId);
    }

    internal static Task<CustomerSummary> SummaryAsync(NpgsqlConnection conn, NpgsqlTransaction? tx, long customerId) =>
        conn.QuerySingleAsync<CustomerSummary>("""
            select @customerId as customer_id,
                coalesce((select sum(grand_total) from v_invoice_balances where customer_id = @customerId),0) as total_purchases,
                coalesce((select sum(returned_amount) from v_invoice_balances where customer_id = @customerId),0) as total_returns,
                coalesce((select sum(case when direction='IN' then amount else -amount end) from payments where customer_id = @customerId and not is_voided),0) as total_paid,
                coalesce((select sum(balance) from v_invoice_balances where customer_id = @customerId and balance > 0),0) as outstanding,
                coalesce((select sum(case when p.direction='IN' then a.amount else -a.amount end)
                          from payment_allocations a join payments p on p.id = a.payment_id and not p.is_voided
                          where p.customer_id = @customerId and a.doc_type <> 'INVOICE'),0) as advance_amount,
                (select count(*) from invoices where customer_id = @customerId and status = 'FINAL') as invoice_count,
                (select count(*) from sales_orders where customer_id = @customerId and status not in ('COMPLETED','CANCELLED')) as open_order_count,
                (select count(*) from custom_orders where customer_id = @customerId) as custom_order_count
            """, new { customerId }, tx);

    /// <summary>
    /// Customer ledger: invoices and refunds are debits; payments and returns are credits.
    /// A positive running balance means the customer owes the shop; negative means an advance is held.
    /// </summary>
    public async Task<IReadOnlyList<LedgerEntry>> LedgerAsync(long customerId, DateTime? from = null, DateTime? to = null)
    {
        session.DemandAny(Perm.CustomerView, Perm.PaymentView);
        await using var conn = await db.OpenAsync();
        var rows = (await conn.QueryAsync<LedgerEntry>("""
            select * from (
                select invoice_date as date, 'INVOICE' as doc_type, number as doc_number, id as doc_id,
                       'Sales invoice' || coalesce(' (from ' || (select so.number from sales_orders so where so.id = i.sales_order_id) || ')', '') as particulars,
                       grand_total as debit, 0::numeric as credit, finalized_at as created_at
                from invoices i where customer_id = @customerId and status in ('FINAL','CANCELLED')
                union all
                select cancelled_at::date, 'CANCEL', number, id, 'Invoice cancelled: ' || coalesce(cancel_reason,''), 0, grand_total, cancelled_at
                from invoices where customer_id = @customerId and status = 'CANCELLED'
                union all
                select payment_date, case when direction = 'IN' then 'PAYMENT' else 'REFUND' end, number, id,
                       case when direction = 'IN' then 'Payment received' else 'Refund paid' end || ' — ' ||
                       (select string_agg(pm.name || ' ' || to_char(l.amount, 'FM99,99,99,990.00'), ', ') from payment_lines l join payment_methods pm on pm.code = l.method_code where l.payment_id = p.id)
                       || coalesce(' — ' || (select string_agg(distinct coalesce(i.number, so.number, co.number, 'On account'), ', ')
                                             from payment_allocations a
                                             left join invoices i on a.doc_type = 'INVOICE' and i.id = a.doc_id
                                             left join sales_orders so on a.doc_type = 'SALES_ORDER' and so.id = a.doc_id
                                             left join custom_orders co on a.doc_type = 'CUSTOM_ORDER' and co.id = a.doc_id
                                             where a.payment_id = p.id and a.amount > 0), ''),
                       case when direction = 'OUT' then amount else 0 end, case when direction = 'IN' then amount else 0 end, created_at
                from payments p where customer_id = @customerId and not is_voided
                union all
                select return_date, 'RETURN', number, id, 'Goods returned against ' || (select number from invoices where id = r.invoice_id), 0, credit_amount, created_at
                from sales_returns r where customer_id = @customerId
            ) x order by date, created_at, doc_number
            """, new { customerId })).AsList();

        decimal running = 0;
        foreach (var r in rows) { running += r.Debit - r.Credit; r.Balance = running; }
        if (from.HasValue || to.HasValue)
        {
            var opening = rows.Where(r => from.HasValue && r.Date < from.Value.Date).Sum(r => r.Debit - r.Credit);
            var filtered = rows.Where(r => (!from.HasValue || r.Date >= from.Value.Date) && (!to.HasValue || r.Date <= to.Value.Date)).ToList();
            if (from.HasValue)
                filtered.Insert(0, new LedgerEntry { Date = from.Value.Date, DocType = "OPENING", DocNumber = "", Particulars = "Opening balance", Debit = Math.Max(opening, 0), Credit = Math.Max(-opening, 0), Balance = opening });
            return filtered;
        }
        return rows;
    }

    private static string? Blank(string? s) => string.IsNullOrWhiteSpace(s) ? null : s.Trim();
}

/// <summary>Suppliers and supplier ledger.</summary>
public sealed class SupplierService(Db db, UserSession session, AuditService audit)
{
    private const string Aggregates = """
        left join (select supplier_id, sum(grand_total - returned_total) as total from purchases where status = 'COMPLETED' group by supplier_id) pu on pu.supplier_id = s.id
        left join (select supplier_id, sum(amount) as paid from supplier_payments where not is_voided group by supplier_id) pa on pa.supplier_id = s.id
        """;

    public async Task<PagedResult<Supplier>> ListAsync(ListQuery q)
    {
        session.DemandAny(Perm.SupplierView, Perm.PurchaseView);
        var where = """
            where not s.is_deleted and (@Search::text is null or s.name ilike '%' || @Search || '%' or s.mobile like '%' || @Search || '%'
                  or s.code ilike '%' || @Search || '%' or s.gstin ilike '%' || @Search || '%')
            """;
        var args = new { Search = Blank(q.Search), q.PageSize, q.Offset };
        await using var conn = await db.OpenAsync();
        var total = await conn.ExecuteScalarAsync<int>($"select count(*) from suppliers s {where}", args);
        var order = q.SortBy == "outstanding" ? "coalesce(pu.total,0) - coalesce(pa.paid,0) desc" : "s.name";
        var rows = await conn.QueryAsync<Supplier>($"""
            select s.*, coalesce(pu.total,0) as total_purchases, coalesce(pa.paid,0) as total_paid, coalesce(pu.total,0) - coalesce(pa.paid,0) as outstanding
            from suppliers s {Aggregates} {where} order by {order} limit @PageSize offset @Offset
            """, args);
        return new PagedResult<Supplier> { Items = rows.AsList(), TotalCount = total, Page = q.Page, PageSize = q.PageSize };
    }

    public async Task<Supplier> GetAsync(long id)
    {
        session.DemandAny(Perm.SupplierView, Perm.PurchaseView);
        return await db.QuerySingleOrDefaultAsync<Supplier>($"""
            select s.*, coalesce(pu.total,0) as total_purchases, coalesce(pa.paid,0) as total_paid, coalesce(pu.total,0) - coalesce(pa.paid,0) as outstanding
            from suppliers s {Aggregates} where s.id = @id
            """, new { id }) ?? throw new NotFoundException("Supplier", id);
    }

    public async Task<long> SaveAsync(Supplier s)
    {
        session.Demand(Perm.SupplierManage);
        s.Mobile = Validators.NormaliseMobile(s.Mobile) ?? Validators.Clean(s.Mobile);
        s.Whatsapp = Validators.NormaliseMobile(s.Whatsapp) ?? Validators.Clean(s.Whatsapp);
        s.Gstin = Validators.Clean(s.Gstin)?.ToUpperInvariant();
        if (s.StateCode is null && s.Gstin is { Length: >= 2 }) s.StateCode = s.Gstin[..2];
        s.State = IndianStates.NameOf(s.StateCode) ?? s.State;
        new ValidationBuilder()
            .Require(s.Name, nameof(s.Name), "Supplier name")
            .Optional(s.Mobile, Validators.IsValidMobile, nameof(s.Mobile), "Mobile number is not valid.")
            .Optional(s.Email, Validators.IsValidEmail, nameof(s.Email), "Email is not valid.")
            .Optional(s.Gstin, Validators.IsValidGstin, nameof(s.Gstin), "GSTIN is not valid.")
            .Optional(s.BankIfsc, v => System.Text.RegularExpressions.Regex.IsMatch(v.Trim().ToUpperInvariant(), "^[A-Z]{4}0[A-Z0-9]{6}$"), nameof(s.BankIfsc), "IFSC must look like SBIN0001234.")
            .ThrowIfInvalid();
        s.Name = s.Name.Trim();
        s.BankIfsc = Validators.Clean(s.BankIfsc)?.ToUpperInvariant();

        return await db.InTransactionAsync(async (conn, tx) =>
        {
            Supplier? old = null;
            if (s.Id == 0)
            {
                s.Code = await SequenceService.NextAsync(conn, tx, DocType.Supplier);
                s.Id = await conn.ExecuteScalarAsync<long>("""
                    insert into suppliers (code, name, contact_person, mobile, whatsapp, email, address, state, state_code, gstin, bank_name, bank_account, bank_ifsc, upi_id, notes)
                    values (@Code, @Name, @ContactPerson, @Mobile, @Whatsapp, @Email, @Address, @State, @StateCode, @Gstin, @BankName, @BankAccount, @BankIfsc, @UpiId, @Notes) returning id
                    """, s, tx);
            }
            else
            {
                old = await conn.QuerySingleOrDefaultAsync<Supplier>("select * from suppliers where id = @Id and not is_deleted for update", s, tx)
                      ?? throw new NotFoundException("Supplier", s.Id);
                await conn.ExecuteAsync("""
                    update suppliers set name=@Name, contact_person=@ContactPerson, mobile=@Mobile, whatsapp=@Whatsapp, email=@Email, address=@Address,
                        state=@State, state_code=@StateCode, gstin=@Gstin, bank_name=@BankName, bank_account=@BankAccount, bank_ifsc=@BankIfsc,
                        upi_id=@UpiId, notes=@Notes, updated_at=now() where id=@Id
                    """, s, tx);
            }
            await audit.LogAsync(conn, tx, old is null ? "CREATE" : "UPDATE", "Purchases",
                $"{(old is null ? "created" : "updated")} supplier {s.Name}", "supplier", s.Id, s.Code,
                old is null ? null : new { old.Name, old.Mobile, old.Gstin, old.BankAccount }, new { s.Name, s.Mobile, s.Gstin, s.BankAccount });
            return s.Id;
        });
    }

    public async Task DeleteAsync(long id)
    {
        session.Demand(Perm.SupplierManage);
        await db.InTransactionAsync(async (conn, tx) =>
        {
            var used = await conn.ExecuteScalarAsync<int>("select count(*) from purchases where supplier_id = @id and status <> 'CANCELLED'", new { id }, tx);
            if (used > 0) throw new BusinessRuleException("This supplier has purchases and cannot be deleted.");
            var name = await conn.ExecuteScalarAsync<string>("update suppliers set is_deleted = true, deleted_at = now() where id = @id returning name", new { id }, tx);
            await audit.LogAsync(conn, tx, "DELETE", "Purchases", $"deleted supplier {name}", "supplier", id, name);
        });
    }

    /// <summary>Purchases are credits (we owe the supplier); payments are debits.</summary>
    public async Task<IReadOnlyList<LedgerEntry>> LedgerAsync(long supplierId)
    {
        session.DemandAny(Perm.SupplierView, Perm.PurchaseView);
        var rows = (await db.QueryAsync<LedgerEntry>("""
            select * from (
                select purchase_date as date, 'PURCHASE' as doc_type, number as doc_number, id as doc_id,
                       'Purchase' || coalesce(' — supplier bill ' || supplier_invoice_no, '') as particulars,
                       0::numeric as debit, grand_total as credit, completed_at as created_at
                from purchases where supplier_id = @supplierId and status = 'COMPLETED'
                union all
                select return_date, 'DEBIT_NOTE', number, id, 'Debit note — goods returned (' || reason || ')', grand_total, 0, created_at
                from purchase_returns where supplier_id = @supplierId
                union all
                select payment_date, 'PAYMENT', number, id, 'Paid by ' || (select name from payment_methods where code = method_code) || coalesce(' — ' || reference, ''),
                       amount, 0, created_at
                from supplier_payments where supplier_id = @supplierId and not is_voided
            ) x order by date, created_at
            """, new { supplierId })).AsList();
        decimal running = 0;
        foreach (var r in rows) { running += r.Credit - r.Debit; r.Balance = running; }
        return rows;
    }

    private static string? Blank(string? s) => string.IsNullOrWhiteSpace(s) ? null : s.Trim();
}
