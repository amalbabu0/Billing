using Dapper;
using FurniShop.Core;
using FurniShop.Core.Domain;
using FurniShop.Core.Settings;
using FurniShop.Core.Validation;
using FurniShop.Infrastructure.Security;
using FurniShop.Infrastructure.Services;

namespace FurniShop.Infrastructure.Database;

/// <summary>
/// Realistic demo data for a Bengaluru furniture showroom. Everything is created through the real
/// services (purchases add stock, invoices remove it, payments hit the ledger…), so the demo data is
/// internally consistent and the dashboard is useful from the first start.
/// Only runs on a database without invoices.
/// </summary>
public sealed class DemoDataSeeder(AppServices app)
{
    public const string DemoPassword = "Demo@1234";
    private readonly Random _rnd = new(2026);
    private readonly Dictionary<string, long> _variants = new();
    private readonly List<long> _customers = new();

    public async Task<bool> CanSeedAsync() => await app.Db.ScalarAsync<int>("select count(*) from invoices") == 0;

    public async Task SeedAsync(IProgress<string>? progress = null)
    {
        if (!app.Session.IsAdmin) throw new PermissionDeniedException("Only an admin can load demo data");
        if (!await CanSeedAsync()) throw new BusinessRuleException("Demo data can only be loaded into an empty database.");
        var today = DateTime.Today;

        progress?.Report("Shop settings…");
        await SettingsAsync();
        progress?.Report("Staff accounts…");
        await UsersAsync();
        progress?.Report("Catalogue…");
        await CatalogAsync();
        progress?.Report("Suppliers and purchases…");
        await PurchasesAsync(today);
        progress?.Report("Customers…");
        await CustomersAsync();
        progress?.Report("Sales and payments…");
        await SalesAsync(today);
        progress?.Report("Quotations and sales orders…");
        await OrdersAsync(today);
        progress?.Report("Custom furniture orders…");
        await CustomOrdersAsync(today);
        progress?.Report("Deliveries, returns and expenses…");
        await DeliveriesAsync(today);
        await ReturnsAsync(today);
        await ExpensesAsync(today);
        await new DemoOperationsSeeder(app).SeedAsync(progress);
        await app.Audit.LogAsync("SEED", "System", "loaded demo data");
        progress?.Report("Done");
    }

    private async Task SettingsAsync()
    {
        var gstin = "29ABCDE1234F1Z";
        gstin += Validators.GstinCheckChar(gstin);
        await app.Settings.SaveAsync("shop", new ShopSettings
        {
            ShopName = "Royal Oak Furniture Gallery", Tagline = "Handcrafted comfort since 1998",
            Address = "No. 42, 80 Feet Road, Koramangala 4th Block", City = "Bengaluru", StateCode = "29", Pincode = "560034",
            Phone = "080-4123 5678, 98450 12345", Email = "sales@royaloakgallery.in", Website = "www.royaloakgallery.in", Gstin = gstin,
            BankName = "HDFC Bank, Koramangala", BankAccount = "50200012345678", BankIfsc = "HDFC0000053", UpiId = "royaloak@hdfcbank",
        });
    }

    private async Task UsersAsync()
    {
        var roles = (await app.Users.RolesAsync()).ToDictionary(r => r.Code, r => r.Id);
        foreach (var (user, name, role, mobile) in new[]
                 {
                     ("manager", "Suresh Kumar", "MANAGER", "9845011111"), ("sales1", "Priya Sharma", "SALES", "9845022222"),
                     ("sales2", "Arjun Reddy", "SALES", "9845033333"), ("delivery1", "Ramesh Gowda", "DELIVERY", "9845044444"),
                     ("accounts", "Lakshmi Iyer", "ACCOUNTANT", "9845055555"),
                 })
        {
            var id = await app.Users.SaveAsync(new User { Username = user, FullName = name, RoleId = roles[role], Mobile = mobile, IsActive = true }, DemoPassword);
            await app.Db.ExecuteAsync("update users set must_change_password = false where id = @id", new { id });
        }
    }

    private async Task CatalogAsync()
    {
        var brands = new Dictionary<string, long>();
        foreach (var b in new[] { "Royal Oak", "Godrej Interio", "Durian", "Sleepwell", "Nilkamal", "Featherlite" })
            brands[b] = await app.Catalog.SaveBrandAsync(new Brand { Name = b });

        var cats = new Dictionary<string, long>();
        foreach (var (name, hsn) in new[] { ("Sofa", "9401"), ("Bed", "940350"), ("Wardrobe", "940350"), ("Dining Table", "940360"), ("Chair", "9401"),
                     ("Mattress", "9404"), ("TV Unit", "940360"), ("Office Furniture", "940330") })
            cats[name] = await app.Catalog.SaveCategoryAsync(new Category { Name = name, DefaultHsn = hsn, DefaultGstRate = 18 });

        async Task Add(string cat, string code, string name, string? brand, string material, string? color, string? dims, decimal cost, decimal price,
            decimal minStock, int warranty, string? finish = null, string? fabric = null, decimal disc = 0, bool stock = true,
            params (string Name, string Sku, decimal? Cost, decimal? Price, string? Size, string? Color, string? Dims)[] variants)
        {
            var hsn = await app.Db.ScalarAsync<string>("select default_hsn from categories where id = @id", new { id = cats[cat] });
            var p = new Product
            {
                Code = code, Name = name, CategoryId = cats[cat], BrandId = brand is null ? null : brands[brand], Material = material, Color = color,
                Dimensions = dims, CostPrice = cost, SellingPrice = price, GstRate = 18, PriceIncludesGst = true, HsnCode = hsn, MinStock = minStock,
                WarrantyMonths = warranty, Finish = finish, Fabric = fabric, DiscountPercent = disc, IsStockItem = stock, Status = "ACTIVE",
                Description = $"{name} in {material}{(color is null ? "" : ", " + color)}.",
            };
            foreach (var v in variants)
                p.Variants.Add(new ProductVariant { VariantName = v.Name, Sku = v.Sku, CostPrice = v.Cost, SellingPrice = v.Price, Size = v.Size, Color = v.Color, Dimensions = v.Dims });
            var id = await app.Catalog.SaveProductAsync(p);
            var saved = await app.Catalog.GetProductAsync(id);
            foreach (var v in saved.Variants) _variants[v.Sku] = v.Id;
        }

        await Add("Wardrobe", "WRD-003", "3 Door Wooden Wardrobe", "Royal Oak", "Teak Wood", "Walnut", "6 × 4 × 2 ft", 32000, 45000, 2, 60, "Matte PU");
        await Add("Wardrobe", "WRD-002", "2 Door Sliding Wardrobe", "Godrej Interio", "Engineered Wood", "Wenge", "6.5 × 3 × 2 ft", 18500, 26500, 2, 36, "Laminate");
        await Add("Wardrobe", "WRD-004", "4 Door Wardrobe with Mirror", "Durian", "Sheesham Wood", "Honey", "7 × 5.5 × 2 ft", 41000, 58500, 1, 60, "Melamine");
        await Add("Dining Table", "DIN-SHM", "Sheesham Dining Set", "Royal Oak", "Sheesham Wood", "Natural", null, 0, 0, 1, 36, "Melamine", disc: 5, variants: new (string, string, decimal?, decimal?, string?, string?, string?)[]
        {
            ("4 Seater", "DIN-SHM-4", 14000, 20000, "4 Seater", null, "4 × 3 ft"), ("6 Seater", "DIN-SHM-6", 19500, 28000, "6 Seater", null, "6 × 3 ft"),
            ("8 Seater", "DIN-SHM-8", 24500, 35000, "8 Seater", null, "7.5 × 3.5 ft"),
        });
        await Add("Dining Table", "DIN-GLS-6", "Glass Top Dining Table 6 Seater", "Durian", "Metal + Tempered Glass", "Black", "5.5 × 3 ft", 21000, 32500, 1, 24);
        await Add("Sofa", "SOF-CHS", "Chesterfield 3 Seater Sofa", "Royal Oak", "Solid Wood Frame", null, "7 × 3 × 2.8 ft", 0, 0, 2, 36, fabric: "Velvet", disc: 5, variants: new (string, string, decimal?, decimal?, string?, string?, string?)[]
        {
            ("Emerald Velvet", "SOF-CHS-GRN", 38000, 54000, null, "Emerald", null), ("Royal Blue Velvet", "SOF-CHS-BLU", 38000, 54000, null, "Royal Blue", null),
            ("Tan Leatherette", "SOF-CHS-TAN", 42000, 62000, null, "Tan", null),
        });
        await Add("Sofa", "SOF-LSH", "L-Shape Sectional Sofa", "Durian", "Pine Wood Frame", "Grey", "8 × 6 ft", 45000, 68000, 1, 36, fabric: "Jute Blend", disc: 5);
        await Add("Sofa", "SOF-REC-1", "Single Seater Recliner", "Godrej Interio", "Metal Frame", "Brown", "3 × 3 × 3.3 ft", 17500, 26000, 2, 24, fabric: "Leatherette");
        await Add("Sofa", "SOF-CMB-2", "Sofa Cum Bed", "Nilkamal", "Engineered Wood", "Beige", "6 × 3 ft", 14000, 21500, 2, 12, fabric: "Polyester");
        await Add("Bed", "BED-KNG", "King Size Hydraulic Storage Bed", "Royal Oak", "Engineered Wood", "Walnut", "6.5 × 6 ft", 26500, 38500, 2, 60, "Laminate", variants: new (string, string, decimal?, decimal?, string?, string?, string?)[]
        {
            ("King", "BED-KNG-K", 26500, 38500, "King", null, "6.5 × 6 ft"), ("Queen", "BED-KNG-Q", 23500, 34000, "Queen", null, "6.5 × 5 ft"),
        });
        await Add("Bed", "BED-TEAK-Q", "Teak Wood Queen Bed", "Royal Oak", "Teak Wood", "Natural Teak", "6.5 × 5 ft", 42000, 59000, 1, 60, "Polish");
        await Add("Bed", "BED-SGL", "Single Bed with Drawer", "Nilkamal", "Engineered Wood", "Oak", "6.5 × 3 ft", 9000, 13500, 2, 24);
        await Add("Mattress", "MAT-ORT", "Orthopaedic Memory Foam Mattress", "Sleepwell", "Memory Foam", "White", null, 0, 0, 3, 120, variants: new (string, string, decimal?, decimal?, string?, string?, string?)[]
        {
            ("Queen 6\"", "MAT-ORT-Q6", 11500, 17999, "72 × 60 × 6 in", null, null), ("King 8\"", "MAT-ORT-K8", 15500, 24499, "78 × 72 × 8 in", null, null),
            ("Single 5\"", "MAT-ORT-S5", 6200, 9499, "72 × 36 × 5 in", null, null),
        });
        await Add("Mattress", "MAT-SPR-Q", "Pocket Spring Mattress Queen", "Sleepwell", "Pocket Spring", "White", "78 × 60 × 8 in", 14000, 21999, 2, 60);
        await Add("Chair", "CHR-DIN", "Cushioned Dining Chair", "Royal Oak", "Rubber Wood", "Walnut", null, 2600, 4200, 8, 12, fabric: "Cotton");
        await Add("Chair", "CHR-ACC", "Wingback Accent Chair", "Durian", "Solid Wood", "Mustard", null, 9800, 15500, 2, 24, fabric: "Velvet");
        await Add("Office Furniture", "OFF-ERG", "Ergonomic Mesh Office Chair", "Featherlite", "Mesh + Nylon Base", "Black", null, 7200, 11900, 4, 36);
        await Add("Office Furniture", "OFF-DSK", "Executive Office Desk", "Godrej Interio", "Engineered Wood", "Dark Walnut", "5 × 2.5 ft", 15500, 23800, 1, 36);
        await Add("Office Furniture", "OFF-STD", "Study Table with Bookshelf", "Nilkamal", "Engineered Wood", "White Oak", "4 × 2 ft", 5200, 8499, 2, 12);
        await Add("TV Unit", "TVU-WAL", "Wall Mounted TV Unit", "Royal Oak", "Sheesham Wood", "Honey", "6 ft", 11200, 16900, 2, 24);
        await Add("TV Unit", "TVU-FLR", "Floor Standing TV Cabinet", "Durian", "Engineered Wood", "Wenge", "5.5 ft", 8800, 13500, 2, 24);
        await Add("Chair", "CHR-RCK", "Wooden Rocking Chair", "Royal Oak", "Teak Wood", "Natural", null, 8500, 12999, 1, 24);
        await app.Catalog.AssignMissingBarcodesAsync();
    }

    private async Task PurchasesAsync(DateTime today)
    {
        var suppliers = new List<long>();
        foreach (var (name, contact, mobile, state, gst, bank) in new[]
                 {
                     ("Karnataka Timber Crafts", "Mahesh Rao", "9880012345", "29", "29AAECK1234M1Z", "Canara Bank|0412101012345|CNRB0000412"),
                     ("Jodhpur Handicraft Exports", "Vikram Singh", "9414012345", "08", "08AAFCJ5678K1Z", "SBI|30123456789|SBIN0004321"),
                     ("Sleepwell Distributors South", "Anand Kumar", "9845067890", "29", "29AABCS9012P1Z", "ICICI|123405001234|ICIC0001234"),
                     ("Office Solutions India", "Neha Gupta", "9820012345", "27", "27AAGCO3456L1Z", "Axis|918020012345678|UTIB0000123"),
                 })
        {
            var g = gst + Validators.GstinCheckChar(gst);
            var b = bank.Split('|');
            suppliers.Add(await app.Suppliers.SaveAsync(new Supplier
            {
                Name = name, ContactPerson = contact, Mobile = mobile, Whatsapp = mobile, StateCode = state, Gstin = g, BankName = b[0], BankAccount = b[1], BankIfsc = b[2],
                Address = state switch { "29" => "Peenya Industrial Area, Bengaluru", "08" => "Basni Industrial Area, Jodhpur", _ => "Andheri East, Mumbai" },
            }));
        }

        async Task Buy(int supplier, int daysAgo, decimal paid, params (string Sku, int Qty)[] items)
        {
            var lines = new List<PurchaseLineInput>();
            foreach (var (sku, qty) in items)
            {
                var v = await app.Catalog.GetSellableAsync(_variants[sku]);
                lines.Add(new PurchaseLineInput { VariantId = v!.VariantId, Quantity = qty, UnitCost = v.CostPrice ?? 0, GstRate = 18, HsnCode = v.HsnCode });
            }
            var date = today.AddDays(-daysAgo);
            await app.Purchases.SaveAsync(new PurchaseInput
            {
                SupplierId = suppliers[supplier], SupplierInvoiceNo = $"SB/{date:yyMM}/{_rnd.Next(100, 999)}", Date = date, DueDate = date.AddDays(30),
                Lines = lines, Complete = true, PaidNow = paid, PaidMethod = PaymentMethodCode.Bank, PaidReference = paid > 0 ? $"NEFT{_rnd.Next(100000, 999999)}" : null,
            });
        }

        await Buy(0, 75, 200000, ("WRD-003", 5), ("DIN-SHM-4", 3), ("DIN-SHM-6", 4), ("DIN-SHM-8", 2), ("BED-KNG-K", 4), ("BED-KNG-Q", 4), ("BED-TEAK-Q", 2),
            ("CHR-DIN", 24), ("TVU-WAL", 4), ("CHR-RCK", 2));
        await Buy(1, 70, 150000, ("SOF-CHS-GRN", 3), ("SOF-CHS-BLU", 3), ("SOF-CHS-TAN", 2), ("SOF-LSH", 2), ("CHR-ACC", 4), ("WRD-004", 2), ("DIN-GLS-6", 2));
        await Buy(2, 65, 0, ("MAT-ORT-Q6", 8), ("MAT-ORT-K8", 6), ("MAT-ORT-S5", 6), ("MAT-SPR-Q", 4));
        await Buy(3, 60, 100000, ("OFF-ERG", 10), ("OFF-DSK", 3), ("OFF-STD", 5), ("SOF-REC-1", 4), ("SOF-CMB-2", 3), ("WRD-002", 4), ("BED-SGL", 4), ("TVU-FLR", 3));
        await Buy(0, 20, 0, ("WRD-003", 2), ("CHR-DIN", 8), ("DIN-SHM-6", 1));
        await app.Purchases.PayAsync(new SupplierPaymentInput { SupplierId = suppliers[2], Amount = 150000, Date = today.AddDays(-30), MethodCode = PaymentMethodCode.Bank, Reference = "NEFT552301" });
    }

    private async Task CustomersAsync()
    {
        foreach (var (name, mobile, addr, city, pin, email) in new[]
                 {
                     ("Rahul Mehta", "9876543210", "12, 5th Cross, Indiranagar", "Bengaluru", "560038", "rahul.mehta@gmail.com"),
                     ("Ananya Krishnan", "9886012345", "Flat 402, Prestige Shantiniketan, Whitefield", "Bengaluru", "560048", "ananya.k@yahoo.com"),
                     ("Mohammed Irfan", "9900112233", "45, Richmond Road", "Bengaluru", "560025", null),
                     ("Deepa Nair", "9741234567", "23, HSR Layout Sector 2", "Bengaluru", "560102", "deepa.nair@outlook.com"),
                     ("Venkatesh Prasad", "9845098450", "88, Jayanagar 9th Block", "Bengaluru", "560069", null),
                     ("Sneha Patil", "9632587410", "Villa 17, Adarsh Palm Retreat, Bellandur", "Bengaluru", "560103", "sneha.patil@gmail.com"),
                     ("Karthik Subramanian", "9008123456", "301, Brigade Metropolis, Mahadevapura", "Bengaluru", "560048", null),
                     ("Fatima Sheikh", "9535123456", "7, Frazer Town", "Bengaluru", "560005", null),
                     ("Rohit Agarwal", "9731122334", "B-204, Sobha Dream Acres, Panathur", "Bengaluru", "560087", "rohit.agarwal@gmail.com"),
                     ("Meera Joshi", "9591234567", "14, Malleshwaram 8th Cross", "Bengaluru", "560003", null),
                 })
        {
            _customers.Add(await app.Customers.SaveAsync(new Customer
            {
                Name = name, Mobile = mobile, Whatsapp = mobile, BillingAddress = addr, City = city, StateCode = "29", Pincode = pin, Email = email,
                Addresses = { new CustomerAddress { Label = "Home", Address = addr, City = city, StateCode = "29", Pincode = pin, IsDefault = true } },
            }));
        }
        // A business customer from another state (IGST) with a GSTIN.
        var gst = "33AAACT2727Q1Z";
        _customers.Add(await app.Customers.SaveAsync(new Customer
        {
            Name = "Techverse Solutions Pvt Ltd", Mobile = "9444012345", BillingAddress = "5th Floor, Olympia Tech Park, Guindy", City = "Chennai",
            StateCode = "33", Pincode = "600032", Gstin = gst + Validators.GstinCheckChar(gst), Email = "admin@techverse.in", CreditLimit = 500000,
            Notes = "Corporate account — office furniture",
        }));
    }

    private async Task<SellableItem> Item(string sku) => (await app.Catalog.GetSellableAsync(_variants[sku]))!;

    private async Task<LineInput> Line(string sku, decimal qty = 1, decimal disc = 0)
    {
        var v = await Item(sku);
        return new LineInput { VariantId = v.VariantId, Quantity = qty, UnitPrice = v.SellingPrice, PriceIncludesGst = v.PriceIncludesGst, GstRate = v.GstRate, DiscountPercent = disc };
    }

    private async Task SalesAsync(DateTime today)
    {
        var walkIn = (await app.Customers.WalkInAsync()).Id;
        var skus = new[] { "CHR-DIN", "MAT-ORT-Q6", "MAT-ORT-S5", "OFF-ERG", "OFF-STD", "TVU-FLR", "CHR-ACC", "SOF-CMB-2", "BED-SGL", "MAT-ORT-K8", "TVU-WAL", "SOF-REC-1" };
        var big = new[] { "WRD-003", "DIN-SHM-6", "BED-KNG-K", "SOF-CHS-GRN", "BED-KNG-Q", "WRD-002", "DIN-SHM-4", "MAT-SPR-Q", "SOF-CHS-BLU", "BED-TEAK-Q" };
        var methods = new[] { PaymentMethodCode.Cash, PaymentMethodCode.Upi, PaymentMethodCode.Card, PaymentMethodCode.Upi, PaymentMethodCode.Bank };

        for (var daysAgo = 45; daysAgo >= 0; daysAgo--)
        {
            var date = today.AddDays(-daysAgo);
            var count = daysAgo == 0 ? 3 : _rnd.Next(0, 3);
            for (var k = 0; k < count; k++)
            {
                var named = _rnd.NextDouble() < 0.75;
                var customer = named ? _customers[_rnd.Next(_customers.Count - 1)] : walkIn;
                var lines = new List<LineInput>();
                var sku = _rnd.NextDouble() < 0.45 ? big[_rnd.Next(big.Length)] : skus[_rnd.Next(skus.Length)];
                var stock = (await Item(sku)).Available;
                if (stock < 1) continue;
                lines.Add(await Line(sku, sku == "CHR-DIN" ? Math.Min(4, stock) : 1, _rnd.NextDouble() < 0.3 ? 5 : 0));
                if (_rnd.NextDouble() < 0.35)
                {
                    var extra = skus[_rnd.Next(skus.Length)];
                    if (extra != sku && (await Item(extra)).Available >= 1) lines.Add(await Line(extra));
                }
                var delivery = named && _rnd.NextDouble() < 0.7;
                var input = new SalesDocumentInput
                {
                    CustomerId = customer, Date = date, Lines = lines, DeliveryCharge = delivery ? 500 : 0, RequiresDelivery = delivery,
                    RequiresInstallation = delivery && (sku.StartsWith("WRD") || sku.StartsWith("BED")),
                    InstallationCharge = delivery && (sku.StartsWith("WRD") || sku.StartsWith("BED")) ? 750 : 0,
                };
                // Work out the total first so the payment split matches.
                var draftId = await app.Invoices.SaveDraftAsync(input);
                var total = (await app.Invoices.GetAsync(draftId)).GrandTotal;
                var pays = new List<PaymentLineInput>();
                var roll = _rnd.NextDouble();
                if (!named || roll < 0.6)
                {
                    if (roll < 0.15 && total > 20000)
                    {
                        var cash = Money.ToRupee(total * 0.3m);
                        pays.Add(new() { MethodCode = PaymentMethodCode.Cash, Amount = cash });
                        pays.Add(new() { MethodCode = PaymentMethodCode.Upi, Amount = total - cash, Reference = $"UPI{_rnd.Next(10000000, 99999999)}" });
                    }
                    else pays.Add(new() { MethodCode = methods[_rnd.Next(methods.Length)], Amount = total, Reference = $"TXN{_rnd.Next(100000, 999999)}" });
                }
                else if (roll < 0.9) pays.Add(new() { MethodCode = PaymentMethodCode.Upi, Amount = Money.ToRupee(total * 0.4m), Reference = $"UPI{_rnd.Next(10000000, 99999999)}" });
                // else: full credit sale
                await app.Invoices.FinalizeAsync(draftId, pays);
            }
        }

        // Corporate IGST sale on credit
        var corp = _customers[^1];
        await app.Invoices.CheckoutAsync(new SalesDocumentInput
        {
            CustomerId = corp, Date = today.AddDays(-12), DueDate = today.AddDays(-2), RequiresDelivery = true, DeliveryCharge = 2500,
            Lines = { await Line("OFF-ERG", 4, 8), await Line("OFF-DSK", 1) }, Notes = "PO No. TV/2026/118",
        }, new[] { new PaymentLineInput { MethodCode = PaymentMethodCode.Bank, Amount = 25000, Reference = "NEFT-TV-118" } });

        // Follow-up payments on some outstanding invoices
        var open = await app.Invoices.ListAsync(new ListQuery { PageSize = 20, SortBy = "date", SortDescending = false }, "OUTSTANDING");
        foreach (var inv in open.Items.Where(i => i.CustomerId != walkIn).Take(5))
        {
            var amt = Money.ToRupee(inv.Balance / 2);
            if (amt <= 0) continue;
            await app.Payments.ReceiveAsync(new PaymentInput
            {
                CustomerId = inv.CustomerId, DocType = DocType.Invoice, DocId = inv.Id, Date = Min(inv.InvoiceDate.AddDays(7), today),
                Lines = { new PaymentLineInput { MethodCode = PaymentMethodCode.Upi, Amount = amt, Reference = $"UPI{_rnd.Next(10000000, 99999999)}" } },
            });
        }
    }

    private static DateTime Min(DateTime a, DateTime b) => a < b ? a : b;

    private async Task OrdersAsync(DateTime today)
    {
        // Quotations: one open, one converted into a confirmed order with advance (stock reserved).
        await app.Quotations.SaveAsync(new SalesDocumentInput
        {
            CustomerId = _customers[3], Date = today.AddDays(-3), DeliveryCharge = 800, InstallationCharge = 1500,
            Lines = { await Line("SOF-LSH", 1, 5), await Line("CHR-ACC", 2), await Line("TVU-WAL") }, Notes = "Living room package",
        });
        var q2 = await app.Quotations.SaveAsync(new SalesDocumentInput
        {
            CustomerId = _customers[0], Date = today.AddDays(-9), DeliveryCharge = 1000, InstallationCharge = 1500,
            Lines = { await Line("WRD-004"), await Line("BED-TEAK-Q"), await Line("MAT-ORT-Q6") }, Notes = "Master bedroom",
        });
        await app.Quotations.SetStatusAsync(q2, QuotationStatus.Sent);
        await app.Quotations.SetStatusAsync(q2, QuotationStatus.Confirmed, "Customer confirmed on phone");
        var so1 = await app.Quotations.ConvertToSalesOrderAsync(q2, today.AddDays(5));
        var so1Total = (await app.SalesOrders.GetAsync(so1)).GrandTotal;
        await app.Payments.ReceiveAsync(new PaymentInput
        {
            CustomerId = _customers[0], DocType = DocType.SalesOrder, DocId = so1, Date = today.AddDays(-8),
            Lines = { new PaymentLineInput { MethodCode = PaymentMethodCode.Upi, Amount = Money.ToRupee(so1Total * 0.3m), Reference = "UPI48213377" } },
        });

        // A direct sales order ready to invoice, with advance paid in cash + card.
        var so2 = await app.SalesOrders.SaveAsync(new SalesDocumentInput
        {
            CustomerId = _customers[5], Date = today.AddDays(-6), ExpectedDeliveryDate = today.AddDays(1), RequiresDelivery = true, DeliveryCharge = 500,
            Lines = { await Line("DIN-SHM-8"), await Line("CHR-DIN", 4) },
        });
        await app.SalesOrders.ConfirmAsync(so2);
        await app.Payments.ReceiveAsync(new PaymentInput
        {
            CustomerId = _customers[5], DocType = DocType.SalesOrder, DocId = so2, Date = today.AddDays(-6),
            Lines = { new PaymentLineInput { MethodCode = PaymentMethodCode.Cash, Amount = 10000 }, new PaymentLineInput { MethodCode = PaymentMethodCode.Card, Amount = 15000, Reference = "CARD-4412" } },
        });
        await app.SalesOrders.ChangeStatusAsync(so2, SalesOrderStatus.Processing);
        await app.SalesOrders.ChangeStatusAsync(so2, SalesOrderStatus.Ready, "Polished and packed");
        await app.SalesOrders.ConvertToInvoiceAsync(so2, new[] { new PaymentLineInput { MethodCode = PaymentMethodCode.Upi, Amount = 10000, Reference = "UPI99812245" } });
        await app.Deliveries.CreateForSalesOrderAsync(so2, today.AddDays(1));
    }

    private async Task CustomOrdersAsync(DateTime today)
    {
        async Task<long> Create(int customer, string type, string design, decimal w, decimal h, decimal d, string material, string finish, int? doors, int? drawers,
            decimal estimate, decimal final, decimal production, int daysAgo, int dueIn, bool install, decimal advance)
        {
            var id = await app.CustomOrders.SaveAsync(new CustomOrder
            {
                CustomerId = _customers[customer], OrderDate = today.AddDays(-daysAgo), ProductType = type, Design = design, Width = w, Height = h, Depth = d,
                Material = material, Finish = finish, Color = finish, Doors = doors, Drawers = drawers, EstimatedCost = estimate, FinalPrice = final,
                ProductionCost = production, GstRate = 18, HsnCode = "940360", ExpectedCompletionDate = today.AddDays(dueIn), RequiresInstallation = install,
                SpecialRequirements = "Soft-close hinges, loft above main unit", Notes = "Site measurement done by Suresh",
            });
            if (advance > 0)
                await app.Payments.ReceiveAsync(new PaymentInput
                {
                    CustomerId = _customers[customer], DocType = DocType.CustomOrder, DocId = id, Date = today.AddDays(-daysAgo),
                    Lines = { new PaymentLineInput { MethodCode = PaymentMethodCode.Bank, Amount = advance, Reference = $"IMPS{_rnd.Next(100000, 999999)}" } },
                });
            return id;
        }

        await Create(6, "Wardrobe", "Sliding door with mirror panel", 8, 7, 2, "Teak", "Walnut", 4, 2, 85000, 0, 0, 4, 20, true, 25000);
        var c2 = await Create(1, "Modular Kitchen Cabinets", "L-shaped, handle-less", 10, 3, 2, "BWP Plywood", "Acrylic White", 8, 6, 145000, 142000, 98000, 30, 3, true, 50000);
        await app.CustomOrders.AdvanceAsync(c2, "Design approved by customer"); // design
        await app.CustomOrders.AdvanceAsync(c2); // production
        await app.CustomOrders.AdvanceAsync(c2, "Assembly done"); // quality check
        var c3 = await Create(9, "Pooja Mandir", "Carved teak with bells", 3, 5, 1.5m, "Teak", "Natural Polish", 2, 1, 38000, 36500, 24000, 25, -2, false, 15000);
        await app.CustomOrders.AdvanceAsync(c3);
        await app.CustomOrders.AdvanceAsync(c3);
        await app.CustomOrders.AdvanceAsync(c3);
        await app.CustomOrders.AdvanceAsync(c3, "QC passed"); // ready
        await app.CustomOrders.GenerateInvoiceAsync(c3, Array.Empty<PaymentLineInput>());
        await app.Deliveries.CreateForCustomOrderAsync(c3, today);
        var c4 = await Create(4, "Study Table", "Wall-mounted foldable", 4, 2.5m, 1.5m, "Sheesham", "Honey", 0, 3, 18000, 0, 0, 1, 25, false, 5000);
        await app.CustomOrders.AdvanceAsync(c4, "Sketch shared on WhatsApp"); // design
    }

    private async Task DeliveriesAsync(DateTime today)
    {
        var pending = await app.Deliveries.ListAsync(new ListQuery { Status = DeliveryStatus.Pending, PageSize = 100 });
        var drivers = new[] { ("Ramesh Gowda", "KA-01-AB-4521"), ("Manjunath", "KA-05-MN-7788") };
        var i = 0;
        foreach (var d in pending.Items.OrderBy(x => x.CreatedAt))
        {
            var (driver, vehicle) = drivers[i % 2];
            var created = d.CreatedAt.Date;
            var old = created < today.AddDays(-3);
            if (i % 5 == 4) { i++; continue; } // leave a few pending
            var otp = await app.Deliveries.ScheduleAsync(d.Id, old ? today : today.AddDays(i % 3), "10 AM - 1 PM", driver, null, vehicle, 350);
            if (old || i % 4 == 0)
            {
                await app.Deliveries.DispatchAsync(d.Id);
                if (old)
                    await app.Deliveries.CompleteAsync(new DeliveryCompletion
                    {
                        DeliveryId = d.Id, ReceiverName = d.CustomerName ?? "Customer", Otp = i % 2 == 0 ? otp : null,
                        Remarks = i % 2 == 0 ? null : "Delivered and unpacked, customer satisfied",
                    });
            }
            i++;
        }
        var installs = await app.Installations.ListAsync(new ListQuery { Status = InstallationStatus.Pending, PageSize = 100 });
        var j = 0;
        foreach (var inst in installs.Items)
        {
            if (j % 3 == 2) { j++; continue; }
            await app.Installations.ScheduleAsync(inst.Id, today.AddDays(j % 2), "Shivu (Carpenter)", null, 400);
            if (j % 3 == 0) await app.Installations.CompleteAsync(inst.Id, "Installed and levelled");
            j++;
        }
    }

    private async Task ReturnsAsync(DateTime today)
    {
        // A defective mattress returned (damaged stock) and refunded; a chair exchanged for a costlier sofa.
        var invs = await app.Invoices.ListAsync(new ListQuery { PageSize = 200, SortBy = "date", SortDescending = false });
        foreach (var li in invs.Items.Where(x => x.Status == InvoiceStatus.Final && x.Balance <= 0))
        {
            var inv = await app.Invoices.GetAsync(li.Id);
            var mat = inv.Lines.FirstOrDefault(l => l.Sku?.StartsWith("MAT-") == true);
            if (mat is null) continue;
            await app.Returns.CreateAsync(new ReturnInput
            {
                InvoiceId = inv.Id, Date = Min(inv.Date.AddDays(4), today), Reason = ReturnReason.ManufacturingDefect,
                Lines = { new ReturnLineInput { InvoiceItemId = mat.Id, Quantity = 1, Condition = ItemCondition.Defective } },
                RefundAmount = Money.R2(mat.LineTotal / mat.Quantity), RefundMethod = PaymentMethodCode.Upi, Notes = "Sagging within 2 weeks — sent back to Sleepwell",
            });
            break;
        }
        foreach (var li in invs.Items.Where(x => x.Status == InvoiceStatus.Final && x.Balance <= 0).Reverse())
        {
            var inv = await app.Invoices.GetAsync(li.Id);
            if (inv.ReturnedAmount > 0) continue;
            var cust = await app.Customers.GetAsync(inv.CustomerId);
            if (cust.IsWalkIn) continue;
            var line = inv.Lines.FirstOrDefault(l => l.Sku == "CHR-ACC" || l.Sku == "SOF-CMB-2" || l.Sku == "SOF-REC-1");
            if (line is null) continue;
            var target = await Item("SOF-CHS-TAN");
            if (target.Available < 1) break;
            await app.Returns.ExchangeAsync(new ExchangeInput
            {
                OriginalInvoiceId = inv.Id, Notes = "Customer preferred a larger sofa",
                ReturnLines = { new ReturnLineInput { InvoiceItemId = line.Id, Quantity = 1, Condition = ItemCondition.Good } },
                NewInvoice = new SalesDocumentInput { Date = today.AddDays(-1), Lines = { await Line("SOF-CHS-TAN") }, RequiresDelivery = true, DeliveryCharge = 500 },
                Payments = { new PaymentLineInput { MethodCode = PaymentMethodCode.Card, Amount = 1, Reference = "placeholder" } },
            }.WithDifferencePaid(await DifferenceAsync(inv.Id, line.Id)));
            break;
        }
    }

    private async Task<decimal> DifferenceAsync(long invoiceId, long itemId)
    {
        var sofa = await Item("SOF-CHS-TAN");
        var s = await app.Settings.GetAsync();
        var newTotal = Core.Tax.GstCalculator.ComputeDocument(
            new[] { new Core.Tax.TaxLineInput(1, sofa.SellingPrice, true, 18) }, false,
            new Core.Tax.DocumentChargesInput(500, 0, s.Tax.ChargesGstRate), s.Invoice.RoundOff).GrandTotal;
        var preview = await app.Returns.PreviewExchangeAsync(new ExchangeInput
        {
            OriginalInvoiceId = invoiceId, ReturnLines = { new ReturnLineInput { InvoiceItemId = itemId, Quantity = 1 } },
        }, newTotal);
        return preview.Difference;
    }

    private async Task ExpensesAsync(DateTime today)
    {
        var cats = (await app.Expenses.CategoriesAsync()).ToDictionary(c => c.Name, c => c.Id);
        for (var m = 2; m >= 0; m--)
        {
            var month = new DateTime(today.Year, today.Month, 1).AddMonths(-m);
            void Clamp(ref DateTime d) { if (d > today) d = today; }
            var rent = month.AddDays(4); Clamp(ref rent);
            var elec = month.AddDays(9); Clamp(ref elec);
            var sal = month.AddDays(0); Clamp(ref sal);
            await app.Expenses.SaveAsync(new Expense { CategoryId = cats["Rent"], ExpenseDate = rent, Amount = 85000, MethodCode = PaymentMethodCode.Bank, Description = "Showroom rent", Reference = "NEFT" });
            await app.Expenses.SaveAsync(new Expense { CategoryId = cats["Electricity"], ExpenseDate = elec, Amount = 9000 + _rnd.Next(0, 3000), MethodCode = PaymentMethodCode.Upi, Description = "BESCOM bill" });
            await app.Expenses.SaveAsync(new Expense { CategoryId = cats["Salary"], ExpenseDate = sal, Amount = 145000, MethodCode = PaymentMethodCode.Bank, Description = "Staff salaries" });
            var ad = month.AddDays(14); Clamp(ref ad);
            await app.Expenses.SaveAsync(new Expense { CategoryId = cats["Advertising"], ExpenseDate = ad, Amount = 12000, MethodCode = PaymentMethodCode.Card, Description = "Instagram & Google ads" });
        }
        await app.Expenses.SaveAsync(new Expense { CategoryId = cats["Packaging"], ExpenseDate = today.AddDays(-2), Amount = 3500, MethodCode = PaymentMethodCode.Cash, Description = "Bubble wrap and cartons" });
    }
}

internal static class ExchangeInputExtensions
{
    /// <summary>Sets the exchange payment to the exact difference (or none).</summary>
    public static ExchangeInput WithDifferencePaid(this ExchangeInput input, decimal difference)
    {
        input.Payments.Clear();
        if (difference > 0) input.Payments.Add(new PaymentLineInput { MethodCode = PaymentMethodCode.Card, Amount = difference, Reference = "CARD-EXCH" });
        return input;
    }
}
