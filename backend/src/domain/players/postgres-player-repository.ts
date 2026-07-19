import { randomUUID } from 'crypto';
import type { Pool, PoolClient } from 'pg';
import type { CreatePlayerInput, Player, PlayerRepository } from './player.js';

function mapRow(row: any): Player {
  return {
    id: row.id,
    displayName: row.display_name,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

export function createPostgresPlayerRepository(pool: Pool): PlayerRepository {
  return {
    async create(input: CreatePlayerInput): Promise<Player> {
      const { rows } = await pool.query(
        'INSERT INTO players (display_name) VALUES ($1) RETURNING id, display_name, created_at, updated_at',
        [input.displayName]
      );
      return mapRow(rows[0]);
    },

    async findById(id: string): Promise<Player | null> {
      const { rows } = await pool.query(
        'SELECT id, display_name, created_at, updated_at FROM players WHERE id = $1',
        [id]
      );
      if (rows.length === 0) return null;
      return mapRow(rows[0]);
    }
  };
}

export function createPostgresPlayerRepositoryWithClient(client: PoolClient): PlayerRepository {
  return {
    async create(input: CreatePlayerInput): Promise<Player> {
      const { rows } = await client.query(
        'INSERT INTO players (display_name) VALUES ($1) RETURNING id, display_name, created_at, updated_at',
        [input.displayName]
      );
      return mapRow(rows[0]);
    },

    async findById(id: string): Promise<Player | null> {
      const { rows } = await client.query(
        'SELECT id, display_name, created_at, updated_at FROM players WHERE id = $1',
        [id]
      );
      if (rows.length === 0) return null;
      return mapRow(rows[0]);
    }
  };
}
