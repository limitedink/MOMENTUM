# Momentum Backend Status

Updated from the current working tree after completing the backend foundation stage.

## Completed

- Milestone 0: focused Phase 1 technical documentation exists in the canonical Technical folder.
- Milestone 1: backend shell, typed configuration, Fastify server, PostgreSQL pool boundary, structured logging, `/healthz`, migration-runner boundary, startup connection check, and test bootstrap are implemented.

## First incomplete stage

Milestone 2 — development authentication.

It must add only the development-auth endpoint, stable device-subject identity mapping, signed expiring tokens, the authentication service interface, and token-validation tests. Do not add party persistence or WebSocket session authentication in that stage.

## Verification note

The PostgreSQL integration test runs when `DATABASE_URL` is supplied. Without that environment variable, the test is skipped so the normal unit/test suite remains usable without a local database.
