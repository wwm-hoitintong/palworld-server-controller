import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, readdir, lstat, rename, rm } from 'node:fs/promises';
import { basename, dirname, join } from 'node:path';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
const SNAPSHOT_PATTERN = /^palworld-(\d{4}-\d{2}-\d{2}T\d{2})-(\d{2})-(\d{2})-(\d{3})Z$/;
const LOCAL_TIME_TOLERANCE_MS = 1_000;

const getSnapshotName = () => `palworld-${new Date().toISOString().replace(/[:.]/g, '-')}`;
const formatTime = (milliseconds) => milliseconds ? new Date(milliseconds).toISOString() : 'unavailable';
const formatDate = (date) => date?.toISOString() || 'unavailable';

const getTimeout = (config) => Number.isFinite(config.backupTimeoutMs) ? config.backupTimeoutMs : 600_000;

const assertBackupConfig = (config) => {
    if (!config.savePath) throw new Error('PALWORLD_SAVE_PATH is not configured');
    if (!config.backupRemote) throw new Error('PALWORLD_BACKUP_REMOTE is not configured');
};

const getRemoteRoot = (config) => config.backupRemote.replace(/\/+$/, '');

const runRclone = async (config, args) => execFileAsync(config.rcloneCommand, args, {
    timeout: getTimeout(config),
    windowsHide: true,
    maxBuffer: 5_000_000
});

const parseSnapshotName = (name) => {
    const match = SNAPSHOT_PATTERN.exec(name);
    if (!match) return null;
    const createdAt = new Date(`${match[1]}:${match[2]}:${match[3]}.${match[4]}Z`);
    return Number.isNaN(createdAt.getTime()) ? null : { name, createdAt };
};

const getSaveInfo = async (root) => {
    let fileCount = 0;
    let latestMtime = 0;

    const visit = async (directory) => {
        let entries;
        try {
            entries = await readdir(directory, { withFileTypes: true });
        } catch (error) {
            if (error.code === 'ENOENT') return;
            throw error;
        }
        for (const entry of entries) {
            const path = join(directory, entry.name);
            if (entry.isSymbolicLink()) continue;
            if (entry.isDirectory()) {
                await visit(path);
                continue;
            }
            if (!entry.isFile()) continue;
            const details = await lstat(path);
            fileCount += 1;
            latestMtime = Math.max(latestMtime, details.mtimeMs);
        }
    };

    await visit(root);
    return { fileCount, latestMtime };
};

const listSnapshots = async (config) => {
    const { stdout } = await runRclone(config, [
        'lsf',
        getRemoteRoot(config),
        '--dirs-only',
        '--max-depth',
        '1'
    ]);
    return stdout.split(/\r?\n/)
        .map((line) => line.trim().replace(/\/+$/, ''))
        .filter((name) => !name.includes('/'))
        .map(parseSnapshotName)
        .filter(Boolean)
        .sort((left, right) => right.createdAt - left.createdAt);
};

const getRemoteSaveInfo = async (config, snapshot) => {
    const { stdout } = await runRclone(config, [
        'lsjson',
        `${getRemoteRoot(config)}/${snapshot.name}`,
        '--recursive',
        '--files-only'
    ]);
    const files = stdout.trim() ? JSON.parse(stdout) : [];
    const details = files.reduce((result, file) => {
        const mtime = Date.parse(file.ModTime || '');
        return {
            fileCount: result.fileCount + 1,
            totalBytes: result.totalBytes + (Number(file.Size) || 0),
            latestMtime: Number.isFinite(mtime) ? Math.max(result.latestMtime, mtime) : result.latestMtime
        };
    }, { fileCount: 0, totalBytes: 0, latestMtime: 0 });
    return details;
};

const listBackups = async ({ config }) => {
    if (!config.backupEnabled) return { enabled: false, backups: [] };
    assertBackupConfig(config);
    const snapshots = await listSnapshots(config);
    const backups = [];
    for (const snapshot of snapshots) {
        const remote = await getRemoteSaveInfo(config, snapshot);
        backups.push({
            name: snapshot.name,
            backupTime: snapshot.createdAt.toISOString(),
            fileCount: remote.fileCount,
            sizeBytes: remote.totalBytes,
            saveTime: remote.latestMtime ? new Date(remote.latestMtime).toISOString() : null,
            valid: remote.fileCount > 0
        });
    }
    return { enabled: true, backups };
};

const pruneBackups = async ({ config }) => {
    if (!config.backupEnabled) return { pruned: 0, retained: 0 };
    const snapshots = await listSnapshots(config);
    const stale = snapshots.slice(Math.max(1, config.backupRetention));
    for (const snapshot of stale) {
        await runRclone(config, ['purge', `${getRemoteRoot(config)}/${snapshot.name}`]);
        console.log(`[backup] pruned snapshot=${snapshot.name}`);
    }
    return { pruned: stale.length, retained: snapshots.length - stale.length };
};

const findNewerSnapshot = async ({ config }) => {
    console.log(`[backup-check] started; enabled=${config.backupEnabled}`);
    if (!config.backupEnabled) {
        console.log('[backup-check] decision=no-check reason=automatic-backups-disabled');
        return { enabled: false, newer: false };
    }
    assertBackupConfig(config);

    const local = await getSaveInfo(config.savePath);
    console.log(`[backup-check] local files=${local.fileCount} latest-save=${formatTime(local.latestMtime)}`);

    const snapshots = await listSnapshots(config);
    console.log(`[backup-check] discovered snapshots=${snapshots.length}`);
    const [snapshot] = snapshots;
    if (!snapshot) {
        console.log('[backup-check] decision=use-local reason=no-valid-snapshot-found');
        return { enabled: true, newer: false };
    }

    const remote = await getRemoteSaveInfo(config, snapshot);
    console.log(`[backup-check] selected snapshot=${snapshot.name} backup-time=${formatDate(snapshot.createdAt)} remote-files=${remote.fileCount} latest-remote-save=${formatTime(remote.latestMtime)}`);
    if (!remote.fileCount) {
        console.log(`[backup-check] decision=use-local reason=selected-snapshot-empty snapshot=${snapshot.name}`);
        return { enabled: true, newer: false };
    }

    // A remote backup made from the same local files normally preserves their
    // mtimes. Comparing contained files avoids prompting for every backup just
    // because the snapshot folder itself was created later.
    const remoteMetadataAvailable = remote.latestMtime > 0;
    const localIsMissing = local.fileCount === 0;
    const remoteIsNewer = remoteMetadataAvailable && remote.latestMtime > local.latestMtime + LOCAL_TIME_TOLERANCE_MS;
    const newer = localIsMissing || remoteIsNewer;
    const reason = localIsMissing
        ? 'local-save-missing'
        : !remoteMetadataAvailable
            ? 'remote-file-metadata-unavailable'
            : remoteIsNewer
                ? 'remote-save-time-is-newer'
                : 'local-save-is-newer-or-equal';
    console.log(`[backup-check] comparison remote=${formatTime(remote.latestMtime)} local=${formatTime(local.latestMtime)} tolerance-ms=${LOCAL_TIME_TOLERANCE_MS} decision=${newer ? 'prompt-restore' : 'use-local'} reason=${reason}`);

    if (!newer) return { enabled: true, newer: false };

    return {
        enabled: true,
        newer: true,
        snapshot: {
            name: snapshot.name,
            backupTime: snapshot.createdAt.toISOString(),
            saveTime: remote.latestMtime ? new Date(remote.latestMtime).toISOString() : null,
            localSaveTime: local.latestMtime ? new Date(local.latestMtime).toISOString() : null
        }
    };
};

const restoreSnapshot = async ({ config }, snapshot) => {
    if (!config.backupEnabled) throw new Error('Automatic backups are disabled');
    assertBackupConfig(config);
    const parsed = parseSnapshotName(snapshot?.name);
    if (!parsed) throw new Error('Invalid backup snapshot');

    const saveParent = dirname(config.savePath);
    const saveName = basename(config.savePath) || 'SaveGames';
    await mkdir(saveParent, { recursive: true });
    let temporaryPath = await mkdtemp(join(saveParent, `.${saveName}.restore-`));
    let localBackupPath = null;
    console.log(`[backup-restore] started snapshot=${parsed.name}`);

    try {
        console.log(`[backup-restore] downloading snapshot=${parsed.name}`);
        await runRclone(config, [
            'copy',
            `${getRemoteRoot(config)}/${parsed.name}`,
            temporaryPath,
            '--create-empty-src-dirs'
        ]);
        const restored = await getSaveInfo(temporaryPath);
        console.log(`[backup-restore] download-complete snapshot=${parsed.name} files=${restored.fileCount} latest-save=${formatTime(restored.latestMtime)}`);
        if (!restored.fileCount) throw new Error('The selected backup contains no save files');

        try {
            await lstat(config.savePath);
            localBackupPath = `${config.savePath}.before-restore-${Date.now()}`;
            await rename(config.savePath, localBackupPath);
            console.log('[backup-restore] previous local save moved to rollback copy');
        } catch (error) {
            if (error.code !== 'ENOENT') throw error;
            console.log('[backup-restore] no existing local save; restore will create it');
        }

        await rename(temporaryPath, config.savePath);
        temporaryPath = null;
        console.log(`[backup-restore] success loaded-save=${parsed.name} files=${restored.fileCount} local-rollback=${localBackupPath ? 'created' : 'not-needed'}`);
        return { restored: true, snapshotName: parsed.name, localBackupCreated: Boolean(localBackupPath) };
    } catch (error) {
        console.error(`[backup-restore] failed snapshot=${parsed.name} reason=${error.message}`);
        if (localBackupPath) {
            try {
                await rm(config.savePath, { recursive: true, force: true });
                await rename(localBackupPath, config.savePath);
                console.log('[backup-restore] rollback-success local-save-restored');
            } catch (rollbackError) {
                console.error(`[backup-restore] rollback-failed reason=${rollbackError.message}`);
            }
        }
        throw error;
    } finally {
        if (temporaryPath) await rm(temporaryPath, { recursive: true, force: true });
    }
};

const backupSave = async ({ config }) => {
    if (!config.backupEnabled) {
        console.log('[backup] skipped reason=automatic-backups-disabled');
        return { enabled: false, backedUp: false, skipped: true };
    }
    assertBackupConfig(config);
    const snapshotName = getSnapshotName();
    const destination = `${getRemoteRoot(config)}/${snapshotName}`;
    console.log(`[backup] upload-start snapshot=${snapshotName}`);
    await runRclone(config, [
        'copy',
        config.savePath,
        destination,
        '--create-empty-src-dirs'
    ]);
    const verification = await getRemoteSaveInfo(config, { name: snapshotName });
    if (!verification.fileCount) {
        throw new Error('Backup upload completed but the remote snapshot is empty');
    }
    const retention = await pruneBackups({ config });
    console.log(`[backup] upload-success snapshot=${snapshotName} files=${verification.fileCount}`);
    return {
        enabled: true,
        backedUp: true,
        destination,
        snapshotName,
        fileCount: verification.fileCount,
        sizeBytes: verification.totalBytes,
        pruned: retention.pruned
    };
};

const createSaveBackup = ({ config }) => ({
    enabled: config.backupEnabled,
    retention: config.backupRetention,
    backup: backupSave.bind(null, { config }),
    list: listBackups.bind(null, { config }),
    prune: pruneBackups.bind(null, { config }),
    findNewerSnapshot: findNewerSnapshot.bind(null, { config }),
    restoreSnapshot: restoreSnapshot.bind(null, { config })
});

export { createSaveBackup };
