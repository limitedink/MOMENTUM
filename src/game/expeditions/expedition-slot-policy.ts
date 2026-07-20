export const EXPEDITION_SLOT_IDS = ['slot-1', 'slot-2', 'slot-3', 'slot-4'] as const;
export type ExpeditionSlotId = (typeof EXPEDITION_SLOT_IDS)[number];

export const EXPEDITION_SLOT_EFFICIENCY = [1, 0.85, 0.65, 0.45] as const;

export interface SlotPolicyAssignment {
  slotId: string;
  playerId: string;
  roleId: string;
}

export function isSoloParty(partyMemberCount: number): boolean {
  return partyMemberCount <= 1;
}

export function playerAssignmentCount(assignments: readonly SlotPolicyAssignment[], playerId: string): number {
  return assignments.filter(assignment => assignment.playerId === playerId).length;
}

export function canPlayerOccupySlot(
  assignments: readonly SlotPolicyAssignment[],
  playerId: string,
  slotId: string,
  partyMemberCount: number
): boolean {
  if (isSoloParty(partyMemberCount)) return true;
  return !assignments.some(assignment => assignment.playerId === playerId && assignment.slotId !== slotId);
}

export function normalizeAssignmentsForPartySize<T extends SlotPolicyAssignment>(
  assignments: readonly T[],
  partyMemberCount: number
): T[] {
  if (isSoloParty(partyMemberCount)) return [...assignments];
  const seenPlayers = new Set<string>();
  return [...assignments]
    .sort((a, b) => a.slotId.localeCompare(b.slotId))
    .filter(assignment => {
      if (seenPlayers.has(assignment.playerId)) return false;
      seenPlayers.add(assignment.playerId);
      return true;
    });
}

export function efficiencyForPlayerSlot(assignments: readonly SlotPolicyAssignment[], assignment: SlotPolicyAssignment): number {
  const index = assignments
    .filter(candidate => candidate.playerId === assignment.playerId)
    .sort((a, b) => a.slotId.localeCompare(b.slotId))
    .findIndex(candidate => candidate.slotId === assignment.slotId);
  return EXPEDITION_SLOT_EFFICIENCY[index] ?? EXPEDITION_SLOT_EFFICIENCY[EXPEDITION_SLOT_EFFICIENCY.length - 1];
}
