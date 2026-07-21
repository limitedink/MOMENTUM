import type { CombatSkillId } from '../combat-progression';
import { SOLO_COMBAT_TIMEOUT_SECONDS, SOLO_FRONTIER_BALANCE, STANCE_MODIFIERS, STARTER_ABILITY_TUNING } from './solo-frontier-definitions';
import {
  AURA_IDS,
  DEFENSIVE_ABILITY_IDS,
  TECHNIQUE_IDS,
  type ArmourClass,
  type DamageType,
  type DerivedSoloPlayerStats,
  type SoloCombatDefeatReason,
  type SoloCombatEvent,
  type SoloCombatInput,
  type SoloCombatMetrics,
  type SoloCombatResult,
  type SoloCombatTermination,
  type TechniqueId,
  type TimedCombatSkillUseEvent,
  type WeaponStyle
} from './solo-frontier-types';

const BASIC_ATTACK = 'Basic Attack' as const;

const TECHNIQUE_STYLES = Object.freeze({
  'Power Strike': Object.freeze(['light-melee', 'medium-melee', 'heavy-melee'] as const),
  'Burst Fire': Object.freeze(['gun'] as const),
  'Piercing Shot': Object.freeze(['ranged'] as const),
  'Arc Bolt': Object.freeze(['magic'] as const)
}) satisfies Readonly<Record<TechniqueId, readonly WeaponStyle[]>>;

type WithoutSequence<T> = T extends unknown ? Omit<T, 'sequence' | 'atMs'> : never;
type UnsequencedCombatEvent = WithoutSequence<SoloCombatEvent>;

const ARMOUR_SKILLS: Readonly<Record<ArmourClass, CombatSkillId>> = Object.freeze({
  light: 'Light Armour Proficiency',
  medium: 'Medium Armour Proficiency',
  heavy: 'Heavy Armour Proficiency'
});

const MELEE_PROFICIENCY: Readonly<Partial<Record<WeaponStyle, CombatSkillId>>> = Object.freeze({
  'light-melee': 'Light Melee Weapon Proficiency',
  'medium-melee': 'Medium Melee Weapon Proficiency',
  'heavy-melee': 'Heavy Melee Weapon Proficiency'
});

const finiteNonNegative = (value: unknown): number => {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? Math.max(0, numeric) : 0;
};

const round = (value: number, places = 6): number => {
  const scale = 10 ** places;
  return Math.round((value + Number.EPSILON) * scale) / scale;
};

export function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}

export function calculateHitChance(accuracy: number, evasion: number): number {
  return clamp(0.75 + (finiteNonNegative(accuracy) - finiteNonNegative(evasion)) * 0.005, 0.20, 0.98);
}

export function calculateArmourMitigation(armour: number, enemyStage: number): number {
  const normalizedArmour = finiteNonNegative(armour);
  const stage = Math.max(1, Math.floor(finiteNonNegative(enemyStage) || 1));
  return clamp(normalizedArmour / (normalizedArmour + 100 + 10 * stage), 0, 0.75);
}

export function calculateMagicalMitigation(ward: number, enemyStage: number): number {
  const normalizedWard = finiteNonNegative(ward);
  const stage = Math.max(1, Math.floor(finiteNonNegative(enemyStage) || 1));
  return clamp(normalizedWard / (normalizedWard + 100 + 10 * stage), 0, 0.60);
}

function skill(input: SoloCombatInput, skillId: CombatSkillId): number {
  return finiteNonNegative(input.combatSkills[skillId]);
}

function weaponDamageType(input: SoloCombatInput): DamageType {
  return input.activeWeapon.damageType ?? (input.activeWeapon.style === 'magic' ? 'magical' : 'physical');
}

function weaponMultiplier(input: SoloCombatInput): number {
  const style = input.activeWeapon.style;
  const meleeProficiency = MELEE_PROFICIENCY[style];
  if (meleeProficiency) return 1 + 0.006 * skill(input, 'Strength') + 0.004 * skill(input, meleeProficiency);
  if (style === 'gun') return 1 + 0.008 * skill(input, 'Marksmanship');
  if (style === 'ranged') return 1 + 0.008 * skill(input, 'Ranged');
  return 1 + 0.008 * skill(input, 'Offensive Magic');
}

function weaponStyleDamageMultiplier(style: WeaponStyle): number {
  if (style === 'gun') return SOLO_FRONTIER_BALANCE.weaponStyleDamage.firearm;
  if (style === 'ranged') return SOLO_FRONTIER_BALANCE.weaponStyleDamage.ranged;
  if (style === 'magic') return SOLO_FRONTIER_BALANCE.weaponStyleDamage.magic;
  return SOLO_FRONTIER_BALANCE.weaponStyleDamage.melee;
}

function weaponAccuracySkill(input: SoloCombatInput): number {
  const style = input.activeWeapon.style;
  if (MELEE_PROFICIENCY[style]) return skill(input, 'Melee Accuracy');
  if (style === 'gun') return skill(input, 'Marksmanship');
  if (style === 'ranged') return skill(input, 'Ranged');
  return skill(input, 'Offensive Magic');
}

function proficientArmour(input: SoloCombatInput): number {
  return input.equippedStats.armourPieces.reduce((total, piece) => {
    const baseArmour = finiteNonNegative(piece.armour);
    const proficiency = skill(input, ARMOUR_SKILLS[piece.armourClass]);
    return total + baseArmour * (1 + 0.005 * proficiency);
  }, 0);
}

/** Derives stats without observing or mutating any renderer or persistence state. */
export function deriveSoloPlayerStats(input: SoloCombatInput): DerivedSoloPlayerStats {
  const stage = Math.max(1, Math.floor(finiteNonNegative(input.stage) || 1));
  const stance = STANCE_MODIFIERS[input.stance] ?? STANCE_MODIFIERS.Balanced;
  const reflexReduction = Math.min(0.35, 0.002 * skill(input, 'Reflexes'));
  const accuracy = finiteNonNegative(input.equippedStats.accuracy)
    + finiteNonNegative(input.activeWeapon.accuracy)
    + weaponAccuracySkill(input);
  const evasion = finiteNonNegative(input.equippedStats.evasion) + skill(input, 'Evasion');
  const armour = proficientArmour(input) * stance.armour;
  const ward = finiteNonNegative(input.equippedStats.ward) * stance.ward;
  const damage = (finiteNonNegative(input.activeWeapon.damage) + finiteNonNegative(input.equippedStats.damage))
    * weaponMultiplier(input)
    * weaponStyleDamageMultiplier(input.activeWeapon.style)
    * stance.damage;
  const attackInterval = Math.max(
    0.05,
    finiteNonNegative(input.activeWeapon.attackInterval) * (1 - reflexReduction) * stance.attackInterval
  );
  const criticalChance = clamp(0.05 + finiteNonNegative(input.equippedStats.criticalChanceBonus), 0, 1);
  const criticalMultiplier = Math.max(1, 1.5 + finiteNonNegative(input.equippedStats.criticalMultiplierBonus));
  return Object.freeze({
    maxHitPoints: round(100 + 2 * skill(input, 'Vitality') + finiteNonNegative(input.equippedStats.hitPoints)),
    damage: round(damage),
    accuracy: round(accuracy),
    evasion: round(evasion),
    armour: round(armour),
    ward: round(ward),
    attackInterval: round(attackInterval),
    criticalChance: round(criticalChance),
    criticalMultiplier: round(criticalMultiplier),
    playerHitChance: round(calculateHitChance(accuracy, input.enemy.evasion)),
    enemyHitChance: round(calculateHitChance(input.enemy.accuracy, evasion)),
    armourMitigation: round(calculateArmourMitigation(armour, stage)),
    magicalMitigation: round(calculateMagicalMitigation(ward, stage))
  });
}

function canonicalSeed(seed: number | string): string {
  if (typeof seed === 'number') return Number.isFinite(seed) ? String(seed) : '0';
  return seed;
}

/** FNV-1a seed hashing followed by Mulberry32; both operate only on explicit input. */
function seededRandom(seed: string): () => number {
  let hash = 0x811c9dc5;
  for (let index = 0; index < seed.length; index += 1) {
    hash ^= seed.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  let state = hash >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4_294_967_296;
  };
}

function resolveTechnique(input: SoloCombatInput, warnings: string[]): TechniqueId | typeof BASIC_ATTACK {
  const technique = TECHNIQUE_IDS.find(candidate => candidate === input.technique);
  if (!technique) {
    warnings.push(`Unknown weapon technique "${input.technique}"; Basic Attack used instead.`);
    return BASIC_ATTACK;
  }
  if (!(TECHNIQUE_STYLES[technique] as readonly WeaponStyle[]).includes(input.activeWeapon.style)) {
    warnings.push(`Weapon technique "${technique}" is incompatible with ${input.activeWeapon.style}; Basic Attack used instead.`);
    return BASIC_ATTACK;
  }
  return technique;
}

function techniqueCooldownMs(technique: TechniqueId | typeof BASIC_ATTACK): number {
  if (technique === BASIC_ATTACK) return Number.POSITIVE_INFINITY;
  return STARTER_ABILITY_TUNING[technique].cooldownSeconds * 1_000;
}

function diagnoseDefeat(
  termination: SoloCombatTermination,
  input: SoloCombatInput,
  metrics: SoloCombatMetrics
): SoloCombatDefeatReason | null {
  if (termination === 'enemy-defeated') return null;
  if (termination === 'timeout') return metrics.hitRate.playerRate < 0.5 ? 'low-hit-rate' : 'insufficient-damage';
  if (metrics.sustain.healing + metrics.sustain.barrierAbsorbed > 0) return 'insufficient-sustain';
  return input.enemy.damageType === 'magical' ? 'low-magical-mitigation' : 'low-physical-mitigation';
}

export function simulateSoloCombat(input: SoloCombatInput): SoloCombatResult {
  const stage = Math.max(1, Math.floor(finiteNonNegative(input.stage) || 1));
  const seed = canonicalSeed(input.seed);
  const random = seededRandom(seed);
  const warnings: string[] = [];
  const effectiveTechnique = resolveTechnique(input, warnings);
  const defensiveAbility = DEFENSIVE_ABILITY_IDS.find(candidate => candidate === input.defensiveAbility) ?? null;
  const aura = AURA_IDS.find(candidate => candidate === input.aura) ?? null;
  if (!defensiveAbility && input.defensiveAbility !== 'none') warnings.push(`Unknown defensive ability "${input.defensiveAbility}"; no defensive ability used.`);
  if (!aura && input.aura !== 'none') warnings.push(`Unknown aura "${input.aura}"; no aura used.`);

  const derivedStats = deriveSoloPlayerStats(input);
  const enemyMaxHitPoints = Math.max(1, finiteNonNegative(input.enemy.hitPoints));
  let playerHitPoints = derivedStats.maxHitPoints;
  let enemyHitPoints = enemyMaxHitPoints;
  let barrier = 0;
  let sequence = 0;
  const events: SoloCombatEvent[] = [];
  const skillEvents: TimedCombatSkillUseEvent[] = [];
  const counters = {
    damageDealt: 0,
    physicalDealt: 0,
    magicalDealt: 0,
    damageTaken: 0,
    preventedByMitigation: 0,
    barrierAbsorbed: 0,
    healing: 0,
    overhealing: 0,
    barrierGranted: 0,
    playerAttempts: 0,
    playerHits: 0,
    enemyAttempts: 0,
    enemyHits: 0
  };

  const emit = (atMs: number, event: UnsequencedCombatEvent): SoloCombatEvent => {
    const sequenced = { sequence, atMs, ...event } as SoloCombatEvent;
    sequence += 1;
    events.push(sequenced);
    return sequenced;
  };
  const emitSkillUse = (atMs: number, skillId: CombatSkillId, amount: number): void => {
    const event: TimedCombatSkillUseEvent = { sequence, atMs, type: 'combat-skill-used', skillId, amount: round(Math.max(0.001, amount)) };
    sequence += 1;
    events.push(event);
    skillEvents.push(event);
  };

  emit(0, { type: 'encounter-started', stage, playerHitPoints, enemyHitPoints });
  let auraDamageMultiplier = 1;
  if (aura === 'Battle Focus') {
    const supportScaling = 1 + 0.005 * skill(input, 'Support Magic');
    const damageBonus = STARTER_ABILITY_TUNING['Battle Focus'].baseDamageBonus * supportScaling;
    auraDamageMultiplier += damageBonus;
    emit(0, { type: 'aura-activated', ability: aura, damageBonus: round(damageBonus) });
    emitSkillUse(0, 'Support Magic', 1);
  }

  let defensiveReadyAt = 0;
  const tryDefensiveAbility = (atMs: number): void => {
    if (!defensiveAbility || atMs < defensiveReadyAt) return;
    if (defensiveAbility === 'Mend') {
      if (playerHitPoints / derivedStats.maxHitPoints > STARTER_ABILITY_TUNING.Mend.useBelowHealthPercent) return;
      const healing = Math.round(STARTER_ABILITY_TUNING.Mend.baseHealing * (1 + 0.006 * skill(input, 'Healing')));
      const missing = derivedStats.maxHitPoints - playerHitPoints;
      const applied = Math.min(missing, healing);
      const overhealing = healing - applied;
      playerHitPoints = round(playerHitPoints + applied);
      counters.healing += applied;
      counters.overhealing += overhealing;
      defensiveReadyAt = atMs + STARTER_ABILITY_TUNING.Mend.cooldownSeconds * 1_000;
      emit(atMs, { type: 'ability-used', actor: 'player', ability: defensiveAbility, effect: 'heal' });
      emit(atMs, { type: 'healing', ability: defensiveAbility, amount: applied, overhealing, playerHitPoints });
      emitSkillUse(atMs, 'Healing', applied || 1);
      return;
    }
    if (barrier > 0) return;
    const granted = Math.round(STARTER_ABILITY_TUNING['Arcane Barrier'].baseBarrier * (1 + 0.006 * skill(input, 'Warding')));
    barrier = granted;
    counters.barrierGranted += granted;
    defensiveReadyAt = atMs + STARTER_ABILITY_TUNING['Arcane Barrier'].cooldownSeconds * 1_000;
    emit(atMs, { type: 'ability-used', actor: 'player', ability: defensiveAbility, effect: 'barrier' });
    emit(atMs, { type: 'barrier', ability: defensiveAbility, granted, absorbed: 0, remaining: barrier });
    emitSkillUse(atMs, 'Warding', 1);
  };

  tryDefensiveAbility(0);

  const emitWeaponSkillUse = (atMs: number, hit: boolean): void => {
    const proficiency = MELEE_PROFICIENCY[input.activeWeapon.style];
    if (proficiency) {
      emitSkillUse(atMs, 'Melee Accuracy', 1);
      emitSkillUse(atMs, proficiency, 1);
      if (hit) emitSkillUse(atMs, 'Strength', 1);
    } else if (input.activeWeapon.style === 'gun') {
      emitSkillUse(atMs, 'Marksmanship', 1);
    } else if (input.activeWeapon.style === 'ranged') {
      emitSkillUse(atMs, 'Ranged', 1);
    } else {
      emitSkillUse(atMs, 'Offensive Magic', 1);
    }
    emitSkillUse(atMs, 'Reflexes', 0.25);
  };

  let techniqueReadyAt = 0;
  const playerAttack = (atMs: number): void => {
    const useTechnique = effectiveTechnique !== BASIC_ATTACK && atMs >= techniqueReadyAt;
    const action = useTechnique ? effectiveTechnique : BASIC_ATTACK;
    if (useTechnique) {
      techniqueReadyAt = atMs + techniqueCooldownMs(effectiveTechnique);
      emit(atMs, { type: 'ability-used', actor: 'player', ability: effectiveTechnique, effect: 'attack' });
    }
    const attacks = action === 'Burst Fire' ? STARTER_ABILITY_TUNING['Burst Fire'].projectileCount : 1;
    for (let attackIndex = 0; attackIndex < attacks && enemyHitPoints > 0; attackIndex += 1) {
      counters.playerAttempts += 1;
      const hit = random() < derivedStats.playerHitChance;
      if (!hit) {
        emit(atMs, { type: 'attack', actor: 'player', action, hit: false, critical: false, damageType: weaponDamageType(input), rawDamage: 0, damage: 0, targetHitPoints: enemyHitPoints });
        emitWeaponSkillUse(atMs, false);
        continue;
      }
      counters.playerHits += 1;
      const critical = random() < derivedStats.criticalChance;
      let actionMultiplier = 1;
      let armourIgnored = 0;
      if (action === 'Power Strike') actionMultiplier = STARTER_ABILITY_TUNING['Power Strike'].damageMultiplier;
      if (action === 'Burst Fire') actionMultiplier = STARTER_ABILITY_TUNING['Burst Fire'].projectileDamageMultiplier;
      if (action === 'Piercing Shot') {
        actionMultiplier = STARTER_ABILITY_TUNING['Piercing Shot'].damageMultiplier;
        armourIgnored = STARTER_ABILITY_TUNING['Piercing Shot'].armourIgnored;
      }
      if (action === 'Arc Bolt') actionMultiplier = STARTER_ABILITY_TUNING['Arc Bolt'].damageMultiplier;
      const damageType = action === 'Arc Bolt' ? 'magical' : weaponDamageType(input);
      const rawDamage = derivedStats.damage * auraDamageMultiplier * actionMultiplier * (critical ? derivedStats.criticalMultiplier : 1);
      const mitigation = damageType === 'magical'
        ? calculateMagicalMitigation(input.enemy.ward, stage)
        : calculateArmourMitigation(input.enemy.armour * (1 - armourIgnored), stage);
      const calculatedDamage = rawDamage > 0 ? Math.max(1, Math.round(rawDamage * (1 - mitigation))) : 0;
      const damage = Math.min(enemyHitPoints, calculatedDamage);
      enemyHitPoints = Math.max(0, round(enemyHitPoints - damage));
      counters.damageDealt += damage;
      if (damageType === 'magical') counters.magicalDealt += damage;
      else counters.physicalDealt += damage;
      emit(atMs, { type: 'attack', actor: 'player', action, hit: true, critical, damageType, rawDamage: round(rawDamage), damage, targetHitPoints: enemyHitPoints });
      emitWeaponSkillUse(atMs, true);
    }
  };

  const enemyAttack = (atMs: number): void => {
    counters.enemyAttempts += 1;
    const hit = random() < derivedStats.enemyHitChance;
    if (!hit) {
      emit(atMs, { type: 'attack', actor: 'enemy', action: 'Basic Attack', hit: false, critical: false, damageType: input.enemy.damageType, rawDamage: 0, damage: 0, targetHitPoints: playerHitPoints });
      emitSkillUse(atMs, 'Evasion', 1);
      emitSkillUse(atMs, 'Reflexes', 0.5);
      return;
    }
    counters.enemyHits += 1;
    const rawDamage = finiteNonNegative(input.enemy.damage);
    const mitigation = input.enemy.damageType === 'magical' ? derivedStats.magicalMitigation : derivedStats.armourMitigation;
    const postMitigation = rawDamage > 0 ? Math.max(1, Math.round(rawDamage * (1 - mitigation))) : 0;
    const prevented = Math.max(0, rawDamage - postMitigation);
    counters.preventedByMitigation += prevented;
    const absorbed = Math.min(barrier, postMitigation);
    barrier -= absorbed;
    counters.barrierAbsorbed += absorbed;
    const damage = Math.min(playerHitPoints, postMitigation - absorbed);
    playerHitPoints = Math.max(0, round(playerHitPoints - damage));
    counters.damageTaken += damage;
    emit(atMs, { type: 'attack', actor: 'enemy', action: 'Basic Attack', hit: true, critical: false, damageType: input.enemy.damageType, rawDamage, damage, targetHitPoints: playerHitPoints });
    if (absorbed > 0) emit(atMs, { type: 'barrier', ability: 'Arcane Barrier', granted: 0, absorbed, remaining: barrier });
    if (input.enemy.damageType === 'physical') {
      for (const armourClass of ['light', 'medium', 'heavy'] as const) {
        if (input.equippedStats.armourPieces.some(piece => piece.armourClass === armourClass && piece.armour > 0)) {
          emitSkillUse(atMs, ARMOUR_SKILLS[armourClass], 1);
        }
      }
    } else if (prevented > 0) {
      emitSkillUse(atMs, 'Warding', prevented);
    }
    if (damage > 0 && playerHitPoints > 0) emitSkillUse(atMs, 'Vitality', damage);
  };

  const timeoutMs = SOLO_COMBAT_TIMEOUT_SECONDS * 1_000;
  const playerIntervalMs = Math.max(50, Math.round(derivedStats.attackInterval * 1_000));
  const enemyIntervalMs = Math.max(50, Math.round(finiteNonNegative(input.enemy.attackInterval) * 1_000));
  let nextPlayerAt = 0;
  let nextEnemyAt = enemyIntervalMs;
  let durationMs = 0;
  let termination: SoloCombatTermination | null = null;

  while (!termination) {
    const nextAt = Math.min(nextPlayerAt, nextEnemyAt);
    if (nextAt > timeoutMs) {
      durationMs = timeoutMs;
      termination = 'timeout';
      break;
    }
    durationMs = nextAt;
    if (nextPlayerAt === nextAt) {
      playerAttack(nextAt);
      nextPlayerAt += playerIntervalMs;
      if (enemyHitPoints <= 0) {
        termination = 'enemy-defeated';
        break;
      }
    }
    if (nextEnemyAt === nextAt) {
      enemyAttack(nextAt);
      nextEnemyAt += enemyIntervalMs;
      if (playerHitPoints <= 0) {
        termination = 'player-defeated';
        break;
      }
      tryDefensiveAbility(nextAt);
    }
    if (nextAt === timeoutMs) {
      termination = 'timeout';
      break;
    }
  }

  const outcome = termination === 'enemy-defeated' ? 'victory' : 'defeat';
  const playerRate = counters.playerAttempts ? counters.playerHits / counters.playerAttempts : 0;
  const enemyRate = counters.enemyAttempts ? counters.enemyHits / counters.enemyAttempts : 0;
  const metrics: SoloCombatMetrics = {
    damage: {
      dealt: round(counters.damageDealt),
      physicalDealt: round(counters.physicalDealt),
      magicalDealt: round(counters.magicalDealt),
      taken: round(counters.damageTaken),
      prevented: round(counters.preventedByMitigation + counters.barrierAbsorbed)
    },
    hitRate: {
      playerAttempts: counters.playerAttempts,
      playerHits: counters.playerHits,
      playerRate: round(playerRate),
      enemyAttempts: counters.enemyAttempts,
      enemyHits: counters.enemyHits,
      enemyRate: round(enemyRate)
    },
    mitigation: {
      armourRate: derivedStats.armourMitigation,
      magicalRate: derivedStats.magicalMitigation,
      preventedByArmourOrWard: round(counters.preventedByMitigation),
      barrierAbsorbed: round(counters.barrierAbsorbed)
    },
    sustain: {
      healing: round(counters.healing),
      overhealing: round(counters.overhealing),
      barrierGranted: round(counters.barrierGranted),
      barrierAbsorbed: round(counters.barrierAbsorbed)
    },
    durationSeconds: round(durationMs / 1_000, 3),
    timeout: termination === 'timeout',
    defeatReason: null
  };
  metrics.defeatReason = diagnoseDefeat(termination, input, metrics);
  emit(durationMs, { type: 'encounter-ended', outcome, termination, durationMs });

  return {
    stage,
    seed,
    outcome,
    termination,
    timedOut: termination === 'timeout',
    effectiveTechnique,
    playerHitPointsRemaining: round(playerHitPoints),
    enemyHitPointsRemaining: round(enemyHitPoints),
    enemyHealthRemovedPercent: round(clamp((enemyMaxHitPoints - enemyHitPoints) / enemyMaxHitPoints * 100, 0, 100)),
    warnings: Object.freeze(warnings),
    derivedStats,
    events: Object.freeze(events),
    skillEvents: Object.freeze(skillEvents),
    metrics
  };
}
