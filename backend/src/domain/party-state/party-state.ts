export const PARTY_ACTIVITY_KIND = 'expedition' as const;
export const PARTY_ACTIVITY_DESTINATIONS = ['forest'] as const;
export const PARTY_MEMBER_ACTIVITY_IDS = ['forest_patrol', 'pine_chopping', 'camp_cooking', 'rest'] as const;
export type PartyMemberActivityId = (typeof PARTY_MEMBER_ACTIVITY_IDS)[number];

export const EXPEDITION_SLOT_IDS = ['slot-1', 'slot-2', 'slot-3', 'slot-4'] as const;
export type ExpeditionSlotId = (typeof EXPEDITION_SLOT_IDS)[number];

export type PartyActivityStatus = 'idle' | 'active' | 'completed';
export type PartyActivityDestination = (typeof PARTY_ACTIVITY_DESTINATIONS)[number];

export interface PartyState {
  partyId: string;
  revision: number;
  activity: {
    kind: typeof PARTY_ACTIVITY_KIND;
    status: PartyActivityStatus;
    destination: PartyActivityDestination | null;
    startedAt: Date | null;
    completesAt: Date | null;
  };
  contributions: Record<string, number>;
  memberActivities: Record<string, PartyMemberActivityId>;
  pendingRewards: Record<string, PartyReward[]>;
  expedition: PartyExpeditionState;
  updatedAt: Date;
}

export interface PartyExpeditionAssignment {
  slotId: ExpeditionSlotId;
  playerId: string;
  roleId: string;
  targetId: string | null;
  active: boolean;
  assignedAt: Date;
  disconnectedAt: Date | null;
}

export interface PartyExpeditionState {
  expeditionId: string;
  assignments: PartyExpeditionAssignment[];
  forecast: {
    successPercent: number;
    dangerPercent: number;
    roleCoveragePercent: number;
    farmingMultiplier: number;
  } | null;
}

export interface PartyReward {
  id: string;
  primaryActivity: PartyMemberActivityId;
  primaryXp: number;
  partyXp: Partial<Record<PartyMemberActivityId, number>>;
  rewards: {
    bossKeys: number;
    pineLogs: number;
    cookedFish: number;
    game: number;
  };
  expeditionLedger?: {
    expeditionId: string;
    outcome: 'completed' | 'failed';
    farmingRewards: Record<string, number>;
    completionRewards: Record<string, number>;
    completionTierId: string | null;
    status: 'pending' | 'preserved-on-failure';
    successPercent: number;
    dangerPercent: number;
  };
}

export interface PartyStateCommandInput {
  commandId: string;
  expectedRevision: number;
  command: {
    type: string;
    destination?: unknown;
    expeditionId?: unknown;
    assignments?: unknown;
    amount?: unknown;
    activityId?: unknown;
    rewardId?: unknown;
    slotId?: unknown;
    roleId?: unknown;
    targetId?: unknown;
  };
}

export type PartyStateErrorCode =
  | 'not_authenticated'
  | 'not_in_party'
  | 'party_refresh_required'
  | 'not_party_leader'
  | 'invalid_command'
  | 'invalid_destination'
  | 'invalid_contribution'
  | 'invalid_activity'
  | 'invalid_expedition'
  | 'invalid_assignment'
  | 'assignment_not_allowed'
  | 'expedition_not_active'
  | 'activity_not_idle'
  | 'activity_not_active'
  | 'activity_not_completed'
  | 'reward_not_available'
  | 'revision_conflict'
  | 'duplicate_command_mismatch'
  | 'rate_limited'
  | 'internal_error';

export class PartyStateError extends Error {
  constructor(
    public readonly code: PartyStateErrorCode,
    message: string
  ) {
    super(message);
    this.name = 'PartyStateError';
  }
}

export interface PartyCommandResult {
  commandId: string;
  accepted: boolean;
  resultingRevision: number | null;
  currentRevision: number;
  errorCode: PartyStateErrorCode | null;
  state: PartyState;
  memberPlayerIds: string[];
  reconciled: boolean;
  duplicate: boolean;
}
