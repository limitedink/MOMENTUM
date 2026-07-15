# Momentum Backend Status

Updated after completing the persistent parties milestone.

## Completed

- Backend shell, typed configuration, Fastify server, PostgreSQL pool boundary, structured logging, health/readiness routes, and graceful shutdown.
- Automatic PostgreSQL migrations with checksum tracking and transaction-scoped migration locking.
- Persistent development players and opaque sessions.
- SHA-256 token hashing, bearer authentication, `/v1/me`, and current-session revocation.
- Persistent parties, memberships, secure join codes, one-party-per-player enforcement, member listing, size limits, and safe leadership transfer.
- Authenticated party HTTP routes and PostgreSQL integration coverage.

## First incomplete stage

WebSocket session authentication and party-aware connection authorization.

That stage should add authenticated WebSocket handshakes and session lifecycle handling without introducing authoritative gameplay snapshots, activity synchronization, expedition simulation, matchmaking, chat, or guilds.

## Verification note

The PostgreSQL integration tests run when `DATABASE_URL` is supplied. Without that environment variable, they are skipped so the normal unit/test suite remains usable without a local database. The integration bootstrap applies `backend/migrations` and is safe when multiple test files initialize the database concurrently.
