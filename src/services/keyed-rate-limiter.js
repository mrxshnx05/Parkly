'use strict';

const { boundedInteger, clamp } = require('./utils');

class RateLimitConfigurationError extends Error {
  constructor(message) {
    super(message);
    this.name = 'RateLimitConfigurationError';
    this.code = 'RATE_LIMIT_CONFIGURATION_ERROR';
  }
}

class RateLimitKeyError extends Error {
  constructor(message) {
    super(message);
    this.name = 'RateLimitKeyError';
    this.code = 'RATE_LIMIT_KEY_ERROR';
  }
}

/**
 * A token-bucket rate limiter intended for a single Node process.
 *
 * It is deliberately keyed by an application-provided opaque identifier
 * (for example `user:<id>` or a hashed IP) rather than obtaining an IP itself.
 * That keeps proxy trust and privacy decisions in the HTTP layer.
 */
class KeyedRateLimiter {
  constructor({
    capacity = 60,
    windowMs = 60_000,
    maxKeys = 10_000,
    idleTtlMs,
    now = () => Date.now(),
  } = {}) {
    const normalizedCapacity = boundedInteger(capacity, { minimum: 1, maximum: 1_000_000 });
    const normalizedWindow = boundedInteger(windowMs, { minimum: 1, maximum: 86_400_000 });
    const normalizedMaxKeys = boundedInteger(maxKeys, { minimum: 1, maximum: 1_000_000 });

    if (!normalizedCapacity || !normalizedWindow || !normalizedMaxKeys || typeof now !== 'function') {
      throw new RateLimitConfigurationError('capacity, windowMs, maxKeys, and now must be valid values');
    }

    this.capacity = normalizedCapacity;
    this.windowMs = normalizedWindow;
    this.maxKeys = normalizedMaxKeys;
    this.refillPerMs = normalizedCapacity / normalizedWindow;
    this.idleTtlMs = boundedInteger(idleTtlMs, {
      minimum: normalizedWindow,
      maximum: 7 * 86_400_000,
      fallback: normalizedWindow * 2,
    });
    this.now = now;
    this.buckets = new Map();
  }

  consume(key, { cost = 1 } = {}) {
    const normalizedKey = this._validateKey(key);
    const normalizedCost = this._validateCost(cost);
    const currentTime = this._currentTime();

    this.prune(currentTime);
    let bucket = this.buckets.get(normalizedKey);

    if (!bucket) {
      this._ensureCapacity(currentTime);
      bucket = { tokens: this.capacity, lastRefillAt: currentTime, lastSeenAt: currentTime };
      this.buckets.set(normalizedKey, bucket);
    }

    this._refill(bucket, currentTime);
    bucket.lastSeenAt = currentTime;

    if (normalizedCost > this.capacity) {
      return this._result({
        allowed: false,
        bucket,
        cost: normalizedCost,
        currentTime,
        reason: 'cost_exceeds_capacity',
      });
    }

    if (bucket.tokens + Number.EPSILON < normalizedCost) {
      return this._result({
        allowed: false,
        bucket,
        cost: normalizedCost,
        currentTime,
        reason: 'rate_limited',
      });
    }

    bucket.tokens = clamp(bucket.tokens - normalizedCost, 0, this.capacity);
    return this._result({ allowed: true, bucket, cost: normalizedCost, currentTime });
  }

  peek(key) {
    const normalizedKey = this._validateKey(key);
    const currentTime = this._currentTime();
    const bucket = this.buckets.get(normalizedKey);

    if (!bucket) {
      return {
        limit: this.capacity,
        remaining: this.capacity,
        resetAt: currentTime,
        retryAfterMs: 0,
      };
    }

    this._refill(bucket, currentTime);
    bucket.lastSeenAt = currentTime;
    return {
      limit: this.capacity,
      remaining: Math.floor(bucket.tokens),
      resetAt: this._fullResetAt(bucket, currentTime),
      retryAfterMs: 0,
    };
  }

  reset(key) {
    this.buckets.delete(this._validateKey(key));
  }

  prune(currentTime = this._currentTime()) {
    let removed = 0;
    for (const [key, bucket] of this.buckets) {
      if (currentTime - bucket.lastSeenAt >= this.idleTtlMs) {
        this.buckets.delete(key);
        removed += 1;
      }
    }
    return removed;
  }

  get size() {
    return this.buckets.size;
  }

  _result({ allowed, bucket, cost, currentTime, reason }) {
    const missingTokens = Math.max(0, cost - bucket.tokens);
    const retryAfterMs = allowed || missingTokens === 0
      ? 0
      : Math.ceil(missingTokens / this.refillPerMs);

    return {
      allowed,
      reason: reason || null,
      limit: this.capacity,
      remaining: Math.floor(bucket.tokens),
      retryAfterMs,
      resetAt: this._fullResetAt(bucket, currentTime),
    };
  }

  _fullResetAt(bucket, currentTime) {
    const missingToFull = Math.max(0, this.capacity - bucket.tokens);
    return currentTime + Math.ceil(missingToFull / this.refillPerMs);
  }

  _refill(bucket, currentTime) {
    // A monotonic clock is ideal. If a system clock moves backwards, do not
    // mint tokens or punish callers; simply continue from the last known time.
    const elapsed = Math.max(0, currentTime - bucket.lastRefillAt);
    if (elapsed > 0) {
      bucket.tokens = clamp(bucket.tokens + elapsed * this.refillPerMs, 0, this.capacity);
      bucket.lastRefillAt = currentTime;
    }
  }

  _ensureCapacity(currentTime) {
    if (this.buckets.size < this.maxKeys) return;

    // Prefer removing the least recently used inactive key. This is bounded
    // and prevents untrusted identifier churn from growing the process heap.
    let oldestKey;
    let oldestSeenAt = Number.POSITIVE_INFINITY;
    for (const [key, bucket] of this.buckets) {
      if (bucket.lastSeenAt < oldestSeenAt) {
        oldestKey = key;
        oldestSeenAt = bucket.lastSeenAt;
      }
    }

    if (oldestKey !== undefined) {
      this.buckets.delete(oldestKey);
    }

    // Retain this variable for debuggability while avoiding accidental use of
    // a stale time in future modifications.
    void currentTime;
  }

  _validateKey(key) {
    if (typeof key !== 'string') {
      throw new RateLimitKeyError('Rate-limit key must be a string');
    }

    const normalized = key.trim();
    if (!normalized || normalized.length > 512) {
      throw new RateLimitKeyError('Rate-limit key must be between 1 and 512 characters');
    }

    return normalized;
  }

  _validateCost(cost) {
    const normalized = Number(cost);
    if (!Number.isFinite(normalized) || normalized <= 0 || normalized > 1_000_000) {
      throw new RateLimitConfigurationError('Rate-limit cost must be a finite positive number');
    }
    return normalized;
  }

  _currentTime() {
    const currentTime = this.now();
    if (!Number.isFinite(currentTime)) {
      throw new RateLimitConfigurationError('Clock must return a finite timestamp');
    }
    return currentTime;
  }
}

function rateLimitHeaders(result) {
  const headers = {
    'RateLimit-Limit': String(result.limit),
    'RateLimit-Remaining': String(result.remaining),
    'RateLimit-Reset': String(Math.ceil(result.resetAt / 1000)),
  };

  if (!result.allowed && result.retryAfterMs > 0) {
    headers['Retry-After'] = String(Math.ceil(result.retryAfterMs / 1000));
  }

  return headers;
}

module.exports = {
  KeyedRateLimiter,
  RateLimitConfigurationError,
  RateLimitKeyError,
  rateLimitHeaders,
};
