using Dapper;
using FurniShop.Core.Domain;
using FurniShop.Infrastructure;
using Npgsql;
using Xunit;

namespace FurniShop.Tests;

/// <summary>
/// Creates a throw-away PostgreSQL database per test class, applies the migrations and signs in as admin.
/// Set FURNISHOP_TEST_DB to a server connection string (any database); tests are skipped when it is unreachable.
/// </summary>
public sealed class DbFixture : IAsyncLifetime
{
    public const string AdminPassword = "Admin@2026";
    public static readonly string ServerConnection =
        Environment.GetEnvironmentVariable("FURNISHOP_TEST_DB") ?? "Host=127.0.0.1;Port=5433;Username=postgres;Database=postgres;Timeout=5";

    private string? _dbName;
    public AppServices App { get; private set; } = null!;
    public string ConnectionString { get; private set; } = "";

    public async Task InitializeAsync()
    {
        if (!DbFactAttribute.Available) return;
        _dbName = "fs_test_" + Guid.NewGuid().ToString("N")[..12];
        await using (var c = new NpgsqlConnection(ServerConnection))
        {
            await c.OpenAsync();
            await c.ExecuteAsync($"create database {_dbName}");
        }
        ConnectionString = new NpgsqlConnectionStringBuilder(ServerConnection) { Database = _dbName }.ConnectionString;
        App = new AppServices(ConnectionString);
        await App.Migrator.MigrateAsync();
        await App.Auth.CreateInitialAdminAsync("admin", "Shop Owner", AdminPassword);
        var r = await App.Auth.LoginAsync("admin", AdminPassword);
        Assert.Equal(Infrastructure.Services.LoginOutcome.Success, r.Outcome);
    }

    public async Task DisposeAsync()
    {
        if (_dbName is null) return;
        await App.DisposeAsync();
        NpgsqlConnection.ClearAllPools();
        await using var c = new NpgsqlConnection(ServerConnection);
        await c.OpenAsync();
        await c.ExecuteAsync($"drop database if exists {_dbName} with (force)");
    }

    // ---------------------------------------------------------------- helpers
    public async Task<long> CategoryAsync(string name = "Sofa") =>
        await App.Db.ScalarAsync<long?>("select id from categories where name = @name", new { name })
        ?? await App.Catalog.SaveCategoryAsync(new Category { Name = name, DefaultHsn = "9401", DefaultGstRate = 18 });

    /// <summary>Creates a product with one variant and opening stock; returns the variant id.</summary>
    public async Task<long> ProductAsync(string code, decimal price, decimal cost, decimal stock, decimal discount = 0, bool stockItem = true)
    {
        var cat = await CategoryAsync();
        var p = new Product
        {
            Code = code, Name = "Product " + code, CategoryId = cat, SellingPrice = price, CostPrice = cost, GstRate = 18, PriceIncludesGst = true,
            HsnCode = "9401", DiscountPercent = discount, IsStockItem = stockItem, MinStock = 1,
            Variants = { new ProductVariant { VariantName = "Standard", Sku = code, OpeningStock = stock, IsDefault = true } },
        };
        var id = await App.Catalog.SaveProductAsync(p);
        return (await App.Catalog.GetProductAsync(id)).Variants[0].Id;
    }

    public async Task<long> CustomerAsync(string name, string mobile, string state = "29") =>
        await App.Customers.SaveAsync(new Customer { Name = name, Mobile = mobile, StateCode = state, BillingAddress = "1 MG Road", City = "Bengaluru", Pincode = "560001" });

    public async Task<LineInput> LineAsync(long variantId, decimal qty = 1, decimal discount = 0)
    {
        var v = (await App.Catalog.GetSellableAsync(variantId))!;
        return new LineInput { VariantId = variantId, Quantity = qty, UnitPrice = v.SellingPrice, PriceIncludesGst = true, GstRate = v.GstRate, DiscountPercent = discount };
    }

    public static PaymentLineInput Pay(string method, decimal amount, string? reference = null) => new() { MethodCode = method, Amount = amount, Reference = reference };
}

/// <summary>A fact that is skipped when no PostgreSQL server is reachable.</summary>
public sealed class DbFactAttribute : FactAttribute
{
    public static readonly bool Available = Probe();

    public DbFactAttribute()
    {
        if (!Available) Skip = "PostgreSQL not reachable (set FURNISHOP_TEST_DB)";
    }

    private static bool Probe()
    {
        try
        {
            using var c = new NpgsqlConnection(DbFixture.ServerConnection);
            c.Open();
            return true;
        }
        catch { return false; }
    }
}
