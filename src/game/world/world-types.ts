export type WorldRunStatus = 'outpost' | 'ready' | 'in_encounter' | 'reward' | 'complete' | 'failed';

export type WorldEncounterKind = 'gathering' | 'preparation' | 'choice' | 'combat' | 'boss';

export type WorldRequirement =
  | { type: 'skillLevel'; skillId: string; level: number }
  | { type: 'resource'; resourceId: string; amount: number }
  | { type: 'equipment'; slot: string }
  | { type: 'arenaTier'; tierId: number }
  | { type: 'completedNode'; nodeId: string };

export interface WorldRouteDefinition {
  id: string;
  name: string;
  summary: string;
  accent: string;
  encounterId: string;
}

export interface WorldReward {
  resources?: Record<string, number>;
  skillXp?: Record<string, number>;
  mastery?: number;
  lootSource?: {
    sourceType: 'arenaBoss' | 'partyBoss';
    sourceId: string;
    sourceTier: number;
  };
}

export interface WorldEncounterDefinition {
  id: string;
  name: string;
  kind: WorldEncounterKind;
  routeId: string;
  summary: string;
  requirements?: readonly WorldRequirement[];
  nextNodeId: string;
  reward: WorldReward;
  activeActivity?: 'fishing' | 'crafting';
  arenaTierId?: number;
  safeNode?: boolean;
}

export interface WorldNodeDefinition {
  id: string;
  name: string;
  description: string;
  routeId: string | null;
  encounterId: string | null;
  safe: boolean;
}

export interface WorldMasteryDefinition {
  id: string;
  name: string;
  description: string;
  target: number;
}

export interface RegionDefinition {
  id: string;
  name: string;
  summary: string;
  outpostNodeId: string;
  routes: readonly WorldRouteDefinition[];
  nodes: readonly WorldNodeDefinition[];
  encounters: readonly WorldEncounterDefinition[];
  mastery: readonly WorldMasteryDefinition[];
}

export interface PendingWorldReward {
  id: string;
  runId: string;
  encounterId: string;
  reward: WorldReward;
  nextNodeId: string;
  completesRegion: boolean;
}

export interface WorldState {
  version: 1;
  regionId: string;
  runId: string | null;
  status: WorldRunStatus;
  currentNodeId: string;
  selectedRouteId: string | null;
  activeEncounterId: string | null;
  lastSafeNodeId: string;
  completedNodeIds: string[];
  completedEncounterIds: string[];
  mastery: Record<string, number>;
  routeHistory: string[];
  pendingReward: PendingWorldReward | null;
  claimedRewardIds: string[];
  lastOutcome: 'success' | 'failure' | 'abandoned' | null;
  lastUpdatedAt: number;
}

export interface WorldEvaluation {
  met: boolean;
  missing: string[];
}

export interface WorldOutcome {
  runId: string;
  encounterId: string;
  success: boolean;
  seed?: number;
}

export interface WorldActionResult {
  accepted: boolean;
  state: WorldState;
  reason?: string;
  encounter?: WorldEncounterDefinition;
  pendingReward?: PendingWorldReward | null;
}

export interface WorldRuntimeOptions {
  now?: () => number;
  createRunId?: () => string;
  evaluateRequirements?: (requirements: readonly WorldRequirement[], state: WorldState) => WorldEvaluation;
}
