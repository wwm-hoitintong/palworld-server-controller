import { execFile } from 'node:child_process';
import os from 'node:os';
import { promisify } from 'node:util';
import { readFile } from 'node:fs/promises';

const execFileAsync = promisify(execFile);

const cpuSnapshot = () => os.cpus().reduce((snapshot, cpu) => {
    const times = cpu.times;
    snapshot.idle += times.idle;
    snapshot.total += times.user + times.nice + times.sys + times.idle + times.irq;
    return snapshot;
}, { idle: 0, total: 0 });

const currentCpuPercent = async () => {
    const before = cpuSnapshot();
    await new Promise((resolve) => setTimeout(resolve, 100));
    const after = cpuSnapshot();
    const total = after.total - before.total;
    return total ? Number((100 - ((after.idle - before.idle) / total) * 100).toFixed(1)) : 0;
};

const networkTotals = async () => {
    if (process.platform === 'linux') {
        const text = await readFile('/proc/net/dev', 'utf8');
        return text.split(/\r?\n/).slice(2).reduce((totals, line) => {
            const [interfaceName, values] = line.trim().split(':');
            if (!interfaceName || interfaceName.trim() === 'lo' || !values) return totals;
            const fields = values.trim().split(/\s+/);
            totals.rx += Number(fields[0]) || 0;
            totals.tx += Number(fields[8]) || 0;
            return totals;
        }, { rx: 0, tx: 0 });
    }
    if (process.platform === 'darwin') {
        const { stdout } = await execFileAsync('netstat', ['-ib'], { timeout: 2_000 });
        return stdout.split(/\r?\n/).reduce((totals, line) => {
            const fields = line.trim().split(/\s+/);
            if (fields[0] === 'lo0' || fields[2]?.startsWith('<Link#') !== true) return totals;
            totals.rx += Number(fields[6]) || 0;
            totals.tx += Number(fields[9]) || 0;
            return totals;
        }, { rx: 0, tx: 0 });
    }
    if (process.platform === 'win32') {
        const command = "$s=Get-NetAdapterStatistics; $rx=($s | Measure-Object -Property ReceivedBytes -Sum).Sum; $tx=($s | Measure-Object -Property SentBytes -Sum).Sum; [pscustomobject]@{rx=$rx;tx=$tx} | ConvertTo-Json -Compress";
        const { stdout } = await execFileAsync('powershell.exe', ['-NoProfile', '-Command', command], { timeout: 3_000 });
        const totals = JSON.parse(stdout.trim());
        return { rx: Number(totals.rx) || 0, tx: Number(totals.tx) || 0 };
    }
    return { rx: 0, tx: 0 };
};

const getHostMetrics = async (networkState) => {
    const [cpuPercent, totals] = await Promise.all([currentCpuPercent(), networkTotals()]);
    const now = Date.now();
    const elapsed = networkState.timestamp ? Math.max((now - networkState.timestamp) / 1000, 0.001) : 0;
    const host = {
        cpuPercent,
        memory: {
            totalBytes: os.totalmem(),
            usedBytes: os.totalmem() - os.freemem(),
            usedPercent: Number(((1 - os.freemem() / os.totalmem()) * 100).toFixed(1))
        },
        network: { rxBytesPerSec: 0, txBytesPerSec: 0 }
    };
    if (elapsed) {
        host.network.rxBytesPerSec = Math.max(0, Math.round((totals.rx - networkState.rx) / elapsed));
        host.network.txBytesPerSec = Math.max(0, Math.round((totals.tx - networkState.tx) / elapsed));
    }
    Object.assign(networkState, { ...totals, timestamp: now });
    return host;
};

const safeHostMetrics = async (networkState) => {
    try {
        return { available: true, ...(await getHostMetrics(networkState)) };
    } catch (error) {
        console.error('Host metrics unavailable:', error.message);
        return { available: false };
    }
};

const createHostMetrics = () => {
    const networkState = { rx: 0, tx: 0, timestamp: 0 };
    return { safeHostMetrics: safeHostMetrics.bind(null, networkState) };
};

export { createHostMetrics };
