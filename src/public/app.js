const $ = (selector) => document.querySelector(selector);
const state = { players: [], refreshTimer: null, refreshInterval: 30_000, settingsDraft: null };

const escapeHtml = (value = '') => {
    return String(value).replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' }[char]));
};

const setConnection = (online, label = online ? 'Online' : 'Offline') => {
    $('#connection-dot').className = online ? 'online' : 'offline';
    $('#connection-label').textContent = label;
};

const showToast = (message, kind = 'success') => {
    const toast = $('#toast');
    toast.textContent = message;
    toast.className = `toast visible ${kind}`;
    window.clearTimeout(showToast.timer);
    showToast.timer = window.setTimeout(() => { toast.className = 'toast'; }, 3500);
};

const value = (...values) => values.find((item) => item !== undefined && item !== null && item !== '') ?? '—';

const renderPlayers = (payload, maxPlayers) => {
    state.players = payload?.players || [];
    const currentPlayers = value(payload?.numplayers, state.players.length);
    $('#player-count').textContent = maxPlayers ? `${currentPlayers} / ${maxPlayers}` : currentPlayers;
    if (!state.players.length) {
        $('#players').innerHTML = '<div class="empty">No players are online right now.</div>';
        return;
    }
    $('#players').innerHTML = state.players.map((player) => {
        const id = player.userid || player.playerId || player.steamId || '';
        return `<div class="player"><div class="avatar">${escapeHtml(String(player.name || '?').slice(0, 1).toUpperCase())}</div><div class="player-name"><strong>${escapeHtml(player.name || 'Unknown')}</strong><span>${escapeHtml(id || 'ID unavailable')}</span></div><div class="player-actions"><button class="mini-button" data-player-action="kick" data-player-id="${escapeHtml(id)}">Kick</button><button class="mini-button ban" data-player-action="ban" data-player-id="${escapeHtml(id)}">Ban</button></div></div>`;
    }).join('');
};

const renderStatus = (status) => {
    const info = status.info || {};
    const metrics = status.metrics || {};
    const offline = status.serverOnline === false;
    $('#server-name').textContent = offline ? 'Palworld server is offline' : value(info.servername, info.serverName, 'Palworld server');
    $('#server-description').textContent = offline
        ? value(status.serverError, 'Click Start server to launch Palworld')
        : value(info.description, 'Connected to Palworld REST API');
    $('#server-version').textContent = offline ? 'Offline' : value(info.version, 'REST API');
    const startButton = $('#start-button');
    startButton.disabled = status.demo || !offline;
    startButton.textContent = status.demo ? 'Demo mode' : offline ? 'Start server' : 'Server running';
    $('#uptime').textContent = formatUptime(value(metrics.uptime, metrics.serveruptime, '—'));
    $('#fps').textContent = value(metrics.serverfps, metrics.fps, '—');
    $('#frame-time').textContent = formatMetric(metrics.serverframetime, 'ms');
    $('#basecamps').textContent = value(metrics.basecampnum, '—');
    $('#world-days').textContent = value(metrics.days, '—');
    renderPlayers(status.players, metrics.maxplayernum);
    renderHost(status.host);
    renderSchedule(status.schedule);
    renderServerSettings(status.settings, status.demo);
    const updated = `Updated ${new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`;
    $('#metrics-updated').textContent = updated;
    $('#last-updated').textContent = updated;
    $('#host-updated').textContent = updated;
};
const renderHost = (host) => {
    if (!host?.available) {
        ['#host-cpu', '#host-memory', '#host-rx', '#host-tx'].forEach((selector) => { $(selector).textContent = '—'; });
        $('#host-status').textContent = 'Host resource metrics are unavailable.';
        return;
    }
    const memory = host.memory || {};
    const network = host.network || {};
    $('#host-cpu').textContent = formatMetric(host.cpuPercent, '%');
    $('#host-memory').textContent = `${formatBytes(memory.usedBytes)} / ${formatBytes(memory.totalBytes)} (${value(memory.usedPercent, '—')}%)`;
    $('#host-rx').textContent = `${formatBytes(network.rxBytesPerSec)}/s`;
    $('#host-tx').textContent = `${formatBytes(network.txBytesPerSec)}/s`;
    $('#host-status').textContent = 'CPU, memory, and network readings from this Node.js host.';
};

const renderSchedule = (schedule) => {
    const active = schedule?.enabled && schedule?.running;
    $('#schedule-status').textContent = active ? 'Enabled' : 'Disabled';
    $('#schedule-status').className = active ? 'tag active' : 'tag';
    $('#next-start').textContent = formatScheduleDate(schedule?.nextStart);
    $('#next-stop').textContent = formatScheduleDate(schedule?.nextStop);
    $('#schedule-hint').textContent = active
        ? `Random start ${schedule.startWindow}; random stop ${schedule.stopWindow} (Windows local time).`
        : 'Enable PALWORLD_SCHEDULE_ENABLED in .env to activate this schedule.';
};

const formatScheduleDate = (date) => {
    if (!date) return '—';
    return new Date(date).toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
};

const formatBytes = (bytes) => {
    const numeric = Number(bytes);
    if (!Number.isFinite(numeric)) return '—';
    if (numeric < 1024) return `${numeric.toFixed(0)} B`;
    const units = ['KB', 'MB', 'GB', 'TB'];
    let size = numeric;
    let unit = -1;
    do { size /= 1024; unit += 1; } while (size >= 1024 && unit < units.length - 1);
    return `${size.toFixed(size >= 100 ? 0 : 1)} ${units[unit]}`;
};

const formatUptime = (seconds) => {
    if (seconds === '—' || Number.isNaN(Number(seconds))) return seconds;
    const total = Number(seconds);
    const days = Math.floor(total / 86400);
    const hours = Math.floor((total % 86400) / 3600);
    const minutes = Math.floor((total % 3600) / 60);
    return days ? `${days}d ${hours}h` : `${hours}h ${minutes}m`;
};

const formatMetric = (metric, unit) => {
    if (metric === undefined || metric === null || metric === '') return '—';
    const numeric = Number(metric);
    return Number.isFinite(numeric) ? `${numeric.toFixed(numeric % 1 ? 1 : 0)} ${unit}` : '—';
};

const isSensitiveSetting = (key) => /password|secret|token/i.test(key);

const collectSettingsChanges = () => Object.fromEntries([...document.querySelectorAll('#server-settings [data-setting-key]')]
    .map((input) => [input.dataset.settingKey, input.value])
    .filter(([key, value]) => !isSensitiveSetting(key) || value));

const renderServerSettings = (settings = {}, demo = false) => {
    const entries = Object.entries(settings.values || {}).sort(([left], [right]) => left.localeCompare(right));
    $('#server-settings-status').textContent = settings.available ? `${entries.length} settings` : 'Unavailable';
    $('#server-settings-path').textContent = settings.path ? `Source: ${settings.path}` : (settings.error || 'Settings file unavailable');
    $('#settings-pending').textContent = settings.pending ? 'Changes staged; waiting for shutdown.' : 'Changes are written after Palworld is confirmed offline.';
    $('#stage-settings-button').disabled = !settings.available;
    if (!settings.available) {
        $('#server-settings').innerHTML = `<div class="empty">${escapeHtml(settings.error || 'PalWorldSettings.ini is unavailable.')}</div>`;
        return;
    }
    const draft = state.settingsDraft || {};
    const redactedKeys = new Set(settings.redactedKeys || []);
    $('#server-settings').innerHTML = entries.map(([key, rawValue]) => {
        const sensitive = isSensitiveSetting(key);
        const displayValue = Object.hasOwn(draft, key) ? draft[key] : (sensitive ? '' : rawValue);
        const placeholder = sensitive ? (redactedKeys.has(key) ? 'Configured; enter a replacement' : 'Not configured') : '';
        return `<div class="setting-item"><label for="setting-${escapeHtml(key)}">${escapeHtml(key)}</label><input id="setting-${escapeHtml(key)}" class="setting-input" data-setting-key="${escapeHtml(key)}" type="${sensitive ? 'password' : 'text'}" value="${escapeHtml(displayValue)}" placeholder="${placeholder}"></div>`;
    }).join('');
};

const stageSettings = async () => {
    const button = $('#stage-settings-button');
    button.disabled = true;
    try {
        const result = await request('/api/settings', { method: 'POST', body: JSON.stringify({ changes: collectSettingsChanges() }) });
        state.settingsDraft = null;
        showToast(result.fileBacked ? 'Settings staged for the next shutdown' : 'Mock settings updated in memory');
        await refresh();
    } catch (error) {
        showToast(error.message, 'error');
        button.disabled = false;
    }
};

const request = async (url, options = {}) => {
    const response = await fetch(url, { headers: { 'Content-Type': 'application/json' }, ...options });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || 'Request failed');
    return data;
};

const refresh = async () => {
    try {
        const status = await request('/api/status');
        renderStatus(status);
        setConnection(status.serverOnline !== false, status.demo ? 'Demo mode' : status.serverOnline === false ? 'Server offline' : 'Online');
    } catch (error) {
        setConnection(false, 'Dashboard unavailable');
        showToast(error.message, 'error');
    }
};

const action = async (action, payload = {}) => {
    try {
        await request('/api/action', { method: 'POST', body: JSON.stringify({ action, ...payload }) });
        showToast(`${action[0].toUpperCase()}${action.slice(1)} request sent`);
        await refresh();
    } catch (error) { showToast(error.message, 'error'); }
};
$('#server-settings').addEventListener('input', (event) => {
    const input = event.target.closest('[data-setting-key]');
    if (!input) return;
    state.settingsDraft = { ...(state.settingsDraft || {}), [input.dataset.settingKey]: input.value };
});

$('#stage-settings-button').addEventListener('click', stageSettings);

$('#start-button').addEventListener('click', async () => {
    if (!window.confirm('Launch the configured Palworld server?')) return;
    const button = $('#start-button');
    button.disabled = true;
    await action('start');
});

$('#announce-button').addEventListener('click', async () => {
    const message = $('#announcement').value.trim();
    if (!message) return showToast('Write a message first', 'error');
    await action('announce', { message });
    $('#announcement').value = '';
});

$('.action-card').addEventListener('click', async (event) => {
    const button = event.target.closest('[data-action]');
    if (!button) return;
    if (button.dataset.action === 'save') return action('save');
});

$('#shutdown-button').addEventListener('click', async () => {
    const minutesInput = window.prompt('Shut down in how many minutes?', '5');
    if (minutesInput === null) return;
    const minutes = Number(minutesInput);
    if (!Number.isFinite(minutes) || minutes <= 0 || minutes > 1440) {
        return showToast('Enter a shutdown delay between 0.1 and 1440 minutes', 'error');
    }
    const waittime = Math.max(1, Math.round(minutes * 60));
    const displayedMinutes = Number((waittime / 60).toFixed(2));
    if (window.confirm(`Shut down the Palworld server in ${displayedMinutes} minute${displayedMinutes === 1 ? '' : 's'}?`)) {
        await action('shutdown', { waittime });
    }
});

$('#players').addEventListener('click', async (event) => {
    const button = event.target.closest('[data-player-action]');
    if (!button || !button.dataset.playerId) return showToast('This player has no usable ID', 'error');
    const actionName = button.dataset.playerAction;
    if (window.confirm(`${actionName === 'ban' ? 'Ban' : 'Kick'} this player?`)) await action(actionName, { userid: button.dataset.playerId });
});

$('#refresh-button').addEventListener('click', () => refresh(true));
$('#refresh-interval').addEventListener('change', (event) => {
    state.refreshInterval = Number(event.target.value) * 1000;
    scheduleRefresh();
    showToast(state.refreshInterval ? `Auto refresh set to ${event.target.options[event.target.selectedIndex].text}` : 'Auto refresh disabled');
});

const scheduleRefresh = () => {
    window.clearInterval(state.refreshTimer);
    state.refreshTimer = state.refreshInterval ? window.setInterval(refresh, state.refreshInterval) : null;
};

refresh();
scheduleRefresh();
