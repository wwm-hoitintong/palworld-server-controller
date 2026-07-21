function parseTime(value, fallback) {
  const match = String(value || fallback).match(/^(\d{1,2}):(\d{2})$/);
  if (!match) throw new Error(`Invalid schedule time: ${value}`);
  return { hour: Math.min(Number(match[1]), 23), minute: Math.min(Number(match[2]), 59) };
}

export function randomDate(windowStart, windowEnd, now = new Date(), nextCycle = false) {
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
}

const shutdownNoticeSeconds = [1800, 600, 300, 30, 1];

export function scheduleShutdownNotices({ delaySeconds, announceShutdown = async () => {}, onError = console.error }) {
  const timers = shutdownNoticeSeconds
    .filter((seconds) => seconds <= delaySeconds)
    .map((seconds) => {
      const delay = Math.max(delaySeconds - seconds, 0) * 1000;
      return setTimeout(() => announceShutdown(seconds).catch((error) => onError(`Discord shutdown notice failed: ${error.message}`)), delay);
    });
  return () => timers.forEach(clearTimeout);
}

export function createScheduler({ enabled, startWindow, stopWindow, startServer, stopServer, announceStarted = async () => {}, announceShutdown = async () => {}, onError = console.error }) {
  const windows = {
    start: [parseTime(startWindow?.[0], '19:30'), parseTime(startWindow?.[1], '20:30')],
    stop: [parseTime(stopWindow?.[0], '01:00'), parseTime(stopWindow?.[1], '01:30')]
  };
  const timers = { start: null, stop: null, cancelNotices: null };
  const next = { start: null, stop: null };
  const lastRun = { start: null, stop: null };
  let lastError = null;
  let running = false;

  function schedule(kind, nextCycle = false) {
    const [from, to] = windows[kind];
    next[kind] = randomDate(from, to, new Date(), nextCycle);
    console.log(`[scheduler] next ${kind}: ${next[kind].toLocaleString()}`);
    if (kind === 'stop') {
      timers.cancelNotices?.();
      timers.cancelNotices = scheduleShutdownNotices({
        delaySeconds: Math.max((next.stop.getTime() - Date.now()) / 1000, 0),
        announceShutdown,
        onError
      });
    }
    const delay = Math.max(next[kind].getTime() - Date.now(), 1_000);
    timers[kind] = setTimeout(() => run(kind), delay);
  }

  async function run(kind) {
    console.log(`[scheduler] running ${kind} task`);
    try {
      if (kind === 'start') {
        const result = await startServer();
        lastRun.start = { at: new Date().toISOString(), result };
        console.log(`[scheduler] start completed: ${JSON.stringify(result)}`);
        await announceStarted();
      } else {
        const result = await stopServer();
        lastRun.stop = { at: new Date().toISOString(), result };
        console.log(`[scheduler] stop completed: ${JSON.stringify(result)}`);
      }
      lastError = null;
    } catch (error) {
      lastError = { at: new Date().toISOString(), kind, message: error.message };
      onError(`Scheduled ${kind} failed: ${error.stack || error.message}`);
    } finally {
      schedule(kind, true);
    }
  }

  return {
    start() {
      if (!enabled || running) return;
      running = true;
      schedule('start');
      schedule('stop');
    },
    stop() {
      clearTimeout(timers.start);
      clearTimeout(timers.stop);
      timers.cancelNotices?.();
      timers.cancelNotices = null;
      running = false;
    },
    getStatus() {
      return {
        enabled: Boolean(enabled),
        running,
        nextStart: next.start?.toISOString() || null,
        nextStop: next.stop?.toISOString() || null,
        lastStart: lastRun.start,
        lastStop: lastRun.stop,
        lastError,
        startWindow: startWindow.join('–'),
        stopWindow: stopWindow.join('–')
      };
    }
  };
}
