import { Pool } from 'pg';
import type { AppConfig } from '../config/environment.js';

export function createDatabasePool(config: AppConfig): Pool {
  return new Pool({
    connectionString: config.databaseUrl,
    max: config.databasePoolMax,
    connectionTimeoutMillis: 1_000,
    idleTimeoutMillis: 30_000
  });
}

export async function checkDatabaseConnection(pool: Pool): Promise<void> {
  await pool.query('SELECT 1');
}

export async function closeDatabasePool(pool: Pool): Promise<void> {
  await pool.end();
}
