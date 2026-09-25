using System.Diagnostics;
using System.IO;
using FurniShop.Infrastructure;
using FurniShop.Wpf.ViewModels;
using Microsoft.Win32;

namespace FurniShop.Wpf.Services;

/// <summary>Application-wide singletons.</summary>
public static class AppHost
{
    public static AppServices App { get; set; } = null!;
    public static ShellViewModel Shell { get; set; } = null!;

    public static void OpenExternal(string target)
    {
        try
        {
            Process.Start(new ProcessStartInfo(target) { UseShellExecute = true });
        }
        catch (Exception ex)
        {
            Shell?.Toast.Error($"Could not open {target}: {ex.Message}");
        }
    }

    public static void ShowInFolder(string path) => OpenExternal(Path.GetDirectoryName(path)!);

    /// <summary>Asks where to save; returns null when cancelled.</summary>
    public static string? AskSavePath(string suggestedName, string filter)
    {
        var dlg = new SaveFileDialog { FileName = suggestedName, Filter = filter, AddExtension = true };
        return dlg.ShowDialog() == true ? dlg.FileName : null;
    }

    public static string? AskOpenPath(string filter)
    {
        var dlg = new OpenFileDialog { Filter = filter, CheckFileExists = true };
        return dlg.ShowDialog() == true ? dlg.FileName : null;
    }
}
