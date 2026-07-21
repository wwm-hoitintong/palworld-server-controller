import { readFile } from 'node:fs/promises';

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

const parseOptionSettings = (text) => {
    const markerIndex = text.indexOf(optionSettingsMarker);
    if (markerIndex < 0) throw new Error('OptionSettings was not found');
    const values = text.slice(markerIndex + optionSettingsMarker.length).replace(/\)\s*;?\s*$/, '');
    return Object.fromEntries(splitOptionSettings(values).map((entry) => {
        const separator = entry.indexOf('=');
        if (separator < 0) return null;
        return [entry.slice(0, separator).trim(), entry.slice(separator + 1).trim().replace(/^"|"$/g, '')];
    }).filter(Boolean));
};

const readPalworldSettings = async (settingsPath) => {
    if (!settingsPath) return { available: false, path: '', error: 'PALWORLD_SETTINGS_PATH is not configured' };
    try {
        const text = await readFile(settingsPath, 'utf8');
        return { available: true, path: settingsPath, values: parseOptionSettings(text) };
    } catch (error) {
        return { available: false, path: settingsPath, error: error.message };
    }
};

const createPalworldSettings = ({ config }) => ({
    getSettings: () => readPalworldSettings(config.settingsPath)
});

export { createPalworldSettings };
