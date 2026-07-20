export const CONNECTION_STATES = {
  DISCONNECTED: 'disconnected',
  CONNECTING: 'connecting',
  CONNECTED: 'connected',
  RECONNECTING: 'reconnecting',
  ERROR: 'error'
} as const;

export type ConnectionState = (typeof CONNECTION_STATES)[keyof typeof CONNECTION_STATES];

export const RECONNECT_STATES = {
  IDLE: 'idle',
  CONNECTING: 'connecting',
  RECONNECTING: 'reconnecting'
} as const;

export type ReconnectState = (typeof RECONNECT_STATES)[keyof typeof RECONNECT_STATES];

export const COMMAND_TYPES = {
  SET_ACTIVITY: 'SET_ACTIVITY',
  START_EXPEDITION: 'START_EXPEDITION',
  PAUSE_EXPEDITION: 'PAUSE_EXPEDITION',
  RESUME_EXPEDITION: 'RESUME_EXPEDITION',
  CLAIM_REWARD: 'CLAIM_REWARD',
  REQUEST_SNAPSHOT: 'REQUEST_SNAPSHOT'
} as const;

export type CommandType = (typeof COMMAND_TYPES)[keyof typeof COMMAND_TYPES];
export const PARTY_ACTIVITY_IDS = ['forest_patrol', 'pine_chopping', 'camp_cooking', 'rest'] as const;
export type PartyActivityId = (typeof PARTY_ACTIVITY_IDS)[number];
export const LANE_IDS = ['threat', 'timber', 'supplies'] as const;
export type LaneId = (typeof LANE_IDS)[number];
export type CommandStatus = 'idle' | 'pending' | 'confirmed' | 'rejected';

export interface CommandError {
  code: string;
  message: string;
}

export type CommandPayloadMap = {
  SET_ACTIVITY: { activityId: PartyActivityId };
  START_EXPEDITION: Record<string, never>;
  PAUSE_EXPEDITION: Record<string, never>;
  RESUME_EXPEDITION: Record<string, never>;
  CLAIM_REWARD: { rewardId: string };
  REQUEST_SNAPSHOT: Record<string, never>;
};

export type CommandEnvelope<T extends CommandType = CommandType> = {
  commandId: string;
  type: T;
  payload: CommandPayloadMap[T];
  clientRevision: number;
  createdAt: number;
};

export type PartyCommand = {
  [T in CommandType]: CommandEnvelope<T>;
}[CommandType];

export type PendingCommand = PartyCommand & {
  status: 'pending';
  submittedAt: number;
};

export type SettledCommand = PartyCommand & {
  status: 'confirmed' | 'rejected';
  submittedAt: number;
  settledAt: number;
  error?: CommandError;
  snapshotRevision?: number | null;
};

export interface ContributionValues {
  [lane: string]: number;
}

export interface ContributionSummary {
  id: string;
  name: string;
  activity: PartyActivityId;
  total: number;
}

export interface PendingReward {
  id: string;
  expedition: number;
  pineLogs: number;
  cookedFish: number;
}

export interface ClaimedReward extends PendingReward {
  claimedAt: number;
}

export interface PartyEvent {
  text: string;
  tick: number;
  at: number;
}

export interface PartyMember {
  id: string;
  name: string;
  type: string;
  affinity: string;
  activity: PartyActivityId;
  efficiency: number;
  lastActivityTick: number;
  totals: ContributionValues;
}

export interface Party {
  id: string;
  members: PartyMember[];
}

export interface Expedition {
  status: 'active' | 'paused' | 'ready';
  completedExpeditions: number;
  lanes: Record<LaneId, number>;
  contributions: Record<string, ContributionValues>;
  lastContributions: ContributionSummary[] | null;
  pendingRewards: PendingReward | null;
  claimedRewards: ClaimedReward[];
}

/** The only server-owned state rendered by the client. */
export interface PartySnapshot {
  revision: number;
  generatedAt: number;
  party: Party;
  expedition: Expedition;
  recentEvents: PartyEvent[];
  notable: string[];
  elapsedTicks: number;
  lastResolvedAt: number;
}

export type ConfirmedCommandResult = {
  commandId: string;
  status: 'confirmed';
  snapshot?: PartySnapshot;
};

export type RejectedCommandResult = {
  commandId: string;
  status: 'rejected';
  error: CommandError;
};

export type PartyCommandResult = ConfirmedCommandResult | RejectedCommandResult;
export type SnapshotListener = (snapshot: PartySnapshot) => void;
export type ConnectionListener = (status: ConnectionState) => void;
export type CommandResultListener = (result: PartyCommandResult) => void;
export type Unsubscribe = () => void;

export interface PartySessionIdentity {
  authenticatedPlayerId: string;
  currentPartyId: string | null;
}

export interface PartySnapshotStoreState {
  snapshot: PartySnapshot;
  acceptedRevision: number;
}

export interface SnapshotAcceptance {
  accepted: boolean;
  reason?: 'invalid' | 'duplicate' | 'stale';
  revision?: number;
  error?: string;
}

export interface CommandResolution {
  matched: boolean;
  reason?: 'invalid' | 'unknown';
  status?: 'confirmed' | 'rejected';
  snapshotResult?: SnapshotAcceptance | null;
}

export interface PartySnapshotStore {
  acceptSnapshot(snapshot: unknown): SnapshotAcceptance;
  getAcceptedRevision(): number;
  getState(): PartySnapshotStoreState;
  getSnapshot(): PartySnapshot;
  subscribe(listener: (state: PartySnapshotStoreState, reason: string) => void): Unsubscribe;
}

export interface ClientSessionState {
  connection: {
    status: ConnectionState;
    lastConfirmedAt: number | null;
  };
  reconnectState: ReconnectState;
  authenticatedPlayerId: string;
  currentPartyId: string | null;
  pendingCommands: PendingCommand[];
  commandStates: Partial<Record<CommandType, PendingCommand | SettledCommand>>;
  commandErrors: Array<CommandError & { commandId: string; type: CommandType; at: number }>;
  lastAcceptedRevision: number;
  latencyMs: number | null;
}

export interface ClientSession {
  acceptSnapshot(snapshot: unknown): SnapshotAcceptance;
  applyCommandResult(result: unknown): CommandResolution;
  beginCommand(command: PartyCommand): string | null;
  getCommandState(type: CommandType): PendingCommand | SettledCommand | { type: CommandType; status: 'idle' };
  getSnapshot(): PartySnapshot;
  getState(): ClientSessionState;
  rejectPendingCommands(code: string, message: string): number;
  setConnection(status: ConnectionState): boolean;
  subscribe(listener: (state: ClientSessionState, reason: string) => void): Unsubscribe;
}

export interface MomentumPartyTransport {
  connect(): Promise<boolean>;
  disconnect(): Promise<boolean>;
  getConnectionState(): Promise<ConnectionState>;
  getSessionIdentity(): Promise<PartySessionIdentity>;
  requestSnapshot(): Promise<PartySnapshot>;
  submitCommand(command: PartyCommand): Promise<boolean>;
  subscribeToSnapshots(listener: SnapshotListener): Unsubscribe;
  subscribeToConnection(listener: ConnectionListener): Unsubscribe;
  subscribeToCommandResults(listener: CommandResultListener): Unsubscribe;
  destroy(): Promise<void>;
}

/**
 * Server-authoritative party state is deliberately separate from the legacy
 * LocalPartyTransport snapshot until the client transport migration milestone.
 */
export interface AuthoritativePartyState {
  partyId: string;
  revision: number;
  activity: {
    kind: 'expedition';
    status: 'idle' | 'active' | 'completed';
    destination: 'forest' | null;
    startedAt: string | null;
    completesAt: string | null;
  };
  contributions: Record<string, number>;
  memberActivities: Record<string, PartyActivityId>;
  pendingRewards: Record<string, PartyReward[]>;
  updatedAt: string;
  serverTimestamp: number;
}

export interface PartyReward {
  id: string;
  primaryActivity: PartyActivityId;
  primaryXp: number;
  partyXp: Partial<Record<PartyActivityId, number>>;
  rewards: {
    bossKeys: number;
    pineLogs: number;
    cookedFish: number;
    game: number;
  };
}

export interface ActivityDefinition {
  name: string;
  rosterName: string;
  icon: string;
  rewardFocus: string;
  output: Partial<Record<LaneId, number>>;
}

export interface LaneDefinition {
  id: LaneId;
  name: string;
  target: number;
  color: string;
}

export interface PartyTransportApi {
  readonly CONNECTION_STATES: typeof CONNECTION_STATES;
  readonly COMMAND_TYPES: typeof COMMAND_TYPES;
  readonly DEFINITIONS: {
    lanes: readonly LaneDefinition[];
    activities: Readonly<Record<PartyActivityId, ActivityDefinition>>;
  };
  assertTransport(transport: unknown): MomentumPartyTransport;
  clone<T>(value: T): T;
  createCommandEnvelope(type: CommandType, payload: CommandPayloadMap[CommandType], clientRevision?: number): PartyCommand;
  createCommandResult(commandId: string, status: 'confirmed' | 'rejected', value?: PartySnapshot | Partial<CommandError>): PartyCommandResult;
  isCommandEnvelope(value: unknown): value is PartyCommand;
  normalizeCommandType(type: unknown): CommandType | null;
}

export interface PartyClientState {
  snapshot: PartySnapshot;
  session: ClientSessionState;
}

export interface MomentumPartyClient {
  initialize(): Promise<boolean>;
  connect(): Promise<boolean>;
  disconnect(): Promise<boolean>;
  reconnect(): Promise<boolean>;
  destroy(): Promise<void>;
  getSnapshot(): PartySnapshot;
  getState(): PartyClientState;
  getSessionState(): ClientSessionState;
  getCommandState(type: string): PendingCommand | SettledCommand | { type: CommandType; status: 'idle' };
  getConnectionState(): ConnectionState;
  requestSnapshot(): Promise<PartySnapshot>;
  setActivity(activityId: PartyActivityId): Promise<boolean>;
  startExpedition(): Promise<boolean>;
  pauseExpedition(): Promise<boolean>;
  resumeExpedition(): Promise<boolean>;
  toggleExpedition(): Promise<boolean>;
  claimReward(rewardId?: string): Promise<boolean>;
  subscribe(listener: (state: PartyClientState, reason: string) => void): Unsubscribe;
}

export interface PartyTransportRuntimeApi {
  readonly client: MomentumPartyClient;
}

declare global {
  interface Window {
    MomentumSkillFramework: typeof import('../game/skills').MomentumSkillFramework;
    MomentumLootFramework: typeof import('../game/loot').momentumLootFramework;
    MomentumWorldFramework: typeof import('../game/world').MomentumWorldFramework;
    MomentumPartyTransport: PartyTransportApi;
    LocalMomentumPartyTransport: (options?: { commandDelay?: number; connectDelay?: number; authenticatedPlayerId?: string; storage?: Storage }) => MomentumPartyTransport & {
      resolveElapsed(): number;
      simulateTick(): boolean;
    };
    MomentumPartyRuntime: import('./party-runtime').PartyRuntime;
    MomentumPartySync: import('./party-runtime').PartyRuntime;
    MomentumPartyStore: {
      createPartySnapshotStore: (initialSnapshot: PartySnapshot) => PartySnapshotStore;
      isPartySnapshot: (value: unknown) => value is PartySnapshot;
    };
  }
}
