import type { SkillDefinition } from '../skills/skill-types';
import { COMBAT_SKILL_IDS, type CombatProgressionState } from './combat-types';
import { combatSkillLevels, createInitialCombatProgression, xpToNextCombatLevel } from './combat-progression';
import { convertLegacyCombatProgression } from './combat-migration';

/** @deprecated Retained only as a read-only migration/audit shape. */
export const LEGACY_COMBAT_SKILL_DEFINITION: SkillDefinition = Object.freeze({
  id: 'Combat',
  name: 'Combat',
  family: 'combat',
  mode: 'active',
  baseActionsPerSecond: 0.5,
  xpPerAction: 20,
  activeActivityId: null,
  // Generic Combat is no longer trainable and never generates idle rewards.
  idleOutputs: {}
});

/** @deprecated Generic Combat exists only to keep the pre-Goal-4 runtime playable. */
export function createLegacyCombatRuntimeState(source?: { basePerSec?: unknown; active?: unknown; qty?: unknown; lvl?: unknown; xp?: unknown; progress?: unknown; selectedToolId?: unknown }): Record<string, unknown> {
  const level = Math.max(1, Math.min(100, Math.floor(Number(source?.lvl) || 1)));
  const xp = level >= 100 ? 0 : Math.max(0, Number(source?.xp) || 0);
  return {
    id: 'Combat',
    basePerSec: Math.max(0, Number(source?.basePerSec) || LEGACY_COMBAT_SKILL_DEFINITION.baseActionsPerSecond),
    active: Boolean(source?.active),
    qty: Math.max(0, Number(source?.qty) || 0),
    lvl: level,
    xp,
    next: xpToNextCombatLevel(level),
    progress: Math.max(0, Number(source?.progress) || 0),
    selectedToolId: typeof source?.selectedToolId === 'string' ? source.selectedToolId : null
  };
}

/** @deprecated Converts generic Combat for compatibility consumers; canonical saves use combatProgression. */
export function legacyCombatLevelMap(level: number): ReturnType<typeof combatSkillLevels> {
  return combatSkillLevels(convertLegacyCombatProgression({ lvl: level, xp: 0 }, null));
}

/** @deprecated Expedition and party code may read levels until Goal 4 adopts full progression state. */
export function combatProgressionLevelMap(progression?: CombatProgressionState): ReturnType<typeof combatSkillLevels> {
  return combatSkillLevels(progression ?? createInitialCombatProgression());
}

/** @deprecated Derives the old aggregate gate without making it canonical progression. */
export function genericCombatLevel(progression: CombatProgressionState): number {
  const levels = combatSkillLevels(progression);
  return Math.max(1, Math.round(COMBAT_SKILL_IDS.reduce((sum, skillId) => sum + levels[skillId], 0) / COMBAT_SKILL_IDS.length));
}

export const legacyCombatCompatibility = Object.freeze({
  definition: LEGACY_COMBAT_SKILL_DEFINITION,
  createRuntimeState: createLegacyCombatRuntimeState,
  levelMap: legacyCombatLevelMap,
  progressionLevelMap: combatProgressionLevelMap,
  genericLevel: genericCombatLevel
});
