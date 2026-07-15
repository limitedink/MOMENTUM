import type { Pool, PoolClient } from 'pg';
import type { Session, CreateSessionInput, SessionRepository } from './session.js';

function mapRow(row: any): Session {
  return {
    id: row.id,
    playerId: row.player_id,
    tokenHash: row.token_hash,
    createdAt: row.created_at,
    lastUsedAt: row.last_used_at,
    expiresAt: row.expires_at,
    revokedAt: row.revoked_at
  };
}

export function createPostgresSessionRepository(pool: Pool): SessionRepository {
  return {
    async create(input: CreateSessionInput): Promise<Session> {
      const { rows } = await pool.query(
        `INSERT INTO sessions (player_id, token_hash, expires_at)
         VALUES ($1, $2, COALESCE($3, NOW() + INTERVAL '30 days'))
         RETURNING id, player_id, token_hash, created_at, last_used_at, expires_at, revoked_at`,
        [input.playerId, input.tokenHash, input.expiresAt ?? null]
      );
      return mapRow(rows[0]);
    },

    async findByTokenHash(hash: string): Promise<Session | null> {
      const { rows } = await pool.query(
        `SELECT id, player_id, token_hash, created_at, last_used_at, expires_at, revoked_at
         FROM sessions
         WHERE token_hash = $1 AND revoked_at IS NULL AND expires_at > NOW()`,
        [hash]
      );
      if (rows.length === 0) return null;
      return mapRow(rows[0]);
    },

    async findById(id: string): Promise<Session | null> {
      const { rows } = await pool.query(
        `SELECT id, player_id, token_hash, created_at, last_used_at, expires_at, revoked_at
         FROM sessions
         WHERE id = $1`,
        [id]
      );
      if (rows.length === 0) return null;
      return mapRow(rows[0]);
    },

    async revoke(id: string): Promise<void> {
      await pool.query(
        `UPDATE sessions SET revoked_at = NOW() WHERE id = $1 AND revoked_at IS NULL`,
        [id]
      );
    },

    async touchLastUsed(id: string): Promise<void> {
      await pool.query(
        `UPDATE sessions SET last_used_at = NOW() WHERE id = $1`,
        [id]
      );
    }
  };
}

export function createPostgresSessionRepositoryWithClient(client: PoolClient): SessionRepository {
  return {
    async create(input: CreateSessionInput): Promise<Session> {
      const { rows } = await client.query(
        `INSERT INTO sessions (player_id, token_hash, expires_at)
         VALUES ($1, $2, COALESCE($3, NOW() + INTERVAL '30 days'))
         RETURNING id, player_id, token_hash, created_at, last_used_at, expires_at, revoked_at`,
        [input.playerId, input.tokenHash, input.expiresAt ?? null]
      );
      return mapRow(rows[0]);
    },

    async findByTokenHash(hash: string): Promise<Session | null> {
      const { rows } = await client.query(
        `SELECT id, player_id, token_hash, created_at, last_used_at, expires_at, revoked_at
         FROM sessions
         WHERE token_hash = $1 AND revoked_at IS NULL AND expires_at > NOW()`,
        [hash]
      );
      if (rows.length === 0) return null;
      return mapRow(rows[0]);
    },

    async findById(id: string): Promise<Session | null> {
      const { rows } = await client.query(
        `SELECT id, player_id, token_hash, created_at, last_used_at, expires_at, revoked_at
         FROM sessions
         WHERE id = $1`,
        [id]
      );
      if (rows.length === 0) return null;
      return mapRow(rows[0]);
    },

    async revoke(id: string): Promise<void> {
      await client.query(
        `UPDATE sessions SET revoked_at = NOW() WHERE id = $1 AND revoked_at IS NULL`,
        [id]
      );
    },

    async touchLastUsed(id: string): Promise<void> {
      await client.query(
        `UPDATE sessions SET last_used_at = NOW() WHERE id = $1`,
        [id]
      );
    }
  };
}
