import { config as loadDotenv } from 'dotenv';

loadDotenv();

const LOG_LEVELS = ['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent'] as const;
type LogLevel = (typeof LOG_LEVELS)[number];

export interface AppConfig {
  nodeEnv: 'development' | 'test' | 'production';
  host: string;
  port: number;
  logLevel: LogLevel;
  databaseUrl: string;
  databasePoolMax: number;
}

const DEFAULT_DATABASE_URL = 'postgresql://localhost:5432/momentum';

function parseNodeEnv(value: string | undefined): AppConfig['nodeEnv'] {
  if (value === 'production' || value === 'test') return value;
  return 'development';
}

function parsePositiveInteger(name: string, value: string | undefined, fallback: number): number {
  if (value === undefined) return fallback;

  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1) {
    throw new Error(`${name} must be a positive integer`);
  }
  return parsed;
}

function parseLogLevel(value: string | undefined): LogLevel {
  const logLevel = value ?? 'info';
  if (!LOG_LEVELS.includes(logLevel as LogLevel)) {
    throw new Error(`LOG_LEVEL must be one of: ${LOG_LEVELS.join(', ')}`);
  }
  return logLevel as LogLevel;
}

export function loadConfig(environment: NodeJS.ProcessEnv = process.env): AppConfig {
  return {
    nodeEnv: parseNodeEnv(environment.NODE_ENV),
    host: environment.HOST ?? '127.0.0.1',
    port: parsePositiveInteger('PORT', environment.PORT, 3000),
    logLevel: parseLogLevel(environment.LOG_LEVEL),
    databaseUrl: environment.DATABASE_URL ?? DEFAULT_DATABASE_URL,
    databasePoolMax: parsePositiveInteger('DATABASE_POOL_MAX', environment.DATABASE_POOL_MAX, 10)
  };
}
