'use strict';

/**
 * Stable error codes exposed by the allocation domain.  Keep these values
 * independent of any HTTP framework so a server can map them consistently.
 */
const ERROR_CODES = Object.freeze({
  INVALID_ARGUMENT: 'INVALID_ARGUMENT',
  INVALID_TIMESTAMP: 'INVALID_TIMESTAMP',
  INVALID_TIME_ZONE: 'INVALID_TIME_ZONE',
  NONEXISTENT_LOCAL_TIME: 'NONEXISTENT_LOCAL_TIME',
  AMBIGUOUS_LOCAL_TIME: 'AMBIGUOUS_LOCAL_TIME',
  INVALID_INTERVAL: 'INVALID_INTERVAL',
  INVALID_CAPACITY: 'INVALID_CAPACITY',
  INVALID_REQUIREMENTS: 'INVALID_REQUIREMENTS',
  INVALID_SPACE: 'INVALID_SPACE',
  INVALID_BOOKING_RECORD: 'INVALID_BOOKING_RECORD',
  INVALID_PRICING: 'INVALID_PRICING',
  PRICE_OVERFLOW: 'PRICE_OVERFLOW',
  SPACE_NOT_FOUND: 'SPACE_NOT_FOUND',
  SPACE_INELIGIBLE: 'SPACE_INELIGIBLE',
  CAPACITY_UNAVAILABLE: 'CAPACITY_UNAVAILABLE',
  RESOURCE_UNAVAILABLE: 'RESOURCE_UNAVAILABLE',
  BOOKING_NOT_FOUND: 'BOOKING_NOT_FOUND',
  IDEMPOTENCY_CONFLICT: 'IDEMPOTENCY_CONFLICT',
  INVALID_STATE: 'INVALID_STATE',
  HOLD_EXPIRED: 'HOLD_EXPIRED',
});

const HTTP_STATUS_BY_CODE = Object.freeze({
  [ERROR_CODES.INVALID_ARGUMENT]: 400,
  [ERROR_CODES.INVALID_TIMESTAMP]: 400,
  [ERROR_CODES.INVALID_TIME_ZONE]: 400,
  [ERROR_CODES.NONEXISTENT_LOCAL_TIME]: 400,
  [ERROR_CODES.AMBIGUOUS_LOCAL_TIME]: 400,
  [ERROR_CODES.INVALID_INTERVAL]: 400,
  [ERROR_CODES.INVALID_CAPACITY]: 400,
  [ERROR_CODES.INVALID_REQUIREMENTS]: 400,
  [ERROR_CODES.INVALID_SPACE]: 400,
  [ERROR_CODES.INVALID_BOOKING_RECORD]: 422,
  [ERROR_CODES.INVALID_PRICING]: 400,
  [ERROR_CODES.PRICE_OVERFLOW]: 422,
  [ERROR_CODES.SPACE_NOT_FOUND]: 404,
  [ERROR_CODES.SPACE_INELIGIBLE]: 409,
  [ERROR_CODES.CAPACITY_UNAVAILABLE]: 409,
  [ERROR_CODES.RESOURCE_UNAVAILABLE]: 409,
  [ERROR_CODES.BOOKING_NOT_FOUND]: 404,
  [ERROR_CODES.IDEMPOTENCY_CONFLICT]: 409,
  [ERROR_CODES.INVALID_STATE]: 409,
  [ERROR_CODES.HOLD_EXPIRED]: 409,
});

class ParkingError extends Error {
  constructor(code, message, details) {
    super(message || code);
    this.name = 'ParkingError';
    this.code = code;
    this.status = HTTP_STATUS_BY_CODE[code] || 400;
    if (details !== undefined) this.details = details;
    Error.captureStackTrace?.(this, ParkingError);
  }

  toJSON() {
    return {
      error: {
        code: this.code,
        message: this.message,
        ...(this.details === undefined ? {} : { details: this.details }),
      },
    };
  }
}

function domainError(code, message, details) {
  return new ParkingError(code, message, details);
}

module.exports = {
  ERROR_CODES,
  HTTP_STATUS_BY_CODE,
  ParkingError,
  domainError,
};
