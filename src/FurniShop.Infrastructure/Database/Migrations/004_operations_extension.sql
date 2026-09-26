-- 004: furniture-business operations — locations & transfers, raw materials, bills of material,
-- production, warranty, service, leads & follow-ups, daily cash closing, customer groups,
-- dimension pricing and salesperson commission.

-- =====================================================================
-- Locations (showrooms, godowns, factory). Per-location stock always sums to inventory.on_hand.
-- =====================================================================
create table warehouses (
    id          bigint generated always as identity primary key,
    code        text not null,
    name        text not null,
    kind        text not null default 'WAREHOUSE' check (kind in ('SHOWROOM','WAREHOUSE','FACTORY')),
    address     text,
    is_default  boolean not null default false,
    is_active   boolean not null default true,
    created_at  timestamptz not null default now()
);
create unique index ux_warehouses_code on warehouses (lower(code));
create unique index ux_warehouses_default on warehouses (is_default) where is_default;

insert into warehouses (code, name, kind, is_default) values ('MAIN', 'Main showroom', 'SHOWROOM', true);

create table warehouse_stock (
    warehouse_id  bigint not null references warehouses(id),
    variant_id    bigint not null references product_variants(id),
    on_hand       numeric(12,2) not null default 0,
    damaged       numeric(12,2) not null default 0 check (damaged >= 0),
    updated_at    timestamptz not null default now(),
    primary key (warehouse_id, variant_id)
);
create index ix_warehouse_stock_variant on warehouse_stock (variant_id);

insert into warehouse_stock (warehouse_id, variant_id, on_hand, damaged)
select (select id from warehouses where is_default), variant_id, on_hand, damaged from inventory
where on_hand <> 0 or damaged <> 0;

alter table inventory_movements add column warehouse_id bigint references warehouses(id);
alter table purchases add column warehouse_id bigint references warehouses(id);

alter table inventory_movements drop constraint if exists inventory_movements_movement_type_check;
alter table inventory_movements add constraint inventory_movements_movement_type_check check (movement_type in (
    'OPENING','PURCHASE_IN','SALE_OUT','RESERVE','UNRESERVE','RESERVED_SALE_OUT',
    'RETURN_IN','RETURN_DAMAGED','ADJUSTMENT_IN','ADJUSTMENT_OUT','DAMAGE',
    'DAMAGE_REPAIRED','DAMAGE_WRITE_OFF','SALE_CANCEL_IN','PURCHASE_CANCEL_OUT','DISPLAY','PURCHASE_RETURN_OUT',
    'TRANSFER_OUT','TRANSFER_IN','PRODUCTION_IN'));

create table stock_transfers (
    id                 bigint generated always as identity primary key,
    number             text not null unique,
    from_warehouse_id  bigint not null references warehouses(id),
    to_warehouse_id    bigint not null references warehouses(id),
    status             text not null default 'DRAFT' check (status in ('DRAFT','DISPATCHED','IN_TRANSIT','RECEIVED','CANCELLED')),
    transfer_date      date not null default current_date,
    vehicle_no         text,
    notes              text,
    dispatched_at      timestamptz,
    received_at        timestamptz,
    cancel_reason      text,
    created_by         bigint references users(id),
    created_at         timestamptz not null default now(),
    constraint ck_transfer_locations check (from_warehouse_id <> to_warehouse_id)
);
create table stock_transfer_items (
    id           bigint generated always as identity primary key,
    transfer_id  bigint not null references stock_transfers(id) on delete cascade,
    variant_id   bigint not null references product_variants(id),
    quantity     numeric(12,2) not null check (quantity > 0)
);
create index ix_transfer_items_transfer on stock_transfer_items (transfer_id);

-- =====================================================================
-- Raw materials (wood, boards, hardware, foam, fabric…) with their own immutable ledger.
-- =====================================================================
create table raw_materials (
    id             bigint generated always as identity primary key,
    code           text not null,
    name           text not null,
    category       text not null,
    unit           text not null,
    cost_price     numeric(14,2) not null default 0 check (cost_price >= 0),
    stock          numeric(14,3) not null default 0,
    min_stock      numeric(14,3) not null default 0 check (min_stock >= 0),
    reorder_qty    numeric(14,3) not null default 0 check (reorder_qty >= 0),
    supplier_id    bigint references suppliers(id),
    warehouse_id   bigint references warehouses(id),
    notes          text,
    is_active      boolean not null default true,
    created_at     timestamptz not null default now(),
    updated_at     timestamptz not null default now()
);
create unique index ux_raw_materials_code on raw_materials (lower(code));

create table raw_material_movements (
    id               bigint generated always as identity primary key,
    raw_material_id  bigint not null references raw_materials(id),
    movement_type    text not null check (movement_type in ('OPENING','RECEIVE','ISSUE','RETURN','ADJUST_IN','ADJUST_OUT','WASTAGE')),
    quantity_delta   numeric(14,3) not null,
    stock_after      numeric(14,3) not null,
    unit_cost        numeric(14,2),
    supplier_id      bigint references suppliers(id),
    ref_type         text,
    ref_id           bigint,
    ref_number       text,
    note             text,
    created_by       bigint references users(id),
    created_at       timestamptz not null default now()
);
create index ix_rm_movements_material on raw_material_movements (raw_material_id, created_at desc);
create trigger trg_rm_movements_immutable before update or delete on raw_material_movements
    for each row execute function fn_no_delete();

-- =====================================================================
-- Bill of materials per product variant: materials (+ wastage) + labour + other = production cost.
-- =====================================================================
create table boms (
    id           bigint generated always as identity primary key,
    variant_id   bigint not null unique references product_variants(id),
    labour_cost  numeric(14,2) not null default 0 check (labour_cost >= 0),
    other_cost   numeric(14,2) not null default 0 check (other_cost >= 0),
    notes        text,
    updated_at   timestamptz not null default now()
);
create table bom_items (
    id               bigint generated always as identity primary key,
    bom_id           bigint not null references boms(id) on delete cascade,
    raw_material_id  bigint not null references raw_materials(id),
    quantity         numeric(14,3) not null check (quantity > 0),
    wastage_percent  numeric(5,2) not null default 0 check (wastage_percent between 0 and 100),
    unique (bom_id, raw_material_id)
);

-- =====================================================================
-- Production orders (for stock products or for a custom order).
-- =====================================================================
create table production_orders (
    id                bigint generated always as identity primary key,
    number            text not null unique,
    custom_order_id   bigint references custom_orders(id),
    variant_id        bigint references product_variants(id),
    description       text not null,
    quantity          numeric(12,2) not null default 1 check (quantity > 0),
    status            text not null default 'NEW' check (status in ('NEW','PLANNING','MATERIAL_READY','CUTTING','ASSEMBLY','FINISHING','QC','READY','COMPLETED','CANCELLED')),
    priority          text not null default 'NORMAL' check (priority in ('LOW','NORMAL','HIGH','URGENT')),
    due_date          date,
    assigned_to       text,
    warehouse_id      bigint references warehouses(id),
    labour_cost       numeric(14,2) not null default 0 check (labour_cost >= 0),
    other_cost        numeric(14,2) not null default 0 check (other_cost >= 0),
    material_cost     numeric(14,2) not null default 0 check (material_cost >= 0),
    notes             text,
    started_at        timestamptz,
    completed_at      timestamptz,
    cancel_reason     text,
    created_by        bigint references users(id),
    created_at        timestamptz not null default now(),
    updated_at        timestamptz not null default now()
);
create index ix_production_status on production_orders (status, due_date);
create index ix_production_custom on production_orders (custom_order_id);

create table production_materials (
    id                   bigint generated always as identity primary key,
    production_order_id  bigint not null references production_orders(id) on delete cascade,
    raw_material_id      bigint not null references raw_materials(id),
    quantity_required    numeric(14,3) not null check (quantity_required >= 0),
    quantity_issued      numeric(14,3) not null default 0 check (quantity_issued >= 0),
    unique (production_order_id, raw_material_id)
);

-- =====================================================================
-- Warranty registrations (created when an invoice with warranty items is finalised) & service.
-- =====================================================================
create table warranties (
    id               bigint generated always as identity primary key,
    number           text not null unique,
    customer_id      bigint not null references customers(id),
    invoice_id       bigint references invoices(id),
    invoice_item_id  bigint unique references invoice_items(id),
    custom_order_id  bigint references custom_orders(id),
    variant_id       bigint references product_variants(id),
    product_name     text not null,
    serial_no        text,
    start_date       date not null,
    end_date         date not null,
    terms            text,
    is_void          boolean not null default false,
    void_reason      text,
    created_at       timestamptz not null default now(),
    constraint ck_warranty_dates check (end_date >= start_date)
);
create index ix_warranties_customer on warranties (customer_id);
create index ix_warranties_end on warranties (end_date);
create index ix_warranties_serial on warranties (serial_no) where serial_no is not null;

alter table products add column warranty_terms text;
alter table invoice_items add column serial_no text;

create table service_tickets (
    id                bigint generated always as identity primary key,
    number            text not null unique,
    customer_id       bigint not null references customers(id),
    warranty_id       bigint references warranties(id),
    invoice_id        bigint references invoices(id),
    product_name      text not null,
    serial_no         text,
    issue             text not null,
    address           text,
    status            text not null default 'NEW' check (status in ('NEW','ASSIGNED','VISIT','REPAIR','QC','COMPLETED','CANCELLED')),
    priority          text not null default 'NORMAL' check (priority in ('LOW','NORMAL','HIGH','URGENT')),
    under_warranty    boolean not null default false,
    technician_name   text,
    technician_user_id bigint references users(id),
    visit_date        date,
    parts_used        text,
    service_charge    numeric(14,2) not null default 0 check (service_charge >= 0),
    resolution        text,
    payment_id        bigint references payments(id),
    completed_at      timestamptz,
    cancel_reason     text,
    created_by        bigint references users(id),
    created_at        timestamptz not null default now(),
    updated_at        timestamptz not null default now()
);
create index ix_service_status on service_tickets (status, created_at desc);
create index ix_service_customer on service_tickets (customer_id);

-- =====================================================================
-- Leads & follow-ups.
-- =====================================================================
create table leads (
    id                   bigint generated always as identity primary key,
    number               text not null unique,
    name                 text not null,
    mobile               text,
    email                text,
    city                 text,
    source               text,
    status               text not null default 'NEW' check (status in ('NEW','CONTACTED','QUOTATION','NEGOTIATION','CONFIRMED','CONVERTED','LOST')),
    salesperson_id       bigint references users(id),
    interested_products  text,
    expected_value       numeric(14,2) not null default 0 check (expected_value >= 0),
    next_follow_up       date,
    customer_id          bigint references customers(id),
    quotation_id         bigint references quotations(id),
    lost_reason          text,
    notes                text,
    created_by           bigint references users(id),
    created_at           timestamptz not null default now(),
    updated_at           timestamptz not null default now()
);
create index ix_leads_status on leads (status, next_follow_up);
create index ix_leads_mobile on leads (mobile);

create table follow_ups (
    id           bigint generated always as identity primary key,
    ref_type     text not null check (ref_type in ('LEAD','CUSTOMER','QUOTATION','INVOICE','SALES_ORDER','CUSTOM_ORDER','SERVICE')),
    ref_id       bigint not null,
    customer_id  bigint references customers(id),
    title        text not null,
    due_date     date not null,
    assigned_to  bigint references users(id),
    note         text,
    done_at      timestamptz,
    outcome      text,
    created_by   bigint references users(id),
    created_at   timestamptz not null default now()
);
create index ix_follow_ups_due on follow_ups (due_date) where done_at is null;
create index ix_follow_ups_ref on follow_ups (ref_type, ref_id);

-- =====================================================================
-- Daily cash register.
-- =====================================================================
create table cash_sessions (
    id               bigint generated always as identity primary key,
    business_date    date not null unique,
    opening_cash     numeric(14,2) not null check (opening_cash >= 0),
    opened_by        bigint references users(id),
    opened_at        timestamptz not null default now(),
    cash_sales       numeric(14,2),
    cash_refunds     numeric(14,2),
    cash_expenses    numeric(14,2),
    cash_supplier    numeric(14,2),
    expected_cash    numeric(14,2),
    counted_cash     numeric(14,2),
    difference       numeric(14,2),
    status           text not null default 'OPEN' check (status in ('OPEN','CLOSED','APPROVED')),
    closed_by        bigint references users(id),
    closed_at        timestamptz,
    close_note       text,
    approved_by      bigint references users(id),
    approved_at      timestamptz,
    approval_note    text
);

-- =====================================================================
-- Customer groups, dimension pricing, delivery priority, salesperson & commission.
-- =====================================================================
create table customer_groups (
    code              text primary key,
    name              text not null,
    discount_percent  numeric(5,2) not null default 0 check (discount_percent between 0 and 100),
    is_active         boolean not null default true
);
insert into customer_groups (code, name, discount_percent) values
    ('RETAIL', 'Retail', 0), ('WHOLESALE', 'Wholesale', 10), ('DEALER', 'Dealer', 15), ('CONTRACTOR', 'Contractor', 8),
    ('DESIGNER', 'Interior designer', 10), ('CORPORATE', 'Corporate', 7), ('VIP', 'VIP', 5);
alter table customers add column customer_group text not null default 'RETAIL' references customer_groups(code);

alter table product_variants add column pricing_mode text not null default 'FIXED'
    check (pricing_mode in ('FIXED','PER_UNIT','PER_SQFT','PER_RFT','PER_SQM','PER_KG','CUSTOM'));
alter table product_variants add column pricing_rate numeric(14,2) check (pricing_rate >= 0);

alter table deliveries add column priority text not null default 'NORMAL' check (priority in ('LOW','NORMAL','HIGH','URGENT'));
alter table deliveries add column route text;
alter table deliveries add column route_order int;

alter table installations add column completion_photo_id bigint references attachments(id);
alter table installations add column customer_confirmed_by text;

alter table invoices add column salesperson_id bigint references users(id);
alter table quotations add column salesperson_id bigint references users(id);
alter table sales_orders add column salesperson_id bigint references users(id);
update invoices set salesperson_id = created_by where salesperson_id is null;
alter table users add column commission_percent numeric(5,2) not null default 0 check (commission_percent between 0 and 100);

-- =====================================================================
-- Numbering, permissions.
-- =====================================================================
insert into document_sequences (doc_type, prefix, include_year, padding, next_number) values
    ('TRANSFER', 'TRF', true, 4, 1), ('PRODUCTION_ORDER', 'PRD', true, 4, 1), ('WARRANTY', 'WAR', true, 5, 1),
    ('SERVICE', 'SRV', true, 4, 1), ('LEAD', 'LD', true, 4, 1)
on conflict do nothing;

insert into permissions (code, module, description) values
    ('warehouse.manage',    'Inventory',    'Manage locations and stock transfers'),
    ('rawmaterial.view',    'Production',   'View raw materials and BOMs'),
    ('rawmaterial.manage',  'Production',   'Manage raw materials, stock and BOMs'),
    ('production.view',     'Production',   'View production orders'),
    ('production.manage',   'Production',   'Create and move production orders, issue materials'),
    ('warranty.view',       'Service',      'View warranties'),
    ('service.view',        'Service',      'View service tickets'),
    ('service.manage',      'Service',      'Create and update service tickets'),
    ('lead.view',           'Customers',    'View leads and follow-ups'),
    ('lead.manage',         'Customers',    'Create and update leads and follow-ups'),
    ('cash.manage',         'Payments',     'Open and close the daily cash register'),
    ('cash.approve',        'Payments',     'Approve cash differences at closing'),
    ('credit.override',     'Sales',        'Bill beyond a customer''s credit limit'),
    ('product.import',      'Products',     'Import and bulk-update products')
on conflict do nothing;

insert into role_permissions (role_id, permission_code)
select r.id, p.code from roles r join permissions p on p.code in (
    'warehouse.manage','rawmaterial.view','rawmaterial.manage','production.view','production.manage','warranty.view','service.view',
    'service.manage','lead.view','lead.manage','cash.manage','cash.approve','credit.override','product.import')
where r.code in ('ADMIN') on conflict do nothing;
insert into role_permissions (role_id, permission_code)
select r.id, p.code from roles r join permissions p on p.code in (
    'warehouse.manage','rawmaterial.view','rawmaterial.manage','production.view','production.manage','warranty.view','service.view',
    'service.manage','lead.view','lead.manage','cash.manage','cash.approve','credit.override','product.import')
where r.code = 'MANAGER' on conflict do nothing;
insert into role_permissions (role_id, permission_code)
select r.id, p.code from roles r join permissions p on p.code in ('warranty.view','service.view','service.manage','lead.view','lead.manage','cash.manage','production.view')
where r.code = 'SALES' on conflict do nothing;
insert into role_permissions (role_id, permission_code)
select r.id, p.code from roles r join permissions p on p.code in ('warranty.view','service.view')
where r.code = 'DELIVERY' on conflict do nothing;
insert into role_permissions (role_id, permission_code)
select r.id, p.code from roles r join permissions p on p.code in ('warranty.view','service.view','cash.manage','cash.approve','rawmaterial.view','production.view','lead.view')
where r.code = 'ACCOUNTANT' on conflict do nothing;

-- Warranty registrations for invoices finalised before this version.
insert into warranties (number, customer_id, invoice_id, invoice_item_id, variant_id, product_name, start_date, end_date)
select 'WAR-' || extract(year from i.invoice_date)::int || '-' || lpad((row_number() over (order by it.id))::text, 5, '0'),
       i.customer_id, i.id, it.id, it.variant_id, it.description, i.invoice_date,
       (i.invoice_date + make_interval(months => p.warranty_months) - interval '1 day')::date
from invoice_items it
join invoices i on i.id = it.invoice_id and i.status = 'FINAL'
join product_variants v on v.id = it.variant_id
join products p on p.id = v.product_id and p.warranty_months > 0;
update document_sequences set next_number = (select count(*) + 1 from warranties), current_year = extract(year from current_date)::int
where doc_type = 'WARRANTY';
