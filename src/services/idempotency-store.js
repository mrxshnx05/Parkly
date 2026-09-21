'use strict';

const { createHash } = require('node:crypto');
const { boundedInteger, isPlainObject, jsonClone } = require('./utils');

class IdempotencyError extends Error {
  constructor(message, code = 'IDEMPOTENCY_ERROR') {
    super(message);
    this.name = 'IdempotencyError';
    this.code = code;
  }
}

class IdempotencyConflictError extends IdempotencyError {
  constructor() {
    super('This idempotency key was already used for a different request', 'IDEMPOTENCY_KEY_CONFLICT');
    this.name = 'IdempotencyConflictError';
  }
}

class IdempotencyCapacityError extends IdempotencyError {
  constructor() {
    super('The idempotency store is temporarily at capacity', 'IDEMPOTENCY_STORE_CAPACITY');
    this.name = 'IdempotencyCapacityError';
  }
}

/**
 * Stable serialisation for request fingerprints. It sorts object keys, rejects
 * cycles and unsupported input types, and therefore avoids accidental replay
 * collisions caused by normal JSON key ordering differences.
 */
function stableStringify(value, seen = new WeakSet()) {
  if (value === null) return 'null';

  switch (typeof value) {
    case 'string':
      return JSON.stringify(value);
    case 'boolean':
      return value ? 'true' : 'false';
    case 'number':
      if (!Number.isFinite(value)) {
        throw new IdempotencyError('Request fingerprints cannot contain non-finite numbers', 'INVALID_FINGERPRINT');
      }
      return JSON.stringify(value);
    case 'undefined':
      return 'undefined';
    case 'bigint':
      return JSON.stringify(`${value}n`);
    case 'object':
      break;
    default:
      throw new IdempotencyError('Request fingerprints must contain JSON-like values', 'INVALID_FINGERPRINT');
  }

  if (seen.has(value)) {
    throw new IdempotencyError('Request fingerprints cannot contain cyclic values', 'INVALID_FINGERPRINT');
  }
  seen.add(value);

  let result;
  if (Array.isArray(value)) {
    result = `[${value.map((item) => stableStringify(item, seen)).join(',')}]`;
  } else if (isPlainObject(value)) {
    const keys = Object.keys(value).sort();
    result = `{${keys.map((key) => `${JSON.stringify(key)}:${stableStringify(value[key], seen)}`).join(',')}}`;
  } else {
    throw new IdempotencyError('Request fingerprints must contain plain objects only', 'INVALID_FINGERPRINT');
  }

  seen.delete(value);
  return result;
}

function createRequestFingerprint(payload) {
  return createHash('sha256').update(stableStringify(payload)).digest('hex');
}

/**
 * Process-local idempotency storage. Use a shared durable store (for example
 * Redis or a database table) before horizontally scaling the API. The public
 * API is intentionally small so that replacement is straightforward.
 */
class InMemoryIdempotencyStore {
  constructor({
    ttlMs = 24 * 60 * 60 * 1000,
    maxEntries = 10_000,
    now = () => Date.now(),
  } = {}) {
    this.ttlMs = boundedInteger(ttlMs, { minimum: 1_000, maximum: 7 * 24 * 60 * 60 * 1000 });
    this.maxEntries = boundedInteger(maxEntries, { minimum: 1, maximum: 1_000_000 });
    if (!this.ttlMs || !this.maxEntries || typeof now !== 'function') {
      throw new IdempotencyError('ttlMs, maxEntries, and now must be valid values', 'INVALID_CONFIGURATION');
    }

    this.now = now;
    this.entries = new Map();
  }

  /**
   * Runs an operation once for a key/fingerprint pair. A concurrent matching
   * request waits for the first operation and receives a replayed response.
   * Failed operations are removed so a client may safely retry.
   */
  async execute({ key, fingerprint, operation }) {
    const normalizedKey = this._validateKey(key);
    const normalizedFingerprint = this._validateFingerprint(fingerprint);
    if (typeof operation !== 'function') {
      throw new IdempotencyError('operation must be a function', 'INVALID_OPERATION');
    }

    const currentTime = this._currentTime();
    this.prune(currentTime);
    const existing = this.entries.get(normalizedKey);

    if (existing) {
      if (existing.fingerprint !== normalizedFingerprint) {
        throw new IdempotencyConflictError();
      }

      if (existing.status === 'completed') {
        return { replayed: true, value: jsonClone(existing.value) };
      }

      const value = await existing.promise;
      return { replayed: true, value: jsonClone(value) };
    }

    this._makeRoom();
    const entry = {
      fingerprint: normalizedFingerprint,
      status: 'pending',
      createdAt: currentTime,
      expiresAt: currentTime + this.ttlMs,
      value: undefined,
      promise: null,
    };

    // Deferring operation invocation until the next microtask means this entry
    // is visible before a synchronous operation can re-enter execute().
    entry.promise = Promise.resolve()
      .then(operation)
      .then((value) => {
        const storedValue = jsonClone(value);
        entry.status = 'completed';
        entry.value = storedValue;
        entry.expiresAt = this._currentTime() + this.ttlMs;
        return storedValue;
      })
      .catch((error) => {
        if (this.entries.get(normalizedKey) === entry) {
          this.entries.delete(normalizedKey);
        }
        throw error;
      });

    this.entries.set(normalizedKey, entry);
    const value = await entry.promise;
    return { replayed: false, value: jsonClone(value) };
  }

  get(key) {
    const normalizedKey = this._validateKey(key);
    const entry = this.entries.get(normalizedKey);
    if (!entry) return null;

    if (entry.status === 'completed' && entry.expiresAt <= this._currentTime()) {
      this.entries.delete(normalizedKey);
      return null;
    }

    return {
      status: entry.status,
      fingerprint: entry.fingerprint,
      createdAt: entry.createdAt,
      expiresAt: entry.expiresAt,
      value: entry.status === 'completed' ? jsonClone(entry.value) : undefined,
    };
  }

  prune(currentTime = this._currentTime()) {
    let removed = 0;
    for (const [key, entry] of this.entries) {
      // Never evict a live operation just because it is slow; that could make
      // a duplicate payment or booking possible. Production adapters should
      // pair this with operation timeouts at the request layer.
      if (entry.status === 'completed' && entry.expiresAt <= currentTime) {
        this.entries.delete(key);
        removed += 1;
      }
    }
    return removed;
  }

  clear() {
    this.entries.clear();
  }

  get size() {
    return this.entries.size;
  }

  _makeRoom() {
    if (this.entries.size < this.maxEntries) return;

    let oldestCompletedKey;
    let oldestCreatedAt = Number.POSITIVE_INFINITY;
    for (const [key, entry] of this.entries) {
      if (entry.status === 'completed' && entry.createdAt < oldestCreatedAt) {
        oldestCompletedKey = key;
        oldestCreatedAt = entry.createdAt;
      }
    }

    if (oldestCompletedKey !== undefined) {
      this.entries.delete(oldestCompletedKey);
      return;
    }

    throw new IdempotencyCapacityError();
  }

  _validateKey(key) {
    if (typeof key !== 'string') {
      throw new IdempotencyError('Idempotency key must be a string', 'INVALID_IDEMPOTENCY_KEY');
    }

    const normalized = key.trim();
    if (normalized.length < 8 || normalized.length > 200 || !/^[A-Za-z0-9._:-]+$/.test(normalized)) {
      throw new IdempotencyError(
        'Idempotency key must contain 8-200 URL-safe characters',
        'INVALID_IDEMPOTENCY_KEY',
      );
    }
    return normalized;
  }

  _validateFingerprint(fingerprint) {
    if (typeof fingerprint !== 'string' || !/^[a-f0-9]{32,128}$/i.test(fingerprint)) {
      throw new IdempotencyError('fingerprint must be a hexadecimal digest', 'INVALID_FINGERPRINT');
    }
    return fingerprint.toLowerCase();
  }

  _currentTime() {
    const value = this.now();
    if (!Number.isFinite(value)) {
      throw new IdempotencyError('Clock must return a finite timestamp', 'INVALID_CONFIGURATION');
    }
    return value;
  }
}

module.exports = {
  createRequestFingerprint,
  IdempotencyCapacityError,
  IdempotencyConflictError,
  IdempotencyError,
  InMemoryIdempotencyStore,
  stableStringify,
};
