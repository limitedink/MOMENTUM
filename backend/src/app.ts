import Fastify, { type FastifyInstance } from 'fastify';
import websocket from '@fastify/websocket';
import type { Pool } from 'pg';
import type { AppConfig } from './config/environment.js';
import { closeDatabasePool, createDatabasePool } from './infrastructure/database.js';
import { registerAuthRoutes, createReadyHandler } from './authentication/auth.js';
import { registerPartyRoutes } from './parties/party-routes.js';
import { registerWebSocketRoute } from './websocket/websocket-service.js';

export interface AppDependencies {
  database?: Pool;
}

export async function buildApp(
  config: AppConfig,
  dependencies: AppDependencies = {}
): Promise<FastifyInstance> {
  const app = Fastify({
    logger: {
      level: config.logLevel
    }
  });
  const database = dependencies.database ?? createDatabasePool(config);
  const ownsDatabase = dependencies.database === undefined;

  await app.register(websocket, {
    options: {
      // Leave a small transport margin so protocol-level validation can send
      // its stable close reason for messages just over the configured limit.
      maxPayload: config.websocketMaxMessageBytes + 1024
    }
  });

  app.get('/healthz', async () => ({ status: 'ok' }));

  // Lightweight liveness
  app.get('/readyz', createReadyHandler(database));

  // Auth routes (dev players, bearer auth, /me, revoke)
  await registerAuthRoutes(app, database);

  // Persistent party routes. WebSocket auth and gameplay synchronization remain separate milestones.
  await registerPartyRoutes(app, database);

  const websocketService = registerWebSocketRoute(app, database, config);

  app.addHook('onClose', async () => {
    websocketService.close();
    if (ownsDatabase) await closeDatabasePool(database);
  });

  return app;
}
