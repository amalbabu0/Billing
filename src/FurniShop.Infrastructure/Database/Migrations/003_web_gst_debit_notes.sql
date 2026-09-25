-- 003: web client support — design stage for custom orders, purchase returns (GST debit notes),
-- POS favourites, and trigram indexes for fast "contains" search.

-- Custom furniture: explicit design stage between order received and production.
alter table custom_orders drop constraint if exists custom_orders_status_check;
alter table custom_orders add constraint custom_orders_status_check
    check (status in ('RECEIVED','DESIGN','PRODUCTION','QUALITY_CHECK','READY','DELIVERY','INSTALLATION','COMPLETED','CANCELLED'));

-- Stock leaving because goods were returned to the supplier.
alter table inventory_movements drop constraint if exists inventory_movements_movement_type_check;
alter table inventory_movements add constraint inventory_movements_movement_type_check check (movement_type in (
    'OPENING','PURCHASE_IN','SALE_OUT','RESERVE','UNRESERVE','RESERVED_SALE_OUT',
    'RETURN_IN','RETURN_DAMAGED','ADJUSTMENT_IN','ADJUSTMENT_OUT','DAMAGE',
    'DAMAGE_REPAIRED','DAMAGE_WRITE_OFF','SALE_CANCEL_IN','PURCHASE_CANCEL_OUT','DISPLAY','PURCHASE_RETURN_OUT'));

-- Purchase returns reduce what we owe the supplier. The running total is kept on the purchase so every
-- balance query (supplier outstanding, payment allocation, ledger) subtracts it the same way.
alter table purchases add column returned_total numeric(14,2) not null default 0 check (returned_total >= 0);
alter table purchases add constraint ck_purchase_returned_le_total check (returned_total <= grand_total);
alter table purchase_items add column returned_qty numeric(12,2) not null default 0 check (returned_qty >= 0);
alter table purchase_items add constraint ck_purchase_item_returned_le_qty check (returned_qty <= quantity);

create table purchase_returns (
    id              bigint generated always as identity primary key,
    number          text not null unique,
    purchase_id     bigint not null references purchases(id),
    supplier_id     bigint not null references suppliers(id),
    return_date     date not null,
    reason          text not null,
    is_inter_state  boolean not null default false,
    taxable_total   numeric(14,2) not null default 0,
    cgst_total      numeric(14,2) not null default 0,
    sgst_total      numeric(14,2) not null default 0,
    igst_total      numeric(14,2) not null default 0,
    grand_total     numeric(14,2) not null check (grand_total >= 0),
    notes           text,
    created_by      bigint references users(id),
    created_at      timestamptz not null default now()
);
create index ix_purchase_returns_purchase on purchase_returns (purchase_id);
create index ix_purchase_returns_date on purchase_returns (return_date desc);

create table purchase_return_items (
    id                bigint generated always as identity primary key,
    return_id         bigint not null references purchase_returns(id),
    purchase_item_id  bigint not null references purchase_items(id),
    variant_id        bigint not null references product_variants(id),
    description       text not null,
    hsn_code          text,
    quantity          numeric(12,2) not null check (quantity > 0),
    gst_rate          numeric(5,2) not null,
    taxable_amount    numeric(14,2) not null,
    cgst              numeric(14,2) not null default 0,
    sgst              numeric(14,2) not null default 0,
    igst              numeric(14,2) not null default 0,
    line_total        numeric(14,2) not null
);
create index ix_purchase_return_items_return on purchase_return_items (return_id);

-- Debit notes are financial documents: never edited or deleted.
create trigger trg_purchase_returns_immutable before update or delete on purchase_returns
    for each row execute function fn_no_delete();
create trigger trg_purchase_return_items_immutable before update or delete on purchase_return_items
    for each row execute function fn_no_delete();

insert into document_sequences (doc_type, prefix, include_year, padding, next_number)
values ('DEBIT_NOTE', 'DN', true, 4, 1) on conflict do nothing;

-- Per-user POS favourites.
create table user_favorites (
    user_id     bigint not null references users(id),
    variant_id  bigint not null references product_variants(id),
    created_at  timestamptz not null default now(),
    primary key (user_id, variant_id)
);

-- Trigram indexes make ILIKE '%text%' searches index-assisted on large catalogues.
create extension if not exists pg_trgm;
create index if not exists ix_products_name_trgm on products using gin (name gin_trgm_ops);
create index if not exists ix_variants_sku_trgm on product_variants using gin (sku gin_trgm_ops);
create index if not exists ix_customers_name_trgm on customers using gin (name gin_trgm_ops);
create index if not exists ix_customers_mobile_trgm on customers using gin (mobile gin_trgm_ops);
create index if not exists ix_invoices_customer_name_trgm on invoices using gin (customer_name gin_trgm_ops);
create index if not exists ix_invoices_customer_date on invoices (customer_id, invoice_date desc);
