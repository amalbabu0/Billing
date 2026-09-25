namespace FurniShop.Core.Domain;

public static class DocType
{
    public const string Invoice = "INVOICE";
    public const string Quotation = "QUOTATION";
    public const string SalesOrder = "SALES_ORDER";
    public const string CustomOrder = "CUSTOM_ORDER";
    public const string Payment = "PAYMENT";
    public const string Refund = "REFUND";
    public const string Return = "RETURN";
    public const string Exchange = "EXCHANGE";
    public const string Purchase = "PURCHASE";
    public const string SupplierPayment = "SUPPLIER_PAYMENT";
    public const string Delivery = "DELIVERY";
    public const string Installation = "INSTALLATION";
    public const string Expense = "EXPENSE";
    public const string Adjustment = "ADJUSTMENT";
    public const string Customer = "CUSTOMER";
    public const string Supplier = "SUPPLIER";
    public const string OnAccount = "ON_ACCOUNT";
}

public static class InvoiceStatus
{
    public const string Draft = "DRAFT";
    public const string Final = "FINAL";
    public const string Cancelled = "CANCELLED";
}

public static class QuotationStatus
{
    public const string Draft = "DRAFT";
    public const string Sent = "SENT";
    public const string Confirmed = "CONFIRMED";
    public const string Converted = "CONVERTED";
    public const string Rejected = "REJECTED";
    public const string Expired = "EXPIRED";
    public const string Cancelled = "CANCELLED";
    public static readonly string[] All = { Draft, Sent, Confirmed, Converted, Rejected, Expired, Cancelled };
}

public static class SalesOrderStatus
{
    public const string Draft = "DRAFT";
    public const string Confirmed = "CONFIRMED";
    public const string Processing = "PROCESSING";
    public const string Manufacturing = "MANUFACTURING";
    public const string Ready = "READY";
    public const string Dispatched = "DISPATCHED";
    public const string Delivered = "DELIVERED";
    public const string Completed = "COMPLETED";
    public const string Cancelled = "CANCELLED";
    public static readonly string[] Flow = { Draft, Confirmed, Processing, Manufacturing, Ready, Dispatched, Delivered, Completed };
    public static readonly string[] All = { Draft, Confirmed, Processing, Manufacturing, Ready, Dispatched, Delivered, Completed, Cancelled };
    public static bool IsOpen(string s) => s is not (Completed or Cancelled);
}

public static class CustomOrderStatus
{
    public const string Received = "RECEIVED";
    public const string Production = "PRODUCTION";
    public const string QualityCheck = "QUALITY_CHECK";
    public const string Ready = "READY";
    public const string Delivery = "DELIVERY";
    public const string Installation = "INSTALLATION";
    public const string Completed = "COMPLETED";
    public const string Cancelled = "CANCELLED";
    public static readonly string[] Flow = { Received, Production, QualityCheck, Ready, Delivery, Installation, Completed };
    public static readonly string[] All = { Received, Production, QualityCheck, Ready, Delivery, Installation, Completed, Cancelled };

    /// <summary>Next status in the production workflow. Installation is skipped when not required.</summary>
    public static string? Next(string current, bool requiresInstallation)
    {
        var i = Array.IndexOf(Flow, current);
        if (i < 0 || i == Flow.Length - 1) return null;
        var next = Flow[i + 1];
        if (next == Installation && !requiresInstallation) next = Completed;
        return next;
    }
}

public static class DeliveryStatus
{
    public const string Pending = "PENDING";
    public const string Scheduled = "SCHEDULED";
    public const string OutForDelivery = "OUT_FOR_DELIVERY";
    public const string Delivered = "DELIVERED";
    public const string Failed = "FAILED";
    public const string Cancelled = "CANCELLED";
    public static readonly string[] All = { Pending, Scheduled, OutForDelivery, Delivered, Failed, Cancelled };
}

public static class InstallationStatus
{
    public const string Pending = "PENDING";
    public const string Scheduled = "SCHEDULED";
    public const string Assigned = "ASSIGNED";
    public const string Completed = "COMPLETED";
    public const string Cancelled = "CANCELLED";
    public static readonly string[] All = { Pending, Scheduled, Assigned, Completed, Cancelled };
}

public static class PurchaseStatus
{
    public const string Draft = "DRAFT";
    public const string Completed = "COMPLETED";
    public const string Cancelled = "CANCELLED";
}

public static class PaymentDirection
{
    public const string In = "IN";
    public const string Out = "OUT";
}

public static class PaymentMethodCode
{
    public const string Cash = "CASH";
    public const string Upi = "UPI";
    public const string Card = "CARD";
    public const string Bank = "BANK";
    public const string Cheque = "CHEQUE";
    public const string Credit = "CREDIT";
    public static readonly string[] Money = { Cash, Upi, Card, Bank, Cheque };
}

public static class ReturnReason
{
    public const string Damaged = "DAMAGED";
    public const string ManufacturingDefect = "MANUFACTURING_DEFECT";
    public const string WrongProduct = "WRONG_PRODUCT";
    public const string CustomerRequest = "CUSTOMER_REQUEST";
    public const string Exchange = "EXCHANGE";
    public const string Other = "OTHER";
    public static readonly string[] Selectable = { Damaged, ManufacturingDefect, WrongProduct, CustomerRequest, Other };
}

public static class ItemCondition
{
    public const string Good = "GOOD";
    public const string Damaged = "DAMAGED";
    public const string Defective = "DEFECTIVE";
    public static readonly string[] All = { Good, Damaged, Defective };
}

public static class RestockAction
{
    public const string Restock = "RESTOCK";
    public const string DamagedStock = "DAMAGED_STOCK";
    public const string NoRestock = "NO_RESTOCK";
    public static readonly string[] All = { Restock, DamagedStock, NoRestock };

    /// <summary>Default inventory action for a returned item's condition.</summary>
    public static string ForCondition(string condition) => condition == ItemCondition.Good ? Restock : DamagedStock;
}

public static class MovementType
{
    public const string Opening = "OPENING";
    public const string PurchaseIn = "PURCHASE_IN";
    public const string SaleOut = "SALE_OUT";
    public const string Reserve = "RESERVE";
    public const string Unreserve = "UNRESERVE";
    public const string ReservedSaleOut = "RESERVED_SALE_OUT";
    public const string ReturnIn = "RETURN_IN";
    public const string ReturnDamaged = "RETURN_DAMAGED";
    public const string AdjustmentIn = "ADJUSTMENT_IN";
    public const string AdjustmentOut = "ADJUSTMENT_OUT";
    public const string Damage = "DAMAGE";
    public const string DamageRepaired = "DAMAGE_REPAIRED";
    public const string DamageWriteOff = "DAMAGE_WRITE_OFF";
    public const string SaleCancelIn = "SALE_CANCEL_IN";
    public const string PurchaseCancelOut = "PURCHASE_CANCEL_OUT";
    public const string Display = "DISPLAY";
}

public static class AdjustmentType
{
    public const string Increase = "INCREASE";
    public const string Decrease = "DECREASE";
    public const string MarkDamaged = "MARK_DAMAGED";
    public const string DamageRepaired = "DAMAGE_REPAIRED";
    public const string DamageWriteOff = "DAMAGE_WRITE_OFF";
    public const string SetDisplay = "SET_DISPLAY";
    public static readonly string[] All = { Increase, Decrease, MarkDamaged, DamageRepaired, DamageWriteOff, SetDisplay };
}

public enum StatusTone { Success, Warning, Error, Neutral, Info }

/// <summary>Maps every status used in the app to a semantic tone and a readable label.</summary>
public static class StatusStyle
{
    public static StatusTone ToneOf(string? status) => status switch
    {
        "COMPLETED" or "PAID" or "DELIVERED" or "FINAL" or "CONVERTED" or "ACTIVE" or "IN_STOCK" or "RESTOCK" or "GOOD" => StatusTone.Success,
        "PENDING" or "RESERVED" or "PARTIAL" or "PARTIALLY_PAID" or "SCHEDULED" or "OUT_FOR_DELIVERY" or "ASSIGNED"
            or "SENT" or "LOW_STOCK" or "READY" or "DISPATCHED" or "QUALITY_CHECK" or "UNPAID" => StatusTone.Warning,
        "CANCELLED" or "OVERDUE" or "DAMAGED" or "FAILED" or "REJECTED" or "EXPIRED" or "OUT_OF_STOCK" or "VOID" or "VOIDED"
            or "DISCONTINUED" or "DEFECTIVE" => StatusTone.Error,
        "CONFIRMED" or "PRODUCTION" or "MANUFACTURING" or "DELIVERY" or "INSTALLATION" or "RECEIVED" => StatusTone.Info,
        _ => StatusTone.Neutral,
    };

    public static string Label(string? status) => string.IsNullOrEmpty(status)
        ? ""
        : string.Join(' ', status.Split('_').Select(w => w.Length == 0 ? w : char.ToUpperInvariant(w[0]) + w[1..].ToLowerInvariant()));
}

public static class PaymentState
{
    public const string Paid = "PAID";
    public const string Partial = "PARTIALLY_PAID";
    public const string Unpaid = "UNPAID";
    public const string Overdue = "OVERDUE";

    public static string Of(decimal total, decimal paid, DateTime? dueDate, DateTime today)
    {
        var balance = total - paid;
        if (balance <= 0) return Paid;
        if (dueDate.HasValue && dueDate.Value.Date < today.Date) return Overdue;
        return paid > 0 ? Partial : Unpaid;
    }
}
