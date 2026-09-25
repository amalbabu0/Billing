using Dapper;
using FurniShop.Core;
using Npgsql;

namespace FurniShop.Infrastructure.Services;

/// <summary>
/// Gap-free document numbers (INV-2026-0001). The sequence row is locked for the rest of the
/// transaction, so a rolled-back sale never consumes a number and two tills never get the same one.
/// When the calendar year changes, year-based series restart at 1.
/// </summary>
public static class SequenceService
{
    public static async Task<string> NextAsync(NpgsqlConnection conn, NpgsqlTransaction tx, string docType, DateTime? documentDate = null)
    {
        var row = await conn.QuerySingleOrDefaultAsync<(string Prefix, bool IncludeYear, int Padding, long NextNumber, int? CurrentYear)>(
            "select prefix, include_year, padding, next_number, current_year from document_sequences where doc_type = @docType for update",
            new { docType }, tx) ;
        if (row.Prefix is null) throw new BusinessRuleException($"Numbering for {docType} is not configured.");

        var year = (documentDate ?? DateTime.Today).Year;
        var next = row.NextNumber;
        if (row.IncludeYear && row.CurrentYear.HasValue && row.CurrentYear.Value != year && year > row.CurrentYear.Value)
            next = 1;

        await conn.ExecuteAsync("update document_sequences set next_number = @n, current_year = @year where doc_type = @docType",
            new { n = next + 1, year, docType }, tx);
        return Format(row.Prefix, row.IncludeYear, year, row.Padding, next);
    }

    public static string Format(string prefix, bool includeYear, int year, int padding, long number) =>
        includeYear ? $"{prefix}-{year}-{number.ToString().PadLeft(padding, '0')}" : $"{prefix}-{number.ToString().PadLeft(padding, '0')}";
}
