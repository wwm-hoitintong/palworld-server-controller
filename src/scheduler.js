const shutdownNoticeSeconds = [1800, 600, 300, 30, 1];

const parseTime = (value, fallback) => {
    const match = String(value || fallback).match(/^(\d{1,2}):(\d{2})$/);
    const hour = Number(match?.[1]);
    const minute = Number(match?.[2]);
    if (!match || hour > 23 || minute > 59) throw new Error(`Invalid schedule time: ${value}`);
    return { hour, minute };
};

const normalizeWindow = (window, fallback) => {
    if (!Array.isArray(window) || window.length !== 2) throw new Error('Schedule windows must contain a start and end time');
    const parsed = window.map((value) => parseTime(value, fallback));
    return parsed.map(({ hour, minute }) => `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`);
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
    } else if (now > start) start.setTime(now.getTime());
    const range = Math.max(end.getTime() - start.getTime(), 0);
    return new Date(start.getTime() + Math.floor(Math.random() * (range + 1)));
};

const scheduleShutdownNotices = ({ delaySeconds, announceShutdown = async () => {}, onError = console.error }) => {
    const timers = shutdownNoticeSeconds.filter((seconds) => seconds <= delaySeconds).map((seconds) => {
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
            await state.announceStarted();
        } else {
            const result = await state.stopServer();
            state.lastRun.stop = { at: new Date().toISOString(), result };
        }
        state.lastError = null;
    } catch (error) {
        state.lastError = { at: new Date().toISOString(), kind, message: error.message };
        state.onError(`Scheduled ${kind} failed: ${error.stack || error.message}`);
    } finally {
        if (state.running) schedule(state, kind, true);
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
    state.next.start = null;
    state.next.stop = null;
};

const updateSchedule = (state, changes) => {
    const enabled = changes.enabled === undefined ? state.enabled : Boolean(changes.enabled);
    const startWindow = normalizeWindow(changes.startWindow || state.startWindow, ['19:30', '20:30']);
    const stopWindow = normalizeWindow(changes.stopWindow || state.stopWindow, ['01:00', '01:30']);
    stopScheduler(state);
    state.enabled = enabled;
    state.startWindow = startWindow;
    state.stopWindow = stopWindow;
    state.windows = {
        start: [parseTime(startWindow[0]), parseTime(startWindow[1])],
        stop: [parseTime(stopWindow[0]), parseTime(stopWindow[1])]
    };
    if (enabled) startScheduler(state);
};

const skipNext = (state, kind) => {
    if (!['start', 'stop'].includes(kind)) throw new Error('Schedule kind must be start or stop');
    if (!state.running || !state.next[kind]) return false;
    clearTimeout(state.timers[kind]);
    if (kind === 'stop') state.timers.cancelNotices?.();
    schedule(state, kind, true);
    return true;
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

const createScheduler = ({ enabled, startWindow, stopWindow, startServer, stopServer, announceStarted = async () => {}, announceShutdown = async () => {}, onError = console.error }) => {
    const initialStart = normalizeWindow(startWindow || ['19:30', '20:30'], ['19:30', '20:30']);
    const initialStop = normalizeWindow(stopWindow || ['01:00', '01:30'], ['01:00', '01:30']);
    const state = {
        enabled: Boolean(enabled),
        startWindow: initialStart,
        stopWindow: initialStop,
        startServer,
        stopServer,
        announceStarted,
        announceShutdown,
        onError,
        windows: {
            start: [parseTime(initialStart[0]), parseTime(initialStart[1])],
            stop: [parseTime(initialStop[0]), parseTime(initialStop[1])]
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
        update: updateSchedule.bind(null, state),
        skip: skipNext.bind(null, state),
        getStatus: getScheduleStatus.bind(null, state)
    };
};

export { createScheduler, randomDate, scheduleShutdownNotices };
