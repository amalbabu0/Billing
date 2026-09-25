using System.Security.Cryptography;
using Dapper;
using FurniShop.Core;
using FurniShop.Core.Domain;
using FurniShop.Infrastructure.Database;
using FurniShop.Infrastructure.Security;
using Npgsql;

namespace FurniShop.Infrastructure.Services;

/// <summary>
/// Stores images / PDFs in the database (small files: logo, product photos, reference images,
/// delivery signatures and photos). Uploads are validated by size and by the file's actual
/// signature bytes — never by the extension alone.
/// </summary>
public sealed class AttachmentService(Db db, UserSession session)
{
    public const int MaxBytes = 5 * 1024 * 1024;

    public static string DetectContentType(byte[] data)
    {
        if (data.Length >= 8 && data[0] == 0x89 && data[1] == 0x50 && data[2] == 0x4E && data[3] == 0x47) return "image/png";
        if (data.Length >= 3 && data[0] == 0xFF && data[1] == 0xD8 && data[2] == 0xFF) return "image/jpeg";
        if (data.Length >= 5 && data[0] == 0x25 && data[1] == 0x50 && data[2] == 0x44 && data[3] == 0x46 && data[4] == 0x2D) return "application/pdf";
        throw new ValidationException("File", "Only PNG, JPEG images and PDF files are allowed.");
    }

    internal async Task<long> SaveAsync(NpgsqlConnection conn, NpgsqlTransaction tx, byte[] data, string fileName, string ownerType, long? ownerId, string purpose)
    {
        if (data.Length == 0) throw new ValidationException("File", "The file is empty.");
        if (data.Length > MaxBytes) throw new ValidationException("File", "The file is larger than 5 MB.");
        var type = DetectContentType(data);
        var safeName = Path.GetFileName(fileName);
        if (safeName.Length > 120) safeName = safeName[^120..];
        return await conn.ExecuteScalarAsync<long>("""
            insert into attachments (owner_type, owner_id, purpose, file_name, content_type, size_bytes, sha256, data, created_by)
            values (@ownerType, @ownerId, @purpose, @safeName, @type, @len, @sha, @data, @uid) returning id
            """, new { ownerType, ownerId, purpose, safeName, type, len = data.Length, sha = Convert.ToHexString(SHA256.HashData(data)), data, uid = session.UserId }, tx);
    }

    public async Task<long> SaveAsync(byte[] data, string fileName, string ownerType, long? ownerId, string purpose)
    {
        if (!session.IsAuthenticated) throw new PermissionDeniedException("not signed in");
        return await db.InTransactionAsync(async (conn, tx) => await SaveAsync(conn, tx, data, fileName, ownerType, ownerId, purpose));
    }

    public async Task<(AttachmentInfo Info, byte[] Data)?> GetAsync(long id)
    {
        await using var conn = await db.OpenAsync();
        var info = await conn.QuerySingleOrDefaultAsync<AttachmentInfo>("select id, owner_type, owner_id, purpose, file_name, content_type, size_bytes, created_at from attachments where id = @id", new { id });
        if (info is null) return null;
        var data = await conn.ExecuteScalarAsync<byte[]>("select data from attachments where id = @id", new { id });
        return (info, data!);
    }
}
