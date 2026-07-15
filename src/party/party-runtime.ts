import {
  CONNECTION_STATES,
  type ClientSessionState,
  type CommandType,
  type ConnectionState,
  type MomentumPartyClient,
  type MomentumPartyTransport,
  type PartyActivityId,
  type PartyClientState,
  type PartySnapshot,
  type Unsubscribe
} from './party-types';
import { createLocalMomentumPartyTransport } from './local-party-transport';
import { createPartyClient } from './party-client';
import { createAuthoritativeCommand, type AuthoritativeCommandResult, type AuthoritativePartyScope, type AuthoritativePartyTransport, type AuthoritativePartyTransportOptions, type AuthoritativePresence, type AuthoritativeServerError } from './authoritative-party-types';
import { createAuthoritativePartyTransport } from './authoritative-party-transport';
import { createBackendIdentityClient, getConfiguredBackendBaseUrl, type BackendIdentityClient, type BackendPlayerSession } from './backend-identity';

export const PARTY_RUNTIME_MODES = {
  LOCAL: 'local',
  AUTHORITATIVE: 'authoritative'
} as const;

export type PartyRuntimeMode = (typeof PARTY_RUNTIME_MODES)[keyof typeof PARTY_RUNTIME_MODES];

export interface LocalPartyRuntimeState {
  mode: 'local';
  requestedMode: PartyRuntimeMode;
  fallbackReason: string | null;
  client: PartyClientState;
}

export interface AuthoritativePartyRuntimeState {
  mode: 'authoritative';
  requestedMode: 'authoritative';
  fallbackReason: null;
  connection: ConnectionState;
  identity: {
    authenticatedPlayerId: string | null;
    currentPartyId: string | null;
    sessionId: string | null;
  };
  authoritative: {
    scope: AuthoritativePartyScope;
    state: import('./authoritative-party-types').AuthoritativePartyState | null;
    presence: Record<string, AuthoritativePresence>;
    pendingCommandIds: string[];
    lastCommandResult: AuthoritativeCommandResult | null;
    lastError: AuthoritativeServerError | null;
  };
}

export type PartyRuntimeState = LocalPartyRuntimeState | AuthoritativePartyRuntimeState;
export type PartyRuntimeListener = (state: PartyRuntimeState, reason: string) => void;

export interface PartyRuntime {
  initialize(): Promise<boolean>;
  connect(): Promise<boolean>;
  disconnect(): Promise<boolean>;
  reconnect(): Promise<boolean>;
  destroy(): Promise<void>;
  getMode(): PartyRuntimeMode;
  getRequestedMode(): PartyRuntimeMode;
  getConnectionState(): ConnectionState;
  getState(): PartyRuntimeState;
  getSnapshot(): PartySnapshot | null;
  getSessionState(): ClientSessionState | null;
  getCommandState(type: string): { type: string; status: string } | ReturnType<MomentumPartyClient['getCommandState']>;
  requestSnapshot(): Promise<PartySnapshot | import('./authoritative-party-types').AuthoritativePartyState | null>;
  refreshParty(): Promise<AuthoritativePartyScope | null>;
  markPartyMembershipChanged(): void;
  setActivity(activityId: PartyActivityId): Promise<boolean>;
  startExpedition(): Promise<boolean>;
  pauseExpedition(): Promise<boolean>;
  resumeExpedition(): Promise<boolean>;
  resetExpedition(): Promise<boolean>;
  contribute(amount?: number): Promise<boolean>;
  toggleExpedition(): Promise<boolean>;
  claimReward(rewardId?: string): Promise<boolean>;
  subscribe(listener: PartyRuntimeListener): Unsubscribe;
}

export interface PartyRuntimeOptions {
  mode?: PartyRuntimeMode;
  fallbackToLocal?: boolean;
  identityClient?: BackendIdentityClient;
  authoritativeTransportFactory?: (options: AuthoritativePartyTransportOptions) => AuthoritativePartyTransport;
  localTransportFactory?: () => MomentumPartyTransport;
  backendBaseUrl?: string;
  authoritativeWebSocketUrl?: string;
}

const EMPTY_SCOPE: AuthoritativePartyScope = {
  partyId: null,
  leaderPlayerId: null,
  memberPlayerIds: [],
  joinCode: null,
  serverTimestamp: 0
};

function modeFromValue(value: unknown): PartyRuntimeMode | null {
  return value === PARTY_RUNTIME_MODES.LOCAL || value === PARTY_RUNTIME_MODES.AUTHORITATIVE ? value : null;
}

export function resolvePartyRuntimeMode(
  locationLike: Pick<Location, 'search'> | undefined = typeof window === 'undefined' ? undefined : window.location,
  configuredMode: unknown = import.meta.env.VITE_MOMENTUM_PARTY_MODE
): PartyRuntimeMode {
  const queryMode = locationLike ? new URLSearchParams(locationLike.search).get('partyTransport') : null;
  return modeFromValue(queryMode) ?? modeFromValue(configuredMode) ?? PARTY_RUNTIME_MODES.LOCAL;
}

function websocketUrlForBackend(baseUrl: string, configuredUrl: string | undefined): string | undefined {
  if (configuredUrl) return configuredUrl;
  if (!baseUrl) return undefined;
  return `${baseUrl.replace(/^http:/, 'ws:').replace(/^https:/, 'wss:')}/v1/ws`;
}

function localFallbackReason(error: unknown): string {
  return error instanceof Error ? error.message : 'Authoritative backend identity was unavailable.';
}

export function createPartyRuntime(options: PartyRuntimeOptions = {}): PartyRuntime {
  const requestedMode = options.mode ?? resolvePartyRuntimeMode();
  const fallbackToLocal = options.fallbackToLocal ?? true;
  const identityClient = options.identityClient ?? createBackendIdentityClient({ baseUrl: options.backendBaseUrl ?? getConfiguredBackendBaseUrl() });
  const createAuthoritativeTransport = options.authoritativeTransportFactory ?? createAuthoritativePartyTransport;
  const createLocalTransport = options.localTransportFactory ?? (() => createLocalMomentumPartyTransport());

  let mode: PartyRuntimeMode = requestedMode;
  let fallbackReason: string | null = null;
  let localClient: MomentumPartyClient | null = null;
  let authoritativeTransport: AuthoritativePartyTransport | null = null;
  let identity: BackendPlayerSession | null = null;
  let state: AuthoritativePartyRuntimeState['authoritative'] = {
    scope: { ...EMPTY_SCOPE, memberPlayerIds: [] },
    state: null,
    presence: {},
    pendingCommandIds: [],
    lastCommandResult: null,
    lastError: null
  };
  let initialized = false;
  let destroyed = false;
  const listeners = new Set<PartyRuntimeListener>();
  const unsubscribers: Unsubscribe[] = [];

  function notify(reason: string): void {
    if (!initialized || destroyed) return;
    const next = getState();
    listeners.forEach(listener => listener(next, reason));
  }

  function bindAuthoritativeTransport(transport: AuthoritativePartyTransport): void {
    authoritativeTransport = transport;
    unsubscribers.push(transport.subscribeToConnection(connection => notify('connection')));
    unsubscribers.push(transport.subscribeToPartyScope(scope => {
      state = { ...state, scope: { ...scope, memberPlayerIds: [...scope.memberPlayerIds] } };
      notify('party.scope');
    }));
    unsubscribers.push(transport.subscribeToState(nextState => {
      state = { ...state, state: nextState };
      notify('authoritative.state');
    }));
    unsubscribers.push(transport.subscribeToPresence(presence => {
      state = { ...state, presence: { ...state.presence, [presence.playerId]: presence } };
      notify('party.presence');
    }));
    unsubscribers.push(transport.subscribeToCommandResults(result => {
      state = { ...state, pendingCommandIds: state.pendingCommandIds.filter(id => id !== result.commandId), lastCommandResult: result };
      notify('command.result');
    }));
    unsubscribers.push(transport.subscribeToErrors(error => {
      state = { ...state, lastError: error };
      notify('transport.error');
    }));
  }

  async function initializeLocal(reason: string | null = null): Promise<boolean> {
    mode = PARTY_RUNTIME_MODES.LOCAL;
    fallbackReason = reason;
    localClient = createPartyClient(createLocalTransport());
    await localClient.initialize();
    unsubscribers.push(localClient.subscribe((_state, notifyReason) => notify(notifyReason)));
    initialized = true;
    notify(reason ? 'local.fallback' : 'initialized');
    return true;
  }

  async function initialize(): Promise<boolean> {
    if (destroyed) return false;
    if (initialized) return true;
    if (requestedMode === PARTY_RUNTIME_MODES.LOCAL) return initializeLocal();

    try {
      identity = await identityClient.acquire();
      const transport = createAuthoritativeTransport({
        token: identity.token,
        authenticatedPlayerId: identity.playerId,
        url: websocketUrlForBackend(options.backendBaseUrl ?? getConfiguredBackendBaseUrl(), options.authoritativeWebSocketUrl)
      });
      bindAuthoritativeTransport(transport);
      initialized = true;
      notify('initialized');
      return true;
    } catch (error) {
      if (!fallbackToLocal) return false;
      return initializeLocal(localFallbackReason(error));
    }
  }

  function requireInitialized(): void {
    if (!initialized || destroyed) throw new Error('Momentum party runtime is not initialized.');
  }

  function getState(): PartyRuntimeState {
    if (mode === PARTY_RUNTIME_MODES.LOCAL) {
      requireInitialized();
      return { mode: 'local', requestedMode, fallbackReason, client: localClient!.getState() };
    }
    return {
      mode: 'authoritative',
      requestedMode: PARTY_RUNTIME_MODES.AUTHORITATIVE,
      fallbackReason: null,
      connection: authoritativeTransport?.getConnectionState() ?? CONNECTION_STATES.DISCONNECTED,
      identity: {
        authenticatedPlayerId: identity?.playerId ?? authoritativeTransport?.getSessionIdentity().authenticatedPlayerId ?? null,
        currentPartyId: state.scope.partyId,
        sessionId: identity?.sessionId ?? null
      },
      authoritative: {
        scope: { ...state.scope, memberPlayerIds: [...state.scope.memberPlayerIds] },
        state: state.state,
        presence: { ...state.presence },
        pendingCommandIds: [...state.pendingCommandIds],
        lastCommandResult: state.lastCommandResult,
        lastError: state.lastError
      }
    };
  }

  function getConnectionState(): ConnectionState {
    if (mode === PARTY_RUNTIME_MODES.LOCAL) return localClient?.getConnectionState() ?? CONNECTION_STATES.DISCONNECTED;
    return authoritativeTransport?.getConnectionState() ?? CONNECTION_STATES.DISCONNECTED;
  }

  async function connect(): Promise<boolean> {
    requireInitialized();
    return mode === PARTY_RUNTIME_MODES.LOCAL ? localClient!.connect() : authoritativeTransport!.connect();
  }

  async function disconnect(): Promise<boolean> {
    requireInitialized();
    return mode === PARTY_RUNTIME_MODES.LOCAL ? localClient!.disconnect() : authoritativeTransport!.disconnect();
  }

  async function reconnect(): Promise<boolean> {
    requireInitialized();
    await disconnect();
    return connect();
  }

  function getSnapshot(): PartySnapshot | null {
    return mode === PARTY_RUNTIME_MODES.LOCAL ? localClient?.getSnapshot() ?? null : null;
  }

  function getSessionState(): ClientSessionState | null {
    return mode === PARTY_RUNTIME_MODES.LOCAL ? localClient?.getSessionState() ?? null : null;
  }

  function getCommandState(type: string): { type: string; status: string } | ReturnType<MomentumPartyClient['getCommandState']> {
    if (mode === PARTY_RUNTIME_MODES.LOCAL) return localClient!.getCommandState(type);
    return { type, status: 'idle' };
  }

  async function requestSnapshot(): Promise<PartySnapshot | import('./authoritative-party-types').AuthoritativePartyState | null> {
    requireInitialized();
    if (mode === PARTY_RUNTIME_MODES.LOCAL) return localClient!.requestSnapshot();
    try {
      const authoritativeState = await authoritativeTransport!.requestState();
      state = { ...state, state: authoritativeState, lastError: null };
      notify('authoritative.state.requested');
      return authoritativeState;
    } catch {
      return state.state;
    }
  }

  async function refreshParty(): Promise<AuthoritativePartyScope | null> {
    requireInitialized();
    if (mode === PARTY_RUNTIME_MODES.LOCAL) return null;
    const scope = await authoritativeTransport!.refreshParty();
    state = { ...state, scope: { ...scope, memberPlayerIds: [...scope.memberPlayerIds] }, lastError: null };
    notify('party.scope.refreshed');
    return scope;
  }

  function markPartyMembershipChanged(): void {
    if (mode === PARTY_RUNTIME_MODES.AUTHORITATIVE) authoritativeTransport?.markPartyMembershipChanged();
  }

  async function submitAuthoritative(command: Parameters<typeof createAuthoritativeCommand>[0], expectedRevision = state.state?.revision ?? 0): Promise<boolean> {
    requireInitialized();
    if (mode !== PARTY_RUNTIME_MODES.AUTHORITATIVE || !authoritativeTransport) return false;
    const envelope = createAuthoritativeCommand(command, expectedRevision);
    state = { ...state, pendingCommandIds: [...state.pendingCommandIds, envelope.commandId] };
    notify('command.pending');
    const result = await authoritativeTransport.submitCommand(envelope);
    state = { ...state, pendingCommandIds: state.pendingCommandIds.filter(id => id !== result.commandId), lastCommandResult: result };
    notify('command.settled');
    return result.accepted;
  }

  function unsupportedAuthoritativeAction(): Promise<boolean> {
    if (mode === PARTY_RUNTIME_MODES.AUTHORITATIVE) {
      state = { ...state, lastError: { code: 'unsupported_command', message: 'That action is not part of the current authoritative expedition protocol.' } };
      notify('unsupported.action');
    }
    return Promise.resolve(false);
  }

  async function toggleExpedition(): Promise<boolean> {
    if (mode === PARTY_RUNTIME_MODES.LOCAL) return localClient!.toggleExpedition();
    const status = state.state?.activity.status;
    if (status === 'idle' || status === undefined) return submitAuthoritative({ type: 'expedition.start', destination: 'forest' });
    if (status === 'completed') return submitAuthoritative({ type: 'expedition.reset' });
    return unsupportedAuthoritativeAction();
  }

  async function destroy(): Promise<void> {
    if (destroyed) return;
    destroyed = true;
    unsubscribers.splice(0).forEach(unsubscribe => unsubscribe());
    listeners.clear();
    if (localClient) await localClient.destroy();
    if (authoritativeTransport) await authoritativeTransport.destroy();
  }

  return Object.freeze({
    initialize,
    connect,
    disconnect,
    reconnect,
    destroy,
    getMode: () => mode,
    getRequestedMode: () => requestedMode,
    getConnectionState,
    getState,
    getSnapshot,
    getSessionState,
    getCommandState,
    requestSnapshot,
    refreshParty,
    markPartyMembershipChanged,
    setActivity: (activityId: PartyActivityId) => mode === PARTY_RUNTIME_MODES.LOCAL ? localClient!.setActivity(activityId) : unsupportedAuthoritativeAction(),
    startExpedition: () => mode === PARTY_RUNTIME_MODES.LOCAL ? localClient!.startExpedition() : submitAuthoritative({ type: 'expedition.start', destination: 'forest' }),
    pauseExpedition: () => mode === PARTY_RUNTIME_MODES.LOCAL ? localClient!.pauseExpedition() : unsupportedAuthoritativeAction(),
    resumeExpedition: () => mode === PARTY_RUNTIME_MODES.LOCAL ? localClient!.resumeExpedition() : unsupportedAuthoritativeAction(),
    resetExpedition: () => mode === PARTY_RUNTIME_MODES.LOCAL ? unsupportedAuthoritativeAction() : submitAuthoritative({ type: 'expedition.reset' }),
    contribute: (amount = 1) => mode === PARTY_RUNTIME_MODES.LOCAL ? unsupportedAuthoritativeAction() : submitAuthoritative({ type: 'expedition.contribute', amount }),
    toggleExpedition,
    claimReward: (rewardId?: string) => mode === PARTY_RUNTIME_MODES.LOCAL ? localClient!.claimReward(rewardId) : unsupportedAuthoritativeAction(),
    subscribe: (listener: PartyRuntimeListener): Unsubscribe => { listeners.add(listener); return () => listeners.delete(listener); }
  });
}
