import { afterAll, beforeAll, describe, expect, it } from 'vitest';
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
  DATABASE_POOL_MAX: '8'
});

type TestPlayer = { id: string; token: string };

describe.skipIf(!databaseUrl)('party integration (PostgreSQL)', () => {
  let app: Awaited<ReturnType<typeof buildApp>>;
  let pool: Pool;

  beforeAll(async () => {
    pool = new Pool({
      connectionString: databaseUrl,
      max: 8,
      connectionTimeoutMillis: 2_000
    });
    await createMigrationRunner(pool).runFromDirectory(new URL('../../migrations', import.meta.url).pathname);
    app = await buildApp(config, { database: pool });
  });

  afterAll(async () => {
    await app?.close();
    await pool?.end();
  });

  async function createPlayer(): Promise<TestPlayer> {
    const response = await app.inject({ method: 'POST', url: '/v1/dev/players', payload: { displayName: `Player ${Date.now()}-${Math.random().toString(36).slice(2, 6)}`.slice(0, 24) } });
    expect(response.statusCode).toBe(201);
    const body = response.json();
    return { id: body.player.id, token: body.token };
  }

  function auth(token: string) {
    return { authorization: `Bearer ${token}` };
  }

  it('requires authentication for every party operation', async () => {
    const create = await app.inject({ method: 'POST', url: '/v1/parties' });
    const current = await app.inject({ method: 'GET', url: '/v1/parties/current' });
    const join = await app.inject({
      method: 'POST',
      url: '/v1/parties/join',
      payload: { joinCode: 'ABCDEFGH23' }
    });
    const leave = await app.inject({ method: 'DELETE', url: '/v1/parties/current' });

    expect(create.statusCode).toBe(401);
    expect(current.statusCode).toBe(401);
    expect(join.statusCode).toBe(401);
    expect(leave.statusCode).toBe(401);
  });

  it('creates a persistent party with a secure human-readable code and leader membership', async () => {
    const player = await createPlayer();
    const response = await app.inject({
      method: 'POST',
      url: '/v1/parties',
      headers: auth(player.token)
    });

    expect(response.statusCode).toBe(201);
    const party = response.json().party;
    expect(party.id).toEqual(expect.any(String));
    expect(party.leaderId).toBe(player.id);
    expect(party.joinCode).toMatch(/^[A-HJ-NP-Z2-9]{10}$/);
    expect(party.maxMembers).toBe(4);
    expect(party.members).toEqual([
      expect.objectContaining({ playerId: player.id, displayName: expect.stringMatching(/^Player /), isLeader: true })
    ]);

    const current = await app.inject({
      method: 'GET',
      url: '/v1/parties/current',
      headers: auth(player.token)
    });
    expect(current.statusCode).toBe(200);
    expect(current.json().party.id).toBe(party.id);
  });

  it('joins by code, lists all members, and rejects duplicate or multiple-party membership', async () => {
    const leader = await createPlayer();
    const joiner = await createPlayer();
    const other = await createPlayer();
    const created = await app.inject({ method: 'POST', url: '/v1/parties', headers: auth(leader.token) });
    const joinCode = created.json().party.joinCode;

    const joined = await app.inject({
      method: 'POST',
      url: '/v1/parties/join',
      headers: auth(joiner.token),
      payload: { joinCode: ` ${joinCode.slice(0, 5)}-${joinCode.slice(5)} ` }
    });
    expect(joined.statusCode).toBe(200);
    expect(joined.json().party.members).toHaveLength(2);
    expect(joined.json().party.members.map((member: { displayName: string }) => member.displayName)).toEqual(expect.arrayContaining([
      expect.stringMatching(/^Player /),
      expect.stringMatching(/^Player /)
    ]));

    const duplicateJoin = await app.inject({
      method: 'POST',
      url: '/v1/parties/join',
      headers: auth(joiner.token),
      payload: { joinCode }
    });
    const duplicateCreate = await app.inject({
      method: 'POST',
      url: '/v1/parties',
      headers: auth(joiner.token)
    });
    expect(duplicateJoin.statusCode).toBe(409);
    expect(duplicateJoin.json().error).toBe('already_in_party');
    expect(duplicateCreate.statusCode).toBe(409);
    expect(duplicateCreate.json().error).toBe('already_in_party');

    const otherCreate = await app.inject({ method: 'POST', url: '/v1/parties', headers: auth(other.token) });
    expect(otherCreate.statusCode).toBe(201);
    const otherJoin = await app.inject({
      method: 'POST',
      url: '/v1/parties/join',
      headers: auth(other.token),
      payload: { joinCode }
    });
    expect(otherJoin.statusCode).toBe(409);
    expect(otherJoin.json().error).toBe('already_in_party');
  });

  it('enforces the party size limit and validates join codes', async () => {
    const players = await Promise.all([createPlayer(), createPlayer(), createPlayer(), createPlayer(), createPlayer()]);
    const created = await app.inject({ method: 'POST', url: '/v1/parties', headers: auth(players[0].token) });
    const joinCode = created.json().party.joinCode;

    for (const player of players.slice(1, 4)) {
      const joined = await app.inject({
        method: 'POST',
        url: '/v1/parties/join',
        headers: auth(player.token),
        payload: { joinCode }
      });
      expect(joined.statusCode).toBe(200);
    }

    const full = await app.inject({
      method: 'POST',
      url: '/v1/parties/join',
      headers: auth(players[4].token),
      payload: { joinCode }
    });
    expect(full.statusCode).toBe(409);
    expect(full.json().error).toBe('party_full');

    const invalid = await app.inject({
      method: 'POST',
      url: '/v1/parties/join',
      headers: auth(players[4].token),
      payload: { joinCode: 'not-a-code' }
    });
    expect(invalid.statusCode).toBe(400);
    expect(invalid.json().error).toBe('invalid_join_code');

    const missing = await app.inject({
      method: 'POST',
      url: '/v1/parties/join',
      headers: auth(players[4].token),
      payload: { joinCode: 'ABCDEFGH23' }
    });
    expect(missing.statusCode).toBe(404);
    expect(missing.json().error).toBe('party_not_found');
  });

  it('transfers leadership safely and removes an empty party', async () => {
    const leader = await createPlayer();
    const member = await createPlayer();
    const created = await app.inject({ method: 'POST', url: '/v1/parties', headers: auth(leader.token) });
    const partyId = created.json().party.id;
    const joinCode = created.json().party.joinCode;

    await app.inject({
      method: 'POST',
      url: '/v1/parties/join',
      headers: auth(member.token),
      payload: { joinCode }
    });

    const leaveLeader = await app.inject({
      method: 'DELETE',
      url: '/v1/parties/current',
      headers: auth(leader.token)
    });
    expect(leaveLeader.statusCode).toBe(204);

    const memberCurrent = await app.inject({
      method: 'GET',
      url: '/v1/parties/current',
      headers: auth(member.token)
    });
    expect(memberCurrent.statusCode).toBe(200);
    expect(memberCurrent.json().party).toEqual(expect.objectContaining({ id: partyId, leaderId: member.id }));
    expect(memberCurrent.json().party.members).toEqual([
      expect.objectContaining({ playerId: member.id, isLeader: true })
    ]);

    const leaveLast = await app.inject({
      method: 'DELETE',
      url: '/v1/parties/current',
      headers: auth(member.token)
    });
    expect(leaveLast.statusCode).toBe(204);

    const missing = await app.inject({
      method: 'GET',
      url: '/v1/parties/current',
      headers: auth(member.token)
    });
    expect(missing.statusCode).toBe(404);
  });
});
