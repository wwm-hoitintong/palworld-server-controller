import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const srcDir = dirname(fileURLToPath(import.meta.url));
const projectRoot = join(srcDir, '..');
const publicDir = join(srcDir, 'public');

const loadEnv = () => {
    try {
        const text = readFileSync(join(projectRoot, '.env'), 'utf8');
        for (const line of text.split(/\r?\n/)) {
            const match = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
            if (match && !process.env[match[1]]) process.env[match[1]] = match[2].replace(/^['"]|['"]$/g, '');
        }
    } catch {
        // .env is optional; use process environment values instead.
    }
}

const parseArgs = (value) => {
    if (!value) return [];
    try {
        const args = JSON.parse(value);
        return Array.isArray(args) ? args.map(String) : [];
    } catch {
        throw new Error('PALWORLD_SERVER_ARGS_JSON must be a JSON array');
    }
}

const parseWindow = (value, fallback) => {
    if (!value) return fallback;
    const parts = value.split('-').map((part) => part.trim());
    return parts.length === 2 && parts.every(Boolean) ? parts : fallback;
}

loadEnv();

const config = {
    host: process.env.HOST || '127.0.0.1',
    port: Number(process.env.PORT || 3000),
    apiUrl: (process.env.PALWORLD_API_URL || '').replace(/\/$/, ''),
    username: process.env.PALWORLD_ADMIN_USERNAME || 'admin',
    password: process.env.PALWORLD_ADMIN_PASSWORD || '',
    demoMode: process.env.PALWORLD_DEMO_MODE !== 'false' || false,
    scheduleEnabled: process.env.PALWORLD_SCHEDULE_ENABLED === 'true',
    serverCommand: process.env.PALWORLD_SERVER_COMMAND || '',
    serverArgs: parseArgs(process.env.PALWORLD_SERVER_ARGS_JSON),
    serverCwd: process.env.PALWORLD_SERVER_CWD || '',
    discordWebhookUrl: process.env.DISCORD_WEBHOOK_URL || '',
    discordUsername: process.env.DISCORD_WEBHOOK_USERNAME || 'Palworld Server Bot',
    startWindow: parseWindow(process.env.PALWORLD_START_WINDOW, ['19:30', '20:30']),
    stopWindow: parseWindow(process.env.PALWORLD_STOP_WINDOW, ['01:00', '01:30'])
};

const endpoints = {
    info: { method: 'GET', path: '/v1/api/info' },
    players: { method: 'GET', path: '/v1/api/players' },
    metrics: { method: 'GET', path: '/v1/api/metrics' },
    announce: { method: 'POST', path: '/v1/api/announce' },
    kick: { method: 'POST', path: '/v1/api/kick' },
    ban: { method: 'POST', path: '/v1/api/ban' },
    save: { method: 'POST', path: '/v1/api/save' },
    shutdown: { method: 'POST', path: '/v1/api/shutdown' }
};

const demoStatus = {
    demo: true,
    info: { version: 'v0.1.0-demo', servername: 'Aurelia Valley', description: 'A sample world for exploring the dashboard' },
    players: { numplayers: 2, players: [{ name: 'LamballKeeper', userid: 'demo-player-1' }, { name: 'FoxparksFan', userid: 'demo-player-2' }] },
    metrics: { serverfps: 60, serverframetime: 16.7, currentplayernum: 2, maxplayernum: 32, uptime: 86400 * 2 + 7200, basecampnum: 4, days: 12 }
};

export { config, demoStatus, endpoints, projectRoot, publicDir };
