import { createSkillRegistry, resolveActiveSkillBonus, resolveSkillAction, applySkillActionResult } from './skill-registry';
import { CORE_SKILL_DEFINITIONS, CRAFTING_ASSEMBLY_ACTIVITY, CRAFTING_RECIPES, FUTURE_SKILL_CATALOG } from './definitions';

export const momentumSkillRegistry = createSkillRegistry([...CORE_SKILL_DEFINITIONS, ...FUTURE_SKILL_CATALOG]);

export const MomentumSkillFramework = Object.freeze({
  createSkillRegistry,
  resolveSkillAction,
  applySkillActionResult,
  resolveActiveSkillBonus,
  registry: momentumSkillRegistry,
  coreDefinitions: CORE_SKILL_DEFINITIONS,
  futureCatalog: FUTURE_SKILL_CATALOG,
  craftingActivity: CRAFTING_ASSEMBLY_ACTIVITY,
  craftingRecipes: CRAFTING_RECIPES
});

if (typeof window !== 'undefined') window.MomentumSkillFramework = MomentumSkillFramework;

export * from './skill-types';
export * from './skill-registry';
export * from './definitions';
