const { ApiError } = require('./security');

function requestId() {
  return crypto.randomUUID();
}

function setSecurityHeaders(res, requestIdValue) {
  res.setHeader('X-Request-Id', requestIdValue);
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('Permissions-Policy', 'geolocation=(self), camera=(), microphone=()');
  res.setHeader('Cross-Origin-Resource-Policy', 'same-site');
  res.setHeader('Cache-Control', 'no-store');
}

function applyCors(req, res, origins) {
  const origin = req.headers.origin;
  if (!origin) return true;
  if (!origins.includes(origin)) return false;
  res.setHeader('Access-Control-Allow-Origin', origin);
  res.setHeader('Vary', 'Origin');
  res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type, Idempotency-Key, X-Request-Id');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PATCH, OPTIONS');
  res.setHeader('Access-Control-Max-Age', '600');
  return true;
}

function sendJson(res, status, body) {
  const serialized = JSON.stringify(body);
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Content-Length': Buffer.byteLength(serialized) });
  res.end(serialized);
}

async function readJsonBody(req, maxBytes) {
  const contentType = String(req.headers['content-type'] || '').toLowerCase();
  if (!contentType.includes('application/json')) {
    throw new ApiError(415, 'UNSUPPORTED_MEDIA_TYPE', 'Requests must use application/json.');
  }
  let size = 0;
  const chunks = [];
  for await (const chunk of req) {
    size += chunk.length;
    if (size > maxBytes) throw new ApiError(413, 'PAYLOAD_TOO_LARGE', 'Request body is too large.');
    chunks.push(chunk);
  }
  if (!chunks.length) return {};
  try {
    const parsed = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    if (!parsed || Array.isArray(parsed) || typeof parsed !== 'object') {
      throw new ApiError(422, 'VALIDATION_ERROR', 'Request body must be an object.');
    }
    return parsed;
  } catch (error) {
    if (error instanceof ApiError) throw error;
    throw new ApiError(400, 'INVALID_JSON', 'Request body must contain valid JSON.');
  }
}

function parseUrl(req) {
  return new URL(req.url, `http://${req.headers.host || 'localhost'}`);
}

function parsePagination(url, { defaultLimit = 20, maxLimit = 50 } = {}) {
  const requested = Number.parseInt(url.searchParams.get('limit'), 10);
  const limit = Number.isSafeInteger(requested) ? Math.max(1, Math.min(requested, maxLimit)) : defaultLimit;
  const offsetRaw = Number.parseInt(url.searchParams.get('offset'), 10);
  const offset = Number.isSafeInteger(offsetRaw) ? Math.max(0, offsetRaw) : 0;
  return { limit, offset };
}

function clientIp(req) {
  const forwarded = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim();
  return forwarded || req.socket.remoteAddress || 'unknown';
}

function toErrorBody(error, requestIdValue, production) {
  const apiError = error instanceof ApiError
    ? error
    : new ApiError(500, 'INTERNAL_ERROR', production ? 'An unexpected error occurred.' : error.message || 'An unexpected error occurred.');
  return {
    status: apiError.status || 500,
    body: {
      error: {
        code: apiError.code || 'INTERNAL_ERROR',
        message: apiError.message || 'An unexpected error occurred.',
        ...(apiError.details ? { details: apiError.details } : {}),
        requestId: requestIdValue
      }
    }
  };
}

module.exports = {
  applyCors,
  clientIp,
  parsePagination,
  parseUrl,
  readJsonBody,
  requestId,
  sendJson,
  setSecurityHeaders,
  toErrorBody
};
