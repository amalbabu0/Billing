using FurniShop.Core.Domain;
using FurniShop.Infrastructure.Database;

namespace FurniShop.Infrastructure.Services;

/// <summary>Status timeline of any document kept in <c>status_history</c>.</summary>
public static class History
{
    public static Task<IReadOnlyList<StatusHistoryEntry>> ForAsync(Db db, string docType, long id) =>
        db.QueryAsync<StatusHistoryEntry>("""
            select h.*, u.full_name as changed_by_name from status_history h left join users u on u.id = h.changed_by
            where h.doc_type = @docType and h.doc_id = @id order by h.changed_at, h.id
            """, new { docType, id });
}
