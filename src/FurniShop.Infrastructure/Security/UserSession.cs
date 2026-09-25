using System.Net;
using System.Net.Sockets;
using FurniShop.Core;

namespace FurniShop.Infrastructure.Security;

/// <summary>
/// The signed-in user. Every service method checks permissions through <see cref="Demand"/>;
/// the UI hiding a button is only a convenience, never the protection.
/// </summary>
public sealed class UserSession
{
    private HashSet<string> _permissions = new(StringComparer.Ordinal);

    public long? UserId { get; private set; }
    public string Username { get; private set; } = "system";
    public string FullName { get; private set; } = "System";
    public string RoleCode { get; private set; } = "";
    public string RoleName { get; private set; } = "";
    public bool IsAuthenticated => UserId.HasValue;
    public bool IsAdmin => RoleCode == "ADMIN";
    public DateTime LastActivity { get; private set; } = DateTime.UtcNow;
    public IReadOnlyCollection<string> Permissions => _permissions;

    /// <summary>Web requests: the browser's IP and user agent, recorded in the audit log instead of the server's.</summary>
    public string? ClientIp { get; set; }
    public string? ClientDevice { get; set; }

    public static string MachineName { get; } = SafeMachineName();
    public static string? IpAddress { get; } = LocalIp();

    public event EventHandler? Changed;

    public void SignIn(long userId, string username, string fullName, string roleCode, string roleName, IEnumerable<string> permissions)
    {
        UserId = userId; Username = username; FullName = fullName; RoleCode = roleCode; RoleName = roleName;
        _permissions = new HashSet<string>(permissions, StringComparer.Ordinal);
        Touch();
        Changed?.Invoke(this, EventArgs.Empty);
    }

    public void SignOut()
    {
        UserId = null; Username = "system"; FullName = "System"; RoleCode = ""; RoleName = "";
        _permissions = new HashSet<string>(StringComparer.Ordinal);
        Changed?.Invoke(this, EventArgs.Empty);
    }

    public void Touch() => LastActivity = DateTime.UtcNow;

    public bool Has(string permission) => _permissions.Contains(permission);

    public bool HasAny(params string[] permissions) => permissions.Any(_permissions.Contains);

    public void Demand(string permission)
    {
        if (!IsAuthenticated) throw new PermissionDeniedException("not signed in");
        if (!_permissions.Contains(permission)) throw new PermissionDeniedException(permission);
        Touch();
    }

    public void DemandAny(params string[] permissions)
    {
        if (!IsAuthenticated) throw new PermissionDeniedException("not signed in");
        if (!permissions.Any(_permissions.Contains)) throw new PermissionDeniedException(string.Join(" / ", permissions));
        Touch();
    }

    public bool CanSeeCost => Has(Core.Security.Perm.CostView);

    private static string SafeMachineName()
    {
        try { return Environment.MachineName; } catch { return "unknown"; }
    }

    private static string? LocalIp()
    {
        try
        {
            return Dns.GetHostEntry(Dns.GetHostName()).AddressList
                .FirstOrDefault(a => a.AddressFamily == AddressFamily.InterNetwork && !IPAddress.IsLoopback(a))?.ToString();
        }
        catch { return null; }
    }
}
