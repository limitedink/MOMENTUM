import { afterEach, describe, expect, it, vi } from 'vitest';
import { CONNECTION_STATES } from '../src/party/party-types';
import { createAuthoritativePartyTransport } from '../src/party/authoritative-party-transport';
import {
  createAuthoritativeCommand,
  type AuthoritativeWebSocketLike
} from '../src/party/authoritative-party-types';

type SentMessage = {
  protocolVersion: number;
  type: string;
  requestId: string | null;
  payload: Record<string, unknown>;
};

const PARTY_ID = 'party-1';
const PLAYER_ID = 'player-1';

function readyPayload(partyId: string | null = PARTY_ID) {
  return {
    connectionId: 'connection-1',
    playerId: PLAYER_ID,
    partyId,
    partyMemberIds: partyId ? [PLAYER_ID, 'player-2'] : [],
    serverTimestamp: 1000,
    protocolVersion: 1
  };
}

function statePayload(revision: number, partyId = PARTY_ID) {
  return {
    partyId,
    revision,
    activity: {
      kind: 'expedition',
      status: revision > 0 ? 'active' : 'idle',
      destination: revision > 0 ? 'forest' : null,
      startedAt: revision > 0 ? '2026-07-15T00:00:00.000Z' : null,
      completesAt: revision > 0 ? '2026-07-15T00:01:00.000Z' : null
    },
    contributions: { [PLAYER_ID]: revision > 1 ? 2 : 0 },
    updatedAt: '2026-07-15T00:00:00.000Z',
    serverTimestamp: 1000 + revision
  };
}

class FakeWebSocket implements AuthoritativeWebSocketLike {
  static readonly CONNECTING = 0;
  static readonly OPEN = 1;
  static readonly CLOSED = 3;
  readyState = FakeWebSocket.CONNECTING;
  readonly sent: SentMessage[] = [];
  onopen: (() => void) | null = null;
  onmessage: ((event: { data: unknown }) => void) | null = null;
  onerror: ((event: unknown) => void) | null = null;
  onclose: ((event: { code: number; reason: string }) => void) | null = null;

  open(): void {
    this.readyState = FakeWebSocket.OPEN;
    this.onopen?.();
  }

  receive(type: string, payload: unknown, requestId: string | null = null): void {
    this.onmessage?.({ data: JSON.stringify({ protocolVersion: 1, type, requestId, payload }) });
  }

  send(data: string): void {
    this.sent.push(JSON.parse(data) as SentMessage);
  }

  close(code = 1000, reason = ''): void {
    if (this.readyState === FakeWebSocket.CLOSED) return;
    this.readyState = FakeWebSocket.CLOSED;
    this.onclose?.({ code, reason });
  }

  last(type: string): SentMessage {
    const message = [...this.sent].reverse().find(item => item.type === type);
    if (!message) throw new Error(`No ${type} message was sent.`);
    return message;
  }
}

async function flush(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}

describe('authoritative party WebSocket transport', () => {
  const sockets: FakeWebSocket[] = [];

  afterEach(async () => {
    for (const socket of sockets) socket.close();
    sockets.splice(0);
    vi.useRealTimers();
  });

  function createTransport(overrides: Partial<Parameters<typeof createAuthoritativePartyTransport>[0]> = {}) {
    const transport = createAuthoritativePartyTransport({
      token: 'dev_test-token',
      autoReconnect: false,
      pingIntervalMs: 0,
      requestTimeoutMs: 1_000,
      websocketFactory: () => {
        const socket = new FakeWebSocket();
        sockets.push(socket);
        return socket;
      },
      ...overrides
    });
    return transport;
  }

  async function connectWithParty(transport: ReturnType<typeof createTransport>, revision = 0): Promise<FakeWebSocket> {
    const connection = transport.connect();
    const socket = sockets.at(-1)!;
    socket.open();
    expect(socket.sent[0]).toEqual(expect.objectContaining({ type: 'auth', payload: { token: 'dev_test-token' } }));
    socket.receive('connection.ready', readyPayload());
    await expect(connection).resolves.toBe(true);
    await flush();
    const refresh = socket.last('party.refresh');
    socket.receive('party.snapshot', {
      partyId: PARTY_ID,
      leaderPlayerId: PLAYER_ID,
      memberPlayerIds: [PLAYER_ID, 'player-2'],
      joinCode: 'ABCD2345EF',
      serverTimestamp: 1001
    }, refresh.requestId);
    await flush();
    const stateRequest = socket.last('party.state.get');
    socket.receive('party.state.snapshot', statePayload(revision), stateRequest.requestId);
    await flush();
    return socket;
  }

  it('uses first-message authentication and tracks connection, party scope, and initial state', async () => {
    const transport = createTransport();
    const connections: string[] = [];
    const scopes: string[] = [];
    const presence: string[] = [];
    transport.subscribeToConnection(status => connections.push(status));
    transport.subscribeToPartyScope(scope => scopes.push(scope.partyId ?? 'none'));
    transport.subscribeToPresence(member => presence.push(`${member.playerId}:${member.status}`));

    const socket = await connectWithParty(transport);
    socket.receive('party.presence', {
      playerId: 'player-2',
      status: 'online',
      connectedSessionCount: 1,
      serverTimestamp: 1002
    });

    expect(socket.sent[0].type).toBe('auth');
    expect(connections).toEqual([CONNECTION_STATES.CONNECTING, CONNECTION_STATES.CONNECTED]);
    expect(scopes).toContain(PARTY_ID);
    expect(presence).toEqual(['player-2:online']);
    expect(transport.getSessionIdentity()).toEqual({ authenticatedPlayerId: PLAYER_ID, currentPartyId: PARTY_ID });
    expect(transport.getState()?.revision).toBe(0);
    await transport.destroy();
  });

  it('correlates refresh, state, and ping requests by requestId', async () => {
    let clock = 1000;
    const transport = createTransport({ now: () => clock });
    const socket = await connectWithParty(transport);

    const refreshPromise = transport.refreshParty();
    const refresh = socket.last('party.refresh');
    socket.receive('party.snapshot', {
      partyId: PARTY_ID,
      leaderPlayerId: PLAYER_ID,
      memberPlayerIds: [PLAYER_ID],
      joinCode: 'ABCD2345EF',
      serverTimestamp: 1002
    }, refresh.requestId);
    await expect(refreshPromise).resolves.toEqual(expect.objectContaining({ partyId: PARTY_ID }));

    const statePromise = transport.requestState();
    const stateRequest = socket.last('party.state.get');
    socket.receive('party.state.snapshot', statePayload(1), stateRequest.requestId);
    await expect(statePromise).resolves.toEqual(expect.objectContaining({ revision: 1 }));

    const pingPromise = transport.ping();
    const ping = socket.last('ping');
    clock = 1250;
    socket.receive('pong', { serverTimestamp: 1250 }, ping.requestId);
    await expect(pingPromise).resolves.toBe(250);
    expect(ping.requestId).toBeTruthy();
    await transport.destroy();
  });

  it('accepts newer snapshots, safely ignores equal duplicates, and ignores stale revisions', async () => {
    const transport = createTransport();
    const socket = await connectWithParty(transport, 2);
    const revisions: number[] = [];
    transport.subscribeToState(state => revisions.push(state.revision));

    const current = transport.requestState();
    const request = socket.last('party.state.get');
    socket.receive('party.state.snapshot', statePayload(2), request.requestId);
    await current;
    socket.receive('party.state.snapshot', statePayload(1));
    socket.receive('party.state.snapshot', statePayload(3));

    expect(transport.getState()?.revision).toBe(3);
    expect(revisions).toEqual([3]);
    await transport.destroy();
  });

  it('rejects snapshots outside the current party scope', async () => {
    const transport = createTransport();
    const socket = await connectWithParty(transport);
    const statePromise = transport.requestState();
    const request = socket.last('party.state.get');
    socket.receive('party.state.snapshot', statePayload(1, 'party-2'), request.requestId);

    await expect(statePromise).rejects.toMatchObject({ code: 'party_scope_mismatch', requestId: request.requestId });
    expect(transport.getState()?.revision).toBe(0);
    await transport.destroy();
  });

  it('preserves command IDs through reconnect retries and ignores duplicate results', async () => {
    vi.useFakeTimers();
    const transport = createTransport({
      autoReconnect: true,
      maxReconnectAttempts: 2,
      reconnectBaseDelayMs: 10,
      reconnectMaxDelayMs: 10
    });
    const firstSocket = await connectWithParty(transport);
    const command = createAuthoritativeCommand({ type: 'expedition.start', destination: 'forest' }, 0, 'persistent-command-1');
    const resultPromise = transport.submitCommand(command);
    const firstCommand = firstSocket.last('party.command');
    expect(firstCommand.payload.commandId).toBe('persistent-command-1');
    firstSocket.close(1006, 'network.lost');
    expect(transport.getConnectionState()).toBe(CONNECTION_STATES.RECONNECTING);

    await vi.advanceTimersByTimeAsync(10);
    const secondSocket = sockets.at(-1)!;
    secondSocket.open();
    secondSocket.receive('connection.ready', readyPayload());
    await flush();
    const refresh = secondSocket.last('party.refresh');
    secondSocket.receive('party.snapshot', {
      partyId: PARTY_ID,
      leaderPlayerId: PLAYER_ID,
      memberPlayerIds: [PLAYER_ID],
      joinCode: 'ABCD2345EF',
      serverTimestamp: 1003
    }, refresh.requestId);
    await flush();
    const stateRequest = secondSocket.last('party.state.get');
    secondSocket.receive('party.state.snapshot', statePayload(0), stateRequest.requestId);
    await flush();
    const retry = secondSocket.last('party.command');
    expect(retry.payload.commandId).toBe('persistent-command-1');
    secondSocket.receive('party.command.result', {
      commandId: 'persistent-command-1',
      accepted: true,
      resultingRevision: 1,
      currentRevision: 1,
      errorCode: null,
      serverTimestamp: 1004
    }, retry.requestId);
    await expect(resultPromise).resolves.toEqual(expect.objectContaining({ accepted: true, resultingRevision: 1 }));
    secondSocket.receive('party.command.result', {
      commandId: 'persistent-command-1',
      accepted: true,
      resultingRevision: 1,
      currentRevision: 1,
      errorCode: null,
      serverTimestamp: 1005
    }, retry.requestId);
    expect(transport.getState()?.revision).toBe(0);
    await transport.destroy();
  });

  it('surfaces stable state and command errors without exposing server internals', async () => {
    const transport = createTransport();
    const socket = await connectWithParty(transport);
    const errors: Array<{ code: string; message: string; requestId?: string | null }> = [];
    transport.subscribeToErrors(error => errors.push(error));

    const statePromise = transport.requestState();
    const stateRequest = socket.last('party.state.get');
    socket.receive('party.state.error', { errorCode: 'revision_conflict', serverTimestamp: 2000 }, stateRequest.requestId);
    await expect(statePromise).rejects.toMatchObject({ code: 'revision_conflict' });

    const commandPromise = transport.submitCommand(createAuthoritativeCommand({ type: 'expedition.reset' }, 0, 'rejected-command'));
    const command = socket.last('party.command');
    socket.receive('party.command.result', {
      commandId: 'rejected-command',
      accepted: false,
      resultingRevision: null,
      currentRevision: 0,
      errorCode: 'not_party_leader',
      serverTimestamp: 2001
    }, command.requestId);
    await expect(commandPromise).resolves.toEqual(expect.objectContaining({ accepted: false, errorCode: 'not_party_leader' }));
    expect(errors.some(error => error.code === 'revision_conflict')).toBe(true);
    expect(errors.some(error => error.code === 'not_party_leader' && error.requestId === command.requestId)).toBe(true);
    expect(errors.map(error => error.message).join(' ')).not.toContain('SELECT');
    await transport.destroy();
  });

  it('requires party refresh after known membership changes and never sends local-only commands', async () => {
    const transport = createTransport();
    const socket = await connectWithParty(transport);
    transport.markPartyMembershipChanged();
    await expect(transport.requestState()).rejects.toMatchObject({ code: 'party_refresh_required' });

    const sentBeforeUnsupported = socket.sent.length;
    const unsupported = await transport.submitCommand({
      commandId: 'local-pause',
      expectedRevision: 0,
      command: { type: 'expedition.pause' }
    } as never);
    expect(unsupported).toEqual(expect.objectContaining({ accepted: false, errorCode: 'unsupported_command' }));
    expect(socket.sent).toHaveLength(sentBeforeUnsupported);
    await transport.destroy();
  });

  it('does not reconnect after authentication or permanent protocol failure', async () => {
    vi.useFakeTimers();
    const transport = createTransport({ autoReconnect: true, maxReconnectAttempts: 5, reconnectBaseDelayMs: 10 });
    const connection = transport.connect();
    const socket = sockets[0];
    socket.open();
    socket.close(4003, 'auth.invalid');
    await expect(connection).resolves.toBe(false);
    await vi.advanceTimersByTimeAsync(100);
    expect(sockets).toHaveLength(1);
    expect(transport.getConnectionState()).toBe(CONNECTION_STATES.ERROR);
    await transport.destroy();
  });
});
