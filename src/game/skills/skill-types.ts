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
  capstone?: boolean;
}

export interface SkillSpecializationNode {
  id: string;
  skillId: string;
  name: string;
  description: string;
  requiredLevel: number;
}
