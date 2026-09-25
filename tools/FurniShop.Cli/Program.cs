using FurniShop.Infrastructure;
using FurniShop.Infrastructure.Database;

// Administration tool for setting up a FurniShop database (e.g. a new Neon project) without the desktop app.
//   furnishop-cli migrate      --db "<connection string>"
//   furnishop-cli create-admin --db "..." --user admin --name "Owner" --password "..."
//   furnishop-cli seed-demo    --db "..." --user admin --password "..."
//   furnishop-cli sample-pdfs  --db "..." --user admin --password "..." --out ./samples
var cmd = args.FirstOrDefault() ?? "help";
string? Opt(string name) { var i = Array.IndexOf(args, "--" + name); return i >= 0 && i + 1 < args.Length ? args[i + 1] : null; }
var cs = Opt("db") ?? Environment.GetEnvironmentVariable("FURNISHOP_DB");
if (cmd is "help" or "--help" || cs is null)
{
    Console.WriteLine("""
        FurniShop CLI
          migrate       --db <conn>                                   apply database migrations
          create-admin  --db <conn> --user <u> --name <n> --password <p>
          seed-demo     --db <conn> --user <admin> --password <p>      load demo data into an empty database
          sample-pdfs   --db <conn> --user <u> --password <p> --out <dir>
        The connection string can also be supplied in the FURNISHOP_DB environment variable.
        Neon example: Host=ep-xxx-pooler.ap-south-1.aws.neon.tech;Database=neondb;Username=neondb_owner;Password=...;SSL Mode=Require
        """);
    return cmd is "help" or "--help" ? 0 : 1;
}

await using var app = new AppServices(cs);
try
{
    switch (cmd)
    {
        case "migrate":
            var applied = await app.Migrator.MigrateAsync();
            Console.WriteLine(applied.Count == 0 ? "Database is up to date." : "Applied: " + string.Join(", ", applied));
            break;
        case "create-admin":
            await app.Migrator.MigrateAsync();
            await app.Auth.CreateInitialAdminAsync(Opt("user") ?? "admin", Opt("name") ?? "Owner", Opt("password") ?? throw new ArgumentException("--password is required"));
            Console.WriteLine("Administrator created.");
            break;
        case "seed-demo":
        case "sample-pdfs":
            var login = await app.Auth.LoginAsync(Opt("user") ?? "admin", Opt("password") ?? "");
            if (login.Outcome != FurniShop.Infrastructure.Services.LoginOutcome.Success) { Console.Error.WriteLine(login.Message); return 2; }
            if (cmd == "seed-demo")
            {
                await new DemoDataSeeder(app).SeedAsync(new Progress<string>(Console.WriteLine));
                Console.WriteLine($"Demo users: manager / sales1 / sales2 / delivery1 / accounts — password {DemoDataSeeder.DemoPassword}");
            }
            else
            {
                var dir = Opt("out") ?? "samples";
                Directory.CreateDirectory(dir);
                var inv = await app.Db.ScalarAsync<long>("select id from invoices where status = 'FINAL' order by array_length(regexp_split_to_array(coalesce(number,''), ''), 1), grand_total desc limit 1");
                var corp = await app.Db.ScalarAsync<long>("select i.id from invoices i join customers c on c.id = i.customer_id where c.gstin is not null and i.status = 'FINAL' limit 1");
                await File.WriteAllBytesAsync(Path.Combine(dir, "invoice-a4.pdf"), await app.Documents.InvoicePdfAsync(inv));
                if (corp > 0) await File.WriteAllBytesAsync(Path.Combine(dir, "invoice-igst.pdf"), await app.Documents.InvoicePdfAsync(corp));
                await File.WriteAllBytesAsync(Path.Combine(dir, "invoice-thermal.pdf"), await app.Documents.InvoicePdfAsync(inv, true));
                await File.WriteAllBytesAsync(Path.Combine(dir, "quotation.pdf"), await app.Documents.QuotationPdfAsync(await app.Db.ScalarAsync<long>("select min(id) from quotations")));
                await File.WriteAllBytesAsync(Path.Combine(dir, "order.pdf"), await app.Documents.SalesOrderPdfAsync(await app.Db.ScalarAsync<long>("select min(id) from sales_orders")));
                await File.WriteAllBytesAsync(Path.Combine(dir, "receipt.pdf"), await app.Documents.ReceiptPdfAsync(await app.Db.ScalarAsync<long>("select max(id) from payments where direction = 'IN'")));
                var labels = await app.Documents.LabelItemsAsync((await app.Db.QueryAsync<long>("select id from product_variants order by id limit 6")).Select(id => (id, 2)));
                await File.WriteAllBytesAsync(Path.Combine(dir, "labels.pdf"), FurniShop.Infrastructure.Documents.DocumentService.LabelsPdf(labels, FurniShop.Infrastructure.Documents.LabelFormat.A4Sheet3x8, false));
                var r = await app.Reports.RunAsync("gst.rate", new FurniShop.Infrastructure.Services.ReportFilter { From = DateTime.Today.AddDays(-90) });
                await File.WriteAllBytesAsync(Path.Combine(dir, "gst-report.pdf"), await app.Documents.ToPdfAsync(r.Table, r.Definition.Title, r.Subtitle, r.MoneyColumns, r.Totals));
                Console.WriteLine($"Written to {Path.GetFullPath(dir)}");
            }
            break;
        default:
            Console.Error.WriteLine($"Unknown command {cmd}");
            return 1;
    }
    return 0;
}
catch (Exception ex)
{
    Console.Error.WriteLine(ex.Message);
    return 1;
}
