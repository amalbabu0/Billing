namespace FurniShop.Core;

/// <summary>A business rule was violated (e.g. insufficient stock, credit sale to walk-in customer).</summary>
public class BusinessRuleException(string message) : Exception(message);

/// <summary>The current user lacks a permission. Thrown by the service layer, never only by the UI.</summary>
public sealed class PermissionDeniedException(string permission)
    : Exception($"You do not have permission to perform this action ({permission}).")
{
    public string Permission { get; } = permission;
}

public sealed class NotFoundException(string entity, object key) : Exception($"{entity} '{key}' was not found.");

public sealed class ValidationException : Exception
{
    public IReadOnlyDictionary<string, string> Errors { get; }

    public ValidationException(IReadOnlyDictionary<string, string> errors)
        : base(string.Join(Environment.NewLine, errors.Values)) => Errors = errors;

    public ValidationException(string field, string message) : this(new Dictionary<string, string> { [field] = message }) { }
}

/// <summary>Another user changed the record; reload and retry.</summary>
public sealed class ConcurrencyException(string message) : Exception(message);
