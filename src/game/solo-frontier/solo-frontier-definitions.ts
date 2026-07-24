import type {
  DamageType,
  EnemyAttackTag,
  SoloCombatStance,
  SoloEnemyAttackStep,
  SoloEnemyDefinition,
  SoloEnemyThreat,
  SoloFrontierStageDefinition,
  SoloThreatProfileId
} from './solo-frontier-types';
import type { LootSlot } from '../loot';

export const SOLO_FRONTIER_STAGE_COUNT = 30;
export const SOLO_COMBAT_TIMEOUT_SECONDS = 60;
export const SOLO_FRONTIER_ENCOUNTER_RECOVERY_SECONDS = 5;

/** Named knobs shared by the deterministic balance harness and production runtime. */
export const SOLO_FRONTIER_BALANCE = Object.freeze({
  enemy: Object.freeze({
    baseHitPoints: 35,
    hitPointGrowth: 1.13,
    baseDamage: 27,
    earlyDamageGrowth: 1.11,
    lateDamageGrowth: 1.02,
    earlyDamageStages: 9,
    baseArmour: 2,
    armourPerStage: 1.5,
    baseEvasion: 3,
    evasionPerStage: 0.4,
    baseAccuracy: 5,
    accuracyPerStage: 0.5,
    baseAttackInterval: 2.2,
    attackIntervalPerStage: 0.02,
    minimumAttackInterval: 0.9,
    bossHitPointMultiplier: 3.25,
    bossDamageMultiplier: 1,
    bossArmourMultiplier: 1.2
  }),
  victories: Object.freeze({ onboarding: 25, early: 30, gateApproach: 600, middle: 3_300, late: 8_000, boss: 1 }),
  weaponStyleDamage: Object.freeze({ melee: 1, firearm: 0.57, ranged: 1, magic: 0.85 })
});

export const STANCE_MODIFIERS: Readonly<Record<SoloCombatStance, Readonly<{
  damage: number;
  attackInterval: number;
  armour: number;
  ward: number;
}>>> = Object.freeze({
  Aggressive: Object.freeze({ damage: 1.15, attackInterval: 0.90, armour: 0.90, ward: 0.90 }),
  Balanced: Object.freeze({ damage: 1, attackInterval: 1, armour: 1, ward: 1 }),
  Guarded: Object.freeze({ damage: 0.90, attackInterval: 1.10, armour: 1.20, ward: 1.20 })
});

export const STARTER_ABILITY_TUNING = Object.freeze({
  'Power Strike': Object.freeze({ cooldownSeconds: 4, damageMultiplier: 1.60 }),
  'Burst Fire': Object.freeze({ cooldownSeconds: 6, projectileCount: 3, projectileDamageMultiplier: 0.72 }),
  'Piercing Shot': Object.freeze({ cooldownSeconds: 5, damageMultiplier: 1.45, armourIgnored: 0.50 }),
  'Arc Bolt': Object.freeze({ cooldownSeconds: 5, damageMultiplier: 1.55 }),
  Mend: Object.freeze({ cooldownSeconds: 10, baseHealing: 24, useBelowHealthPercent: 0.75 }),
  'Arcane Barrier': Object.freeze({ cooldownSeconds: 12, baseBarrier: 24 }),
  'Battle Focus': Object.freeze({ baseDamageBonus: 0.10 })
});

const BOSS_NAMES = new Map<number, string>([[10, 'Initiate'], [20, 'Vanguard'], [30, 'Apex']]);

const attackStep = (
  damageType: DamageType,
  damageMultiplier: number,
  accuracyFlat: number,
  tag: EnemyAttackTag,
  options: Pick<SoloEnemyAttackStep, 'armourPenetrationPct' | 'wardPenetrationPct'> = {}
): SoloEnemyAttackStep => Object.freeze({
  damageType,
  damageMultiplier,
  accuracyFlat,
  tag,
  ...options
});

const threat = (
  profileId: SoloThreatProfileId,
  name: string,
  description: string,
  intervalMultiplier: number,
  attackCycle: readonly SoloEnemyAttackStep[]
): SoloEnemyThreat => Object.freeze({
  profileId,
  name,
  description,
  intervalMultiplier,
  attackCycle: Object.freeze([...attackCycle])
});

export const SOLO_THREAT_PROFILES: Readonly<Record<SoloThreatProfileId, SoloEnemyThreat>> = Object.freeze({
  standard: threat('standard', 'Standard', 'A steady physical attack pattern.', 1, [attackStep('physical', 1, 0, 'standard')]),
  skirmisher: threat('skirmisher', 'Skirmisher', 'Rapid, accurate physical pressure.', 0.72, [attackStep('physical', 0.70, 10, 'rapid')]),
  breaker: threat('breaker', 'Breaker', 'Slow, heavy physical strikes that pierce armour.', 1.35, [attackStep('physical', 1.40, -8, 'heavy', { armourPenetrationPct: 0.20 })]),
  arcanist: threat('arcanist', 'Arcanist', 'Magical pressure that partially penetrates wards.', 1, [attackStep('magical', 1, 2, 'arcane', { wardPenetrationPct: 0.10 })]),
  spellblade: threat('spellblade', 'Spellblade', 'Alternating physical and magical attacks.', 0.92, [
    attackStep('physical', 0.90, 2, 'standard'),
    attackStep('magical', 0.90, 2, 'arcane')
  ]),
  initiate: threat('initiate', 'Initiate', 'A boss cycle that alternates light pressure with a heavy armour-breaking blow.', 1, [
    attackStep('physical', 0.80, 5, 'rapid'),
    attackStep('physical', 0.80, 5, 'rapid'),
    attackStep('physical', 1.40, -5, 'heavy', { armourPenetrationPct: 0.10 })
  ]),
  vanguard: threat('vanguard', 'Vanguard', 'A mixed boss cycle of physical, magical and heavy pressure.', 0.95, [
    attackStep('physical', 0.85, 5, 'rapid'),
    attackStep('magical', 0.85, 2, 'arcane'),
    attackStep('physical', 1.15, -5, 'heavy', { armourPenetrationPct: 0.15 })
  ]),
  apex: threat('apex', 'Apex', 'A four-step boss cycle combining rapid, arcane and penetrating attacks.', 0.95, [
    attackStep('physical', 0.80, 8, 'rapid'),
    attackStep('magical', 0.80, 4, 'arcane'),
    attackStep('physical', 1.10, -5, 'heavy', { armourPenetrationPct: 0.20 }),
    attackStep('magical', 1.10, 0, 'arcane', { wardPenetrationPct: 0.20 })
  ])
});

const SOLO_STAGE_THREAT_IDS: readonly SoloThreatProfileId[] = Object.freeze([
  'standard', 'standard', 'standard', 'skirmisher', 'breaker', 'standard', 'arcanist', 'spellblade', 'breaker', 'initiate',
  'skirmisher', 'breaker', 'arcanist', 'spellblade', 'skirmisher', 'standard', 'arcanist', 'breaker', 'spellblade', 'vanguard',
  'skirmisher', 'breaker', 'arcanist', 'spellblade', 'skirmisher', 'breaker', 'arcanist', 'spellblade', 'breaker', 'apex'
]);

export function soloThreatForStage(stage: number): SoloEnemyThreat {
  const profileId = SOLO_STAGE_THREAT_IDS[Math.max(1, Math.floor(stage)) - 1] || 'standard';
  return SOLO_THREAT_PROFILES[profileId];
}

const ADVERTISED_TARGET_SLOT_CYCLE: readonly (readonly LootSlot[])[] = Object.freeze([
  ['melee', 'helm'], ['gun', 'chest'], ['ranged', 'gloves'], ['magic', 'pants'],
  ['boots', 'cloak'], ['belt', 'amulet'], ['ring', 'trinket']
]);

function regularEnemyStats(stage: number) {
  const tuning = SOLO_FRONTIER_BALANCE.enemy;
  const earlyDamageExponent = Math.min(stage - 1, tuning.earlyDamageStages);
  const lateDamageExponent = Math.max(0, stage - 1 - tuning.earlyDamageStages);
  return {
    hitPoints: Math.round(tuning.baseHitPoints * tuning.hitPointGrowth ** (stage - 1)),
    damage: Math.round(tuning.baseDamage * tuning.earlyDamageGrowth ** earlyDamageExponent * tuning.lateDamageGrowth ** lateDamageExponent),
    armour: Math.round(tuning.baseArmour + tuning.armourPerStage * stage),
    evasion: tuning.baseEvasion + tuning.evasionPerStage * stage,
    attackInterval: Math.max(tuning.minimumAttackInterval, tuning.baseAttackInterval - tuning.attackIntervalPerStage * stage)
  };
}

function victoriesToClear(stage: number, boss: boolean): number {
  if (boss) return SOLO_FRONTIER_BALANCE.victories.boss;
  if (stage < 5) return SOLO_FRONTIER_BALANCE.victories.onboarding;
  if (stage < 8) return SOLO_FRONTIER_BALANCE.victories.early;
  if (stage < 10) return SOLO_FRONTIER_BALANCE.victories.gateApproach;
  if (stage < 20) return SOLO_FRONTIER_BALANCE.victories.middle;
  return SOLO_FRONTIER_BALANCE.victories.late;
}

export function createSoloFrontierEnemy(stage: number): SoloEnemyDefinition {
  if (!Number.isInteger(stage) || stage < 1 || stage > SOLO_FRONTIER_STAGE_COUNT) {
    throw new RangeError(`Solo Frontier stage must be an integer from 1 to ${SOLO_FRONTIER_STAGE_COUNT}.`);
  }
  const regular = regularEnemyStats(stage);
  const tuning = SOLO_FRONTIER_BALANCE.enemy;
  const bossName = BOSS_NAMES.get(stage);
  const boss = bossName !== undefined;
  const threatProfile = soloThreatForStage(stage);
  return Object.freeze({
    id: boss ? `solo-frontier:${bossName.toLowerCase()}` : `solo-frontier:stage-${stage}`,
    name: bossName ?? `Frontier Challenger ${stage}`,
    kind: boss ? 'boss' : 'regular',
    hitPoints: boss ? Math.round(regular.hitPoints * tuning.bossHitPointMultiplier) : regular.hitPoints,
    damage: boss ? Math.round(regular.damage * tuning.bossDamageMultiplier) : regular.damage,
    armour: boss ? Math.round(regular.armour * tuning.bossArmourMultiplier) : regular.armour,
    ward: 0,
    evasion: regular.evasion,
    accuracy: tuning.baseAccuracy + tuning.accuracyPerStage * stage,
    attackInterval: regular.attackInterval,
    damageType: 'physical',
    threat: threatProfile
  });
}

export const SOLO_FRONTIER_STAGES: readonly SoloFrontierStageDefinition[] = Object.freeze(
  Array.from({ length: SOLO_FRONTIER_STAGE_COUNT }, (_, index): SoloFrontierStageDefinition => {
    const stage = index + 1;
    const boss = BOSS_NAMES.has(stage);
    const advertisedTargetSlots = ADVERTISED_TARGET_SLOT_CYCLE[(stage - 1) % ADVERTISED_TARGET_SLOT_CYCLE.length];
    return Object.freeze({
      stage,
      victoriesToClear: victoriesToClear(stage, boss),
      encounterTimeoutSeconds: SOLO_COMBAT_TIMEOUT_SECONDS,
      enemy: createSoloFrontierEnemy(stage),
      advertisedTargetSlots,
      targetSlots: advertisedTargetSlots
    });
  })
);

export function soloFrontierStage(stage: number): SoloFrontierStageDefinition {
  const definition = SOLO_FRONTIER_STAGES[stage - 1];
  if (!definition) throw new RangeError(`Solo Frontier stage must be an integer from 1 to ${SOLO_FRONTIER_STAGE_COUNT}.`);
  return definition;
}
