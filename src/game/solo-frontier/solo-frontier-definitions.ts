import type { SoloCombatStance, SoloEnemyDefinition, SoloFrontierStageDefinition } from './solo-frontier-types';

export const SOLO_FRONTIER_STAGE_COUNT = 30;
export const SOLO_COMBAT_TIMEOUT_SECONDS = 60;

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

function regularEnemyStats(stage: number) {
  return {
    hitPoints: Math.round(35 * 1.12 ** (stage - 1)),
    damage: Math.round(4 * 1.10 ** (stage - 1)),
    armour: Math.round(2 + 1.5 * stage),
    evasion: 3 + 0.4 * stage,
    attackInterval: Math.max(0.9, 2.2 - 0.02 * stage)
  };
}

export function createSoloFrontierEnemy(stage: number): SoloEnemyDefinition {
  if (!Number.isInteger(stage) || stage < 1 || stage > SOLO_FRONTIER_STAGE_COUNT) {
    throw new RangeError(`Solo Frontier stage must be an integer from 1 to ${SOLO_FRONTIER_STAGE_COUNT}.`);
  }
  const regular = regularEnemyStats(stage);
  const bossName = BOSS_NAMES.get(stage);
  const boss = bossName !== undefined;
  return Object.freeze({
    id: boss ? `solo-frontier:${bossName.toLowerCase()}` : `solo-frontier:stage-${stage}`,
    name: bossName ?? `Frontier Challenger ${stage}`,
    kind: boss ? 'boss' : 'regular',
    hitPoints: boss ? Math.round(regular.hitPoints * 4) : regular.hitPoints,
    damage: boss ? Math.round(regular.damage * 1.35) : regular.damage,
    armour: boss ? Math.round(regular.armour * 1.2) : regular.armour,
    ward: 0,
    evasion: regular.evasion,
    accuracy: 5 + 0.5 * stage,
    attackInterval: regular.attackInterval,
    damageType: 'physical'
  });
}

export const SOLO_FRONTIER_STAGES: readonly SoloFrontierStageDefinition[] = Object.freeze(
  Array.from({ length: SOLO_FRONTIER_STAGE_COUNT }, (_, index): SoloFrontierStageDefinition => {
    const stage = index + 1;
    const boss = BOSS_NAMES.has(stage);
    return Object.freeze({
      stage,
      victoriesToClear: boss ? 1 : 10,
      encounterTimeoutSeconds: SOLO_COMBAT_TIMEOUT_SECONDS,
      enemy: createSoloFrontierEnemy(stage)
    });
  })
);

export function soloFrontierStage(stage: number): SoloFrontierStageDefinition {
  const definition = SOLO_FRONTIER_STAGES[stage - 1];
  if (!definition) throw new RangeError(`Solo Frontier stage must be an integer from 1 to ${SOLO_FRONTIER_STAGE_COUNT}.`);
  return definition;
}
