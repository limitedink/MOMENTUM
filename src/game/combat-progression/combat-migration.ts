import { COMBAT_SKILL_IDS, type CombatProgressionState, type CombatSkillId, type CombatSkillProgress } from './combat-types';
import { MAX_COMBAT_SKILL_LEVEL, createInitialCombatProgression, normalizeCombatSkillProgress, xpToNextCombatLevel } from './combat-progression';

export const COMBAT_SAVE_VERSION = 18;

/** v17 Solo Frontier conversion weights. Existing component values always take priority. */
export const LEGACY_COMBAT_LEVEL_WEIGHTS: Readonly<Record<CombatSkillId, number>> = Object.freeze({
  Strength: 1,
  'Melee Accuracy': 0.95,
  'Light Melee Weapon Proficiency': 0.85,
  'Medium Melee Weapon Proficiency': 0.8,
  'Heavy Melee Weapon Proficiency': 0.75,
  Marksmanship: 0.8,
  Ranged: 0.75,
  'Offensive Magic': 0.75,
  'Support Magic': 0.65,
  Reflexes: 0.8,
  Healing: 0.65,
  Vitality: 1,
  'Light Armour Proficiency': 0.8,
  'Medium Armour Proficiency': 0.9,
  'Heavy Armour Proficiency': 0.7,
  Evasion: 0.8,
  Warding: 0.7
});

/** v17 component aliases for renamed or split skills. Direct v18-named values still win. */
export const LEGACY_COMPONENT_ALIASES: Readonly<Partial<Record<CombatSkillId, { source: string; multiplier: number }>>> = Object.freeze({
  'Offensive Magic': { source: 'Magic', multiplier: 1 },
  'Support Magic': { source: 'Magic', multiplier: LEGACY_COMBAT_LEVEL_WEIGHTS['Support Magic'] / LEGACY_COMBAT_LEVEL_WEIGHTS['Offensive Magic'] }
});

type JsonRecord = Record<string, unknown>;

export interface LegacyCombatAudit {
  sourceVersion: 17;
  combatSkill: unknown;
  componentSkills: unknown;
}

export type MomentumSaveV18 = JsonRecord & {
  version: 18;
  skills: unknown[];
  combatProgression: CombatProgressionState;
  legacyCombat: LegacyCombatAudit | null;
};

const isRecord = (value: unknown): value is JsonRecord => Boolean(value && typeof value === 'object' && !Array.isArray(value));

function finiteNumber(value: unknown): number | null {
  const number = typeof value === 'number' || typeof value === 'string' ? Number(value) : Number.NaN;
  return Number.isFinite(number) ? number : null;
}

function cloneAuditValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(cloneAuditValue);
  if (isRecord(value)) return Object.fromEntries(Object.entries(value).map(([key, child]) => [key, cloneAuditValue(child)]));
  return value;
}

function effectiveLevelToProgress(value: unknown): CombatSkillProgress | null {
  if (isRecord(value)) {
    const level = finiteNumber(value.level ?? value.lvl);
    if (level === null) return null;
    return normalizeCombatSkillProgress({ level, xp: finiteNumber(value.xp) ?? 0 });
  }
  const effectiveLevel = finiteNumber(value);
  if (effectiveLevel === null || effectiveLevel < 0) return null;
  const clamped = Math.min(MAX_COMBAT_SKILL_LEVEL, Math.max(1, effectiveLevel));
  const level = Math.floor(clamped);
  if (level >= MAX_COMBAT_SKILL_LEVEL) return { level: MAX_COMBAT_SKILL_LEVEL, xp: 0 };
  return { level, xp: (clamped - level) * xpToNextCombatLevel(level) };
}

function legacyCombatProgress(combatSkill: unknown): CombatSkillProgress {
  if (!isRecord(combatSkill)) return { level: 1, xp: 0 };
  return normalizeCombatSkillProgress({
    level: finiteNumber(combatSkill.lvl ?? combatSkill.level) ?? 1,
    xp: finiteNumber(combatSkill.xp) ?? 0
  });
}

function legacyEffectiveLevel(combatSkill: unknown): number {
  const progress = legacyCombatProgress(combatSkill);
  if (progress.level >= MAX_COMBAT_SKILL_LEVEL) return MAX_COMBAT_SKILL_LEVEL;
  return progress.level + progress.xp / xpToNextCombatLevel(progress.level);
}

function sourceComponentValue(components: JsonRecord, skillId: CombatSkillId): unknown {
  if (components[skillId] !== undefined) return components[skillId];
  const alias = LEGACY_COMPONENT_ALIASES[skillId];
  const aliasedValue = alias ? finiteNumber(components[alias.source]) : null;
  if (alias && aliasedValue !== null) return aliasedValue * alias.multiplier;
  return undefined;
}

export function convertLegacyCombatProgression(combatSkill: unknown, componentSkills: unknown): CombatProgressionState {
  const components = isRecord(componentSkills) ? componentSkills : {};
  const legacyLevel = legacyEffectiveLevel(combatSkill);
  const initial = createInitialCombatProgression();
  return Object.fromEntries(COMBAT_SKILL_IDS.map(skillId => {
    const preserved = effectiveLevelToProgress(sourceComponentValue(components, skillId));
    const converted = effectiveLevelToProgress(legacyLevel * LEGACY_COMBAT_LEVEL_WEIGHTS[skillId]);
    return [skillId, preserved ?? converted ?? initial[skillId]];
  })) as CombatProgressionState;
}

export function migrateV17SaveToV18(value: unknown): MomentumSaveV18 {
  const save = isRecord(value) ? value : {};
  if (save.version === COMBAT_SAVE_VERSION && isRecord(save.combatProgression)) return save as MomentumSaveV18;

  const skills = Array.isArray(save.skills) ? save.skills : [];
  const combatSkill = skills.find(skill => isRecord(skill) && skill.id === 'Combat') ?? null;
  const nonCombatSkills = skills.filter(skill => !(isRecord(skill) && skill.id === 'Combat'));
  const componentSkills = save.combatComponentSkills;
  const { combatComponentSkills: _removedComponentSkills, ...preserved } = save;

  return {
    ...preserved,
    version: COMBAT_SAVE_VERSION,
    skills: nonCombatSkills,
    combatProgression: convertLegacyCombatProgression(combatSkill, componentSkills),
    legacyCombat: {
      sourceVersion: 17,
      combatSkill: cloneAuditValue(combatSkill),
      componentSkills: cloneAuditValue(componentSkills ?? null)
    }
  };
}

// v19 extends the v18 save with the ARPG loot and paper-doll layer. Re-export
// it here so callers that already consume the versioned combat migration do
// not need a second save-migration import path.
export { LOOT_SAVE_VERSION, MOMENTUM_SAVE_VERSION, migrateV18SaveToV19, migrateV18ToV19, migrateLootSaveToV19, migrateV18Save } from '../loot/loot-migration';
export type { MomentumSaveV19 } from '../loot/loot-migration';
