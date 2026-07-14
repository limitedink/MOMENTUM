export const CONNECTION_STATES = {
  DISCONNECTED: 'disconnected',
  CONNECTING: 'connecting',
  CONNECTED: 'connected',
  RECONNECTING: 'reconnecting',
  ERROR: 'error'
} as const;

export type ConnectionState = (typeof CONNECTION_STATES)[keyof typeof CONNECTION_STATES];

export const COMMAND_TYPES = {
  SET_ACTIVITY: 'SET_ACTIVITY',
  START_EXPEDITION: 'START_EXPEDITION',
  PAUSE_EXPEDITION: 'PAUSE_EXPEDITION',
  RESUME_EXPEDITION: 'RESUME_EXPEDITION',
  CLAIM_REWARD: 'CLAIM_REWARD',
  REQUEST_SNAPSHOT: 'REQUEST_SNAPSHOT'
} as const;

export type CommandType = (typeof COMMAND_TYPES)[keyof typeof COMMAND_TYPES];
export type CommandStatus = 'idle' | 'pending' | 'confirmed' | 'rejected';
export type PartyActivityId = 'forest_patrol' | 'pine_chopping' | 'camp_cooking' | 'rest';
export type LaneId = 'threat' | 'timber' | 'supplies';

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
  type: 'human' | 'ghost' | string;
  affinity: 'balanced' | 'timber' | 'supplies' | 'patrol' | string;
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
  status: 'active' | 'paused' | 'ready' | string;
  completedExpeditions: number;
  lanes: Record<LaneId, number>;
  contributions: Record<string, ContributionValues>;
  lastContributions: ContributionSummary[] | null;
  pendingRewards: PendingReward | null;
  claimedRewards: ClaimedReward[];
}

export interface PartySnapshot {
  revision: number;
  generatedAt: number;
  connection: {
    status: ConnectionState;
    lastConfirmedAt: number;
  };
  party: Party;
  expedition: Expedition;
  recentEvents: PartyEvent[];
  notable: string[];
  elapsedTicks: number;
  lastResolvedAt: number;
  // Legacy aliases are retained by the local transport for compatibility.
  expeditionStatus?: Expedition['status'];
  completedExpeditions?: number;
  lanes?: Record<LaneId, number>;
  partyMembers?: PartyMember[];
  pendingRewards?: PendingReward | null;
  claimedRewards?: ClaimedReward[];
  lastContributions?: ContributionSummary[] | null;
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

export interface PartyStoreState {
  snapshot: PartySnapshot;
  acceptedRevision: number;
  connection: { status: ConnectionState; lastConfirmedAt: number };
  pendingCommands: PendingCommand[];
  commandStates: Partial<Record<CommandType, PendingCommand | SettledCommand>>;
  commandErrors: Array<CommandError & { commandId: string; type: CommandType; at: number }>;
}

export interface PartySnapshotStore {
  acceptSnapshot(snapshot: PartySnapshot): SnapshotAcceptance;
  applyCommandResult(result: PartyCommandResult): CommandResolution;
  beginCommand(command: PartyCommand): string | null;
  getAcceptedRevision(): number;
  getCommandState(type: CommandType): PendingCommand | SettledCommand | { type: CommandType; status: 'idle' };
  getState(): PartyStoreState;
  getSnapshot(): PartySnapshot;
  rejectPendingCommands(code: string, message: string): number;
  setConnection(status: ConnectionState): boolean;
  subscribe(listener: (state: PartyStoreState, reason: string) => void): Unsubscribe;
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

export interface MomentumPartyTransport {
  connect(): boolean;
  disconnect(): boolean;
  getConnectionState(): ConnectionState;
  requestSnapshot(): PartySnapshot;
  submitCommand(command: PartyCommand): boolean;
  subscribeToSnapshots(listener: SnapshotListener): Unsubscribe;
  subscribeToConnection(listener: ConnectionListener): Unsubscribe;
  subscribeToCommandResults(listener: CommandResultListener): Unsubscribe;
  destroy(): void;
}

export interface ActivityDefinition {
  name: string;
  icon: string;
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

export interface MomentumPartySyncFacade {
  getSnapshot(): PartySnapshot;
  getStoreState(): PartyStoreState;
  getCommandState(type: string): PendingCommand | SettledCommand | { type: CommandType; status: 'idle' };
  getTransportState(): { status: ConnectionState; recentResults: PartyCommandResult[] };
  requestSnapshot(): PartySnapshot;
  setActivity(activityId: PartyActivityId): boolean;
  startExpedition(): boolean;
  pauseExpedition(): boolean;
  resumeExpedition(): boolean;
  toggleExpedition(): boolean;
  claimReward(): boolean;
  resolveElapsed(): number;
  simulateReconnect(): boolean;
  getConnectionState(): ConnectionState;
  runSnapshotVerification(): { passed: boolean; checks: Array<{ name: string; passed: boolean }>; failures: string[] };
}

declare global {
  interface Window {
    MomentumPartyTransport: PartyTransportApi;
    LocalMomentumPartyTransport: (options?: { commandDelay?: number; connectDelay?: number; storage?: Storage }) => MomentumPartyTransport & {
      resolveElapsed(): number;
      simulateTick(): boolean;
    };
    MomentumPartyStore: { createPartySnapshotStore: typeof import('./party-store').createPartySnapshotStore };
    MomentumPartyController: { createPartyCommandController: typeof import('./party-controller').createPartyCommandController };
    MomentumPartySync: MomentumPartySyncFacade;
  }
}
