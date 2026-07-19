import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { Pool } from 'pg';
import { buildApp } from '../../src/app.js';
import { loadConfig } from '../../src/config/environment.js';
import { createMigrationRunner } from '../../src/infrastructure/migrations/migration-runner.js';

const databaseUrl = process.env.DATABASE_URL;
const config = loadConfig({
  NODE_ENV: 'test',
  HOST: '127.0.0.1',
  PORT: '3000',
  LOG_LEVEL: 'silent',
  DATABASE_URL: databaseUrl ?? 'postgresql://localhost:5432/momentum_test',
  DATABASE_POOL_MAX: '5'
});

describe.skipIf(!databaseUrl)('auth integration (PostgreSQL)', () => {
  let app: Awaited<ReturnType<typeof buildApp>> | undefined;
  let pool: Pool | undefined;

  beforeAll(async () => {
    pool = new Pool({
      connectionString: databaseUrl,
      max: 5,
      connectionTimeoutMillis: 2000
    });
    const runner = createMigrationRunner(pool);
    const migrationsDir = new URL('../../migrations', import.meta.url).pathname;
    await runner.runFromDirectory(migrationsDir);
  });

  afterEach(async () => {
    if (app) {
      await app.close();
      app = undefined;
    }
  });

  it('GET /readyz returns ready when DB is reachable', async () => {
    app = await buildApp(config, { database: pool! });
    const res = await app.inject({ method: 'GET', url: '/readyz' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ status: 'ready' });
  });

  it('POST /v1/dev/players creates player and returns a raw dev_ token', async () => {
    app = await buildApp(config, { database: pool! });
    const res = await app.inject({ method: 'POST', url: '/v1/dev/players', payload: { displayName: 'Alice' } });
    expect(res.statusCode).toBe(201);
    const body = res.json();
    expect(body).toHaveProperty('player');
    expect(body.player.displayName).toBe('Alice');
    expect(body).toHaveProperty('token');
    expect(typeof body.token).toBe('string');
    expect(body.token.startsWith('dev_')).toBe(true);
    expect(body).toHaveProperty('sessionId');
  });

  it('POST /v1/dev/players validates the development display name', async () => {
    app = await buildApp(config, { database: pool! });
    for (const displayName of ['', ' ', '1234567890123456789012345', 'bad\nname']) {
      const response = await app.inject({ method: 'POST', url: '/v1/dev/players', payload: { displayName } });
      expect(response.statusCode).toBe(400);
      expect(response.json().error).toBe('invalid_display_name');
    }
    const valid = await app.inject({ method: 'POST', url: '/v1/dev/players', payload: { displayName: '  Aster  ' } });
    expect(valid.statusCode).toBe(201);
    expect(valid.json().player.displayName).toBe('Aster');
  });

  it('GET /v1/me without token returns 401', async () => {
    app = await buildApp(config, { database: pool! });
    const res = await app.inject({ method: 'GET', url: '/v1/me' });
    expect(res.statusCode).toBe(401);
  });

  it('GET /v1/me with valid Bearer token returns player identity', async () => {
    app = await buildApp(config, { database: pool! });
    const create = await app.inject({ method: 'POST', url: '/v1/dev/players', payload: { displayName: 'Alice' } });
    const { token } = create.json();

    const me = await app.inject({
      method: 'GET',
      url: '/v1/me',
      headers: { authorization: `Bearer ${token}` }
    });
    expect(me.statusCode).toBe(200);
    const body = me.json();
    expect(body).toHaveProperty('player');
    expect(body.player).toHaveProperty('id');
    expect(body.player.displayName).toBe('Alice');
  });

  it('POST /v1/sessions/current/revoke invalidates the token for subsequent calls', async () => {
    app = await buildApp(config, { database: pool! });
    const create = await app.inject({ method: 'POST', url: '/v1/dev/players', payload: { displayName: 'Alice' } });
    const { token } = create.json();

    const revoke = await app.inject({
      method: 'POST',
      url: '/v1/sessions/current/revoke',
      headers: { authorization: `Bearer ${token}` }
    });
    expect(revoke.statusCode).toBe(204);

    const me = await app.inject({
      method: 'GET',
      url: '/v1/me',
      headers: { authorization: `Bearer ${token}` }
    });
    expect(me.statusCode).toBe(401);
  });
});
