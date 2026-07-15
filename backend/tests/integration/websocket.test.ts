import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { Pool } from 'pg';
import WebSocket from 'ws';
import { buildApp } from '../../src/app.js';
import { loadConfig } from '../../src/config/environment.js';
import { createMigrationRunner } from '../../src/infrastructure/migrations/migration-runner.js';

const databaseUrl = process.env.DATABASE_URL;
const config = loadConfig({
  NODE_ENV: 'test',
  HOST: '127.0.0.1',
  PORT: '3000',
  LOG_LEVEL: 'silent',
  DATABASE_URL: databaseUrl ?? 'postgresql://localhost:5432/momentum_test',
  DATABASE_POOL_MAX: '12',
  WEBSOCKET_MAX_MESSAGE_BYTES: '512',
  WEBSOCKET_MAX_MESSAGES: '4',
  WEBSOCKET_RATE_WINDOW_MS: '1000',
  WEBSOCKET_AUTH_TIMEOUT_MS: '100',
  WEBSOCKET_IDLE_TIMEOUT_MS: '5000',
  WEBSOCKET_MAX_CONNECTIONS_PER_PLAYER: '4'
});

type Player = { id: string; token: string; sessionId: string };
type Message = { protocolVersion: number; type: string; requestId: string | null; payload: Record<string, unknown> };

class SocketHarness {
  readonly socket: WebSocket;
  private readonly messages: Message[] = [];
  private readonly waiters: Array<{
    predicate: (message: Message) => boolean;
    resolve: (message: Message) => void;
    reject: (error: Error) => void;
    timer: NodeJS.Timeout;
  }> = [];

  constructor(socket: WebSocket) {
    this.socket = socket;
    socket.on('message', raw => {
      let message: Message;
      try {
        message = JSON.parse(raw.toString()) as Message;
      } catch {
        return;
      }
      const waiterIndex = this.waiters.findIndex(waiter => waiter.predicate(message));
      if (waiterIndex === -1) {
        this.messages.push(message);
        return;
      }
      const waiter = this.waiters.splice(waiterIndex, 1)[0];
      clearTimeout(waiter.timer);
      waiter.resolve(message);
    });
  }

  next(predicate: (message: Message) => boolean = () => true, timeoutMs = 1_000): Promise<Message> {
    const queuedIndex = this.messages.findIndex(predicate);
    if (queuedIndex !== -1) return Promise.resolve(this.messages.splice(queuedIndex, 1)[0]);

    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        const index = this.waiters.findIndex(waiter => waiter.timer === timer);
        if (index !== -1) this.waiters.splice(index, 1);
        reject(new Error('Timed out waiting for WebSocket message.'));
      }, timeoutMs);
      this.waiters.push({ predicate, resolve, reject, timer });
    });
  }

  drain(): Message[] {
    return this.messages.splice(0);
  }
}

describe.skipIf(!databaseUrl)('authenticated party WebSockets (PostgreSQL)', () => {
  let app: Awaited<ReturnType<typeof buildApp>>;
  let pool: Pool;
  let websocketUrl: string;
  const openSockets = new Set<WebSocket>();
  let requestCounter = 0;

  beforeAll(async () => {
    pool = new Pool({ connectionString: databaseUrl, max: 12, connectionTimeoutMillis: 2_000 });
    await createMigrationRunner(pool).runFromDirectory(new URL('../../migrations', import.meta.url).pathname);
    app = await buildApp(config, { database: pool });
    await app.listen({ host: config.host, port: 0 });
    const address = app.server.address();
    if (address === null || typeof address === 'string') throw new Error('WebSocket test server did not expose a TCP address.');
    websocketUrl = `ws://${config.host}:${address.port}/v1/ws`;
  });

  afterEach(async () => {
    const sockets = [...openSockets];
    openSockets.clear();
    await Promise.all(sockets.map(socket => closeSocket(socket)));
  });

  afterAll(async () => {
    await app?.close();
    await pool?.end();
  });

  async function createPlayer(): Promise<Player> {
    const response = await app.inject({ method: 'POST', url: '/v1/dev/players' });
    expect(response.statusCode).toBe(201);
    const body = response.json();
    return { id: body.player.id, token: body.token, sessionId: body.sessionId };
  }

  function authHeaders(token: string) {
    return { Authorization: `Bearer ${token}` };
  }

  function envelope(type: string, payload: Record<string, unknown> = {}) {
    requestCounter += 1;
    return JSON.stringify({ protocolVersion: 1, type, requestId: `request-${requestCounter}`, payload });
  }

  function track(socket: WebSocket): SocketHarness {
    openSockets.add(socket);
    return new SocketHarness(socket);
  }

  function waitForOpen(socket: WebSocket): Promise<void> {
    if (socket.readyState === WebSocket.OPEN) return Promise.resolve();
    return new Promise((resolve, reject) => {
      const onOpen = () => {
        socket.off('error', onError);
        resolve();
      };
      const onError = (error: Error) => {
        socket.off('open', onOpen);
        reject(error);
      };
      socket.once('open', onOpen);
      socket.once('error', onError);
    });
  }

  function waitForClose(socket: WebSocket, timeoutMs = 1_000): Promise<{ code: number; reason: string }> {
    if (socket.readyState === WebSocket.CLOSED) return Promise.resolve({ code: 1000, reason: '' });
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        socket.off('close', onClose);
        reject(new Error('Timed out waiting for WebSocket close.'));
      }, timeoutMs);
      const onClose = (code: number, reason: Buffer) => {
        clearTimeout(timer);
        resolve({ code, reason: reason.toString() });
      };
      socket.once('close', onClose);
    });
  }

  async function closeSocket(socket: WebSocket): Promise<void> {
    if (socket.readyState === WebSocket.CLOSED) return;
    const closed = waitForClose(socket, 1_000).catch(() => undefined);
    if (socket.readyState === WebSocket.CONNECTING) socket.terminate();
    else socket.close();
    await closed;
  }

  async function openHeaderConnection(player: Player): Promise<{ socket: WebSocket; harness: SocketHarness; ready: Message }> {
    const socket = new WebSocket(websocketUrl, { headers: authHeaders(player.token) });
    const harness = track(socket);
    await waitForOpen(socket);
    const ready = await harness.next(message => message.type === 'connection.ready');
    return { socket, harness, ready };
  }

  async function openFirstMessageConnection(player: Player): Promise<{ socket: WebSocket; harness: SocketHarness; ready: Message }> {
    const socket = new WebSocket(websocketUrl);
    const harness = track(socket);
    await waitForOpen(socket);
    socket.send(envelope('auth', { token: player.token }));
    const ready = await harness.next(message => message.type === 'connection.ready');
    return { socket, harness, ready };
  }

  async function expectHeaderRejection(token: string): Promise<number> {
    return expectAuthorizationHeaderRejection(`Bearer ${token}`);
  }

  async function expectAuthorizationHeaderRejection(authorization: string): Promise<number> {
    const socket = new WebSocket(websocketUrl, { headers: { Authorization: authorization } });
    return new Promise((resolve, reject) => {
      socket.once('unexpected-response', (_request, response) => {
        response.resume();
        resolve(response.statusCode ?? 0);
      });
      socket.once('open', () => reject(new Error('Expected WebSocket upgrade rejection.')));
      socket.once('error', () => undefined);
    });
  }

  async function createParty(player: Player): Promise<{ id: string; joinCode: string; memberIds: string[] }> {
    const response = await app.inject({ method: 'POST', url: '/v1/parties', headers: authHeaders(player.token) });
    expect(response.statusCode).toBe(201);
    const party = response.json().party;
    return { id: party.id, joinCode: party.joinCode, memberIds: party.members.map((member: { playerId: string }) => member.playerId) };
  }

  async function joinParty(player: Player, joinCode: string): Promise<void> {
    const response = await app.inject({
      method: 'POST',
      url: '/v1/parties/join',
      headers: authHeaders(player.token),
      payload: { joinCode }
    });
    expect(response.statusCode).toBe(200);
  }

  it('authenticates with a bearer header and sends the real player and party scope', async () => {
    const player = await createPlayer();
    const party = await createParty(player);
    const connection = await openHeaderConnection(player);

    expect(connection.ready.protocolVersion).toBe(1);
    expect(connection.ready.payload).toEqual(expect.objectContaining({
      connectionId: expect.any(String),
      playerId: player.id,
      partyId: party.id,
      partyMemberIds: [player.id],
      protocolVersion: 1
    }));
    expect(JSON.stringify(connection.ready)).not.toContain(player.token);
  });

  it('supports browser-compatible first-message auth and rejects missing, invalid, and revoked credentials', async () => {
    const player = await createPlayer();
    const firstMessage = await openFirstMessageConnection(player);
    expect(firstMessage.ready.payload.playerId).toBe(player.id);

    const missingSocket = new WebSocket(websocketUrl);
    track(missingSocket);
    await waitForOpen(missingSocket);
    const missingClose = await waitForClose(missingSocket);
    expect(missingClose).toEqual({ code: 4001, reason: 'auth.timeout' });

    const invalidSocket = new WebSocket(websocketUrl);
    track(invalidSocket);
    await waitForOpen(invalidSocket);
    const invalidClosePromise = waitForClose(invalidSocket);
    invalidSocket.send(envelope('auth', { token: 'dev_invalid-token' }));
    expect(await invalidClosePromise).toEqual({ code: 4003, reason: 'auth.invalid' });

    const revoke = await app.inject({ method: 'POST', url: '/v1/sessions/current/revoke', headers: authHeaders(player.token) });
    expect(revoke.statusCode).toBe(204);
    expect(await expectHeaderRejection(player.token)).toBe(401);
    expect(await expectAuthorizationHeaderRejection('Basic not-a-bearer-token')).toBe(401);

    const expired = await createPlayer();
    await pool.query('UPDATE sessions SET expires_at = NOW() - INTERVAL \'1 minute\' WHERE id = $1', [expired.sessionId]);
    expect(await expectHeaderRejection(expired.token)).toBe(401);
  });

  it('allows a player without a party to connect with a null party scope', async () => {
    const player = await createPlayer();
    const connection = await openHeaderConnection(player);
    expect(connection.ready.payload).toEqual(expect.objectContaining({ playerId: player.id, partyId: null, partyMemberIds: [] }));
  });

  it('responds to ping with the matching request ID', async () => {
    const player = await createPlayer();
    const connection = await openHeaderConnection(player);
    connection.harness.drain();
    const request = envelope('ping');
    const requestId = JSON.parse(request).requestId as string;
    connection.socket.send(request);
    const pong = await connection.harness.next(message => message.type === 'pong');
    expect(pong.requestId).toBe(requestId);
    expect(pong.payload.serverTimestamp).toEqual(expect.any(Number));
  });

  it('rejects protocol violations and oversized messages without crashing the server', async () => {
    const cases = [
      { raw: '{', code: 1003, reason: 'protocol.invalid_json' },
      { raw: JSON.stringify({ protocolVersion: 2, type: 'ping', requestId: 'v2', payload: {} }), code: 1002, reason: 'protocol.unsupported_version' },
      { raw: envelope('unknown'), code: 1003, reason: 'protocol.unknown_message_type' },
      { raw: 'x'.repeat(600), code: 1009, reason: 'protocol.message_too_large' }
    ];

    for (const testCase of cases) {
      const player = await createPlayer();
      const connection = await openHeaderConnection(player);
      const closePromise = waitForClose(connection.socket);
      connection.socket.send(testCase.raw);
      expect(await closePromise).toEqual({ code: testCase.code, reason: testCase.reason });
    }
  });

  it('rejects party ID spoofing and rate-limit abuse', async () => {
    const player = await createPlayer();
    const connection = await openHeaderConnection(player);
    const closePromise = waitForClose(connection.socket);
    connection.socket.send(envelope('party.refresh', { partyId: 'spoofed-party' }));
    expect(await closePromise).toEqual({ code: 1003, reason: 'protocol.invalid_message' });

    const rateLimitedPlayer = await createPlayer();
    const rateLimited = await openHeaderConnection(rateLimitedPlayer);
    const rateClosePromise = waitForClose(rateLimited.socket);
    for (let index = 0; index < 5; index += 1) rateLimited.socket.send(envelope('ping'));
    expect(await rateClosePromise).toEqual({ code: 1008, reason: 'rate.limit_exceeded' });
  });

  it('enforces the configured per-player connection limit', async () => {
    const player = await createPlayer();
    const connections = await Promise.all([
      openHeaderConnection(player),
      openHeaderConnection(player),
      openHeaderConnection(player),
      openHeaderConnection(player)
    ]);
    expect(connections).toHaveLength(4);

    const rejected = new WebSocket(websocketUrl, { headers: authHeaders(player.token) });
    track(rejected);
    await waitForOpen(rejected);
    expect(await waitForClose(rejected)).toEqual({ code: 4008, reason: 'connection.max_per_player' });
  });

  it('broadcasts presence only inside the matching party', async () => {
    const partyALeader = await createPlayer();
    const partyAMember = await createPlayer();
    const partyBLeader = await createPlayer();
    const partyA = await createParty(partyALeader);
    await joinParty(partyAMember, partyA.joinCode);
    await createParty(partyBLeader);

    const partyAObserver = await openHeaderConnection(partyALeader);
    const partyBObserver = await openHeaderConnection(partyBLeader);
    partyAObserver.harness.drain();
    partyBObserver.harness.drain();

    const memberConnection = await openHeaderConnection(partyAMember);
    const online = await partyAObserver.harness.next(message => message.type === 'party.presence');
    expect(online.payload).toEqual(expect.objectContaining({ playerId: partyAMember.id, status: 'online', connectedSessionCount: 1 }));
    expect(memberConnection.ready.payload.partyId).toBe(partyA.id);
    await expect(partyBObserver.harness.next(() => true, 150)).rejects.toThrow('Timed out');
  });

  it('keeps a multi-socket player online until the final socket disconnects', async () => {
    const observer = await createPlayer();
    const subject = await createPlayer();
    const party = await createParty(observer);
    await joinParty(subject, party.joinCode);
    const observerConnection = await openHeaderConnection(observer);
    observerConnection.harness.drain();

    const first = await openHeaderConnection(subject);
    await observerConnection.harness.next(message => message.type === 'party.presence');
    const second = await openHeaderConnection(subject);
    const online = await observerConnection.harness.next(message => message.type === 'party.presence');
    expect(online.payload.connectedSessionCount).toBe(2);

    await closeSocket(first.socket);
    await expect(observerConnection.harness.next(() => true, 150)).rejects.toThrow('Timed out');
    await closeSocket(second.socket);
    const offline = await observerConnection.harness.next(message => message.type === 'party.presence');
    expect(offline.payload).toEqual(expect.objectContaining({ playerId: subject.id, status: 'offline', connectedSessionCount: 0 }));
  });

  it('refreshes all sockets for a player after HTTP membership changes', async () => {
    const leader = await createPlayer();
    const subject = await createPlayer();
    const party = await createParty(leader);
    const leaderConnection = await openHeaderConnection(leader);
    leaderConnection.harness.drain();
    const subjectConnection = await openHeaderConnection(subject);

    await joinParty(subject, party.joinCode);
    subjectConnection.socket.send(envelope('party.refresh'));
    const joinedSnapshot = await subjectConnection.harness.next(message => message.type === 'party.snapshot');
    expect(joinedSnapshot.payload).toEqual(expect.objectContaining({ partyId: party.id, leaderPlayerId: leader.id, joinCode: party.joinCode }));
    const joinedPresence = await leaderConnection.harness.next(message => message.type === 'party.presence');
    expect(joinedPresence.payload).toEqual(expect.objectContaining({ playerId: subject.id, status: 'online' }));

    const leave = await app.inject({ method: 'DELETE', url: '/v1/parties/current', headers: authHeaders(subject.token) });
    expect(leave.statusCode).toBe(204);
    subjectConnection.socket.send(envelope('party.refresh'));
    const leftSnapshot = await subjectConnection.harness.next(message => message.type === 'party.snapshot');
    expect(leftSnapshot.payload).toEqual(expect.objectContaining({ partyId: null, leaderPlayerId: null, memberPlayerIds: [], joinCode: null }));
    const leftPresence = await leaderConnection.harness.next(message => message.type === 'party.presence');
    expect(leftPresence.payload).toEqual(expect.objectContaining({ playerId: subject.id, status: 'offline', connectedSessionCount: 0 }));
  });

  it('cleans the registry when connections close and leaves HTTP health available', async () => {
    const player = await createPlayer();
    const connection = await openHeaderConnection(player);
    await closeSocket(connection.socket);
    const health = await app.inject({ method: 'GET', url: '/healthz' });
    expect(health.statusCode).toBe(200);
  });
});
