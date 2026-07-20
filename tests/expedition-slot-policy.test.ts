import { describe, expect, it } from 'vitest';
import {
  canPlayerOccupySlot,
  efficiencyForPlayerSlot,
  normalizeAssignmentsForPartySize
} from '../src/game/expeditions';

const assignments = [
  { slotId: 'slot-1', playerId: 'one', roleId: 'dps' },
  { slotId: 'slot-2', playerId: 'one', roleId: 'tank' },
  { slotId: 'slot-3', playerId: 'two', roleId: 'healer' }
];

describe('expedition party-size slot policy', () => {
  it('allows a solo player to occupy every slot', () => {
    expect(canPlayerOccupySlot(assignments, 'one', 'slot-4', 1)).toBe(true);
    expect(normalizeAssignmentsForPartySize(assignments, 1)).toHaveLength(3);
  });

  it('limits each player to one slot in multiplayer', () => {
    expect(canPlayerOccupySlot(assignments, 'one', 'slot-4', 2)).toBe(false);
    expect(canPlayerOccupySlot(assignments, 'two', 'slot-3', 2)).toBe(true);
    expect(normalizeAssignmentsForPartySize(assignments, 2).map(item => item.slotId)).toEqual(['slot-1', 'slot-3']);
  });

  it('uses the exact solo efficiency curve', () => {
    expect(assignments.slice(0, 2).map(item => efficiencyForPlayerSlot(assignments, item))).toEqual([1, 0.85]);
  });
});
