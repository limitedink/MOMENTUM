import {
  COMMAND_TYPES,
  LANE_IDS,
  PARTY_ACTIVITY_IDS,
  type CommandType,
  type PartyCommand,
  type PartyCommandResult,
  type PartySnapshot,
  type PartyActivityId
} from './party-types';

type RecordValue = Record<string, unknown>;

function isRecord(value: unknown): value is RecordValue {
  return typeof value === 'object' && value !== null;
}

function hasOwn(value: RecordValue, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(value, key);
}

function finiteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function nonNegativeInteger(value: unknown): value is number {
  return finiteNumber(value) && Number.isInteger(value) && value >= 0;
}

export function isPartyActivityId(value: unknown): value is PartyActivityId {
  return typeof value === 'string' && (PARTY_ACTIVITY_IDS as readonly string[]).includes(value);
}

function isContributionValues(value: unknown): boolean {
  return isRecord(value) && Object.values(value).every(finiteNumber);
}

function isReward(value: unknown): boolean {
  return isRecord(value) && typeof value.id === 'string' && value.id.length > 0 &&
    nonNegativeInteger(value.expedition) && finiteNumber(value.pineLogs) && value.pineLogs >= 0 &&
    finiteNumber(value.cookedFish) && value.cookedFish >= 0;
}

function isMember(value: unknown): boolean {
  if (!isRecord(value)) return false;
  return typeof value.id === 'string' && value.id.length > 0 &&
    typeof value.name === 'string' && typeof value.type === 'string' && typeof value.affinity === 'string' &&
    isPartyActivityId(value.activity) && finiteNumber(value.efficiency) && value.efficiency >= 0 &&
    nonNegativeInteger(value.lastActivityTick) && isContributionValues(value.totals);
}

function isSnapshotEvent(value: unknown): boolean {
  return isRecord(value) && typeof value.text === 'string' && nonNegativeInteger(value.tick) && finiteNumber(value.at);
}

function isContributionSummary(value: unknown): boolean {
  return isRecord(value) && typeof value.id === 'string' && value.id.length > 0 &&
    typeof value.name === 'string' && isPartyActivityId(value.activity) && finiteNumber(value.total);
}

function isCanonicalSnapshot(value: unknown): value is PartySnapshot {
  if (!isRecord(value)) return false;
  const legacyKeys = ['connection', 'expeditionStatus', 'completedExpeditions', 'lanes', 'partyMembers', 'pendingRewards', 'claimedRewards', 'lastContributions'];
  if (legacyKeys.some(key => hasOwn(value, key))) return false;
  const party = value.party;
  const expedition = value.expedition;
  if (!nonNegativeInteger(value.revision) || !finiteNumber(value.generatedAt) || !finiteNumber(value.elapsedTicks) || !finiteNumber(value.lastResolvedAt)) return false;
  if (!isRecord(party) || typeof party.id !== 'string' || party.id.length === 0 || !Array.isArray(party.members) || !party.members.every(isMember)) return false;
  if (!isRecord(expedition) || !['active', 'paused', 'ready'].includes(String(expedition.status)) ||
    !nonNegativeInteger(expedition.completedExpeditions) || !isRecord(expedition.lanes) ||
    !LANE_IDS.every(lane => {
      const v = (expedition.lanes as Record<string, unknown>)[lane];
      return finiteNumber(v) && v >= 0;
    }) ||
    !isRecord(expedition.contributions) || !Object.values(expedition.contributions).every(isContributionValues) ||
    !(expedition.lastContributions === null || (Array.isArray(expedition.lastContributions) && expedition.lastContributions.every(isContributionSummary))) ||
    !(expedition.pendingRewards === null || isReward(expedition.pendingRewards)) ||
    !Array.isArray(expedition.claimedRewards) || !expedition.claimedRewards.every(reward => isReward(reward) && isRecord(reward) && finiteNumber(reward.claimedAt))) return false;
  return Array.isArray(value.recentEvents) && value.recentEvents.every(isSnapshotEvent) &&
    Array.isArray(value.notable) && value.notable.every(item => typeof item === 'string');
}

export function parsePartySnapshot(value: unknown): PartySnapshot | null {
  return isCanonicalSnapshot(value) ? value : null;
}

export function isPartySnapshot(value: unknown): value is PartySnapshot {
  return parsePartySnapshot(value) !== null;
}

function isCommandPayload(type: CommandType, payload: unknown): boolean {
  if (!isRecord(payload)) return false;
  if (type === COMMAND_TYPES.SET_ACTIVITY) return isPartyActivityId(payload.activityId) && Object.keys(payload).length === 1;
  if (type === COMMAND_TYPES.CLAIM_REWARD) return typeof payload.rewardId === 'string' && payload.rewardId.length > 0 && Object.keys(payload).length === 1;
  return Object.keys(payload).length === 0;
}

export function parsePartyCommand(value: unknown): PartyCommand | null {
  if (!isRecord(value) || typeof value.type !== 'string' || !(Object.values(COMMAND_TYPES) as string[]).includes(value.type)) return null;
  const type = value.type as CommandType;
  return typeof value.commandId === 'string' && value.commandId.length > 0 &&
    isCommandPayload(type, value.payload) && nonNegativeInteger(value.clientRevision) && finiteNumber(value.createdAt)
    ? value as unknown as PartyCommand : null;
}

export function isPartyCommand(value: unknown): value is PartyCommand {
  return parsePartyCommand(value) !== null;
}

export function parsePartyCommandResult(value: unknown): PartyCommandResult | null {
  if (!isRecord(value) || typeof value.commandId !== 'string' || value.commandId.length === 0) return null;
  if (value.status === 'confirmed') {
    return (value.snapshot === undefined || parsePartySnapshot(value.snapshot) !== null)
      ? value as unknown as PartyCommandResult : null;
  }
  if (value.status !== 'rejected' || !isRecord(value.error) || typeof value.error.code !== 'string' || typeof value.error.message !== 'string') return null;
  return value as unknown as PartyCommandResult;
}
