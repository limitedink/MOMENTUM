import { describe, expect, it } from 'vitest';
import { Pool } from 'pg';
import { checkDatabaseConnection } from '../../src/infrastructure/database.js';

const databaseUrl = process.env.DATABASE_URL;

describe.skipIf(databaseUrl === undefined)('PostgreSQL connection integration', () => {
  it('connects to the configured database', async () => {
    const pool = new Pool({
      connectionString: databaseUrl,
      connectionTimeoutMillis: 1_000,
      max: 1
    });

    try {
      await expect(checkDatabaseConnection(pool)).resolves.toBeUndefined();
    } finally {
      await pool.end();
    }
  });
});
