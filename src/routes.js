import { readFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';

const isDemoAction = (action, config, endpoints) => config.demoMode && endpoints[action]?.method === 'POST';

const readJson = async (request) => {
    let body = '';
    for await (const chunk of request) body += chunk;
    if (!body) return {};
    if (body.length > 100_000) throw new Error('Request body is too large');
    return JSON.parse(body);
};

const sendJson = (response, status, data) => {
    response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
    response.end(JSON.stringify(data));
};

const serveStatic = async (response, pathname, publicDir) => {
    const requested = pathname === '/' ? '/index.html' : pathname;
    const file = normalize(join(publicDir, requested));
    if (!file.startsWith(publicDir)) return sendJson(response, 404, { error: 'Not found' });
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
    console.log(`[manual-start] requested restore-decision=${hasRestoreDecision ? String(payload.restore) : 'not-provided'}`);

    if (hasRestoreDecision && typeof payload.restore !== 'boolean') {
        throw new Error('restore must be a boolean');
    }

    if (!hasRestoreDecision) {
        try {
            const check = await saveBackup.findNewerSnapshot();
            if (check.newer) {
                console.log(`[manual-start] decision=prompt-user snapshot=${check.snapshot.name} remote-save=${check.snapshot.saveTime || 'unavailable'} local-save=${check.snapshot.localSaveTime || 'unavailable'}`);
                return {
                    ok: true,
                    data: {
                        needsRestoreConfirmation: true,
                        restoreCandidate: check.snapshot
                    }
                };
            }
            console.log('[manual-start] decision=start-with-local-save reason=no-newer-backup');
        } catch (error) {
            backupCheckWarning = 'Automatic backup check failed; starting with the local save.';
            console.error(`[manual-start] decision=start-with-local-save reason=backup-check-failed error=${error.message}`);
        }
    }

    let beforeLaunch;
    if (payload.restore === true) {
        console.log(`[manual-start] user-decision=restore snapshot=${payload.snapshot || 'not-provided'}`);
        if (typeof payload.snapshot !== 'string' || !payload.snapshot) {
            throw new Error('A backup snapshot is required when restore is true');
        }
        beforeLaunch = async () => {
            let check;
            try {
                check = await saveBackup.findNewerSnapshot();
            } catch (error) {
                error.status = 502;
                throw error;
            }
            if (!check.newer || check.snapshot.name !== payload.snapshot) {
                console.error(`[manual-start] restore-cancelled reason=backup-changed requested=${payload.snapshot}`);
                const error = new Error('The backup changed while you were deciding; no save was restored');
                error.status = 409;
                throw error;
            }
            return saveBackup.restoreSnapshot(check.snapshot);
        };
    } else if (payload.restore === false) {
        console.log('[manual-start] user-decision=keep-local-save');
    }

    const result = await processManager.start(beforeLaunch ? { beforeLaunch } : {});
    if (result.started) await announceStarted(notifications);
    console.log(`[manual-start] operation-complete started=${Boolean(result.started)} restored=${Boolean(result.restored)}`);
    return {
        ok: true,
        data: {
            ...result,
            ...(backupCheckWarning ? { backupCheckWarning } : {})
        }
    };
};

const handleRequest = async ({ config, endpoints, demoStatus, publicDir, client, hostMetrics, processManager, notifications, scheduler, palworldSettings, shutdownController, saveBackup }, request, response) => {
    const url = new URL(request.url, `http://${request.headers.host || 'localhost'}`);
    try {
        if (url.pathname === '/api/health') return sendJson(response, 200, { ok: true });
        if (url.pathname === '/api/schedule' && request.method === 'GET') return sendJson(response, 200, scheduler.getStatus());
        if (url.pathname === '/api/status' && request.method === 'GET') {
            const host = await hostMetrics.safeHostMetrics();
            const schedule = scheduler.getStatus();
            const settings = await palworldSettings.getSettings();
            if (config.demoMode) return sendJson(response, 200, { ...demoStatus, serverOnline: true, host, schedule, settings });
            try {
                const [info, players, metrics] = await Promise.all([
                    client.call(endpoints.info), client.call(endpoints.players), client.call(endpoints.metrics)
                ]);
                return sendJson(response, 200, { serverOnline: true, info, players, metrics, host, schedule, settings });
            } catch (error) {
                return sendJson(response, 200, {
                    serverOnline: false,
                    serverError: error.message,
                    info: {},
                    players: { players: [] },
                    metrics: {},
                    host,
                    schedule,
                    settings
                });
            }
        }
        if (url.pathname === '/api/settings' && request.method === 'POST') {
            const body = await readJson(request);
            try {
                const result = await palworldSettings.stageSettings(body.changes);
                return sendJson(response, 202, { ok: true, ...result });
            } catch (error) {
                return sendJson(response, 400, { error: error.message });
            }
        }
        if (url.pathname === '/api/action' && request.method === 'POST') {
            const body = await readJson(request);
            const { action, ...payload } = body;
            if (action === 'start') {
                if (config.demoMode) return sendJson(response, 200, { ok: true, demo: true, data: { action } });
                return sendJson(response, 200, await startManualServer({ processManager, notifications, saveBackup }, payload));
            }
            if (!endpoints[action] || endpoints[action].method !== 'POST') return sendJson(response, 400, { error: 'Unsupported action' });
            if (action === 'shutdown') {
                const waittime = Number(payload.waittime);
                if (!Number.isInteger(waittime) || waittime < 1 || waittime > 86_400) {
                    return sendJson(response, 400, { error: 'Shutdown delay must be a whole number of seconds between 1 and 86400' });
                }
                if (config.demoMode) {
                    shutdownController.schedule(waittime, { notices: false });
                    return sendJson(response, 200, { ok: true, demo: true, data: { action, waittime } });
                }
                const data = await client.call(endpoints[action], { waittime });
                shutdownController.schedule(waittime);
                return sendJson(response, 200, { ok: true, data });
            }
            if (isDemoAction(action, config, endpoints)) return sendJson(response, 200, { ok: true, demo: true, data: { action, payload } });
            return sendJson(response, 200, { ok: true, data: await client.call(endpoints[action], payload) });
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
