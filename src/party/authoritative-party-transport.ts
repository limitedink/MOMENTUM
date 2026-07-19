import {
  CONNECTION_STATES,
  type ConnectionState,
  type Unsubscribe
} from './party-types';
import {
  parseAuthoritativeCommandResult,
  parseAuthoritativeConnectionReady,
  parseAuthoritativePartyScope,
  parseAuthoritativePartyState,
  parseAuthoritativePresence
} from './authoritative-party-schema';
import {
  AuthoritativeTransportError,
  type AuthoritativeCommand,
  type AuthoritativeCommandResult,
  type AuthoritativeConnectionReady,
  type AuthoritativePartyScope,
  type AuthoritativePartyState,
  type AuthoritativePartyTransport,
  type AuthoritativePartyTransportOptions,
  type AuthoritativePresence,
  type AuthoritativeServerError,
  type AuthoritativeWebSocketFactory,
  type AuthoritativeWebSocketLike
} from './authoritative-party-types';

const PROTOCOL_VERSION = 1 as const;
const OPEN_READY_STATE = 1;
const CONNECTING_READY_STATE = 0;
const DEFAULT_REQUEST_TIMEOUT_MS = 10_000;
const DEFAULT_PING_INTERVAL_MS = 30_000;
const DEFAULT_MAX_RECONNECT_ATTEMPTS = 5;
const DEFAULT_RECONNECT_BASE_DELAY_MS = 250;
const DEFAULT_RECONNECT_MAX_DELAY_MS = 5_000;
const MAX_COMMAND_ID_LENGTH = 128;
const MAX_COMPLETED_COMMANDS = 100;
const COMMAND_ID_PATTERN = /^[A-Za-z0-9_-]{1,128}$/;

type ServerEnvelope = {
  protocolVersion: number;
  type: string;
  requestId: string | null;
  payload: unknown;
};

type RequestKind = 'refresh' | 'state' | 'ping';

interface PendingRequest {
  kind: RequestKind;
  resolve: (value: unknown) => void;
  reject: (error: unknown) => void;
  timer: ReturnType<typeof setTimeout>;
}

interface PendingCommand {
  command: AuthoritativeCommand;
  promise: Promise<AuthoritativeCommandResult>;
  resolve: (result: AuthoritativeCommandResult) => void;
  sent: boolean;
}

interface ConnectionWaiter {
  resolve: (connected: boolean) => void;
}

interface RuntimeGlobals {
  location?: {
    host?: string;
    protocol?: string;
  };
  WebSocket?: new (url: string) => unknown;
}

const runtimeGlobals = globalThis as unknown as RuntimeGlobals;

function defaultWebSocketUrl(): string {
  if (runtimeGlobals.location?.host) {
    const protocol = runtimeGlobals.location.protocol === 'https:' ? 'wss:' : 'ws:';
    return `${protocol}//${runtimeGlobals.location.host}/v1/ws`;
  }
  return 'ws://127.0.0.1:3000/v1/ws';
}

function defaultWebSocketFactory(): AuthoritativeWebSocketFactory {
  return (url: string): AuthoritativeWebSocketLike => {
    if (typeof runtimeGlobals.WebSocket !== 'function') {
      throw new AuthoritativeTransportError('transport_permanent_error', 'WebSocket is unavailable in this environment.');
    }
    return new runtimeGlobals.WebSocket(url) as AuthoritativeWebSocketLike;
  };
}

function isServerEnvelope(value: unknown): value is ServerEnvelope {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const record = value as Record<string, unknown>;
  return record.protocolVersion === PROTOCOL_VERSION && typeof record.type === 'string' &&
    (record.requestId === null || typeof record.requestId === 'string') && 'payload' in record;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function hasExactKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  return actual.length === expected.length && actual.every((key, index) => key === expected[index]);
}

function decodeServerMessage(data: unknown): ServerEnvelope | null {
  if (typeof data !== 'string') return null;
  try {
    const value: unknown = JSON.parse(data);
    return isServerEnvelope(value) ? value : null;
  } catch {
    return null;
  }
}

function errorMessage(code: string): string {
  switch (code) {
    case 'not_authenticated': return 'Authentication is required.';
    case 'not_in_party': return 'You are not currently in a party.';
    case 'party_refresh_required': return 'Refresh the party scope before using authoritative state.';
    case 'party_scope_mismatch': return 'The authoritative state does not match the current party scope.';
    case 'revision_conflict': return 'The party state changed. Refresh and try again.';
    case 'duplicate_command_mismatch': return 'That command ID was already used with different content.';
    case 'invalid_command': return 'That authoritative command is unavailable.';
    case 'invalid_destination': return 'That expedition destination is unavailable.';
    case 'invalid_contribution': return 'That contribution amount is invalid.';
    case 'invalid_activity': return 'That party activity is unavailable.';
    case 'activity_not_idle': return 'The expedition is not idle.';
    case 'activity_not_active': return 'The expedition is not active.';
    case 'activity_not_completed': return 'The expedition is not completed.';
    case 'reward_not_available': return 'That expedition reward is no longer available.';
    case 'not_party_leader': return 'Only the party leader can reset the expedition.';
    case 'rate_limited': return 'Party commands are temporarily rate limited.';
    case 'transport_disconnected': return 'The authoritative party connection is disconnected.';
    case 'transport_reconnecting': return 'The authoritative party connection is reconnecting.';
    case 'transport_auth_failed': return 'The authoritative party authentication failed.';
    case 'transport_permanent_error': return 'The authoritative party connection cannot be retried.';
    case 'transport_timeout': return 'The authoritative party request timed out.';
    case 'protocol_error': return 'The authoritative party protocol was invalid.';
    case 'unsupported_command': return 'That command is local-only and is not supported by the authoritative server.';
    default: return 'The authoritative party operation was rejected.';
  }
}

function asServerError(
  code: string,
  requestId?: string | null,
  commandId?: string,
  serverTimestamp?: number
): AuthoritativeServerError {
  return {
    code,
    message: errorMessage(code),
    requestId,
    commandId,
    serverTimestamp
  };
}

function isSupportedCommand(value: unknown): value is AuthoritativeCommand {
  if (!isRecord(value) || typeof value.commandId !== 'string' || value.commandId.length < 1 || value.commandId.length > MAX_COMMAND_ID_LENGTH || !COMMAND_ID_PATTERN.test(value.commandId) ||
    typeof value.expectedRevision !== 'number' || !Number.isSafeInteger(value.expectedRevision) || value.expectedRevision < 0 || !isRecord(value.command)) return false;
  if (value.command.type === 'expedition.start') {
    return hasExactKeys(value.command, ['type', 'destination']) && value.command.destination === 'forest';
  }
  if (value.command.type === 'expedition.contribute') {
    return hasExactKeys(value.command, ['type', 'amount']) && typeof value.command.amount === 'number' && Number.isSafeInteger(value.command.amount) && value.command.amount >= 1 && value.command.amount <= 10;
  }
  if (value.command.type === 'party.activity.set') {
    return hasExactKeys(value.command, ['type', 'activityId']) && ['forest_patrol', 'pine_chopping', 'camp_cooking', 'rest'].includes(String(value.command.activityId));
  }
  if (value.command.type === 'expedition.reward.claim') {
    return hasExactKeys(value.command, ['type', 'rewardId']) && typeof value.command.rewardId === 'string' && value.command.rewardId.length > 0 && value.command.rewardId.length <= 160;
  }
  return value.command.type === 'expedition.reset' && hasExactKeys(value.command, ['type']);
}

function isPermanentClose(code: number): boolean {
  return code === 1002 || code === 1003 || code === 1008 || code === 1009 || code === 4001 || code === 4003 || code === 4008;
}

function closeError(code: number): string {
  if (code === 4001 || code === 4003) return 'transport_auth_failed';
  if (isPermanentClose(code)) return 'transport_permanent_error';
  return 'transport_reconnecting';
}

export function createAuthoritativePartyTransport(options: AuthoritativePartyTransportOptions): AuthoritativePartyTransport {
  if (typeof options.token !== 'string' || options.token.length === 0) {
    throw new Error('An authoritative WebSocket token is required.');
  }

  const websocketFactory = options.websocketFactory ?? defaultWebSocketFactory();
  const url = options.url ?? defaultWebSocketUrl();
  const autoReconnect = options.autoReconnect ?? true;
  const maxReconnectAttempts = Math.max(0, Math.floor(options.maxReconnectAttempts ?? DEFAULT_MAX_RECONNECT_ATTEMPTS));
  const reconnectBaseDelayMs = Math.max(0, options.reconnectBaseDelayMs ?? DEFAULT_RECONNECT_BASE_DELAY_MS);
  const reconnectMaxDelayMs = Math.max(reconnectBaseDelayMs, options.reconnectMaxDelayMs ?? DEFAULT_RECONNECT_MAX_DELAY_MS);
  const requestTimeoutMs = Math.max(1, options.requestTimeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS);
  const pingIntervalMs = Math.max(0, options.pingIntervalMs ?? DEFAULT_PING_INTERVAL_MS);
  const now = options.now ?? Date.now;

  let status: ConnectionState = CONNECTION_STATES.DISCONNECTED;
  let socket: AuthoritativeWebSocketLike | null = null;
  let destroyed = false;
  let intentionalClose = false;
  let reconnectAttempt = 0;
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  let pingTimer: ReturnType<typeof setTimeout> | null = null;
  let requestSequence = 0;
  let authenticatedPlayerId: string | null = options.authenticatedPlayerId ?? null;
  let currentPartyId: string | null = null;
  let currentScope: AuthoritativePartyScope = {
    partyId: null,
    leaderPlayerId: null,
    memberPlayerIds: [],
    members: [],
    joinCode: null,
    serverTimestamp: 0
  };
  let authoritativeState: AuthoritativePartyState | null = null;
  let membershipRefreshRequired = false;
  let connectionWaiter: ConnectionWaiter | null = null;
  let reconnectingConnection = false;

  const pendingRequests = new Map<string, PendingRequest>();
  const pendingCommands = new Map<string, PendingCommand>();
  const completedCommands = new Map<string, AuthoritativeCommandResult>();
  const stateListeners = new Set<(state: AuthoritativePartyState) => void>();
  const scopeListeners = new Set<(scope: AuthoritativePartyScope) => void>();
  const presenceListeners = new Set<(presence: AuthoritativePresence) => void>();
  const connectionListeners = new Set<(state: ConnectionState) => void>();
  const commandListeners = new Set<(result: AuthoritativeCommandResult) => void>();
  const errorListeners = new Set<(error: AuthoritativeServerError) => void>();

  function notifyConnection(next: ConnectionState): void {
    if (status === next) return;
    status = next;
    connectionListeners.forEach(listener => listener(status));
  }

  function emitError(error: AuthoritativeServerError): void {
    errorListeners.forEach(listener => listener({ ...error }));
  }

  function makeTransportError(code: string, requestId?: string | null, commandId?: string): AuthoritativeTransportError {
    return new AuthoritativeTransportError(code, errorMessage(code), requestId, commandId);
  }

  function nextRequestId(prefix: string): string {
    requestSequence += 1;
    return `auth_${prefix}_${now()}_${requestSequence}`;
  }

  function clearPingTimer(): void {
    if (pingTimer) clearTimeout(pingTimer);
    pingTimer = null;
  }

  function schedulePing(): void {
    clearPingTimer();
    if (pingIntervalMs === 0 || status !== CONNECTION_STATES.CONNECTED || destroyed) return;
    pingTimer = setTimeout(() => {
      pingTimer = null;
      if (status !== CONNECTION_STATES.CONNECTED) return;
      void ping().catch(() => undefined).finally(schedulePing);
    }, pingIntervalMs);
  }

  function rejectRequests(error: unknown): void {
    const requests = [...pendingRequests.values()];
    pendingRequests.clear();
    requests.forEach(request => {
      clearTimeout(request.timer);
      request.reject(error);
    });
  }

  function resolveConnection(connected: boolean): void {
    if (!connectionWaiter) return;
    const waiter = connectionWaiter;
    connectionWaiter = null;
    waiter.resolve(connected);
  }

  function completeCommand(result: AuthoritativeCommandResult, requestId: string | null = null): void {
    const previous = completedCommands.get(result.commandId);
    if (previous) return;
    const pending = pendingCommands.get(result.commandId);
    if (!pending) return;
    pendingCommands.delete(result.commandId);
    completedCommands.set(result.commandId, result);
    while (completedCommands.size > MAX_COMPLETED_COMMANDS) {
      const oldest = completedCommands.keys().next().value as string | undefined;
      if (!oldest) break;
      completedCommands.delete(oldest);
    }
    commandListeners.forEach(listener => listener({ ...result }));
    pending.resolve(result);
    if (result.errorCode) {
      emitError(asServerError(result.errorCode, requestId, result.commandId, result.serverTimestamp));
    }
  }

  function failPendingCommands(code: string): void {
    const timestamp = now();
    const pending = [...pendingCommands.values()];
    pendingCommands.clear();
    pending.forEach(item => {
      const result: AuthoritativeCommandResult = {
        commandId: item.command.commandId,
        accepted: false,
        resultingRevision: null,
        currentRevision: null,
        errorCode: code,
        serverTimestamp: timestamp
      };
      completedCommands.set(result.commandId, result);
      while (completedCommands.size > MAX_COMPLETED_COMMANDS) {
        const oldest = completedCommands.keys().next().value as string | undefined;
        if (!oldest) break;
        completedCommands.delete(oldest);
      }
      commandListeners.forEach(listener => listener({ ...result }));
      emitError(asServerError(code, null, result.commandId, timestamp));
      item.resolve(result);
    });
  }

  function send(socketToUse: AuthoritativeWebSocketLike, type: string, requestId: string | null, payload: unknown): boolean {
    if (socketToUse.readyState !== OPEN_READY_STATE) return false;
    try {
      socketToUse.send(JSON.stringify({ protocolVersion: PROTOCOL_VERSION, type, requestId, payload }));
      return true;
    } catch {
      return false;
    }
  }

  function sendAuth(socketToUse: AuthoritativeWebSocketLike): boolean {
    return send(socketToUse, 'auth', nextRequestId('auth'), { token: options.token });
  }

  function sendPendingCommands(): void {
    if (!socket || status !== CONNECTION_STATES.CONNECTED) return;
    for (const pending of pendingCommands.values()) {
      if (pending.sent) continue;
      pending.sent = send(socket, 'party.command', nextRequestId('command'), pending.command);
    }
  }

  function resetPartyStateIfScopeChanged(nextPartyId: string | null): void {
    if (currentPartyId !== nextPartyId) authoritativeState = null;
    currentPartyId = nextPartyId;
  }

  function acceptScope(scope: AuthoritativePartyScope): void {
    resetPartyStateIfScopeChanged(scope.partyId);
    currentScope = { ...scope, memberPlayerIds: [...scope.memberPlayerIds], members: scope.members.map(member => ({ ...member })) };
    scopeListeners.forEach(listener => listener({ ...currentScope, memberPlayerIds: [...currentScope.memberPlayerIds], members: currentScope.members.map(member => ({ ...member })) }));
  }

  function acceptState(candidate: AuthoritativePartyState, requestId: string | null): void {
    if (candidate.partyId !== currentPartyId || currentPartyId === null) {
      const error = asServerError('party_scope_mismatch', requestId, undefined, now());
      emitError(error);
      const pending = requestId ? pendingRequests.get(requestId) : undefined;
      if (pending?.kind === 'state' && requestId) {
        pendingRequests.delete(requestId);
        clearTimeout(pending.timer);
        pending.reject(makeTransportError('party_scope_mismatch', requestId));
      }
      return;
    }

    const previousRevision = authoritativeState?.revision;
    const accepted = previousRevision === undefined || candidate.revision > previousRevision;
    if (accepted) {
      authoritativeState = { ...candidate, activity: { ...candidate.activity }, contributions: { ...candidate.contributions }, pendingRewards: Object.fromEntries(Object.entries(candidate.pendingRewards || {}).map(([playerId, rewards]) => [playerId, rewards.map(reward => ({ ...reward, partyXp: { ...reward.partyXp }, rewards: { ...reward.rewards } }))])) };
      stateListeners.forEach(listener => listener({ ...authoritativeState!, activity: { ...authoritativeState!.activity }, contributions: { ...authoritativeState!.contributions }, pendingRewards: Object.fromEntries(Object.entries(authoritativeState!.pendingRewards).map(([playerId, rewards]) => [playerId, rewards.map(reward => ({ ...reward, partyXp: { ...reward.partyXp }, rewards: { ...reward.rewards } }))])) }));
    }

    if (!requestId) return;
    const pending = pendingRequests.get(requestId);
    if (!pending || pending.kind !== 'state') return;
    pendingRequests.delete(requestId);
    clearTimeout(pending.timer);
    pending.resolve(authoritativeState ?? candidate);
  }

  function handleStateError(envelope: ServerEnvelope): void {
    if (typeof envelope.payload !== 'object' || envelope.payload === null || Array.isArray(envelope.payload)) {
      handleProtocolFailure('Invalid authoritative state error.');
      return;
    }
    const payload = envelope.payload as Record<string, unknown>;
    const code = typeof payload.errorCode === 'string' ? payload.errorCode : 'internal_error';
    const serverTimestamp = typeof payload.serverTimestamp === 'number' ? payload.serverTimestamp : now();
    const error = asServerError(code, envelope.requestId, undefined, serverTimestamp);
    emitError(error);
    if (!envelope.requestId) return;
    const pending = pendingRequests.get(envelope.requestId);
    if (!pending || pending.kind !== 'state') return;
    pendingRequests.delete(envelope.requestId);
    clearTimeout(pending.timer);
    pending.reject(makeTransportError(code, envelope.requestId));
  }

  function handleCommandResult(envelope: ServerEnvelope): void {
    const result = parseAuthoritativeCommandResult(envelope.payload);
    if (!result) {
      handleProtocolFailure('Invalid authoritative command result.');
      return;
    }
    const pending = pendingCommands.get(result.commandId);
    if (pending) pending.sent = false;
    completeCommand(result, envelope.requestId);
  }

  function handleProtocolFailure(detail: string): void {
    const error = asServerError('protocol_error', null, undefined, now());
    error.message = detail;
    emitError(error);
    const activeSocket = socket;
    if (activeSocket && activeSocket.readyState === OPEN_READY_STATE) activeSocket.close(1002, 'protocol.error');
  }

  function handleMessage(socketThatReceived: AuthoritativeWebSocketLike, rawData: unknown): void {
    if (socket !== socketThatReceived || destroyed) return;
    const envelope = decodeServerMessage(rawData);
    if (!envelope) {
      handleProtocolFailure('Invalid authoritative WebSocket message.');
      return;
    }

    switch (envelope.type) {
      case 'connection.ready': {
        const ready = parseAuthoritativeConnectionReady(envelope.payload);
        if (!ready || (options.authenticatedPlayerId !== undefined && ready.playerId !== options.authenticatedPlayerId)) {
          handleProtocolFailure('Invalid authoritative connection scope.');
          return;
        }
        authenticatedPlayerId = ready.playerId;
        acceptScope({
          partyId: ready.partyId,
          leaderPlayerId: null,
          memberPlayerIds: ready.memberPlayerIds,
          members: ready.memberPlayerIds.map(playerId => ({ playerId, displayName: '', isLeader: false })),
          joinCode: null,
          serverTimestamp: ready.serverTimestamp
        });
        notifyConnection(CONNECTION_STATES.CONNECTED);
        reconnectAttempt = 0;
        resolveConnection(true);
        schedulePing();
        void hydrateAfterConnection(reconnectingConnection);
        reconnectingConnection = false;
        return;
      }
      case 'party.snapshot': {
        const scope = parseAuthoritativePartyScope(envelope.payload);
        if (!scope) {
          handleProtocolFailure('Invalid authoritative party snapshot.');
          return;
        }
        acceptScope(scope);
        if (envelope.requestId) {
          const pending = pendingRequests.get(envelope.requestId);
          if (pending?.kind === 'refresh') {
            pendingRequests.delete(envelope.requestId);
            clearTimeout(pending.timer);
            membershipRefreshRequired = false;
            pending.resolve(scope);
          }
        }
        return;
      }
      case 'party.presence': {
        const presence = parseAuthoritativePresence(envelope.payload);
        if (!presence) {
          handleProtocolFailure('Invalid authoritative presence message.');
          return;
        }
        presenceListeners.forEach(listener => listener({ ...presence }));
        return;
      }
      case 'party.state.snapshot': {
        const state = parseAuthoritativePartyState(envelope.payload);
        if (!state) {
          handleProtocolFailure('Invalid authoritative state snapshot.');
          return;
        }
        acceptState(state, envelope.requestId);
        return;
      }
      case 'party.state.error':
        handleStateError(envelope);
        return;
      case 'party.command.result':
        handleCommandResult(envelope);
        return;
      case 'pong': {
        const payload = envelope.payload as Record<string, unknown>;
        if (typeof payload !== 'object' || payload === null ||
          !Number.isFinite((payload as Record<string, unknown>).serverTimestamp) || !envelope.requestId) {
          handleProtocolFailure('Invalid authoritative pong.');
          return;
        }
        const pending = pendingRequests.get(envelope.requestId);
        if (!pending || pending.kind !== 'ping') return;
        pendingRequests.delete(envelope.requestId);
        clearTimeout(pending.timer);
        pending.resolve(Math.max(0, now() - Number((payload as Record<string, unknown>).serverTimestamp)));
        return;
      }
      default:
        handleProtocolFailure('Unknown authoritative WebSocket message.');
    }
  }

  function failConnection(code: string, permanent: boolean): void {
    const error = makeTransportError(code);
    emitError(asServerError(code, null, undefined, now()));
    rejectRequests(error);
    if (permanent) {
      failPendingCommands(code);
      resolveConnection(false);
    }
  }

  function scheduleReconnect(): void {
    if (destroyed || intentionalClose || !autoReconnect || reconnectAttempt >= maxReconnectAttempts) {
      notifyConnection(CONNECTION_STATES.ERROR);
      failConnection('transport_permanent_error', true);
      resolveConnection(false);
      return;
    }
    reconnectAttempt += 1;
    const delay = Math.min(reconnectMaxDelayMs, reconnectBaseDelayMs * (2 ** (reconnectAttempt - 1)));
    notifyConnection(CONNECTION_STATES.RECONNECTING);
    reconnectTimer = setTimeout(() => {
      reconnectTimer = null;
      startSocket(true);
    }, delay);
  }

  function handleClose(socketThatClosed: AuthoritativeWebSocketLike, code: number): void {
    if (socket !== socketThatClosed || destroyed) return;
    socket = null;
    clearPingTimer();
    const wasIntentional = intentionalClose;
    intentionalClose = false;
    if (wasIntentional) {
      notifyConnection(CONNECTION_STATES.DISCONNECTED);
      failConnection('transport_disconnected', true);
      resolveConnection(false);
      return;
    }
    const errorCode = closeError(code);
    const permanent = isPermanentClose(code);
    if (permanent) {
      notifyConnection(CONNECTION_STATES.ERROR);
      failConnection(errorCode, true);
      return;
    }
    for (const pending of pendingCommands.values()) pending.sent = false;
    failConnection('transport_reconnecting', false);
    scheduleReconnect();
  }

  function attachSocket(nextSocket: AuthoritativeWebSocketLike, isReconnect: boolean): void {
    socket = nextSocket;
    reconnectingConnection = isReconnect;
    nextSocket.onopen = () => {
      if (socket !== nextSocket || destroyed) return;
      if (!sendAuth(nextSocket)) nextSocket.close(1011, 'auth.send_failed');
    };
    nextSocket.onmessage = event => handleMessage(nextSocket, event.data);
    nextSocket.onerror = () => undefined;
    nextSocket.onclose = event => handleClose(nextSocket, event.code);
  }

  function startSocket(isReconnect: boolean): void {
    if (destroyed) return;
    notifyConnection(isReconnect ? CONNECTION_STATES.RECONNECTING : CONNECTION_STATES.CONNECTING);
    let nextSocket: AuthoritativeWebSocketLike;
    try {
      nextSocket = websocketFactory(url);
    } catch (error) {
      emitError(asServerError(error instanceof AuthoritativeTransportError ? error.code : 'transport_permanent_error'));
      if (isReconnect) scheduleReconnect();
      else {
        notifyConnection(CONNECTION_STATES.ERROR);
        resolveConnection(false);
      }
      return;
    }
    attachSocket(nextSocket, isReconnect);
  }

  function request<T>(kind: RequestKind, type: string, payload: unknown): Promise<T> {
    if (!socket || status !== CONNECTION_STATES.CONNECTED) {
      return Promise.reject(makeTransportError(status === CONNECTION_STATES.RECONNECTING ? 'transport_reconnecting' : 'transport_disconnected'));
    }
    const requestId = nextRequestId(kind);
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        pendingRequests.delete(requestId);
        reject(makeTransportError('transport_timeout', requestId));
      }, requestTimeoutMs);
      pendingRequests.set(requestId, { kind, resolve: value => resolve(value as T), reject, timer });
      if (!send(socket!, type, requestId, payload)) {
        clearTimeout(timer);
        pendingRequests.delete(requestId);
        reject(makeTransportError('transport_disconnected', requestId));
      }
    });
  }

  async function hydrateAfterConnection(isReconnect: boolean): Promise<void> {
    if (status !== CONNECTION_STATES.CONNECTED) return;
    try {
      await refreshParty();
    } catch {
      return;
    }
    if (status !== CONNECTION_STATES.CONNECTED) return;
    if (currentPartyId !== null) {
      try {
        await requestState();
      } catch {
        // The server error has already been surfaced to subscribers.
      }
    }
    if (isReconnect) sendPendingCommands();
  }

  function connect(): Promise<boolean> {
    if (destroyed || status === CONNECTION_STATES.CONNECTED || status === CONNECTION_STATES.CONNECTING || status === CONNECTION_STATES.RECONNECTING) return Promise.resolve(false);
    intentionalClose = false;
    reconnectAttempt = 0;
    const promise = new Promise<boolean>(resolve => { connectionWaiter = { resolve }; });
    startSocket(false);
    return promise;
  }

  async function disconnect(): Promise<boolean> {
    if (destroyed || status === CONNECTION_STATES.DISCONNECTED) return false;
    intentionalClose = true;
    if (reconnectTimer) clearTimeout(reconnectTimer);
    reconnectTimer = null;
    clearPingTimer();
    rejectRequests(makeTransportError('transport_disconnected'));
    failPendingCommands('transport_disconnected');
    const activeSocket = socket;
    if (activeSocket && (activeSocket.readyState === OPEN_READY_STATE || activeSocket.readyState === CONNECTING_READY_STATE)) {
      activeSocket.close(1000, 'client.disconnect');
    } else {
      socket = null;
      intentionalClose = false;
      notifyConnection(CONNECTION_STATES.DISCONNECTED);
      resolveConnection(false);
    }
    await Promise.resolve();
    return true;
  }

  function requestState(): Promise<AuthoritativePartyState> {
    if (membershipRefreshRequired) return Promise.reject(makeTransportError('party_refresh_required'));
    return request<AuthoritativePartyState>('state', 'party.state.get', {});
  }

  function refreshParty(): Promise<AuthoritativePartyScope> {
    return request<AuthoritativePartyScope>('refresh', 'party.refresh', {});
  }

  function markPartyMembershipChanged(): void {
    membershipRefreshRequired = true;
  }

  function submitCommand(command: AuthoritativeCommand): Promise<AuthoritativeCommandResult> {
    const commandValue: unknown = command;
    if (!isSupportedCommand(commandValue)) {
      const result: AuthoritativeCommandResult = {
        commandId: isRecord(commandValue) && typeof commandValue.commandId === 'string' ? commandValue.commandId : '',
        accepted: false,
        resultingRevision: null,
        currentRevision: authoritativeState?.revision ?? null,
        errorCode: 'unsupported_command',
        serverTimestamp: now()
      };
      emitError(asServerError('unsupported_command', null, result.commandId, result.serverTimestamp));
      return Promise.resolve(result);
    }
    const supportedCommand = commandValue;
    const completed = completedCommands.get(supportedCommand.commandId);
    if (completed) return Promise.resolve({ ...completed });
    const existing = pendingCommands.get(supportedCommand.commandId);
    if (existing) return existing.promise;
    let resolveCommand!: (result: AuthoritativeCommandResult) => void;
    const promise = new Promise<AuthoritativeCommandResult>(resolve => { resolveCommand = resolve; });
    const pending: PendingCommand = { command: { ...supportedCommand, command: { ...supportedCommand.command } }, promise, resolve: resolveCommand, sent: false };
    pendingCommands.set(supportedCommand.commandId, pending);
    if (status !== CONNECTION_STATES.CONNECTED || !socket) {
      completeCommand({
        commandId: supportedCommand.commandId,
        accepted: false,
        resultingRevision: null,
        currentRevision: authoritativeState?.revision ?? null,
        errorCode: status === CONNECTION_STATES.RECONNECTING ? 'transport_reconnecting' : 'transport_disconnected',
        serverTimestamp: now()
      });
      return promise;
    }
    pending.sent = send(socket, 'party.command', nextRequestId('command'), pending.command);
    return promise;
  }

  function ping(): Promise<number> {
    const startedAt = now();
    return request<number>('ping', 'ping', {}).then(() => Math.max(0, now() - startedAt));
  }

  async function destroy(): Promise<void> {
    if (destroyed) return;
    await disconnect();
    destroyed = true;
    stateListeners.clear();
    scopeListeners.clear();
    presenceListeners.clear();
    connectionListeners.clear();
    commandListeners.clear();
    errorListeners.clear();
  }

  return Object.freeze({
    connect,
    disconnect,
    getConnectionState: () => status,
    getSessionIdentity: () => ({ authenticatedPlayerId, currentPartyId }),
    getState: () => authoritativeState,
    requestState,
    refreshParty,
    markPartyMembershipChanged,
    submitCommand,
    ping,
    subscribeToState: (listener: (state: AuthoritativePartyState) => void): Unsubscribe => { stateListeners.add(listener); return () => stateListeners.delete(listener); },
    subscribeToPartyScope: (listener: (scope: AuthoritativePartyScope) => void): Unsubscribe => { scopeListeners.add(listener); return () => scopeListeners.delete(listener); },
    subscribeToPresence: (listener: (presence: AuthoritativePresence) => void): Unsubscribe => { presenceListeners.add(listener); return () => presenceListeners.delete(listener); },
    subscribeToConnection: (listener: (state: ConnectionState) => void): Unsubscribe => { connectionListeners.add(listener); return () => connectionListeners.delete(listener); },
    subscribeToCommandResults: (listener: (result: AuthoritativeCommandResult) => void): Unsubscribe => { commandListeners.add(listener); return () => commandListeners.delete(listener); },
    subscribeToErrors: (listener: (error: AuthoritativeServerError) => void): Unsubscribe => { errorListeners.add(listener); return () => errorListeners.delete(listener); },
    destroy
  });
}

export type { AuthoritativePartyTransport } from './authoritative-party-types';
