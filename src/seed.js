const DEFAULT_SPACES = [
  {
    id: 'space_regal_cp', hostId: 'host_regal', title: 'Regal Parking Bay', description: 'Covered, gated parking bay just off Connaught Place.',
    address: { city: 'New Delhi', locality: 'Connaught Place', latitude: 28.6315, longitude: 77.2167 },
    capacity: 2, active: true, vehicleTypes: ['bike', 'car', 'suv'], amenities: ['covered', 'security'], hourlyRatePaise: 6000,
    rating: 4.9, reviewCount: 128, openingHours: { start: '00:00', end: '23:59' }, blockedIntervals: []
  },
  {
    id: 'space_central_plaza', hostId: 'host_central', title: 'Central Plaza Space', description: 'Secure parking with an EV charging point near Block B.',
    address: { city: 'New Delhi', locality: 'Connaught Place', latitude: 28.6328, longitude: 77.2180 },
    capacity: 3, active: true, vehicleTypes: ['car', 'suv'], amenities: ['ev', 'security'], hourlyRatePaise: 4500,
    rating: 4.8, reviewCount: 86, openingHours: { start: '00:00', end: '23:59' }, blockedIntervals: []
  },
  {
    id: 'space_janpath_lot', hostId: 'host_janpath', title: 'Janpath Private Lot', description: 'Monitored private lot with easy access to Janpath Road.',
    address: { city: 'New Delhi', locality: 'Janpath Road', latitude: 28.6289, longitude: 77.2197 },
    capacity: 4, active: true, vehicleTypes: ['bike', 'car', 'suv', 'van'], amenities: ['security'], hourlyRatePaise: 5000,
    rating: 5.0, reviewCount: 42, openingHours: { start: '00:00', end: '23:59' }, blockedIntervals: []
  }
];

const DEFAULT_USERS = [
  { id: 'host_regal', role: 'host', name: 'Regal Host', email: 'host.regal@example.test', passwordHash: null, createdAt: '2026-01-01T00:00:00.000Z' },
  { id: 'host_central', role: 'host', name: 'Central Host', email: 'host.central@example.test', passwordHash: null, createdAt: '2026-01-01T00:00:00.000Z' },
  { id: 'host_janpath', role: 'host', name: 'Janpath Host', email: 'host.janpath@example.test', passwordHash: null, createdAt: '2026-01-01T00:00:00.000Z' }
];

function initialState() {
  return {
    schemaVersion: 1,
    users: structuredClone(DEFAULT_USERS),
    spaces: structuredClone(DEFAULT_SPACES),
    bookings: [],
    idempotency: [],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  };
}

module.exports = { DEFAULT_SPACES, DEFAULT_USERS, initialState };
