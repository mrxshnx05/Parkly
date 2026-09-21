const { ApiError } = require('./security');

function asFiniteNumber(value, field) {
  const number = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(number)) throw new ApiError(422, 'VALIDATION_ERROR', `${field} must be a number.`, { field });
  return number;
}

function validateCoordinates(latitude, longitude) {
  const lat = asFiniteNumber(latitude, 'latitude');
  const lng = asFiniteNumber(longitude, 'longitude');
  if (lat < -90 || lat > 90 || lng < -180 || lng > 180) {
    throw new ApiError(422, 'VALIDATION_ERROR', 'Coordinates are outside valid geographic ranges.');
  }
  return { latitude: lat, longitude: lng };
}

function haversineKm(first, second) {
  const earthRadius = 6371;
  const toRadians = (degrees) => degrees * Math.PI / 180;
  const deltaLat = toRadians(second.latitude - first.latitude);
  const deltaLng = toRadians(second.longitude - first.longitude);
  const a = Math.sin(deltaLat / 2) ** 2 + Math.cos(toRadians(first.latitude)) * Math.cos(toRadians(second.latitude)) * Math.sin(deltaLng / 2) ** 2;
  return earthRadius * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function parseIsoInterval(startAt, endAt) {
  const start = new Date(startAt);
  const end = new Date(endAt);
  if (Number.isNaN(start.valueOf()) || Number.isNaN(end.valueOf())) {
    throw new ApiError(422, 'INVALID_TIME_RANGE', 'startAt and endAt must be valid ISO-8601 timestamps.');
  }
  if (end <= start) throw new ApiError(422, 'INVALID_TIME_RANGE', 'endAt must be after startAt.');
  const durationMinutes = Math.ceil((end - start) / 60_000);
  if (durationMinutes < 15 || durationMinutes > 60 * 24 * 30) {
    throw new ApiError(422, 'INVALID_TIME_RANGE', 'Bookings must be between 15 minutes and 30 days.');
  }
  return { startAt: start.toISOString(), endAt: end.toISOString(), durationMinutes };
}

function calculatePrice(hourlyRatePaise, durationMinutes, platformFeePercent = 8) {
  const rate = Number(hourlyRatePaise);
  if (!Number.isSafeInteger(rate) || rate <= 0) throw new ApiError(500, 'PRICING_ERROR', 'Space pricing is invalid.');
  const bookedBlocks = Math.ceil(durationMinutes / 15);
  const subtotalPaise = Math.ceil((rate * bookedBlocks) / 4);
  const platformFeePaise = Math.ceil(subtotalPaise * platformFeePercent / 100);
  return { currency: 'INR', subtotalPaise, platformFeePaise, totalPaise: subtotalPaise + platformFeePaise, billedQuarterHours: bookedBlocks };
}

module.exports = { calculatePrice, haversineKm, parseIsoInterval, validateCoordinates };
