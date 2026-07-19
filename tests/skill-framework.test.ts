import { describe, expect, it } from 'vitest';
import {
  CORE_SKILL_DEFINITIONS,
  CRAFTING_ASSEMBLY_ACTIVITY,
  CRAFTING_RECIPES,
  FUTURE_SKILL_CATALOG
} from '../src/game/skills/definitions';
import {
  applySkillActionResult,
  createSkillRegistry,
  resolveActiveSkillBonus
} from '../src/game/skills/skill-registry';
import type { ResourceMap, SkillState } from '../src/game/skills/skill-types';

const crafting = CORE_SKILL_DEFINITIONS.find(skill => skill.id === 'Crafting')!;
const state: SkillState = {
  id: 'Crafting',
  level: 1,
  xp: 0,
  nextXp: 100,
  active: true,
  progress: 0,
  quantity: 0,
  specializationId: null
};

describe('skill framework', () => {
  it('registers current and future skills with unique families', () => {
    const registry = createSkillRegistry([...CORE_SKILL_DEFINITIONS, ...FUTURE_SKILL_CATALOG]);
    expect(registry.get('Crafting')?.family).toBe('fabrication');
    expect(registry.get('Robotics')?.family).toBe('fabrication');
    expect(registry.get('Persuasion')?.family).toBe('social');
    expect(registry.list()).toHaveLength(CORE_SKILL_DEFINITIONS.length + FUTURE_SKILL_CATALOG.length);
  });

  it('resolves idle Crafting actions and consumes inputs without mutating context', () => {
    const resources: ResourceMap = { Bars: 2, 'Pine Logs': 2 };
    const result = createSkillRegistry([crafting]).resolve('Crafting', {
      skill: state,
      resources,
      mode: 'idle',
      activeMultiplier: 1,
      random: () => 0.5
    });

    expect(result.accepted).toBe(true);
    expect(result.consumed).toEqual({ Bars: 1, 'Pine Logs': 1 });
    expect(result.produced).toEqual({ 'Crafted Components': 1 });
    expect(resources).toEqual({ Bars: 2, 'Pine Logs': 2 });
    applySkillActionResult(resources, result);
    expect(resources).toEqual({ Bars: 1, 'Pine Logs': 1, 'Crafted Components': 1 });
  });

  it('rejects Crafting when a required input is unavailable', () => {
    const result = createSkillRegistry([crafting]).resolve('Crafting', {
      skill: state,
      resources: { Bars: 1, 'Pine Logs': 0 },
      mode: 'idle',
      activeMultiplier: 1,
      random: () => 0.5
    });
    expect(result.accepted).toBe(false);
    expect(result.reason).toContain('Pine Logs');
  });

  it('bounds active Crafting bonuses and keeps the activity deterministic', () => {
    expect(resolveActiveSkillBonus(CRAFTING_ASSEMBLY_ACTIVITY, -1)).toBe(1);
    expect(resolveActiveSkillBonus(CRAFTING_ASSEMBLY_ACTIVITY, 0.5)).toBe(1.25);
    expect(resolveActiveSkillBonus(CRAFTING_ASSEMBLY_ACTIVITY, 3)).toBe(1.5);
  });

  it('keeps Crafting recipes tied to the Crafting skill and known equipment', () => {
    expect(CRAFTING_RECIPES.every(recipe => recipe.skillId === 'Crafting')).toBe(true);
    expect(CRAFTING_RECIPES.filter(recipe => recipe.equipmentId).map(recipe => recipe.equipmentId)).toEqual([
      'ironBlade',
      'reinforcedPick',
      'forgeGauntlet',
      'platedVest'
    ]);
  });
});
