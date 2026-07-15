import { afterEach, describe, expect, it } from 'vitest';
import WebSocket from 'ws';
import { buildApp } from '../src/app.js';
import { loadConfig } from '../src/config/environment.js';

const config = loadConfig({
  NODE_ENV: 'test',
  HOST: '127.0.0.1',
  PORT: '3000',
  LOG_LEVEL: 'silent',
  DATABASE_URL: 'postgresql://localhost:5432/momentum_test',
  DATABASE_POOL_MAX: '1'
});

describe('backend foundation', () => {
  let app: Awaited<ReturnType<typeof buildApp>> | undefined;

  afterEach(async () => {
    await app?.close();
    app = undefined;
  });

  it('returns a healthy response', async () => {
    app = await buildApp(config);

    const response = await app.inject({
      method: 'GET',
      url: '/healthz'
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ status: 'ok' });
  });

  it('accepts a websocket connection at the protocol boundary', async () => {
    app = await buildApp(config);
    await app.listen({ host: config.host, port: 0 });

    const address = app.server.address();
    if (address === null || typeof address === 'string') throw new Error('Test server did not expose a TCP address');

    await new Promise<void>((resolve, reject) => {
      const socket = new WebSocket(`ws://${config.host}:${address.port}/v1/ws`);

      socket.once('open', () => socket.close());
      socket.once('close', () => resolve());
      socket.once('error', reject);
    });
  });
});

describe('configuration', () => {
  it('loads typed defaults and environment overrides', () => {
    expect(
      loadConfig({
        NODE_ENV: 'production',
        HOST: '0.0.0.0',
        PORT: '4000',
        LOG_LEVEL: 'debug',
        DATABASE_URL: 'postgresql://example/momentum',
        DATABASE_POOL_MAX: '4'
      })
    ).toEqual({
      nodeEnv: 'production',
      host: '0.0.0.0',
      port: 4000,
      logLevel: 'debug',
      databaseUrl: 'postgresql://example/momentum',
      databasePoolMax: 4,
      websocketMaxMessageBytes: 16384,
      websocketMaxMessages: 60,
      websocketRateWindowMs: 10000,
      websocketAuthTimeoutMs: 5000,
      websocketIdleTimeoutMs: 120000,
      websocketMaxConnectionsPerPlayer: 4,
      partyStateExpeditionDurationMs: 60000,
      partyStateCommandWindowMs: 10000,
      partyStateMaxCommands: 30,
      partyStateContributionWindowMs: 10000,
      partyStateMaxContributions: 10,
      partyStateMaxContribution: 1000,
      partyStateMaxCommandIdLength: 128,
      partyStateMaxCommandPayloadBytes: 4096
    });
  });

  it('rejects invalid numeric configuration', () => {
    expect(() => loadConfig({ PORT: 'not-a-port' })).toThrow('PORT must be a positive integer');
  });
});
