import {
  COMBAT_SKILL_IDS,
  type CombatEncounterResult,
  type CombatProgressionResult,
  type CombatProgressionState,
  type CombatSkillId,
  type CombatSkillLevelMap,
  type CombatSkillProgress,
  type CombatSkillUseEvent
} from './combat-types';

export const MAX_COMBAT_SKILL_LEVEL = 100;
export const COMBAT_XP_CURVE = Object.freeze({
  base: 100,
  linearGrowth: 0.03,
  lateGameRamp: 2,
  pivot: 75,
  width: 12,
  cap: MAX_COMBAT_SKILL_LEVEL
});

const finiteNonNegative = (value: unknown): number => {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? Math.max(0, numeric) : 0;
};

export function xpToNextCombatLevel(level: number): number {
  const normalizedLevel = Math.max(1, Math.floor(finiteNonNegative(level)));
  if (normalizedLevel >= COMBAT_XP_CURVE.cap) return Number.POSITIVE_INFINITY;
  const lateGame = 1 / (1 + Math.exp(-(normalizedLevel - COMBAT_XP_CURVE.pivot) / COMBAT_XP_CURVE.width));
  return Math.floor(
    COMBAT_XP_CURVE.base
    * (1 + COMBAT_XP_CURVE.linearGrowth * (normalizedLevel - 1))
    * (1 + COMBAT_XP_CURVE.lateGameRamp * lateGame)
  );
}

export function normalizeCombatSkillProgress(value: Partial<CombatSkillProgress> | null | undefined): CombatSkillProgress {
  let level = Math.min(MAX_COMBAT_SKILL_LEVEL, Math.max(1, Math.floor(finiteNonNegative(value?.level) || 1)));
  let xp = finiteNonNegative(value?.xp);
  while (level < MAX_COMBAT_SKILL_LEVEL) {
    const required = xpToNextCombatLevel(level);
    if (xp < required) break;
    xp -= required;
    level += 1;
  }
  return level >= MAX_COMBAT_SKILL_LEVEL ? { level: MAX_COMBAT_SKILL_LEVEL, xp: 0 } : { level, xp };
}

export function createInitialCombatProgression(level = 1): CombatProgressionState {
  const progress = normalizeCombatSkillProgress({ level, xp: 0 });
  return Object.fromEntries(COMBAT_SKILL_IDS.map(skillId => [skillId, { ...progress }])) as CombatProgressionState;
}

export function normalizeCombatProgression(value: unknown): CombatProgressionState {
  const source = value && typeof value === 'object' && !Array.isArray(value) ? value as Partial<CombatProgressionState> : {};
  return Object.fromEntries(COMBAT_SKILL_IDS.map(skillId => [
    skillId,
    normalizeCombatSkillProgress(source[skillId])
  ])) as CombatProgressionState;
}

export function combatSkillEffectiveLevel(progress: CombatSkillProgress): number {
  const normalized = normalizeCombatSkillProgress(progress);
  return normalized.level >= MAX_COMBAT_SKILL_LEVEL
    ? MAX_COMBAT_SKILL_LEVEL
    : normalized.level + normalized.xp / xpToNextCombatLevel(normalized.level);
}

export function combatSkillLevels(progression: CombatProgressionState): CombatSkillLevelMap {
  return Object.fromEntries(COMBAT_SKILL_IDS.map(skillId => [skillId, combatSkillEffectiveLevel(progression[skillId])])) as CombatSkillLevelMap;
}

export function applyCombatSkillXp(progress: CombatSkillProgress, amount: number): CombatSkillProgress {
  let next = normalizeCombatSkillProgress(progress);
  let remainingXp = finiteNonNegative(amount);
  if (!remainingXp || next.level >= MAX_COMBAT_SKILL_LEVEL) return next;
  let xp = next.xp + remainingXp;
  let level = next.level;
  while (level < MAX_COMBAT_SKILL_LEVEL) {
    const required = xpToNextCombatLevel(level);
    if (xp < required) break;
    xp -= required;
    level += 1;
  }
  return level >= MAX_COMBAT_SKILL_LEVEL ? { level: MAX_COMBAT_SKILL_LEVEL, xp: 0 } : { level, xp };
}

export function encounterXpBudget(result: CombatEncounterResult): number {
  const stage = finiteNonNegative(result.stage);
  const victoryBudget = 24 + 2 * stage;
  if (result.outcome === 'victory') return victoryBudget;
  return victoryBudget * Math.min(100, finiteNonNegative(result.enemyHealthRemovedPercent)) / 100 * 0.5;
}

export function combatUseBySkill(events: readonly CombatSkillUseEvent[]): Record<CombatSkillId, number> {
  const useBySkill = Object.fromEntries(COMBAT_SKILL_IDS.map(skillId => [skillId, 0])) as Record<CombatSkillId, number>;
  for (const event of events) {
    if (event?.type !== 'combat-skill-used' || !COMBAT_SKILL_IDS.includes(event.skillId)) continue;
    useBySkill[event.skillId] += finiteNonNegative(event.amount);
  }
  return useBySkill;
}

export function distributeEncounterXp(
  events: readonly CombatSkillUseEvent[],
  result: CombatEncounterResult
): Record<CombatSkillId, number> {
  const useBySkill = combatUseBySkill(events);
  const totalUse = COMBAT_SKILL_IDS.reduce((sum, skillId) => sum + useBySkill[skillId], 0);
  const budget = encounterXpBudget(result);
  return Object.fromEntries(COMBAT_SKILL_IDS.map(skillId => [
    skillId,
    totalUse > 0 ? budget * useBySkill[skillId] / totalUse : 0
  ])) as Record<CombatSkillId, number>;
}

export function applyCombatEncounterProgression(
  current: CombatProgressionState,
  events: readonly CombatSkillUseEvent[],
  result: CombatEncounterResult
): CombatProgressionResult {
  const normalizedCurrent = normalizeCombatProgression(current);
  const useBySkill = combatUseBySkill(events);
  const xpBySkill = distributeEncounterXp(events, result);
  const progression = Object.fromEntries(COMBAT_SKILL_IDS.map(skillId => [
    skillId,
    applyCombatSkillXp(normalizedCurrent[skillId], xpBySkill[skillId])
  ])) as CombatProgressionState;
  return { budget: encounterXpBudget(result), useBySkill, xpBySkill, progression };
}
