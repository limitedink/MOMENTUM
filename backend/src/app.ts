import Fastify, { type FastifyInstance } from 'fastify';
import websocket from '@fastify/websocket';
import type { Pool } from 'pg';
import type { WebSocket } from 'ws';
import type { AppConfig } from './config/environment.js';
import { closeDatabasePool, createDatabasePool } from './infrastructure/database.js';
import { registerAuthRoutes, createReadyHandler } from './authentication/auth.js';

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

  await app.register(websocket);

  app.get('/healthz', async () => ({ status: 'ok' }));

  // Lightweight liveness
  app.get('/readyz', createReadyHandler(database));

  // Auth routes (dev players, bearer auth, /me, revoke)
  await registerAuthRoutes(app, database);

  app.get('/v1/ws', { websocket: true }, (socket: WebSocket, request) => {
    app.log.info({ requestId: request.id }, 'websocket connection opened');

    socket.on('close', (code, reason) => {
      app.log.info(
        {
          code,
          reason: reason.toString(),
          requestId: request.id
        },
        'websocket connection closed'
      );
    });

    socket.on('error', error => {
      app.log.error({ error, requestId: request.id }, 'websocket connection error');
    });
  });

  app.addHook('onClose', async () => {
    if (ownsDatabase) await closeDatabasePool(database);
  });

  return app;
}
