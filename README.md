# Palworld Server Dashboard

A dependency-free Node.js dashboard for a Palworld dedicated server. It starts in demo mode so you can explore the dashboard without a running server. Set `PALWORLD_DEMO_MODE=false` to proxy requests to a real Palworld REST API. Node proxies browser requests server-side, so the admin password is never sent to the browser.

## Demo mode

Demo mode runs without a Palworld process or REST API. Start it explicitly with:

```sh
PALWORLD_DEMO_MODE=true npm start
```

The dashboard exposes sample status, player, and metric data. For settings, it uses the configured `PALWORLD_SETTINGS_PATH` when the file exists, while still avoiding all Palworld REST API and process calls. Edits to `PalWorldSettings.ini` are staged and written after the mock shutdown delay completes. If `PALWORLD_SETTINGS_PATH` is empty or the file does not exist, the dashboard reports that the Palworld configuration is unavailable. Demo mode disables the automatic scheduler and never contacts Palworld.

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

The dashboard also reads the live `PalWorldSettings.ini` file and shows its `OptionSettings` values in the dashboard. `PALWORLD_SETTINGS_PATH` can be customized when the server uses a non-default location; the default follows the server working directory and platform-specific `WindowsServer` or `LinuxServer` folder. Password-like settings are redacted in the browser. Existing settings can be edited and staged from the dashboard; they are written only after Palworld is confirmed to have shut down, so the server cannot overwrite the changes afterward.

The current schedule is available at `/api/schedule`. The dashboard does not start the scheduler unless explicitly enabled, and it checks the REST API before starting to avoid launching a duplicate server. Use Windows Task Scheduler or a Windows service to start `npm start` at boot if the schedule must survive reboots.

### Discord notifications

Create a Discord channel webhook and add it to `.env`:

```env
DISCORD_WEBHOOK_URL=https://discord.com/api/webhooks/your-webhook-id/your-webhook-token
DISCORD_WEBHOOK_USERNAME=Palworld Server
```

Notifications are sent for server startup and at 10 minutes, 5 minutes, and 30 seconds before scheduled or dashboard-triggered shutdowns. Keep the webhook URL private; anyone with it can post to the channel. Notifications are skipped when the URL is empty.
