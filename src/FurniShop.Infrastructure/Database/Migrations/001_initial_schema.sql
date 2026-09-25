-- =====================================================================
-- FurniShop ERP — initial schema (PostgreSQL 15+/Neon)
-- All money is numeric(14,2). All quantities are numeric(12,2) so that
-- items sold by length/area (e.g. fabric) are possible, although most
-- furniture is sold in whole units.
-- =====================================================================

-- ---------------------------------------------------------------------
-- Security
-- ---------------------------------------------------------------------
create table roles (
    id              bigint generated always as identity primary key,
    code            text not null unique,
    name            text not null,
    description     text,
    is_system       boolean not null default false,
    created_at      timestamptz not null default now()
);

create table permissions (
    code            text primary key,
    module          text not null,
    description     text not null
);

create table role_permissions (
    role_id         bigint not null references roles(id) on delete cascade,
    permission_code text   not null references permissions(code) on delete cascade,
    primary key (role_id, permission_code)
);

create table users (
    id                   bigint generated always as identity primary key,
    username             text not null,
    full_name            text not null,
    mobile               text,
    email                text,
    role_id              bigint not null references roles(id),
    password_hash        text not null,
    must_change_password boolean not null default false,
    is_active            boolean not null default true,
    failed_login_count   int not null default 0,
    locked_until         timestamptz,
    last_login_at        timestamptz,
    password_changed_at  timestamptz not null default now(),
    created_at           timestamptz not null default now(),
    updated_at           timestamptz not null default now(),
    is_deleted           boolean not null default false
);
create unique index ux_users_username on users (lower(username));

-- ---------------------------------------------------------------------
-- Settings & configuration
-- ---------------------------------------------------------------------
create table settings (
    key         text primary key,
    value       jsonb not null,
    updated_at  timestamptz not null default now(),
    updated_by  bigint references users(id)
);

create table gst_rates (
    id          bigint generated always as identity primary key,
    name        text not null,
    rate        numeric(5,2) not null unique check (rate >= 0 and rate <= 100),
    is_active   boolean not null default true,
    is_default  boolean not null default false
);

create table hsn_codes (
    code              text primary key,
    description       text not null,
    default_gst_rate  numeric(5,2) not null check (default_gst_rate >= 0 and default_gst_rate <= 100),
    is_active         boolean not null default true
);

create table payment_methods (
    code        text primary key,
    name        text not null,
    is_active   boolean not null default true,
    sort_order  int not null default 0,
    -- 'is_money' = false for CREDIT (sale on credit — no money received)
    is_money    boolean not null default true,
    is_system   boolean not null default false
);

create table document_sequences (
    doc_type      text primary key,
    prefix        text not null,
    include_year  boolean not null default true,
    padding       int not null default 4 check (padding between 1 and 10),
    next_number   bigint not null default 1 check (next_number >= 1),
    current_year  int
);

create table attachments (
    id            bigint generated always as identity primary key,
    owner_type    text not null,
    owner_id      bigint,
    purpose       text not null default 'FILE',
    file_name     text not null,
    content_type  text not null check (content_type in ('image/png','image/jpeg','application/pdf')),
    size_bytes    int not null check (size_bytes > 0 and size_bytes <= 5242880),
    sha256        text not null,
    data          bytea not null,
    created_by    bigint references users(id),
    created_at    timestamptz not null default now()
);
create index ix_attachments_owner on attachments (owner_type, owner_id);

-- ---------------------------------------------------------------------
-- Catalog
-- ---------------------------------------------------------------------
create table categories (
    id           bigint generated always as identity primary key,
    name         text not null,
    parent_id    bigint references categories(id),
    description  text,
    default_hsn  text,
    default_gst_rate numeric(5,2),
    is_active    boolean not null default true,
    is_deleted   boolean not null default false,
    created_at   timestamptz not null default now()
);
create unique index ux_categories_name on categories (lower(name)) where not is_deleted;

create table brands (
    id          bigint generated always as identity primary key,
    name        text not null,
    is_active   boolean not null default true,
    is_deleted  boolean not null default false
);
create unique index ux_brands_name on brands (lower(name)) where not is_deleted;

create table products (
    id                  bigint generated always as identity primary key,
    code                text not null,
    name                text not null,
    category_id         bigint not null references categories(id),
    brand_id            bigint references brands(id),
    material            text,
    color               text,
    size                text,
    dimensions          text,
    weight_kg           numeric(10,2),
    finish              text,
    fabric              text,
    warranty_months     int not null default 0 check (warranty_months >= 0),
    hsn_code            text,
    gst_rate            numeric(5,2) not null check (gst_rate >= 0 and gst_rate <= 100),
    price_includes_gst  boolean not null default true,
    cost_price          numeric(14,2) not null default 0 check (cost_price >= 0),
    selling_price       numeric(14,2) not null check (selling_price >= 0),
    discount_percent    numeric(5,2) not null default 0 check (discount_percent >= 0 and discount_percent <= 100),
    min_stock           numeric(12,2) not null default 0 check (min_stock >= 0),
    description         text,
    status              text not null default 'ACTIVE' check (status in ('ACTIVE','INACTIVE','DISCONTINUED')),
    is_stock_item       boolean not null default true,
    image_attachment_id bigint references attachments(id),
    created_by          bigint references users(id),
    created_at          timestamptz not null default now(),
    updated_at          timestamptz not null default now(),
    is_deleted          boolean not null default false,
    deleted_at          timestamptz
);
create unique index ux_products_code on products (lower(code)) where not is_deleted;
create index ix_products_category on products (category_id);
create index ix_products_name on products (lower(name));

-- Every product has at least one variant (the default variant). Stock,
-- barcodes and billing all work on variants, so a product without real
-- variants simply has one default variant carrying the product's SKU.
create table product_variants (
    id                  bigint generated always as identity primary key,
    product_id          bigint not null references products(id),
    variant_name        text not null default 'Standard',
    sku                 text not null,
    barcode             text,
    size                text,
    color               text,
    material            text,
    fabric              text,
    finish              text,
    configuration       text,
    design              text,
    dimensions          text,
    cost_price          numeric(14,2) check (cost_price >= 0),     -- null = use product
    selling_price       numeric(14,2) check (selling_price >= 0),  -- null = use product
    min_stock           numeric(12,2) check (min_stock >= 0),      -- null = use product
    image_attachment_id bigint references attachments(id),
    is_default          boolean not null default false,
    is_active           boolean not null default true,
    is_deleted          boolean not null default false,
    created_at          timestamptz not null default now(),
    updated_at          timestamptz not null default now()
);
create unique index ux_variants_sku on product_variants (lower(sku)) where not is_deleted;
create unique index ux_variants_barcode on product_variants (barcode) where barcode is not null and not is_deleted;
create index ix_variants_product on product_variants (product_id);

create table inventory (
    variant_id   bigint primary key references product_variants(id),
    on_hand      numeric(12,2) not null default 0,  -- physical sellable stock (includes reserved)
    reserved     numeric(12,2) not null default 0 check (reserved >= 0),
    damaged      numeric(12,2) not null default 0 check (damaged >= 0),
    display_qty  numeric(12,2) not null default 0 check (display_qty >= 0),
    updated_at   timestamptz not null default now(),
    constraint ck_inventory_reserved_le_onhand check (reserved <= greatest(on_hand, 0) or reserved = 0)
);

create table inventory_movements (
    id              bigint generated always as identity primary key,
    variant_id      bigint not null references product_variants(id),
    movement_type   text not null check (movement_type in (
                        'OPENING','PURCHASE_IN','SALE_OUT','RESERVE','UNRESERVE','RESERVED_SALE_OUT',
                        'RETURN_IN','RETURN_DAMAGED','ADJUSTMENT_IN','ADJUSTMENT_OUT','DAMAGE',
                        'DAMAGE_REPAIRED','DAMAGE_WRITE_OFF','SALE_CANCEL_IN','PURCHASE_CANCEL_OUT','DISPLAY')),
    on_hand_delta   numeric(12,2) not null default 0,
    reserved_delta  numeric(12,2) not null default 0,
    damaged_delta   numeric(12,2) not null default 0,
    on_hand_after   numeric(12,2) not null,
    reserved_after  numeric(12,2) not null,
    damaged_after   numeric(12,2) not null,
    unit_cost       numeric(14,2),
    ref_type        text,
    ref_id          bigint,
    ref_number      text,
    note            text,
    created_by      bigint references users(id),
    created_at      timestamptz not null default now()
);
create index ix_movements_variant on inventory_movements (variant_id, created_at desc);
create index ix_movements_ref on inventory_movements (ref_type, ref_id);
create index ix_movements_created on inventory_movements (created_at desc);

create table stock_adjustments (
    id              bigint generated always as identity primary key,
    number          text not null unique,
    variant_id      bigint not null references product_variants(id),
    adjustment_type text not null check (adjustment_type in ('INCREASE','DECREASE','MARK_DAMAGED','DAMAGE_REPAIRED','DAMAGE_WRITE_OFF','SET_DISPLAY')),
    quantity        numeric(12,2) not null check (quantity > 0),
    reason          text not null,
    created_by      bigint references users(id),
    created_at      timestamptz not null default now()
);

-- ---------------------------------------------------------------------
-- Parties
-- ---------------------------------------------------------------------
create table customers (
    id               bigint generated always as identity primary key,
    code             text not null unique,
    name             text not null,
    mobile           text,
    whatsapp         text,
    email            text,
    billing_address  text,
    city             text,
    state            text,
    state_code       text,
    pincode          text,
    gstin            text,
    notes            text,
    is_walk_in       boolean not null default false,
    credit_limit     numeric(14,2) not null default 0 check (credit_limit >= 0),
    created_by       bigint references users(id),
    created_at       timestamptz not null default now(),
    updated_at       timestamptz not null default now(),
    is_deleted       boolean not null default false,
    deleted_at       timestamptz,
    constraint ck_customers_pincode check (pincode is null or pincode ~ '^[1-9][0-9]{5}$')
);
create unique index ux_customers_mobile on customers (mobile) where mobile is not null and not is_deleted and not is_walk_in;
create index ix_customers_name on customers (lower(name));

create table customer_addresses (
    id            bigint generated always as identity primary key,
    customer_id   bigint not null references customers(id),
    label         text not null default 'Delivery',
    address       text not null,
    city          text,
    state         text,
    state_code    text,
    pincode       text,
    landmark      text,
    is_default    boolean not null default false,
    created_at    timestamptz not null default now()
);
create index ix_customer_addresses_customer on customer_addresses (customer_id);

create table suppliers (
    id               bigint generated always as identity primary key,
    code             text not null unique,
    name             text not null,
    contact_person   text,
    mobile           text,
    whatsapp         text,
    email            text,
    address          text,
    state            text,
    state_code       text,
    gstin            text,
    bank_name        text,
    bank_account     text,
    bank_ifsc        text,
    upi_id           text,
    notes            text,
    created_at       timestamptz not null default now(),
    updated_at       timestamptz not null default now(),
    is_deleted       boolean not null default false,
    deleted_at       timestamptz
);
create index ix_suppliers_name on suppliers (lower(name));

-- ---------------------------------------------------------------------
-- Sales documents. Quotation, sales order and invoice share the same
-- tax/total columns (computed by one calculator in FurniShop.Core).
-- ---------------------------------------------------------------------
create table quotations (
    id                    bigint generated always as identity primary key,
    number                text not null unique,
    customer_id           bigint not null references customers(id),
    quote_date            date not null,
    valid_until           date,
    status                text not null default 'DRAFT' check (status in ('DRAFT','SENT','CONFIRMED','CONVERTED','REJECTED','EXPIRED','CANCELLED')),
    place_of_supply       text,
    is_inter_state        boolean not null default false,
    subtotal              numeric(14,2) not null default 0,
    discount_total        numeric(14,2) not null default 0,
    taxable_total         numeric(14,2) not null default 0,
    cgst_total            numeric(14,2) not null default 0,
    sgst_total            numeric(14,2) not null default 0,
    igst_total            numeric(14,2) not null default 0,
    delivery_charge       numeric(14,2) not null default 0 check (delivery_charge >= 0),
    installation_charge   numeric(14,2) not null default 0 check (installation_charge >= 0),
    charges_tax           numeric(14,2) not null default 0,
    round_off             numeric(14,2) not null default 0,
    grand_total           numeric(14,2) not null default 0 check (grand_total >= 0),
    notes                 text,
    terms                 text,
    sales_order_id        bigint,
    created_by            bigint references users(id),
    created_at            timestamptz not null default now(),
    updated_at            timestamptz not null default now()
);
create index ix_quotations_customer on quotations (customer_id);
create index ix_quotations_date on quotations (quote_date desc);

create table quotation_items (
    id                  bigint generated always as identity primary key,
    quotation_id        bigint not null references quotations(id) on delete cascade,
    line_no             int not null,
    variant_id          bigint references product_variants(id),
    description         text not null,
    sku                 text,
    hsn_code            text,
    quantity            numeric(12,2) not null check (quantity > 0),
    unit_price          numeric(14,2) not null check (unit_price >= 0),
    price_includes_gst  boolean not null,
    discount_percent    numeric(5,2) not null default 0 check (discount_percent between 0 and 100),
    discount_amount     numeric(14,2) not null default 0 check (discount_amount >= 0),
    taxable_amount      numeric(14,2) not null,
    gst_rate            numeric(5,2) not null,
    cgst                numeric(14,2) not null default 0,
    sgst                numeric(14,2) not null default 0,
    igst                numeric(14,2) not null default 0,
    line_total          numeric(14,2) not null,
    unit_cost           numeric(14,2) not null default 0
);
create index ix_quotation_items_q on quotation_items (quotation_id);

create table sales_orders (
    id                      bigint generated always as identity primary key,
    number                  text not null unique,
    customer_id             bigint not null references customers(id),
    order_date              date not null,
    expected_delivery_date  date,
    status                  text not null default 'DRAFT' check (status in ('DRAFT','CONFIRMED','PROCESSING','MANUFACTURING','READY','DISPATCHED','DELIVERED','COMPLETED','CANCELLED')),
    quotation_id            bigint references quotations(id),
    invoice_id              bigint,
    place_of_supply         text,
    is_inter_state          boolean not null default false,
    delivery_address        text,
    requires_delivery       boolean not null default true,
    requires_installation   boolean not null default false,
    subtotal                numeric(14,2) not null default 0,
    discount_total          numeric(14,2) not null default 0,
    taxable_total           numeric(14,2) not null default 0,
    cgst_total              numeric(14,2) not null default 0,
    sgst_total              numeric(14,2) not null default 0,
    igst_total              numeric(14,2) not null default 0,
    delivery_charge         numeric(14,2) not null default 0 check (delivery_charge >= 0),
    installation_charge     numeric(14,2) not null default 0 check (installation_charge >= 0),
    charges_tax             numeric(14,2) not null default 0,
    round_off               numeric(14,2) not null default 0,
    grand_total             numeric(14,2) not null default 0 check (grand_total >= 0),
    notes                   text,
    terms                   text,
    cancel_reason           text,
    created_by              bigint references users(id),
    created_at              timestamptz not null default now(),
    updated_at              timestamptz not null default now()
);
create index ix_sales_orders_customer on sales_orders (customer_id);
create index ix_sales_orders_status on sales_orders (status);
alter table quotations add constraint fk_quotations_so foreign key (sales_order_id) references sales_orders(id);

create table sales_order_items (
    id                        bigint generated always as identity primary key,
    sales_order_id            bigint not null references sales_orders(id) on delete cascade,
    line_no                   int not null,
    variant_id                bigint references product_variants(id),
    description               text not null,
    sku                       text,
    hsn_code                  text,
    quantity                  numeric(12,2) not null check (quantity > 0),
    unit_price                numeric(14,2) not null check (unit_price >= 0),
    price_includes_gst        boolean not null,
    discount_percent          numeric(5,2) not null default 0 check (discount_percent between 0 and 100),
    discount_amount           numeric(14,2) not null default 0 check (discount_amount >= 0),
    taxable_amount            numeric(14,2) not null,
    gst_rate                  numeric(5,2) not null,
    cgst                      numeric(14,2) not null default 0,
    sgst                      numeric(14,2) not null default 0,
    igst                      numeric(14,2) not null default 0,
    line_total                numeric(14,2) not null,
    unit_cost                 numeric(14,2) not null default 0,
    reserved_qty              numeric(12,2) not null default 0 check (reserved_qty >= 0),
    source_quotation_item_id  bigint references quotation_items(id)
);
create index ix_so_items_so on sales_order_items (sales_order_id);

create table invoices (
    id                    bigint generated always as identity primary key,
    number                text,              -- assigned on finalisation (no gaps in the GST series)
    status                text not null default 'DRAFT' check (status in ('DRAFT','FINAL','CANCELLED')),
    invoice_date          date not null,
    due_date              date,
    customer_id           bigint not null references customers(id),
    customer_name         text not null,
    customer_mobile       text,
    customer_gstin        text,
    billing_address       text,
    delivery_address      text,
    place_of_supply       text,
    is_inter_state        boolean not null default false,
    sales_order_id        bigint references sales_orders(id),
    quotation_id          bigint references quotations(id),
    custom_order_id       bigint,
    subtotal              numeric(14,2) not null default 0,
    discount_total        numeric(14,2) not null default 0,
    taxable_total         numeric(14,2) not null default 0,
    cgst_total            numeric(14,2) not null default 0,
    sgst_total            numeric(14,2) not null default 0,
    igst_total            numeric(14,2) not null default 0,
    delivery_charge       numeric(14,2) not null default 0 check (delivery_charge >= 0),
    installation_charge   numeric(14,2) not null default 0 check (installation_charge >= 0),
    charges_tax           numeric(14,2) not null default 0,
    round_off             numeric(14,2) not null default 0,
    grand_total           numeric(14,2) not null default 0 check (grand_total >= 0),
    cost_total            numeric(14,2) not null default 0,
    notes                 text,
    terms                 text,
    requires_delivery     boolean not null default false,
    requires_installation boolean not null default false,
    created_by            bigint references users(id),
    created_at            timestamptz not null default now(),
    updated_at            timestamptz not null default now(),
    finalized_by          bigint references users(id),
    finalized_at          timestamptz,
    cancelled_by          bigint references users(id),
    cancelled_at          timestamptz,
    cancel_reason         text,
    constraint ck_invoice_number_when_final check (status = 'DRAFT' or number is not null)
);
create unique index ux_invoices_number on invoices (number) where number is not null;
create index ix_invoices_customer on invoices (customer_id);
create index ix_invoices_date on invoices (invoice_date desc);
create index ix_invoices_status on invoices (status);
alter table sales_orders add constraint fk_so_invoice foreign key (invoice_id) references invoices(id);

create table invoice_items (
    id                          bigint generated always as identity primary key,
    invoice_id                  bigint not null references invoices(id) on delete cascade,
    line_no                     int not null,
    variant_id                  bigint references product_variants(id),
    description                 text not null,
    sku                         text,
    hsn_code                    text,
    quantity                    numeric(12,2) not null check (quantity > 0),
    unit_price                  numeric(14,2) not null check (unit_price >= 0),
    price_includes_gst          boolean not null,
    discount_percent            numeric(5,2) not null default 0 check (discount_percent between 0 and 100),
    discount_amount             numeric(14,2) not null default 0 check (discount_amount >= 0),
    taxable_amount              numeric(14,2) not null,
    gst_rate                    numeric(5,2) not null,
    cgst                        numeric(14,2) not null default 0,
    sgst                        numeric(14,2) not null default 0,
    igst                        numeric(14,2) not null default 0,
    line_total                  numeric(14,2) not null,
    unit_cost                   numeric(14,2) not null default 0,   -- snapshot for profit reports
    returned_qty                numeric(12,2) not null default 0 check (returned_qty >= 0),
    source_sales_order_item_id  bigint references sales_order_items(id),
    constraint ck_invoice_item_returned check (returned_qty <= quantity)
);
create index ix_invoice_items_invoice on invoice_items (invoice_id);
create index ix_invoice_items_variant on invoice_items (variant_id);

-- ---------------------------------------------------------------------
-- Custom furniture orders
-- ---------------------------------------------------------------------
create table custom_orders (
    id                        bigint generated always as identity primary key,
    number                    text not null unique,
    customer_id               bigint not null references customers(id),
    order_date                date not null,
    product_type              text not null,
    design                    text,
    width                     numeric(10,2),
    height                    numeric(10,2),
    depth                     numeric(10,2),
    dimension_unit            text not null default 'ft' check (dimension_unit in ('ft','in','cm','mm')),
    material                  text,
    color                     text,
    fabric                    text,
    finish                    text,
    doors                     int check (doors >= 0),
    drawers                   int check (drawers >= 0),
    special_requirements      text,
    reference_attachment_id   bigint references attachments(id),
    estimated_cost            numeric(14,2) not null default 0 check (estimated_cost >= 0),
    final_price               numeric(14,2) not null default 0 check (final_price >= 0),
    production_cost           numeric(14,2) not null default 0 check (production_cost >= 0),
    hsn_code                  text,
    gst_rate                  numeric(5,2) not null,
    price_includes_gst        boolean not null default true,
    expected_completion_date  date,
    status                    text not null default 'RECEIVED' check (status in ('RECEIVED','PRODUCTION','QUALITY_CHECK','READY','DELIVERY','INSTALLATION','COMPLETED','CANCELLED')),
    requires_installation     boolean not null default false,
    delivery_address          text,
    notes                     text,
    invoice_id                bigint references invoices(id),
    cancel_reason             text,
    created_by                bigint references users(id),
    created_at                timestamptz not null default now(),
    updated_at                timestamptz not null default now()
);
create index ix_custom_orders_customer on custom_orders (customer_id);
create index ix_custom_orders_status on custom_orders (status);
alter table invoices add constraint fk_invoices_custom_order foreign key (custom_order_id) references custom_orders(id);

-- Optional additional components of a custom order (e.g. wardrobe + loft).
create table custom_order_items (
    id               bigint generated always as identity primary key,
    custom_order_id  bigint not null references custom_orders(id) on delete cascade,
    description      text not null,
    quantity         numeric(12,2) not null default 1 check (quantity > 0),
    notes            text
);

-- Status history for workflow documents (sales orders, custom orders,
-- deliveries, installations, quotations).
create table status_history (
    id           bigint generated always as identity primary key,
    doc_type     text not null,
    doc_id       bigint not null,
    from_status  text,
    to_status    text not null,
    note         text,
    changed_by   bigint references users(id),
    changed_at   timestamptz not null default now()
);
create index ix_status_history_doc on status_history (doc_type, doc_id, changed_at);

-- ---------------------------------------------------------------------
-- Customer payments (receipts & refunds)
--   payments          : one receipt / refund voucher (immutable; can only be voided)
--   payment_lines     : split by method (cash + UPI + card ... in one receipt)
--   payment_allocations: which document(s) the money is applied to.
-- An advance collected on a sales order is allocated to SALES_ORDER; when
-- the order is invoiced the allocation is *transferred* by inserting a
-- negative row against the order and a positive row against the invoice,
-- so the history is never rewritten.
-- ---------------------------------------------------------------------
create table payments (
    id            bigint generated always as identity primary key,
    number        text not null unique,
    direction     text not null default 'IN' check (direction in ('IN','OUT')),
    customer_id   bigint not null references customers(id),
    payment_date  date not null,
    amount        numeric(14,2) not null check (amount > 0),
    notes         text,
    created_by    bigint references users(id),
    created_at    timestamptz not null default now(),
    is_voided     boolean not null default false,
    voided_by     bigint references users(id),
    voided_at     timestamptz,
    void_reason   text,
    constraint ck_payment_void check (not is_voided or (void_reason is not null and voided_at is not null))
);
create index ix_payments_customer on payments (customer_id);
create index ix_payments_date on payments (payment_date desc);

create table payment_lines (
    id           bigint generated always as identity primary key,
    payment_id   bigint not null references payments(id),
    method_code  text not null references payment_methods(code),
    amount       numeric(14,2) not null check (amount > 0),
    reference    text,
    cheque_date  date,
    bank_name    text
);
create index ix_payment_lines_payment on payment_lines (payment_id);

create table payment_allocations (
    id          bigint generated always as identity primary key,
    payment_id  bigint not null references payments(id),
    doc_type    text not null check (doc_type in ('INVOICE','SALES_ORDER','CUSTOM_ORDER','ON_ACCOUNT')),
    doc_id      bigint,
    amount      numeric(14,2) not null check (amount <> 0),
    note        text,
    created_by  bigint references users(id),
    created_at  timestamptz not null default now(),
    constraint ck_alloc_doc check ((doc_type = 'ON_ACCOUNT') = (doc_id is null))
);
create index ix_alloc_doc on payment_allocations (doc_type, doc_id);
create index ix_alloc_payment on payment_allocations (payment_id);

-- ---------------------------------------------------------------------
-- Returns & exchanges
-- ---------------------------------------------------------------------
create table exchanges (
    id                  bigint generated always as identity primary key,
    number              text not null unique,
    customer_id         bigint not null references customers(id),
    original_invoice_id bigint not null references invoices(id),
    new_invoice_id      bigint references invoices(id),
    return_id           bigint,
    old_value           numeric(14,2) not null,
    new_value           numeric(14,2) not null,
    transferred_amount  numeric(14,2) not null default 0,
    difference          numeric(14,2) not null,
    notes               text,
    created_by          bigint references users(id),
    created_at          timestamptz not null default now()
);

create table sales_returns (
    id                 bigint generated always as identity primary key,
    number             text not null unique,
    invoice_id         bigint not null references invoices(id),
    customer_id        bigint not null references customers(id),
    return_date        date not null,
    reason             text not null check (reason in ('DAMAGED','MANUFACTURING_DEFECT','WRONG_PRODUCT','CUSTOMER_REQUEST','EXCHANGE','OTHER')),
    credit_amount      numeric(14,2) not null check (credit_amount >= 0),
    refund_amount      numeric(14,2) not null default 0 check (refund_amount >= 0),
    refund_payment_id  bigint references payments(id),
    exchange_id        bigint references exchanges(id),
    notes              text,
    created_by         bigint references users(id),
    created_at         timestamptz not null default now()
);
create index ix_returns_invoice on sales_returns (invoice_id);
alter table exchanges add constraint fk_exchanges_return foreign key (return_id) references sales_returns(id);

create table sales_return_items (
    id               bigint generated always as identity primary key,
    return_id        bigint not null references sales_returns(id) on delete cascade,
    invoice_item_id  bigint not null references invoice_items(id),
    variant_id       bigint references product_variants(id),
    quantity         numeric(12,2) not null check (quantity > 0),
    condition        text not null check (condition in ('GOOD','DAMAGED','DEFECTIVE')),
    restock_action   text not null check (restock_action in ('RESTOCK','DAMAGED_STOCK','NO_RESTOCK')),
    credit_amount    numeric(14,2) not null check (credit_amount >= 0)
);

-- ---------------------------------------------------------------------
-- Purchases
-- ---------------------------------------------------------------------
create table purchases (
    id                   bigint generated always as identity primary key,
    number               text not null unique,
    supplier_id          bigint not null references suppliers(id),
    supplier_invoice_no  text,
    purchase_date        date not null,
    due_date             date,
    status               text not null default 'DRAFT' check (status in ('DRAFT','COMPLETED','CANCELLED')),
    is_inter_state       boolean not null default false,
    subtotal             numeric(14,2) not null default 0,
    discount_total       numeric(14,2) not null default 0,
    taxable_total        numeric(14,2) not null default 0,
    cgst_total           numeric(14,2) not null default 0,
    sgst_total           numeric(14,2) not null default 0,
    igst_total           numeric(14,2) not null default 0,
    other_charges        numeric(14,2) not null default 0 check (other_charges >= 0),
    round_off            numeric(14,2) not null default 0,
    grand_total          numeric(14,2) not null default 0 check (grand_total >= 0),
    notes                text,
    created_by           bigint references users(id),
    created_at           timestamptz not null default now(),
    completed_by         bigint references users(id),
    completed_at         timestamptz,
    cancelled_at         timestamptz,
    cancel_reason        text
);
create unique index ux_purchases_supplier_invoice on purchases (supplier_id, supplier_invoice_no) where supplier_invoice_no is not null and status <> 'CANCELLED';
create index ix_purchases_supplier on purchases (supplier_id);
create index ix_purchases_date on purchases (purchase_date desc);

create table purchase_items (
    id                bigint generated always as identity primary key,
    purchase_id       bigint not null references purchases(id) on delete cascade,
    line_no           int not null,
    variant_id        bigint not null references product_variants(id),
    description       text not null,
    hsn_code          text,
    quantity          numeric(12,2) not null check (quantity > 0),
    unit_cost         numeric(14,2) not null check (unit_cost >= 0),
    discount_percent  numeric(5,2) not null default 0 check (discount_percent between 0 and 100),
    discount_amount   numeric(14,2) not null default 0,
    taxable_amount    numeric(14,2) not null,
    gst_rate          numeric(5,2) not null,
    cgst              numeric(14,2) not null default 0,
    sgst              numeric(14,2) not null default 0,
    igst              numeric(14,2) not null default 0,
    line_total        numeric(14,2) not null
);
create index ix_purchase_items_purchase on purchase_items (purchase_id);

create table supplier_payments (
    id            bigint generated always as identity primary key,
    number        text not null unique,
    supplier_id   bigint not null references suppliers(id),
    payment_date  date not null,
    amount        numeric(14,2) not null check (amount > 0),
    method_code   text not null references payment_methods(code),
    reference     text,
    notes         text,
    created_by    bigint references users(id),
    created_at    timestamptz not null default now(),
    is_voided     boolean not null default false,
    voided_by     bigint references users(id),
    voided_at     timestamptz,
    void_reason   text
);
create index ix_supplier_payments_supplier on supplier_payments (supplier_id);

create table supplier_payment_allocations (
    id                   bigint generated always as identity primary key,
    supplier_payment_id  bigint not null references supplier_payments(id),
    purchase_id          bigint references purchases(id),   -- null = on account
    amount               numeric(14,2) not null check (amount > 0)
);
create index ix_sp_alloc_purchase on supplier_payment_allocations (purchase_id);

-- ---------------------------------------------------------------------
-- Delivery & installation
-- ---------------------------------------------------------------------
create table deliveries (
    id                       bigint generated always as identity primary key,
    number                   text not null unique,
    customer_id              bigint not null references customers(id),
    invoice_id               bigint references invoices(id),
    sales_order_id           bigint references sales_orders(id),
    custom_order_id          bigint references custom_orders(id),
    delivery_address         text not null,
    contact_mobile           text,
    scheduled_date           date,
    time_slot                text,
    driver_name              text,
    driver_user_id           bigint references users(id),
    vehicle_no               text,
    delivery_charge          numeric(14,2) not null default 0 check (delivery_charge >= 0),
    delivery_cost            numeric(14,2) not null default 0 check (delivery_cost >= 0),
    status                   text not null default 'PENDING' check (status in ('PENDING','SCHEDULED','OUT_FOR_DELIVERY','DELIVERED','FAILED','CANCELLED')),
    otp_hash                 text,
    otp_verified             boolean not null default false,
    receiver_name            text,
    signature_attachment_id  bigint references attachments(id),
    photo_attachment_id      bigint references attachments(id),
    remarks                  text,
    notes                    text,
    delivered_at             timestamptz,
    delivered_by             bigint references users(id),
    created_by               bigint references users(id),
    created_at               timestamptz not null default now(),
    updated_at               timestamptz not null default now(),
    constraint ck_delivery_source check (invoice_id is not null or sales_order_id is not null or custom_order_id is not null),
    constraint ck_delivered_proof check (status <> 'DELIVERED' or (receiver_name is not null and delivered_at is not null
        and (otp_verified or signature_attachment_id is not null or photo_attachment_id is not null or coalesce(remarks,'') <> '')))
);
create index ix_deliveries_status on deliveries (status, scheduled_date);

create table delivery_items (
    id               bigint generated always as identity primary key,
    delivery_id      bigint not null references deliveries(id) on delete cascade,
    variant_id       bigint references product_variants(id),
    description      text not null,
    quantity         numeric(12,2) not null check (quantity > 0)
);

create table installations (
    id                   bigint generated always as identity primary key,
    number               text not null unique,
    customer_id          bigint not null references customers(id),
    delivery_id          bigint references deliveries(id),
    invoice_id           bigint references invoices(id),
    sales_order_id       bigint references sales_orders(id),
    custom_order_id      bigint references custom_orders(id),
    address              text not null,
    technician_name      text,
    technician_user_id   bigint references users(id),
    scheduled_date       date,
    completed_at         timestamptz,
    status               text not null default 'PENDING' check (status in ('PENDING','SCHEDULED','ASSIGNED','COMPLETED','CANCELLED')),
    installation_cost    numeric(14,2) not null default 0 check (installation_cost >= 0),
    notes                text,
    completion_notes     text,
    created_by           bigint references users(id),
    created_at           timestamptz not null default now(),
    updated_at           timestamptz not null default now(),
    constraint ck_installation_complete check (status <> 'COMPLETED' or completed_at is not null)
);
create index ix_installations_status on installations (status, scheduled_date);

-- ---------------------------------------------------------------------
-- Expenses
-- ---------------------------------------------------------------------
create table expense_categories (
    id          bigint generated always as identity primary key,
    name        text not null,
    is_active   boolean not null default true
);
create unique index ux_expense_categories_name on expense_categories (lower(name));

create table expenses (
    id              bigint generated always as identity primary key,
    number          text not null unique,
    category_id     bigint not null references expense_categories(id),
    expense_date    date not null,
    amount          numeric(14,2) not null check (amount > 0),
    method_code     text not null references payment_methods(code),
    description     text,
    reference       text,
    delivery_id     bigint references deliveries(id),
    installation_id bigint references installations(id),
    created_by      bigint references users(id),
    created_at      timestamptz not null default now(),
    is_deleted      boolean not null default false,
    deleted_at      timestamptz,
    deleted_by      bigint references users(id)
);
create index ix_expenses_date on expenses (expense_date desc);

-- ---------------------------------------------------------------------
-- Audit & notifications
-- ---------------------------------------------------------------------
create table audit_logs (
    id           bigint generated always as identity primary key,
    occurred_at  timestamptz not null default now(),
    user_id      bigint references users(id),
    username     text,
    action       text not null,
    module       text not null,
    record_type  text,
    record_id    bigint,
    record_ref   text,
    summary      text not null,
    old_value    jsonb,
    new_value    jsonb,
    machine      text,
    ip_address   text
);
create index ix_audit_time on audit_logs (occurred_at desc);
create index ix_audit_record on audit_logs (record_type, record_id);
create index ix_audit_user on audit_logs (user_id, occurred_at desc);

-- Audit rows are append-only.
create or replace function fn_audit_immutable() returns trigger language plpgsql as $$
begin
    raise exception 'audit_logs is append-only';
end $$;
create trigger trg_audit_no_update before update or delete on audit_logs
    for each row execute function fn_audit_immutable();

-- Payment records are immutable except for the void columns.
create or replace function fn_payments_guard() returns trigger language plpgsql as $$
begin
    if tg_op = 'DELETE' then
        raise exception 'payments cannot be deleted; void them instead';
    end if;
    if new.amount <> old.amount or new.customer_id <> old.customer_id or new.direction <> old.direction
       or new.payment_date <> old.payment_date or new.number <> old.number then
        raise exception 'payments are immutable; void and re-enter instead';
    end if;
    if old.is_voided and not new.is_voided then
        raise exception 'a voided payment cannot be restored';
    end if;
    return new;
end $$;
create trigger trg_payments_guard before update or delete on payments
    for each row execute function fn_payments_guard();

create or replace function fn_no_delete() returns trigger language plpgsql as $$
begin
    raise exception '% rows cannot be deleted', tg_table_name;
end $$;
create trigger trg_payment_lines_no_delete before update or delete on payment_lines
    for each row execute function fn_no_delete();
create trigger trg_payment_alloc_no_delete before update or delete on payment_allocations
    for each row execute function fn_no_delete();
create trigger trg_movements_no_delete before update or delete on inventory_movements
    for each row execute function fn_no_delete();

-- Finalised invoices cannot be deleted (cancel instead).
create or replace function fn_invoices_guard() returns trigger language plpgsql as $$
begin
    if tg_op = 'DELETE' and old.status <> 'DRAFT' then
        raise exception 'finalised invoices cannot be deleted; cancel instead';
    end if;
    if tg_op = 'UPDATE' and old.status = 'FINAL' and new.status = 'DRAFT' then
        raise exception 'a finalised invoice cannot return to draft';
    end if;
    if tg_op = 'UPDATE' and old.status = 'CANCELLED' and new.status <> 'CANCELLED' then
        raise exception 'a cancelled invoice cannot be reopened';
    end if;
    if tg_op = 'UPDATE' and old.number is not null and new.number is distinct from old.number then
        raise exception 'invoice numbers cannot be changed';
    end if;
    if tg_op = 'DELETE' then return old; end if;
    return new;
end $$;
create trigger trg_invoices_guard before update or delete on invoices
    for each row execute function fn_invoices_guard();

create table notifications (
    id          bigint generated always as identity primary key,
    user_id     bigint references users(id),
    kind        text not null,
    title       text not null,
    message     text not null,
    ref_type    text,
    ref_id      bigint,
    is_read     boolean not null default false,
    created_at  timestamptz not null default now()
);
create index ix_notifications_user on notifications (user_id, is_read, created_at desc);

-- ---------------------------------------------------------------------
-- Reporting helper views
-- ---------------------------------------------------------------------

-- Net amount received against a document (IN minus refunds OUT), voids excluded.
create view v_document_payments as
select a.doc_type, a.doc_id,
       sum(case when p.direction = 'IN' then a.amount else -a.amount end) as paid
from payment_allocations a
join payments p on p.id = a.payment_id and not p.is_voided
where a.doc_id is not null
group by a.doc_type, a.doc_id;

create view v_invoice_balances as
select i.id as invoice_id, i.number, i.customer_id, i.invoice_date, i.due_date, i.grand_total,
       coalesce(r.returned, 0) as returned_amount,
       i.grand_total - coalesce(r.returned, 0) as net_total,
       coalesce(p.paid, 0) as paid,
       i.grand_total - coalesce(r.returned, 0) - coalesce(p.paid, 0) as balance
from invoices i
left join (select invoice_id, sum(credit_amount) as returned from sales_returns group by invoice_id) r on r.invoice_id = i.id
left join v_document_payments p on p.doc_type = 'INVOICE' and p.doc_id = i.id
where i.status = 'FINAL';

create view v_inventory as
select v.id as variant_id, v.product_id, v.sku, v.barcode, v.variant_name,
       p.name as product_name, p.code as product_code, p.category_id, c.name as category_name,
       coalesce(i.on_hand, 0) as on_hand, coalesce(i.reserved, 0) as reserved,
       coalesce(i.damaged, 0) as damaged, coalesce(i.display_qty, 0) as display_qty,
       coalesce(i.on_hand, 0) - coalesce(i.reserved, 0) as available,
       coalesce(v.min_stock, p.min_stock) as min_stock,
       coalesce(v.cost_price, p.cost_price) as cost_price,
       coalesce(v.selling_price, p.selling_price) as selling_price,
       p.is_stock_item, p.status as product_status
from product_variants v
join products p on p.id = v.product_id and not p.is_deleted
join categories c on c.id = p.category_id
left join inventory i on i.variant_id = v.id
where not v.is_deleted;
