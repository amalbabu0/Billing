using FurniShop.Core;
using FurniShop.Core.Domain;
using FurniShop.Core.Messaging;
using FurniShop.Core.Tax;
using FurniShop.Core.Validation;
using FurniShop.Infrastructure.Security;
using FurniShop.Infrastructure.Services;
using Xunit;

namespace FurniShop.Tests;

public class GstCalculatorTests
{
    [Fact]
    public void Inclusive_price_splits_into_taxable_and_equal_cgst_sgst()
    {
        // ₹45,000 wardrobe, price includes 18% GST
        var r = GstCalculator.ComputeLine(new TaxLineInput(1, 45000, true, 18), interState: false);
        Assert.Equal(38135.59m, r.Taxable);
        Assert.Equal(6864.41m, r.Cgst + r.Sgst);
        Assert.Equal(3432.21m, r.Cgst);
        Assert.Equal(3432.20m, r.Sgst);
        Assert.Equal(45000m, r.Total);
    }

    [Fact]
    public void Exclusive_price_adds_igst_for_inter_state()
    {
        var r = GstCalculator.ComputeLine(new TaxLineInput(2, 10000, false, 18, DiscountPercent: 10), interState: true);
        Assert.Equal(18000m, r.Taxable);
        Assert.Equal(0m, r.Cgst);
        Assert.Equal(3240m, r.Igst);
        Assert.Equal(21240m, r.Total);
        Assert.Equal(2000m, r.Discount);
    }

    [Fact]
    public void Document_totals_add_up_with_charges_and_round_off()
    {
        var t = GstCalculator.ComputeDocument(new[]
        {
            new TaxLineInput(1, 28000, true, 18, 5),
            new TaxLineInput(4, 4200, true, 18),
        }, false, new DocumentChargesInput(500, 750, 18), roundOff: true);
        Assert.Equal(t.Subtotal - t.DiscountTotal, t.ItemsTaxable);
        Assert.Equal(t.ItemsTaxable + 1250, t.TaxableTotal);
        Assert.Equal(Money.ToRupee(t.TaxableTotal + t.TaxTotal), t.GrandTotal);
        Assert.Equal(t.GrandTotal, t.TaxableTotal + t.TaxTotal + t.RoundOff);
        Assert.True(Math.Abs(t.RoundOff) <= 0.5m);
        Assert.Equal(225m, t.ChargesTax);
    }

    [Fact]
    public void Discount_cannot_exceed_line() =>
        Assert.Throws<ArgumentOutOfRangeException>(() => GstCalculator.ComputeLine(new TaxLineInput(1, 1000, true, 18, 50, 600), false));

    [Theory]
    [InlineData("29", "29", false)]
    [InlineData("29", "33", true)]
    [InlineData("29", null, false)]
    public void Inter_state_detection(string shop, string? pos, bool expected) => Assert.Equal(expected, GstCalculator.IsInterState(shop, pos));
}

public class MoneyTests
{
    [Fact]
    public void Indian_grouping() => Assert.Equal("₹1,25,000.50", Money.Format(125000.5m));

    [Fact]
    public void Amount_in_words_uses_lakh_and_crore()
    {
        Assert.Equal("Rupees One Lakh Twenty Five Thousand and Fifty Paise Only", Money.InWords(125000.50m));
        Assert.Equal("Rupees Two Crore Three Lakh Four Hundred Five Only", Money.InWords(20300405m));
        Assert.Equal("Rupees Seventy Five Thousand Only", Money.InWords(75000));
    }

    [Fact]
    public void Compact_format() => Assert.Equal("₹1.5 L", Money.Compact(150000));
}

public class ValidatorTests
{
    [Fact]
    public void Gstin_checksum()
    {
        var first14 = "27AAPFU0939F1Z";
        var full = first14 + Validators.GstinCheckChar(first14);
        Assert.True(Validators.IsValidGstin(full));
        Assert.Equal("27AAPFU0939F1ZV", full); // published sample GSTIN
        Assert.False(Validators.IsValidGstin("27AAPFU0939F1ZA"));
        Assert.False(Validators.IsValidGstin("99AAPFU0939F1ZV"));
    }

    [Theory]
    [InlineData("+91 98765 43210", "9876543210")]
    [InlineData("09876543210", "9876543210")]
    [InlineData("12345", null)]
    [InlineData("5876543210", null)]
    public void Mobile_normalisation(string input, string? expected) => Assert.Equal(expected, Validators.NormaliseMobile(input));

    [Fact]
    public void Ean13_internal_codes_are_valid()
    {
        var code = Ean13.Internal(1234);
        Assert.Equal(13, code.Length);
        Assert.True(Ean13.IsValid(code));
    }
}

public class SecurityTests
{
    [Fact]
    public void Password_hash_roundtrip()
    {
        var h = PasswordHasher.Hash("Secret123");
        Assert.True(PasswordHasher.Verify("Secret123", h));
        Assert.False(PasswordHasher.Verify("secret123", h));
        Assert.NotEqual(h, PasswordHasher.Hash("Secret123")); // salted
    }

    [Fact]
    public void Password_policy()
    {
        Assert.NotNull(PasswordHasher.CheckPolicy("short1", 8));
        Assert.NotNull(PasswordHasher.CheckPolicy("onlyletters", 8));
        Assert.Null(PasswordHasher.CheckPolicy("Furniture2026", 8));
    }
}

public class TemplateTests
{
    [Fact]
    public void Renders_whatsapp_template_and_link()
    {
        var msg = MessageTemplates.Render("Hello {customer},\nYour invoice {number} for {total}", new Dictionary<string, string?>
        {
            ["customer"] = "Rahul", ["number"] = "INV-1024", ["total"] = "₹85,000.00",
        });
        Assert.Equal("Hello Rahul,\nYour invoice INV-1024 for ₹85,000.00", msg);
        var link = MessageTemplates.WhatsAppLink("98765 43210", msg);
        Assert.StartsWith("https://wa.me/919876543210?text=Hello%20Rahul", link);
        Assert.Throws<BusinessRuleException>(() => MessageTemplates.WhatsAppLink("123", msg));
    }

    [Fact]
    public void Payment_state()
    {
        var today = new DateTime(2026, 9, 25);
        Assert.Equal(PaymentState.Paid, PaymentState.Of(100, 100, null, today));
        Assert.Equal(PaymentState.Partial, PaymentState.Of(100, 40, today.AddDays(3), today));
        Assert.Equal(PaymentState.Overdue, PaymentState.Of(100, 40, today.AddDays(-1), today));
        Assert.Equal(PaymentState.Unpaid, PaymentState.Of(100, 0, null, today));
    }

    [Fact]
    public void Custom_order_workflow_skips_installation_when_not_needed()
    {
        Assert.Equal(CustomOrderStatus.Completed, CustomOrderStatus.Next(CustomOrderStatus.Delivery, requiresInstallation: false));
        Assert.Equal(CustomOrderStatus.Installation, CustomOrderStatus.Next(CustomOrderStatus.Delivery, requiresInstallation: true));
        Assert.Equal(CustomOrderStatus.Production, CustomOrderStatus.Next(CustomOrderStatus.Received, false));
    }
}
