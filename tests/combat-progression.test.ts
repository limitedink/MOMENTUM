import { describe, expect, it } from 'vitest';
import {
  COMBAT_SKILL_DEFINITIONS,
  COMBAT_SKILL_IDS,
  MAX_COMBAT_SKILL_LEVEL,
  applyCombatEncounterProgression,
  applyCombatSkillXp,
  createInitialCombatProgression,
  distributeEncounterXp,
  encounterXpBudget,
  xpToNextCombatLevel,
  type CombatSkillUseEvent
} from '../src/game/combat-progression';

describe('typed combat skill foundation', () => {
  it('defines exactly the 17 approved use-based skills in order', () => {
    expect(COMBAT_SKILL_IDS).toEqual([
      'Strength', 'Melee Accuracy', 'Light Melee Weapon Proficiency', 'Medium Melee Weapon Proficiency',
      'Heavy Melee Weapon Proficiency', 'Marksmanship', 'Ranged', 'Offensive Magic', 'Support Magic',
      'Reflexes', 'Healing', 'Vitality', 'Light Armour Proficiency', 'Medium Armour Proficiency',
      'Heavy Armour Proficiency', 'Evasion', 'Warding'
    ]);
    expect(COMBAT_SKILL_DEFINITIONS).toHaveLength(17);
    expect(COMBAT_SKILL_DEFINITIONS.every(skill => skill.progression === 'use-based')).toBe(true);
    expect(COMBAT_SKILL_DEFINITIONS.find(skill => skill.id === 'Marksmanship')?.description).toContain('firearm');
    expect(COMBAT_SKILL_DEFINITIONS.find(skill => skill.id === 'Ranged')?.description).toContain('bows, crossbows, and thrown');
  });
});

describe('use-based encounter XP', () => {
  it('uses the fixed victory and health-scaled defeat budgets', () => {
    expect(encounterXpBudget({ outcome: 'victory', stage: 3 })).toBe(30);
    expect(encounterXpBudget({ outcome: 'defeat', stage: 3, enemyHealthRemovedPercent: 40 })).toBe(6);
    expect(encounterXpBudget({ outcome: 'defeat', stage: 3, enemyHealthRemovedPercent: 140 })).toBe(15);
  });

  it('distributes the whole budget proportionally and gives unused skills zero XP', () => {
    const events: CombatSkillUseEvent[] = [
      { type: 'combat-skill-used', skillId: 'Strength', amount: 3 },
      { type: 'combat-skill-used', skillId: 'Melee Accuracy', amount: 1 },
      { type: 'combat-skill-used', skillId: 'Strength', amount: 2 },
      { type: 'combat-skill-used', skillId: 'Healing', amount: -100 }
    ];
    const xp = distributeEncounterXp(events, { outcome: 'victory', stage: 3 });
    expect(xp.Strength).toBe(25);
    expect(xp['Melee Accuracy']).toBe(5);
    expect(xp.Healing).toBe(0);
    expect(xp.Warding).toBe(0);
    expect(Object.values(xp).reduce((sum, value) => sum + value, 0)).toBe(30);
  });

  it('awards nothing when no skill was used', () => {
    const result = applyCombatEncounterProgression(createInitialCombatProgression(), [], { outcome: 'victory', stage: 10 });
    expect(Object.values(result.xpBySkill).every(value => value === 0)).toBe(true);
    expect(result.progression).toEqual(createInitialCombatProgression());
  });
});

describe('level-100 XP curve', () => {
  it('matches the existing early curve and caps safely at level 100', () => {
    expect(xpToNextCombatLevel(1)).toBe(100);
    expect(xpToNextCombatLevel(MAX_COMBAT_SKILL_LEVEL)).toBe(Number.POSITIVE_INFINITY);
    expect(applyCombatSkillXp({ level: 1, xp: 90 }, 20)).toEqual({ level: 2, xp: 10 });
    expect(applyCombatSkillXp({ level: 1, xp: 250 }, 0).level).toBe(3);
    expect(applyCombatSkillXp({ level: 99, xp: 0 }, 1_000_000)).toEqual({ level: 100, xp: 0 });
    expect(applyCombatSkillXp({ level: 100, xp: 50 }, 100)).toEqual({ level: 100, xp: 0 });
  });
});
