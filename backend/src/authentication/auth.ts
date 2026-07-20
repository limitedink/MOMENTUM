import type { FastifyRequest, FastifyReply, FastifyInstance } from 'fastify';
import type { Pool } from 'pg';
import { normalizeDisplayName, type Player } from '../domain/players/player.js';
import type { Session } from '../domain/sessions/session.js';
import { createPostgresPlayerRepository } from '../domain/players/postgres-player-repository.js';
import { createPostgresSessionRepository } from '../domain/sessions/postgres-session-repository.js';
import { hashToken } from '../domain/tokens/token-service.js';
import { DEFAULT_PLAYER_PROFILE, normalizeStoredPlayerProfile } from '../domain/players/player-profile.js';

declare module 'fastify' {
  interface FastifyRequest {
    currentPlayer?: Player;
    currentSession?: Session;
  }
}

export interface AuthContext {
  player: Player;
  session: Session;
}

export function extractBearerToken(header: string | undefined): string | null {
  if (!header || !header.toLowerCase().startsWith('bearer ')) return null;
  const raw = header.slice(7).trim();
  return raw || null;
}

export async function authenticateToken(database: Pool, rawToken: string): Promise<AuthContext | null> {
  const sessions = createPostgresSessionRepository(database);
  const players = createPostgresPlayerRepository(database);
  const session = await sessions.findByTokenHash(hashToken(rawToken));
  if (!session) return null;

  const player = await players.findById(session.playerId);
  if (!player) return null;

  await sessions.touchLastUsed(session.id);
  return { player, session };
}

export async function authenticateAuthorizationHeader(
  database: Pool,
  header: string | undefined
): Promise<AuthContext | null> {
  const rawToken = extractBearerToken(header);
  return rawToken ? authenticateToken(database, rawToken) : null;
}

function attachAuthContext(request: FastifyRequest, context: AuthContext): void {
  request.currentPlayer = context.player;
  request.currentSession = context.session;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function createAuthHook(database: Pool) {
  return async function requireAuth(request: FastifyRequest, reply: FastifyReply): Promise<void> {
    const context = await authenticateAuthorizationHeader(database, request.headers.authorization);
    if (!context) {
      reply.code(401).send({ error: 'unauthorized' });
      return;
    }
    attachAuthContext(request, context);
  };
}

export async function registerAuthRoutes(app: FastifyInstance, database: Pool) {
  const players = createPostgresPlayerRepository(database);
  const sessions = createPostgresSessionRepository(database);

  // POST /v1/dev/players - creates player + session, returns raw token once
  app.post('/v1/dev/players', async (request, reply) => {
    const body = isRecord(request.body) ? request.body : {};
    const displayName = normalizeDisplayName(body.displayName);
    if (!displayName) {
      reply.code(400).send({
        error: 'invalid_display_name',
        message: 'Display name must be 1–24 characters and cannot contain control characters.'
      });
      return;
    }

    const player = await players.create({ displayName });
    const { generateAccessToken } = await import('../domain/tokens/token-service.js');
    const { raw, hash } = generateAccessToken();

    const session = await sessions.create({ playerId: player.id, tokenHash: hash });
    await database.query(
      `INSERT INTO player_profiles (player_id, profile_json)
       VALUES ($1, $2::jsonb)
       ON CONFLICT (player_id) DO NOTHING`,
      [player.id, JSON.stringify(DEFAULT_PLAYER_PROFILE)]
    );

    reply.code(201).send({
      player: { id: player.id, displayName: player.displayName, createdAt: player.createdAt },
      token: raw,
      sessionId: session.id
    });
  });

  // GET /v1/me - requires bearer token
  app.get('/v1/me', { preHandler: createAuthHook(database) }, async (request, reply) => {
    const player = request.currentPlayer!;
    reply.send({
      player: { id: player.id, displayName: player.displayName, createdAt: player.createdAt }
    });
  });

  app.get('/v1/profile', { preHandler: createAuthHook(database) }, async (request, reply) => {
    const player = request.currentPlayer!;
    const result = await database.query<{ profile_json: unknown }>(
      `INSERT INTO player_profiles (player_id, profile_json)
       VALUES ($1, $2::jsonb)
       ON CONFLICT (player_id) DO UPDATE SET updated_at = NOW()
       RETURNING profile_json`,
      [player.id, JSON.stringify(DEFAULT_PLAYER_PROFILE)]
    );
    reply.send({ profile: result.rows[0]?.profile_json || DEFAULT_PLAYER_PROFILE });
  });

  app.put('/v1/profile', { preHandler: createAuthHook(database) }, async (request, reply) => {
    const profile = normalizeStoredPlayerProfile(request.body);
    if (!profile) {
      reply.code(400).send({ error: 'invalid_profile', message: 'Profile data is invalid or contains unsupported values.' });
      return;
    }
    await database.query(
      `INSERT INTO player_profiles (player_id, profile_json)
       VALUES ($1, $2::jsonb)
       ON CONFLICT (player_id) DO UPDATE SET profile_json = EXCLUDED.profile_json, updated_at = NOW()`,
      [request.currentPlayer!.id, JSON.stringify(profile)]
    );
    reply.send({ profile });
  });

  // POST /v1/sessions/current/revoke - revokes the calling session
  app.post('/v1/sessions/current/revoke', { preHandler: createAuthHook(database) }, async (request, reply) => {
    const session = request.currentSession!;
    await sessions.revoke(session.id);
    reply.code(204).send();
  });
}

export function createReadyHandler(database: Pool) {
  return async function readyz(_request: FastifyRequest, reply: FastifyReply) {
    try {
      await database.query('SELECT 1');
      reply.send({ status: 'ready' });
    } catch (err) {
      reply.code(503).send({ status: 'not_ready' });
    }
  };
}
