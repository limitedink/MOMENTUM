import { buildApp } from './app.js';
import { loadConfig } from './config/environment.js';
import {
  checkDatabaseConnection,
  closeDatabasePool,
  createDatabasePool
} from './infrastructure/database.js';
import {
  createMigrationRunner,
  resolveDefaultMigrationsDir
} from './infrastructure/migrations/migration-runner.js';

const config = loadConfig();
const database = createDatabasePool(config);
const app = await buildApp(config, { database });
const migrationRunner = createMigrationRunner(database);

const migrationsDir = resolveDefaultMigrationsDir();

try {
  await checkDatabaseConnection(database);
  await migrationRunner.runFromDirectory(migrationsDir);
  await app.listen({
    host: config.host,
    port: config.port
  });
} catch (error) {
  app.log.error(error, 'backend failed to start');
  await app.close();
  await closeDatabasePool(database);
  process.exitCode = 1;
}

const shutdown = async (signal: string): Promise<void> => {
  app.log.info({ signal }, 'backend shutting down');
  await app.close();
  await closeDatabasePool(database);
};

process.once('SIGINT', () => {
  void shutdown('SIGINT');
});

process.once('SIGTERM', () => {
  void shutdown('SIGTERM');
});
