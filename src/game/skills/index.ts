import { createSkillRegistry, resolveActiveSkillBonus, resolveSkillAction, applySkillActionResult } from './skill-registry';
import { CORE_SKILL_DEFINITIONS, CRAFTING_ASSEMBLY_ACTIVITY, CRAFTING_RECIPES, FUTURE_SKILL_CATALOG } from './definitions';
import { COMBAT_SKILL_DEFINITIONS, LEGACY_COMBAT_SKILL_DEFINITION, legacyCombatCompatibility } from '../combat-progression';
import {
  COMBAT_SKILL_TREE,
  allocateSkillTreeNode,
  canAllocateSkillTreeNode,
  createSkillTreeState,
  defaultSkillTreeView,
  normalizeSkillTreeNodeIds,
  resetSkillTreeState,
  skillTreeBranchProgress,
  skillTreeNodeState
} from './skill-trees';

export const momentumSkillRegistry = createSkillRegistry([LEGACY_COMBAT_SKILL_DEFINITION, ...CORE_SKILL_DEFINITIONS, ...FUTURE_SKILL_CATALOG]);

export const MomentumSkillFramework = Object.freeze({
  createSkillRegistry,
  resolveSkillAction,
  applySkillActionResult,
  resolveActiveSkillBonus,
  registry: momentumSkillRegistry,
  coreDefinitions: CORE_SKILL_DEFINITIONS,
  futureCatalog: FUTURE_SKILL_CATALOG,
  combatDefinitions: COMBAT_SKILL_DEFINITIONS,
  /** @deprecated Remove with the legacy arena/runtime migration in Goal 4. */
  legacyCombatCompatibility,
  craftingActivity: CRAFTING_ASSEMBLY_ACTIVITY,
  craftingRecipes: CRAFTING_RECIPES,
  combatTree: COMBAT_SKILL_TREE,
  skillTree: Object.freeze({
    allocate: allocateSkillTreeNode,
    canAllocate: canAllocateSkillTreeNode,
    createState: createSkillTreeState,
    defaultView: defaultSkillTreeView,
    normalizeNodeIds: normalizeSkillTreeNodeIds,
    reset: resetSkillTreeState,
    branchProgress: skillTreeBranchProgress,
    nodeState: skillTreeNodeState
  })
});

if (typeof window !== 'undefined') window.MomentumSkillFramework = MomentumSkillFramework;

export * from './skill-types';
export * from './skill-registry';
export * from './definitions';
export * from './skill-trees';
