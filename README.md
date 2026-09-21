# Parkly

Parkly is a privacy-conscious parking marketplace for finding, reserving, and hosting short-term parking spaces.

## What is included

- Responsive customer and host web experience
- Versioned HTTP API with request tracing, CORS allow-listing, body limits, security headers, rate limiting, and consistent error responses
- Password hashing and signed access tokens
- Concurrent-safe booking allocation with capacity checks, idempotency, cancellation policy, and price calculation
- Space-listing safety checks and deterministic AI-style classification, with an optional no-cost local Ollama adapter
- Persisted local data store for development; the domain contracts are designed to be replaced by PostgreSQL/Redis adapters for a multi-instance production deployment

## Run locally

1. Copy `.env.example` to `.env.local` and set a strong `PARKLY_JWT_SECRET` before deploying.
2. Run `npm start`.
3. Open `http://127.0.0.1:8787`.

The API uses no paid service by default. Set `PARKLY_AI_PROVIDER=auto` with a locally running [Ollama](https://ollama.com/) instance to enhance listing classification. The deterministic classifier is always retained as a safe fallback.

## Core API

| Endpoint | Purpose |
| --- | --- |
| `GET /api/v1/health` | Service and local-AI readiness |
| `POST /api/v1/auth/register` | Create a driver or host account |
| `POST /api/v1/auth/login` | Receive a signed access token |
| `GET /api/v1/spaces` | Search live, eligible spaces |
| `POST /api/v1/allocations/recommendations` | Rank the best eligible parking options |
| `POST /api/v1/bookings` | Create an idempotent reservation |
| `GET /api/v1/bookings/:id` | Read a reservation |
| `POST /api/v1/bookings/:id/cancel` | Cancel within the policy window |
| `POST /api/v1/listings/classify` | Review and classify a parking listing |
| `POST /api/v1/listings` | Create a host listing |

Authenticated calls use `Authorization: Bearer <access-token>`. Booking creation also requires a unique `Idempotency-Key` header.

## Production deployment notes

Set `NODE_ENV=production`, a 32+ character `PARKLY_JWT_SECRET`, an explicit `PARKLY_CORS_ORIGINS` allow-list, TLS termination, and an operational database/queue adapter before public deployment. The included JSON store makes the project instantly runnable and testable locally, but a single-file data store is not suitable for multi-instance production infrastructure.
