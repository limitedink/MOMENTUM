import { describe, expect, it } from 'vitest';
import { canPlayerOccupySlot, normalizeAssignmentsForPartySize } from '../../src/domain/party-state/expedition-slot-policy.js';

const assignments = [
  { slotId: 'slot-1', playerId: 'player-1', roleId: 'dps' },
  { slotId: 'slot-2', playerId: 'player-1', roleId: 'tank' },
  { slotId: 'slot-3', playerId: 'player-2', roleId: 'healer' }
];

describe('authoritative expedition slot policy', () => {
  it('allows all solo slots and clears extras for multiplayer normalization', () => {
    expect(canPlayerOccupySlot(assignments, 'player-1', 'slot-4', 1)).toBe(true);
    expect(normalizeAssignmentsForPartySize(assignments, 2).map(item => item.slotId)).toEqual(['slot-1', 'slot-3']);
  });

  it('rejects a second slot for a player in a party', () => {
    expect(canPlayerOccupySlot(assignments, 'player-1', 'slot-4', 2)).toBe(false);
    expect(canPlayerOccupySlot(assignments, 'player-2', 'slot-3', 2)).toBe(true);
  });
});
