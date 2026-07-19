export type SkillFamily =
  | 'gathering'
  | 'processing'
  | 'fabrication'
  | 'combat'
  | 'technical'
  | 'social'
  | 'challenge';

export type SkillMode = 'idle' | 'active' | 'hybrid';

export type ResourceMap = Record<string, number>;

export interface SkillState {
  id: string;
  level: number;
  xp: number;
  nextXp: number;
  active: boolean;
  progress: number;
  quantity: number;
  specializationId: string | null;
  selectedToolId?: string | null;
}

export interface SkillActionContext {
  skill: SkillState;
  resources: Readonly<ResourceMap>;
  mode: 'idle' | 'active';
  activeMultiplier: number;
  random: () => number;
}

export interface SkillActionResult {
  accepted: boolean;
  reason?: string;
  consumed: ResourceMap;
  produced: ResourceMap;
  xp: number;
  activeMultiplier: number;
  events: string[];
}

export interface SkillDefinition {
  id: string;
  name: string;
  family: SkillFamily;
  mode: SkillMode;
  baseActionsPerSecond: number;
  xpPerAction: number;
  activeActivityId: string | null;
  idleInputs?: ResourceMap;
  idleOutputs?: ResourceMap;
  unlocks?: readonly string[];
  resolveAction?: (context: SkillActionContext) => SkillActionResult;
}

export interface RecipeDefinition {
  id: string;
  name: string;
  skillId: string;
  inputs: ResourceMap;
  outputs: ResourceMap;
  requiredLevel: number;
  equipmentId?: string;
  skillToolId?: string;
  kind?: 'equipment' | 'skillTool';
  description?: string;
}

export interface ActiveSkillActivity {
  id: string;
  skillId: string;
  name: string;
  durationMs: number;
  maxBonusMultiplier: number;
  scoreToMultiplier: (score: number) => number;
}

export interface SkillTreeNode {
  id: string;
  skillId: string;
  branch: string;
  tier: number;
  name: string;
  description: string;
  requires: readonly string[];
  exclusiveWith?: readonly string[];
  /** One point is the default cost for existing Combat Discipline nodes. */
  cost?: number;
  /** Named exclusivity group, such as a Tier II fork. */
  exclusiveGroup?: string;
  /** Legacy alias retained for Combat Discipline and existing presets. */
  fork?: string;
  capstone?: boolean;
  icon?: SkillTreeNodeIcon;
  position?: SkillTreeNodePosition;
  effectIds?: readonly string[];
}

export interface SkillTreeNodeIcon {
  sheet: 'skill' | 'resource' | 'loadout';
  key: string;
  fallback: string;
}

export interface SkillTreeNodePosition {
  x: number;
  y: number;
}

export interface SkillTreeEdge {
  id: string;
  from: string;
  to: string;
  kind?: 'prerequisite' | 'branch';
}

export interface SkillTreeBranch {
  id: string;
  name: string;
  description: string;
  color: string;
}

export interface SkillTreeDefinition {
  id: string;
  name: string;
  skillId: string;
  currencyLabel: string;
  description: string;
  branches: readonly SkillTreeBranch[];
  nodes: readonly SkillTreeNode[];
  edges: readonly SkillTreeEdge[];
  rootNodeIds: readonly string[];
  viewBox: { width: number; height: number };
}

export type SkillTreeNodeState = 'locked' | 'available' | 'owned';

export interface SkillTreeViewState {
  zoom: number;
  panX: number;
  panY: number;
  focusNodeId: string | null;
  activeBranch: string | null;
}

/** Persisted allocation and presentation state for a data-driven skill tree. */
export interface SkillTreeState {
  treeId: string;
  ownedNodeIds: readonly string[];
  view: SkillTreeViewState;
}

export interface SkillSpecializationNode {
  id: string;
  skillId: string;
  name: string;
  description: string;
  requiredLevel: number;
}
