const authHeader = (config) => `Basic ${Buffer.from(`${config.username}:${config.password}`).toString('base64')}`;

const call = async (config, endpoints, endpoint, body) => {
  const response = await fetch(`${config.apiUrl}${endpoint.path}`, {
    method: endpoint.method,
    headers: { Authorization: authHeader(config), 'Content-Type': 'application/json' },
    body: endpoint.method === 'POST' ? JSON.stringify(body || {}) : undefined,
    signal: AbortSignal.timeout(10_000)
  });
  const text = await response.text();
  let data;
  try { data = text ? JSON.parse(text) : {}; } catch { data = { message: text }; }
  if (!response.ok) {
    const error = new Error(data.message || `Palworld API returned ${response.status}`);
    error.status = response.status;
    throw error;
  }
  return data;
};

const waitForReady = async (endpoints, request, timeoutMs = 300_000) => {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      await request(endpoints.info);
      return;
    } catch (error) {
      if (error.status) throw error;
      await new Promise((resolve) => setTimeout(resolve, 5_000));
    }
  }
  throw new Error('Palworld server did not become ready within 5 minutes');
};

const createPalworldClient = ({ config, endpoints }) => {
  const request = call.bind(null, config, endpoints);
  return {
    call: request,
    waitForReady: waitForReady.bind(null, endpoints, request)
  };
};

export { createPalworldClient };
