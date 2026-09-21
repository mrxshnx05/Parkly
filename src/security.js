const crypto = require('node:crypto');

const BASE64URL = 'base64url';

class ApiError extends Error {
  constructor(status, code, message, details) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

function base64urlEncode(input) {
  return Buffer.from(typeof input === 'string' ? input : JSON.stringify(input)).toString(BASE64URL);
}

function base64urlDecode(input) {
  return JSON.parse(Buffer.from(input, BASE64URL).toString('utf8'));
}

function safeEqual(a, b) {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && crypto.timingSafeEqual(left, right);
}

function signAccessToken(payload, secret, ttlSeconds = 60 * 60 * 12) {
  const now = Math.floor(Date.now() / 1000);
  const body = { ...payload, iat: now, exp: now + ttlSeconds, jti: crypto.randomUUID() };
  const header = { alg: 'HS256', typ: 'JWT' };
  const content = `${base64urlEncode(header)}.${base64urlEncode(body)}`;
  const signature = crypto.createHmac('sha256', secret).update(content).digest(BASE64URL);
  return `${content}.${signature}`;
}

function verifyAccessToken(token, secret) {
  if (typeof token !== 'string') throw new ApiError(401, 'UNAUTHENTICATED', 'Authentication is required.');
  const [encodedHeader, encodedPayload, signature, ...extra] = token.split('.');
  if (!encodedHeader || !encodedPayload || !signature || extra.length) throw new ApiError(401, 'INVALID_TOKEN', 'Invalid access token.');
  const content = `${encodedHeader}.${encodedPayload}`;
  const expected = crypto.createHmac('sha256', secret).update(content).digest(BASE64URL);
  if (!safeEqual(signature, expected)) throw new ApiError(401, 'INVALID_TOKEN', 'Invalid access token.');
  let payload;
  try { payload = base64urlDecode(encodedPayload); } catch { throw new ApiError(401, 'INVALID_TOKEN', 'Invalid access token.'); }
  if (!payload || typeof payload !== 'object' || payload.exp <= Math.floor(Date.now() / 1000)) {
    throw new ApiError(401, 'TOKEN_EXPIRED', 'Your session has expired.');
  }
  return payload;
}

function hashPassword(password, salt = crypto.randomBytes(16).toString('hex')) {
  if (typeof password !== 'string' || password.length < 10) {
    throw new ApiError(422, 'WEAK_PASSWORD', 'Password must be at least 10 characters long.');
  }
  const digest = crypto.scryptSync(password, salt, 64).toString('hex');
  return `scrypt$${salt}$${digest}`;
}

function verifyPassword(password, stored) {
  if (typeof password !== 'string' || typeof stored !== 'string') return false;
  const [kind, salt, digest] = stored.split('$');
  if (kind !== 'scrypt' || !salt || !digest) return false;
  const attempt = crypto.scryptSync(password, salt, 64).toString('hex');
  return safeEqual(attempt, digest);
}

function getBearerToken(header) {
  const [scheme, token, ...rest] = String(header || '').trim().split(/\s+/);
  return scheme?.toLowerCase() === 'bearer' && token && !rest.length ? token : null;
}

function sanitizeText(value, { maxLength = 280, field = 'value', required = false } = {}) {
  if (value === undefined || value === null || value === '') {
    if (required) throw new ApiError(422, 'VALIDATION_ERROR', `${field} is required.`, { field });
    return '';
  }
  if (typeof value !== 'string') throw new ApiError(422, 'VALIDATION_ERROR', `${field} must be text.`, { field });
  const normalized = value.normalize('NFKC').replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim();
  if (!normalized || normalized.length > maxLength) {
    throw new ApiError(422, 'VALIDATION_ERROR', `${field} must be between 1 and ${maxLength} characters.`, { field });
  }
  return normalized;
}

module.exports = {
  ApiError,
  getBearerToken,
  hashPassword,
  sanitizeText,
  signAccessToken,
  verifyAccessToken,
  verifyPassword
};
