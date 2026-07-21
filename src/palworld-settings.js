import { createHash } from 'node:crypto';
import { readFile, stat, writeFile } from 'node:fs/promises';

const optionSettingsMarker = 'OptionSettings=(';

const splitOptionSettings = (value) => {
    const entries = [];
    let entry = '';
    let quoted = false;
    let depth = 0;
    for (const character of value) {
        if (character === '"') quoted = !quoted;
        if (!quoted && character === '(') depth += 1;
        if (!quoted && character === ')') depth -= 1;
        if (character === ',' && !quoted && depth === 0) {
            entries.push(entry.trim());
            entry = '';
        } else {
            entry += character;
        }
    }
    if (entry.trim()) entries.push(entry.trim());
    return entries;
};

const cleanValue = (value) => value.trim().replace(/^"|"$/g, '');

const parseOptionSettings = (text) => {
    const markerIndex = text.indexOf(optionSettingsMarker);
    if (markerIndex < 0) throw new Error('OptionSettings was not found');
    const valuesStart = markerIndex + optionSettingsMarker.length;
    const valuesEnd = text.lastIndexOf(')');
    if (valuesEnd < valuesStart) throw new Error('OptionSettings is incomplete');
    const entries = splitOptionSettings(text.slice(valuesStart, valuesEnd)).map((entry) => {
        const separator = entry.indexOf('=');
        if (separator < 0) return null;
        return {
            key: entry.slice(0, separator).trim(),
            value: cleanValue(entry.slice(separator + 1)),
            rawValue: entry.slice(separator + 1).trim()
        };
    }).filter(Boolean);
    return {
        valuesStart,
        valuesEnd,
        entries,
        values: Object.fromEntries(entries.map(({ key, value }) => [key, value]))
    };
};

const readSettingsDocument = async (settingsPath) => {
    const text = await readFile(settingsPath, 'utf8');
    return { text, parsed: parseOptionSettings(text), hash: createHash('sha256').update(text).digest('hex') };
};

const isSensitiveSetting = (key) => /password|secret|token/i.test(key);

const redactValues = (values) => Object.fromEntries(Object.entries(values).map(([key, value]) => [key, isSensitiveSetting(key) ? '' : value]));

const readPalworldSettings = async (settingsPath, pending) => {
    if (!settingsPath) return { available: false, path: '', pending: Boolean(pending), pendingKeys: Object.keys(pending || {}), error: 'PALWORLD_SETTINGS_PATH is not configured' };
    try {
        const document = await readSettingsDocument(settingsPath);
        return {
            available: true,
            path: settingsPath,
            pending: Boolean(pending),
            pendingKeys: Object.keys(pending || {}),
            redactedKeys: document.parsed.entries.filter(({ key }) => isSensitiveSetting(key)).map(({ key }) => key),
            values: redactValues({ ...document.parsed.values, ...(pending || {}) })
        };
    } catch (error) {
        return { available: false, path: settingsPath, pending: Boolean(pending), pendingKeys: Object.keys(pending || {}), error: error.message };
    }
};

const readStageDocument = async (state) => {
    if (!state.settingsPath) throw new Error('PALWORLD_SETTINGS_PATH is not configured');
    return readSettingsDocument(state.settingsPath);
};

const isBalancedValue = (value) => {
    let depth = 0;
    for (const character of value) {
        if (character === '(') depth += 1;
        if (character === ')' && --depth < 0) return false;
    }
    return depth === 0;
};

const validateChanges = (changes, currentEntries) => {
    if (!changes || typeof changes !== 'object' || Array.isArray(changes)) throw new Error('Settings changes must be an object');
    const currentValues = Object.fromEntries(currentEntries.map(({ key, value }) => [key, value]));
    const rawValues = Object.fromEntries(currentEntries.map(({ key, rawValue }) => [key, rawValue]));
    const unknownKeys = Object.keys(changes).filter((key) => !(key in currentValues));
    if (unknownKeys.length) throw new Error(`Unknown setting: ${unknownKeys[0]}`);
    for (const [key, value] of Object.entries(changes)) {
        if (typeof value !== 'string') throw new Error(`Setting ${key} must be a string`);
        if (/[\r\n]/.test(value) || value.length > 2_000) throw new Error(`Invalid value for setting ${key}`);
        if (!/^".*"$/.test(rawValues[key]) && /[=]/.test(value)) throw new Error(`Invalid value for setting ${key}`);
        if (!/^".*"$/.test(rawValues[key]) && ((!value.trim().startsWith('(') && value.includes(',')) || !isBalancedValue(value))) throw new Error(`Invalid value for setting ${key}`);
    }
    return changes;
};

const formatSettingValue = (value, rawValue) => {
    const text = String(value);
    if (/^".*"$/.test(rawValue)) return `"${text.replace(/"/g, '""')}"`;
    return text;
};

const stageSettings = async (state, changes) => {
    const document = await readStageDocument(state);
    const validChanges = validateChanges(changes, document.parsed.entries);
    state.pending = { ...(state.pending || {}), ...validChanges };
    state.baseHash = document.hash;
    return { pending: true, demo: state.demoMode, fileBacked: true, pendingKeys: Object.keys(state.pending) };
};

const savePendingSettings = async (state) => {
    if (!state.pending || !Object.keys(state.pending).length) return { saved: false, pending: false, demo: state.demoMode };
    const document = await readSettingsDocument(state.settingsPath);
    if (document.hash !== state.baseHash) throw new Error('PalWorldSettings.ini changed externally; pending settings were not written');
    validateChanges(state.pending, document.parsed.entries);
    const values = { ...document.parsed.values, ...state.pending };
    const serialized = document.parsed.entries
        .map(({ key, rawValue }) => `${key}=${formatSettingValue(values[key], rawValue)}`)
        .join(', ');
    const nextText = `${document.text.slice(0, document.parsed.valuesStart)}${serialized}${document.text.slice(document.parsed.valuesEnd)}`;
    const fileStats = await stat(state.settingsPath);
    await writeFile(state.settingsPath, nextText, { encoding: 'utf8', mode: fileStats.mode });
    const savedKeys = Object.keys(state.pending);
    state.pending = null;
    state.baseHash = null;
    return { saved: true, pending: false, pendingKeys: savedKeys };
};

const createPalworldSettings = ({ config }) => {
    const state = { settingsPath: config.settingsPath, demoMode: config.demoMode, pending: null, baseHash: null };
    return {
        getSettings: () => readPalworldSettings(state.settingsPath, state.pending),
        stageSettings: stageSettings.bind(null, state),
        savePendingSettings: savePendingSettings.bind(null, state),
        hasPendingSettings: () => Boolean(state.pending && Object.keys(state.pending).length)
    };
};

export { createPalworldSettings };
