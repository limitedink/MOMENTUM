import { randomUUID } from 'crypto';
import type { Pool, PoolClient } from 'pg';
import type { Player, PlayerRepository } from './player.js';

function mapRow(row: any): Player {
  return {
    id: row.id,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

export function createPostgresPlayerRepository(pool: Pool): PlayerRepository {
  return {
    async create(): Promise<Player> {
      const { rows } = await pool.query(
        'INSERT INTO players DEFAULT VALUES RETURNING id, created_at, updated_at'
      );
      return mapRow(rows[0]);
    },

    async findById(id: string): Promise<Player | null> {
      const { rows } = await pool.query(
        'SELECT id, created_at, updated_at FROM players WHERE id = $1',
        [id]
      );
      if (rows.length === 0) return null;
      return mapRow(rows[0]);
    }
  };
}

export function createPostgresPlayerRepositoryWithClient(client: PoolClient): PlayerRepository {
  return {
    async create(): Promise<Player> {
      const { rows } = await client.query(
        'INSERT INTO players DEFAULT VALUES RETURNING id, created_at, updated_at'
      );
      return mapRow(rows[0]);
    },

    async findById(id: string): Promise<Player | null> {
      const { rows } = await client.query(
        'SELECT id, created_at, updated_at FROM players WHERE id = $1',
        [id]
      );
      if (rows.length === 0) return null;
      return mapRow(rows[0]);
    }
  };
}
