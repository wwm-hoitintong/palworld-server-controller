import { scheduleShutdownNotices } from './scheduler.js';

const scheduleShutdown = (state, delaySeconds) => {
  state.cancelNotices?.();
  state.cancelNotices = scheduleShutdownNotices({
    delaySeconds,
    announceShutdown: state.announceShutdown,
    onError: (message) => console.error(message)
  });
};

const cancelShutdown = (state) => {
  state.cancelNotices?.();
  state.cancelNotices = null;
};

const createShutdownController = ({ announceShutdown }) => {
  const state = { announceShutdown, cancelNotices: null };
  return {
    schedule: scheduleShutdown.bind(null, state),
    cancel: cancelShutdown.bind(null, state)
  };
};

export { createShutdownController };
