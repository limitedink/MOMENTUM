import type { CombatSkillId } from '../combat-progression';
import { combatEffectConditionMatches, type CombatModifierContext, type CombatTreeEffectDefinition } from '../combat-development';
import { SOLO_COMBAT_TIMEOUT_SECONDS, SOLO_FRONTIER_BALANCE, STANCE_MODIFIERS, STARTER_ABILITY_TUNING } from './solo-frontier-definitions';
import {
  AURA_IDS,
  DEFENSIVE_ABILITY_IDS,
  TECHNIQUE_IDS,
  type ArmourClass,
  type CombatRecoverySource,
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

export const TECHNIQUE_STYLES = Object.freeze({
  'Power Strike': Object.freeze(['light-melee', 'medium-melee', 'heavy-melee'] as const),
  'Burst Fire': Object.freeze(['gun'] as const),
  'Piercing Shot': Object.freeze(['ranged'] as const),
  'Arc Bolt': Object.freeze(['magic'] as const)
}) satisfies Readonly<Record<TechniqueId, readonly WeaponStyle[]>>;

export const TECHNIQUE_BY_WEAPON_STYLE: Readonly<Record<WeaponStyle, TechniqueId>> = Object.freeze({
  'light-melee': 'Power Strike',
  'medium-melee': 'Power Strike',
  'heavy-melee': 'Power Strike',
  gun: 'Burst Fire',
  ranged: 'Piercing Shot',
  magic: 'Arc Bolt'
});

export function compatibleTechniqueForWeaponStyle(style: WeaponStyle): TechniqueId {
  return TECHNIQUE_BY_WEAPON_STYLE[style];
}

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
  const baseStance = STANCE_MODIFIERS[input.stance] ?? STANCE_MODIFIERS.Balanced;
  const modifiers = input.combatModifiers?.static;
  const stanceBonus = finiteNonNegative(modifiers?.stanceBonusPct);
  const stancePenaltyReduction = clamp(finiteNonNegative(modifiers?.stancePenaltyReductionPct), 0, 1);
  const adjustStance = (value: number): number => value >= 1
    ? 1 + (value - 1) * (1 + stanceBonus)
    : 1 - (1 - value) * (1 - stancePenaltyReduction);
  const stance = {
    damage: adjustStance(baseStance.damage),
    attackInterval: adjustStance(baseStance.attackInterval),
    armour: adjustStance(baseStance.armour),
    ward: adjustStance(baseStance.ward)
  };
  const reflexReduction = Math.min(0.35, 0.002 * skill(input, 'Reflexes'));
  const accuracy = finiteNonNegative(input.equippedStats.accuracy)
    + finiteNonNegative(input.activeWeapon.accuracy)
    + weaponAccuracySkill(input)
    + finiteNonNegative(modifiers?.accuracyFlat);
  const evasion = finiteNonNegative(input.equippedStats.evasion) + skill(input, 'Evasion');
  const armour = proficientArmour(input) * stance.armour;
  const ward = finiteNonNegative(input.equippedStats.ward) * stance.ward;
  const damage = (finiteNonNegative(input.activeWeapon.damage) + finiteNonNegative(input.equippedStats.damage))
    * weaponMultiplier(input)
    * weaponStyleDamageMultiplier(input.activeWeapon.style)
    * stance.damage
    * (1 + finiteNonNegative(modifiers?.damagePct) + finiteNonNegative(modifiers?.bossDamagePct));
  const attackInterval = Math.max(
    0.05,
    finiteNonNegative(input.activeWeapon.attackInterval)
      * (1 - reflexReduction)
      * stance.attackInterval
      * (1 - clamp(Number(modifiers?.attackSpeedPct) || 0, -0.30, 0.30))
  );
  const criticalChance = clamp(0.05 + finiteNonNegative(input.equippedStats.criticalChanceBonus) + finiteNonNegative(modifiers?.criticalChance), 0, 0.60);
  const criticalMultiplier = Math.max(1, 1.5 + finiteNonNegative(input.equippedStats.criticalMultiplierBonus) + finiteNonNegative(modifiers?.criticalMultiplier));
  const playerHitChance = clamp(
    Math.max(finiteNonNegative(modifiers?.hitChanceFloor), calculateHitChance(accuracy, input.enemy.evasion) + (Number(modifiers?.hitChanceBonus) || 0)),
    0.20,
    0.98
  );
  return Object.freeze({
    maxHitPoints: round(
      (100 + 2 * skill(input, 'Vitality') + finiteNonNegative(input.equippedStats.hitPoints))
      * (1 + clamp(finiteNonNegative(modifiers?.maxHitPointsPct), 0, 0.40))
    ),
    damage: round(damage),
    accuracy: round(accuracy),
    evasion: round(evasion),
    armour: round(armour),
    ward: round(ward),
    attackInterval: round(attackInterval),
    criticalChance: round(criticalChance),
    criticalMultiplier: round(criticalMultiplier),
    playerHitChance: round(playerHitChance),
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

function resolveTechnique(input: SoloCombatInput, warnings: string[]): TechniqueId {
  const compatibleTechnique = compatibleTechniqueForWeaponStyle(input.activeWeapon.style);
  const technique = TECHNIQUE_IDS.find(candidate => candidate === input.technique);
  if (!technique) {
    warnings.push(`Unknown weapon technique "${input.technique}"; ${compatibleTechnique} used instead.`);
    return compatibleTechnique;
  }
  if (!(TECHNIQUE_STYLES[technique] as readonly WeaponStyle[]).includes(input.activeWeapon.style)) {
    warnings.push(`Weapon technique "${technique}" is incompatible with ${input.activeWeapon.style}; ${compatibleTechnique} used instead.`);
    return compatibleTechnique;
  }
  return technique;
}

function techniqueCooldownMs(technique: TechniqueId): number {
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
  const modifierEffects = input.combatModifiers?.effects ?? [];
  const initialModifiers = input.combatModifiers?.static;
  const effectUses = new Map<string, number>();
  const triggerCharges = new Map<string, number>();
  let actionCount = 0;
  let techniqueCount = 0;
  let consecutiveHits = 0;
  let consecutiveMisses = 0;
  let reflexTempoStacks = 0;
  let afterMiss = false;
  let afterEnemyMiss = false;
  let afterDamage = false;
  let afterDamageCharges = 0;
  let lastDefensiveCooldownReductionAt = Number.NEGATIVE_INFINITY;
  let targetMarked = false;
  let armourShredPct = 0;
  let armourShredFlat = 0;
  let recoveryReserve = 0;
  let minimumHealthRatio = 1;
  let belowHalfSince: number | null = null;
  let defensiveReadyAt = 0;
  let techniqueReadyAt = 0;
  let emergencyAttackSpeedCharges = 0;
  let emergencyAttackSpeedPct = 0;
  let automaticDefensiveSuppressed = false;
  interface DotTick { effectId: string; dot: 'bleed' | 'burn'; nextAt: number; tickDamage: number; remaining: number; }
  interface RecoveryTick {
    effectId: string;
    source: CombatRecoverySource;
    nextAt: number;
    tickHealing: number;
    remaining: number;
    alreadyScaled: boolean;
  }
  const dotTicks: DotTick[] = [];
  const recoveryTicks: RecoveryTick[] = [];
  const healingBySource = Object.fromEntries([
    'mend',
    'mend-echo',
    'mend-hot',
    'regeneration',
    'damage-recovery',
    'recovery-reserve',
    'emergency',
    'fatal-guard'
  ].map(source => [source, 0])) as Record<CombatRecoverySource, number>;
  const counters = {
    damageDealt: 0,
    physicalDealt: 0,
    magicalDealt: 0,
    damageTaken: 0,
    preventedByMitigation: 0,
    barrierAbsorbed: 0,
    healing: 0,
    overhealing: 0,
    mendCasts: 0,
    reserveStored: 0,
    reserveReleased: 0,
    damageRecovered: 0,
    sustainPrevented: 0,
    cooldownRemovedMs: 0,
    emergencyTriggers: 0,
    fatalGuards: 0,
    timeBelowHalfMs: 0,
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

  const modifierContext = (action?: string, overrides: Partial<CombatModifierContext> = {}): CombatModifierContext => {
    const isTechnique = Boolean(action && action !== BASIC_ATTACK);
    return ({
    style: input.activeWeapon.style,
    technique: isTechnique ? action : undefined,
    stance: input.stance,
    aura: aura || undefined,
    defensiveAbility: defensiveAbility || undefined,
    boss: input.enemy.kind === 'boss',
    enemyWarded: input.enemy.ward > 0,
    enemyHealthRatio: enemyHitPoints / enemyMaxHitPoints,
    playerHealthRatio: playerHitPoints / derivedStats.maxHitPoints,
    displayedHitChance: derivedStats.playerHitChance,
    baseInterval: input.activeWeapon.attackInterval,
    burning: dotTicks.some(tick => tick.dot === 'burn' && tick.remaining > 0),
    marked: targetMarked,
    maximumShred: armourShredPct >= 0.20 || armourShredFlat >= 10,
    isTechnique,
    ...overrides
  });
  };

  const activeEffects = <TKind extends CombatTreeEffectDefinition['kind']>(
    kind: TKind,
    context: CombatModifierContext
  ): Extract<CombatTreeEffectDefinition, { kind: TKind }>[] => modifierEffects
    .filter((effect): effect is Extract<CombatTreeEffectDefinition, { kind: TKind }> =>
      effect.kind === kind && combatEffectConditionMatches(effect.condition, context));

  const statTotal = (statId: Extract<CombatTreeEffectDefinition, { kind: 'stat' }>['stat'], context: CombatModifierContext): number =>
    activeEffects('stat', context).filter(effect => effect.stat === statId).reduce((sum, effect) => sum + effect.value, 0);

  const strongestByFamily = (
    effects: Extract<CombatTreeEffectDefinition, { kind: 'trigger' }>[]
  ): Extract<CombatTreeEffectDefinition, { kind: 'trigger' }>[] => {
    const selected = new Map<string, Extract<CombatTreeEffectDefinition, { kind: 'trigger' }>>();
    const independent: Extract<CombatTreeEffectDefinition, { kind: 'trigger' }>[] = [];
    effects.forEach(effect => {
      if (!effect.family) {
        independent.push(effect);
        return;
      }
      const current = selected.get(effect.family);
      if (!current || (effect.priority || 0) > (current.priority || 0)) selected.set(effect.family, effect);
    });
    return [...independent, ...selected.values()];
  };

  const triggerSatisfied = (
    effect: Extract<CombatTreeEffectDefinition, { kind: 'trigger' }>,
    context: CombatModifierContext,
    critical = false
  ): boolean => {
    if (!combatEffectConditionMatches(effect.condition, context)) return false;
    const chargedAfterDamage = effect.trigger === 'after-damage' && Boolean(effect.limit && effect.limit > 1);
    if (!chargedAfterDamage && effect.limit && (effectUses.get(effect.id) || 0) >= effect.limit) return false;
    if (effect.trigger === 'first-hit') return counters.playerHits < Math.max(1, effect.limit || 1);
    if (effect.trigger === 'first-technique') return techniqueCount === 1;
    if (effect.trigger === 'technique') return Boolean(context.isTechnique);
    if (effect.trigger === 'nth-action') return Boolean(effect.every && actionCount > 0 && actionCount % effect.every === 0);
    if (effect.trigger === 'nth-hit') return Boolean(effect.every && (counters.playerHits + 1) % effect.every === 0);
    if (effect.trigger === 'after-miss') return afterMiss;
    if (effect.trigger === 'after-enemy-miss') return afterEnemyMiss;
    if (effect.trigger === 'after-damage') return afterDamage || (chargedAfterDamage && afterDamageCharges > 0);
    if (effect.trigger === 'after-mend') return (triggerCharges.get(effect.id) || 0) > 0;
    if (effect.trigger === 'after-technique') return Boolean(context.isTechnique);
    if (effect.trigger === 'health-threshold') return Boolean(context.enemyHealthRatio !== undefined && context.enemyHealthRatio < (effect.condition?.enemyHealthBelow ?? 1))
      || Boolean(context.playerHealthRatio !== undefined && context.playerHealthRatio < (effect.condition?.playerHealthBelow ?? 0));
    if (effect.trigger === 'critical-hit' || effect.trigger === 'critical-technique') return critical;
    if (effect.trigger === 'maximum-shred') return Boolean(context.maximumShred);
    return false;
  };

  const triggered = (
    outcome: Extract<CombatTreeEffectDefinition, { kind: 'trigger' }>['outcome'],
    context: CombatModifierContext,
    critical = false,
    consume = false
  ): Extract<CombatTreeEffectDefinition, { kind: 'trigger' }>[] => {
    const matches = strongestByFamily(activeEffects('trigger', context)
      .filter(effect => effect.outcome === outcome && triggerSatisfied(effect, context, critical)));
    if (consume) matches.forEach(effect => {
      if (effect.trigger === 'after-damage' && effect.limit && effect.limit > 1) return;
      effectUses.set(effect.id, (effectUses.get(effect.id) || 0) + 1);
    });
    return matches;
  };

  const specialActive = (specialId: Extract<CombatTreeEffectDefinition, { kind: 'special' }>['special'], context: CombatModifierContext): boolean =>
    activeEffects('special', context).some(effect => effect.special === specialId);

  const recordHealthBand = (atMs: number): void => {
    const ratio = clamp(playerHitPoints / Math.max(1, derivedStats.maxHitPoints), 0, 1);
    minimumHealthRatio = Math.min(minimumHealthRatio, ratio);
    if (ratio < 0.50 && belowHalfSince === null) belowHalfSince = atMs;
    if (ratio >= 0.50 && belowHalfSince !== null) {
      counters.timeBelowHalfMs += Math.max(0, atMs - belowHalfSince);
      belowHalfSince = null;
    }
  };

  const applyRecovery = (
    atMs: number,
    source: CombatRecoverySource,
    requestedAmount: number,
    emitEvent = true,
    alreadyScaled = false
  ): { applied: number; overhealing: number } => {
    const healingBonus = alreadyScaled ? 0 : clamp(statTotal('healingPct', modifierContext()), 0, 0.75);
    const healing = Math.max(0, requestedAmount) * (1 + healingBonus);
    const missing = Math.max(0, derivedStats.maxHitPoints - playerHitPoints);
    const applied = Math.min(missing, healing);
    const overhealing = Math.max(0, healing - applied);
    playerHitPoints = round(playerHitPoints + applied);
    counters.healing += applied;
    counters.overhealing += overhealing;
    healingBySource[source] += applied;
    if (source === 'damage-recovery') counters.damageRecovered += applied;
    if (source === 'recovery-reserve') counters.reserveReleased += applied;
    if (emitEvent) {
      if (source === 'mend') emit(atMs, { type: 'healing', ability: 'Mend', amount: round(applied), overhealing: round(overhealing), playerHitPoints });
      else emit(atMs, { type: 'recovery', source, amount: round(applied), overhealing: round(overhealing), playerHitPoints });
    }
    recordHealthBand(atMs);
    return { applied, overhealing };
  };

  const scheduleRecovery = (
    atMs: number,
    effectId: string,
    source: CombatRecoverySource,
    totalHealing: number,
    durationSeconds: number,
    alreadyScaled = false
  ): void => {
    const ticks = Math.max(1, Math.round(durationSeconds));
    if (totalHealing <= 0) return;
    recoveryTicks.push({
      effectId,
      source,
      nextAt: atMs + 1_000,
      tickHealing: totalHealing / ticks,
      remaining: ticks,
      alreadyScaled
    });
  };

  const strongestRecovery = (
    recoveryId: Extract<CombatTreeEffectDefinition, { kind: 'recovery' }>['recovery'],
    context: CombatModifierContext
  ): Extract<CombatTreeEffectDefinition, { kind: 'recovery' }> | undefined =>
    activeEffects('recovery', context)
      .filter(effect => effect.recovery === recoveryId)
      .sort((left, right) => (right.priority || 0) - (left.priority || 0) || right.value - left.value)[0];

  const strongestReserve = (context: CombatModifierContext): Extract<CombatTreeEffectDefinition, { kind: 'reserve' }> | undefined =>
    activeEffects('reserve', context)
      .sort((left, right) => (right.priority || 0) - (left.priority || 0) || right.capPctMaxHitPoints - left.capPctMaxHitPoints)[0];

  const strongestEmergency = (
    predicate: (effect: Extract<CombatTreeEffectDefinition, { kind: 'emergency' }>) => boolean,
    context: CombatModifierContext
  ): Extract<CombatTreeEffectDefinition, { kind: 'emergency' }> | undefined =>
    activeEffects('emergency', context)
      .filter(effect => predicate(effect) && (effectUses.get(effect.id) || 0) < effect.limit)
      .sort((left, right) => (right.priority || 0) - (left.priority || 0))[0];

  const armAfterMendTriggers = (context: CombatModifierContext): void => {
    const chargedOutcomes = new Set(['damage', 'accuracy', 'attack-speed', 'guarantee-hit', 'guarantee-critical']);
    strongestByFamily(activeEffects('trigger', context)
      .filter(effect => effect.trigger === 'after-mend' && chargedOutcomes.has(effect.outcome)))
      .forEach(effect => triggerCharges.set(effect.id, Math.max(1, effect.count || 1)));
  };

  const consumeAfterMendCharges = (): void => {
    for (const [effectId, charges] of triggerCharges) {
      if (charges <= 1) triggerCharges.delete(effectId);
      else triggerCharges.set(effectId, charges - 1);
    }
  };

  const triggerReductionValue = (
    effect: Extract<CombatTreeEffectDefinition, { kind: 'trigger' }>,
    overhealing = 0
  ): number => {
    if (effect.scale !== 'overheal-pct-max-hit-points') return Math.max(0, effect.value);
    const ratio = overhealing / Math.max(1, derivedStats.maxHitPoints);
    const scaled = Math.floor(ratio / 0.10 + 1e-9);
    return clamp(scaled, effect.minimum || 0, effect.maximum || Number.POSITIVE_INFINITY);
  };

  const intervalScaleFor = (dynamicAttackSpeed: number): number => {
    const staticAttackSpeed = clamp(Number(initialModifiers?.attackSpeedPct) || 0, -0.30, 0.30);
    const totalAttackSpeed = clamp(staticAttackSpeed + dynamicAttackSpeed, -0.30, 0.30);
    return (1 - totalAttackSpeed) / Math.max(0.01, 1 - staticAttackSpeed);
  };

  const applySecondaryDamage = (
    atMs: number,
    action: string,
    rawDamage: number,
    damageType: DamageType,
    mitigation: number
  ): number => {
    const calculatedDamage = rawDamage > 0 ? Math.max(1, Math.round(rawDamage * (1 - mitigation))) : 0;
    const damage = Math.min(enemyHitPoints, calculatedDamage);
    enemyHitPoints = Math.max(0, round(enemyHitPoints - damage));
    counters.damageDealt += damage;
    if (damageType === 'magical') counters.magicalDealt += damage;
    else counters.physicalDealt += damage;
    emit(atMs, { type: 'attack', actor: 'player', action, hit: true, critical: false, damageType, rawDamage: round(rawDamage), damage, targetHitPoints: enemyHitPoints });
    return damage;
  };

  const scheduleDots = (atMs: number, context: CombatModifierContext, directDamage: number, critical: boolean): void => {
    for (const dotType of ['bleed', 'burn'] as const) {
      const candidates = activeEffects('dot', context).filter(effect => effect.dot === dotType);
      if (!candidates.length || directDamage <= 0) continue;
      const effect = candidates.sort((left, right) => right.damagePct - left.damagePct || right.maximumStacks - left.maximumStacks)[0];
      const criticalScale = critical && specialActive('critical-dot-double', context) ? 2 : effect.criticalMultiplier || 1;
      const ticks = Math.max(1, Math.round(effect.durationSeconds));
      const matching = dotTicks.filter(tick => tick.effectId === effect.id);
      while (matching.length >= effect.maximumStacks) {
        const oldest = matching.shift();
        if (oldest) dotTicks.splice(dotTicks.indexOf(oldest), 1);
      }
      dotTicks.push({
        effectId: effect.id,
        dot: dotType,
        nextAt: atMs + 1_000,
        tickDamage: Math.max(1, directDamage * effect.damagePct * criticalScale / ticks),
        remaining: ticks
      });
    }
  };

  emit(0, { type: 'encounter-started', stage, playerHitPoints, enemyHitPoints });
  let auraDamageMultiplier = 1;
  if (aura === 'Battle Focus') {
    const supportScaling = 1 + 0.005 * skill(input, 'Support Magic');
    const damageBonus = STARTER_ABILITY_TUNING['Battle Focus'].baseDamageBonus * supportScaling
      + clamp(statTotal('auraDamageBonus', modifierContext()), 0, 0.10);
    auraDamageMultiplier += damageBonus;
    emit(0, { type: 'aura-activated', ability: aura, damageBonus: round(damageBonus) });
    emitSkillUse(0, 'Support Magic', 1);
  }

  const performMend = (
    atMs: number,
    multiplier = 1,
    consumeCooldown = true,
    treeGenerated = false
  ): { applied: number; overhealing: number } => {
    const context = modifierContext(undefined);
    const healingBonus = clamp(statTotal('healingPct', context), 0, 0.75);
    const healing = Math.round(
      STARTER_ABILITY_TUNING.Mend.baseHealing
      * (1 + 0.006 * skill(input, 'Healing'))
      * (1 + healingBonus)
      * Math.max(0, multiplier)
    );
    counters.mendCasts += 1;
    emit(atMs, { type: 'ability-used', actor: 'player', ability: 'Mend', effect: 'heal' });
    const result = applyRecovery(atMs, treeGenerated ? 'emergency' : 'mend', healing, true, true);

    if (consumeCooldown) {
      const cooldownReduction = clamp(statTotal('mendCooldownPct', context), 0, 0.40);
      defensiveReadyAt = atMs + STARTER_ABILITY_TUNING.Mend.cooldownSeconds * 1_000 * (1 - cooldownReduction);
    }

    if (!treeGenerated) {
      const mendContext = modifierContext(undefined, { overhealing: result.overhealing > 0 });
      const reserveEffect = strongestReserve(mendContext);
      if (reserveEffect && result.overhealing > 0) {
        const cap = derivedStats.maxHitPoints * Math.min(0.20, reserveEffect.capPctMaxHitPoints);
        const stored = Math.min(Math.max(0, cap - recoveryReserve), result.overhealing * reserveEffect.conversionPct);
        recoveryReserve = round(recoveryReserve + stored);
        counters.reserveStored += stored;
      }

      const echo = strongestRecovery('mend-echo', mendContext);
      if (echo && result.applied > 0) {
        scheduleRecovery(atMs, echo.id, 'mend-echo', result.applied * echo.value, echo.durationSeconds, true);
      }
      const hot = strongestRecovery('mend-hot', mendContext);
      if (hot) {
        scheduleRecovery(atMs, hot.id, 'mend-hot', derivedStats.maxHitPoints * hot.value, hot.durationSeconds);
      }

      const immediate = strongestByFamily(activeEffects('trigger', mendContext)
        .filter(effect => effect.trigger === 'after-mend'));
      immediate.forEach(effect => {
        if (effect.limit && (effectUses.get(effect.id) || 0) >= effect.limit) return;
        if (effect.outcome === 'reduce-technique-cooldown') {
          const remaining = Math.max(0, techniqueReadyAt - atMs);
          techniqueReadyAt = atMs + remaining * (1 - clamp(effect.value, 0, 0.40));
          counters.cooldownRemovedMs += remaining - Math.max(0, techniqueReadyAt - atMs);
        } else if (effect.outcome === 'ready-technique') {
          counters.cooldownRemovedMs += Math.max(0, techniqueReadyAt - atMs);
          techniqueReadyAt = atMs;
        } else if (effect.outcome === 'reduce-defensive-cooldown' && result.overhealing > 0) {
          const reductionMs = triggerReductionValue(effect, result.overhealing) * 1_000;
          const before = defensiveReadyAt;
          defensiveReadyAt = Math.max(atMs, defensiveReadyAt - reductionMs);
          counters.cooldownRemovedMs += Math.max(0, before - defensiveReadyAt);
        } else {
          return;
        }
        if (effect.limit) effectUses.set(effect.id, (effectUses.get(effect.id) || 0) + 1);
      });
      armAfterMendTriggers(mendContext);
      emitSkillUse(atMs, 'Healing', result.applied || 1);
    }
    return result;
  };

  const tryDefensiveAbility = (atMs: number): void => {
    if (!defensiveAbility || atMs < defensiveReadyAt) return;
    if (defensiveAbility === 'Mend') {
      const threshold = Math.min(
        0.85,
        STARTER_ABILITY_TUNING.Mend.useBelowHealthPercent
          + clamp(statTotal('mendThresholdBonus', modifierContext()), 0, 0.10)
      );
      if (playerHitPoints / derivedStats.maxHitPoints > threshold) return;
      performMend(atMs);
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

  let nextPlayerIntervalReduction = 0;
  const playerAttack = (atMs: number): void => {
    nextPlayerIntervalReduction = 0;
    const hadMendCharges = triggerCharges.size > 0;
    const useTechnique = atMs >= techniqueReadyAt;
    const action = useTechnique ? effectiveTechnique : BASIC_ATTACK;
    actionCount += 1;
    if (useTechnique) {
      techniqueCount += 1;
      const context = modifierContext(action);
      const cooldownReduction = clamp(statTotal('techniqueCooldownPct', context), 0, 0.40);
      const baseCooldownIncrease = Math.max(0, statTotal('baseTechniqueCooldownPct', context));
      techniqueReadyAt = atMs + techniqueCooldownMs(effectiveTechnique) * (1 + baseCooldownIncrease) * (1 - cooldownReduction);
      emit(atMs, { type: 'ability-used', actor: 'player', ability: effectiveTechnique, effect: 'attack' });
      const techniqueTriggers = strongestByFamily(activeEffects('trigger', context)
        .filter(effect => effect.trigger === 'after-technique'));
      techniqueTriggers.forEach(effect => {
        if (effect.limit && (effectUses.get(effect.id) || 0) >= effect.limit) return;
        if (effect.outcome === 'reduce-defensive-cooldown') {
          const before = defensiveReadyAt;
          defensiveReadyAt = Math.max(atMs, defensiveReadyAt - Math.max(0, effect.value) * 1_000);
          counters.cooldownRemovedMs += Math.max(0, before - defensiveReadyAt);
        } else if (effect.outcome === 'ready-defensive') {
          counters.cooldownRemovedMs += Math.max(0, defensiveReadyAt - atMs);
          defensiveReadyAt = atMs;
        } else {
          return;
        }
        if (effect.limit) effectUses.set(effect.id, (effectUses.get(effect.id) || 0) + 1);
      });
    }
    const actionContext = modifierContext(action);
    const actionIntervalBonus = triggered('attack-speed', actionContext, false, true)
      .reduce((sum, effect) => sum + effect.value, 0);
    const baseAttacks = action === 'Burst Fire' ? STARTER_ABILITY_TUNING['Burst Fire'].projectileCount : 1;
    const projectileEffects = activeEffects('trigger', actionContext)
      .filter(effect => effect.outcome === 'add-projectile'
        && triggerSatisfied(effect, actionContext));
    const extraProjectiles = useTechnique
      ? projectileEffects.reduce((sum, effect) => sum + Math.max(1, effect.count || 1), 0)
      : 0;
    const attacks = baseAttacks + extraProjectiles;
    for (let attackIndex = 0; attackIndex < attacks && enemyHitPoints > 0; attackIndex += 1) {
      counters.playerAttempts += 1;
      const context = modifierContext(action);
      const currentAccuracy = statTotal('accuracyFlat', context);
      const initialAccuracy = Number(initialModifiers?.accuracyFlat) || 0;
      const recoveryAccuracy = triggered('accuracy', context, false, true).reduce((sum, effect) => sum + effect.value, 0);
      const dynamicHitChance = clamp(
        Math.max(
          statTotal('hitChanceFloor', context),
          derivedStats.playerHitChance
            + (currentAccuracy - initialAccuracy) * 0.005
            + recoveryAccuracy * 0.005
            + statTotal('hitChanceBonus', context)
            - (Number(initialModifiers?.hitChanceBonus) || 0)
            + (useTechnique ? statTotal('techniqueHitChanceBonus', context) : 0)
        ),
        0.20,
        0.98
      );
      const guaranteedHit = triggered('guarantee-hit', context, false, true).length > 0
        || specialActive('second-miss-converts', context) && consecutiveMisses >= 1
        || activeEffects('special', context).some(effect => effect.special === 'miss-conversion-every' && counters.playerAttempts % Math.max(1, effect.value) === 0);
      const hit = guaranteedHit || random() < dynamicHitChance;
      if (!hit) {
        emit(atMs, { type: 'attack', actor: 'player', action, hit: false, critical: false, damageType: weaponDamageType(input), rawDamage: 0, damage: 0, targetHitPoints: enemyHitPoints });
        emitWeaponSkillUse(atMs, false);
        consecutiveMisses += 1;
        afterMiss = true;
        const streakEffect = activeEffects('streak', context).sort((left, right) => right.maxStacks - left.maxStacks || right.damagePerStack - left.damagePerStack)[0];
        const tempoEffect = activeEffects('tempo', context)
          .sort((left, right) => right.attackSpeedPerStack - left.attackSpeedPerStack || right.maxStacks - left.maxStacks)[0];
        if (tempoEffect) {
          reflexTempoStacks = tempoEffect.missBehavior === 'remove-one'
            ? Math.max(0, reflexTempoStacks - 1)
            : 0;
        }
        if (specialActive('miss-preserves-streak', context)) {
          // Deliberately retain the shared Strength hit chain.
        } else if (!streakEffect || streakEffect.missBehavior === 'reset' || !streakEffect.missBehavior) consecutiveHits = 0;
        else if (streakEffect.missBehavior === 'remove-one') consecutiveHits = Math.max(0, consecutiveHits - 1);
        continue;
      }
      const dynamicCriticalChance = clamp(
        derivedStats.criticalChance + statTotal('criticalChance', context) - (Number(initialModifiers?.criticalChance) || 0),
        0,
        0.60
      );
      const guaranteeCriticalEffects = triggered('guarantee-critical', context, false, true);
      const guaranteeCritical = guaranteeCriticalEffects.length > 0;
      const critical = guaranteeCritical || random() < dynamicCriticalChance;
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
      const initialDamagePct = (Number(initialModifiers?.damagePct) || 0) + (Number(initialModifiers?.bossDamagePct) || 0);
      const currentDamagePct = statTotal('damagePct', context) + statTotal('bossDamagePct', context);
      const dynamicDamageRatio = (1 + currentDamagePct) / Math.max(0.01, 1 + initialDamagePct);
      const triggerDamage = triggered('damage', context, critical, true).reduce((sum, effect) => sum + effect.value, 0);
      const streakEffect = activeEffects('streak', context).sort((left, right) => right.maxStacks - left.maxStacks || right.damagePerStack - left.damagePerStack)[0];
      const streakDamage = streakEffect ? Math.min(consecutiveHits, streakEffect.maxStacks) * streakEffect.damagePerStack : 0;
      const techniqueDamage = useTechnique ? statTotal('techniqueDamagePct', context) : 0;
      const markDamage = targetMarked
        ? activeEffects('mark', context).reduce((best, effect) => Math.max(best, effect.damagePct + (input.enemy.kind === 'boss' ? effect.bossDamagePct || 0 : 0)), 0)
        : 0;
      const extraProjectileScale = attackIndex >= baseAttacks
        ? projectileEffects[Math.min(projectileEffects.length - 1, attackIndex - baseAttacks)]?.value || 0.5
        : 1;
      const currentCriticalMultiplier = Math.max(
        1,
        derivedStats.criticalMultiplier
          + statTotal('criticalMultiplier', context)
          - (Number(initialModifiers?.criticalMultiplier) || 0)
          + guaranteeCriticalEffects.filter(effect => effect.value > 0 && effect.value < 1).reduce((sum, effect) => sum + effect.value, 0)
      );
      const rawDamage = derivedStats.damage
        * auraDamageMultiplier
        * actionMultiplier
        * dynamicDamageRatio
        * (1 + techniqueDamage + triggerDamage + streakDamage + markDamage)
        * extraProjectileScale
        * (critical ? currentCriticalMultiplier : 1);
      const penetration = damageType === 'magical'
        ? Math.min(60, statTotal('wardPenetration', context) + (critical ? statTotal('criticalWardPenetration', context) : 0))
        : Math.min(60, statTotal('armourPenetration', context) + (critical ? statTotal('criticalArmourPenetration', context) : 0) + armourShredFlat);
      const ignoresMitigation = damageType === 'magical'
        ? specialActive('ignore-ward', context)
        : specialActive('ignore-armour', context);
      const mitigation = ignoresMitigation
        ? 0
        : damageType === 'magical'
          ? calculateMagicalMitigation(Math.max(0, input.enemy.ward - penetration), stage)
          : calculateArmourMitigation(Math.max(0, input.enemy.armour * (1 - armourIgnored) * (1 - armourShredPct) - penetration), stage);
      const calculatedDamage = rawDamage > 0 ? Math.max(1, Math.round(rawDamage * (1 - mitigation))) : 0;
      const damage = Math.min(enemyHitPoints, calculatedDamage);
      enemyHitPoints = Math.max(0, round(enemyHitPoints - damage));
      counters.playerHits += 1;
      counters.damageDealt += damage;
      if (damageType === 'magical') counters.magicalDealt += damage;
      else counters.physicalDealt += damage;
      emit(atMs, { type: 'attack', actor: 'player', action, hit: true, critical, damageType, rawDamage: round(rawDamage), damage, targetHitPoints: enemyHitPoints });
      emitWeaponSkillUse(atMs, true);
      consecutiveHits += 1;
      const tempoEffect = activeEffects('tempo', context)
        .sort((left, right) => right.attackSpeedPerStack - left.attackSpeedPerStack || right.maxStacks - left.maxStacks)[0];
      if (tempoEffect) reflexTempoStacks = Math.min(tempoEffect.maxStacks, reflexTempoStacks + 1);
      consecutiveMisses = 0;
      if (!targetMarked && activeEffects('mark', context).length) targetMarked = true;
      const shredEffects = activeEffects('shred', context).filter(effect => !effect.techniqueOnly || useTechnique);
      if (shredEffects.length) {
        const strongest = shredEffects.sort((left, right) => right.maximum - left.maximum || right.amount - left.amount)[0];
        if (strongest.amount <= 1) armourShredPct = Math.min(strongest.maximum, armourShredPct + strongest.amount);
        else armourShredFlat = Math.min(strongest.maximum, armourShredFlat + strongest.amount);
      }
      const consumeDotEffects = triggered('consume-dot', context, critical, true);
      if (critical && consumeDotEffects.length) {
        const burnValue = dotTicks.filter(tick => tick.dot === 'burn').reduce((sum, tick) => sum + tick.tickDamage * tick.remaining, 0);
        for (const tick of [...dotTicks]) if (tick.dot === 'burn') dotTicks.splice(dotTicks.indexOf(tick), 1);
        const consumeMultiplier = Math.max(...consumeDotEffects.map(effect => effect.value));
        if (burnValue > 0 && enemyHitPoints > 0) applySecondaryDamage(atMs, 'Phoenix Spark', burnValue * consumeMultiplier, 'magical', 0);
      }
      scheduleDots(atMs, context, damage, critical);
      const cullEffect = activeEffects('special', context).find(effect => effect.special === 'cull-once' && !effectUses.has(effect.id));
      if (cullEffect && enemyHitPoints > 0) {
        effectUses.set(cullEffect.id, 1);
        applySecondaryDamage(atMs, 'Cull the Weak', Math.min(derivedStats.damage, enemyMaxHitPoints * 0.10), damageType, 0);
      }
      if (useTechnique && specialActive('consume-exploit-stacks', context) && context.maximumShred) armourShredFlat = 0;
      const repeats = triggered('repeat', context, critical, true);
      if (repeats.length && enemyHitPoints > 0) {
        const repeatScale = repeats.reduce((sum, effect) => sum + effect.value, 0);
        applySecondaryDamage(atMs, `${action} · Repeat`, rawDamage * repeatScale, damageType, mitigation);
      }
      const cooldownEffects = triggered('reduce-technique-cooldown', context, critical, true);
      cooldownEffects.forEach(effect => {
        const remaining = Math.max(0, techniqueReadyAt - atMs);
        techniqueReadyAt = atMs + (effect.value > 1 ? Math.max(0, remaining - effect.value * 1_000) : remaining * (1 - effect.value));
      });
      afterMiss = false;
      afterEnemyMiss = false;
      afterDamage = false;
      afterDamageCharges = Math.max(0, afterDamageCharges - 1);
    }
    const tempoEffect = activeEffects('tempo', modifierContext(action))
      .sort((left, right) => right.attackSpeedPerStack - left.attackSpeedPerStack || right.maxStacks - left.maxStacks)[0];
    const tempoSpeed = tempoEffect ? reflexTempoStacks * tempoEffect.attackSpeedPerStack : 0;
    const emergencySpeed = emergencyAttackSpeedCharges > 0 ? emergencyAttackSpeedPct : 0;
    const conditionalSpeed = statTotal('attackSpeedPct', modifierContext(action))
      - (Number(initialModifiers?.attackSpeedPct) || 0);
    nextPlayerIntervalReduction = actionIntervalBonus + tempoSpeed + emergencySpeed + conditionalSpeed;
    if (emergencyAttackSpeedCharges > 0) emergencyAttackSpeedCharges -= 1;
    if (hadMendCharges) consumeAfterMendCharges();
  };

  const timeoutMs = SOLO_COMBAT_TIMEOUT_SECONDS * 1_000;
  const playerIntervalMs = Math.max(50, Math.round(derivedStats.attackInterval * 1_000));
  const enemyIntervalMs = Math.max(50, Math.round(finiteNonNegative(input.enemy.attackInterval) * 1_000));
  const regenerationPctPerSecond = clamp(statTotal('regenerationPctPerSecond', modifierContext()), 0, 0.01);
  let nextPlayerAt = 0;
  let nextEnemyAt = enemyIntervalMs;
  let nextRegenerationAt = regenerationPctPerSecond > 0 ? 1_000 : Number.POSITIVE_INFINITY;
  let durationMs = 0;
  let termination: SoloCombatTermination | null = null;
  const accelerateNextPlayerAttack = (atMs: number, context: CombatModifierContext): void => {
    const dynamicAttackSpeed = triggered('attack-speed', context, false, true).reduce((sum, effect) => sum + effect.value, 0);
    if (dynamicAttackSpeed <= 0) return;
    nextPlayerAt = Math.min(nextPlayerAt, atMs + Math.max(50, Math.round(playerIntervalMs * intervalScaleFor(dynamicAttackSpeed))));
  };

  const enemyAttack = (atMs: number): void => {
    automaticDefensiveSuppressed = false;
    counters.enemyAttempts += 1;
    const hit = random() < derivedStats.enemyHitChance;
    if (!hit) {
      emit(atMs, { type: 'attack', actor: 'enemy', action: 'Basic Attack', hit: false, critical: false, damageType: input.enemy.damageType, rawDamage: 0, damage: 0, targetHitPoints: playerHitPoints });
      emitSkillUse(atMs, 'Evasion', 1);
      emitSkillUse(atMs, 'Reflexes', 0.5);
      afterEnemyMiss = true;
      const context = modifierContext();
      const ready = triggered('ready-technique', context, false, true);
      if (ready.length) {
        counters.cooldownRemovedMs += Math.max(0, techniqueReadyAt - atMs);
        techniqueReadyAt = atMs;
      }
      accelerateNextPlayerAttack(atMs, context);
      return;
    }
    counters.enemyHits += 1;
    const rawDamage = finiteNonNegative(input.enemy.damage);
    const previousHitPoints = playerHitPoints;
    const previousRatio = previousHitPoints / Math.max(1, derivedStats.maxHitPoints);
    const preDamageContext = modifierContext(effectiveTechnique);
    const mitigation = input.enemy.damageType === 'magical' ? derivedStats.magicalMitigation : derivedStats.armourMitigation;
    const postMitigationBeforeSustain = rawDamage > 0 ? Math.max(1, Math.round(rawDamage * (1 - mitigation))) : 0;
    const sustainReduction = clamp(statTotal('damageTakenReductionPct', preDamageContext), 0, 0.15);
    const postMitigation = postMitigationBeforeSustain > 0
      ? Math.max(1, Math.round(postMitigationBeforeSustain * (1 - sustainReduction)))
      : 0;
    const prevented = Math.max(0, rawDamage - postMitigation);
    const sustainPrevented = Math.max(0, postMitigationBeforeSustain - postMitigation);
    counters.preventedByMitigation += Math.max(0, rawDamage - postMitigationBeforeSustain);
    counters.sustainPrevented += sustainPrevented;
    const absorbed = Math.min(barrier, postMitigation);
    barrier -= absorbed;
    counters.barrierAbsorbed += absorbed;
    const damage = Math.min(playerHitPoints, postMitigation - absorbed);
    playerHitPoints = Math.max(0, round(playerHitPoints - damage));
    counters.damageTaken += damage;
    const damagedHitPoints = playerHitPoints;
    recordHealthBand(atMs);
    emit(atMs, { type: 'attack', actor: 'enemy', action: 'Basic Attack', hit: true, critical: false, damageType: input.enemy.damageType, rawDamage, damage, targetHitPoints: damagedHitPoints });
    if (absorbed > 0) emit(atMs, { type: 'barrier', ability: 'Arcane Barrier', granted: 0, absorbed, remaining: barrier });

    if (damage > 0) {
      afterDamage = true;
      const context = modifierContext(effectiveTechnique);
      afterDamageCharges = Math.max(
        afterDamageCharges,
        ...activeEffects('trigger', context)
          .filter(effect => effect.trigger === 'after-damage' && effect.limit && effect.limit > 1)
          .map(effect => effect.limit || 0)
      );
      accelerateNextPlayerAttack(atMs, context);
      const streakEffect = activeEffects('streak', context).sort((left, right) => right.maxStacks - left.maxStacks || right.damagePerStack - left.damagePerStack)[0];
      if (streakEffect?.resetOnDamage) consecutiveHits = 0;
      const tempoEffect = activeEffects('tempo', context)
        .sort((left, right) => right.attackSpeedPerStack - left.attackSpeedPerStack || right.maxStacks - left.maxStacks)[0];
      if (tempoEffect) reflexTempoStacks = Math.max(0, reflexTempoStacks - tempoEffect.damageRemoves);
      if (triggered('ready-technique', context, false, true).length) {
        counters.cooldownRemovedMs += Math.max(0, techniqueReadyAt - atMs);
        techniqueReadyAt = atMs;
      }

      const defensiveRecovery = strongestByFamily(activeEffects('trigger', context)
        .filter(effect => effect.trigger === 'after-damage' && effect.outcome === 'reduce-defensive-cooldown'))[0];
      if (defensiveRecovery && atMs - lastDefensiveCooldownReductionAt >= 1_000) {
        const before = defensiveReadyAt;
        defensiveReadyAt = Math.max(atMs, defensiveReadyAt - Math.max(0, defensiveRecovery.value) * 1_000);
        counters.cooldownRemovedMs += Math.max(0, before - defensiveReadyAt);
        lastDefensiveCooldownReductionAt = atMs;
      }

      const damageRecovery = strongestRecovery('damage-recovery', context);
      if (damageRecovery) {
        const cap = derivedStats.maxHitPoints * Math.min(0.10, damageRecovery.capPctMaxHitPoints || 0.10);
        const pending = recoveryTicks
          .filter(tick => tick.source === 'damage-recovery')
          .reduce((sum, tick) => sum + tick.tickHealing * tick.remaining, 0);
        const recoverable = Math.min(Math.max(0, cap - pending), damage * Math.min(0.20, damageRecovery.value));
        scheduleRecovery(atMs, damageRecovery.id, 'damage-recovery', recoverable, damageRecovery.durationSeconds);
      }

      const reserveEffect = strongestReserve(context);
      if (reserveEffect && recoveryReserve > 0 && playerHitPoints / derivedStats.maxHitPoints <= reserveEffect.releaseBelow) {
        const reserveBeforeRelease = recoveryReserve;
        const released = applyRecovery(atMs, 'recovery-reserve', recoveryReserve, true, true);
        recoveryReserve = reserveEffect.retainUnused
          ? Math.max(0, reserveBeforeRelease - released.applied)
          : 0;
      }

      if (playerHitPoints <= 0) {
        const fatalGuard = strongestEmergency(effect => Boolean(effect.fatalGuardPctMaxHitPoints), modifierContext());
        if (fatalGuard) {
          effectUses.set(fatalGuard.id, (effectUses.get(fatalGuard.id) || 0) + 1);
          playerHitPoints = 1;
          applyRecovery(atMs, 'fatal-guard', derivedStats.maxHitPoints * (fatalGuard.fatalGuardPctMaxHitPoints || 0));
          counters.fatalGuards += 1;
          counters.emergencyTriggers += 1;
        }
      }

      if (playerHitPoints > 0) {
        const emergencyCandidates = activeEffects('emergency', modifierContext())
          .filter(effect =>
            !effect.fatalGuardPctMaxHitPoints
            && previousRatio > effect.threshold
            && playerHitPoints / derivedStats.maxHitPoints <= effect.threshold
            && (effectUses.get(effect.id) || 0) < effect.limit);
        const emergencyByFamily = new Map<string, Extract<CombatTreeEffectDefinition, { kind: 'emergency' }>>();
        emergencyCandidates.forEach(effect => {
          const family = effect.family || effect.id;
          const current = emergencyByFamily.get(family);
          if (!current || (effect.priority || 0) > (current.priority || 0)) emergencyByFamily.set(family, effect);
        });
        emergencyByFamily.forEach(effect => {
          effectUses.set(effect.id, (effectUses.get(effect.id) || 0) + 1);
          counters.emergencyTriggers += 1;
          if (effect.healPctMaxHitPoints) applyRecovery(atMs, 'emergency', derivedStats.maxHitPoints * effect.healPctMaxHitPoints);
          if (effect.freeMendMultiplier) {
            performMend(atMs, effect.freeMendMultiplier, false, true);
            automaticDefensiveSuppressed = true;
          }
          if (effect.readyDefensive) {
            counters.cooldownRemovedMs += Math.max(0, defensiveReadyAt - atMs);
            defensiveReadyAt = atMs;
          }
          if (effect.attackSpeedPct && effect.attackCount) {
            emergencyAttackSpeedPct = Math.max(emergencyAttackSpeedPct, effect.attackSpeedPct);
            emergencyAttackSpeedCharges = Math.max(emergencyAttackSpeedCharges, effect.attackCount);
          }
        });

        const thresholdRecovery = activeEffects('trigger', modifierContext())
          .filter(effect =>
            effect.trigger === 'health-threshold'
            && effect.outcome === 'reduce-defensive-cooldown'
            && previousRatio > (effect.condition?.playerHealthBelow || 0)
            && playerHitPoints / derivedStats.maxHitPoints <= (effect.condition?.playerHealthBelow || 0)
            && (!effect.limit || (effectUses.get(effect.id) || 0) < effect.limit));
        thresholdRecovery.forEach(effect => {
          const remaining = Math.max(0, defensiveReadyAt - atMs);
          defensiveReadyAt = atMs + remaining * (1 - clamp(effect.value, 0, 1));
          counters.cooldownRemovedMs += remaining - Math.max(0, defensiveReadyAt - atMs);
          effectUses.set(effect.id, (effectUses.get(effect.id) || 0) + 1);
        });
      }
    }
    if (input.enemy.damageType === 'physical') {
      for (const armourClass of ['light', 'medium', 'heavy'] as const) {
        if (input.equippedStats.armourPieces.some(piece => piece.armourClass === armourClass && piece.armour > 0)) {
          emitSkillUse(atMs, ARMOUR_SKILLS[armourClass], 1);
        }
      }
    } else if (prevented > 0) {
      emitSkillUse(atMs, 'Warding', Math.max(0, rawDamage - postMitigationBeforeSustain));
    }
    if (damage > 0 && playerHitPoints > 0) emitSkillUse(atMs, 'Vitality', damage);
  };

  while (!termination) {
    const nextDotAt = dotTicks.length ? Math.min(...dotTicks.map(tick => tick.nextAt)) : Number.POSITIVE_INFINITY;
    const nextRecoveryAt = recoveryTicks.length ? Math.min(...recoveryTicks.map(tick => tick.nextAt)) : Number.POSITIVE_INFINITY;
    const nextAt = Math.min(nextRecoveryAt, nextRegenerationAt, nextDotAt, nextPlayerAt, nextEnemyAt);
    if (nextAt > timeoutMs) {
      durationMs = timeoutMs;
      termination = 'timeout';
      break;
    }
    durationMs = nextAt;
    if (nextRecoveryAt === nextAt) {
      const due = recoveryTicks.filter(tick => tick.nextAt === nextAt);
      due.forEach(tick => {
        applyRecovery(nextAt, tick.source, tick.tickHealing, true, tick.alreadyScaled);
        tick.remaining -= 1;
        tick.nextAt += 1_000;
        if (tick.remaining <= 0) recoveryTicks.splice(recoveryTicks.indexOf(tick), 1);
      });
    }
    if (nextRegenerationAt === nextAt) {
      applyRecovery(nextAt, 'regeneration', derivedStats.maxHitPoints * regenerationPctPerSecond);
      nextRegenerationAt += 1_000;
    }
    if (nextDotAt === nextAt) {
      const due = dotTicks.filter(tick => tick.nextAt === nextAt);
      due.forEach(tick => {
        if (enemyHitPoints <= 0) return;
        applySecondaryDamage(nextAt, tick.dot === 'burn' ? 'Burn' : 'Bleed', tick.tickDamage, tick.dot === 'burn' ? 'magical' : 'physical', 0);
        tick.remaining -= 1;
        tick.nextAt += 1_000;
        if (tick.remaining <= 0) dotTicks.splice(dotTicks.indexOf(tick), 1);
      });
      if (enemyHitPoints <= 0) {
        termination = 'enemy-defeated';
        break;
      }
    }
    if (nextPlayerAt === nextAt) {
      playerAttack(nextAt);
      nextPlayerAt += Math.max(50, Math.round(playerIntervalMs * intervalScaleFor(nextPlayerIntervalReduction)));
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
      if (!automaticDefensiveSuppressed) tryDefensiveAbility(nextAt);
    }
    if (nextAt === timeoutMs) {
      termination = 'timeout';
      break;
    }
  }

  if (belowHalfSince !== null) {
    counters.timeBelowHalfMs += Math.max(0, durationMs - belowHalfSince);
    belowHalfSince = null;
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
      prevented: round(counters.preventedByMitigation + counters.sustainPrevented + counters.barrierAbsorbed)
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
      barrierAbsorbed: round(counters.barrierAbsorbed),
      healingBySource: Object.fromEntries(
        Object.entries(healingBySource).map(([source, amount]) => [source, round(amount)])
      ) as Record<CombatRecoverySource, number>,
      mendCasts: counters.mendCasts,
      reserveStored: round(counters.reserveStored),
      reserveReleased: round(counters.reserveReleased),
      damageRecovered: round(counters.damageRecovered),
      damagePrevented: round(counters.sustainPrevented),
      cooldownRemovedMs: round(counters.cooldownRemovedMs),
      emergencyTriggers: counters.emergencyTriggers,
      fatalGuards: counters.fatalGuards,
      minimumHealthRatio: round(minimumHealthRatio),
      timeBelowHalfMs: round(counters.timeBelowHalfMs)
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
