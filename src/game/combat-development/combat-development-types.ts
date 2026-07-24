import type { CombatProgressionState, CombatSkillId } from '../combat-progression';
import type { SkillTreeDefinition, SkillTreeState } from '../skills/skill-types';
import type {
  ArmourClass,
  AuraId,
  DefensiveAbilityId,
  DamageType,
  EnemyAttackTag,
  SoloCombatStance,
  TechniqueId,
  WeaponStyle
} from '../solo-frontier/solo-frontier-types';

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

export type CombatSkillTreeStatus = 'authored' | 'planned-defense';

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
  armourClass?: ArmourClass;
  minimumArmourPieces?: number;
  damageType?: DamageType;
  enemyAttackTag?: EnemyAttackTag;
  barrierActive?: boolean;
  barrierBroken?: boolean;
  styles?: readonly WeaponStyle[];
  technique?: TechniqueId;
  stance?: SoloCombatStance;
  aura?: AuraId;
  defensiveAbility?: DefensiveAbilityId;
  boss?: boolean;
  enemyWarded?: boolean;
  enemyHealthBelow?: number;
  enemyHealthAbove?: number;
  playerHealthAbove?: number;
  playerHealthBelow?: number;
  isTechnique?: boolean;
  minimumHitChance?: number;
  minimumBaseInterval?: number;
  burning?: boolean;
  marked?: boolean;
  maximumShred?: boolean;
  bossOrWarded?: boolean;
  overhealing?: boolean;
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
  | 'baseTechniqueCooldownPct'
  | 'maxHitPointsPct'
  | 'healingPct'
  | 'mendCooldownPct'
  | 'mendThresholdBonus'
  | 'auraDamageBonus'
  | 'damageTakenReductionPct'
  | 'regenerationPctPerSecond'
  | 'armourPct'
  | 'wardPct'
  | 'evasionFlat'
  | 'enemyHitChanceReduction'
  | 'physicalDamageReductionPct'
  | 'magicalDamageReductionPct'
  | 'armourPenetrationResistancePct'
  | 'wardPenetrationResistancePct'
  | 'defensiveCooldownPct'
  | 'barrierStrengthPct'
  | 'barrierCooldownPct';

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
  | 'maximum-shred'
  | 'after-mend'
  | 'after-technique';

export type CombatTriggeredOutcome =
  | 'damage'
  | 'accuracy'
  | 'attack-speed'
  | 'repeat'
  | 'guarantee-hit'
  | 'guarantee-critical'
  | 'ready-technique'
  | 'ready-defensive'
  | 'reduce-technique-cooldown'
  | 'reduce-defensive-cooldown'
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
    family?: string;
    priority?: number;
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
    family?: string;
    priority?: number;
    cooldownSeconds?: number;
    scale?: 'overheal-pct-max-hit-points';
    minimum?: number;
    maximum?: number;
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
  }
  | {
    id: string;
    skillId: CombatSkillId;
    kind: 'tempo';
    attackSpeedPerStack: number;
    maxStacks: number;
    missBehavior: 'reset' | 'remove-one';
    damageRemoves: number;
    condition?: CombatEffectCondition;
  }
  | {
    id: string;
    skillId: CombatSkillId;
    kind: 'recovery';
    recovery: 'mend-echo' | 'mend-hot' | 'damage-recovery';
    value: number;
    durationSeconds: number;
    capPctMaxHitPoints?: number;
    priority?: number;
    condition?: CombatEffectCondition;
  }
  | {
    id: string;
    skillId: CombatSkillId;
    kind: 'reserve';
    conversionPct: number;
    capPctMaxHitPoints: number;
    releaseBelow: number;
    retainUnused?: boolean;
    priority?: number;
    condition?: CombatEffectCondition;
  }
  | {
    id: string;
    skillId: CombatSkillId;
    kind: 'emergency';
    threshold: number;
    healPctMaxHitPoints?: number;
    freeMendMultiplier?: number;
    fatalGuardPctMaxHitPoints?: number;
    readyDefensive?: boolean;
    attackSpeedPct?: number;
    attackCount?: number;
    limit: number;
    family?: string;
    priority?: number;
    condition?: CombatEffectCondition;
  }
  | {
    id: string;
    skillId: CombatSkillId;
    kind: 'defense';
    defense: 'glance';
    reductionPct: number;
    first?: number;
    every?: number;
    threshold?: number;
    charges?: number;
    family?: string;
    priority?: number;
    condition?: CombatEffectCondition;
  }
  | {
    id: string;
    skillId: CombatSkillId;
    kind: 'defense';
    defense: 'guard';
    reductionPct: number;
    damageType?: DamageType;
    enemyAttackTag?: EnemyAttackTag;
    first?: number;
    every?: number;
    family?: string;
    priority?: number;
    condition?: CombatEffectCondition;
  }
  | {
    id: string;
    skillId: CombatSkillId;
    kind: 'defense';
    defense: 'avoidance';
    every?: number;
    threshold?: number;
    charges: number;
    family?: string;
    priority?: number;
    condition?: CombatEffectCondition;
  }
  | {
    id: string;
    skillId: CombatSkillId;
    kind: 'defense';
    defense: 'adaptive';
    mode: 'same' | 'opposite' | 'change';
    reductionPct: number;
    hits: number;
    family?: string;
    priority?: number;
    condition?: CombatEffectCondition;
  }
  | {
    id: string;
    skillId: CombatSkillId;
    kind: 'defense';
    defense: 'evasion-streak';
    evasionPerStack: number;
    maxStacks: number;
    hitBehavior: 'clear' | 'remove-two';
    damageBonusPct?: number;
    attackSpeedPct?: number;
    consumeStacks?: number;
    guaranteeHit?: boolean;
    guaranteeCritical?: boolean;
    techniqueDamagePct?: number;
    family?: string;
    priority?: number;
    condition?: CombatEffectCondition;
  }
  | {
    id: string;
    skillId: CombatSkillId;
    kind: 'defense';
    defense: 'retaliation';
    source: 'armour-prevented';
    damagePct: number;
    capPctDerivedHit: number;
    family?: string;
    priority?: number;
    condition?: CombatEffectCondition;
  }
  | {
    id: string;
    skillId: CombatSkillId;
    kind: 'defense';
    defense: 'barrier-response';
    trigger: 'break';
    nextAttackDamagePct?: number;
    nextTechniqueDamagePct?: number;
    nextMagicalReductionPct?: number;
    nextAttackCount?: number;
    readiesTechnique?: boolean;
    guaranteeCritical?: boolean;
    guaranteeHit?: boolean;
    cooldownSeconds?: number;
    limit?: number;
    family?: string;
    priority?: number;
    condition?: CombatEffectCondition;
  };

export interface CombatModifierSnapshot {
  effectIds: readonly string[];
  effects: readonly CombatTreeEffectDefinition[];
  static: Readonly<Record<CombatModifierStat, number>>;
}

export interface CombatDefenseProfile {
  armourMultiplierByClass: Readonly<Record<ArmourClass, number>>;
  wardMultiplier: number;
  evasionBonus: number;
  enemyHitChanceReduction: number;
  physicalDamageMultiplier: number;
  magicalDamageMultiplier: number;
  armourPenetrationResistance: number;
  wardPenetrationResistance: number;
  defensiveCooldownMultiplier: number;
  barrierStrengthMultiplier: number;
  barrierCooldownMultiplier: number;
}

/**
 * The intentionally representable Defense subset for Arena-style static
 * character projections. Solo-only attack-cycle mechanics stay in the Solo
 * resolver and are never inferred from this shape.
 */
export interface ArenaDefenseProfile {
  armourMultiplierByClass: Readonly<Record<ArmourClass, number>>;
  wardMultiplier: number;
  physicalDamageMultiplier: number;
  magicalDamageMultiplier: number;
  defensiveCooldownMultiplier: number;
  barrierStrengthMultiplier: number;
  barrierCooldownMultiplier: number;
}

export interface CombatSustainProfile {
  maxHitPointsMultiplier: number;
  healingMultiplier: number;
  mendCooldownMultiplier: number;
  mendTriggerHealthPercent: number;
  battleFocusDamageBonus: number;
  damageTakenMultiplier: number;
  regenerationPctPerSecond: number;
  recoveryReserveCapPct: number;
  damageRecoveryPct: number;
  fatalGuardPct: number;
}
