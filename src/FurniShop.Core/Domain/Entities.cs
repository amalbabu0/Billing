namespace FurniShop.Core.Domain;

// POCOs mapped by Dapper (snake_case columns → PascalCase properties).

public sealed class Role
{
    public long Id { get; set; }
    public string Code { get; set; } = "";
    public string Name { get; set; } = "";
    public string? Description { get; set; }
    public bool IsSystem { get; set; }
    public int UserCount { get; set; }
}

public sealed class PermissionInfo
{
    public string Code { get; set; } = "";
    public string Module { get; set; } = "";
    public string Description { get; set; } = "";
}

public sealed class User
{
    public long Id { get; set; }
    public string Username { get; set; } = "";
    public string FullName { get; set; } = "";
    public string? Mobile { get; set; }
    public string? Email { get; set; }
    public long RoleId { get; set; }
    public string? RoleName { get; set; }
    public string? RoleCode { get; set; }
    public bool MustChangePassword { get; set; }
    public bool IsActive { get; set; } = true;
    public int FailedLoginCount { get; set; }
    public DateTime? LockedUntil { get; set; }
    public DateTime? LastLoginAt { get; set; }
    public DateTime CreatedAt { get; set; }
    /// <summary>Sales commission as a percentage of the taxable value of invoices credited to this user.</summary>
    public decimal CommissionPercent { get; set; }
}

public sealed class Category
{
    public long Id { get; set; }
    public string Name { get; set; } = "";
    public long? ParentId { get; set; }
    public string? Description { get; set; }
    public string? DefaultHsn { get; set; }
    public decimal? DefaultGstRate { get; set; }
    public bool IsActive { get; set; } = true;
    public int ProductCount { get; set; }
    public override string ToString() => Name;
}

public sealed class Brand
{
    public long Id { get; set; }
    public string Name { get; set; } = "";
    public bool IsActive { get; set; } = true;
    public override string ToString() => Name;
}

public sealed class GstRate
{
    public long Id { get; set; }
    public string Name { get; set; } = "";
    public decimal Rate { get; set; }
    public bool IsActive { get; set; } = true;
    public bool IsDefault { get; set; }
    public override string ToString() => $"{Rate:0.##}%";
}

public sealed class HsnCode
{
    public string Code { get; set; } = "";
    public string Description { get; set; } = "";
    public decimal DefaultGstRate { get; set; }
    public bool IsActive { get; set; } = true;
    public override string ToString() => $"{Code} — {Description}";
}

public sealed class PaymentMethod
{
    public string Code { get; set; } = "";
    public string Name { get; set; } = "";
    public bool IsActive { get; set; } = true;
    public int SortOrder { get; set; }
    public bool IsMoney { get; set; } = true;
    public bool IsSystem { get; set; }
    public override string ToString() => Name;
}

public sealed class DocumentSequence
{
    public string DocType { get; set; } = "";
    public string Prefix { get; set; } = "";
    public bool IncludeYear { get; set; }
    public int Padding { get; set; } = 4;
    public long NextNumber { get; set; } = 1;
    public int? CurrentYear { get; set; }
}

public sealed class Product
{
    public long Id { get; set; }
    public string Code { get; set; } = "";
    public string Name { get; set; } = "";
    public long CategoryId { get; set; }
    public string? CategoryName { get; set; }
    public long? BrandId { get; set; }
    public string? BrandName { get; set; }
    public string? Material { get; set; }
    public string? Color { get; set; }
    public string? Size { get; set; }
    public string? Dimensions { get; set; }
    public decimal? WeightKg { get; set; }
    public string? Finish { get; set; }
    public string? Fabric { get; set; }
    public int WarrantyMonths { get; set; }
    public string? WarrantyTerms { get; set; }
    public string? HsnCode { get; set; }
    public decimal GstRate { get; set; } = 18;
    public bool PriceIncludesGst { get; set; } = true;
    /// <summary>Null when the current user may not see cost prices.</summary>
    public decimal? CostPrice { get; set; }
    public decimal SellingPrice { get; set; }
    public decimal DiscountPercent { get; set; }
    public decimal MinStock { get; set; }
    public string? Description { get; set; }
    public string Status { get; set; } = "ACTIVE";
    public bool IsStockItem { get; set; } = true;
    public long? ImageAttachmentId { get; set; }
    public DateTime CreatedAt { get; set; }
    public DateTime UpdatedAt { get; set; }
    // aggregates (list views)
    public int VariantCount { get; set; }
    public decimal OnHand { get; set; }
    public decimal Reserved { get; set; }
    public decimal Available { get; set; }
    public string? Barcode { get; set; }
    public List<ProductVariant> Variants { get; set; } = new();
}

public sealed class ProductVariant
{
    public long Id { get; set; }
    public long ProductId { get; set; }
    public string VariantName { get; set; } = "Standard";
    public string Sku { get; set; } = "";
    public string? Barcode { get; set; }
    public string? Size { get; set; }
    public string? Color { get; set; }
    public string? Material { get; set; }
    public string? Fabric { get; set; }
    public string? Finish { get; set; }
    public string? Configuration { get; set; }
    public string? Design { get; set; }
    public string? Dimensions { get; set; }
    public decimal? CostPrice { get; set; }
    public decimal? SellingPrice { get; set; }
    public decimal? MinStock { get; set; }
    public long? ImageAttachmentId { get; set; }
    public bool IsDefault { get; set; }
    public bool IsActive { get; set; } = true;
    /// <summary>FIXED (price per piece) or measured pricing: PER_UNIT, PER_SQFT, PER_RFT, PER_SQM, PER_KG, CUSTOM.</summary>
    public string PricingMode { get; set; } = "FIXED";
    public decimal? PricingRate { get; set; }
    // joined / computed
    public decimal OnHand { get; set; }
    public decimal Reserved { get; set; }
    public decimal Damaged { get; set; }
    public decimal Available => OnHand - Reserved;
    /// <summary>Opening stock, used only when creating a variant.</summary>
    public decimal OpeningStock { get; set; }
}

/// <summary>A sellable item (variant + product data) as shown in POS search and pickers.</summary>
public sealed class SellableItem
{
    public long VariantId { get; set; }
    public long ProductId { get; set; }
    public string ProductName { get; set; } = "";
    public string VariantName { get; set; } = "";
    public string Sku { get; set; } = "";
    public string? Barcode { get; set; }
    public string? CategoryName { get; set; }
    public long CategoryId { get; set; }
    public string? HsnCode { get; set; }
    public decimal GstRate { get; set; }
    public bool PriceIncludesGst { get; set; }
    public decimal SellingPrice { get; set; }
    public decimal? CostPrice { get; set; }
    public decimal DiscountPercent { get; set; }
    public decimal OnHand { get; set; }
    public decimal Reserved { get; set; }
    public decimal Available { get; set; }
    public bool IsStockItem { get; set; }
    public string? Material { get; set; }
    public string? Color { get; set; }
    public string? Dimensions { get; set; }
    public long? ImageAttachmentId { get; set; }
    public string PricingMode { get; set; } = "FIXED";
    public decimal? PricingRate { get; set; }
    public string DisplayName => string.IsNullOrWhiteSpace(VariantName) || VariantName == "Standard" ? ProductName : $"{ProductName} — {VariantName}";
    public string StockState => !IsStockItem ? "MADE_TO_ORDER" : Available <= 0 ? "OUT_OF_STOCK" : "IN_STOCK";
}

public sealed class InventoryRow
{
    public long VariantId { get; set; }
    public long ProductId { get; set; }
    public string Sku { get; set; } = "";
    public string? Barcode { get; set; }
    public string VariantName { get; set; } = "";
    public string ProductName { get; set; } = "";
    public string ProductCode { get; set; } = "";
    public long CategoryId { get; set; }
    public string CategoryName { get; set; } = "";
    public decimal OnHand { get; set; }
    public decimal Reserved { get; set; }
    public decimal Damaged { get; set; }
    public decimal DisplayQty { get; set; }
    public decimal Available { get; set; }
    public decimal MinStock { get; set; }
    public decimal? CostPrice { get; set; }
    public decimal SellingPrice { get; set; }
    public bool IsStockItem { get; set; }
    public decimal? StockValue => CostPrice.HasValue ? CostPrice.Value * OnHand : null;
    public string StockState => Available <= 0 ? "OUT_OF_STOCK" : Available <= MinStock ? "LOW_STOCK" : "IN_STOCK";
    public string DisplayName => VariantName == "Standard" ? ProductName : $"{ProductName} — {VariantName}";
}

public sealed class InventoryMovement
{
    public long Id { get; set; }
    public long VariantId { get; set; }
    public string? Sku { get; set; }
    public string? ProductName { get; set; }
    public string MovementType { get; set; } = "";
    public decimal OnHandDelta { get; set; }
    public decimal ReservedDelta { get; set; }
    public decimal DamagedDelta { get; set; }
    public decimal OnHandAfter { get; set; }
    public decimal ReservedAfter { get; set; }
    public decimal DamagedAfter { get; set; }
    public decimal? UnitCost { get; set; }
    public string? RefType { get; set; }
    public long? RefId { get; set; }
    public string? RefNumber { get; set; }
    public string? Note { get; set; }
    public string? CreatedByName { get; set; }
    public DateTime CreatedAt { get; set; }
}

public sealed class Customer
{
    public long Id { get; set; }
    public string Code { get; set; } = "";
    public string Name { get; set; } = "";
    public string? Mobile { get; set; }
    public string? Whatsapp { get; set; }
    public string? Email { get; set; }
    public string? BillingAddress { get; set; }
    public string? City { get; set; }
    public string? State { get; set; }
    public string? StateCode { get; set; }
    public string? Pincode { get; set; }
    public string? Gstin { get; set; }
    public string? Notes { get; set; }
    public bool IsWalkIn { get; set; }
    public decimal CreditLimit { get; set; }
    public string CustomerGroup { get; set; } = "RETAIL";
    public string? CustomerGroupName { get; set; }
    public decimal GroupDiscount { get; set; }
    public DateTime CreatedAt { get; set; }
    // list aggregates
    public decimal TotalPurchases { get; set; }
    public decimal Outstanding { get; set; }
    public DateTime? LastPurchaseDate { get; set; }
    public List<CustomerAddress> Addresses { get; set; } = new();
    public string Display => string.IsNullOrWhiteSpace(Mobile) ? Name : $"{Name} ({Mobile})";
    public override string ToString() => Display;
}

public sealed class CustomerAddress
{
    public long Id { get; set; }
    public long CustomerId { get; set; }
    public string Label { get; set; } = "Delivery";
    public string Address { get; set; } = "";
    public string? City { get; set; }
    public string? State { get; set; }
    public string? StateCode { get; set; }
    public string? Pincode { get; set; }
    public string? Landmark { get; set; }
    public bool IsDefault { get; set; }
    public string FullText => string.Join(", ", new[] { Address, Landmark, City, State, Pincode }.Where(s => !string.IsNullOrWhiteSpace(s)));
    public override string ToString() => $"{Label}: {FullText}";
}

public sealed class CustomerSummary
{
    public long CustomerId { get; set; }
    public decimal TotalPurchases { get; set; }
    public decimal TotalReturns { get; set; }
    public decimal TotalPaid { get; set; }
    public decimal Outstanding { get; set; }
    /// <summary>Money received but not yet applied to any invoice (order advances + on-account).</summary>
    public decimal AdvanceAmount { get; set; }
    public int InvoiceCount { get; set; }
    public int OpenOrderCount { get; set; }
    public int CustomOrderCount { get; set; }
}

public sealed class LedgerEntry
{
    public DateTime Date { get; set; }
    public string DocType { get; set; } = "";
    public string DocNumber { get; set; } = "";
    public long DocId { get; set; }
    public string Particulars { get; set; } = "";
    public decimal Debit { get; set; }
    public decimal Credit { get; set; }
    public decimal Balance { get; set; }
    public DateTime CreatedAt { get; set; }
}

public sealed class Supplier
{
    public long Id { get; set; }
    public string Code { get; set; } = "";
    public string Name { get; set; } = "";
    public string? ContactPerson { get; set; }
    public string? Mobile { get; set; }
    public string? Whatsapp { get; set; }
    public string? Email { get; set; }
    public string? Address { get; set; }
    public string? State { get; set; }
    public string? StateCode { get; set; }
    public string? Gstin { get; set; }
    public string? BankName { get; set; }
    public string? BankAccount { get; set; }
    public string? BankIfsc { get; set; }
    public string? UpiId { get; set; }
    public string? Notes { get; set; }
    public decimal TotalPurchases { get; set; }
    public decimal TotalPaid { get; set; }
    public decimal Outstanding { get; set; }
    public override string ToString() => Name;
}

/// <summary>Shared line shape for quotation / sales order / invoice items.</summary>
public sealed class DocumentLine
{
    public long Id { get; set; }
    public int LineNo { get; set; }
    public long? VariantId { get; set; }
    public string Description { get; set; } = "";
    public string? Sku { get; set; }
    public string? HsnCode { get; set; }
    public decimal Quantity { get; set; } = 1;
    public decimal UnitPrice { get; set; }
    public bool PriceIncludesGst { get; set; } = true;
    public decimal DiscountPercent { get; set; }
    public decimal DiscountAmount { get; set; }
    public decimal TaxableAmount { get; set; }
    public decimal GstRate { get; set; }
    public decimal Cgst { get; set; }
    public decimal Sgst { get; set; }
    public decimal Igst { get; set; }
    public decimal LineTotal { get; set; }
    /// <summary>Null when hidden from the current user.</summary>
    public decimal? UnitCost { get; set; }
    public decimal ReservedQty { get; set; }
    public decimal ReturnedQty { get; set; }
    public long? SourceItemId { get; set; }
    public decimal Tax => Cgst + Sgst + Igst;
    public decimal ReturnableQty => Quantity - ReturnedQty;
}

/// <summary>Common header for quotations, sales orders and invoices.</summary>
public class SalesDocument
{
    public long Id { get; set; }
    public string? Number { get; set; }
    public string Status { get; set; } = "DRAFT";
    public DateTime Date { get; set; } = DateTime.Today;
    public long CustomerId { get; set; }
    public string CustomerName { get; set; } = "";
    public string? CustomerMobile { get; set; }
    public string? CustomerGstin { get; set; }
    public string? BillingAddress { get; set; }
    public string? DeliveryAddress { get; set; }
    public string? PlaceOfSupply { get; set; }
    public bool IsInterState { get; set; }
    public decimal Subtotal { get; set; }
    public decimal DiscountTotal { get; set; }
    public decimal TaxableTotal { get; set; }
    public decimal CgstTotal { get; set; }
    public decimal SgstTotal { get; set; }
    public decimal IgstTotal { get; set; }
    public decimal DeliveryCharge { get; set; }
    public decimal InstallationCharge { get; set; }
    public decimal ChargesTax { get; set; }
    public decimal RoundOff { get; set; }
    public decimal GrandTotal { get; set; }
    public string? Notes { get; set; }
    public string? Terms { get; set; }
    public long? CreatedBy { get; set; }
    public long? SalespersonId { get; set; }
    public string? SalespersonName { get; set; }
    public string? CreatedByName { get; set; }
    public DateTime CreatedAt { get; set; }
    public List<DocumentLine> Lines { get; set; } = new();
    public decimal TaxTotal => CgstTotal + SgstTotal + IgstTotal;
    public decimal ItemsTaxable => Subtotal - DiscountTotal;
}

public sealed class Quotation : SalesDocument
{
    public DateTime? ValidUntil { get; set; }
    public long? SalesOrderId { get; set; }
    public string? SalesOrderNumber { get; set; }
}

public sealed class SalesOrder : SalesDocument
{
    public DateTime? ExpectedDeliveryDate { get; set; }
    public long? QuotationId { get; set; }
    public string? QuotationNumber { get; set; }
    public long? InvoiceId { get; set; }
    public string? InvoiceNumber { get; set; }
    public bool RequiresDelivery { get; set; } = true;
    public bool RequiresInstallation { get; set; }
    public string? CancelReason { get; set; }
    public decimal AdvancePaid { get; set; }
    public decimal Balance => GrandTotal - AdvancePaid;
    public bool StockReserved { get; set; }
}

public sealed class Invoice : SalesDocument
{
    public DateTime? DueDate { get; set; }
    public long? SalesOrderId { get; set; }
    public string? SalesOrderNumber { get; set; }
    public long? QuotationId { get; set; }
    public string? QuotationNumber { get; set; }
    public long? CustomOrderId { get; set; }
    public string? CustomOrderNumber { get; set; }
    public decimal? CostTotal { get; set; }
    public bool RequiresDelivery { get; set; }
    public bool RequiresInstallation { get; set; }
    public DateTime? FinalizedAt { get; set; }
    public DateTime? CancelledAt { get; set; }
    public string? CancelReason { get; set; }
    public string? CancelledByName { get; set; }
    // payment position (computed from allocations)
    public decimal ReturnedAmount { get; set; }
    public decimal Paid { get; set; }
    public decimal NetTotal => GrandTotal - ReturnedAmount;
    public decimal Balance => Status == InvoiceStatus.Final ? NetTotal - Paid : 0;
    public string PaymentState => Status != InvoiceStatus.Final ? Status : Domain.PaymentState.Of(NetTotal, Paid, DueDate, DateTime.Today);
    public decimal? Margin => CostTotal.HasValue ? TaxableTotal - CostTotal.Value : null;
}

/// <summary>Row used by the invoice list and outstanding screens.</summary>
public sealed class InvoiceListItem
{
    public long Id { get; set; }
    public string? Number { get; set; }
    public string Status { get; set; } = "";
    public DateTime InvoiceDate { get; set; }
    public DateTime? DueDate { get; set; }
    public long CustomerId { get; set; }
    public string CustomerName { get; set; } = "";
    public string? CustomerMobile { get; set; }
    public decimal GrandTotal { get; set; }
    public decimal ReturnedAmount { get; set; }
    public decimal Paid { get; set; }
    public decimal Balance { get; set; }
    public string? CreatedByName { get; set; }
    public int DaysOverdue { get; set; }
    public string PaymentState => Status != InvoiceStatus.Final ? Status : Domain.PaymentState.Of(GrandTotal - ReturnedAmount, Paid, DueDate, DateTime.Today);
    public string DisplayNumber => Number ?? $"Draft #{Id}";
}

public sealed class PaymentLine
{
    public long Id { get; set; }
    public long PaymentId { get; set; }
    public string MethodCode { get; set; } = "CASH";
    public decimal Amount { get; set; }
    public string? Reference { get; set; }
    public DateTime? ChequeDate { get; set; }
    public string? BankName { get; set; }
}

public sealed class PaymentAllocation
{
    public long Id { get; set; }
    public long PaymentId { get; set; }
    public string DocType { get; set; } = "";
    public long? DocId { get; set; }
    public string? DocNumber { get; set; }
    public decimal Amount { get; set; }
    public string? Note { get; set; }
    public DateTime CreatedAt { get; set; }
}

public sealed class Payment
{
    public long Id { get; set; }
    public string Number { get; set; } = "";
    public string Direction { get; set; } = "IN";
    public long CustomerId { get; set; }
    public string? CustomerName { get; set; }
    public string? CustomerMobile { get; set; }
    public DateTime PaymentDate { get; set; }
    public decimal Amount { get; set; }
    public string? Notes { get; set; }
    public string? Methods { get; set; }
    public string? AppliedTo { get; set; }
    public string? CreatedByName { get; set; }
    public DateTime CreatedAt { get; set; }
    public bool IsVoided { get; set; }
    public DateTime? VoidedAt { get; set; }
    public string? VoidReason { get; set; }
    public List<PaymentLine> Lines { get; set; } = new();
    public List<PaymentAllocation> Allocations { get; set; } = new();
    public string State => IsVoided ? "VOIDED" : Direction == "OUT" ? "REFUND" : "RECEIVED";
}

public sealed class SalesReturn
{
    public long Id { get; set; }
    public string Number { get; set; } = "";
    public long InvoiceId { get; set; }
    public string? InvoiceNumber { get; set; }
    public long CustomerId { get; set; }
    public string? CustomerName { get; set; }
    public DateTime ReturnDate { get; set; }
    public string Reason { get; set; } = "";
    public decimal CreditAmount { get; set; }
    public decimal RefundAmount { get; set; }
    public long? RefundPaymentId { get; set; }
    public long? ExchangeId { get; set; }
    public string? Notes { get; set; }
    public string? CreatedByName { get; set; }
    public DateTime CreatedAt { get; set; }
    public List<SalesReturnItem> Items { get; set; } = new();
}

public sealed class SalesReturnItem
{
    public long Id { get; set; }
    public long ReturnId { get; set; }
    public long InvoiceItemId { get; set; }
    public long? VariantId { get; set; }
    public string? Description { get; set; }
    public decimal Quantity { get; set; }
    public string Condition { get; set; } = "GOOD";
    public string RestockAction { get; set; } = "RESTOCK";
    public decimal CreditAmount { get; set; }
}

public sealed class Exchange
{
    public long Id { get; set; }
    public string Number { get; set; } = "";
    public long CustomerId { get; set; }
    public string? CustomerName { get; set; }
    public long OriginalInvoiceId { get; set; }
    public string? OriginalInvoiceNumber { get; set; }
    public long? NewInvoiceId { get; set; }
    public string? NewInvoiceNumber { get; set; }
    public long? ReturnId { get; set; }
    public string? ReturnNumber { get; set; }
    public decimal OldValue { get; set; }
    public decimal NewValue { get; set; }
    public decimal TransferredAmount { get; set; }
    public decimal Difference { get; set; }
    public string? Notes { get; set; }
    public DateTime CreatedAt { get; set; }
    public string? CreatedByName { get; set; }
}

public sealed class CustomOrder
{
    public long Id { get; set; }
    public string Number { get; set; } = "";
    public long CustomerId { get; set; }
    public string? CustomerName { get; set; }
    public string? CustomerMobile { get; set; }
    public DateTime OrderDate { get; set; } = DateTime.Today;
    public string ProductType { get; set; } = "";
    public string? Design { get; set; }
    public decimal? Width { get; set; }
    public decimal? Height { get; set; }
    public decimal? Depth { get; set; }
    public string DimensionUnit { get; set; } = "ft";
    public string? Material { get; set; }
    public string? Color { get; set; }
    public string? Fabric { get; set; }
    public string? Finish { get; set; }
    public int? Doors { get; set; }
    public int? Drawers { get; set; }
    public string? SpecialRequirements { get; set; }
    public long? ReferenceAttachmentId { get; set; }
    public decimal EstimatedCost { get; set; }
    public decimal FinalPrice { get; set; }
    public decimal? ProductionCost { get; set; }
    public string? HsnCode { get; set; } = "9403";
    public decimal GstRate { get; set; } = 18;
    public bool PriceIncludesGst { get; set; } = true;
    public DateTime? ExpectedCompletionDate { get; set; }
    public string Status { get; set; } = CustomOrderStatus.Received;
    public bool RequiresInstallation { get; set; }
    public string? DeliveryAddress { get; set; }
    public string? Notes { get; set; }
    public long? InvoiceId { get; set; }
    public string? InvoiceNumber { get; set; }
    public string? CancelReason { get; set; }
    public DateTime CreatedAt { get; set; }
    public string? CreatedByName { get; set; }
    public decimal AdvancePaid { get; set; }
    public decimal Balance => (FinalPrice > 0 ? FinalPrice : EstimatedCost) - AdvancePaid;
    public string DimensionsText =>
        string.Join(" × ", new[] { Width, Height, Depth }.Where(v => v.HasValue).Select(v => v!.Value.ToString("0.##"))) +
        (Width.HasValue || Height.HasValue || Depth.HasValue ? " " + DimensionUnit : "");
    public bool IsOverdue => ExpectedCompletionDate.HasValue && ExpectedCompletionDate.Value.Date < DateTime.Today
                             && Status is not (CustomOrderStatus.Completed or CustomOrderStatus.Cancelled);
}

public sealed class StatusHistoryEntry
{
    public long Id { get; set; }
    public string DocType { get; set; } = "";
    public long DocId { get; set; }
    public string? FromStatus { get; set; }
    public string ToStatus { get; set; } = "";
    public string? Note { get; set; }
    public string? ChangedByName { get; set; }
    public DateTime ChangedAt { get; set; }
}

public sealed class Purchase
{
    public long Id { get; set; }
    public string Number { get; set; } = "";
    public long SupplierId { get; set; }
    public string? SupplierName { get; set; }
    public string? SupplierInvoiceNo { get; set; }
    public DateTime PurchaseDate { get; set; } = DateTime.Today;
    public DateTime? DueDate { get; set; }
    public string Status { get; set; } = PurchaseStatus.Draft;
    public bool IsInterState { get; set; }
    public decimal Subtotal { get; set; }
    public decimal DiscountTotal { get; set; }
    public decimal TaxableTotal { get; set; }
    public decimal CgstTotal { get; set; }
    public decimal SgstTotal { get; set; }
    public decimal IgstTotal { get; set; }
    public decimal OtherCharges { get; set; }
    public decimal RoundOff { get; set; }
    public decimal GrandTotal { get; set; }
    public string? Notes { get; set; }
    public decimal ReturnedTotal { get; set; }
    public decimal Paid { get; set; }
    public decimal NetTotal => GrandTotal - ReturnedTotal;
    public decimal Balance => Status == PurchaseStatus.Completed ? NetTotal - Paid : 0;
    public DateTime CreatedAt { get; set; }
    public DateTime? CompletedAt { get; set; }
    public string? CreatedByName { get; set; }
    public string? CancelReason { get; set; }
    public long? WarehouseId { get; set; }
    public string? WarehouseName { get; set; }
    public List<PurchaseLine> Lines { get; set; } = new();
    public string PaymentState => Status != PurchaseStatus.Completed ? Status : Domain.PaymentState.Of(NetTotal, Paid, DueDate, DateTime.Today);
}

public sealed class PurchaseLine
{
    public long Id { get; set; }
    public int LineNo { get; set; }
    public long VariantId { get; set; }
    public string Description { get; set; } = "";
    public string? Sku { get; set; }
    public string? HsnCode { get; set; }
    public decimal Quantity { get; set; } = 1;
    public decimal UnitCost { get; set; }
    public decimal DiscountPercent { get; set; }
    public decimal DiscountAmount { get; set; }
    public decimal TaxableAmount { get; set; }
    public decimal GstRate { get; set; }
    public decimal Cgst { get; set; }
    public decimal Sgst { get; set; }
    public decimal Igst { get; set; }
    public decimal LineTotal { get; set; }
    public decimal ReturnedQty { get; set; }
    public decimal ReturnableQty => Quantity - ReturnedQty;
}

public sealed class SupplierPayment
{
    public long Id { get; set; }
    public string Number { get; set; } = "";
    public long SupplierId { get; set; }
    public string? SupplierName { get; set; }
    public DateTime PaymentDate { get; set; } = DateTime.Today;
    public decimal Amount { get; set; }
    public string MethodCode { get; set; } = "BANK";
    public string? Reference { get; set; }
    public string? Notes { get; set; }
    public string? AppliedTo { get; set; }
    public bool IsVoided { get; set; }
    public string? VoidReason { get; set; }
    public string? CreatedByName { get; set; }
    public DateTime CreatedAt { get; set; }
}

public sealed class Delivery
{
    public long Id { get; set; }
    public string Number { get; set; } = "";
    public long CustomerId { get; set; }
    public string? CustomerName { get; set; }
    public string? CustomerMobile { get; set; }
    public long? InvoiceId { get; set; }
    public string? InvoiceNumber { get; set; }
    public long? SalesOrderId { get; set; }
    public string? SalesOrderNumber { get; set; }
    public long? CustomOrderId { get; set; }
    public string? CustomOrderNumber { get; set; }
    public string DeliveryAddress { get; set; } = "";
    public string? ContactMobile { get; set; }
    public DateTime? ScheduledDate { get; set; }
    public string? TimeSlot { get; set; }
    public string? DriverName { get; set; }
    public long? DriverUserId { get; set; }
    public string? VehicleNo { get; set; }
    public decimal DeliveryCharge { get; set; }
    public decimal? DeliveryCost { get; set; }
    public string Status { get; set; } = DeliveryStatus.Pending;
    public bool OtpVerified { get; set; }
    public bool HasOtp { get; set; }
    public string? ReceiverName { get; set; }
    public long? SignatureAttachmentId { get; set; }
    public long? PhotoAttachmentId { get; set; }
    public string? Remarks { get; set; }
    public string? Notes { get; set; }
    public DateTime? DeliveredAt { get; set; }
    public DateTime CreatedAt { get; set; }
    public string? ItemsSummary { get; set; }
    public List<DeliveryItem> Items { get; set; } = new();
    public string SourceNumber => InvoiceNumber ?? SalesOrderNumber ?? CustomOrderNumber ?? "";
    public string Priority { get; set; } = "NORMAL";
    public string? Route { get; set; }
    public int? RouteOrder { get; set; }
}

public sealed class DeliveryItem
{
    public long Id { get; set; }
    public long DeliveryId { get; set; }
    public long? VariantId { get; set; }
    public string Description { get; set; } = "";
    public decimal Quantity { get; set; } = 1;
}

public sealed class Installation
{
    public long Id { get; set; }
    public string Number { get; set; } = "";
    public long CustomerId { get; set; }
    public string? CustomerName { get; set; }
    public string? CustomerMobile { get; set; }
    public long? DeliveryId { get; set; }
    public string? DeliveryNumber { get; set; }
    public long? InvoiceId { get; set; }
    public string? InvoiceNumber { get; set; }
    public long? SalesOrderId { get; set; }
    public long? CustomOrderId { get; set; }
    public string? CustomOrderNumber { get; set; }
    public string Address { get; set; } = "";
    public string? TechnicianName { get; set; }
    public long? TechnicianUserId { get; set; }
    public DateTime? ScheduledDate { get; set; }
    public DateTime? CompletedAt { get; set; }
    public string Status { get; set; } = InstallationStatus.Pending;
    public decimal? InstallationCost { get; set; }
    public string? Notes { get; set; }
    public string? CompletionNotes { get; set; }
    public long? CompletionPhotoId { get; set; }
    public string? CustomerConfirmedBy { get; set; }
    public DateTime CreatedAt { get; set; }
}

public sealed class ExpenseCategory
{
    public long Id { get; set; }
    public string Name { get; set; } = "";
    public bool IsActive { get; set; } = true;
    public override string ToString() => Name;
}

public sealed class Expense
{
    public long Id { get; set; }
    public string Number { get; set; } = "";
    public long CategoryId { get; set; }
    public string? CategoryName { get; set; }
    public DateTime ExpenseDate { get; set; } = DateTime.Today;
    public decimal Amount { get; set; }
    public string MethodCode { get; set; } = "CASH";
    public string? Description { get; set; }
    public string? Reference { get; set; }
    public long? DeliveryId { get; set; }
    public long? InstallationId { get; set; }
    public string? CreatedByName { get; set; }
    public DateTime CreatedAt { get; set; }
}

public sealed class AuditLog
{
    public long Id { get; set; }
    public DateTime OccurredAt { get; set; }
    public long? UserId { get; set; }
    public string? Username { get; set; }
    public string Action { get; set; } = "";
    public string Module { get; set; } = "";
    public string? RecordType { get; set; }
    public long? RecordId { get; set; }
    public string? RecordRef { get; set; }
    public string Summary { get; set; } = "";
    public string? OldValue { get; set; }
    public string? NewValue { get; set; }
    public string? Machine { get; set; }
    public string? IpAddress { get; set; }
}

public sealed class Notification
{
    public long Id { get; set; }
    public long? UserId { get; set; }
    public string Kind { get; set; } = "";
    public string Title { get; set; } = "";
    public string Message { get; set; } = "";
    public string? RefType { get; set; }
    public long? RefId { get; set; }
    public bool IsRead { get; set; }
    public DateTime CreatedAt { get; set; }
}

public sealed class AttachmentInfo
{
    public long Id { get; set; }
    public string OwnerType { get; set; } = "";
    public long? OwnerId { get; set; }
    public string Purpose { get; set; } = "";
    public string FileName { get; set; } = "";
    public string ContentType { get; set; } = "";
    public int SizeBytes { get; set; }
    public DateTime CreatedAt { get; set; }
}

public sealed class SearchResult
{
    public string Kind { get; set; } = "";
    public long Id { get; set; }
    public string Title { get; set; } = "";
    public string? Subtitle { get; set; }
    public string? Status { get; set; }
}

public sealed class PagedResult<T>
{
    public IReadOnlyList<T> Items { get; init; } = Array.Empty<T>();
    public int TotalCount { get; init; }
    public int Page { get; init; }
    public int PageSize { get; init; }
    public int PageCount => PageSize <= 0 ? 1 : Math.Max(1, (int)Math.Ceiling(TotalCount / (double)PageSize));
}

public sealed class ListQuery
{
    public string? Search { get; set; }
    public string? Status { get; set; }
    public DateTime? From { get; set; }
    public DateTime? To { get; set; }
    public long? CustomerId { get; set; }
    public long? SupplierId { get; set; }
    public long? CategoryId { get; set; }
    public long? ProductId { get; set; }
    public string? SortBy { get; set; }
    public bool SortDescending { get; set; } = true;
    public int Page { get; set; } = 1;
    public int PageSize { get; set; } = 50;
    public int Offset => Math.Max(0, (Page - 1) * PageSize);
}
