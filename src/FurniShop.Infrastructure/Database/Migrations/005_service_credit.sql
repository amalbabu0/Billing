-- 005: credit-limit overrides on invoices, service invoices on tickets.
alter table invoices add column credit_override_reason text;
alter table invoices add column credit_override_by bigint references users(id);
alter table service_tickets add column service_invoice_id bigint references invoices(id);
create index if not exists ix_follow_ups_assigned on follow_ups (assigned_to, due_date) where done_at is null;

-- Warranties back-filled in 004 for anonymous walk-in sales carry no contact; drop those not used by a ticket.
delete from warranties w using customers c
where c.id = w.customer_id and c.is_walk_in and not exists (select 1 from service_tickets t where t.warranty_id = w.id);
