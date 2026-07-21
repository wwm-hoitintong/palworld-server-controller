export function createNotifications({ config }) {
  async function sendDiscord(content) {
    if (!config.discordWebhookUrl) return;
    const response = await fetch(config.discordWebhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: config.discordUsername, content, allowed_mentions: { parse: [] } }),
      signal: AbortSignal.timeout(10_000)
    });
    if (!response.ok) throw new Error(`Discord webhook returned ${response.status}`);
  }

  async function announceStarted() {
    await sendDiscord('🟢 Palworld server is now online.');
  }

  async function announceShutdown(seconds) {
    const message = seconds >= 60 ? `${seconds / 60} minutes` : `${seconds} seconds`;
    let WholeMessage = `🟠 Palworld server will shut down in ${message}.` 
    if(seconds == 30){
      WholeMessage += ' Log out now!'
    }
    if(seconds == 1){
      WholeMessage = `🟠 Palworld server shutdown now, bye~`
    }
    await sendDiscord(WholeMessage);
  }

  return { sendDiscord, announceStarted, announceShutdown };
}
