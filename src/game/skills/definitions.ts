import type { ActiveSkillActivity, RecipeDefinition, SkillDefinition } from './skill-types';

const idle = (definition: Omit<SkillDefinition, 'mode' | 'activeActivityId'>): SkillDefinition => ({
  ...definition,
  mode: 'idle',
  activeActivityId: null
});

const hybrid = (definition: Omit<SkillDefinition, 'mode'> & { activeActivityId: string }): SkillDefinition => ({
  ...definition,
  mode: 'hybrid'
});

export const CORE_SKILL_DEFINITIONS: readonly SkillDefinition[] = [
  idle({ id: 'Mining', name: 'Mining', family: 'gathering', baseActionsPerSecond: 0.5, xpPerAction: 20, idleOutputs: { Ore: 1 } }),
  idle({ id: 'Smithing', name: 'Smithing', family: 'processing', baseActionsPerSecond: 0.5, xpPerAction: 20, idleInputs: { Ore: 1 }, idleOutputs: { Bars: 1 } }),
  idle({ id: 'Combat', name: 'Combat', family: 'combat', baseActionsPerSecond: 0.5, xpPerAction: 20, idleOutputs: { 'Boss Keys': 0.1 } }),
  idle({ id: 'Fishing', name: 'Fishing', family: 'gathering', baseActionsPerSecond: 0.5, xpPerAction: 20, idleOutputs: { 'Raw Fish': 1 } }),
  idle({ id: 'Cooking', name: 'Cooking', family: 'processing', baseActionsPerSecond: 0.4, xpPerAction: 20, idleInputs: { 'Raw Fish': 1 }, idleOutputs: { 'Cooked Fish': 1 } }),
  idle({ id: 'Woodcutting', name: 'Woodcutting', family: 'gathering', baseActionsPerSecond: 0.4, xpPerAction: 20, idleOutputs: { 'Pine Logs': 1 } }),
  hybrid({
    id: 'Crafting',
    name: 'Crafting',
    family: 'fabrication',
    baseActionsPerSecond: 0.35,
    xpPerAction: 20,
    activeActivityId: 'crafting-assembly',
    idleInputs: { Bars: 1, 'Pine Logs': 1 },
    idleOutputs: { 'Crafted Components': 1 },
    unlocks: ['crafting:assembly']
  })
];

export const FUTURE_SKILL_CATALOG: readonly SkillDefinition[] = [
  idle({ id: 'Robotics', name: 'Robotics', family: 'fabrication', baseActionsPerSecond: 0.25, xpPerAction: 20 }),
  idle({ id: 'Engineering', name: 'Engineering', family: 'technical', baseActionsPerSecond: 0.25, xpPerAction: 20 }),
  idle({ id: 'Archaeology', name: 'Archaeology', family: 'gathering', baseActionsPerSecond: 0.25, xpPerAction: 20 }),
  idle({ id: 'Marksmanship', name: 'Marksmanship', family: 'combat', baseActionsPerSecond: 0.25, xpPerAction: 20 }),
  idle({ id: 'Strength', name: 'Strength', family: 'combat', baseActionsPerSecond: 0.25, xpPerAction: 20 }),
  idle({ id: 'Melee Accuracy', name: 'Melee Accuracy', family: 'combat', baseActionsPerSecond: 0.25, xpPerAction: 20 }),
  idle({ id: 'Reflexes', name: 'Reflexes', family: 'combat', baseActionsPerSecond: 0.25, xpPerAction: 20 }),
  idle({ id: 'Defense', name: 'Defense', family: 'combat', baseActionsPerSecond: 0.25, xpPerAction: 20 }),
  idle({ id: 'Melee', name: 'Melee', family: 'combat', baseActionsPerSecond: 0.25, xpPerAction: 20 }),
  idle({ id: 'Magic', name: 'Magic', family: 'combat', baseActionsPerSecond: 0.25, xpPerAction: 20 }),
  idle({ id: 'Ranged', name: 'Ranged', family: 'combat', baseActionsPerSecond: 0.25, xpPerAction: 20 }),
  idle({ id: 'Wand Making', name: 'Wand Making', family: 'fabrication', baseActionsPerSecond: 0.25, xpPerAction: 20 }),
  idle({ id: 'Hacking', name: 'Hacking', family: 'technical', baseActionsPerSecond: 0.25, xpPerAction: 20 }),
  idle({ id: 'Cryptography', name: 'Cryptography', family: 'technical', baseActionsPerSecond: 0.25, xpPerAction: 20 }),
  idle({ id: 'Contractor', name: 'Contractor', family: 'social', baseActionsPerSecond: 0.25, xpPerAction: 20 }),
  idle({ id: 'Music', name: 'Music', family: 'challenge', baseActionsPerSecond: 0.25, xpPerAction: 20, unlocks: ['skill-tool:guitar'] }),
  idle({ id: 'Farming', name: 'Farming', family: 'gathering', baseActionsPerSecond: 0.25, xpPerAction: 20 }),
  idle({ id: 'Hunting', name: 'Hunting', family: 'gathering', baseActionsPerSecond: 0.25, xpPerAction: 20 }),
  idle({ id: 'Puzzles', name: 'Puzzles', family: 'challenge', baseActionsPerSecond: 0.25, xpPerAction: 20 }),
  idle({ id: 'Minigames', name: 'Minigames', family: 'challenge', baseActionsPerSecond: 0.25, xpPerAction: 20 }),
  idle({ id: 'Humour', name: 'Humour', family: 'social', baseActionsPerSecond: 0.25, xpPerAction: 20 }),
  idle({ id: 'Pickpocket', name: 'Pickpocket', family: 'social', baseActionsPerSecond: 0.25, xpPerAction: 20 }),
  idle({ id: 'Lockpicking', name: 'Lockpicking', family: 'technical', baseActionsPerSecond: 0.25, xpPerAction: 20 }),
  idle({ id: 'Herbalism', name: 'Herbalism', family: 'gathering', baseActionsPerSecond: 0.25, xpPerAction: 20 }),
  idle({ id: 'Alchemy', name: 'Alchemy', family: 'processing', baseActionsPerSecond: 0.25, xpPerAction: 20 }),
  idle({ id: 'Parkour', name: 'Parkour', family: 'challenge', baseActionsPerSecond: 0.25, xpPerAction: 20 }),
  idle({ id: 'Persuasion', name: 'Persuasion', family: 'social', baseActionsPerSecond: 0.25, xpPerAction: 20 }),
  idle({ id: 'Charisma', name: 'Charisma', family: 'social', baseActionsPerSecond: 0.25, xpPerAction: 20 })
];

export const CRAFTING_ASSEMBLY_ACTIVITY: ActiveSkillActivity = {
  id: 'crafting-assembly',
  skillId: 'Crafting',
  name: 'Assembly Run',
  durationMs: 7_000,
  maxBonusMultiplier: 1.5,
  scoreToMultiplier(score) {
    const normalized = Math.max(0, Math.min(1, Number(score) || 0));
    return 1 + normalized * 0.5;
  }
};

export const CRAFTING_RECIPES: readonly RecipeDefinition[] = [
  { id: 'ironBlade', name: 'Iron Blade', skillId: 'Crafting', inputs: { Bars: 30, 'Crafted Components': 1 }, outputs: { ironBlade: 1 }, requiredLevel: 1, equipmentId: 'ironBlade', kind: 'equipment', description: 'A directional melee weapon for close-range arena combat.' },
  { id: 'reinforcedPick', name: 'Reinforced Pick', skillId: 'Crafting', inputs: { Bars: 30, 'Crafted Components': 1 }, outputs: { reinforcedPick: 1 }, requiredLevel: 1, equipmentId: 'reinforcedPick', kind: 'equipment', description: '+25% Mining rate while equipped.' },
  { id: 'forgeGauntlet', name: 'Forge Gauntlet', skillId: 'Crafting', inputs: { Bars: 30, 'Crafted Components': 1 }, outputs: { forgeGauntlet: 1 }, requiredLevel: 4, equipmentId: 'forgeGauntlet', kind: 'equipment', description: '+25% Smithing rate while equipped.' },
  { id: 'platedVest', name: 'Plated Vest', skillId: 'Crafting', inputs: { Bars: 40, 'Crafted Components': 1 }, outputs: { platedVest: 1 }, requiredLevel: 6, equipmentId: 'platedVest', kind: 'equipment', description: '+25 maximum arena health.' },
  { id: 'guitar', name: 'Guitar', skillId: 'Crafting', inputs: { Bars: 20, 'Crafted Components': 2, 'Pine Logs': 4 }, outputs: { guitar: 1 }, requiredLevel: 3, skillToolId: 'guitar', kind: 'skillTool', description: 'Unlocks Music and provides a reliable practice baseline.' },
  { id: 'drums', name: 'Drums', skillId: 'Crafting', inputs: { Bars: 35, 'Crafted Components': 3, 'Pine Logs': 6 }, outputs: { drums: 1 }, requiredLevel: 6, skillToolId: 'drums', kind: 'skillTool', description: 'A louder setup that accelerates Music training.' },
  { id: 'piano', name: 'Piano', skillId: 'Crafting', inputs: { Bars: 80, 'Crafted Components': 6, 'Pine Logs': 10 }, outputs: { piano: 1 }, requiredLevel: 12, skillToolId: 'piano', kind: 'skillTool', description: 'A precision instrument for high-rate Music training.' },
  { id: 'harp', name: 'Harp', skillId: 'Crafting', inputs: { Bars: 120, 'Crafted Components': 8, 'Pine Logs': 14 }, outputs: { harp: 1 }, requiredLevel: 20, skillToolId: 'harp', kind: 'skillTool', description: 'A rare instrument that turns practice into mastery.' }
];
