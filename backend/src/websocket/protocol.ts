import { Buffer } from 'node:buffer';

export const WEBSOCKET_PROTOCOL_VERSION = 1 as const;
export const MAX_REQUEST_ID_LENGTH = 64;

export const WEBSOCKET_CLOSE_CODES = {
  AUTH_REQUIRED: 4001,
  AUTH_FAILED: 4003,
  CONNECTION_LIMIT: 4008,
  IDLE_TIMEOUT: 4009,
  PROTOCOL_ERROR: 1002,
  INVALID_MESSAGE: 1003,
  POLICY_VIOLATION: 1008,
  MESSAGE_TOO_LARGE: 1009,
  INTERNAL_ERROR: 1011
} as const;

export const WEBSOCKET_CLOSE_REASONS = {
  AUTH_REQUIRED: 'auth.required',
  AUTH_FAILED: 'auth.invalid',
  AUTH_TIMEOUT: 'auth.timeout',
  CONNECTION_LIMIT: 'connection.max_per_player',
  IDLE_TIMEOUT: 'connection.idle_timeout',
  INVALID_JSON: 'protocol.invalid_json',
  UNSUPPORTED_VERSION: 'protocol.unsupported_version',
  UNKNOWN_MESSAGE_TYPE: 'protocol.unknown_message_type',
  INVALID_MESSAGE: 'protocol.invalid_message',
  BINARY_MESSAGE: 'protocol.binary_message',
  MESSAGE_TOO_LARGE: 'protocol.message_too_large',
  RATE_LIMIT: 'rate.limit_exceeded',
  INTERNAL_ERROR: 'server.internal_error',
  SERVER_SHUTDOWN: 'server.shutdown'
} as const;

const REQUEST_ID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;

export interface AuthMessage {
  protocolVersion: typeof WEBSOCKET_PROTOCOL_VERSION;
  type: 'auth';
  requestId: string;
  payload: { token: string };
}

export interface PingMessage {
  protocolVersion: typeof WEBSOCKET_PROTOCOL_VERSION;
  type: 'ping';
  requestId: string;
  payload: Record<string, never>;
}

export interface PartyRefreshMessage {
  protocolVersion: typeof WEBSOCKET_PROTOCOL_VERSION;
  type: 'party.refresh';
  requestId: string;
  payload: Record<string, never>;
}

export type ClientMessage = AuthMessage | PingMessage | PartyRefreshMessage;

export interface ConnectionReadyPayload {
  connectionId: string;
  playerId: string;
  partyId: string | null;
  partyMemberIds: string[];
  serverTimestamp: number;
  protocolVersion: typeof WEBSOCKET_PROTOCOL_VERSION;
}

export interface PartySnapshotPayload {
  partyId: string | null;
  leaderPlayerId: string | null;
  memberPlayerIds: string[];
  joinCode: string | null;
  serverTimestamp: number;
}

export interface PartyPresencePayload {
  playerId: string;
  status: 'online' | 'offline';
  connectedSessionCount: number;
  serverTimestamp: number;
}

export interface PongPayload {
  serverTimestamp: number;
}

export interface ServerMessage<TPayload = unknown> {
  protocolVersion: typeof WEBSOCKET_PROTOCOL_VERSION;
  type: 'connection.ready' | 'pong' | 'party.snapshot' | 'party.presence';
  requestId: string | null;
  payload: TPayload;
}

export type ProtocolFailure =
  | 'invalid_json'
  | 'unsupported_version'
  | 'unknown_message_type'
  | 'invalid_message'
  | 'binary_message';

export type ParseResult =
  | { ok: true; message: ClientMessage }
  | { ok: false; failure: ProtocolFailure };

type RecordValue = Record<string, unknown>;

function isRecord(value: unknown): value is RecordValue {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function hasExactKeys(value: RecordValue, keys: readonly string[]): boolean {
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  return actual.length === expected.length && actual.every((key, index) => key === expected[index]);
}

function isRequestId(value: unknown): value is string {
  return typeof value === 'string' && value.length <= MAX_REQUEST_ID_LENGTH && REQUEST_ID_PATTERN.test(value);
}

function isEmptyPayload(value: unknown): value is Record<string, never> {
  return isRecord(value) && hasExactKeys(value, []);
}

function isSupportedVersion(value: unknown): value is typeof WEBSOCKET_PROTOCOL_VERSION {
  return value === WEBSOCKET_PROTOCOL_VERSION;
}

export function parseClientMessage(raw: string, allowAuthentication: boolean): ParseResult {
  let value: unknown;
  try {
    value = JSON.parse(raw) as unknown;
  } catch {
    return { ok: false, failure: 'invalid_json' };
  }

  if (!isRecord(value)) return { ok: false, failure: 'invalid_message' };
  if (!isSupportedVersion(value.protocolVersion)) {
    return {
      ok: false,
      failure: typeof value.protocolVersion === 'number' ? 'unsupported_version' : 'invalid_message'
    };
  }
  if (typeof value.type !== 'string') return { ok: false, failure: 'invalid_message' };
  if (!isRequestId(value.requestId)) return { ok: false, failure: 'invalid_message' };
  if (!isRecord(value.payload)) return { ok: false, failure: 'invalid_message' };

  if (value.type === 'auth') {
    if (!allowAuthentication || !hasExactKeys(value.payload, ['token']) ||
      typeof value.payload.token !== 'string' || value.payload.token.length === 0 || value.payload.token.length > 512) {
      return { ok: false, failure: allowAuthentication ? 'invalid_message' : 'unknown_message_type' };
    }
    return { ok: true, message: value as unknown as AuthMessage };
  }

  if (value.type === 'ping' && isEmptyPayload(value.payload)) {
    return { ok: true, message: value as unknown as PingMessage };
  }
  if (value.type === 'party.refresh' && isEmptyPayload(value.payload)) {
    return { ok: true, message: value as unknown as PartyRefreshMessage };
  }

  if (value.type === 'ping' || value.type === 'party.refresh') {
    return { ok: false, failure: 'invalid_message' };
  }
  return { ok: false, failure: 'unknown_message_type' };
}

export function rawMessageByteLength(raw: unknown): number {
  if (typeof raw === 'string') return Buffer.byteLength(raw, 'utf8');
  if (Buffer.isBuffer(raw)) return raw.byteLength;
  if (raw instanceof ArrayBuffer) return raw.byteLength;
  if (Array.isArray(raw) && raw.every(item => Buffer.isBuffer(item))) {
    return raw.reduce((total, item) => total + item.byteLength, 0);
  }
  return Number.POSITIVE_INFINITY;
}

export function rawMessageToText(raw: unknown, isBinary: boolean): string | null {
  if (isBinary) return null;
  if (typeof raw === 'string') return raw;
  if (Buffer.isBuffer(raw)) return raw.toString('utf8');
  if (raw instanceof ArrayBuffer) return Buffer.from(raw).toString('utf8');
  if (Array.isArray(raw) && raw.every(item => Buffer.isBuffer(item))) {
    return Buffer.concat(raw).toString('utf8');
  }
  return null;
}

export function createServerMessage<TPayload>(
  type: ServerMessage<TPayload>['type'],
  requestId: string | null,
  payload: TPayload
): ServerMessage<TPayload> {
  return {
    protocolVersion: WEBSOCKET_PROTOCOL_VERSION,
    type,
    requestId,
    payload
  };
}
