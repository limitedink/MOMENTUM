import { describe, expect, it, vi } from 'vitest';
import { COMMAND_TYPES, CONNECTION_STATES, assertTransport, createCommandEnvelope, isCommandEnvelope, partyTransportApi } from '../src/party/party-transport';
import { parsePartySnapshot } from '../src/party/party-schema';
import { createLocalMomentumPartyTransport, normalizePartySave } from '../src/party/local-party-transport';
import { createPartyCommandController } from '../src/party/party-controller';
import { createPartySnapshotStore } from '../src/party/party-store';
import { createClientSession } from '../src/party/party-session';
import type { MomentumPartyTransport, PartySnapshot } from '../src/party/party-types';

function snapshot(revision: number, playerId = 'auth-user', pending = false, claimed = false): PartySnapshot {
  const reward = { id: 'forest-expedition-1', expedition: 1, pineLogs: 20, cookedFish: 3 };
  return {
    revision, generatedAt: revision,
    party: { id: 'local-party', members: [{ id: playerId, name: 'You', type: 'human', affinity: 'balanced', activity: 'forest_patrol', efficiency: 1, lastActivityTick: 0, totals: { threat: revision, timber: 0, supplies: 0 } }] },
    expedition: { status: 'active', completedExpeditions: claimed ? 1 : 0, lanes: { threat: revision, timber: 0, supplies: 0 }, contributions: { [playerId]: { threat: revision, timber: 0, supplies: 0 } }, lastContributions: null, pendingRewards: pending ? reward : null, claimedRewards: claimed ? [{ ...reward, claimedAt: revision }] : [] },
    recentEvents: [{ text: `revision ${revision}`, tick: revision, at: revision }], notable: [], elapsedTicks: revision, lastResolvedAt: revision
  };
}

function storageWith(value: string | null) {
  const values: Record<string, string> = value === null ? {} : { 'momentum-taskbar-party-v1': value };
  return { getItem: (key: string) => values[key] ?? null, setItem: (key: string, next: string) => { values[key] = next; }, removeItem: (key: string) => { delete values[key]; }, values };
}

describe('canonical protocol schema', () => {
  it('rejects malformed commands and legacy snapshot aliases', () => {
    const command = createCommandEnvelope(COMMAND_TYPES.SET_ACTIVITY, { activityId: 'rest' }, 7);
    expect(isCommandEnvelope(command)).toBe(true);
    expect(isCommandEnvelope({ ...command, clientRevision: -1 })).toBe(false);
    expect(isCommandEnvelope({ ...command, payload: { activityId: 'missing' } })).toBe(false);
    expect(parsePartySnapshot({ ...snapshot(1), connection: { status: 'connected' } })).toBeNull();
    expect(parsePartySnapshot(snapshot(1))).toEqual(snapshot(1));
    expect(() => assertTransport({})).toThrow(/missing/);
    expect(partyTransportApi.COMMAND_TYPES).toBe(COMMAND_TYPES);
  });
});

describe('snapshot store and client session', () => {
  it('accepts only newer canonical snapshots and keeps client state out of them', () => {
    const store = createPartySnapshotStore(snapshot(10));
    expect(store.acceptSnapshot(snapshot(9)).accepted).toBe(false);
    expect(store.acceptSnapshot(snapshot(10)).accepted).toBe(false);
    expect(store.acceptSnapshot(snapshot(22)).accepted).toBe(true);
    expect(store.getSnapshot()).not.toHaveProperty('connection');
    expect(store.getAcceptedRevision()).toBe(22);
  });

  it('identifies the authenticated member through the session, not a member id convention', () => {
    const store = createPartySnapshotStore(snapshot(0, 'session-player'));
    const session = createClientSession(store, { authenticatedPlayerId: 'session-player', currentPartyId: 'local-party' }, CONNECTION_STATES.CONNECTED);
    expect(session.getState().authenticatedPlayerId).toBe('session-player');
    const command = createCommandEnvelope(COMMAND_TYPES.SET_ACTIVITY, { activityId: 'rest' }, 0);
    expect(session.beginCommand(command)).toBe(command.commandId);
    expect(session.applyCommandResult({ commandId: command.commandId, status: 'confirmed', snapshot: snapshot(1, 'session-player') }).matched).toBe(true);
    expect(session.getState().lastAcceptedRevision).toBe(1);
  });

  it('correlates independent command results and ignores stale snapshots', () => {
    const store = createPartySnapshotStore(snapshot(0));
    const session = createClientSession(store, { authenticatedPlayerId: 'auth-user', currentPartyId: 'local-party' }, CONNECTION_STATES.CONNECTED);
    const first = createCommandEnvelope(COMMAND_TYPES.SET_ACTIVITY, { activityId: 'rest' }, 0);
    const second = createCommandEnvelope(COMMAND_TYPES.CLAIM_REWARD, { rewardId: 'forest-expedition-1' }, 0);
    session.beginCommand(first); session.beginCommand(second);
    expect(session.applyCommandResult({ commandId: second.commandId, status: 'confirmed', snapshot: snapshot(22, 'auth-user', false, true) }).matched).toBe(true);
    expect(session.applyCommandResult({ commandId: first.commandId, status: 'confirmed', snapshot: snapshot(21) }).matched).toBe(true);
    expect(store.getAcceptedRevision()).toBe(22);
    expect(session.getState().pendingCommands).toHaveLength(0);
  });
});

describe('asynchronous local transport', () => {
  it('exposes only asynchronous transport operations and preserves the flow', async () => {
    vi.useFakeTimers();
    try {
      const transport = createLocalMomentumPartyTransport({ commandDelay: 1, connectDelay: 0, authenticatedPlayerId: 'auth-user', storage: storageWith(null) });
      const initial = transport.requestSnapshot();
      expect(initial).toBeInstanceOf(Promise);
      await vi.advanceTimersByTimeAsync(1);
      const initialSnapshot = await initial;
      expect(initialSnapshot.party.members[0].id).toBe('auth-user');
      const connecting = transport.connect();
      await vi.advanceTimersByTimeAsync(0);
      expect(await connecting).toBe(true);
      expect(await transport.getConnectionState()).toBe(CONNECTION_STATES.CONNECTED);
      const results: Array<{ status: string; snapshot?: PartySnapshot }> = [];
      transport.subscribeToCommandResults(result => results.push(result));
      const command = createCommandEnvelope(COMMAND_TYPES.SET_ACTIVITY, { activityId: 'rest' }, 1);
      expect(await transport.submitCommand(command)).toBe(true);
      await vi.advanceTimersByTimeAsync(1);
      expect(results.at(-1)?.status).toBe('confirmed');
      for (let tick = 0; tick < 80; tick += 1) transport.simulateTick();
      const latestPromise = transport.requestSnapshot();
      await vi.advanceTimersByTimeAsync(1);
      const latest = await latestPromise;
      expect(latest.expedition.pendingRewards).not.toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  it('normalizes legacy saves only at the local adapter boundary', () => {
    const legacy = normalizePartySave({ revision: 12, party: [{ id: 'player', activity: 'forest_patrol' }, { id: 'alex', activity: 'pine_chopping' }], pendingRewards: { expedition: 2, pineLogs: 20, cookedFish: 3 } }, 'session-player');
    expect(legacy.party[0].id).toBe('session-player');
    expect(legacy.party.map(member => member.id)).toContain('sofia');
    expect(legacy.pendingRewards?.id).toBe('forest-expedition-2');
  });

  it('routes command confirmation through the async transport boundary', async () => {
    const store = createPartySnapshotStore(snapshot(0));
    const session = createClientSession(store, { authenticatedPlayerId: 'auth-user', currentPartyId: 'local-party' }, CONNECTION_STATES.CONNECTED);
    let resultListener: ((result: Parameters<MomentumPartyTransport['subscribeToCommandResults']>[0] extends (result: infer R) => void ? R : never) => void) | null = null;
    const transport: MomentumPartyTransport = {
      connect: async () => true, disconnect: async () => true, getConnectionState: async () => CONNECTION_STATES.CONNECTED,
      getSessionIdentity: async () => ({ authenticatedPlayerId: 'auth-user', currentPartyId: 'local-party' }), requestSnapshot: async () => snapshot(0),
      submitCommand: async command => { await Promise.resolve(); resultListener?.({ commandId: command.commandId, status: 'confirmed', snapshot: snapshot(1) }); return true; },
      subscribeToSnapshots: () => () => {}, subscribeToConnection: () => () => {}, subscribeToCommandResults: listener => { resultListener = listener; return () => { resultListener = null; }; }, destroy: async () => {}
    };
    transport.subscribeToCommandResults(result => session.applyCommandResult(result));
    const controller = createPartyCommandController(session, transport);
    expect(await controller.setActivity('rest')).toBe(true);
    expect(session.getCommandState(COMMAND_TYPES.SET_ACTIVITY).status).toBe('confirmed');
  });
});
