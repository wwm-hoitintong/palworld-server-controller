import { readFile } from 'node:fs/promises';
import { extname, isAbsolute, join, normalize, relative } from 'node:path';

const isDemoAction = (action, config, endpoints) => config.demoMode && endpoints[action]?.method === 'POST';

const readJson = async (request) => {
    let body = '';
    for await (const chunk of request) body += chunk;
    if (!body) return {};
    if (body.length > 100_000) {
        const error = new Error('Request body is too large');
        error.status = 413;
        throw error;
    }
    try {
        return JSON.parse(body);
    } catch {
        const error = new Error('Request body must be valid JSON');
        error.status = 400;
        throw error;
    }
};

const sendJson = (response, status, data) => {
    response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
    response.end(JSON.stringify(data));
};

const serveStatic = async (response, pathname, publicDir) => {
    const requested = pathname === '/' ? '/index.html' : pathname;
    const file = normalize(join(publicDir, requested));
    const fileRelative = relative(publicDir, file);
    if (fileRelative.startsWith('..') || isAbsolute(fileRelative)) return sendJson(response, 404, { error: 'Not found' });
    try {
        const content = await readFile(file);
        const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml' };
        response.writeHead(200, { 'Content-Type': `${types[extname(file)] || 'application/octet-stream'}; charset=utf-8` });
        response.end(content);
    } catch {
        sendJson(response, 404, { error: 'Not found' });
    }
};

const announceStarted = async (notifications) => {
    try {
        await notifications.announceStarted();
    } catch (error) {
        console.error(`Discord startup notice failed: ${error.message}`);
    }
};

const startManualServer = async ({ processManager, notifications, saveBackup }, payload) => {
    let backupCheckWarning = null;
    const hasRestoreDecision = Object.hasOwn(payload, 'restore');
    if (hasRestoreDecision && typeof payload.restore !== 'boolean') throw new Error('restore must be a boolean');

    if (!hasRestoreDecision) {
        try {
            const check = await saveBackup.findNewerSnapshot();
            if (check.newer) return { ok: true, data: { needsRestoreConfirmation: true, restoreCandidate: check.snapshot } };
        } catch (error) {
            backupCheckWarning = 'Automatic backup check failed; starting with the local save.';
            console.error(`[manual-start] backup-check-failed error=${error.message}`);
        }
    }

    let beforeLaunch;
    if (payload.restore === true) {
        if (typeof payload.snapshot !== 'string' || !payload.snapshot) throw new Error('A backup snapshot is required when restore is true');
        beforeLaunch = async () => {
            const check = await saveBackup.findNewerSnapshot();
            if (!check.newer || check.snapshot.name !== payload.snapshot) {
                const error = new Error('The backup changed while you were deciding; no save was restored');
                error.status = 409;
                throw error;
            }
            return saveBackup.restoreSnapshot(check.snapshot);
        };
    }

    const result = await processManager.start(beforeLaunch ? { beforeLaunch } : {});
    if (result.started) await announceStarted(notifications);
    return { ok: true, data: { ...result, ...(backupCheckWarning ? { backupCheckWarning } : {}) } };
};

const getStatus = async ({ config, demoStatus, client, endpoints, hostMetrics, scheduler, palworldSettings, processManager, operations, shutdownController, saveBackup }) => {
    const host = await hostMetrics.safeHostMetrics();
    const schedule = scheduler.getStatus();
    const settings = await palworldSettings.getSettings();
    const common = {
        host,
        schedule,
        settings,
        process: processManager.getStatus(),
        operation: operations.getStatus(),
        shutdown: shutdownController.getStatus(),
        backup: { enabled: saveBackup.enabled, retention: saveBackup.retention }
    };
    if (config.demoMode) return { ...demoStatus, serverOnline: true, ...common };
    try {
        const [info, players, metrics] = await Promise.all([
            client.call(endpoints.info), client.call(endpoints.players), client.call(endpoints.metrics)
        ]);
        return { serverOnline: true, info, players, metrics, ...common };
    } catch (error) {
        return {
            serverOnline: false,
            serverError: error.message,
            info: {},
            players: { players: [] },
            metrics: {},
            ...common
        };
    }
};

const handleRequest = async ({ config, endpoints, demoStatus, publicDir, client, hostMetrics, processManager, notifications, scheduler, operations, trackedStart, trackedStop, palworldSettings, shutdownController, saveBackup }, request, response) => {
    const url = new URL(request.url, `http://${request.headers.host || 'localhost'}`);
    try {
        if (url.pathname === '/api/health') return sendJson(response, 200, { ok: true });
        if (url.pathname === '/api/schedule' && request.method === 'GET') return sendJson(response, 200, scheduler.getStatus());
        if (url.pathname === '/api/schedule' && request.method === 'POST') {
            const body = await readJson(request);
            if (config.demoMode) return sendJson(response, 400, { error: 'Schedule editing is unavailable in demo mode' });
            const result = await operations.run('schedule-update', () => scheduler.update(body));
            return sendJson(response, 200, { ok: true, schedule: result || scheduler.getStatus() });
        }
        if (url.pathname === '/api/schedule/skip' && request.method === 'POST') {
            const body = await readJson(request);
            const result = await operations.run('schedule-skip', () => scheduler.skip(body.kind));
            return sendJson(response, 200, { ok: true, skipped: result, schedule: scheduler.getStatus() });
        }
        if (url.pathname === '/api/status' && request.method === 'GET') return sendJson(response, 200, await getStatus({ config, demoStatus, client, endpoints, hostMetrics, scheduler, palworldSettings, processManager, operations, shutdownController, saveBackup }));
        if (url.pathname === '/api/operations' && request.method === 'GET') return sendJson(response, 200, operations.getStatus());
        if ((url.pathname === '/api/console' || url.pathname === '/api/logs') && request.method === 'GET') {
            return sendJson(response, 200, { process: processManager.getStatus(), lines: processManager.getLogs(url.searchParams.get('limit')) });
        }
        if (url.pathname === '/api/backups' && request.method === 'GET') return sendJson(response, 200, await saveBackup.list());
        if (url.pathname === '/api/backups' && request.method === 'POST') {
            const result = await operations.run('backup', () => saveBackup.backup());
            return sendJson(response, 201, { ok: true, data: result });
        }
        if (url.pathname === '/api/backups/prune' && request.method === 'POST') {
            const result = await operations.run('backup-prune', () => saveBackup.prune());
            return sendJson(response, 200, { ok: true, data: result });
        }
        if (url.pathname === '/api/backups/restore' && request.method === 'POST') {
            const body = await readJson(request);
            if (!body.snapshot) return sendJson(response, 400, { error: 'snapshot is required' });
            if (!config.demoMode) {
                try {
                    await client.call(endpoints.info);
                    return sendJson(response, 409, { error: 'Stop Palworld before restoring a backup' });
                } catch (error) {
                    if (error.status) throw error;
                }
            }
            const result = await operations.run('restore', () => saveBackup.restoreSnapshot({ name: body.snapshot }));
            return sendJson(response, 200, { ok: true, data: result });
        }
        if (url.pathname === '/api/settings' && request.method === 'POST') {
            const body = await readJson(request);
            const result = await palworldSettings.stageSettings(body.changes);
            return sendJson(response, 202, { ok: true, ...result });
        }
        if (url.pathname === '/api/action' && request.method === 'POST') {
            const body = await readJson(request);
            const { action, ...payload } = body;
            if (action === 'start') {
                if (config.demoMode) return sendJson(response, 200, { ok: true, demo: true, data: { action } });
                return sendJson(response, 200, await operations.run('start', () => startManualServer({ processManager, notifications, saveBackup }, payload)));
            }
            if (!endpoints[action] || endpoints[action].method !== 'POST') return sendJson(response, 400, { error: 'Unsupported action' });
            if (action === 'shutdown') {
                const waittime = Number(payload.waittime);
                if (!Number.isInteger(waittime) || waittime < 1 || waittime > 86_400) return sendJson(response, 400, { error: 'Shutdown delay must be a whole number of seconds between 1 and 86400' });
                const result = await operations.run('shutdown', async () => {
                    if (config.demoMode) {
                        shutdownController.schedule(waittime, { notices: false });
                        return { ok: true, demo: true, data: { action, waittime } };
                    }
                    const data = await client.call(endpoints[action], { waittime });
                    shutdownController.schedule(waittime);
                    return { ok: true, data };
                });
                return sendJson(response, 200, result);
            }
            if (isDemoAction(action, config, endpoints)) return sendJson(response, 200, { ok: true, demo: true, data: { action, payload } });
            return sendJson(response, 200, await operations.run(action, async () => ({ ok: true, data: await client.call(endpoints[action], payload) })));
        }
        if (url.pathname.startsWith('/api/')) return sendJson(response, 404, { error: 'API route not found' });
        if (request.method !== 'GET') return sendJson(response, 405, { error: 'Method not allowed' });
        return serveStatic(response, url.pathname, publicDir);
    } catch (error) {
        console.error(error);
        sendJson(response, error.status || 502, { error: error.message || 'Request failed' });
    }
};

const createRequestHandler = (context) => handleRequest.bind(null, context);

export { createRequestHandler };
