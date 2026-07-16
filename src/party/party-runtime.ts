import {
  CONNECTION_STATES,
  type ClientSessionState,
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
import { createBackendPartyApi, type BackendParty, type BackendPartyApi, type BackendPartyApiOptions, BackendPartyApiError } from './backend-party-api';

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
    party: BackendParty | null;
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
  getParty(): BackendParty | null;
  createParty(): Promise<BackendParty | null>;
  joinParty(joinCode: string): Promise<BackendParty | null>;
  leaveParty(): Promise<boolean>;
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
  partyApiFactory?: (options: BackendPartyApiOptions) => BackendPartyApi;
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

function partyApiError(error: unknown): AuthoritativeServerError {
  if (error instanceof BackendPartyApiError) return { code: error.code, message: error.message };
  return { code: 'party_request_failed', message: 'The party request could not be completed.' };
}

function cloneParty(party: BackendParty | null): BackendParty | null {
  return party ? { ...party, members: party.members.map(member => ({ ...member })) } : null;
}

export function createPartyRuntime(options: PartyRuntimeOptions = {}): PartyRuntime {
  const requestedMode = options.mode ?? resolvePartyRuntimeMode();
  const fallbackToLocal = options.fallbackToLocal ?? true;
  const identityClient = options.identityClient ?? createBackendIdentityClient({ baseUrl: options.backendBaseUrl ?? getConfiguredBackendBaseUrl() });
  const createAuthoritativeTransport = options.authoritativeTransportFactory ?? createAuthoritativePartyTransport;
  const createPartyApi = options.partyApiFactory ?? createBackendPartyApi;
  const createLocalTransport = options.localTransportFactory ?? (() => createLocalMomentumPartyTransport());

  let mode: PartyRuntimeMode = requestedMode;
  let fallbackReason: string | null = null;
  let localClient: MomentumPartyClient | null = null;
  let authoritativeTransport: AuthoritativePartyTransport | null = null;
  let partyApi: BackendPartyApi | null = null;
  let identity: BackendPlayerSession | null = null;
  let state: AuthoritativePartyRuntimeState['authoritative'] = {
    scope: { ...EMPTY_SCOPE, memberPlayerIds: [] },
    party: null,
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
      const partyChanged = state.scope.partyId !== scope.partyId;
      state = {
        ...state,
        scope: { ...scope, memberPlayerIds: [...scope.memberPlayerIds] },
        party: scope.partyId === null ? null : state.party,
        state: partyChanged ? null : state.state,
        presence: partyChanged ? {} : state.presence
      };
      notify('party.scope');
    }));
    unsubscribers.push(transport.subscribeToState(nextState => {
      state = { ...state, state: nextState };
      notify('authoritative.state');
    }));
    unsubscribers.push(transport.subscribeToPresence(presence => {
      state = { ...state, presence: { ...state.presence, [presence.playerId]: presence } };
      notify('party.presence');
      if (getConnectionState() === CONNECTION_STATES.CONNECTED) void refreshParty().catch(() => undefined);
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
      partyApi = createPartyApi({
        baseUrl: options.backendBaseUrl ?? getConfiguredBackendBaseUrl(),
        token: identity.token
      });
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
        party: cloneParty(state.party),
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
    if (mode === PARTY_RUNTIME_MODES.LOCAL) return localClient!.connect();
    const connected = await authoritativeTransport!.connect();
    if (connected) await refreshPartyDetailsFromHttp();
    return connected;
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

  function getParty(): BackendParty | null {
    return mode === PARTY_RUNTIME_MODES.AUTHORITATIVE ? cloneParty(state.party) : null;
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

  async function refreshPartyDetailsFromHttp(): Promise<BackendParty | null> {
    if (mode !== PARTY_RUNTIME_MODES.AUTHORITATIVE || !partyApi) return null;
    try {
      const party = await partyApi.getCurrentParty();
      state = { ...state, party, lastError: null };
      notify('party.details');
      return party;
    } catch (error) {
      state = { ...state, lastError: partyApiError(error) };
      notify('party.error');
      return state.party;
    }
  }

  async function refreshParty(): Promise<AuthoritativePartyScope | null> {
    requireInitialized();
    if (mode === PARTY_RUNTIME_MODES.LOCAL) return null;
    const party = await refreshPartyDetailsFromHttp();
    const scope = await authoritativeTransport!.refreshParty();
    state = {
      ...state,
      party,
      scope: { ...scope, memberPlayerIds: [...scope.memberPlayerIds] },
      state: scope.partyId ? state.state : null,
      presence: scope.partyId ? state.presence : {},
      lastError: null
    };
    notify('party.scope.refreshed');
    if (scope.partyId) await requestSnapshot();
    return scope;
  }

  function markPartyMembershipChanged(): void {
    if (mode === PARTY_RUNTIME_MODES.AUTHORITATIVE) authoritativeTransport?.markPartyMembershipChanged();
  }

  async function createParty(): Promise<BackendParty | null> {
    requireInitialized();
    if (mode !== PARTY_RUNTIME_MODES.AUTHORITATIVE || !partyApi || !authoritativeTransport) return null;
    try {
      const party = await partyApi.createParty();
      state = { ...state, party, lastError: null };
      notify('party.created');
      authoritativeTransport.markPartyMembershipChanged();
      await refreshParty();
      return cloneParty(state.party);
    } catch (error) {
      state = { ...state, lastError: partyApiError(error) };
      notify('party.error');
      return null;
    }
  }

  async function joinParty(joinCode: string): Promise<BackendParty | null> {
    requireInitialized();
    if (mode !== PARTY_RUNTIME_MODES.AUTHORITATIVE || !partyApi || !authoritativeTransport) return null;
    try {
      const party = await partyApi.joinParty(joinCode);
      state = { ...state, party, lastError: null };
      notify('party.joined');
      authoritativeTransport.markPartyMembershipChanged();
      await refreshParty();
      return cloneParty(state.party);
    } catch (error) {
      state = { ...state, lastError: partyApiError(error) };
      notify('party.error');
      return null;
    }
  }

  async function leaveParty(): Promise<boolean> {
    requireInitialized();
    if (mode !== PARTY_RUNTIME_MODES.AUTHORITATIVE || !partyApi || !authoritativeTransport) return false;
    try {
      await partyApi.leaveParty();
      state = { ...state, party: null, state: null, presence: {}, lastError: null };
      notify('party.left');
      authoritativeTransport.markPartyMembershipChanged();
      await refreshParty();
      return true;
    } catch (error) {
      state = { ...state, lastError: partyApiError(error) };
      notify('party.error');
      return false;
    }
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
    getParty,
    createParty,
    joinParty,
    leaveParty,
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
