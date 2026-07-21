import { COMBAT_SKILL_IDS, type CombatSkillId } from '../combat-progression';

/** @deprecated Prefer COMBAT_SKILL_IDS from combat-progression. */
export const COMPONENT_COMBAT_SKILL_IDS = COMBAT_SKILL_IDS;
export type ComponentCombatSkillId = CombatSkillId;
export type CombatSkillMap = Partial<Record<ComponentCombatSkillId, number>>;
export type ExpeditionKind = 'cooking' | 'combat';
export type ExpeditionStatus = 'idle' | 'active' | 'completed' | 'failed';
export type ExpeditionFailureMode = 'hard' | 'quality';

export interface GearSnapshot {
  id: string;
  name?: string;
  slot: 'weapon' | 'armor' | 'accessory' | 'tool' | 'food';
  power?: number;
  defense?: number;
  tags?: readonly string[];
  affixes?: readonly AffixSnapshot[];
}

export interface AffixSnapshot {
  id: string;
  stat: string;
  value: number;
  tags?: readonly string[];
}

export interface PlayerProfileSnapshot {
  playerId: string;
  displayName?: string;
  /** New component combat progression. Values are levels, not client forecasts. */
  combatSkills: CombatSkillMap;
  /** Existing non-combat skill levels used by cooking roles. */
  skills?: Readonly<Record<string, number>>;
  gold: number;
  gear: readonly GearSnapshot[];
  equippedGearIds: readonly string[];
  talents: readonly string[];
  loadout: {
    weaponStyle?: 'melee' | 'gun' | 'ranged' | 'magic' | 'support';
    weaponWeight?: 'light' | 'medium' | 'heavy';
    armourWeight?: 'light' | 'medium' | 'heavy';
    gearIds?: readonly string[];
  };
  progression?: Readonly<Record<string, number | string | boolean>>;
  /** Used by server-side target validation and by local balancing previews. */
  unlockedTargetIds?: readonly string[];
  /** Optional legacy Combat level for one-time save conversion. */
  legacyCombatLevel?: number;
}

export interface DerivedCombatProfile {
  playerId: string;
  componentSkills: Record<ComponentCombatSkillId, number>;
  combatRating: number;
  defenseRating: number;
  skillScore: number;
  gearScore: number;
  defenseGearScore: number;
  affixScore: number;
  talentScore: number;
  loadoutScore: number;
  armourWeight: 'light' | 'medium' | 'heavy' | 'none';
  tags: readonly string[];
}

export interface ExpeditionTargetDefinition {
  id: string;
  name: string;
  materialId: string;
  requiredRoleId?: string;
  requiredSkillId?: string;
  requiredSkillLevel?: number;
  preferredTags?: readonly string[];
  dangerModifier?: number;
}

export interface ExpeditionRoleDefinition {
  id: string;
  name: string;
  shortName?: string;
  description: string;
  skillWeights: Readonly<Record<string, number>>;
  /** Optional style-aware override used by combat DPS without changing the expedition protocol. */
  skillWeightsByWeaponStyle?: Readonly<Record<string, Readonly<Record<string, number>>>>;
  derivedWeights?: Readonly<Partial<Record<'combatRating' | 'defenseRating' | 'skillScore' | 'gearScore' | 'defenseGearScore' | 'affixScore' | 'talentScore' | 'loadoutScore', number>>>;
  preferredGearTags?: readonly string[];
  requiredGearTags?: readonly string[];
  requiredTalentIds?: readonly string[];
  farmingWeight: number;
  completionWeight: number;
  dangerReduction: number;
  targetIds?: readonly string[];
}

export interface ExpeditionPhaseDefinition {
  id: string;
  name: string;
  durationRatio: number;
  farmingMultiplier: number;
  completionWeight: number;
  dangerWeight: number;
}

export interface ExpeditionRewardTier {
  id: string;
  label: string;
  minimumSuccess: number;
  resources: Readonly<Record<string, number>>;
  gold?: number;
}

export interface ExpeditionDefinition {
  id: string;
  name: string;
  kind: ExpeditionKind;
  description: string;
  durationMs: number;
  slotCount: 4;
  allowDuplicateRoles: boolean;
  failureMode: ExpeditionFailureMode;
  roles: readonly ExpeditionRoleDefinition[];
  phases: readonly ExpeditionPhaseDefinition[];
  targets: readonly ExpeditionTargetDefinition[];
  farmingRewards: Readonly<Record<string, number>>;
  completionRewards: readonly ExpeditionRewardTier[];
  baseSuccess: number;
  baseDanger: number;
  maxDanger: number;
}

export interface ExpeditionAssignment {
  slotId: string;
  playerId: string;
  roleId: string;
  targetId?: string | null;
  active: boolean;
  assignedAt: string;
}

export interface RoleFitScore {
  roleId: string;
  playerId: string;
  score: number;
  skillScore: number;
  derivedScore: number;
  gearScore: number;
  requirementScore: number;
  requirementsMet: boolean;
  missingRequirements: readonly string[];
  targetId: string | null;
  targetRequirementMet: boolean;
  slotEfficiency: number;
}

export interface ExpeditionRewardForecast {
  resources: Readonly<Record<string, number>>;
  completionTiers: readonly ExpeditionRewardTier[];
  farmingMultiplier: number;
  soloEfficiency: number;
}

export interface ExpeditionForecast {
  successPercent: number;
  dangerPercent: number;
  roleCoveragePercent: number;
  averageRoleFit: number;
  duplicateRolePenalty: number;
  soloEfficiency: number;
  assignments: readonly (ExpeditionAssignment & { fit: RoleFitScore })[];
  reward: ExpeditionRewardForecast;
  warnings: readonly string[];
}

export interface ExpeditionRewardLedger {
  id: string;
  missionId: string;
  farmingByPlayer: Readonly<Record<string, Readonly<Record<string, number>>>>;
  completionByPlayer: Readonly<Record<string, Readonly<Record<string, number>>>>;
  completionTierId: string | null;
  status: 'pending' | 'claimed' | 'preserved-on-failure';
  generatedAt: string;
}

export interface ExpeditionSnapshot {
  missionId: string;
  definitionId: string;
  status: ExpeditionStatus;
  startedAt: string | null;
  completesAt: string | null;
  assignments: readonly ExpeditionAssignment[];
  forecast: ExpeditionForecast | null;
  farmingLedger: ExpeditionRewardLedger | null;
  completionLedger: ExpeditionRewardLedger | null;
  updatedAt: string;
  serverTimestamp: number;
}

export interface ExpeditionOutcome {
  status: 'completed' | 'failed';
  forecast: ExpeditionForecast;
  farmingLedger: ExpeditionRewardLedger;
  completionLedger: ExpeditionRewardLedger | null;
}
