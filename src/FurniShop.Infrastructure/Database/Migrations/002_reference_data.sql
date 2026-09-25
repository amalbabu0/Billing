-- =====================================================================
-- Reference data required by every installation (not demo data).
-- =====================================================================

insert into permissions (code, module, description) values
 ('dashboard.view',        'Dashboard',     'View dashboard'),
 ('invoice.view',          'Sales',         'View invoices'),
 ('invoice.create',        'Sales',         'Create and finalise invoices (POS)'),
 ('invoice.discount',      'Sales',         'Give discounts above the product default'),
 ('invoice.cancel',        'Sales',         'Cancel finalised invoices'),
 ('quotation.view',        'Sales',         'View quotations'),
 ('quotation.manage',      'Sales',         'Create / edit / convert quotations'),
 ('salesorder.view',       'Sales',         'View sales orders'),
 ('salesorder.manage',     'Sales',         'Create / edit / convert sales orders'),
 ('payment.view',          'Payments',      'View payments and receipts'),
 ('payment.receive',       'Payments',      'Receive customer payments'),
 ('payment.void',          'Payments',      'Void (correct) a payment'),
 ('payment.refund',        'Payments',      'Pay refunds to customers'),
 ('return.view',           'Sales',         'View sales returns and exchanges'),
 ('return.manage',         'Sales',         'Process sales returns and exchanges'),
 ('customer.view',         'Customers',     'View customers and ledgers'),
 ('customer.manage',       'Customers',     'Create / edit customers'),
 ('customer.delete',       'Customers',     'Delete customers'),
 ('product.view',          'Products',      'View products and availability'),
 ('product.manage',        'Products',      'Create / edit products, categories, variants'),
 ('product.delete',        'Products',      'Delete products'),
 ('cost.view',             'Products',      'See cost price, margins and profit'),
 ('inventory.view',        'Inventory',     'View stock and stock movement'),
 ('inventory.adjust',      'Inventory',     'Stock in / adjustments / damage'),
 ('purchase.view',         'Purchases',     'View purchases'),
 ('purchase.manage',       'Purchases',     'Create / complete purchases'),
 ('supplier.view',         'Purchases',     'View suppliers and ledgers'),
 ('supplier.manage',       'Purchases',     'Create / edit suppliers'),
 ('supplier.pay',          'Purchases',     'Record supplier payments'),
 ('customorder.view',      'Custom Orders', 'View custom orders'),
 ('customorder.manage',    'Custom Orders', 'Create custom orders and update production'),
 ('delivery.view',         'Delivery',      'View deliveries'),
 ('delivery.manage',       'Delivery',      'Schedule and complete deliveries'),
 ('installation.view',     'Installation',  'View installations'),
 ('installation.manage',   'Installation',  'Schedule and complete installations'),
 ('expense.view',          'Expenses',      'View expenses'),
 ('expense.manage',        'Expenses',      'Record expenses'),
 ('report.sales',          'Reports',       'Sales, customer and staff reports'),
 ('report.inventory',      'Reports',       'Inventory reports'),
 ('report.purchase',       'Reports',       'Purchase and supplier reports'),
 ('report.payment',        'Reports',       'Payment and outstanding reports'),
 ('report.gst',            'Reports',       'GST reports'),
 ('report.profit',         'Reports',       'Profit reports'),
 ('export.data',           'Reports',       'Export data to CSV / Excel / PDF'),
 ('user.manage',           'Employees',     'Manage users'),
 ('role.manage',           'Employees',     'Manage roles and permissions'),
 ('audit.view',            'Employees',     'View activity logs'),
 ('settings.manage',       'Settings',      'Change shop settings'),
 ('backup.manage',         'Settings',      'Backup, export and restore data');

insert into roles (code, name, description, is_system) values
 ('ADMIN',      'Admin / Owner',  'Full access to everything',                               true),
 ('MANAGER',    'Manager',        'Sales, inventory, customers and reports',                 true),
 ('SALES',      'Sales Staff',    'Customers, quotations, invoices and payments',            true),
 ('DELIVERY',   'Delivery Staff', 'Delivery and installation management only',               true),
 ('ACCOUNTANT', 'Accountant',     'Invoices, payments, reports and GST',                     true);

insert into role_permissions (role_id, permission_code)
select r.id, p.code from roles r cross join permissions p where r.code = 'ADMIN';

insert into role_permissions (role_id, permission_code)
select r.id, p.code from roles r join permissions p on p.code in (
  'dashboard.view','invoice.view','invoice.create','invoice.discount','invoice.cancel',
  'quotation.view','quotation.manage','salesorder.view','salesorder.manage',
  'payment.view','payment.receive','payment.refund','return.view','return.manage',
  'customer.view','customer.manage','product.view','product.manage','cost.view',
  'inventory.view','inventory.adjust','purchase.view','purchase.manage','supplier.view','supplier.manage',
  'customorder.view','customorder.manage','delivery.view','delivery.manage',
  'installation.view','installation.manage','expense.view','expense.manage',
  'report.sales','report.inventory','report.purchase','report.payment','report.gst','report.profit',
  'export.data','audit.view')
where r.code = 'MANAGER';

insert into role_permissions (role_id, permission_code)
select r.id, p.code from roles r join permissions p on p.code in (
  'dashboard.view','invoice.view','invoice.create','quotation.view','quotation.manage',
  'salesorder.view','salesorder.manage','payment.view','payment.receive',
  'customer.view','customer.manage','product.view','inventory.view',
  'customorder.view','customorder.manage','delivery.view','return.view')
where r.code = 'SALES';

insert into role_permissions (role_id, permission_code)
select r.id, p.code from roles r join permissions p on p.code in (
  'delivery.view','delivery.manage','installation.view','installation.manage')
where r.code = 'DELIVERY';

insert into role_permissions (role_id, permission_code)
select r.id, p.code from roles r join permissions p on p.code in (
  'dashboard.view','invoice.view','quotation.view','salesorder.view',
  'payment.view','payment.receive','payment.refund','payment.void','return.view',
  'customer.view','product.view','cost.view','inventory.view','purchase.view','supplier.view','supplier.pay',
  'customorder.view','delivery.view','installation.view','expense.view','expense.manage',
  'report.sales','report.inventory','report.purchase','report.payment','report.gst','report.profit','export.data')
where r.code = 'ACCOUNTANT';

insert into payment_methods (code, name, sort_order, is_money, is_system) values
 ('CASH',   'Cash',          1, true,  true),
 ('UPI',    'UPI',           2, true,  true),
 ('CARD',   'Card',          3, true,  true),
 ('BANK',   'Bank Transfer', 4, true,  true),
 ('CHEQUE', 'Cheque',        5, true,  true),
 ('CREDIT', 'Credit (pay later)', 6, false, true);

insert into gst_rates (name, rate, is_default) values
 ('Exempt', 0, false), ('GST 5%', 5, false), ('GST 12%', 12, false), ('GST 18%', 18, true), ('GST 28%', 28, false);

-- Common furniture HSN codes (chapter 94). Rates are defaults only and are
-- editable from Settings -> Tax.
insert into hsn_codes (code, description, default_gst_rate) values
 ('9401', 'Seats / chairs / sofas (whether or not convertible into beds)', 18),
 ('9403', 'Other furniture (wooden, metal, plastic) — beds, wardrobes, tables, TV units', 18),
 ('940310', 'Metal furniture of a kind used in offices', 18),
 ('940330', 'Wooden furniture of a kind used in offices', 18),
 ('940350', 'Wooden furniture of a kind used in the bedroom', 18),
 ('940360', 'Other wooden furniture', 18),
 ('9404', 'Mattresses, mattress supports, cushions, pillows', 18),
 ('998719', 'Installation services', 18),
 ('996511', 'Road transport / delivery services', 18);

insert into document_sequences (doc_type, prefix, include_year, padding, next_number) values
 ('INVOICE',          'INV', true, 4, 1),
 ('QUOTATION',        'QTN', true, 4, 1),
 ('SALES_ORDER',      'SO',  true, 4, 1),
 ('PAYMENT',          'RCPT',true, 4, 1),
 ('REFUND',           'RFD', true, 4, 1),
 ('RETURN',           'SR',  true, 4, 1),
 ('EXCHANGE',         'EXC', true, 4, 1),
 ('CUSTOM_ORDER',     'CO',  true, 4, 1),
 ('PURCHASE',         'PUR', true, 4, 1),
 ('SUPPLIER_PAYMENT', 'SPAY',true, 4, 1),
 ('DELIVERY',         'DL',  true, 4, 1),
 ('INSTALLATION',     'INS', true, 4, 1),
 ('EXPENSE',          'EXP', true, 4, 1),
 ('ADJUSTMENT',       'ADJ', true, 4, 1),
 ('CUSTOMER',         'CUS', false, 5, 1),
 ('SUPPLIER',         'SUP', false, 4, 1);

insert into expense_categories (name) values
 ('Rent'), ('Electricity'), ('Salary'), ('Transportation'), ('Delivery'), ('Installation'),
 ('Advertising'), ('Repairs'), ('Packaging'), ('Maintenance'), ('Other');

-- The walk-in customer used for cash counter sales. Credit sales are
-- blocked for this customer by the invoice service.
insert into customers (code, name, is_walk_in, notes) values ('WALKIN', 'Walk-in Customer', true, 'Counter sales without customer details');
