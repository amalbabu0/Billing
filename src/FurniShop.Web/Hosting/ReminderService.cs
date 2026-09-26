using FurniShop.Infrastructure;
using FurniShop.Infrastructure.Database;
using FurniShop.Infrastructure.Security;

namespace FurniShop.Web.Hosting;

/// <summary>
/// Runs the in-app reminder generator on a timer (overdue payments, follow-ups, expiring warranties, service visits,
/// raw materials to reorder, open cash registers, backups). Each reminder is de-duplicated per day in SQL, so running
/// hourly is safe. Reminders are in-app notifications only — nothing is sent outside the shop.
/// Disable with Reminders:Enabled=false.
/// </summary>
public sealed class ReminderService(Db db, IConfiguration config, ILogger<ReminderService> log) : BackgroundService
{
    protected override async Task ExecuteAsync(CancellationToken stop)
    {
        if (!config.GetValue("Reminders:Enabled", true)) return;
        var interval = TimeSpan.FromMinutes(Math.Clamp(config.GetValue("Reminders:IntervalMinutes", 60), 5, 24 * 60));
        try { await Task.Delay(TimeSpan.FromMinutes(1), stop); } catch (OperationCanceledException) { return; }
        while (!stop.IsCancellationRequested)
        {
            try
            {
                await using var app = new AppServices(db, new UserSession());
                await app.Notifications.GenerateDailyAsync();
            }
            catch (Exception ex) when (ex is not OperationCanceledException)
            {
                log.LogWarning(ex, "Reminder generation failed; will retry at the next interval");
            }
            try { await Task.Delay(interval, stop); } catch (OperationCanceledException) { return; }
        }
    }
}
