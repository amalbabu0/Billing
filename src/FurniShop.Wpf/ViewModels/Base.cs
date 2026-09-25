using System.Collections.ObjectModel;
using System.Data;
using System.IO;
using System.Net.Sockets;
using CommunityToolkit.Mvvm.ComponentModel;
using CommunityToolkit.Mvvm.Input;
using FurniShop.Core;
using FurniShop.Core.Domain;
using FurniShop.Core.Security;
using FurniShop.Infrastructure;
using FurniShop.Infrastructure.Documents;
using FurniShop.Wpf.Services;
using Npgsql;

namespace FurniShop.Wpf.ViewModels;

/// <summary>
/// Base for every view model: busy state and one consistent error-handling path.
/// Validation errors are shown next to the fields (Errors) and as a toast; business-rule and
/// permission errors are toasts; connection problems get a friendly message; everything else is logged.
/// </summary>
public abstract partial class ViewModelBase : ObservableObject
{
    protected static AppServices App => AppHost.App;
    protected static ShellViewModel Shell => AppHost.Shell;

    [ObservableProperty] private bool _isBusy;
    [ObservableProperty] private string? _errorMessage;
    [ObservableProperty] private Dictionary<string, string> _errors = new();

    public bool Can(string permission) => App.Session.Has(permission);
    public bool CanSeeCost => App.Session.CanSeeCost;

    protected async Task<bool> RunAsync(Func<Task> work, string? successMessage = null, bool showBusy = true)
    {
        if (showBusy) IsBusy = true;
        ErrorMessage = null;
        Errors = new Dictionary<string, string>();
        try
        {
            await work();
            if (successMessage is not null) Shell.Toast.Success(successMessage);
            return true;
        }
        catch (Exception ex)
        {
            HandleError(ex);
            return false;
        }
        finally
        {
            if (showBusy) IsBusy = false;
        }
    }

    public void HandleError(Exception ex)
    {
        switch (ex)
        {
            case ValidationException v:
                Errors = v.Errors.ToDictionary(k => k.Key, k => k.Value);
                ErrorMessage = v.Message;
                Shell.Toast.Error(v.Errors.Count == 1 ? v.Message : "Please correct the highlighted fields.");
                break;
            case BusinessRuleException b:
                ErrorMessage = b.Message;
                Shell.Toast.Error(b.Message);
                break;
            case PermissionDeniedException p:
                ErrorMessage = p.Message;
                Shell.Toast.Error(p.Permission.Contains(':') ? p.Permission.Split(':', 2)[1].Trim() : p.Message);
                break;
            case NotFoundException nf:
                ErrorMessage = nf.Message;
                Shell.Toast.Error(nf.Message);
                break;
            case NpgsqlException { InnerException: SocketException or IOException or TimeoutException } or SocketException or TimeoutException:
                ErrorMessage = "Cannot reach the database. Check the internet connection and try again.";
                Shell.Toast.Error(ErrorMessage);
                ConnectionStore.LogError(ex);
                break;
            case PostgresException pg when pg.SqlState == "23505":
                ErrorMessage = "This record already exists (duplicate).";
                Shell.Toast.Error(ErrorMessage);
                break;
            case PostgresException pg:
                ErrorMessage = $"The database rejected the change: {pg.MessageText}";
                Shell.Toast.Error(ErrorMessage);
                ConnectionStore.LogError(ex);
                break;
            default:
                ErrorMessage = "Something went wrong. The details were saved to the error log.";
                Shell.Toast.Error($"{ErrorMessage} ({ex.Message})");
                ConnectionStore.LogError(ex);
                break;
        }
    }

    public string? ErrorFor(string field) => Errors.TryGetValue(field, out var e) ? e : null;
}

/// <summary>A screen shown in the shell's content area.</summary>
public abstract partial class PageViewModel : ViewModelBase
{
    [ObservableProperty] private string _title = "";
    [ObservableProperty] private string? _subtitle;

    /// <summary>Called by the shell after navigation. Loading errors are handled here.</summary>
    public virtual Task LoadAsync() => Task.CompletedTask;

    [RelayCommand]
    protected virtual Task RefreshAsync() => RunAsync(LoadAsync);
}

public sealed record Option(string? Value, string Label)
{
    public override string ToString() => Label;
}

public sealed record ExportColumn<T>(string Header, Func<T, object?> Value);

/// <summary>
/// Paged, searchable, filterable, sortable list with CSV / Excel / PDF export.
/// Subclasses supply <see cref="FetchAsync"/> and the export columns.
/// </summary>
public abstract partial class ListPageViewModel<T> : PageViewModel, Controls.ISortable
{
    private CancellationTokenSource? _searchDelay;

    public ObservableCollection<T> Items { get; } = new();

    [ObservableProperty] private string? _search;
    [ObservableProperty] private Option? _selectedStatus;
    [ObservableProperty] private DateTime? _fromDate;
    [ObservableProperty] private DateTime? _toDate;
    [ObservableProperty] private int _page = 1;
    [ObservableProperty] private int _pageSize = 50;
    [ObservableProperty] private int _totalCount;
    [ObservableProperty] private int _pageCount = 1;
    [ObservableProperty] private string? _sortBy;
    [ObservableProperty] private bool _sortDescending = true;
    [ObservableProperty] private T? _selected;
    [ObservableProperty] private bool _hasLoaded;

    public IReadOnlyList<Option> StatusOptions { get; protected set; } = Array.Empty<Option>();
    public bool ShowStatusFilter => StatusOptions.Count > 0;
    public virtual bool ShowDateFilter => false;
    public virtual string SearchHint => "Search…";
    public bool IsEmpty => HasLoaded && Items.Count == 0;
    public string PageText => TotalCount == 0 ? "No records" : $"{(Page - 1) * PageSize + 1}–{Math.Min(Page * PageSize, TotalCount)} of {TotalCount}";
    public virtual string EmptyTitle => "Nothing here yet";
    public virtual string EmptyMessage => string.IsNullOrWhiteSpace(Search) ? "Records you create will appear here." : "No records match your search.";

    protected abstract Task<PagedResult<T>> FetchAsync(ListQuery query);
    protected virtual IReadOnlyList<ExportColumn<T>> ExportColumns => Array.Empty<ExportColumn<T>>();
    public bool CanExport => ExportColumns.Count > 0 && Can(Perm.ExportData);

    protected ListQuery BuildQuery(int? page = null, int? pageSize = null) => new()
    {
        Search = Search, Status = SelectedStatus?.Value, From = FromDate, To = ToDate, SortBy = SortBy, SortDescending = SortDescending,
        Page = page ?? Page, PageSize = pageSize ?? PageSize,
    };

    public override async Task LoadAsync()
    {
        var result = await FetchAsync(BuildQuery());
        Items.Clear();
        foreach (var i in result.Items) Items.Add(i);
        TotalCount = result.TotalCount;
        PageCount = result.PageCount;
        HasLoaded = true;
        OnPropertyChanged(nameof(PageText));
        OnPropertyChanged(nameof(IsEmpty));
        OnPropertyChanged(nameof(EmptyMessage));
    }

    protected Task ReloadFirstPageAsync()
    {
        Page = 1;
        return RunAsync(LoadAsync, showBusy: true);
    }

    partial void OnSearchChanged(string? value)
    {
        // debounce typing
        _searchDelay?.Cancel();
        _searchDelay = new CancellationTokenSource();
        var token = _searchDelay.Token;
        Task.Delay(350, token).ContinueWith(_ => { if (!token.IsCancellationRequested) _ = ReloadFirstPageAsync(); },
            token, TaskContinuationOptions.OnlyOnRanToCompletion, TaskScheduler.FromCurrentSynchronizationContext());
    }

    partial void OnSelectedStatusChanged(Option? value) { if (HasLoaded) _ = ReloadFirstPageAsync(); }
    partial void OnFromDateChanged(DateTime? value) { if (HasLoaded) _ = ReloadFirstPageAsync(); }
    partial void OnToDateChanged(DateTime? value) { if (HasLoaded) _ = ReloadFirstPageAsync(); }

    [RelayCommand]
    private Task NextPageAsync()
    {
        if (Page >= PageCount) return Task.CompletedTask;
        Page++;
        return RunAsync(LoadAsync);
    }

    [RelayCommand]
    private Task PrevPageAsync()
    {
        if (Page <= 1) return Task.CompletedTask;
        Page--;
        return RunAsync(LoadAsync);
    }

    [RelayCommand]
    private void ClearFilters()
    {
        HasLoaded = false;
        Search = null; SelectedStatus = StatusOptions.FirstOrDefault(); FromDate = null; ToDate = null;
        HasLoaded = true;
        _ = ReloadFirstPageAsync();
    }

    /// <summary>Called by the DataGrid Sorting event (server-side sort).</summary>
    public void Sort(string? key)
    {
        if (key is null) return;
        SortDescending = SortBy == key ? !SortDescending : false;
        SortBy = key;
        _ = ReloadFirstPageAsync();
    }

    [RelayCommand]
    private void Open(T? item)
    {
        if (item is not null) OnOpen(item);
    }

    protected virtual void OnOpen(T item) { }

    [RelayCommand]
    private Task ExportAsync(string format) => RunAsync(async () =>
    {
        App.Documents.DemandExport();
        var all = await FetchAsync(BuildQuery(1, 100_000));
        var table = DocumentService.ToTable(all.Items, ExportColumns.Select(c => (c.Header, c.Value)).ToArray());
        await ExportTableAsync(table, Title, $"Exported {DateTime.Now:dd-MMM-yyyy HH:mm}", new HashSet<string>(), Array.Empty<(string, string)>(), format);
        await App.Audit.LogAsync("EXPORT", "Export", $"exported {Title} ({all.Items.Count} rows) as {format.ToUpperInvariant()}");
    });

    public static async Task ExportTableAsync(DataTable table, string title, string subtitle, ISet<string> money, IReadOnlyList<(string, string)> totals, string format)
    {
        var baseName = $"{title}-{DateTime.Now:yyyyMMdd-HHmm}";
        byte[] bytes;
        string filter, ext;
        switch (format)
        {
            case "excel":
                bytes = DocumentService.ToExcel(table, title, subtitle, money); filter = "Excel workbook|*.xlsx"; ext = ".xlsx"; break;
            case "pdf":
                bytes = await App.Documents.ToPdfAsync(table, title, subtitle, money, totals); filter = "PDF|*.pdf"; ext = ".pdf"; break;
            default:
                bytes = DocumentService.ToCsv(table, money); filter = "CSV|*.csv"; ext = ".csv"; break;
        }
        var path = AppHost.AskSavePath(baseName + ext, filter);
        if (path is null) return;
        await File.WriteAllBytesAsync(path, bytes);
        Shell.Toast.Success($"Saved {Path.GetFileName(path)}", () => AppHost.OpenExternal(path));
    }
}
