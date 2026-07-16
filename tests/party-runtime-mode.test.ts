import { describe, expect, it } from 'vitest';
import { CONNECTION_STATES, type AuthoritativePartyState, type ConnectionState } from '../src/party/party-types';
import { createBackendIdentityClient, IDENTITY_STORAGE_KEY } from '../src/party/backend-identity';
import type { BackendPartyApi } from '../src/party/backend-party-api';
import { createPartyRuntime, PARTY_RUNTIME_MODES, resolvePartyRuntimeMode } from '../src/party/party-runtime';
import { createLocalMomentumPartyTransport } from '../src/party/local-party-transport';
import type {
  AuthoritativeCommand,
  AuthoritativeCommandResult,
  AuthoritativePartyScope,
  AuthoritativePartyTransport,
  AuthoritativeServerError
} from '../src/party/authoritative-party-types';

function response(body: unknown, status = 200): Response {
  return { ok: status >= 200 && status < 300, status, json: async () => body } as Response;
}

function storageWith(value: string | null) {
  const values: Record<string, string> = value === null ? {} : { [IDENTITY_STORAGE_KEY]: value };
  return {
    getItem: (key: string) => values[key] ?? null,
    setItem: (key: string, next: string) => { values[key] = next; },
    removeItem: (key: string) => { delete values[key]; },
    values
  };
}

const scope: AuthoritativePartyScope = {
  partyId: 'party-1',
  leaderPlayerId: 'player-1',
  memberPlayerIds: ['player-1', 'player-2'],
  joinCode: 'ABCD2345EF',
  serverTimestamp: 1000
};

const authoritativeState: AuthoritativePartyState = {
  partyId: 'party-1',
  revision: 0,
  activity: { kind: 'expedition', status: 'idle', destination: null, startedAt: null, completesAt: null },
  contributions: { 'player-1': 0, 'player-2': 0 },
  updatedAt: '2026-07-15T00:00:00.000Z',
  serverTimestamp: 1000
};

function createFakeAuthoritativeTransport() {
  let connection: ConnectionState = CONNECTION_STATES.DISCONNECTED;
  let currentState: AuthoritativePartyState | null = null;
  let currentScope = { ...scope, memberPlayerIds: [...scope.memberPlayerIds] };
  let membershipChanged = false;
  const commands: AuthoritativeCommand[] = [];
  const operations: string[] = [];
  const connectionListeners = new Set<(value: typeof connection) => void>();
  const scopeListeners = new Set<(value: AuthoritativePartyScope) => void>();
  const stateListeners = new Set<(value: AuthoritativePartyState) => void>();
  const presenceListeners = new Set<(value: { playerId: string; status: 'online' | 'offline'; connectedSessionCount: number; serverTimestamp: number }) => void>();
  const commandListeners = new Set<(value: AuthoritativeCommandResult) => void>();
  const errorListeners = new Set<(value: AuthoritativeServerError) => void>();
  const transport: AuthoritativePartyTransport = {
    connect: async () => { operations.push('connect'); connection = CONNECTION_STATES.CONNECTED; connectionListeners.forEach(listener => listener(connection)); return true; },
    disconnect: async () => { operations.push('disconnect'); connection = CONNECTION_STATES.DISCONNECTED; connectionListeners.forEach(listener => listener(connection)); return true; },
    getConnectionState: () => connection,
    getSessionIdentity: () => ({ authenticatedPlayerId: 'player-1', currentPartyId: currentScope.partyId }),
    getState: () => currentState,
    requestState: async () => {
      operations.push('requestState');
      if (!currentState) throw new Error('state unavailable');
      return currentState;
    },
    refreshParty: async () => { operations.push('refreshParty'); scopeListeners.forEach(listener => listener(currentScope)); return currentScope; },
    markPartyMembershipChanged: () => { membershipChanged = true; },
    submitCommand: async command => {
      commands.push(command);
      const result: AuthoritativeCommandResult = { commandId: command.commandId, accepted: true, resultingRevision: (currentState?.revision ?? 0) + 1, currentRevision: (currentState?.revision ?? 0) + 1, errorCode: null, serverTimestamp: 1001 };
      commandListeners.forEach(listener => listener(result));
      return result;
    },
    ping: async () => 1,
    subscribeToState: listener => { stateListeners.add(listener); return () => stateListeners.delete(listener); },
    subscribeToPartyScope: listener => { scopeListeners.add(listener); return () => scopeListeners.delete(listener); },
    subscribeToPresence: listener => { presenceListeners.add(listener); return () => presenceListeners.delete(listener); },
    subscribeToConnection: listener => { connectionListeners.add(listener); return () => connectionListeners.delete(listener); },
    subscribeToCommandResults: listener => { commandListeners.add(listener); return () => commandListeners.delete(listener); },
    subscribeToErrors: listener => { errorListeners.add(listener); return () => errorListeners.delete(listener); },
    destroy: async () => {}
  };
  return {
    transport,
    commands,
    operations,
    wasMembershipChanged: () => membershipChanged,
    emitScope: (value: AuthoritativePartyScope) => { currentScope = value; scopeListeners.forEach(listener => listener(value)); },
    emitState: (value: AuthoritativePartyState) => { currentState = value; stateListeners.forEach(listener => listener(value)); },
    setConnection: (value: ConnectionState) => { connection = value; connectionListeners.forEach(listener => listener(value)); },
    emitPresence: (value: { playerId: string; status: 'online' | 'offline'; connectedSessionCount: number; serverTimestamp: number }) => presenceListeners.forEach(listener => listener(value)),
    emitError: (value: AuthoritativeServerError) => errorListeners.forEach(listener => listener(value))
  };
}

describe('backend player/session identity', () => {
  it('creates and persists a development session, then reuses it after /v1/me validation', async () => {
    const storage = storageWith(null);
    const calls: string[] = [];
    const fetchImpl = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
      const path = String(input);
      calls.push(`${init?.method ?? 'GET'} ${path}`);
      if (path.endsWith('/v1/dev/players')) return response({ player: { id: 'player-1' }, token: 'dev_token_1', sessionId: 'session-1' }, 201);
      return response({ player: { id: 'player-1' } });
    };
    const client = createBackendIdentityClient({ baseUrl: 'http://backend.test', storage, fetchImpl });

    await expect(client.acquire()).resolves.toEqual({ playerId: 'player-1', token: 'dev_token_1', sessionId: 'session-1' });
    await expect(client.acquire()).resolves.toEqual({ playerId: 'player-1', token: 'dev_token_1', sessionId: 'session-1' });
    expect(calls).toEqual(['POST http://backend.test/v1/dev/players', 'GET http://backend.test/v1/me']);
    expect(storage.values[IDENTITY_STORAGE_KEY]).toContain('dev_token_1');
  });

  it('replaces an invalid stored session without exposing token details in the error path', async () => {
    const storage = storageWith(JSON.stringify({ playerId: 'old-player', token: 'old-token', sessionId: 'old-session' }));
    const calls: string[] = [];
    const fetchImpl = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
      calls.push(`${init?.method ?? 'GET'} ${String(input)}`);
      return String(input).endsWith('/v1/me')
        ? response({ error: 'unauthorized' }, 401)
        : response({ player: { id: 'new-player' }, token: 'new-token', sessionId: 'new-session' }, 201);
    };
    const client = createBackendIdentityClient({ storage, fetchImpl });

    await expect(client.acquire()).resolves.toEqual({ playerId: 'new-player', token: 'new-token', sessionId: 'new-session' });
    expect(calls).toEqual(['GET /v1/me', 'POST /v1/dev/players']);
  });
});

describe('party runtime mode boundary', () => {
  it('resolves explicit query/config modes while defaulting safely to local', () => {
    expect(resolvePartyRuntimeMode({ search: '?partyTransport=authoritative' }, 'local')).toBe(PARTY_RUNTIME_MODES.AUTHORITATIVE);
    expect(resolvePartyRuntimeMode({ search: '' }, 'authoritative')).toBe(PARTY_RUNTIME_MODES.AUTHORITATIVE);
    expect(resolvePartyRuntimeMode({ search: '' }, 'unknown')).toBe(PARTY_RUNTIME_MODES.LOCAL);
  });

  it('acquires identity, renders authoritative membership/state, preserves commands, and refreshes known membership changes', async () => {
    const fake = createFakeAuthoritativeTransport();
    const runtime = createPartyRuntime({
      mode: PARTY_RUNTIME_MODES.AUTHORITATIVE,
      fallbackToLocal: false,
      identityClient: { acquire: async () => ({ playerId: 'player-1', token: 'dev_token_1', sessionId: 'session-1' }) },
      authoritativeTransportFactory: () => fake.transport,
      partyApiFactory: () => ({
        createParty: async () => ({ id: 'party-1', leaderId: 'player-1', joinCode: 'ABCD2345EF', maxMembers: 4, createdAt: '2026-07-15T00:00:00.000Z', updatedAt: '2026-07-15T00:00:00.000Z', members: [{ playerId: 'player-1', joinedAt: '2026-07-15T00:00:00.000Z', isLeader: true }] }),
        getCurrentParty: async () => ({ id: 'party-1', leaderId: 'player-1', joinCode: 'ABCD2345EF', maxMembers: 4, createdAt: '2026-07-15T00:00:00.000Z', updatedAt: '2026-07-15T00:00:00.000Z', members: [{ playerId: 'player-1', joinedAt: '2026-07-15T00:00:00.000Z', isLeader: true }, { playerId: 'player-2', joinedAt: '2026-07-15T00:01:00.000Z', isLeader: false }] }),
        joinParty: async () => ({ id: 'party-1', leaderId: 'player-1', joinCode: 'ABCD2345EF', maxMembers: 4, createdAt: '2026-07-15T00:00:00.000Z', updatedAt: '2026-07-15T00:00:00.000Z', members: [{ playerId: 'player-1', joinedAt: '2026-07-15T00:00:00.000Z', isLeader: true }, { playerId: 'player-2', joinedAt: '2026-07-15T00:01:00.000Z', isLeader: false }] }),
        leaveParty: async () => undefined
      } satisfies BackendPartyApi)
    });

    await expect(runtime.initialize()).resolves.toBe(true);
    expect(runtime.getState()).toMatchObject({ mode: 'authoritative', identity: { authenticatedPlayerId: 'player-1', sessionId: 'session-1' } });
    await runtime.connect();
    expect(runtime.getConnectionState()).toBe(CONNECTION_STATES.CONNECTED);
    fake.emitScope(scope);
    fake.emitState(authoritativeState);
    fake.emitPresence({ playerId: 'player-2', status: 'online', connectedSessionCount: 1, serverTimestamp: 1001 });
    expect(runtime.getState()).toMatchObject({ mode: 'authoritative', authoritative: { scope, state: authoritativeState, presence: { 'player-2': { status: 'online' } } } });

    await expect(runtime.startExpedition()).resolves.toBe(true);
    expect(fake.commands[0]).toMatchObject({ expectedRevision: 0, command: { type: 'expedition.start', destination: 'forest' } });

    const newerState: AuthoritativePartyState = {
      ...authoritativeState,
      revision: 1,
      activity: { ...authoritativeState.activity, status: 'active', destination: 'forest', startedAt: '2026-07-15T00:00:01.000Z', completesAt: '2026-07-15T00:01:01.000Z' },
      contributions: { 'player-1': 2, 'player-2': 1 },
      serverTimestamp: 1001
    };
    fake.emitState(newerState);
    expect(runtime.getState()).toMatchObject({ authoritative: { state: { revision: 1, contributions: { 'player-1': 2 } } } });

    await expect(runtime.joinParty('ABCD2345EF')).resolves.toMatchObject({ joinCode: 'ABCD2345EF', members: [{ playerId: 'player-1' }, { playerId: 'player-2' }] });
    expect(runtime.getParty()).toMatchObject({ leaderId: 'player-1', members: [{ isLeader: true }, { playerId: 'player-2' }] });
    expect(fake.operations).toContain('refreshParty');
    expect(fake.operations).toContain('requestState');

    runtime.markPartyMembershipChanged();
    expect(fake.wasMembershipChanged()).toBe(true);
    await runtime.refreshParty();
    await expect(runtime.pauseExpedition()).resolves.toBe(false);
    await expect(runtime.disconnect()).resolves.toBe(true);
    expect(runtime.getConnectionState()).toBe(CONNECTION_STATES.DISCONNECTED);
    await expect(runtime.reconnect()).resolves.toBe(true);
    expect(runtime.getConnectionState()).toBe(CONNECTION_STATES.CONNECTED);
    await runtime.destroy();
  });

  it('falls back to the local client explicitly when authoritative identity is unavailable', async () => {
    const storage = storageWith(null);
    const runtime = createPartyRuntime({
      mode: PARTY_RUNTIME_MODES.AUTHORITATIVE,
      identityClient: { acquire: async () => { throw new Error('backend unavailable'); } },
      localTransportFactory: () => createLocalMomentumPartyTransport({ authenticatedPlayerId: 'local-player', connectDelay: 0, commandDelay: 0, storage })
    });

    await expect(runtime.initialize()).resolves.toBe(true);
    expect(runtime.getState()).toMatchObject({ mode: 'local', requestedMode: 'authoritative', fallbackReason: 'backend unavailable' });
    await runtime.destroy();
  });
});
