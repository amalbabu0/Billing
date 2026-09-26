namespace FurniShop.Core.Domain;

// Input models passed from the UI to the service layer.

public sealed class LineInput
{
    public long? VariantId { get; set; }
    public string Description { get; set; } = "";
    public string? Sku { get; set; }
    public string? HsnCode { get; set; }
    public decimal Quantity { get; set; } = 1;
    public decimal UnitPrice { get; set; }
    public bool PriceIncludesGst { get; set; } = true;
    public decimal GstRate { get; set; }
    public decimal DiscountPercent { get; set; }
    public decimal DiscountAmount { get; set; }
    /// <summary>Item id on the source document (quotation item → SO item → invoice item).</summary>
    public long? SourceItemId { get; set; }

    public static LineInput From(DocumentLine l) => new()
    {
        VariantId = l.VariantId, Description = l.Description, Sku = l.Sku, HsnCode = l.HsnCode,
        Quantity = l.Quantity, UnitPrice = l.UnitPrice, PriceIncludesGst = l.PriceIncludesGst, GstRate = l.GstRate,
        DiscountPercent = l.DiscountPercent, DiscountAmount = l.DiscountAmount, SourceItemId = l.Id,
    };
}

public sealed class SalesDocumentInput
{
    /// <summary>0 for a new document; otherwise the draft being updated.</summary>
    public long Id { get; set; }
    public long CustomerId { get; set; }
    public DateTime Date { get; set; } = DateTime.Today;
    public List<LineInput> Lines { get; set; } = new();
    public decimal DeliveryCharge { get; set; }
    public decimal InstallationCharge { get; set; }
    public string? DeliveryAddress { get; set; }
    /// <summary>GST state code of the place of supply. Null = customer's state (or shop state).</summary>
    public string? PlaceOfSupply { get; set; }
    public string? Notes { get; set; }
    public string? Terms { get; set; }
    public DateTime? ValidUntil { get; set; }
    public DateTime? ExpectedDeliveryDate { get; set; }
    public DateTime? DueDate { get; set; }
    public bool RequiresDelivery { get; set; }
    public bool RequiresInstallation { get; set; }
    public long? QuotationId { get; set; }
    public long? SalesOrderId { get; set; }
    public long? CustomOrderId { get; set; }
}

public sealed class PaymentLineInput
{
    public string MethodCode { get; set; } = PaymentMethodCode.Cash;
    public decimal Amount { get; set; }
    public string? Reference { get; set; }
    public DateTime? ChequeDate { get; set; }
    public string? BankName { get; set; }
}

public sealed class PaymentInput
{
    public long CustomerId { get; set; }
    public DateTime Date { get; set; } = DateTime.Today;
    public List<PaymentLineInput> Lines { get; set; } = new();
    public string? Notes { get; set; }
    /// <summary>INVOICE / SALES_ORDER / CUSTOM_ORDER; null → apply to oldest outstanding invoices, remainder on account.</summary>
    public string? DocType { get; set; }
    public long? DocId { get; set; }
    public decimal Total => Lines.Sum(l => l.Amount);
}

public sealed class ReturnLineInput
{
    public long InvoiceItemId { get; set; }
    public decimal Quantity { get; set; }
    public string Condition { get; set; } = ItemCondition.Good;
    public string? RestockAction { get; set; }
}

public sealed class ReturnInput
{
    public long InvoiceId { get; set; }
    public DateTime Date { get; set; } = DateTime.Today;
    public string Reason { get; set; } = ReturnReason.CustomerRequest;
    public List<ReturnLineInput> Lines { get; set; } = new();
    /// <summary>Money paid back now. Cannot exceed what the customer has overpaid after the return.</summary>
    public decimal RefundAmount { get; set; }
    public string RefundMethod { get; set; } = PaymentMethodCode.Cash;
    public string? RefundReference { get; set; }
    public string? Notes { get; set; }
}

public sealed class ExchangeInput
{
    public long OriginalInvoiceId { get; set; }
    public List<ReturnLineInput> ReturnLines { get; set; } = new();
    public SalesDocumentInput NewInvoice { get; set; } = new();
    public List<PaymentLineInput> Payments { get; set; } = new();
    public string? Notes { get; set; }
}

public sealed class ExchangePreview
{
    public decimal OldValue { get; set; }
    public decimal NewValue { get; set; }
    public decimal CreditAvailable { get; set; }
    public decimal Difference { get; set; }
    public decimal OldInvoiceOutstanding { get; set; }
}

public sealed class PurchaseInput
{
    public long Id { get; set; }
    public long SupplierId { get; set; }
    public string? SupplierInvoiceNo { get; set; }
    public DateTime Date { get; set; } = DateTime.Today;
    public DateTime? DueDate { get; set; }
    public decimal OtherCharges { get; set; }
    public string? Notes { get; set; }
    public List<PurchaseLineInput> Lines { get; set; } = new();
    public bool Complete { get; set; }
    /// <summary>Optional payment made at the time of purchase.</summary>
    public decimal PaidNow { get; set; }
    public string PaidMethod { get; set; } = PaymentMethodCode.Bank;
    public string? PaidReference { get; set; }
    /// <summary>Location the goods are received into; null = default location.</summary>
    public long? WarehouseId { get; set; }
}

public sealed class PurchaseLineInput
{
    public long VariantId { get; set; }
    public string Description { get; set; } = "";
    public string? HsnCode { get; set; }
    public decimal Quantity { get; set; } = 1;
    public decimal UnitCost { get; set; }
    public decimal DiscountPercent { get; set; }
    public decimal GstRate { get; set; }
}

public sealed class SupplierPaymentInput
{
    public long SupplierId { get; set; }
    public DateTime Date { get; set; } = DateTime.Today;
    public decimal Amount { get; set; }
    public string MethodCode { get; set; } = PaymentMethodCode.Bank;
    public string? Reference { get; set; }
    public string? Notes { get; set; }
    /// <summary>Null → oldest outstanding purchases first.</summary>
    public long? PurchaseId { get; set; }
}

public sealed class StockAdjustmentInput
{
    public long VariantId { get; set; }
    public string AdjustmentType { get; set; } = Domain.AdjustmentType.Increase;
    public decimal Quantity { get; set; }
    public string Reason { get; set; } = "";
    public decimal? UnitCost { get; set; }
    public long? WarehouseId { get; set; }
}

public sealed class DeliveryCompletion
{
    public long DeliveryId { get; set; }
    public string ReceiverName { get; set; } = "";
    public string? Otp { get; set; }
    public byte[]? SignaturePng { get; set; }
    public byte[]? PhotoBytes { get; set; }
    public string? PhotoFileName { get; set; }
    public string? Remarks { get; set; }
}

public sealed class CheckoutResult
{
    public long InvoiceId { get; set; }
    public string? InvoiceNumber { get; set; }
    public long? PaymentId { get; set; }
    public string? PaymentNumber { get; set; }
    public long? DeliveryId { get; set; }
}
