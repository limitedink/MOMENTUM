import type { Pool, PoolClient } from 'pg';
import { createHash } from 'crypto';
import { promises as fs } from 'fs';
import { join, resolve } from 'path';
import { fileURLToPath } from 'url';

export interface Migration {
  id: string;
  up(client: PoolClient): Promise<void>;
}

export interface MigrationRunner {
  run(migrations: readonly Migration[]): Promise<void>;
  runFromDirectory(dir: string): Promise<void>;
}

interface SchemaMigrationRow {
  version: string;
  checksum: string;
  applied_at: Date;
}

function computeChecksum(content: string): string {
  return createHash('sha256').update(content, 'utf8').digest('hex');
}

async function ensureSchemaMigrations(client: PoolClient): Promise<void> {
  await client.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version TEXT PRIMARY KEY,
      checksum TEXT NOT NULL,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
}

async function getAppliedMigrations(client: PoolClient): Promise<Map<string, string>> {
  const { rows } = await client.query<SchemaMigrationRow>(
    'SELECT version, checksum FROM schema_migrations ORDER BY version'
  );
  const map = new Map<string, string>();
  for (const row of rows) map.set(row.version, row.checksum);
  return map;
}

async function recordMigration(
  client: PoolClient,
  version: string,
  checksum: string
): Promise<void> {
  await client.query(
    `INSERT INTO schema_migrations (version, checksum)
     VALUES ($1, $2)
     ON CONFLICT (version) DO UPDATE SET checksum = EXCLUDED.checksum, applied_at = NOW()`,
    [version, checksum]
  );
}

async function loadSqlMigrationsFromDir(dir: string): Promise<Migration[]> {
  const absDir = resolve(dir);
  let files: string[];
  try {
    files = await fs.readdir(absDir);
  } catch {
    return [];
  }
  const sqlFiles = files
    .filter((f) => f.endsWith('.sql'))
    .sort((a, b) => a.localeCompare(b, 'en', { numeric: true }));

  const migrations: Migration[] = [];
  for (const file of sqlFiles) {
    const fullPath = join(absDir, file);
    const raw = await fs.readFile(fullPath, 'utf8');
    const checksum = computeChecksum(raw);
    const versionMatch = file.match(/^(V\d+|\d+)/i);
    const version = versionMatch ? versionMatch[1].toUpperCase() : file;
    migrations.push({
      id: version,
      up: async (client: PoolClient) => {
        await client.query(raw);
      }
    });
  }
  return migrations;
}

export function createMigrationRunner(pool: Pool): MigrationRunner {
  return {
    async run(migrations: readonly Migration[]): Promise<void> {
      if (migrations.length === 0) return;

      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        await ensureSchemaMigrations(client);
        const applied = await getAppliedMigrations(client);

        for (const migration of migrations) {
          await migration.up(client);
          const prev = applied.get(migration.id);
          await recordMigration(client, migration.id, prev ?? computeChecksum(migration.id));
        }
        await client.query('COMMIT');
      } catch (error) {
        try {
          await client.query('ROLLBACK');
        } catch {
          // Preserve the migration error; the connection is released below.
        }
        throw error;
      } finally {
        client.release();
      }
    },

    async runFromDirectory(dir: string): Promise<void> {
      const migrations = await loadSqlMigrationsFromDir(dir);
      if (migrations.length === 0) return;

      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        await ensureSchemaMigrations(client);
        const applied = await getAppliedMigrations(client);

        for (const migration of migrations) {
          const prevChecksum = applied.get(migration.id);
          const absDir = resolve(dir);
          const files = await fs.readdir(absDir);
          let filePath: string | undefined;
          for (const f of files) {
            if (f.endsWith('.sql')) {
              const vMatch = f.match(/^(V\d+|\d+)/i);
              const v = vMatch ? vMatch[1].toUpperCase() : f;
              if (v === migration.id) {
                filePath = join(absDir, f);
                break;
              }
            }
          }
          if (!filePath) {
            await migration.up(client);
            const raw = await fs.readFile(join(absDir, files.find((ff) => ff.endsWith('.sql')) || ''), 'utf8').catch(() => '');
            await recordMigration(client, migration.id, computeChecksum(raw || migration.id));
            continue;
          }
          const raw = await fs.readFile(filePath, 'utf8');
          const fresh = computeChecksum(raw);

          if (prevChecksum === fresh) {
            // checksum unchanged: repeatable skipped
            continue;
          }
          await migration.up(client);
          await recordMigration(client, migration.id, fresh);
        }
        await client.query('COMMIT');
      } catch (error) {
        try {
          await client.query('ROLLBACK');
        } catch {
          // Preserve the migration error; the connection is released below.
        }
        throw error;
      } finally {
        client.release();
      }
    }
  };
}

export { loadSqlMigrationsFromDir };

export function resolveDefaultMigrationsDir(): string {
  const currentFile = fileURLToPath(import.meta.url);
  return resolve(currentFile, '../../../../migrations');
}
