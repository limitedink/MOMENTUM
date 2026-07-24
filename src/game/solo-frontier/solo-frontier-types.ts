import type { CombatSkillLevelMap, CombatSkillUseEvent } from '../combat-progression';
import type { CombatModifierSnapshot } from '../combat-development';
import type { LootSlot } from '../loot';

export const SOLO_COMBAT_STANCES = ['Aggressive', 'Balanced', 'Guarded'] as const;
export type SoloCombatStance = (typeof SOLO_COMBAT_STANCES)[number];

export const WEAPON_STYLES = ['light-melee', 'medium-melee', 'heavy-melee', 'gun', 'ranged', 'magic'] as const;
export type WeaponStyle = (typeof WEAPON_STYLES)[number];
export type DamageType = 'physical' | 'magical';
export type ArmourClass = 'light' | 'medium' | 'heavy';
export type EnemyAttackTag = 'standard' | 'rapid' | 'heavy' | 'arcane';
export type SoloThreatProfileId = 'standard' | 'skirmisher' | 'breaker' | 'arcanist' | 'spellblade' | 'initiate' | 'vanguard' | 'apex';

export interface SoloEnemyAttackStep {
  damageType: DamageType;
  damageMultiplier: number;
  accuracyFlat: number;
  armourPenetrationPct?: number;
  wardPenetrationPct?: number;
  tag: EnemyAttackTag;
}

export interface SoloEnemyThreat {
  profileId: SoloThreatProfileId;
  name: string;
  description: string;
  intervalMultiplier: number;
  attackCycle: readonly SoloEnemyAttackStep[];
}

export const TECHNIQUE_IDS = ['Power Strike', 'Burst Fire', 'Piercing Shot', 'Arc Bolt'] as const;
export type TechniqueId = (typeof TECHNIQUE_IDS)[number];
export const DEFENSIVE_ABILITY_IDS = ['Mend', 'Arcane Barrier'] as const;
export type DefensiveAbilityId = (typeof DEFENSIVE_ABILITY_IDS)[number];
export const AURA_IDS = ['Battle Focus'] as const;
export type AuraId = (typeof AURA_IDS)[number];

export type CombatSkillSnapshot = Readonly<CombatSkillLevelMap>;

export interface EquippedArmourPieceSnapshot {
  id: string;
  armourClass: ArmourClass;
  armour: number;
}

/** Already-aggregated equipped bonuses. Weapon values remain on ActiveWeaponSnapshot. */
export interface EquippedStatSnapshot {
  hitPoints: number;
  /** Flat non-weapon damage from armour, accessories, and affixes. */
  damage?: number;
  accuracy: number;
  evasion: number;
  ward: number;
  armourPieces: readonly EquippedArmourPieceSnapshot[];
  criticalChanceBonus?: number;
  criticalMultiplierBonus?: number;
}

export interface ActiveWeaponSnapshot {
  id: string;
  name: string;
  style: WeaponStyle;
  damage: number;
  accuracy: number;
  attackInterval: number;
  damageType?: DamageType;
}

export interface SoloEnemyDefinition {
  id: string;
  name: string;
  kind: 'regular' | 'boss';
  hitPoints: number;
  damage: number;
  armour: number;
  ward: number;
  evasion: number;
  accuracy: number;
  attackInterval: number;
  damageType: DamageType;
  /** Optional v21.2 threat metadata; omitted custom enemies retain legacy behavior. */
  threat?: SoloEnemyThreat;
}

export interface SoloFrontierStageDefinition {
  stage: number;
  victoriesToClear: number;
  encounterTimeoutSeconds: 60;
  enemy: SoloEnemyDefinition;
  /** The stage's advertised item targets. Loot rolls give this bucket 60%. */
  advertisedTargetSlots: readonly LootSlot[];
  /** Short alias used by runtime/UI consumers that call them target slots. */
  targetSlots: readonly LootSlot[];
}

export interface SoloCombatInput {
  combatSkills: CombatSkillSnapshot;
  equippedStats: EquippedStatSnapshot;
  activeWeapon: ActiveWeaponSnapshot;
  stance: SoloCombatStance;
  /** Unknown or incompatible technique names are accepted so the engine can select the style-compatible technique. */
  technique: TechniqueId | string;
  defensiveAbility: DefensiveAbilityId | 'none' | string;
  aura: AuraId | 'none' | string;
  enemy: SoloEnemyDefinition;
  stage: number;
  seed: number | string;
  combatModifiers?: CombatModifierSnapshot;
}

export interface DerivedSoloPlayerStats {
  maxHitPoints: number;
  damage: number;
  accuracy: number;
  evasion: number;
  armour: number;
  ward: number;
  attackInterval: number;
  criticalChance: number;
  criticalMultiplier: number;
  playerHitChance: number;
  enemyHitChance: number;
  armourMitigation: number;
  magicalMitigation: number;
}

export const COMBAT_RECOVERY_SOURCES = [
  'mend',
  'mend-echo',
  'mend-hot',
  'regeneration',
  'damage-recovery',
  'recovery-reserve',
  'emergency',
  'fatal-guard'
] as const;
export type CombatRecoverySource = (typeof COMBAT_RECOVERY_SOURCES)[number];

interface SequencedCombatEvent {
  sequence: number;
  atMs: number;
}

export type TimedCombatSkillUseEvent = CombatSkillUseEvent & SequencedCombatEvent;

export type SoloCombatEvent =
  | (SequencedCombatEvent & { type: 'encounter-started'; stage: number; playerHitPoints: number; enemyHitPoints: number })
  | (SequencedCombatEvent & { type: 'aura-activated'; ability: AuraId; damageBonus: number })
  | (SequencedCombatEvent & { type: 'ability-used'; actor: 'player'; ability: TechniqueId | DefensiveAbilityId; effect: 'attack' | 'heal' | 'barrier' })
  | (SequencedCombatEvent & { type: 'attack'; actor: 'player' | 'enemy'; action: string; hit: boolean; critical: boolean; damageType: DamageType; rawDamage: number; damage: number; targetHitPoints: number })
  | (SequencedCombatEvent & { type: 'healing'; ability: 'Mend'; amount: number; overhealing: number; playerHitPoints: number })
  | (SequencedCombatEvent & { type: 'recovery'; source: CombatRecoverySource; amount: number; overhealing: number; playerHitPoints: number })
  | (SequencedCombatEvent & { type: 'barrier'; ability: 'Arcane Barrier'; granted: number; absorbed: number; remaining: number })
  | TimedCombatSkillUseEvent
  | (SequencedCombatEvent & { type: 'encounter-ended'; outcome: SoloCombatOutcome; termination: SoloCombatTermination; durationMs: number });

export type SoloCombatOutcome = 'victory' | 'defeat';
export type SoloCombatTermination = 'enemy-defeated' | 'player-defeated' | 'timeout';
export type SoloCombatDefeatReason =
  | 'low-hit-rate'
  | 'insufficient-damage'
  | 'low-physical-mitigation'
  | 'low-magical-mitigation'
  | 'insufficient-sustain';

export interface SoloCombatMetrics {
  damage: {
    dealt: number;
    physicalDealt: number;
    magicalDealt: number;
    taken: number;
    prevented: number;
  };
  hitRate: {
    playerAttempts: number;
    playerHits: number;
    playerRate: number;
    enemyAttempts: number;
    enemyHits: number;
    enemyRate: number;
  };
  mitigation: {
    armourRate: number;
    magicalRate: number;
    preventedByArmourOrWard: number;
    barrierAbsorbed: number;
  };
  sustain: {
    healing: number;
    overhealing: number;
    barrierGranted: number;
    barrierAbsorbed: number;
    healingBySource: Record<CombatRecoverySource, number>;
    mendCasts: number;
    reserveStored: number;
    reserveReleased: number;
    damageRecovered: number;
    damagePrevented: number;
    cooldownRemovedMs: number;
    emergencyTriggers: number;
    fatalGuards: number;
    minimumHealthRatio: number;
    timeBelowHalfMs: number;
  };
  durationSeconds: number;
  timeout: boolean;
  defeatReason: SoloCombatDefeatReason | null;
}

export interface SoloCombatResult {
  stage: number;
  seed: string;
  outcome: SoloCombatOutcome;
  termination: SoloCombatTermination;
  timedOut: boolean;
  effectiveTechnique: TechniqueId;
  playerHitPointsRemaining: number;
  enemyHitPointsRemaining: number;
  enemyHealthRemovedPercent: number;
  warnings: readonly string[];
  derivedStats: DerivedSoloPlayerStats;
  events: readonly SoloCombatEvent[];
  skillEvents: readonly TimedCombatSkillUseEvent[];
  metrics: SoloCombatMetrics;
}
