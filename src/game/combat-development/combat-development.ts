import {
  COMBAT_SKILL_IDS,
  MAX_COMBAT_SKILL_LEVEL,
  applyCombatSkillXp,
  normalizeCombatProgression,
  xpToNextCombatLevel,
  type CombatProgressionState,
  type CombatSkillId
} from '../combat-progression';
import {
  allocateSkillTreeNode,
  createSkillTreeState,
  defaultSkillTreeView,
  normalizeSkillTreeNodeIds,
  resetSkillTreeState
} from '../skills/skill-trees';
import type { SkillTreeState } from '../skills/skill-types';
import {
  HEAVY_MELEE_SKILL_TREE,
  LIGHT_MELEE_SKILL_TREE,
  MARKSMANSHIP_SKILL_TREE,
  MEDIUM_MELEE_SKILL_TREE,
  MELEE_ACCURACY_SKILL_TREE,
  OFFENSE_TREE_EFFECT_DEFINITIONS,
  OFFENSIVE_MAGIC_SKILL_TREE,
  RANGED_SKILL_TREE,
  STRENGTH_SKILL_TREE
} from './offense-tree-definitions';
import {
  HEALING_SKILL_TREE,
  REFLEXES_SKILL_TREE,
  SUPPORT_MAGIC_SKILL_TREE,
  SUSTAIN_TREE_EFFECT_DEFINITIONS,
  VITALITY_SKILL_TREE
} from './sustain-tree-definitions';
import {
  DEFENSE_COMBAT_SKILL_IDS,
  OFFENSE_COMBAT_SKILL_IDS,
  SUSTAIN_COMBAT_SKILL_IDS,
  type CombatDevelopmentAdvanceResult,
  type CombatDevelopmentState,
  type CombatEffectCondition,
  type CombatModifierSnapshot,
  type CombatModifierStat,
  type CombatSustainProfile,
  type CombatSkillTreeCatalogEntry,
  type CombatTreeEffectDefinition
} from './combat-development-types';
import type {
  ArmourClass,
  DamageType,
  EnemyAttackTag
} from '../solo-frontier/solo-frontier-types';

const OFFENSE_TREES = Object.freeze({
  Strength: STRENGTH_SKILL_TREE,
  'Melee Accuracy': MELEE_ACCURACY_SKILL_TREE,
  'Light Melee Weapon Proficiency': LIGHT_MELEE_SKILL_TREE,
  'Medium Melee Weapon Proficiency': MEDIUM_MELEE_SKILL_TREE,
  'Heavy Melee Weapon Proficiency': HEAVY_MELEE_SKILL_TREE,
  Marksmanship: MARKSMANSHIP_SKILL_TREE,
  Ranged: RANGED_SKILL_TREE,
  'Offensive Magic': OFFENSIVE_MAGIC_SKILL_TREE
});

const SUSTAIN_TREES = Object.freeze({
  'Support Magic': SUPPORT_MAGIC_SKILL_TREE,
  Reflexes: REFLEXES_SKILL_TREE,
  Healing: HEALING_SKILL_TREE,
  Vitality: VITALITY_SKILL_TREE
});

const catalogEntries = COMBAT_SKILL_IDS.map((skillId): [CombatSkillId, CombatSkillTreeCatalogEntry] => {
  if ((OFFENSE_COMBAT_SKILL_IDS as readonly CombatSkillId[]).includes(skillId)) {
    return [skillId, { skillId, status: 'authored', release: 'v21.0', tree: OFFENSE_TREES[skillId as keyof typeof OFFENSE_TREES] }];
  }
  if ((SUSTAIN_COMBAT_SKILL_IDS as readonly CombatSkillId[]).includes(skillId)) {
    return [skillId, { skillId, status: 'authored', release: 'v21.1', tree: SUSTAIN_TREES[skillId as keyof typeof SUSTAIN_TREES] }];
  }
  return [skillId, { skillId, status: 'planned-defense', release: 'v21.2', tree: null }];
});

export const COMBAT_SKILL_TREES: Readonly<Record<CombatSkillId, CombatSkillTreeCatalogEntry>> = Object.freeze(
  Object.fromEntries(catalogEntries) as Record<CombatSkillId, CombatSkillTreeCatalogEntry>
);

export const COMBAT_TREE_EFFECT_DEFINITIONS: Readonly<Record<string, CombatTreeEffectDefinition>> = Object.freeze({
  ...OFFENSE_TREE_EFFECT_DEFINITIONS,
  ...SUSTAIN_TREE_EFFECT_DEFINITIONS
});

const isRecord = (value: unknown): value is Record<string, unknown> => Boolean(value) && typeof value === 'object' && !Array.isArray(value);

const finiteNonNegative = (value: unknown): number => {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? Math.max(0, numeric) : 0;
};

const treeIdFor = (skillId: CombatSkillId): string => COMBAT_SKILL_TREES[skillId].tree?.id
  ?? skillId.toLowerCase().replace(/[^a-z0-9]+/g, '-');

function emptyTreeState(skillId: CombatSkillId): SkillTreeState {
  return { treeId: treeIdFor(skillId), ownedNodeIds: [], view: defaultSkillTreeView() };
}

export function earnedCombatTreePoints(level: number): number {
  return Math.min(10, Math.max(0, Math.floor(finiteNonNegative(level) / 10)));
}

export function createCombatDevelopmentState(): CombatDevelopmentState {
  return {
    drill: { skillId: null, fractionalXp: 0, totalXp: 0 },
    trees: Object.fromEntries(COMBAT_SKILL_IDS.map(skillId => [skillId, emptyTreeState(skillId)])) as Record<CombatSkillId, SkillTreeState>
  };
}

export function normalizeCombatDevelopmentState(value: unknown, progressionValue: unknown): CombatDevelopmentState {
  const progression = normalizeCombatProgression(progressionValue);
  const source = isRecord(value) ? value : {};
  const sourceDrill = isRecord(source.drill) ? source.drill : {};
  const requestedSkillId = typeof sourceDrill.skillId === 'string' && (COMBAT_SKILL_IDS as readonly string[]).includes(sourceDrill.skillId)
    ? sourceDrill.skillId as CombatSkillId
    : null;
  const drillSkillId = requestedSkillId && progression[requestedSkillId].level < MAX_COMBAT_SKILL_LEVEL ? requestedSkillId : null;
  const sourceTrees = isRecord(source.trees) ? source.trees : {};
  const trees = {} as Record<CombatSkillId, SkillTreeState>;

  for (const skillId of COMBAT_SKILL_IDS) {
    const catalog = COMBAT_SKILL_TREES[skillId];
    const raw = isRecord(sourceTrees[skillId]) ? sourceTrees[skillId] : {};
    if (!catalog.tree) {
      trees[skillId] = {
        treeId: treeIdFor(skillId),
        ownedNodeIds: [],
        view: {
          ...defaultSkillTreeView(),
          ...(isRecord(raw.view) ? raw.view : {})
        }
      } as SkillTreeState;
      continue;
    }
    const rawIds = Array.isArray(raw.ownedNodeIds) ? raw.ownedNodeIds.filter((id): id is string => typeof id === 'string') : [];
    const ids = normalizeSkillTreeNodeIds(catalog.tree, rawIds, earnedCombatTreePoints(progression[skillId].level));
    const rawView = isRecord(raw.view) ? raw.view : {};
    trees[skillId] = createSkillTreeState(catalog.tree, ids, rawView);
  }

  return {
    drill: {
      skillId: drillSkillId,
      fractionalXp: Math.min(0.999999, finiteNonNegative(sourceDrill.fractionalXp) % 1),
      totalXp: finiteNonNegative(sourceDrill.totalXp)
    },
    trees
  };
}

export function selectCombatDrill(
  state: CombatDevelopmentState,
  progression: CombatProgressionState,
  skillId: CombatSkillId | null
): { accepted: boolean; state: CombatDevelopmentState; reason?: string } {
  if (skillId && progression[skillId].level >= MAX_COMBAT_SKILL_LEVEL) {
    return { accepted: false, state, reason: `${skillId} is already level 100.` };
  }
  return { accepted: true, state: { ...state, drill: { ...state.drill, skillId } } };
}

/** Advances the independent Drill at exactly 0.1 XP/s while retaining sub-XP progress. */
export function advanceCombatDrill(
  stateValue: unknown,
  progressionValue: unknown,
  elapsedMs: number
): CombatDevelopmentAdvanceResult {
  const progression = normalizeCombatProgression(progressionValue);
  const state = normalizeCombatDevelopmentState(stateValue, progression);
  const skillId = state.drill.skillId;
  if (!skillId || elapsedMs <= 0) return { state, progression, xpAwarded: 0, stoppedAtLevelCap: false };
  if (progression[skillId].level >= MAX_COMBAT_SKILL_LEVEL) {
    return {
      state: { ...state, drill: { ...state.drill, skillId: null, fractionalXp: 0 } },
      progression,
      xpAwarded: 0,
      stoppedAtLevelCap: true
    };
  }

  const accrued = state.drill.fractionalXp + Math.max(0, Number(elapsedMs) || 0) / 10_000;
  const wholeXp = Math.floor(accrued + 1e-9);
  const fractionalXp = Math.max(0, accrued - wholeXp);
  if (!wholeXp) {
    return { state: { ...state, drill: { ...state.drill, fractionalXp } }, progression, xpAwarded: 0, stoppedAtLevelCap: false };
  }
  const before = progression[skillId];
  let xpUntilCap = Math.max(0, xpToNextCombatLevel(before.level) - before.xp);
  for (let level = before.level + 1; level < MAX_COMBAT_SKILL_LEVEL; level += 1) xpUntilCap += xpToNextCombatLevel(level);
  const xpAwarded = Math.min(wholeXp, xpUntilCap);
  const after = applyCombatSkillXp(before, xpAwarded);
  const atCap = after.level >= MAX_COMBAT_SKILL_LEVEL;
  const nextProgression = { ...progression, [skillId]: after };
  return {
    state: {
      ...state,
      drill: {
        skillId: atCap ? null : skillId,
        fractionalXp: atCap ? 0 : fractionalXp,
        totalXp: state.drill.totalXp + xpAwarded
      }
    },
    progression: nextProgression,
    xpAwarded,
    stoppedAtLevelCap: atCap
  };
}

export function availableCombatTreePoints(state: CombatDevelopmentState, progression: CombatProgressionState, skillId: CombatSkillId): number {
  return Math.max(0, earnedCombatTreePoints(progression[skillId].level) - state.trees[skillId].ownedNodeIds.length);
}

export function allocateCombatTreeNode(
  state: CombatDevelopmentState,
  progression: CombatProgressionState,
  skillId: CombatSkillId,
  nodeId: string
): { accepted: boolean; state: CombatDevelopmentState; reason?: string } {
  const tree = COMBAT_SKILL_TREES[skillId].tree;
  if (!tree) return { accepted: false, state, reason: `${skillId} tree arrives in ${COMBAT_SKILL_TREES[skillId].release}.` };
  const allocation = allocateSkillTreeNode(tree, state.trees[skillId], nodeId, availableCombatTreePoints(state, progression, skillId));
  if (!allocation.accepted) return { accepted: false, state, reason: allocation.reason };
  return { accepted: true, state: { ...state, trees: { ...state.trees, [skillId]: allocation.state } } };
}

export function combatTreeRespecCost(allocatedNodes: number): number {
  return 100 + 50 * Math.max(0, Math.floor(finiteNonNegative(allocatedNodes)));
}

export function resetCombatTree(state: CombatDevelopmentState, skillId: CombatSkillId): CombatDevelopmentState {
  return { ...state, trees: { ...state.trees, [skillId]: resetSkillTreeState(state.trees[skillId]) } };
}

export interface CombatModifierContext {
  style?: string;
  technique?: string;
  stance?: string;
  aura?: string;
  defensiveAbility?: string;
  boss?: boolean;
  enemyWarded?: boolean;
  enemyHealthRatio?: number;
  playerHealthRatio?: number;
  displayedHitChance?: number;
  baseInterval?: number;
  burning?: boolean;
  marked?: boolean;
  maximumShred?: boolean;
  isTechnique?: boolean;
  overhealing?: boolean;
  armourClass?: ArmourClass;
  matchingArmourPieces?: number;
  armourPieceCounts?: Readonly<Record<ArmourClass, number>>;
  damageType?: DamageType;
  enemyAttackTag?: EnemyAttackTag;
  barrierActive?: boolean;
  barrierBroken?: boolean;
}

export function combatEffectConditionMatches(condition: CombatEffectCondition | undefined, context: CombatModifierContext): boolean {
  if (!condition) return true;
  if (condition.styles && (!context.style || !(condition.styles as readonly string[]).includes(context.style))) return false;
  if (condition.technique && condition.technique !== context.technique) return false;
  if (condition.stance && condition.stance !== context.stance) return false;
  if (condition.aura && condition.aura !== context.aura) return false;
  if (condition.defensiveAbility && condition.defensiveAbility !== context.defensiveAbility) return false;
  if (condition.boss !== undefined && condition.boss !== Boolean(context.boss)) return false;
  if (condition.enemyWarded !== undefined && condition.enemyWarded !== Boolean(context.enemyWarded)) return false;
  if (condition.enemyHealthBelow !== undefined && (context.enemyHealthRatio ?? 1) >= condition.enemyHealthBelow) return false;
  if (condition.enemyHealthAbove !== undefined && (context.enemyHealthRatio ?? 1) <= condition.enemyHealthAbove) return false;
  if (condition.playerHealthAbove !== undefined && (context.playerHealthRatio ?? 1) <= condition.playerHealthAbove) return false;
  if (condition.playerHealthBelow !== undefined && (context.playerHealthRatio ?? 1) >= condition.playerHealthBelow) return false;
  if (condition.minimumHitChance !== undefined && (context.displayedHitChance ?? 0) < condition.minimumHitChance) return false;
  if (condition.minimumBaseInterval !== undefined && (context.baseInterval ?? 0) < condition.minimumBaseInterval) return false;
  if (condition.burning !== undefined && condition.burning !== Boolean(context.burning)) return false;
  if (condition.marked !== undefined && condition.marked !== Boolean(context.marked)) return false;
  if (condition.maximumShred !== undefined && condition.maximumShred !== Boolean(context.maximumShred)) return false;
  if (condition.bossOrWarded && !context.boss && !context.enemyWarded) return false;
  if (condition.overhealing !== undefined && condition.overhealing !== Boolean(context.overhealing)) return false;
  if (condition.armourClass !== undefined && condition.armourClass !== context.armourClass) return false;
  if (condition.minimumArmourPieces !== undefined) {
    const matchingPieces = context.armourClass && context.armourPieceCounts
      ? context.armourPieceCounts[context.armourClass]
      : context.matchingArmourPieces;
    if ((matchingPieces ?? 0) < condition.minimumArmourPieces) return false;
  }
  if (condition.damageType !== undefined && condition.damageType !== context.damageType) return false;
  if (condition.enemyAttackTag !== undefined && condition.enemyAttackTag !== context.enemyAttackTag) return false;
  if (condition.barrierActive !== undefined && condition.barrierActive !== Boolean(context.barrierActive)) return false;
  if (condition.barrierBroken !== undefined && condition.barrierBroken !== Boolean(context.barrierBroken)) return false;
  return true;
}

const EMPTY_STATIC: Record<CombatModifierStat, number> = {
  damagePct: 0,
  accuracyFlat: 0,
  hitChanceBonus: 0,
  attackSpeedPct: 0,
  criticalChance: 0,
  criticalMultiplier: 0,
  techniqueDamagePct: 0,
  techniqueCooldownPct: 0,
  armourPenetration: 0,
  wardPenetration: 0,
  bossDamagePct: 0,
  hitChanceFloor: 0,
  stanceBonusPct: 0,
  stancePenaltyReductionPct: 0,
  criticalArmourPenetration: 0,
  criticalWardPenetration: 0,
  techniqueHitChanceBonus: 0,
  baseTechniqueCooldownPct: 0,
  maxHitPointsPct: 0,
  healingPct: 0,
  mendCooldownPct: 0,
  mendThresholdBonus: 0,
  auraDamageBonus: 0,
  damageTakenReductionPct: 0,
  regenerationPctPerSecond: 0,
  armourPct: 0,
  wardPct: 0,
  evasionFlat: 0,
  enemyHitChanceReduction: 0,
  physicalDamageReductionPct: 0,
  magicalDamageReductionPct: 0,
  armourPenetrationResistancePct: 0,
  wardPenetrationResistancePct: 0,
  defensiveCooldownPct: 0,
  barrierStrengthPct: 0,
  barrierCooldownPct: 0
};

function capStaticModifiers(value: Record<CombatModifierStat, number>): Record<CombatModifierStat, number> {
  return {
    ...value,
    attackSpeedPct: Math.max(-0.30, Math.min(0.30, value.attackSpeedPct)),
    techniqueCooldownPct: Math.max(0, Math.min(0.40, value.techniqueCooldownPct)),
    criticalChance: Math.max(0, Math.min(0.60, value.criticalChance)),
    armourPenetration: Math.max(0, Math.min(60, value.armourPenetration)),
    wardPenetration: Math.max(0, Math.min(60, value.wardPenetration)),
    maxHitPointsPct: Math.max(0, Math.min(0.40, value.maxHitPointsPct)),
    healingPct: Math.max(0, Math.min(0.75, value.healingPct)),
    mendCooldownPct: Math.max(0, Math.min(0.40, value.mendCooldownPct)),
    mendThresholdBonus: Math.max(0, Math.min(0.10, value.mendThresholdBonus)),
    auraDamageBonus: Math.max(0, Math.min(0.10, value.auraDamageBonus)),
    damageTakenReductionPct: Math.max(0, Math.min(0.15, value.damageTakenReductionPct)),
    regenerationPctPerSecond: Math.max(0, Math.min(0.01, value.regenerationPctPerSecond)),
    armourPct: Math.max(0, Math.min(0.50, value.armourPct)),
    wardPct: Math.max(0, Math.min(0.60, value.wardPct)),
    evasionFlat: Math.max(0, Math.min(30, value.evasionFlat)),
    enemyHitChanceReduction: Math.max(0, Math.min(0.10, value.enemyHitChanceReduction)),
    physicalDamageReductionPct: Math.max(0, Math.min(0.20, value.physicalDamageReductionPct)),
    magicalDamageReductionPct: Math.max(0, Math.min(0.20, value.magicalDamageReductionPct)),
    armourPenetrationResistancePct: Math.max(0, Math.min(0.50, value.armourPenetrationResistancePct)),
    wardPenetrationResistancePct: Math.max(0, Math.min(0.50, value.wardPenetrationResistancePct)),
    defensiveCooldownPct: Math.max(0, Math.min(0.40, value.defensiveCooldownPct)),
    barrierStrengthPct: Math.max(0, Math.min(1, value.barrierStrengthPct)),
    barrierCooldownPct: Math.max(0, Math.min(0.40, value.barrierCooldownPct))
  };
}

export function resolveCombatModifierSnapshot(
  stateValue: unknown,
  progressionValue: unknown,
  context: CombatModifierContext = {}
): CombatModifierSnapshot {
  const progression = normalizeCombatProgression(progressionValue);
  const state = normalizeCombatDevelopmentState(stateValue, progression);
  const effects: CombatTreeEffectDefinition[] = [];
  for (const skillId of COMBAT_SKILL_IDS) {
    const tree = COMBAT_SKILL_TREES[skillId].tree;
    if (!tree) continue;
    const owned = new Set(state.trees[skillId].ownedNodeIds);
    for (const node of tree.nodes) {
      if (!owned.has(node.id)) continue;
      for (const effectId of node.effectIds ?? []) {
        const effect = COMBAT_TREE_EFFECT_DEFINITIONS[effectId];
        if (effect) effects.push(effect);
      }
    }
  }
  const staticModifiers = { ...EMPTY_STATIC };
  for (const effect of effects) {
    if (effect.kind !== 'stat' || !combatEffectConditionMatches(effect.condition, context)) continue;
    staticModifiers[effect.stat] += effect.value;
  }
  return Object.freeze({
    effectIds: Object.freeze(effects.map(effect => effect.id)),
    effects: Object.freeze(effects),
    static: Object.freeze(capStaticModifiers(staticModifiers))
  });
}

export function resolveCombatSustainProfile(
  snapshot: CombatModifierSnapshot | undefined,
  context: CombatModifierContext = {}
): CombatSustainProfile {
  const matchingEffects = snapshot?.effects.filter(effect =>
    combatEffectConditionMatches(effect.condition, context)) ?? [];
  const dynamicModifiers = { ...EMPTY_STATIC };
  matchingEffects.forEach(effect => {
    if (effect.kind === 'stat') dynamicModifiers[effect.stat] += effect.value;
  });
  const modifiers = capStaticModifiers(dynamicModifiers);
  const reserveCap = matchingEffects
    .filter((effect): effect is Extract<CombatTreeEffectDefinition, { kind: 'reserve' }> => effect.kind === 'reserve')
    .reduce((maximum, effect) => Math.max(maximum, effect.capPctMaxHitPoints), 0);
  const damageRecovery = matchingEffects
    .filter((effect): effect is Extract<CombatTreeEffectDefinition, { kind: 'recovery' }> =>
      effect.kind === 'recovery' && effect.recovery === 'damage-recovery')
    .reduce((maximum, effect) => Math.max(maximum, effect.value), 0);
  const fatalGuard = matchingEffects
    .filter((effect): effect is Extract<CombatTreeEffectDefinition, { kind: 'emergency' }> =>
      effect.kind === 'emergency' && Boolean(effect.fatalGuardPctMaxHitPoints))
    .reduce((maximum, effect) => Math.max(maximum, effect.fatalGuardPctMaxHitPoints || 0), 0);

  return Object.freeze({
    maxHitPointsMultiplier: 1 + Math.max(0, Math.min(0.40, modifiers.maxHitPointsPct)),
    healingMultiplier: 1 + Math.max(0, Math.min(0.75, modifiers.healingPct)),
    mendCooldownMultiplier: 1 - Math.max(0, Math.min(0.40, modifiers.mendCooldownPct)),
    mendTriggerHealthPercent: Math.min(0.85, 0.75 + Math.max(0, modifiers.mendThresholdBonus)),
    battleFocusDamageBonus: Math.max(0, Math.min(0.10, modifiers.auraDamageBonus)),
    damageTakenMultiplier: 1 - Math.max(0, Math.min(0.15, modifiers.damageTakenReductionPct)),
    regenerationPctPerSecond: Math.max(0, Math.min(0.01, modifiers.regenerationPctPerSecond)),
    recoveryReserveCapPct: Math.max(0, Math.min(0.20, reserveCap)),
    damageRecoveryPct: Math.max(0, Math.min(0.20, damageRecovery)),
    fatalGuardPct: Math.max(0, Math.min(0.15, fatalGuard))
  });
}

const ARMOUR_CLASSES: readonly ArmourClass[] = ['light', 'medium', 'heavy'];
type CombatStatEffect = Extract<CombatTreeEffectDefinition, { kind: 'stat' }>;

const defenseEffectsForContext = (
  snapshot: CombatModifierSnapshot | undefined,
  context: CombatModifierContext
): CombatStatEffect[] => snapshot?.effects.filter((effect): effect is CombatStatEffect =>
  effect.kind === 'stat' && combatEffectConditionMatches(effect.condition, context)) ?? [];

const sumDefenseStat = (
  effects: readonly CombatStatEffect[],
  stat: CombatModifierStat
): number => effects.reduce((sum, effect) => sum + (effect.stat === stat ? effect.value : 0), 0);

/**
 * Resolves the static portion of Defense once so Solo, live previews and Arena
 * can consume the same caps and armour-weight conditions.
 */
export function resolveCombatDefenseProfile(
  snapshot: CombatModifierSnapshot | undefined,
  context: CombatModifierContext = {}
): import('./combat-development-types').CombatDefenseProfile {
  const pieceCounts = context.armourPieceCounts ?? { light: 0, medium: 0, heavy: 0 };
  const baseContext: CombatModifierContext = { ...context, armourPieceCounts: pieceCounts };
  const baseEffects = defenseEffectsForContext(snapshot, baseContext);
  const classEffects = Object.fromEntries(ARMOUR_CLASSES.map(armourClass => [
    armourClass,
    defenseEffectsForContext(snapshot, {
      ...baseContext,
      armourClass,
      matchingArmourPieces: pieceCounts[armourClass]
    })
  ])) as unknown as Record<ArmourClass, readonly CombatStatEffect[]>;
  const physicalEffects = defenseEffectsForContext(snapshot, { ...baseContext, damageType: 'physical' });
  const magicalEffects = defenseEffectsForContext(snapshot, { ...baseContext, damageType: 'magical' });

  const genericEffects = [...baseEffects, ...physicalEffects, ...magicalEffects];
  const uniqueGenericEffects = [...new Map(genericEffects.map(effect => [effect.id, effect])).values()];
  const staticValue = (stat: CombatModifierStat): number => sumDefenseStat(uniqueGenericEffects, stat);
  const armourMultiplierByClass = Object.fromEntries(ARMOUR_CLASSES.map(armourClass => {
    const effects = [...new Map(classEffects[armourClass].map(effect => [effect.id, effect])).values()];
    return [armourClass, 1 + Math.min(0.50, Math.max(0, sumDefenseStat(effects, 'armourPct')) + staticValue('armourPct'))];
  })) as Record<ArmourClass, number>;
  const wardPct = Math.min(0.60, Math.max(0, staticValue('wardPct')));
  const evasionBonus = Math.min(30, Math.max(0, staticValue('evasionFlat')));
  const enemyHitChanceReduction = Math.min(0.10, Math.max(0, staticValue('enemyHitChanceReduction')));
  const physicalReduction = Math.min(0.20, Math.max(0, staticValue('physicalDamageReductionPct')));
  const magicalReduction = Math.min(0.20, Math.max(0, staticValue('magicalDamageReductionPct')));
  const armourResistance = Math.min(0.50, Math.max(0, staticValue('armourPenetrationResistancePct')));
  const wardResistance = Math.min(0.50, Math.max(0, staticValue('wardPenetrationResistancePct')));
  const defensiveCooldown = Math.min(0.40, Math.max(0, staticValue('defensiveCooldownPct')));
  const barrierStrength = Math.min(1, Math.max(0, staticValue('barrierStrengthPct')));
  const barrierCooldown = Math.min(0.40, Math.max(0, staticValue('barrierCooldownPct')));

  return Object.freeze({
    armourMultiplierByClass: Object.freeze(armourMultiplierByClass),
    wardMultiplier: 1 + wardPct,
    evasionBonus,
    enemyHitChanceReduction,
    physicalDamageMultiplier: 1 - physicalReduction,
    magicalDamageMultiplier: 1 - magicalReduction,
    armourPenetrationResistance: armourResistance,
    wardPenetrationResistance: wardResistance,
    defensiveCooldownMultiplier: 1 - defensiveCooldown,
    barrierStrengthMultiplier: 1 + barrierStrength,
    barrierCooldownMultiplier: 1 - barrierCooldown
  });
}

export const MomentumCombatDevelopment = Object.freeze({
  trees: COMBAT_SKILL_TREES,
  effects: COMBAT_TREE_EFFECT_DEFINITIONS,
  createState: createCombatDevelopmentState,
  normalizeState: normalizeCombatDevelopmentState,
  selectDrill: selectCombatDrill,
  advanceDrill: advanceCombatDrill,
  earnedPoints: earnedCombatTreePoints,
  availablePoints: availableCombatTreePoints,
  allocateNode: allocateCombatTreeNode,
  respecCost: combatTreeRespecCost,
  resetTree: resetCombatTree,
  resolveModifiers: resolveCombatModifierSnapshot,
  resolveSustainProfile: resolveCombatSustainProfile,
  resolveDefenseProfile: resolveCombatDefenseProfile
});
