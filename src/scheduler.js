const parseTime = (value, fallback) => {
    const match = String(value || fallback).match(/^(\d{1,2}):(\d{2})$/);
    if (!match) throw new Error(`Invalid schedule time: ${value}`);
    return { hour: Math.min(Number(match[1]), 23), minute: Math.min(Number(match[2]), 59) };
};

const randomDate = (windowStart, windowEnd, now = new Date(), nextCycle = false) => {
    const start = new Date(now);
    start.setHours(windowStart.hour, windowStart.minute, 0, 0);

    const end = new Date(now);
    end.setHours(windowEnd.hour, windowEnd.minute, 0, 0);
    if (end < start) end.setDate(end.getDate() + 1);

    if (nextCycle || now > end) {
        start.setDate(start.getDate() + 1);
        end.setDate(end.getDate() + 1);
    } else if (now > start) {
        start.setTime(now.getTime());
    }

    const range = Math.max(end.getTime() - start.getTime(), 0);
    return new Date(start.getTime() + Math.floor(Math.random() * (range + 1)));
};

const shutdownNoticeSeconds = [1800, 600, 300, 30, 1];

const scheduleShutdownNotices = ({ delaySeconds, announceShutdown = async () => { }, onError = console.error }) => {
    const timers = shutdownNoticeSeconds
        .filter((seconds) => seconds <= delaySeconds)
        .map((seconds) => {
            const delay = Math.max(delaySeconds - seconds, 0) * 1000;
            return setTimeout(() => announceShutdown(seconds).catch((error) => onError(`Shutdown notice failed: ${error.message}`)), delay);
        });
    return () => timers.forEach(clearTimeout);
};

const schedule = (state, kind, nextCycle = false) => {
    const [from, to] = state.windows[kind];
    state.next[kind] = randomDate(from, to, new Date(), nextCycle);
    console.log(`[scheduler] next ${kind}: ${state.next[kind].toLocaleString()}`);
    if (kind === 'stop') {
        state.timers.cancelNotices?.();
        state.timers.cancelNotices = scheduleShutdownNotices({
            delaySeconds: Math.max((state.next.stop.getTime() - Date.now()) / 1000, 0),
            announceShutdown: state.announceShutdown,
            onError: state.onError
        });
    }
    const delay = Math.max(state.next[kind].getTime() - Date.now(), 1_000);
    state.timers[kind] = setTimeout(() => run(state, kind), delay);
};

const run = async (state, kind) => {
    console.log(`[scheduler] running ${kind} task`);
    try {
        if (kind === 'start') {
            const result = await state.startServer();
            state.lastRun.start = { at: new Date().toISOString(), result };
            console.log(`[scheduler] start completed: ${JSON.stringify(result)}`);
            await state.announceStarted();
        } else {
            const result = await state.stopServer();
            state.lastRun.stop = { at: new Date().toISOString(), result };
            console.log(`[scheduler] stop completed: ${JSON.stringify(result)}`);
        }
        state.lastError = null;
    } catch (error) {
        state.lastError = { at: new Date().toISOString(), kind, message: error.message };
        state.onError(`Scheduled ${kind} failed: ${error.stack || error.message}`);
    } finally {
        schedule(state, kind, true);
    }
};

const startScheduler = (state) => {
    if (!state.enabled || state.running) return;
    state.running = true;
    schedule(state, 'start');
    schedule(state, 'stop');
};

const stopScheduler = (state) => {
    clearTimeout(state.timers.start);
    clearTimeout(state.timers.stop);
    state.timers.cancelNotices?.();
    state.timers.cancelNotices = null;
    state.running = false;
};

const getScheduleStatus = (state) => ({
    enabled: Boolean(state.enabled),
    running: state.running,
    nextStart: state.next.start?.toISOString() || null,
    nextStop: state.next.stop?.toISOString() || null,
    lastStart: state.lastRun.start,
    lastStop: state.lastRun.stop,
    lastError: state.lastError,
    startWindow: state.startWindow.join('–'),
    stopWindow: state.stopWindow.join('–')
});

const createScheduler = ({ enabled, startWindow, stopWindow, startServer, stopServer, announceStarted = async () => { }, announceShutdown = async () => { }, onError = console.error }) => {
    const state = {
        enabled,
        startWindow,
        stopWindow,
        startServer,
        stopServer,
        announceStarted,
        announceShutdown,
        onError,
        windows: {
            start: [parseTime(startWindow?.[0], '19:30'), parseTime(startWindow?.[1], '20:30')],
            stop: [parseTime(stopWindow?.[0], '01:00'), parseTime(stopWindow?.[1], '01:30')]
        },
        timers: { start: null, stop: null, cancelNotices: null },
        next: { start: null, stop: null },
        lastRun: { start: null, stop: null },
        lastError: null,
        running: false
    };
    return {
        start: startScheduler.bind(null, state),
        stop: stopScheduler.bind(null, state),
        getStatus: getScheduleStatus.bind(null, state)
    };
};

export { createScheduler, randomDate, scheduleShutdownNotices };
