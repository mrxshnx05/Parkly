'use strict';

/**
 * Small, dependency-free helpers shared by the service layer.  These helpers
 * deliberately accept only JSON-like values so untrusted HTTP input cannot
 * bring prototypes, functions, or mutable references into service state.
 */

function isPlainObject(value) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    return false;
  }

  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function clamp(value, minimum, maximum) {
  return Math.min(maximum, Math.max(minimum, value));
}

function toFiniteNumber(value) {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }

  if (typeof value === 'string' && value.trim() !== '') {
    const number = Number(value);
    return Number.isFinite(number) ? number : undefined;
  }

  return undefined;
}

function toBoolean(value) {
  if (typeof value === 'boolean') {
    return value;
  }

  if (typeof value === 'number') {
    if (value === 1) return true;
    if (value === 0) return false;
  }

  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase();
    if (['true', 'yes', 'y', '1', 'available'].includes(normalized)) return true;
    if (['false', 'no', 'n', '0', 'unavailable'].includes(normalized)) return false;
  }

  return undefined;
}

function cleanText(value, maximumLength = 2000) {
  if (typeof value !== 'string') {
    return '';
  }

  const withoutControlCharacters = value
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  return withoutControlCharacters.slice(0, Math.max(0, maximumLength));
}

function asArray(value, maximumLength = 50) {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.slice(0, Math.max(0, maximumLength));
}

function uniqueStrings(values, maximumLength = 50) {
  const result = [];
  const seen = new Set();

  for (const value of asArray(values, maximumLength * 2)) {
    const text = cleanText(String(value), 160);
    const fingerprint = text.toLocaleLowerCase('en-US');
    if (!text || seen.has(fingerprint)) continue;
    seen.add(fingerprint);
    result.push(text);
    if (result.length >= maximumLength) break;
  }

  return result;
}

function jsonClone(value) {
  // Node 24 provides structuredClone. The JSON fallback makes the contract
  // explicit for callers: only JSON-safe values may be cached or replayed.
  if (typeof globalThis.structuredClone === 'function') {
    return globalThis.structuredClone(value);
  }

  if (value === undefined) return undefined;
  return JSON.parse(JSON.stringify(value));
}

function boundedInteger(value, { minimum = 0, maximum = Number.MAX_SAFE_INTEGER, fallback } = {}) {
  const numeric = toFiniteNumber(value);
  if (numeric === undefined || !Number.isInteger(numeric)) {
    return fallback;
  }

  if (numeric < minimum || numeric > maximum) {
    return fallback;
  }

  return numeric;
}

module.exports = {
  asArray,
  boundedInteger,
  clamp,
  cleanText,
  isPlainObject,
  jsonClone,
  toBoolean,
  toFiniteNumber,
  uniqueStrings,
};
