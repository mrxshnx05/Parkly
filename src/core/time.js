'use strict';

const { ERROR_CODES, domainError } = require('./errors');

const OFFSET_DATE_TIME_RE = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2})(\.(\d{1,3}))?)?(Z|[+-]\d{2}:?\d{2})$/i;
const LOCAL_DATE_TIME_RE = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2})(\.(\d{1,3}))?)?$/;
const formatterCache = new Map();

function assertTimeZone(timeZone) {
  if (typeof timeZone !== 'string' || timeZone.trim() === '') {
    throw domainError(ERROR_CODES.INVALID_TIME_ZONE, 'An IANA time zone is required.');
  }

  const normalized = timeZone.trim();
  try {
    // Constructing a formatter validates the IANA identifier without relying on
    // host-local time-zone settings.
    new Intl.DateTimeFormat('en-US', { timeZone: normalized }).format(0);
  } catch {
    throw domainError(ERROR_CODES.INVALID_TIME_ZONE, 'The supplied time zone is not valid.', { timeZone });
  }
  return normalized;
}

function getFormatter(timeZone) {
  const normalized = assertTimeZone(timeZone);
  let formatter = formatterCache.get(normalized);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat('en-US-u-ca-iso8601-nu-latn', {
      timeZone: normalized,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hourCycle: 'h23',
    });
    formatterCache.set(normalized, formatter);
  }
  return formatter;
}

function numberPart(parts, type) {
  const part = parts.find((item) => item.type === type)?.value;
  return Number(part);
}

function localPartsAt(epochMs, timeZone) {
  if (!Number.isFinite(epochMs)) {
    throw domainError(ERROR_CODES.INVALID_TIMESTAMP, 'Timestamp must be finite.');
  }
  const parts = getFormatter(timeZone).formatToParts(new Date(epochMs));
  const hour = numberPart(parts, 'hour');
  return {
    year: numberPart(parts, 'year'),
    month: numberPart(parts, 'month'),
    day: numberPart(parts, 'day'),
    // ICU normally honors h23. Guard against an implementation rendering 24:00.
    hour: hour === 24 ? 0 : hour,
    minute: numberPart(parts, 'minute'),
    second: numberPart(parts, 'second'),
  };
}

function validateCalendarParts(parts, value) {
  const { year, month, day, hour, minute, second, millisecond } = parts;
  if (
    !Number.isInteger(year) || year < 1000 || year > 9999 ||
    !Number.isInteger(month) || month < 1 || month > 12 ||
    !Number.isInteger(day) || day < 1 || day > 31 ||
    !Number.isInteger(hour) || hour < 0 || hour > 23 ||
    !Number.isInteger(minute) || minute < 0 || minute > 59 ||
    !Number.isInteger(second) || second < 0 || second > 59 ||
    !Number.isInteger(millisecond) || millisecond < 0 || millisecond > 999
  ) {
    throw domainError(ERROR_CODES.INVALID_TIMESTAMP, 'Timestamp has invalid calendar fields.', { value });
  }

  const candidate = new Date(Date.UTC(year, month - 1, day, hour, minute, second, millisecond));
  if (
    candidate.getUTCFullYear() !== year ||
    candidate.getUTCMonth() !== month - 1 ||
    candidate.getUTCDate() !== day ||
    candidate.getUTCHours() !== hour ||
    candidate.getUTCMinutes() !== minute ||
    candidate.getUTCSeconds() !== second ||
    candidate.getUTCMilliseconds() !== millisecond
  ) {
    throw domainError(ERROR_CODES.INVALID_TIMESTAMP, 'Timestamp is not a real calendar date.', { value });
  }
}

function parseMatchedDateTime(match, value) {
  const fraction = match[8] || '';
  const parts = {
    year: Number(match[1]),
    month: Number(match[2]),
    day: Number(match[3]),
    hour: Number(match[4]),
    minute: Number(match[5]),
    second: Number(match[6] || 0),
    millisecond: fraction === '' ? 0 : Number(fraction.padEnd(3, '0')),
  };
  validateCalendarParts(parts, value);
  return parts;
}

function sameLocalParts(left, right) {
  return left.year === right.year &&
    left.month === right.month &&
    left.day === right.day &&
    left.hour === right.hour &&
    left.minute === right.minute &&
    left.second === right.second;
}

function timeZoneOffsetMs(epochMs, timeZone) {
  const parts = localPartsAt(epochMs, timeZone);
  const asUtc = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second);
  const epochSecond = Math.floor(epochMs / 1000) * 1000;
  return asUtc - epochSecond;
}

function possibleInstantsForLocal(parts, timeZone) {
  const wallMs = Date.UTC(
    parts.year,
    parts.month - 1,
    parts.day,
    parts.hour,
    parts.minute,
    parts.second,
    parts.millisecond,
  );

  // Sampling a wide window captures offsets on both sides of a DST transition,
  // including regions whose changes do not occur on a whole hour.
  const offsets = new Set();
  for (let hours = -48; hours <= 48; hours += 3) {
    offsets.add(timeZoneOffsetMs(wallMs + hours * 60 * 60 * 1000, timeZone));
  }

  const candidates = [];
  for (const offset of offsets) {
    const candidate = wallMs - offset;
    if (sameLocalParts(localPartsAt(candidate, timeZone), parts)) {
      candidates.push(candidate);
    }
  }
  return [...new Set(candidates)].sort((a, b) => a - b);
}

function parseOffsetDateTime(value, match) {
  const parts = parseMatchedDateTime(match, value);
  const rawOffset = match[9];
  const normalizedOffset = rawOffset.toUpperCase() === 'Z'
    ? 'Z'
    : `${rawOffset.slice(0, 3)}:${rawOffset.slice(rawOffset.length - 2)}`;

  if (normalizedOffset !== 'Z') {
    const offsetHour = Number(normalizedOffset.slice(1, 3));
    const offsetMinute = Number(normalizedOffset.slice(4, 6));
    if (offsetHour > 23 || offsetMinute > 59) {
      throw domainError(ERROR_CODES.INVALID_TIMESTAMP, 'Timestamp has an invalid UTC offset.', { value });
    }
  }

  const seconds = String(parts.second).padStart(2, '0');
  const milliseconds = parts.millisecond === 0 ? '' : `.${String(parts.millisecond).padStart(3, '0')}`;
  const canonical = `${String(parts.year).padStart(4, '0')}-${String(parts.month).padStart(2, '0')}-${String(parts.day).padStart(2, '0')}T${String(parts.hour).padStart(2, '0')}:${String(parts.minute).padStart(2, '0')}:${seconds}${milliseconds}${normalizedOffset}`;
  const epochMs = Date.parse(canonical);
  if (!Number.isFinite(epochMs)) {
    throw domainError(ERROR_CODES.INVALID_TIMESTAMP, 'Timestamp could not be parsed.', { value });
  }
  return epochMs;
}

/**
 * Converts an ISO instant, epoch millisecond value, Date, or time-zone-local
 * datetime into an epoch millisecond value. Local datetimes are intentionally
 * rejected when they are ambiguous or do not exist during a DST transition,
 * unless callers explicitly select an earlier/later occurrence.
 */
function parseDateTime(value, { timeZone, disambiguation = 'reject' } = {}) {
  if (value instanceof Date) {
    const epochMs = value.getTime();
    if (!Number.isFinite(epochMs)) {
      throw domainError(ERROR_CODES.INVALID_TIMESTAMP, 'Date is invalid.');
    }
    return epochMs;
  }

  if (typeof value === 'number') {
    if (!Number.isSafeInteger(value)) {
      throw domainError(ERROR_CODES.INVALID_TIMESTAMP, 'Epoch milliseconds must be a safe integer.', { value });
    }
    return value;
  }

  if (typeof value !== 'string' || value.trim() === '') {
    throw domainError(ERROR_CODES.INVALID_TIMESTAMP, 'A datetime value is required.', { value });
  }

  const source = value.trim();
  const offsetMatch = source.match(OFFSET_DATE_TIME_RE);
  if (offsetMatch) return parseOffsetDateTime(source, offsetMatch);

  const localMatch = source.match(LOCAL_DATE_TIME_RE);
  if (!localMatch) {
    throw domainError(
      ERROR_CODES.INVALID_TIMESTAMP,
      'Use an ISO datetime with an offset, or a local ISO datetime plus an IANA time zone.',
      { value },
    );
  }

  const normalizedTimeZone = assertTimeZone(timeZone);
  const parts = parseMatchedDateTime(localMatch, source);
  const candidates = possibleInstantsForLocal(parts, normalizedTimeZone);
  if (candidates.length === 0) {
    throw domainError(ERROR_CODES.NONEXISTENT_LOCAL_TIME, 'This local time does not exist in the supplied time zone.', {
      value,
      timeZone: normalizedTimeZone,
    });
  }
  if (candidates.length > 1) {
    if (disambiguation === 'earlier') return candidates[0];
    if (disambiguation === 'later') return candidates[candidates.length - 1];
    throw domainError(ERROR_CODES.AMBIGUOUS_LOCAL_TIME, 'This local time occurs more than once in the supplied time zone.', {
      value,
      timeZone: normalizedTimeZone,
      choices: candidates.map((candidate) => new Date(candidate).toISOString()),
    });
  }
  return candidates[0];
}

function formatOffset(offsetMs) {
  const sign = offsetMs < 0 ? '-' : '+';
  const absoluteMinutes = Math.round(Math.abs(offsetMs) / 60000);
  return `${sign}${String(Math.floor(absoluteMinutes / 60)).padStart(2, '0')}:${String(absoluteMinutes % 60).padStart(2, '0')}`;
}

function formatDateTimeInTimeZone(epochMs, timeZone) {
  const parts = localPartsAt(epochMs, timeZone);
  const milliseconds = Math.abs(epochMs % 1000);
  const fraction = milliseconds === 0 ? '' : `.${String(milliseconds).padStart(3, '0')}`;
  return `${String(parts.year).padStart(4, '0')}-${String(parts.month).padStart(2, '0')}-${String(parts.day).padStart(2, '0')}T${String(parts.hour).padStart(2, '0')}:${String(parts.minute).padStart(2, '0')}:${String(parts.second).padStart(2, '0')}${fraction}${formatOffset(timeZoneOffsetMs(epochMs, timeZone))}`;
}

function resolveBookingWindow(input) {
  if (!input || typeof input !== 'object') {
    throw domainError(ERROR_CODES.INVALID_ARGUMENT, 'Booking window must be an object.');
  }
  const timeZone = assertTimeZone(input.timeZone);
  const startValue = input.startAt ?? input.start;
  const endValue = input.endAt ?? input.end;
  const startEpochMs = parseDateTime(startValue, { timeZone, disambiguation: input.disambiguation });
  const endEpochMs = parseDateTime(endValue, { timeZone, disambiguation: input.disambiguation });

  if (endEpochMs <= startEpochMs) {
    throw domainError(ERROR_CODES.INVALID_INTERVAL, 'Booking end must be later than booking start.', {
      startAt: startValue,
      endAt: endValue,
    });
  }

  const durationMs = endEpochMs - startEpochMs;
  return Object.freeze({
    timeZone,
    startEpochMs,
    endEpochMs,
    startsAt: new Date(startEpochMs).toISOString(),
    endsAt: new Date(endEpochMs).toISOString(),
    durationMs,
    durationMinutes: durationMs / 60000,
    localStartsAt: formatDateTimeInTimeZone(startEpochMs, timeZone),
    localEndsAt: formatDateTimeInTimeZone(endEpochMs, timeZone),
  });
}

module.exports = {
  assertTimeZone,
  formatDateTimeInTimeZone,
  localPartsAt,
  parseDateTime,
  possibleInstantsForLocal,
  resolveBookingWindow,
  timeZoneOffsetMs,
};
