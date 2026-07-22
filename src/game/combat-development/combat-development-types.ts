import type { CombatProgressionState, CombatSkillId } from '../combat-progression';
import type { SkillTreeDefinition, SkillTreeState } from '../skills/skill-types';
import type { SoloCombatStance, TechniqueId, WeaponStyle } from '../solo-frontier/solo-frontier-types';

export const OFFENSE_COMBAT_SKILL_IDS = [
  'Strength',
  'Melee Accuracy',
  'Light Melee Weapon Proficiency',
  'Medium Melee Weapon Proficiency',
  'Heavy Melee Weapon Proficiency',
  'Marksmanship',
  'Ranged',
  'Offensive Magic'
] as const satisfies readonly CombatSkillId[];

export const SUSTAIN_COMBAT_SKILL_IDS = [
  'Support Magic', 'Reflexes', 'Healing', 'Vitality'
] as const satisfies readonly CombatSkillId[];

export const DEFENSE_COMBAT_SKILL_IDS = [
  'Light Armour Proficiency', 'Medium Armour Proficiency', 'Heavy Armour Proficiency', 'Evasion', 'Warding'
] as const satisfies readonly CombatSkillId[];

export type CombatSkillTreeStatus = 'authored' | 'planned-sustain' | 'planned-defense';

export interface CombatSkillTreeCatalogEntry {
  skillId: CombatSkillId;
  status: CombatSkillTreeStatus;
  release: 'v21.0' | 'v21.1' | 'v21.2';
  tree: SkillTreeDefinition | null;
}

export interface CombatDrillState {
  skillId: CombatSkillId | null;
  fractionalXp: number;
  totalXp: number;
}

export interface CombatDevelopmentState {
  drill: CombatDrillState;
  trees: Record<CombatSkillId, SkillTreeState>;
}

export interface CombatDevelopmentAdvanceResult {
  state: CombatDevelopmentState;
  progression: CombatProgressionState;
  xpAwarded: number;
  stoppedAtLevelCap: boolean;
}

export interface CombatEffectCondition {
  styles?: readonly WeaponStyle[];
  technique?: TechniqueId;
  stance?: SoloCombatStance;
  boss?: boolean;
  enemyWarded?: boolean;
  enemyHealthBelow?: number;
  enemyHealthAbove?: number;
  playerHealthAbove?: number;
  playerHealthBelow?: number;
  minimumHitChance?: number;
  minimumBaseInterval?: number;
  burning?: boolean;
  marked?: boolean;
  maximumShred?: boolean;
  bossOrWarded?: boolean;
}

export type CombatModifierStat =
  | 'damagePct'
  | 'accuracyFlat'
  | 'hitChanceBonus'
  | 'attackSpeedPct'
  | 'criticalChance'
  | 'criticalMultiplier'
  | 'techniqueDamagePct'
  | 'techniqueCooldownPct'
  | 'armourPenetration'
  | 'wardPenetration'
  | 'bossDamagePct'
  | 'hitChanceFloor'
  | 'stanceBonusPct'
  | 'stancePenaltyReductionPct'
  | 'criticalArmourPenetration'
  | 'criticalWardPenetration'
  | 'techniqueHitChanceBonus'
  | 'baseTechniqueCooldownPct';

export type CombatTrigger =
  | 'first-hit'
  | 'first-technique'
  | 'nth-action'
  | 'nth-hit'
  | 'after-miss'
  | 'after-enemy-miss'
  | 'after-damage'
  | 'health-threshold'
  | 'critical-hit'
  | 'critical-technique'
  | 'technique'
  | 'maximum-shred';

export type CombatTriggeredOutcome =
  | 'damage'
  | 'accuracy'
  | 'attack-speed'
  | 'repeat'
  | 'guarantee-hit'
  | 'guarantee-critical'
  | 'ready-technique'
  | 'reduce-technique-cooldown'
  | 'add-projectile'
  | 'consume-dot';

export type CombatSpecialEffect =
  | 'miss-conversion-every'
  | 'second-miss-converts'
  | 'miss-preserves-streak'
  | 'miss-removes-one-stack'
  | 'consume-exploit-stacks'
  | 'cull-once'
  | 'critical-consumes-dot'
  | 'ignore-armour'
  | 'ignore-ward'
  | 'minimum-hit-cap-bonus'
  | 'stance-bonus-amplifier'
  | 'stance-penalty-reducer'
  | 'critical-dot-double'
  | 'once-per-encounter';

export type CombatTreeEffectDefinition =
  | {
    id: string;
    skillId: CombatSkillId;
    kind: 'stat';
    stat: CombatModifierStat;
    value: number;
    condition?: CombatEffectCondition;
  }
  | {
    id: string;
    skillId: CombatSkillId;
    kind: 'trigger';
    trigger: CombatTrigger;
    outcome: CombatTriggeredOutcome;
    value: number;
    every?: number;
    limit?: number;
    count?: number;
    condition?: CombatEffectCondition;
  }
  | {
    id: string;
    skillId: CombatSkillId;
    kind: 'streak';
    damagePerStack: number;
    maxStacks: number;
    resetOnDamage?: boolean;
    missBehavior?: 'reset' | 'remove-one' | 'preserve';
    condition?: CombatEffectCondition;
  }
  | {
    id: string;
    skillId: CombatSkillId;
    kind: 'shred';
    amount: number;
    maximum: number;
    techniqueOnly?: boolean;
    condition?: CombatEffectCondition;
  }
  | {
    id: string;
    skillId: CombatSkillId;
    kind: 'dot';
    dot: 'bleed' | 'burn';
    damagePct: number;
    durationSeconds: number;
    maximumStacks: number;
    criticalMultiplier?: number;
    condition?: CombatEffectCondition;
  }
  | {
    id: string;
    skillId: CombatSkillId;
    kind: 'mark';
    damagePct: number;
    bossDamagePct?: number;
    condition?: CombatEffectCondition;
  }
  | {
    id: string;
    skillId: CombatSkillId;
    kind: 'special';
    special: CombatSpecialEffect;
    value: number;
    condition?: CombatEffectCondition;
  };

export interface CombatModifierSnapshot {
  effectIds: readonly string[];
  effects: readonly CombatTreeEffectDefinition[];
  static: Readonly<Record<CombatModifierStat, number>>;
}
