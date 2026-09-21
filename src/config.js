const path = require('node:path');

function readCsv(value) {
  return String(value || '')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
}

function positiveInteger(value, fallback) {
  const parsed = Number.parseInt(value, 10);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function loadConfig(env = process.env) {
  const nodeEnv = env.NODE_ENV || 'development';
  const jwtSecret = env.PARKLY_JWT_SECRET || '';
  if (nodeEnv === 'production' && jwtSecret.length < 32) {
    throw new Error('PARKLY_JWT_SECRET must be at least 32 characters in production.');
  }

  const projectRoot = path.resolve(__dirname, '..');
  return Object.freeze({
    nodeEnv,
    port: positiveInteger(env.PORT, 8787),
    host: env.HOST || '127.0.0.1',
    apiPrefix: '/api/v1',
    dataPath: path.resolve(projectRoot, env.PARKLY_DATA_PATH || 'data/parkly-store.json'),
    jwtSecret: jwtSecret || 'development-only-change-me-before-deploying',
    corsOrigins: readCsv(env.PARKLY_CORS_ORIGINS || 'http://localhost:8787,http://127.0.0.1:8787'),
    maxBodyBytes: positiveInteger(env.MAX_BODY_BYTES, 1_048_576),
    requestWindowMs: positiveInteger(env.RATE_LIMIT_WINDOW_MS, 60_000),
    maxRequestsPerWindow: positiveInteger(env.RATE_LIMIT_MAX, 120),
    aiProvider: (env.PARKLY_AI_PROVIDER || 'auto').toLowerCase(),
    ollamaHost: env.OLLAMA_HOST || 'http://127.0.0.1:11434',
    ollamaModel: env.OLLAMA_MODEL || 'llama3.2:3b',
    mapsProviderKey: env.MAPS_PROVIDER_KEY || '',
    paymentsWebhookSecret: env.PAYMENTS_WEBHOOK_SECRET || '',
    notificationsWebhookUrl: env.NOTIFICATIONS_WEBHOOK_URL || ''
  });
}

module.exports = { loadConfig, readCsv, positiveInteger };
