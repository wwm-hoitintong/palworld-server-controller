import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

const getSnapshotName = () => `palworld-${new Date().toISOString().replace(/[:.]/g, '-')}`;

const backupSave = async ({ config }) => {
    if (!config.backupEnabled) return { enabled: false, backedUp: false, skipped: true };
    if (!config.savePath) throw new Error('PALWORLD_SAVE_PATH is not configured');
    if (!config.backupRemote) throw new Error('PALWORLD_BACKUP_REMOTE is not configured');
    const destination = `${config.backupRemote.replace(/\/+$/, '')}/${getSnapshotName()}`;
    const timeout = Number.isFinite(config.backupTimeoutMs) ? config.backupTimeoutMs : 600_000;
    await execFileAsync(config.rcloneCommand, [
        'copy',
        config.savePath,
        destination,
        '--create-empty-src-dirs'
    ], {
        timeout,
        windowsHide: true,
        maxBuffer: 1_000_000
    });
    return { enabled: true, backedUp: true, destination };
};

const createSaveBackup = ({ config }) => ({
    enabled: config.backupEnabled,
    backup: backupSave.bind(null, { config })
});

export { createSaveBackup };
