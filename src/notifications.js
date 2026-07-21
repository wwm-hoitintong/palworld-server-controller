const sendDiscord = async (config, content) => {
    if (!config.discordWebhookUrl) return;
    const response = await fetch(config.discordWebhookUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: config.discordUsername, content, allowed_mentions: { parse: [] } }),
        signal: AbortSignal.timeout(10_000)
    });
    if (!response.ok) throw new Error(`Discord webhook returned ${response.status}`);
};

const announceStarted = async (config) => {
    await sendDiscord(config, '🟢 Palworld server is now online.');
};

const announceShutdown = async (config, announceInGame, seconds) => {
    const message = seconds >= 60 ? `${seconds / 60} minutes` : `${seconds} seconds`;
    let WholeMessage = `🟠 Palworld server will shut down in ${message}.`
    if (seconds == 30) {
        WholeMessage += ' Log out now!'
    }
    if (seconds == 1) {
        WholeMessage = `🟠 Palworld server shutdown now, bye~`
    }
    const results = await Promise.allSettled([
        sendDiscord(config, WholeMessage),
        announceInGame(WholeMessage)
    ]);
    const failure = results.find((result) => result.status === 'rejected');
    if (failure) throw failure.reason;
};

const createNotifications = ({ config, announceInGame = async () => { } }) => ({
    sendDiscord: sendDiscord.bind(null, config),
    announceStarted: announceStarted.bind(null, config),
    announceShutdown: announceShutdown.bind(null, config, announceInGame)
});

export { createNotifications };
