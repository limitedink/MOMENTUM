import { describe, expect, it } from 'vitest';
import {
  BackendPartyApiError,
  createBackendPartyApi,
  isValidPartyJoinCode,
  normalizePartyJoinCode
} from '../src/party/backend-party-api';

function response(body: unknown, status = 200): Response {
  return { ok: status >= 200 && status < 300, status, json: async () => body } as Response;
}

const party = {
  id: 'party-1',
  leaderId: 'player-1',
  joinCode: 'ABCD2345EF',
  maxMembers: 4,
  createdAt: '2026-07-15T00:00:00.000Z',
  updatedAt: '2026-07-15T00:00:00.000Z',
  members: [
    { playerId: 'player-1', displayName: 'Alice', joinedAt: '2026-07-15T00:00:00.000Z', isLeader: true },
    { playerId: 'player-2', displayName: 'Bob', joinedAt: '2026-07-15T00:01:00.000Z', isLeader: false }
  ]
};

describe('backend party HTTP client', () => {
  it('normalizes human-readable join codes and rejects invalid values locally', () => {
    expect(normalizePartyJoinCode(' abcd2-345ef ')).toBe('ABCD2345EF');
    expect(isValidPartyJoinCode('ABCD2345EF')).toBe(true);
    expect(normalizePartyJoinCode('not-a-code')).toBeNull();
    expect(isValidPartyJoinCode('ABCDEFGHIO')).toBe(false);
  });

  it('creates a party with bearer authentication and parses the leader/member list', async () => {
    const calls: Array<{ input: string; init?: RequestInit }> = [];
    const api = createBackendPartyApi({
      baseUrl: 'http://backend.test',
      token: 'dev_test_token',
      fetchImpl: async (input, init) => {
        calls.push({ input: String(input), init });
        return response({ party }, 201);
      }
    });

    await expect(api.createParty()).resolves.toEqual(party);
    expect(calls[0].input).toBe('http://backend.test/v1/parties');
    expect(calls[0].init).toMatchObject({ method: 'POST', headers: { authorization: 'Bearer dev_test_token' } });
  });

  it('surfaces create and join failures without hiding stable backend error codes', async () => {
    const createApi = createBackendPartyApi({
      token: 'dev_test_token',
      fetchImpl: async () => response({ error: 'already_in_party', message: 'Player is already in a party.' }, 409)
    });
    await expect(createApi.createParty()).rejects.toEqual(expect.objectContaining({
      code: 'already_in_party',
      status: 409
    }));

    let calls = 0;
    const joinApi = createBackendPartyApi({
      token: 'dev_test_token',
      fetchImpl: async (_input, init) => {
        calls += 1;
        expect(JSON.parse(String(init?.body))).toEqual({ joinCode: 'ABCD2345EF' });
        return response({ error: 'party_not_found', message: 'Party was not found.' }, 404);
      }
    });
    await expect(joinApi.joinParty('ABCD2-345EF')).rejects.toEqual(expect.objectContaining({ code: 'party_not_found', status: 404 }));
    await expect(joinApi.joinParty('not-a-code')).rejects.toEqual(expect.objectContaining({ code: 'invalid_join_code', status: 400 }));
    expect(calls).toBe(1);
  });

  it('joins with a normalized code, retains leader/member updates, and leaves through DELETE', async () => {
    const calls: Array<{ input: string; init?: RequestInit }> = [];
    const api = createBackendPartyApi({
      baseUrl: 'http://backend.test/',
      token: 'dev_test_token',
      fetchImpl: async (input, init) => {
        calls.push({ input: String(input), init });
        if (String(input).endsWith('/join')) return response({ party });
        return response(null, 204);
      }
    });

    const joined = await api.joinParty('ABCD2-345EF');
    expect(joined.members).toHaveLength(2);
    expect(joined.members.find(member => member.isLeader)?.playerId).toBe('player-1');
    await expect(api.leaveParty()).resolves.toBeUndefined();
    expect(calls[0]).toMatchObject({ input: 'http://backend.test/v1/parties/join', init: { method: 'POST' } });
    expect(calls[1]).toMatchObject({ input: 'http://backend.test/v1/parties/current', init: { method: 'DELETE' } });
  });

  it('treats the current-party 404 as an empty membership state', async () => {
    const api = createBackendPartyApi({
      token: 'dev_test_token',
      fetchImpl: async () => response({ error: 'not_in_party' }, 404)
    });
    await expect(api.getCurrentParty()).resolves.toBeNull();
  });

  it('retains typed API errors for callers that need to distinguish client failures', async () => {
    const api = createBackendPartyApi({
      token: 'dev_test_token',
      fetchImpl: async () => response({ error: 'party_full', message: 'Party is full.' }, 409)
    });
    await expect(api.joinParty('ABCD2345EF')).rejects.toBeInstanceOf(BackendPartyApiError);
  });
});
