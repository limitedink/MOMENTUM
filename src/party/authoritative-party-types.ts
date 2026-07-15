import type { AuthoritativePartyState, ConnectionState, Unsubscribe } from './party-types';

export type { AuthoritativePartyState } from './party-types';

export type AuthoritativePartyStatus = 'idle' | 'active' | 'completed';

export type AuthoritativeCommandBody =
  | { type: 'expedition.start'; destination: 'forest' }
  | { type: 'expedition.contribute'; amount: number }
  | { type: 'expedition.reset' };

export interface AuthoritativeCommand {
  commandId: string;
  expectedRevision: number;
  command: AuthoritativeCommandBody;
}

export interface AuthoritativePartyScope {
  partyId: string | null;
  leaderPlayerId: string | null;
  memberPlayerIds: string[];
  joinCode: string | null;
  serverTimestamp: number;
}

export interface AuthoritativeConnectionReady {
  connectionId: string;
  playerId: string;
  partyId: string | null;
  memberPlayerIds: string[];
  serverTimestamp: number;
  protocolVersion: 1;
}

export interface AuthoritativePresence {
  playerId: string;
  status: 'online' | 'offline';
  connectedSessionCount: number;
  serverTimestamp: number;
}

export interface AuthoritativeCommandResult {
  commandId: string;
  accepted: boolean;
  resultingRevision: number | null;
  currentRevision: number | null;
  errorCode: string | null;
  serverTimestamp: number;
}

export interface AuthoritativeServerError {
  code: string;
  message: string;
  requestId?: string | null;
  commandId?: string;
  serverTimestamp?: number;
}

export type AuthoritativeTransportErrorCode =
  | 'transport_disconnected'
  | 'transport_reconnecting'
  | 'transport_auth_failed'
  | 'transport_permanent_error'
  | 'transport_timeout'
  | 'party_refresh_required'
  | 'party_scope_mismatch'
  | 'unsupported_command'
  | 'protocol_error'
  | 'not_authenticated'
  | 'not_in_party'
  | 'internal_error'
  | (string & {});

export class AuthoritativeTransportError extends Error {
  constructor(
    public readonly code: AuthoritativeTransportErrorCode,
    message: string,
    public readonly requestId?: string | null,
    public readonly commandId?: string
  ) {
    super(message);
    this.name = 'AuthoritativeTransportError';
  }
}

export interface AuthoritativeWebSocketLike {
  readonly readyState: number;
  onopen: (() => void) | null;
  onmessage: ((event: { data: unknown }) => void) | null;
  onerror: ((event: unknown) => void) | null;
  onclose: ((event: { code: number; reason: string }) => void) | null;
  send(data: string): void;
  close(code?: number, reason?: string): void;
}

export type AuthoritativeWebSocketFactory = (url: string) => AuthoritativeWebSocketLike;

export interface AuthoritativePartyTransportOptions {
  token: string;
  url?: string;
  authenticatedPlayerId?: string;
  websocketFactory?: AuthoritativeWebSocketFactory;
  autoReconnect?: boolean;
  maxReconnectAttempts?: number;
  reconnectBaseDelayMs?: number;
  reconnectMaxDelayMs?: number;
  requestTimeoutMs?: number;
  pingIntervalMs?: number;
  now?: () => number;
}

export interface AuthoritativePartyTransport {
  connect(): Promise<boolean>;
  disconnect(): Promise<boolean>;
  getConnectionState(): ConnectionState;
  getSessionIdentity(): { authenticatedPlayerId: string | null; currentPartyId: string | null };
  getState(): AuthoritativePartyState | null;
  requestState(): Promise<AuthoritativePartyState>;
  refreshParty(): Promise<AuthoritativePartyScope>;
  markPartyMembershipChanged(): void;
  submitCommand(command: AuthoritativeCommand): Promise<AuthoritativeCommandResult>;
  ping(): Promise<number>;
  subscribeToState(listener: (state: AuthoritativePartyState) => void): Unsubscribe;
  subscribeToPartyScope(listener: (scope: AuthoritativePartyScope) => void): Unsubscribe;
  subscribeToPresence(listener: (presence: AuthoritativePresence) => void): Unsubscribe;
  subscribeToConnection(listener: (status: ConnectionState) => void): Unsubscribe;
  subscribeToCommandResults(listener: (result: AuthoritativeCommandResult) => void): Unsubscribe;
  subscribeToErrors(listener: (error: AuthoritativeServerError) => void): Unsubscribe;
  destroy(): Promise<void>;
}

let authoritativeCommandSequence = 0;

export function createAuthoritativeCommand(
  command: AuthoritativeCommandBody,
  expectedRevision: number,
  commandId?: string
): AuthoritativeCommand {
  authoritativeCommandSequence += 1;
  const nextId = commandId ?? `auth_cmd_${Date.now()}_${authoritativeCommandSequence}`;
  return {
    commandId: nextId,
    expectedRevision: Math.max(0, Math.floor(Number(expectedRevision) || 0)),
    command: { ...command }
  };
}
