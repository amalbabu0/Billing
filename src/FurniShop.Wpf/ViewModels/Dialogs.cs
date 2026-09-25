using CommunityToolkit.Mvvm.ComponentModel;
using CommunityToolkit.Mvvm.Input;

namespace FurniShop.Wpf.ViewModels;

/// <summary>A modal dialog shown in the shell overlay. Completes with true (OK) or false (cancel).</summary>
public abstract partial class DialogViewModel : ViewModelBase
{
    private readonly TaskCompletionSource<bool> _tcs = new();

    [ObservableProperty] private string _dialogTitle = "";
    public virtual double DialogWidth => 520;
    public virtual string AcceptText => "Save";
    public virtual bool ShowFooter => true;
    public virtual bool IsAcceptDanger => false;

    /// <summary>Runs <see cref="InitAsync"/> with the standard error handling.</summary>
    public Task StartAsync() => RunAsync(InitAsync);
    public Task<bool> Result => _tcs.Task;
    public event EventHandler? Closed;

    protected void Close(bool ok)
    {
        _tcs.TrySetResult(ok);
        Closed?.Invoke(this, EventArgs.Empty);
    }

    [RelayCommand]
    private void Cancel() => Close(false);

    /// <summary>OK button: runs the save work; closes only when it succeeds.</summary>
    [RelayCommand]
    private async Task AcceptAsync()
    {
        if (IsBusy) return;
        if (await RunAsync(OnAcceptAsync)) Close(true);
    }

    protected virtual Task OnAcceptAsync() => Task.CompletedTask;

    /// <summary>Called once the dialog is shown (load data here).</summary>
    public virtual Task InitAsync() => Task.CompletedTask;
}

public sealed partial class ConfirmDialogViewModel : DialogViewModel
{
    public ConfirmDialogViewModel(string title, string message, string confirmText, bool danger, bool requireReason)
    {
        DialogTitle = title; Message = message; ConfirmText = confirmText; IsDanger = danger; RequireReason = requireReason;
    }

    public string Message { get; }
    public string ConfirmText { get; }
    public bool IsDanger { get; }
    public bool RequireReason { get; }
    public override double DialogWidth => 460;
    public override string AcceptText => ConfirmText;
    public override bool IsAcceptDanger => IsDanger;
    [ObservableProperty] private string? _reason;

    protected override Task OnAcceptAsync()
    {
        if (RequireReason && string.IsNullOrWhiteSpace(Reason))
            throw new Core.ValidationException("Reason", "Please enter a reason.");
        return Task.CompletedTask;
    }
}

public sealed partial class ChangePasswordDialogViewModel : DialogViewModel
{
    public ChangePasswordDialogViewModel(bool forced)
    {
        Forced = forced;
        DialogTitle = forced ? "Set a new password" : "Change password";
    }

    public override string AcceptText => "Change password";

    public bool Forced { get; }
    public string Hint => Forced ? "For security you must choose a new password before continuing." : "Choose a strong password with letters and numbers.";
    public string Current { get; set; } = "";
    public string NewPassword { get; set; } = "";
    public string Confirm { get; set; } = "";

    protected override async Task OnAcceptAsync()
    {
        if (NewPassword != Confirm) throw new Core.ValidationException("Confirm", "The new passwords do not match.");
        await App.Auth.ChangePasswordAsync(Current, NewPassword);
        Shell.Toast.Success("Password changed.");
    }
}
