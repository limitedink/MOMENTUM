export const COMBAT_SKILL_IDS = [
  'Strength',
  'Melee Accuracy',
  'Light Melee Weapon Proficiency',
  'Medium Melee Weapon Proficiency',
  'Heavy Melee Weapon Proficiency',
  'Marksmanship',
  'Ranged',
  'Offensive Magic',
  'Support Magic',
  'Reflexes',
  'Healing',
  'Vitality',
  'Light Armour Proficiency',
  'Medium Armour Proficiency',
  'Heavy Armour Proficiency',
  'Evasion',
  'Warding'
] as const;

export type CombatSkillId = (typeof COMBAT_SKILL_IDS)[number];

export interface CombatSkillDefinition {
  id: CombatSkillId;
  name: CombatSkillId;
  progression: 'use-based';
  description: string;
}

export const COMBAT_SKILL_DEFINITIONS: readonly CombatSkillDefinition[] = [
  { id: 'Strength', name: 'Strength', progression: 'use-based', description: 'Power applied through successful melee attacks.' },
  { id: 'Melee Accuracy', name: 'Melee Accuracy', progression: 'use-based', description: 'Successful melee targeting and contact.' },
  { id: 'Light Melee Weapon Proficiency', name: 'Light Melee Weapon Proficiency', progression: 'use-based', description: 'Effective use of light melee weapons.' },
  { id: 'Medium Melee Weapon Proficiency', name: 'Medium Melee Weapon Proficiency', progression: 'use-based', description: 'Effective use of medium melee weapons.' },
  { id: 'Heavy Melee Weapon Proficiency', name: 'Heavy Melee Weapon Proficiency', progression: 'use-based', description: 'Effective use of heavy melee weapons.' },
  { id: 'Marksmanship', name: 'Marksmanship', progression: 'use-based', description: 'Accurate and effective firearm use.' },
  { id: 'Ranged', name: 'Ranged', progression: 'use-based', description: 'Effective use of bows, crossbows, and thrown weapons.' },
  { id: 'Offensive Magic', name: 'Offensive Magic', progression: 'use-based', description: 'Magic used to harm or control enemies.' },
  { id: 'Support Magic', name: 'Support Magic', progression: 'use-based', description: 'Magic used to aid, protect, or empower allies.' },
  { id: 'Reflexes', name: 'Reflexes', progression: 'use-based', description: 'Timely reactions to combat threats.' },
  { id: 'Healing', name: 'Healing', progression: 'use-based', description: 'Health restored during combat.' },
  { id: 'Vitality', name: 'Vitality', progression: 'use-based', description: 'Endurance demonstrated by surviving harm.' },
  { id: 'Light Armour Proficiency', name: 'Light Armour Proficiency', progression: 'use-based', description: 'Protection gained while using light armour.' },
  { id: 'Medium Armour Proficiency', name: 'Medium Armour Proficiency', progression: 'use-based', description: 'Protection gained while using medium armour.' },
  { id: 'Heavy Armour Proficiency', name: 'Heavy Armour Proficiency', progression: 'use-based', description: 'Protection gained while using heavy armour.' },
  { id: 'Evasion', name: 'Evasion', progression: 'use-based', description: 'Damage avoided through movement or dodging.' },
  { id: 'Warding', name: 'Warding', progression: 'use-based', description: 'Damage prevented by magical wards and barriers.' }
] as const;

export interface CombatSkillProgress {
  level: number;
  /** XP earned toward the next level, not lifetime XP. */
  xp: number;
}

export type CombatProgressionState = Record<CombatSkillId, CombatSkillProgress>;
export type CombatSkillLevelMap = Record<CombatSkillId, number>;
export type PartialCombatSkillLevelMap = Partial<Record<CombatSkillId, number>>;

/** A normalized unit emitted by the future combat simulation when a skill is actually used. */
export interface CombatSkillUseEvent {
  type: 'combat-skill-used';
  skillId: CombatSkillId;
  /** Positive relative use. Units may differ by encounter, but must be consistent within it. */
  amount: number;
}

export type CombatEncounterResult =
  | { outcome: 'victory'; stage: number }
  | { outcome: 'defeat'; stage: number; enemyHealthRemovedPercent: number };

export interface CombatProgressionResult {
  budget: number;
  useBySkill: Record<CombatSkillId, number>;
  xpBySkill: Record<CombatSkillId, number>;
  progression: CombatProgressionState;
}
