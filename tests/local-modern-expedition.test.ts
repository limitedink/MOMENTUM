import { describe, expect, it } from 'vitest';
import { createLocalMomentumPartyTransport } from '../src/party/local-party-transport';

function storage() {
  const values = new Map<string, string>();
  return {
    getItem: (key: string) => values.get(key) || null,
    setItem: (key: string, value: string) => { values.set(key, value); },
    removeItem: (key: string) => { values.delete(key); }
  };
}

describe('local modern expedition state', () => {
  it('starts empty, permits four solo assignments, and preserves farming on abandon', async () => {
    const transport = createLocalMomentumPartyTransport({ commandDelay: 0, storage: storage() });
    await transport.connect();
    const playerId = (await transport.getSessionIdentity()).authenticatedPlayerId;

    await transport.startExpeditionMission?.('combat:forest-hunt', []);
    expect((await transport.requestSnapshot()).expedition.modern?.assignments).toEqual([]);

    await transport.clearExpeditionAssignment?.('slot-1');
    await transport.setExpeditionAssignment?.('slot-1', 'dps');
    await transport.setExpeditionAssignment?.('slot-2', 'dps');
    await transport.setExpeditionAssignment?.('slot-3', 'dps');
    await transport.setExpeditionAssignment?.('slot-4', 'dps');
    const active = await transport.requestSnapshot();
    expect(active.expedition.modern?.assignments.map(item => item.playerId)).toEqual([playerId, playerId, playerId, playerId]);
    expect(active.expedition.modern?.forecast).toMatchObject({ successPercent: expect.any(Number), dangerPercent: expect.any(Number), farmingMultiplier: expect.any(Number) });

    await transport.abandonExpedition?.();
    const abandoned = await transport.requestSnapshot();
    expect(abandoned.expedition.modern?.status).toBe('idle');
    expect(abandoned.expedition.modern?.assignments).toEqual([]);
    expect(abandoned.expedition.modern?.pendingReward?.ledger.outcome).toBe('failed');
    expect(abandoned.expedition.modern?.pendingReward?.ledger.completionRewards).toEqual({});
    await transport.destroy();
  });

  it('persists local role changes while an expedition is active', async () => {
    const transport = createLocalMomentumPartyTransport({ commandDelay: 0, storage: storage() });
    await transport.connect();
    expect(await transport.startExpeditionMission?.('combat:forest-hunt', [])).toBe(true);
    expect(await transport.setExpeditionAssignment?.('slot-1', 'tank')).toBe(true);
    expect((await transport.requestSnapshot()).expedition.modern?.assignments[0]?.roleId).toBe('tank');
    expect(await transport.clearExpeditionAssignment?.('slot-1')).toBe(true);
    expect((await transport.requestSnapshot()).expedition.modern?.assignments).toEqual([]);
    await transport.destroy();
  });
});
