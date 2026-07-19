export const PARTY_ACTIVITY_KIND = 'expedition' as const;
export const PARTY_ACTIVITY_DESTINATIONS = ['forest'] as const;
export const PARTY_MEMBER_ACTIVITY_IDS = ['forest_patrol', 'pine_chopping', 'camp_cooking', 'rest'] as const;
export type PartyMemberActivityId = (typeof PARTY_MEMBER_ACTIVITY_IDS)[number];

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
  updatedAt: Date;
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
}

export interface PartyStateCommandInput {
  commandId: string;
  expectedRevision: number;
  command: {
    type: string;
    destination?: unknown;
    amount?: unknown;
    activityId?: unknown;
    rewardId?: unknown;
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
