import { spawn } from 'node:child_process';

export function createPalworldProcess({ config, endpoints, client }) {
  let startPromise = null;

  async function start() {
    if (startPromise) return startPromise;
    startPromise = (async () => {
      if (config.demoMode) return { demo: true };
      if (!config.serverCommand) throw new Error('PALWORLD_SERVER_COMMAND is not configured');
      try {
        await client.call(endpoints.info);
        console.log('[palworld] REST API is already online; skipping process launch');
        return { alreadyRunning: true };
      } catch (error) {
        if (error.status) {
          throw new Error(`Palworld REST API returned HTTP ${error.status} before startup; check PALWORLD_API_URL and credentials`);
        }
        console.log(`[palworld] REST API is offline; launching ${config.serverCommand}`);
      }
      console.log(`[palworld] spawn command: ${config.serverCommand}`);
      console.log(`[palworld] spawn cwd: ${config.serverCwd || '(default)'}`);
      const child = spawn(config.serverCommand, config.serverArgs, {
        cwd: config.serverCwd || undefined,
        detached: true,
        stdio: 'ignore',
        windowsHide: false
      });
      await new Promise((resolve, reject) => {
        child.once('spawn', resolve);
        child.once('error', reject);
      });
      child.unref();
      console.log('[palworld] process spawned; waiting for REST API readiness');
      await client.waitForReady();
      console.log('[palworld] REST API is ready');
      return { started: true };
    })();
    try {
      return await startPromise;
    } finally {
      startPromise = null;
    }
  }

  async function stop() {
    if (config.demoMode) return { demo: true };
    await client.call(endpoints.shutdown, { waittime: 30, message: 'Scheduled server shutdown' });
    console.log('Requested scheduled Palworld shutdown');
    return { shutdownRequested: true };
  }

  return { start, stop };
}
