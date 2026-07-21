import http from 'node:http';
import { config, demoStatus, endpoints, publicDir } from './config.js';
import { createHostMetrics } from './host-metrics.js';
import { createNotifications } from './notifications.js';
import { createPalworldClient } from './palworld-client.js';
import { createPalworldProcess } from './palworld-process.js';
import { createPalworldSettings } from './palworld-settings.js';
import { createRequestHandler } from './routes.js';
import { createShutdownController } from './shutdown-controller.js';
import { createScheduler } from './scheduler.js';

const client = createPalworldClient({ config, endpoints });
const hostMetrics = createHostMetrics();
const notifications = createNotifications({
    config,
    announceInGame: (message) => client.call(endpoints.announce, { message })
});
const processManager = createPalworldProcess({ config, endpoints, client });
const palworldSettings = createPalworldSettings({ config });
const shutdownController = createShutdownController({ announceShutdown: notifications.announceShutdown });

const scheduler = createScheduler({
    enabled: config.scheduleEnabled && !config.demoMode,
    startWindow: config.startWindow,
    stopWindow: config.stopWindow,
    startServer: processManager.start,
    stopServer: processManager.stop,
    announceStarted: notifications.announceStarted,
    announceShutdown: notifications.announceShutdown,
    onError: (message) => console.error(message)
});
scheduler.start();

const scheduleStatus = scheduler.getStatus();
console.log(scheduleStatus.enabled
    ? `Automatic scheduler enabled. Next start: ${scheduleStatus.nextStart}; next stop: ${scheduleStatus.nextStop}`
    : 'Automatic scheduler disabled.');

const requestHandler = createRequestHandler({
    config,
    endpoints,
    demoStatus,
    publicDir,
    client,
    hostMetrics,
    processManager,
    notifications,
    scheduler,
    palworldSettings,
    shutdownController
});

const server = http.createServer(requestHandler);
server.listen(config.port, config.host, () => {
    console.log(`Palworld dashboard running at http://${config.host}:${config.port}`);
    console.log(`Palworld REST API: ${config.apiUrl}`);
});
