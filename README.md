# Palworld Server Dashboard

This project is entirely AI generated.

A dependency-free Node.js dashboard for a Palworld dedicated server. It starts in demo mode so you can explore the dashboard without a running server. Set `PALWORLD_DEMO_MODE=false` to proxy requests to a real Palworld REST API. Node proxies browser requests server-side, so the admin password is never sent to the browser.

## Sample Dashboard look and feel
![alt text](https://github.com/wwm-hoitintong/palworld-server-controller/blob/main/dashboard-demo.png)

## Demo mode

Demo mode runs without a Palworld process or REST API. Start it explicitly with:

```sh
PALWORLD_DEMO_MODE=true npm start
```

The dashboard exposes sample status, player, and metric data. For settings, it uses the configured `PALWORLD_SETTINGS_PATH` when the file exists, while still avoiding all Palworld REST API and process calls. Edits to `PalWorldSettings.ini` are staged and written after the mock shutdown delay completes. If `PALWORLD_SETTINGS_PATH` is empty or the file does not exist, the dashboard reports that the Palworld configuration is unavailable. Demo mode disables the automatic scheduler and never contacts Palworld.

## Easy Windows setup

For a first-time Windows installation, double-click `setup.bat` and follow the prompts. The wizard checks Node.js, installs project dependencies, creates `.env`, configures the Palworld paths, and optionally installs/configures rclone for Google Drive backups. It never overwrites an existing `.env` unless you explicitly approve it; an approved replacement creates a timestamped `.env.backup-*` copy first.

If Windows blocks the script, open PowerShell in this project folder and run:

```powershell
Set-ExecutionPolicy -Scope Process Bypass
.\setup.ps1
```

The wizard configures the dashboard but does not start the Palworld server. After it finishes, double-click `start-dashboard.bat` or run `npm start`, then open http://127.0.0.1:3000. The Google Drive step opens rclone's one-time login wizard; sign in with the Google account that should receive the backups.

## Run

1. Copy `.env.example` to `.env` and set `PALWORLD_ADMIN_PASSWORD`.
2. Make sure the Palworld server has its REST API enabled (`RESTAPIEnabled=True`).
3. Start the dashboard:

```sh
npm start
```

Open http://127.0.0.1:3000.

Node 18 or newer is required. The server reads `.env` without an external package.

## Supported operations

The dashboard reads `/v1/api/info`, `/v1/api/players`, and `/v1/api/metrics`. It displays FPS, frame time, players/capacity, uptime, base camps, and in-game days. Refresh can be triggered manually or configured for 10 seconds, 30 seconds, 1 minute, 5 minutes, or disabled. It also reads CPU, memory, and network throughput from the machine running Node.js. On Windows, network totals are collected through PowerShell's `Get-NetAdapterStatistics`; the first network refresh establishes a baseline, so throughput appears from the second refresh onward. It proxies announce, kick, ban, save, and shutdown actions to the matching Palworld REST API endpoints. The dashboard asks for a manual shutdown delay in minutes and converts it to seconds for the REST API.

Keep this dashboard bound to localhost or place it behind authentication and HTTPS before exposing it to a network. The Palworld documentation warns that its REST API should not be exposed directly to the internet.

## Automatic schedule

The built-in scheduler is disabled by default. To enable it, set `PALWORLD_SCHEDULE_ENABLED=true`, configure the Palworld executable path and daily time windows, and keep the Node dashboard running. Each dashboard start schedules a random start within `PALWORLD_START_WINDOW` and a random graceful REST shutdown within `PALWORLD_STOP_WINDOW`, using the Windows machine's local time. If the dashboard starts after a window, that event is scheduled for the next day.

```env
PALWORLD_DEMO_MODE=false
PALWORLD_SCHEDULE_ENABLED=true
PALWORLD_START_WINDOW=19:30-20:30
PALWORLD_STOP_WINDOW=01:00-01:30
PALWORLD_SERVER_COMMAND=C:\PalServer\PalServer.exe
PALWORLD_SERVER_CWD=C:\PalServer
PALWORLD_SETTINGS_PATH=C:\PalServer\Pal\Saved\Config\WindowsServer\PalWorldSettings.ini
PALWORLD_SERVER_ARGS_JSON=[]
```

The dashboard also reads the live `PalWorldSettings.ini` file and shows its `OptionSettings` values in the dashboard. `PALWORLD_SETTINGS_PATH` must point to the settings file; if it is not configured, the settings section is unavailable. Password-like settings are redacted in the browser. Existing settings can be edited and staged from the dashboard; they are written only after Palworld is confirmed to have shut down, so the server cannot overwrite the changes afterward.

## Automatic Google Drive backups

The dashboard can automatically back up the Palworld save directory after every manual or scheduled shutdown. The backup starts only after the REST API confirms that Palworld is offline, so the save files are no longer being written. Backups are timestamped folders and use `rclone copy`, so a later local deletion does not remove older Google Drive snapshots.

Install and configure [rclone](https://rclone.org/drive/), then create a Google Drive remote:

```sh
brew install rclone
rclone config
rclone lsd gdrive:
```

Set these values in `.env`:

```env
PALWORLD_BACKUP_ENABLED=true
PALWORLD_SAVE_PATH=C:\PalServer\Pal\Saved\SaveGames
PALWORLD_BACKUP_REMOTE=gdrive:palworld-backups
RCLONE_COMMAND=rclone
PALWORLD_BACKUP_TIMEOUT_MS=600000
```

The remote name (`gdrive` above) and destination folder must match your rclone configuration. The dashboard never receives or stores Google credentials; rclone handles authentication. In demo mode, Palworld is not contacted, but a configured save path and rclone remote can still be tested with the mock shutdown flow. Backups do not run if the dashboard process is terminated before shutdown finalization completes.

When `PALWORLD_BACKUP_ENABLED=true`, a **manual** Start server action checks the timestamped backups in the configured rclone remote. If a backup contains files newer than the local save files, the dashboard asks whether to load it before starting Palworld. An accepted restore first downloads the backup to a temporary directory and keeps the previous local save in a `.before-restore-*` folder. If the backup check fails, the server starts with the local save and displays a warning. Scheduled starts do not perform this check or restore prompt; they use the existing automatic start behavior unchanged.

Google Drive should not be the only backup. For a stronger 3-2-1 setup, keep a second copy on an external disk or NAS, using a separate rclone remote or a scheduled `restic` backup.

The current schedule is available at `/api/schedule`. The dashboard does not start the scheduler unless explicitly enabled, and it checks the REST API before starting to avoid launching a duplicate server. Use Windows Task Scheduler or a Windows service to start `npm start` at boot if the schedule must survive reboots.

### Discord notifications

Create a Discord channel webhook and add it to `.env`:

```env
DISCORD_WEBHOOK_URL=https://discord.com/api/webhooks/your-webhook-id/your-webhook-token
DISCORD_WEBHOOK_USERNAME=Palworld Server
```

Notifications are sent for server startup and at 10 minutes, 5 minutes, and 30 seconds before scheduled or dashboard-triggered shutdowns. Keep the webhook URL private; anyone with it can post to the channel. Notifications are skipped when the URL is empty.
