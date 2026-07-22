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
  DEFENSE_COMBAT_SKILL_IDS,
  OFFENSE_COMBAT_SKILL_IDS,
  SUSTAIN_COMBAT_SKILL_IDS,
  type CombatDevelopmentAdvanceResult,
  type CombatDevelopmentState,
  type CombatEffectCondition,
  type CombatModifierSnapshot,
  type CombatModifierStat,
  type CombatSkillTreeCatalogEntry,
  type CombatTreeEffectDefinition
} from './combat-development-types';

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

const catalogEntries = COMBAT_SKILL_IDS.map((skillId): [CombatSkillId, CombatSkillTreeCatalogEntry] => {
  if ((OFFENSE_COMBAT_SKILL_IDS as readonly CombatSkillId[]).includes(skillId)) {
    return [skillId, { skillId, status: 'authored', release: 'v21.0', tree: OFFENSE_TREES[skillId as keyof typeof OFFENSE_TREES] }];
  }
  if ((SUSTAIN_COMBAT_SKILL_IDS as readonly CombatSkillId[]).includes(skillId)) {
    return [skillId, { skillId, status: 'planned-sustain', release: 'v21.1', tree: null }];
  }
  return [skillId, { skillId, status: 'planned-defense', release: 'v21.2', tree: null }];
});

export const COMBAT_SKILL_TREES: Readonly<Record<CombatSkillId, CombatSkillTreeCatalogEntry>> = Object.freeze(
  Object.fromEntries(catalogEntries) as Record<CombatSkillId, CombatSkillTreeCatalogEntry>
);

export const COMBAT_TREE_EFFECT_DEFINITIONS = OFFENSE_TREE_EFFECT_DEFINITIONS;

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
}

export function combatEffectConditionMatches(condition: CombatEffectCondition | undefined, context: CombatModifierContext): boolean {
  if (!condition) return true;
  if (condition.styles && (!context.style || !(condition.styles as readonly string[]).includes(context.style))) return false;
  if (condition.technique && condition.technique !== context.technique) return false;
  if (condition.stance && condition.stance !== context.stance) return false;
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
  baseTechniqueCooldownPct: 0
};

function capStaticModifiers(value: Record<CombatModifierStat, number>): Record<CombatModifierStat, number> {
  return {
    ...value,
    attackSpeedPct: Math.max(-0.30, Math.min(0.30, value.attackSpeedPct)),
    techniqueCooldownPct: Math.max(0, Math.min(0.40, value.techniqueCooldownPct)),
    criticalChance: Math.max(0, Math.min(0.60, value.criticalChance)),
    armourPenetration: Math.max(0, Math.min(60, value.armourPenetration)),
    wardPenetration: Math.max(0, Math.min(60, value.wardPenetration))
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
  for (const skillId of OFFENSE_COMBAT_SKILL_IDS) {
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
  resolveModifiers: resolveCombatModifierSnapshot
});
