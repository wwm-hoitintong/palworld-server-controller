const createOperationTracker = ({ historyLimit = 30 } = {}) => {
    const state = { current: null, history: [] };

    const run = async (kind, task, details = {}) => {
        if (state.current) {
            const error = new Error(`Another operation is already running: ${state.current.kind}`);
            error.status = 409;
            throw error;
        }
        const operation = {
            id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
            kind,
            status: 'running',
            startedAt: new Date().toISOString(),
            details
        };
        state.current = operation;
        try {
            operation.result = await task();
            operation.status = 'completed';
            return operation.result;
        } catch (error) {
            operation.status = 'failed';
            operation.error = error.message;
            throw error;
        } finally {
            operation.finishedAt = new Date().toISOString();
            state.history.unshift({ ...operation });
            state.history.length = Math.max(1, historyLimit);
            state.current = null;
        }
    };

    return {
        run,
        getStatus: () => ({ current: state.current, last: state.history[0] || null, history: state.history.map((operation) => ({ ...operation })) }),
        getHistory: () => state.history.map((operation) => ({ ...operation }))
    };
};

export { createOperationTracker };
