export const EXPEDITION_SLOT_EFFICIENCY = [1, 0.85, 0.65, 0.45] as const;

export interface ServerSlotAssignment {
  slotId: string;
  playerId: string;
  roleId: string;
}

export function canPlayerOccupySlot(
  assignments: readonly ServerSlotAssignment[],
  playerId: string,
  slotId: string,
  partyMemberCount: number
): boolean {
  if (partyMemberCount <= 1) return true;
  return !assignments.some(assignment => assignment.playerId === playerId && assignment.slotId !== slotId);
}

export function normalizeAssignmentsForPartySize<T extends ServerSlotAssignment>(
  assignments: readonly T[],
  partyMemberCount: number
): T[] {
  if (partyMemberCount <= 1) return [...assignments];
  const seen = new Set<string>();
  return [...assignments]
    .sort((a, b) => a.slotId.localeCompare(b.slotId))
    .filter(assignment => {
      if (seen.has(assignment.playerId)) return false;
      seen.add(assignment.playerId);
      return true;
    });
}
