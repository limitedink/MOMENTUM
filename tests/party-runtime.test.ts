import { describe, expect, it, vi } from 'vitest';
import {
  COMMAND_TYPES,
  CONNECTION_STATES,
  assertTransport,
  createCommandEnvelope,
  isCommandEnvelope,
  partyTransportApi
} from '../src/party/party-transport';
import { createLocalMomentumPartyTransport, normalizePartySave } from '../src/party/local-party-transport';
import { createPartyCommandController } from '../src/party/party-controller';
import { createPartySnapshotStore } from '../src/party/party-store';
import type { MomentumPartyTransport, PartySnapshot } from '../src/party/party-types';

function snapshot(revision: number, pending = false, claimed = false): PartySnapshot {
  const reward = { id: 'forest-expedition-1', expedition: 1, pineLogs: 20, cookedFish: 3 };
  return {
    revision,
    generatedAt: revision,
    connection: { status: CONNECTION_STATES.CONNECTED, lastConfirmedAt: revision },
    party: {
      id: 'local-party',
      members: [{ id: 'player', name: 'You', type: 'human', affinity: 'balanced', activity: 'forest_patrol', efficiency: 1, lastActivityTick: 0, totals: { threat: revision, timber: 0, supplies: 0 } }]
    },
    expedition: {
      status: 'active',
      completedExpeditions: claimed ? 1 : 0,
      lanes: { threat: revision, timber: 0, supplies: 0 },
      contributions: { player: { threat: revision, timber: 0, supplies: 0 } },
      lastContributions: null,
      pendingRewards: pending ? reward : null,
      claimedRewards: claimed ? [{ ...reward, claimedAt: revision }] : []
    },
    recentEvents: [{ text: `revision ${revision}`, tick: revision, at: revision }],
    notable: [],
    elapsedTicks: revision,
    lastResolvedAt: revision
  };
}

function storageWith(value: string | null) {
  const values: Record<string, string> = value === null ? {} : { 'momentum-taskbar-party-v1': value };
  return {
    getItem: (key: string) => values[key] ?? null,
    setItem: (key: string, next: string) => { values[key] = next; },
    removeItem: (key: string) => { delete values[key]; },
    values
  };
}

describe('typed party transport contract', () => {
  it('constructs and rejects malformed command envelopes', () => {
    const command = createCommandEnvelope(COMMAND_TYPES.SET_ACTIVITY, { activityId: 'rest' }, 7);
    expect(command.commandId).toMatch(/^cmd_/);
    expect(command.clientRevision).toBe(7);
    expect(isCommandEnvelope(command)).toBe(true);
    expect(isCommandEnvelope({ ...command, clientRevision: -1 })).toBe(false);
    expect(isCommandEnvelope({ ...command, payload: { activityId: 'missing' } })).toBe(false);
    expect(() => assertTransport({})).toThrow(/missing/);
    expect(assertTransport({
      connect: () => true, disconnect: () => true, getConnectionState: () => CONNECTION_STATES.CONNECTED,
      requestSnapshot: () => snapshot(0), submitCommand: () => true,
      subscribeToSnapshots: () => () => {}, subscribeToConnection: () => () => {},
      subscribeToCommandResults: () => () => {}, destroy: () => {}
    })).toBeDefined();
    expect(partyTransportApi.COMMAND_TYPES).toBe(COMMAND_TYPES);
  });
});

describe('typed snapshot store and command controller', () => {
  it('accepts only newer snapshots and protects rewards', () => {
    const store = createPartySnapshotStore(snapshot(10), CONNECTION_STATES.CONNECTED);
    expect(store.acceptSnapshot(snapshot(9)).accepted).toBe(false);
    expect(store.acceptSnapshot(snapshot(10)).accepted).toBe(false);
    expect(store.acceptSnapshot(snapshot(22)).accepted).toBe(true);
    expect(store.acceptSnapshot(snapshot(21)).accepted).toBe(false);
    store.acceptSnapshot(snapshot(23, true));
    store.acceptSnapshot(snapshot(24, false, true));
    store.acceptSnapshot(snapshot(23, true));
    expect(store.getSnapshot().expedition.pendingRewards).toBeNull();
    expect(store.getSnapshot().expedition.claimedRewards).toHaveLength(1);
  });

  it('correlates independent, stale, unknown, duplicate, and rejected results', () => {
    const store = createPartySnapshotStore(snapshot(0), CONNECTION_STATES.CONNECTED);
    const activity = createCommandEnvelope(COMMAND_TYPES.SET_ACTIVITY, { activityId: 'rest' }, 0);
    const reward = createCommandEnvelope(COMMAND_TYPES.CLAIM_REWARD, { rewardId: 'forest-expedition-1' }, 0);
    store.beginCommand(activity);
    store.beginCommand(reward);
    expect(store.applyCommandResult({ commandId: reward.commandId, status: 'confirmed', snapshot: snapshot(22, false, true) }).matched).toBe(true);
    expect(store.applyCommandResult({ commandId: activity.commandId, status: 'confirmed', snapshot: snapshot(21) }).matched).toBe(true);
    expect(store.getAcceptedRevision()).toBe(22);
    expect(store.applyCommandResult({ commandId: 'unknown', status: 'confirmed', snapshot: snapshot(23) }).matched).toBe(false);
    expect(store.applyCommandResult({ commandId: activity.commandId, status: 'confirmed', snapshot: snapshot(21) }).matched).toBe(false);

    const retry = createCommandEnvelope(COMMAND_TYPES.SET_ACTIVITY, { activityId: 'rest' }, 23);
    store.beginCommand(retry);
    store.applyCommandResult({ commandId: retry.commandId, status: 'rejected', error: { code: 'TEST', message: 'Try again.' } });
    expect(store.getCommandState(COMMAND_TYPES.SET_ACTIVITY).status).toBe('rejected');
    expect(store.beginCommand(createCommandEnvelope(COMMAND_TYPES.SET_ACTIVITY, { activityId: 'rest' }, 23))).not.toBeNull();
  });

  it('routes controller commands through the transport and preserves pending state', () => {
    const store = createPartySnapshotStore(snapshot(0), CONNECTION_STATES.CONNECTED);
    let resultListener: ((result: Parameters<MomentumPartyTransport['subscribeToCommandResults']>[0] extends (result: infer R) => void ? R : never) => void) | null = null;
    const transport: MomentumPartyTransport = {
      connect: () => true, disconnect: () => true, getConnectionState: () => CONNECTION_STATES.CONNECTED,
      requestSnapshot: () => snapshot(0),
      submitCommand: command => { resultListener?.({ commandId: command.commandId, status: 'confirmed', snapshot: snapshot(1) }); return true; },
      subscribeToSnapshots: () => () => {}, subscribeToConnection: () => () => {},
      subscribeToCommandResults: listener => { resultListener = listener; return () => { resultListener = null; }; }, destroy: () => {}
    };
    transport.subscribeToCommandResults(result => store.applyCommandResult(result));
    const controller = createPartyCommandController(store, transport);
    expect(controller.setActivity('rest')).toBe(true);
    expect(store.getCommandState(COMMAND_TYPES.SET_ACTIVITY).status).toBe('confirmed');
    expect(store.getAcceptedRevision()).toBe(1);
  });
});

describe('typed local transport', () => {
  it('normalizes malformed and legacy saves safely', () => {
    const malformed = normalizePartySave({ party: 'not-an-array', pendingRewards: {}, claimedRewards: 'bad' });
    expect(malformed.version).toBe(1);
    expect(malformed.party.some(member => member.id === 'player')).toBe(true);
    const legacy = normalizePartySave({
      version: 1,
      revision: 12,
      party: [{ id: 'player', activity: 'forest_patrol' }, { id: 'alex', activity: 'pine_chopping' }, { id: 'rowan', activity: 'camp_cooking' }],
      pendingRewards: { expedition: 2, pineLogs: 20, cookedFish: 3 }
    });
    expect(legacy.revision).toBe(12);
    expect(legacy.party.map(member => member.id)).toContain('sofia');
    expect(legacy.party.map(member => member.id)).toContain('maya');
    expect(legacy.pendingRewards?.id).toBe('forest-expedition-2');
  });

  it('preserves the full local expedition and reward flow', () => {
    vi.useFakeTimers();
    try {
      const storage = storageWith(null);
      const transport = createLocalMomentumPartyTransport({ commandDelay: 1, connectDelay: 0, storage });
      const results: Array<{ commandId: string; status: string; snapshot?: PartySnapshot }> = [];
      let latest = transport.requestSnapshot();
      transport.subscribeToSnapshots(snapshotValue => { latest = snapshotValue; });
      transport.subscribeToCommandResults(result => results.push(result));
      transport.connect();
      vi.advanceTimersByTime(0);
      expect(transport.getConnectionState()).toBe(CONNECTION_STATES.CONNECTED);
      const command = createCommandEnvelope(COMMAND_TYPES.SET_ACTIVITY, { activityId: 'rest' }, 1);
      expect(transport.submitCommand(command)).toBe(true);
      vi.advanceTimersByTime(1);
      expect(results.at(-1)?.status).toBe('confirmed');
      for (let tick = 0; tick < 50; tick += 1) transport.simulateTick();
      expect(latest.expedition.pendingRewards).not.toBeNull();
      const reward = latest.expedition.pendingRewards;
      const claim = createCommandEnvelope(COMMAND_TYPES.CLAIM_REWARD, { rewardId: reward?.id || '' }, 51);
      expect(transport.submitCommand(claim)).toBe(true);
      vi.advanceTimersByTime(1);
      expect(results.at(-1)?.snapshot?.expedition.claimedRewards).toHaveLength(1);
      expect(JSON.parse(storage.values['momentum-taskbar-party-v1']).claimedRewards).toHaveLength(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it('rejects pending commands when disconnected', () => {
    vi.useFakeTimers();
    try {
      const transport = createLocalMomentumPartyTransport({ commandDelay: 10, storage: storageWith(null) });
      const results: Array<{ status: string }> = [];
      transport.subscribeToCommandResults(result => results.push(result));
      transport.connect();
      vi.advanceTimersByTime(0);
      const command = createCommandEnvelope(COMMAND_TYPES.SET_ACTIVITY, { activityId: 'rest' }, 0);
      transport.submitCommand(command);
      transport.disconnect();
      expect(results.at(-1)?.status).toBe('rejected');
    } finally {
      vi.useRealTimers();
    }
  });
});
