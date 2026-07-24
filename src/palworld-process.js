import { spawn } from 'node:child_process';

const MAX_LOG_LINES = 500;

const addLog = (state, source, text) => {
    state.logRemainders[source] += text;
    const lines = state.logRemainders[source].split(/\r?\n/);
    state.logRemainders[source] = lines.pop() || '';
    for (const line of lines) {
        if (!line.trim()) continue;
        state.logs.push({ at: new Date().toISOString(), source, line });
    }
    if (state.logs.length > MAX_LOG_LINES) state.logs.splice(0, state.logs.length - MAX_LOG_LINES);
};

const attachOutput = (state, stream, source) => {
    stream?.setEncoding('utf8');
    stream?.on('data', (chunk) => addLog(state, source, chunk));
};

const launchPalworld = async ({ config, endpoints, client, state, beforeLaunch }) => {
    if (config.demoMode) {
        state.status = 'demo';
        return { demo: true };
    }
    if (!config.serverCommand) throw new Error('PALWORLD_SERVER_COMMAND is not configured');
    try {
        await client.call(endpoints.info);
        state.status = 'online';
        console.log('[palworld] REST API is already online; skipping process launch');
        return { alreadyRunning: true };
    } catch (error) {
        if (error.status) {
            throw new Error(`Palworld REST API returned HTTP ${error.status} before startup; check PALWORLD_API_URL and credentials`);
        }
        console.log(`[palworld] REST API is offline; launching ${config.serverCommand}`);
    }
    const preparation = beforeLaunch ? await beforeLaunch() : null;
    state.status = 'starting';
    state.lastStartAt = new Date().toISOString();
    console.log(`[palworld] spawn command: ${config.serverCommand}`);
    console.log(`[palworld] spawn cwd: ${config.serverCwd || '(default)'}`);
    const child = spawn(config.serverCommand, config.serverArgs, {
        cwd: config.serverCwd || undefined,
        detached: true,
        stdio: ['ignore', 'pipe', 'pipe'],
        windowsHide: false
    });
    state.child = child;
    attachOutput(state, child.stdout, 'stdout');
    attachOutput(state, child.stderr, 'stderr');
    child.once('error', (error) => {
        state.status = 'failed';
        state.lastError = error.message;
        addLog(state, 'system', `Process error: ${error.message}\n`);
    });
    child.once('exit', (code, signal) => {
        state.status = 'offline';
        state.lastExit = { at: new Date().toISOString(), code, signal };
        addLog(state, 'system', `Process exited with code=${code ?? 'null'} signal=${signal || 'none'}\n`);
        state.child = null;
    });
    await new Promise((resolve, reject) => {
        child.once('spawn', resolve);
        child.once('error', reject);
    });
    child.unref();
    console.log(`[palworld] process spawned (pid ${child.pid}); waiting for REST API readiness`);
    try {
        await client.waitForReady();
    } catch (error) {
        state.status = 'failed';
        state.lastError = error.message;
        throw error;
    }
    state.status = 'online';
    console.log('[palworld] REST API is ready');
    return { started: true, pid: child.pid, ...(preparation || {}) };
};

const startPalworld = async ({ config, endpoints, client, state }, options = {}) => {
    if (state.startPromise) return state.startPromise;
    state.startPromise = launchPalworld({ config, endpoints, client, state, beforeLaunch: options.beforeLaunch });
    try {
        return await state.startPromise;
    } finally {
        state.startPromise = null;
    }
};

const stopPalworld = async ({ config, endpoints, client, state, onShutdownRequested }) => {
    if (config.demoMode) return { demo: true };
    state.status = 'stopping';
    try {
        await client.call(endpoints.shutdown, { waittime: 30 });
    } catch (error) {
        state.status = 'failed';
        state.lastError = error.message;
        throw error;
    }
    onShutdownRequested?.(30);
    console.log('Requested scheduled Palworld shutdown');
    return { shutdownRequested: true };
};

const getProcessStatus = (state) => ({
    state: state.status,
    pid: state.child?.pid || null,
    lastStartAt: state.lastStartAt || null,
    lastExit: state.lastExit || null,
    lastError: state.lastError || null,
    logLines: state.logs.length
});

const createPalworldProcess = ({ config, endpoints, client, onShutdownRequested = () => {} }) => {
    const state = {
        startPromise: null,
        child: null,
        status: config.demoMode ? 'demo' : 'offline',
        logs: [],
        logRemainders: { stdout: '', stderr: '', system: '' },
        lastStartAt: null,
        lastExit: null,
        lastError: null
    };
    const context = { config, endpoints, client, state, onShutdownRequested };
    return {
        start: startPalworld.bind(null, context),
        stop: stopPalworld.bind(null, context),
        getStatus: () => getProcessStatus(state),
        getLogs: (limit = 200) => state.logs.slice(-Math.min(Math.max(Number(limit) || 200, 1), MAX_LOG_LINES))
    };
};

export { createPalworldProcess };
