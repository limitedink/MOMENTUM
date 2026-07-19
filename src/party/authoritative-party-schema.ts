import type {
  AuthoritativeCommandResult,
  AuthoritativeConnectionReady,
  AuthoritativePartyMember,
  AuthoritativePartyScope,
  AuthoritativePartyState,
  AuthoritativePresence
} from './authoritative-party-types';

type RecordValue = Record<string, unknown>;

function isRecord(value: unknown): value is RecordValue {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function hasExactKeys(value: RecordValue, keys: readonly string[]): boolean {
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  return actual.length === expected.length && actual.every((key, index) => key === expected[index]);
}

function nonNegativeInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
}

function finiteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function nullableString(value: unknown): value is string | null {
  return value === null || typeof value === 'string';
}

function isDateString(value: unknown): value is string | null {
  return value === null || (typeof value === 'string' && Number.isFinite(Date.parse(value)));
}

export function parseAuthoritativePartyState(value: unknown): AuthoritativePartyState | null {
  if (!isRecord(value)) return null;
  const hasKnownShape = hasExactKeys(value, ['partyId', 'revision', 'activity', 'contributions', 'memberActivities', 'updatedAt', 'serverTimestamp']) ||
    hasExactKeys(value, ['partyId', 'revision', 'activity', 'contributions', 'memberActivities', 'pendingRewards', 'updatedAt', 'serverTimestamp']);
  if (!hasKnownShape) return null;
  if (typeof value.partyId !== 'string' || value.partyId.length === 0 || !nonNegativeInteger(value.revision) ||
    !isRecord(value.activity) || !hasExactKeys(value.activity, ['kind', 'status', 'destination', 'startedAt', 'completesAt']) ||
    value.activity.kind !== 'expedition' || !['idle', 'active', 'completed'].includes(String(value.activity.status)) ||
    !nullableString(value.activity.destination) || (value.activity.destination !== null && value.activity.destination !== 'forest') ||
    !isDateString(value.activity.startedAt) || !isDateString(value.activity.completesAt) ||
    !isRecord(value.contributions) || Object.values(value.contributions).some(contribution => !nonNegativeInteger(contribution)) ||
    !isRecord(value.memberActivities) || Object.values(value.memberActivities).some(activity => !['forest_patrol', 'pine_chopping', 'camp_cooking', 'rest'].includes(String(activity))) ||
    (value.pendingRewards !== undefined && (!isRecord(value.pendingRewards) || Object.values(value.pendingRewards).some(rewards => !Array.isArray(rewards) || rewards.some(reward => !isRecord(reward) || typeof reward.id !== 'string' || !['forest_patrol', 'pine_chopping', 'camp_cooking', 'rest'].includes(String(reward.primaryActivity)) || !nonNegativeInteger(reward.primaryXp) || !isRecord(reward.partyXp) || Object.values(reward.partyXp).some(xp => !nonNegativeInteger(xp)) || !isRecord(reward.rewards) || !nonNegativeInteger(reward.rewards.bossKeys) || !nonNegativeInteger(reward.rewards.pineLogs) || !nonNegativeInteger(reward.rewards.cookedFish) || !nonNegativeInteger(reward.rewards.game))))) ||
    typeof value.updatedAt !== 'string' || !Number.isFinite(Date.parse(value.updatedAt)) || !finiteNumber(value.serverTimestamp)) return null;
  return { ...value, pendingRewards: (value.pendingRewards || {}) as AuthoritativePartyState['pendingRewards'] } as unknown as AuthoritativePartyState;
}

export function parseAuthoritativePartyScope(value: unknown): AuthoritativePartyScope | null {
  if (!isRecord(value) || !hasExactKeys(value, ['partyId', 'leaderPlayerId', 'memberPlayerIds', 'members', 'joinCode', 'serverTimestamp']) ||
    !nullableString(value.partyId) || !nullableString(value.leaderPlayerId) || !Array.isArray(value.memberPlayerIds) ||
    value.memberPlayerIds.some(playerId => typeof playerId !== 'string' || playerId.length === 0) ||
    !Array.isArray(value.members) || value.members.some(member => !isRecord(member) ||
      typeof member.playerId !== 'string' || member.playerId.length === 0 ||
      typeof member.displayName !== 'string' || member.displayName.length < 1 || member.displayName.length > 24 ||
      typeof member.isLeader !== 'boolean') ||
    !nullableString(value.joinCode) || !finiteNumber(value.serverTimestamp)) return null;
  return {
    partyId: value.partyId,
    leaderPlayerId: value.leaderPlayerId,
    memberPlayerIds: [...value.memberPlayerIds] as string[],
    members: (value.members as AuthoritativePartyMember[]).map(member => ({ ...member })),
    joinCode: value.joinCode,
    serverTimestamp: value.serverTimestamp
  };
}

export function parseAuthoritativeConnectionReady(value: unknown): AuthoritativeConnectionReady | null {
  if (!isRecord(value) || !hasExactKeys(value, ['connectionId', 'playerId', 'partyId', 'partyMemberIds', 'serverTimestamp', 'protocolVersion']) ||
    typeof value.connectionId !== 'string' || value.connectionId.length === 0 || typeof value.playerId !== 'string' || value.playerId.length === 0 ||
    !nullableString(value.partyId) || !Array.isArray(value.partyMemberIds) ||
    value.partyMemberIds.some(playerId => typeof playerId !== 'string' || playerId.length === 0) ||
    !finiteNumber(value.serverTimestamp) || value.protocolVersion !== 1) return null;
  return {
    connectionId: value.connectionId,
    playerId: value.playerId,
    partyId: value.partyId,
    memberPlayerIds: [...value.partyMemberIds] as string[],
    serverTimestamp: value.serverTimestamp,
    protocolVersion: 1
  };
}

export function parseAuthoritativePresence(value: unknown): AuthoritativePresence | null {
  if (!isRecord(value) || !hasExactKeys(value, ['playerId', 'status', 'connectedSessionCount', 'serverTimestamp']) ||
    typeof value.playerId !== 'string' || value.playerId.length === 0 || !['online', 'offline'].includes(String(value.status)) ||
    !nonNegativeInteger(value.connectedSessionCount) || !finiteNumber(value.serverTimestamp)) return null;
  return value as unknown as AuthoritativePresence;
}

export function parseAuthoritativeCommandResult(value: unknown): AuthoritativeCommandResult | null {
  if (!isRecord(value) || !hasExactKeys(value, ['commandId', 'accepted', 'resultingRevision', 'currentRevision', 'errorCode', 'serverTimestamp']) ||
    typeof value.commandId !== 'string' || value.commandId.length === 0 || typeof value.accepted !== 'boolean' ||
    !(value.resultingRevision === null || nonNegativeInteger(value.resultingRevision)) ||
    !(value.currentRevision === null || nonNegativeInteger(value.currentRevision)) ||
    !(value.errorCode === null || typeof value.errorCode === 'string') || !finiteNumber(value.serverTimestamp)) return null;
  return value as unknown as AuthoritativeCommandResult;
}
