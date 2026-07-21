import { scheduleShutdownNotices } from './scheduler.js';

export function createShutdownController({ announceShutdown }) {
  let cancelNotices = null;

  function schedule(delaySeconds) {
    cancelNotices?.();
    cancelNotices = scheduleShutdownNotices({
      delaySeconds,
      announceShutdown,
      onError: (message) => console.error(message)
    });
  }

  function cancel() {
    cancelNotices?.();
    cancelNotices = null;
  }

  return { schedule, cancel };
}
