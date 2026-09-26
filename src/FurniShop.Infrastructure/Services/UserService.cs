using Dapper;
using FurniShop.Core;
using FurniShop.Core.Domain;
using FurniShop.Core.Security;
using FurniShop.Core.Validation;
using FurniShop.Infrastructure.Database;
using FurniShop.Infrastructure.Security;

namespace FurniShop.Infrastructure.Services;

public enum LoginOutcome { Success, InvalidCredentials, LockedOut, Disabled }

public sealed record LoginResult(LoginOutcome Outcome, string Message, bool MustChangePassword = false);

/// <summary>Sign-in with PBKDF2 hashes, lock-out after repeated failures, and the first-run admin setup.</summary>
public sealed class AuthService(Db db, UserSession session, AuditService audit)
{
    private static readonly Lazy<string> DummyHash = new(() => PasswordHasher.Hash(Guid.NewGuid().ToString()));

    public async Task<bool> NeedsInitialSetupAsync() =>
        await db.ScalarAsync<int>("select count(*) from users where not is_deleted") == 0;

    public async Task CreateInitialAdminAsync(string username, string fullName, string password)
    {
        await db.InTransactionAsync(async (conn, tx) =>
        {
            await conn.ExecuteAsync("lock table users in exclusive mode", transaction: tx);
            if (await conn.ExecuteScalarAsync<int>("select count(*) from users where not is_deleted", transaction: tx) > 0)
                throw new BusinessRuleException("The administrator account already exists.");
            var s = await SettingsService.LoadAsync(conn, tx);
            ValidateNew(username, fullName, password, s.Security.MinPasswordLength);
            var roleId = await conn.ExecuteScalarAsync<long>("select id from roles where code = 'ADMIN'", transaction: tx);
            var id = await conn.ExecuteScalarAsync<long>("""
                insert into users (username, full_name, role_id, password_hash) values (@u, @n, @roleId, @h) returning id
                """, new { u = username.Trim(), n = fullName.Trim(), roleId, h = PasswordHasher.Hash(password) }, tx);
            await audit.LogAsync(conn, tx, "CREATE", "Employees", $"created the administrator account {username}", "user", id, username);
        });
    }

    internal static void ValidateNew(string username, string fullName, string password, int minLength)
    {
        new ValidationBuilder()
            .Check(!string.IsNullOrWhiteSpace(username) && username.Trim().Length >= 3 && username.Trim().All(c => char.IsLetterOrDigit(c) || c is '.' or '_' or '-'),
                "Username", "Username must be at least 3 letters/digits (. _ - allowed).")
            .Require(fullName, "FullName", "Full name")
            .Check(PasswordHasher.CheckPolicy(password ?? "", minLength) is null, "Password", PasswordHasher.CheckPolicy(password ?? "", minLength) ?? "")
            .ThrowIfInvalid();
    }

    public async Task<LoginResult> LoginAsync(string username, string password)
    {
        if (string.IsNullOrWhiteSpace(username) || string.IsNullOrEmpty(password))
            return new(LoginOutcome.InvalidCredentials, "Enter your username and password.");

        return await db.InTransactionAsync(async (conn, tx) =>
        {
            var s = await SettingsService.LoadAsync(conn, tx);
            var u = await conn.QuerySingleOrDefaultAsync<(long Id, string Username, string FullName, string PasswordHash, bool IsActive, int FailedLoginCount,
                    DateTime? LockedUntil, bool MustChangePassword, string RoleCode, string RoleName, long RoleId, DateTime PasswordChangedAt)>("""
                select u.id, u.username, u.full_name, u.password_hash, u.is_active, u.failed_login_count, u.locked_until, u.must_change_password,
                       r.code, r.name, r.id, u.password_changed_at
                from users u join roles r on r.id = u.role_id where lower(u.username) = lower(@username) and not u.is_deleted for update of u
                """, new { username = username.Trim() }, tx);

            if (u.Id == 0)
            {
                PasswordHasher.Verify(password, DummyHash.Value); // same cost as a real check
                await audit.LogAsync(conn, tx, "LOGIN_FAILED", "Security", $"failed sign-in for unknown user '{username}'");
                return new LoginResult(LoginOutcome.InvalidCredentials, "Incorrect username or password.");
            }
            if (u.LockedUntil.HasValue && u.LockedUntil.Value > DateTime.Now)
                return new LoginResult(LoginOutcome.LockedOut, $"Too many failed attempts. Try again after {u.LockedUntil.Value:HH:mm}.");
            if (!u.IsActive) return new LoginResult(LoginOutcome.Disabled, "This account is disabled. Contact the owner.");

            if (!PasswordHasher.Verify(password, u.PasswordHash))
            {
                var fails = u.FailedLoginCount + 1;
                DateTime? lockUntil = fails >= s.Security.MaxFailedLogins ? DateTime.Now.AddMinutes(s.Security.LockoutMinutes) : null;
                await conn.ExecuteAsync("update users set failed_login_count = @fails, locked_until = @lockUntil where id = @Id",
                    new { fails = lockUntil.HasValue ? 0 : fails, lockUntil, u.Id }, tx);
                await audit.LogAsync(conn, tx, "LOGIN_FAILED", "Security", $"failed sign-in for {u.Username}{(lockUntil.HasValue ? " — account locked" : "")}", "user", u.Id, u.Username);
                return lockUntil.HasValue
                    ? new LoginResult(LoginOutcome.LockedOut, $"Account locked for {s.Security.LockoutMinutes} minutes after {s.Security.MaxFailedLogins} failed attempts.")
                    : new LoginResult(LoginOutcome.InvalidCredentials, "Incorrect username or password.");
            }

            var newHash = PasswordHasher.NeedsRehash(u.PasswordHash) ? PasswordHasher.Hash(password) : u.PasswordHash;
            await conn.ExecuteAsync("update users set failed_login_count = 0, locked_until = null, last_login_at = now(), password_hash = @newHash where id = @Id",
                new { newHash, u.Id }, tx);
            var perms = await conn.QueryAsync<string>("select permission_code from role_permissions where role_id = @RoleId", new { u.RoleId }, tx);
            session.SignIn(u.Id, u.Username, u.FullName, u.RoleCode, u.RoleName, perms);
            await audit.LogAsync(conn, tx, "LOGIN", "Security", "signed in", "user", u.Id, u.Username);

            var expired = s.Security.PasswordExpiryDays > 0 && u.PasswordChangedAt.AddDays(s.Security.PasswordExpiryDays) < DateTime.Now;
            return new LoginResult(LoginOutcome.Success, "Welcome", u.MustChangePassword || expired);
        });
    }

    public async Task LogoutAsync()
    {
        if (session.IsAuthenticated) await audit.LogAsync("LOGOUT", "Security", "signed out", "user", session.UserId, session.Username);
        session.SignOut();
    }

    public async Task ChangePasswordAsync(string current, string newPassword)
    {
        if (!session.IsAuthenticated) throw new PermissionDeniedException("not signed in");
        await db.InTransactionAsync(async (conn, tx) =>
        {
            var s = await SettingsService.LoadAsync(conn, tx);
            var hash = await conn.ExecuteScalarAsync<string>("select password_hash from users where id = @UserId for update", new { session.UserId }, tx);
            if (!PasswordHasher.Verify(current, hash!)) throw new ValidationException("Current", "Current password is incorrect.");
            if (PasswordHasher.CheckPolicy(newPassword, s.Security.MinPasswordLength) is { } err) throw new ValidationException("Password", err);
            if (current == newPassword) throw new ValidationException("Password", "Choose a different password.");
            await conn.ExecuteAsync("update users set password_hash = @h, must_change_password = false, password_changed_at = now(), updated_at = now() where id = @UserId",
                new { h = PasswordHasher.Hash(newPassword), session.UserId }, tx);
            await audit.LogAsync(conn, tx, "PASSWORD", "Security", "changed own password", "user", session.UserId, session.Username);
        });
    }

    /// <summary>Re-reads the user's permissions (after an admin changes a role).</summary>
    public async Task RefreshPermissionsAsync()
    {
        if (!session.IsAuthenticated) return;
        var u = await db.QuerySingleOrDefaultAsync<(string RoleCode, string RoleName, long RoleId, bool IsActive)>(
            "select r.code, r.name, r.id, u.is_active and not u.is_deleted from users u join roles r on r.id = u.role_id where u.id = @UserId", new { session.UserId });
        if (!u.IsActive) { session.SignOut(); return; }
        var perms = await db.QueryAsync<string>("select permission_code from role_permissions where role_id = @RoleId", new { u.RoleId });
        session.SignIn(session.UserId!.Value, session.Username, session.FullName, u.RoleCode, u.RoleName, perms);
    }
}

/// <summary>Users, roles and role permissions.</summary>
public sealed class UserService(Db db, UserSession session, AuditService audit)
{
    public Task<IReadOnlyList<User>> ListAsync()
    {
        session.DemandAny(Perm.UserManage, Perm.AuditView);
        return db.QueryAsync<User>("""
            select u.*, r.name as role_name, r.code as role_code from users u join roles r on r.id = u.role_id where not u.is_deleted order by u.full_name
            """);
    }

    /// <summary>Active users for pickers (drivers, technicians, staff filter). Available to anyone signed in.</summary>
    public Task<IReadOnlyList<User>> ActiveStaffAsync(string? roleCode = null) =>
        db.QueryAsync<User>("""
            select u.id, u.username, u.full_name, u.mobile, r.code as role_code, r.name as role_name from users u join roles r on r.id = u.role_id
            where u.is_active and not u.is_deleted and (@roleCode::text is null or r.code = @roleCode) order by u.full_name
            """, new { roleCode });

    public async Task<long> SaveAsync(User u, string? newPassword)
    {
        session.Demand(Perm.UserManage);
        await using var probe = await db.OpenAsync();
        var s = await SettingsService.LoadAsync(probe, null);
        if (u.Id == 0) AuthService.ValidateNew(u.Username, u.FullName, newPassword ?? "", s.Security.MinPasswordLength);
        else if (!string.IsNullOrEmpty(newPassword) && PasswordHasher.CheckPolicy(newPassword, s.Security.MinPasswordLength) is { } err)
            throw new ValidationException("Password", err);
        new ValidationBuilder()
            .Require(u.FullName, nameof(u.FullName), "Full name")
            .Check(u.RoleId > 0, nameof(u.RoleId), "Select a role.")
            .Optional(u.Mobile, Validators.IsValidMobile, nameof(u.Mobile), "Mobile number is not valid.")
            .Optional(u.Email, Validators.IsValidEmail, nameof(u.Email), "Email is not valid.")
            .Check(u.CommissionPercent is >= 0 and <= 100, nameof(u.CommissionPercent), "Commission must be 0–100%.")
            .ThrowIfInvalid();

        return await db.InTransactionAsync(async (conn, tx) =>
        {
            if (await conn.ExecuteScalarAsync<int>("select count(*) from users where lower(username) = lower(@Username) and id <> @Id", u, tx) > 0)
                throw new ValidationException("Username", "This username is taken.");
            if (u.Id == 0)
            {
                u.Id = await conn.ExecuteScalarAsync<long>("""
                    insert into users (username, full_name, mobile, email, role_id, password_hash, must_change_password, is_active, commission_percent)
                    values (@Username, @FullName, @Mobile, @Email, @RoleId, @hash, true, @IsActive, @CommissionPercent) returning id
                    """, new { Username = u.Username.Trim(), u.FullName, u.Mobile, u.Email, u.RoleId, hash = PasswordHasher.Hash(newPassword!), u.IsActive, u.CommissionPercent }, tx);
                await audit.LogAsync(conn, tx, "CREATE", "Employees", $"created user {u.Username}", "user", u.Id, u.Username, null, new { u.Username, u.FullName, u.RoleId });
            }
            else
            {
                var old = await conn.QuerySingleAsync<User>("select * from users where id = @Id for update", u, tx);
                if (old.Id == session.UserId && (!u.IsActive || old.RoleId != u.RoleId))
                    throw new BusinessRuleException("You cannot disable yourself or change your own role.");
                await EnsureAdminRemainsAsync(conn, tx, u.Id, u.RoleId, u.IsActive);
                await conn.ExecuteAsync("""
                    update users set full_name=@FullName, mobile=@Mobile, email=@Email, role_id=@RoleId, is_active=@IsActive, commission_percent=@CommissionPercent, updated_at=now() where id=@Id
                    """, u, tx);
                if (!string.IsNullOrEmpty(newPassword))
                    await conn.ExecuteAsync("""
                        update users set password_hash = @h, must_change_password = true, password_changed_at = now(), failed_login_count = 0, locked_until = null
                        where id = @Id
                        """, new { h = PasswordHasher.Hash(newPassword), u.Id }, tx);
                await audit.LogAsync(conn, tx, "UPDATE", "Employees", $"updated user {old.Username}{(string.IsNullOrEmpty(newPassword) ? "" : " and reset the password")}",
                    "user", u.Id, old.Username, new { old.FullName, old.RoleId, old.IsActive }, new { u.FullName, u.RoleId, u.IsActive });
            }
            return u.Id;
        });
    }

    private static async Task EnsureAdminRemainsAsync(Npgsql.NpgsqlConnection conn, Npgsql.NpgsqlTransaction tx, long userId, long newRoleId, bool active)
    {
        var admins = await conn.ExecuteScalarAsync<int>("""
            select count(*) from users u join roles r on r.id = u.role_id where r.code = 'ADMIN' and u.is_active and not u.is_deleted and u.id <> @userId
            """, new { userId }, tx);
        var newRoleIsAdmin = await conn.ExecuteScalarAsync<bool>("select code = 'ADMIN' from roles where id = @newRoleId", new { newRoleId }, tx);
        if (admins == 0 && !(newRoleIsAdmin && active)) throw new BusinessRuleException("At least one active admin must remain.");
    }

    public async Task UnlockAsync(long userId)
    {
        session.Demand(Perm.UserManage);
        await db.InTransactionAsync(async (conn, tx) =>
        {
            var name = await conn.ExecuteScalarAsync<string>("update users set failed_login_count = 0, locked_until = null where id = @userId returning username", new { userId }, tx);
            await audit.LogAsync(conn, tx, "UNLOCK", "Employees", $"unlocked user {name}", "user", userId, name);
        });
    }

    public async Task DeleteAsync(long userId)
    {
        session.Demand(Perm.UserManage);
        if (userId == session.UserId) throw new BusinessRuleException("You cannot delete your own account.");
        await db.InTransactionAsync(async (conn, tx) =>
        {
            await EnsureAdminRemainsAsync(conn, tx, userId, 0, false);
            var name = await conn.ExecuteScalarAsync<string>("update users set is_deleted = true, is_active = false, updated_at = now() where id = @userId returning username", new { userId }, tx);
            await audit.LogAsync(conn, tx, "DELETE", "Employees", $"deleted user {name}", "user", userId, name);
        });
    }

    // ------------------------------------------------------------------ roles
    public Task<IReadOnlyList<Role>> RolesAsync() =>
        db.QueryAsync<Role>("select r.*, (select count(*) from users u where u.role_id = r.id and not u.is_deleted) as user_count from roles r order by r.id");

    public Task<IReadOnlyList<PermissionInfo>> PermissionsAsync() => db.QueryAsync<PermissionInfo>("select * from permissions order by module, code");

    public async Task<IReadOnlyList<string>> RolePermissionsAsync(long roleId) =>
        await db.QueryAsync<string>("select permission_code from role_permissions where role_id = @roleId", new { roleId });

    public async Task<long> SaveRoleAsync(Role role, IReadOnlyCollection<string> permissions)
    {
        session.Demand(Perm.RoleManage);
        if (string.IsNullOrWhiteSpace(role.Name)) throw new ValidationException("Name", "Enter the role name.");
        return await db.InTransactionAsync(async (conn, tx) =>
        {
            if (role.Id == 0)
            {
                var code = new string(role.Name.ToUpperInvariant().Where(char.IsLetterOrDigit).ToArray());
                if (code.Length == 0) code = "ROLE";
                code = code[..Math.Min(code.Length, 20)] + "_" + DateTime.Now.ToString("HHmmss");
                role.Id = await conn.ExecuteScalarAsync<long>("insert into roles (code, name, description) values (@code, @Name, @Description) returning id",
                    new { code, role.Name, role.Description }, tx);
            }
            else
            {
                var code = await conn.ExecuteScalarAsync<string>("select code from roles where id = @Id for update", role, tx);
                if (code == "ADMIN" && !permissions.Contains(Perm.RoleManage)) throw new BusinessRuleException("The Admin role must keep 'Manage roles'.");
                await conn.ExecuteAsync("update roles set name = @Name, description = @Description where id = @Id", role, tx);
            }
            var old = (await conn.QueryAsync<string>("select permission_code from role_permissions where role_id = @Id", role, tx)).ToHashSet();
            await conn.ExecuteAsync("delete from role_permissions where role_id = @Id", role, tx);
            foreach (var p in permissions.Distinct())
                await conn.ExecuteAsync("insert into role_permissions (role_id, permission_code) values (@Id, @p)", new { role.Id, p }, tx);
            var added = permissions.Except(old).ToList();
            var removed = old.Except(permissions).ToList();
            await audit.LogAsync(conn, tx, "PERMISSIONS", "Employees", $"changed permissions of role {role.Name} (+{added.Count} / −{removed.Count})",
                "role", role.Id, role.Name, new { removed }, new { added });
            return role.Id;
        });
    }

    public async Task DeleteRoleAsync(long roleId)
    {
        session.Demand(Perm.RoleManage);
        await db.InTransactionAsync(async (conn, tx) =>
        {
            var r = await conn.QuerySingleAsync<Role>("select * from roles where id = @roleId for update", new { roleId }, tx);
            if (r.IsSystem) throw new BusinessRuleException("Built-in roles cannot be deleted.");
            if (await conn.ExecuteScalarAsync<int>("select count(*) from users where role_id = @roleId", new { roleId }, tx) > 0)
                throw new BusinessRuleException("Users (including deleted users kept for history) still have this role. Move them to another role first.");
            await conn.ExecuteAsync("delete from roles where id = @roleId", new { roleId }, tx);
            await audit.LogAsync(conn, tx, "DELETE", "Employees", $"deleted role {r.Name}", "role", roleId, r.Name);
        });
    }
}
