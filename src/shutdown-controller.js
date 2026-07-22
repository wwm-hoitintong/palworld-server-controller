import { scheduleShutdownNotices } from './scheduler.js';

const finalizeShutdown = async (state) => {
    if (!state.hasPendingSettings() && !state.backupEnabled) {
        state.finalizeTimer = null;
        return;
    }
    try {
        await state.waitForOffline();
    } catch (error) {
        console.error(`Shutdown finalization skipped because Palworld did not go offline: ${error.message}`);
        state.finalizeTimer = null;
        return;
    }
    if (state.hasPendingSettings()) {
        try {
            const result = await state.savePendingSettings();
            if (result.saved) console.log(`[settings] saved ${result.pendingKeys.length} setting changes after shutdown`);
        } catch (error) {
            console.error(`Settings save after shutdown failed: ${error.message}`);
        }
    }
    if (state.backupEnabled) {
        try {
            const result = await state.backupSave();
            if (result.backedUp) console.log(`[backup] save copied to ${result.destination}`);
        } catch (error) {
            console.error(`Google Drive backup failed: ${error.message}`);
        }
    }
    state.finalizeTimer = null;
};

const scheduleShutdown = (state, delaySeconds, { notices = true } = {}) => {
    state.cancelNotices?.();
    clearTimeout(state.finalizeTimer);
    if (notices) {
        state.cancelNotices = scheduleShutdownNotices({
            delaySeconds,
            announceShutdown: state.announceShutdown,
            onError: (message) => console.error(message)
        });
    }
    state.finalizeTimer = setTimeout(() => finalizeShutdown(state), Math.max(delaySeconds, 0) * 1000);
};

const cancelShutdown = (state) => {
    state.cancelNotices?.();
    state.cancelNotices = null;
    clearTimeout(state.finalizeTimer);
    state.finalizeTimer = null;
};

const createShutdownController = ({ announceShutdown, waitForOffline = async () => {}, savePendingSettings = async () => ({ saved: false }), hasPendingSettings = () => false, backupSave = async () => ({ backedUp: false }), backupEnabled = false }) => {
    const state = {
        announceShutdown,
        waitForOffline,
        savePendingSettings,
        hasPendingSettings,
        backupSave,
        backupEnabled,
        cancelNotices: null,
        finalizeTimer: null
    };
    return {
        schedule: scheduleShutdown.bind(null, state),
        cancel: cancelShutdown.bind(null, state)
    };
};

export { createShutdownController };
