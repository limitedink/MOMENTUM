import { describe, expect, it, beforeAll, afterAll, afterEach } from 'vitest';
import WebSocket from 'ws';
import { Pool } from 'pg';
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
  WEBSOCKET_MAX_MESSAGES: '100',
  PARTY_STATE_EXPEDITION_DURATION_MS: '60000'
});

interface Player {
  id: string;
  token: string;
}

interface Message {
  type: string;
  requestId: string | null;
  payload: Record<string, unknown>;
}

class SocketHarness {
  private readonly messages: Message[] = [];
  private readonly waiters: Array<{
    predicate: (message: Message) => boolean;
    resolve: (message: Message) => void;
    reject: (error: Error) => void;
    timer: ReturnType<typeof setTimeout>;
  }> = [];

  constructor(private readonly socket: WebSocket) {
    socket.on('message', raw => {
      const message = JSON.parse(raw.toString()) as Message;
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

  get socketValue(): WebSocket {
    return this.socket;
  }
}

describe.skipIf(!databaseUrl)('authoritative party state (PostgreSQL)', () => {
  let app: Awaited<ReturnType<typeof buildApp>>;
  let pool: Pool;
  let websocketUrl: string;
  let requestCounter = 0;
  const openSockets = new Set<WebSocket>();

  async function startApp(): Promise<void> {
    app = await buildApp(config, { database: pool });
    await app.listen({ host: config.host, port: 0 });
    const address = app.server.address();
    if (address === null || typeof address === 'string') throw new Error('Test server did not expose a TCP address.');
    websocketUrl = `ws://${config.host}:${address.port}/v1/ws`;
  }

  beforeAll(async () => {
    pool = new Pool({ connectionString: databaseUrl, max: 12, connectionTimeoutMillis: 2_000 });
    await createMigrationRunner(pool).runFromDirectory(new URL('../../migrations', import.meta.url).pathname);
    await startApp();
  });

  afterEach(async () => {
    const sockets = [...openSockets];
    openSockets.clear();
    await Promise.all(sockets.map(closeSocket));
  });

  afterAll(async () => {
    await app?.close();
    await pool?.end();
  });

  async function createPlayer(): Promise<Player> {
    const response = await app.inject({ method: 'POST', url: '/v1/dev/players', payload: { displayName: `Player ${Date.now()}-${Math.random().toString(36).slice(2, 6)}`.slice(0, 24) } });
    expect(response.statusCode).toBe(201);
    const body = response.json();
    return { id: body.player.id, token: body.token };
  }

  async function createParty(player: Player): Promise<{ id: string; joinCode: string }> {
    const response = await app.inject({
      method: 'POST',
      url: '/v1/parties',
      headers: { Authorization: `Bearer ${player.token}` }
    });
    expect(response.statusCode).toBe(201);
    const party = response.json().party;
    return { id: party.id, joinCode: party.joinCode };
  }

  async function joinParty(player: Player, joinCode: string): Promise<void> {
    const response = await app.inject({
      method: 'POST',
      url: '/v1/parties/join',
      headers: { Authorization: `Bearer ${player.token}` },
      payload: { joinCode }
    });
    expect(response.statusCode).toBe(200);
  }

  function envelope(type: string, payload: Record<string, unknown> = {}): string {
    requestCounter += 1;
    return JSON.stringify({ protocolVersion: 1, type, requestId: `state-request-${requestCounter}`, payload });
  }

  async function waitForOpen(socket: WebSocket): Promise<void> {
    if (socket.readyState === WebSocket.OPEN) return;
    await new Promise<void>((resolve, reject) => {
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

  async function closeSocket(socket: WebSocket): Promise<void> {
    if (socket.readyState === WebSocket.CLOSED) return;
    await new Promise<void>(resolve => {
      const timer = setTimeout(resolve, 1_000);
      socket.once('close', () => {
        clearTimeout(timer);
        resolve();
      });
      if (socket.readyState === WebSocket.CONNECTING) socket.terminate();
      else socket.close();
    });
  }

  async function openConnection(player: Player): Promise<{ socket: WebSocket; harness: SocketHarness }> {
    const socket = new WebSocket(websocketUrl, { headers: { Authorization: `Bearer ${player.token}` } });
    openSockets.add(socket);
    const harness = new SocketHarness(socket);
    await waitForOpen(socket);
    await harness.next(message => message.type === 'connection.ready');
    return { socket, harness };
  }

  function sendStateGet(connection: { socket: WebSocket; harness: SocketHarness }): void {
    connection.socket.send(envelope('party.state.get'));
  }

  async function sendCommand(
    connection: { socket: WebSocket; harness: SocketHarness },
    commandId: string,
    expectedRevision: number,
    command: Record<string, unknown>
  ): Promise<Message> {
    connection.socket.send(envelope('party.command', { commandId, expectedRevision, command }));
    return connection.harness.next(message => message.type === 'party.command.result' && message.payload.commandId === commandId);
  }

  async function expectStateSnapshot(
    connection: { socket: WebSocket; harness: SocketHarness },
    revision: number,
    requestId?: string | null
  ): Promise<Message> {
    return connection.harness.next(message =>
      message.type === 'party.state.snapshot' &&
      message.payload.revision === revision &&
      (requestId === undefined || message.requestId === requestId)
    );
  }

  it('creates one idle state under concurrent first reads and rejects players without a party', async () => {
    const leader = await createPlayer();
    const member = await createPlayer();
    const party = await createParty(leader);
    await joinParty(member, party.joinCode);
    const leaderConnection = await openConnection(leader);
    const memberConnection = await openConnection(member);
    leaderConnection.harness.drain();
    memberConnection.harness.drain();

    sendStateGet(leaderConnection);
    sendStateGet(memberConnection);
    const [leaderSnapshot, memberSnapshot] = await Promise.all([
      expectStateSnapshot(leaderConnection, 0),
      expectStateSnapshot(memberConnection, 0)
    ]);
    expect(leaderSnapshot.payload).toEqual(expect.objectContaining({ partyId: party.id, revision: 0 }));
    expect(memberSnapshot.payload.activity).toEqual(expect.objectContaining({ kind: 'expedition', status: 'idle' }));
    expect(await pool.query('SELECT COUNT(*)::int AS count FROM party_states WHERE party_id = $1', [party.id])).toMatchObject({ rows: [{ count: 1 }] });

    const ungrouped = await createPlayer();
    const ungroupedConnection = await openConnection(ungrouped);
    ungroupedConnection.socket.send(envelope('party.state.get'));
    const error = await ungroupedConnection.harness.next(message => message.type === 'party.state.error');
    expect(error.payload).toEqual(expect.objectContaining({ errorCode: 'not_in_party' }));
  });

  it('starts, contributes, reconciles completion, and permits only the leader to reset', async () => {
    const leader = await createPlayer();
    const member = await createPlayer();
    const party = await createParty(leader);
    await joinParty(member, party.joinCode);
    const leaderConnection = await openConnection(leader);
    const memberConnection = await openConnection(member);
    leaderConnection.harness.drain();
    memberConnection.harness.drain();

    const started = await sendCommand(leaderConnection, 'start-1', 0, { type: 'expedition.start', destination: 'forest' });
    const [leaderStarted, memberStarted] = await Promise.all([
      expectStateSnapshot(leaderConnection, 1),
      expectStateSnapshot(memberConnection, 1)
    ]);
    expect(started.payload).toEqual(expect.objectContaining({ commandId: 'start-1', accepted: true, resultingRevision: 1 }));
    const startedActivity = leaderStarted.payload.activity as Record<string, unknown>;
    expect(startedActivity).toEqual(expect.objectContaining({ status: 'active', destination: 'forest' }));
    expect(new Date(String(startedActivity.completesAt)).getTime()).toBeGreaterThan(Date.now());
    expect(new Date(String(startedActivity.completesAt)).getTime() - new Date(String(startedActivity.startedAt)).getTime()).toBe(60_000);

    const invalidDestination = await sendCommand(leaderConnection, 'bad-destination', 1, { type: 'expedition.start', destination: 'mountain' });
    expect(invalidDestination.payload).toEqual(expect.objectContaining({ accepted: false, errorCode: 'invalid_destination', currentRevision: 1 }));
    const secondStart = await sendCommand(leaderConnection, 'start-2', 1, { type: 'expedition.start', destination: 'forest' });
    expect(secondStart.payload).toEqual(expect.objectContaining({ accepted: false, errorCode: 'activity_not_idle', currentRevision: 1 }));
    const unsupported = await sendCommand(leaderConnection, 'complete-client-claim', 1, { type: 'expedition.complete' });
    expect(unsupported.payload).toEqual(expect.objectContaining({ accepted: false, errorCode: 'invalid_command', currentRevision: 1 }));

    const contribution = await sendCommand(memberConnection, 'contribute-1', 1, { type: 'expedition.contribute', amount: 3 });
    await Promise.all([expectStateSnapshot(leaderConnection, 2), expectStateSnapshot(memberConnection, 2)]);
    expect(contribution.payload).toEqual(expect.objectContaining({ accepted: true, resultingRevision: 2 }));
    const invalidContribution = await sendCommand(memberConnection, 'contribute-bad', 2, { type: 'expedition.contribute', amount: 11 });
    expect(invalidContribution.payload).toEqual(expect.objectContaining({ accepted: false, errorCode: 'invalid_contribution', currentRevision: 2 }));

    await pool.query('UPDATE party_states SET completes_at = NOW() - INTERVAL \'1 second\' WHERE party_id = $1', [party.id]);
    leaderConnection.socket.send(envelope('party.state.get'));
    await expectStateSnapshot(leaderConnection, 3);
    await expectStateSnapshot(memberConnection, 3);
    const completed = await expectStateSnapshot(leaderConnection, 3);
    expect(completed.requestId).toMatch(/^state-request-/);
    expect((completed.payload.activity as Record<string, unknown>).status).toBe('completed');
    expect(completed.payload.contributions).toEqual(expect.objectContaining({ [member.id]: 3 }));
    const lateContribution = await sendCommand(memberConnection, 'late-contribution', 3, { type: 'expedition.contribute', amount: 1 });
    expect(lateContribution.payload).toEqual(expect.objectContaining({ accepted: false, errorCode: 'activity_not_active', currentRevision: 3 }));

    const memberReset = await sendCommand(memberConnection, 'reset-member', 3, { type: 'expedition.reset' });
    expect(memberReset.payload).toEqual(expect.objectContaining({ accepted: false, errorCode: 'not_party_leader', currentRevision: 3 }));
    const leaderReset = await sendCommand(leaderConnection, 'reset-leader', 3, { type: 'expedition.reset' });
    await Promise.all([expectStateSnapshot(leaderConnection, 4), expectStateSnapshot(memberConnection, 4)]);
    expect(leaderReset.payload).toEqual(expect.objectContaining({ accepted: true, resultingRevision: 4 }));
  });

  it('rejects stale competing commands, makes accepted command IDs idempotent, and isolates parties', async () => {
    const leader = await createPlayer();
    const member = await createPlayer();
    const otherLeader = await createPlayer();
    const party = await createParty(leader);
    await joinParty(member, party.joinCode);
    await createParty(otherLeader);
    const leaderConnection = await openConnection(leader);
    const memberConnection = await openConnection(member);
    const otherConnection = await openConnection(otherLeader);
    leaderConnection.harness.drain();
    memberConnection.harness.drain();
    otherConnection.harness.drain();

    const start = await sendCommand(leaderConnection, 'start-concurrency', 0, { type: 'expedition.start', destination: 'forest' });
    await Promise.all([expectStateSnapshot(leaderConnection, 1), expectStateSnapshot(memberConnection, 1)]);
    expect(start.payload.accepted).toBe(true);

    const competing = await Promise.all([
      sendCommand(leaderConnection, 'concurrent-a', 1, { type: 'expedition.contribute', amount: 1 }),
      sendCommand(memberConnection, 'concurrent-b', 1, { type: 'expedition.contribute', amount: 1 })
    ]);
    expect(competing.filter(result => result.payload.accepted === true)).toHaveLength(1);
    expect(competing.filter(result => result.payload.errorCode === 'revision_conflict')).toHaveLength(1);
    await Promise.all([expectStateSnapshot(leaderConnection, 2), expectStateSnapshot(memberConnection, 2)]);
    expect(await pool.query('SELECT revision FROM party_states WHERE party_id = $1', [party.id])).toMatchObject({ rows: [{ revision: '2' }] });

    const duplicate = await sendCommand(memberConnection, 'concurrent-a', 1, { type: 'expedition.contribute', amount: 1 });
    expect(duplicate.payload).toEqual(expect.objectContaining({ accepted: true, resultingRevision: 2 }));
    await expect(otherConnection.harness.next(message => message.type === 'party.state.snapshot', 150)).rejects.toThrow('Timed out');
    const mismatch = await sendCommand(memberConnection, 'concurrent-a', 1, { type: 'expedition.contribute', amount: 2 });
    expect(mismatch.payload).toEqual(expect.objectContaining({ accepted: false, errorCode: 'duplicate_command_mismatch', currentRevision: 2 }));
  });

  it('requires party scope refresh after membership changes and preserves state across backend restart', async () => {
    const leader = await createPlayer();
    const member = await createPlayer();
    const party = await createParty(leader);
    await joinParty(member, party.joinCode);
    const leaderConnection = await openConnection(leader);
    const memberConnection = await openConnection(member);
    leaderConnection.harness.drain();
    memberConnection.harness.drain();

    const start = await sendCommand(leaderConnection, 'persisted-start', 0, { type: 'expedition.start', destination: 'forest' });
    await Promise.all([expectStateSnapshot(leaderConnection, 1), expectStateSnapshot(memberConnection, 1)]);
    expect(start.payload.accepted).toBe(true);

    const leave = await app.inject({
      method: 'DELETE',
      url: '/v1/parties/current',
      headers: { Authorization: `Bearer ${member.token}` }
    });
    expect(leave.statusCode).toBe(204);
    memberConnection.socket.send(envelope('party.state.get'));
    expect((await memberConnection.harness.next(message => message.type === 'party.state.error')).payload.errorCode).toBe('party_refresh_required');
    memberConnection.socket.send(envelope('party.refresh'));
    expect((await memberConnection.harness.next(message => message.type === 'party.snapshot')).payload.partyId).toBeNull();
    memberConnection.socket.send(envelope('party.state.get'));
    expect((await memberConnection.harness.next(message => message.type === 'party.state.error')).payload.errorCode).toBe('not_in_party');

    await app.close();
    await startApp();
    const reconnected = await openConnection(leader);
    reconnected.socket.send(envelope('party.state.get'));
    const snapshot = await expectStateSnapshot(reconnected, 1);
    expect(snapshot.payload).toEqual(expect.objectContaining({ partyId: party.id, revision: 1 }));
    expect(snapshot.payload.activity).toEqual(expect.objectContaining({ status: 'active', destination: 'forest' }));
  });

  it('cascades state, contributions, and command records when the party is deleted', async () => {
    const leader = await createPlayer();
    const party = await createParty(leader);
    const connection = await openConnection(leader);
    connection.harness.drain();
    sendStateGet(connection);
    await expectStateSnapshot(connection, 0);
    const start = await sendCommand(connection, 'cascade-start', 0, { type: 'expedition.start', destination: 'forest' });
    await expectStateSnapshot(connection, 1);
    expect(start.payload.accepted).toBe(true);

    const leave = await app.inject({
      method: 'DELETE',
      url: '/v1/parties/current',
      headers: { Authorization: `Bearer ${leader.token}` }
    });
    expect(leave.statusCode).toBe(204);
    const counts = await pool.query(
      `SELECT
         (SELECT COUNT(*) FROM party_states WHERE party_id = $1)::int AS states,
         (SELECT COUNT(*) FROM party_commands WHERE party_id = $1)::int AS commands,
         (SELECT COUNT(*) FROM party_state_contributions WHERE party_id = $1)::int AS contributions`,
      [party.id]
    );
    expect(counts.rows[0]).toEqual({ states: 0, commands: 0, contributions: 0 });
  });
});
