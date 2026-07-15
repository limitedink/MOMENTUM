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
  websocketMaxMessageBytes: number;
  websocketMaxMessages: number;
  websocketRateWindowMs: number;
  websocketAuthTimeoutMs: number;
  websocketIdleTimeoutMs: number;
  websocketMaxConnectionsPerPlayer: number;
  partyStateExpeditionDurationMs: number;
  partyStateCommandWindowMs: number;
  partyStateMaxCommands: number;
  partyStateContributionWindowMs: number;
  partyStateMaxContributions: number;
  partyStateMaxContribution: number;
  partyStateMaxCommandIdLength: number;
  partyStateMaxCommandPayloadBytes: number;
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
    databasePoolMax: parsePositiveInteger('DATABASE_POOL_MAX', environment.DATABASE_POOL_MAX, 10),
    websocketMaxMessageBytes: parsePositiveInteger('WEBSOCKET_MAX_MESSAGE_BYTES', environment.WEBSOCKET_MAX_MESSAGE_BYTES, 16_384),
    websocketMaxMessages: parsePositiveInteger('WEBSOCKET_MAX_MESSAGES', environment.WEBSOCKET_MAX_MESSAGES, 60),
    websocketRateWindowMs: parsePositiveInteger('WEBSOCKET_RATE_WINDOW_MS', environment.WEBSOCKET_RATE_WINDOW_MS, 10_000),
    websocketAuthTimeoutMs: parsePositiveInteger('WEBSOCKET_AUTH_TIMEOUT_MS', environment.WEBSOCKET_AUTH_TIMEOUT_MS, 5_000),
    websocketIdleTimeoutMs: parsePositiveInteger('WEBSOCKET_IDLE_TIMEOUT_MS', environment.WEBSOCKET_IDLE_TIMEOUT_MS, 120_000),
    websocketMaxConnectionsPerPlayer: parsePositiveInteger('WEBSOCKET_MAX_CONNECTIONS_PER_PLAYER', environment.WEBSOCKET_MAX_CONNECTIONS_PER_PLAYER, 4),
    partyStateExpeditionDurationMs: parsePositiveInteger('PARTY_STATE_EXPEDITION_DURATION_MS', environment.PARTY_STATE_EXPEDITION_DURATION_MS, 60_000),
    partyStateCommandWindowMs: parsePositiveInteger('PARTY_STATE_COMMAND_WINDOW_MS', environment.PARTY_STATE_COMMAND_WINDOW_MS, 10_000),
    partyStateMaxCommands: parsePositiveInteger('PARTY_STATE_MAX_COMMANDS', environment.PARTY_STATE_MAX_COMMANDS, 30),
    partyStateContributionWindowMs: parsePositiveInteger('PARTY_STATE_CONTRIBUTION_WINDOW_MS', environment.PARTY_STATE_CONTRIBUTION_WINDOW_MS, 10_000),
    partyStateMaxContributions: parsePositiveInteger('PARTY_STATE_MAX_CONTRIBUTIONS', environment.PARTY_STATE_MAX_CONTRIBUTIONS, 10),
    partyStateMaxContribution: parsePositiveInteger('PARTY_STATE_MAX_CONTRIBUTION', environment.PARTY_STATE_MAX_CONTRIBUTION, 1_000),
    partyStateMaxCommandIdLength: parsePositiveInteger('PARTY_STATE_MAX_COMMAND_ID_LENGTH', environment.PARTY_STATE_MAX_COMMAND_ID_LENGTH, 128),
    partyStateMaxCommandPayloadBytes: parsePositiveInteger('PARTY_STATE_MAX_COMMAND_PAYLOAD_BYTES', environment.PARTY_STATE_MAX_COMMAND_PAYLOAD_BYTES, 4_096)
  };
}
