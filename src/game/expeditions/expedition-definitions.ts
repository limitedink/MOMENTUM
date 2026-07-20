import type { ExpeditionDefinition, ExpeditionRoleDefinition } from './expedition-types';

const cookingRoles: readonly ExpeditionRoleDefinition[] = [
  {
    id: 'forager', name: 'Forager', description: 'Finds fresh ingredients and keeps the party supplied.',
    skillWeights: { Woodcutting: 0.65, Fishing: 0.45 }, farmingWeight: 1.2, completionWeight: 0.8, dangerReduction: 0.15,
    preferredGearTags: ['gathering', 'field'], targetIds: ['river-run', 'pine-bend']
  },
  {
    id: 'preparation', name: 'Preparation', description: 'Turns rough ingredients into a reliable mise en place.',
    skillWeights: { Cooking: 0.8, Crafting: 0.35 }, farmingWeight: 0.9, completionWeight: 1, dangerReduction: 0.08
  },
  {
    id: 'cooking', name: 'Cooking', description: 'Runs the fire and determines the expedition’s final quality.',
    skillWeights: { Cooking: 1 }, farmingWeight: 1, completionWeight: 1.35, dangerReduction: 0.12,
    preferredGearTags: ['kitchen', 'precision']
  },
  {
    id: 'stewardship', name: 'Stewardship / Cleaning', shortName: 'Stewardship', description: 'Keeps the camp safe, clean, and ready for the next phase.',
    skillWeights: { Cooking: 0.4, Crafting: 0.25 }, farmingWeight: 0.7, completionWeight: 0.75, dangerReduction: 0.3,
    preferredGearTags: ['field', 'utility']
  },
  {
    id: 'quartermaster', name: 'Quartermaster', description: 'Plans portions and prevents waste in the supply line.',
    skillWeights: { Crafting: 0.55, Smithing: 0.25, Mining: 0.15 }, farmingWeight: 0.85, completionWeight: 0.95, dangerReduction: 0.18,
    preferredGearTags: ['utility', 'supply']
  },
  {
    id: 'host', name: 'Host / Morale', shortName: 'Host', description: 'Keeps the party coordinated and spirits high.',
    skillWeights: { Music: 0.7, Cooking: 0.2 }, farmingWeight: 0.65, completionWeight: 0.85, dangerReduction: 0.22,
    preferredGearTags: ['social', 'music']
  }
];

const combatRoles: readonly ExpeditionRoleDefinition[] = [
  {
    id: 'dps', name: 'DPS', description: 'Converts combat mastery into reliable pressure on the target.',
    skillWeights: { Strength: 0.28, 'Melee Accuracy': 0.22, Marksmanship: 0.18, Ranged: 0.16, Magic: 0.16 },
    derivedWeights: { combatRating: 1, gearScore: 0.35, affixScore: 0.25, talentScore: 0.25, loadoutScore: 0.2 },
    farmingWeight: 1.2, completionWeight: 1.25, dangerReduction: 0.08, targetIds: ['mire-stalker', 'ember-hart', 'cave-warden']
  },
  {
    id: 'tank', name: 'Tank', description: 'Absorbs danger and buys the party time to execute its plan.',
    skillWeights: { Strength: 0.2, 'Heavy Armour Proficiency': 0.45, 'Medium Armour Proficiency': 0.2, Reflexes: 0.15 },
    derivedWeights: { defenseRating: 1, defenseGearScore: 0.55, gearScore: 0.25, loadoutScore: 0.2 },
    preferredGearTags: ['heavy', 'guard'], farmingWeight: 0.85, completionWeight: 1.1, dangerReduction: 1, targetIds: ['ember-hart', 'cave-warden']
  },
  {
    id: 'healer', name: 'Healer', description: 'Restores the party through attrition and stabilises failed phases.',
    skillWeights: { Healing: 0.7, Magic: 0.2, Reflexes: 0.1 },
    derivedWeights: { combatRating: 0.25, defenseRating: 0.3, talentScore: 0.35, loadoutScore: 0.25 },
    preferredGearTags: ['healing', 'support'], farmingWeight: 0.8, completionWeight: 1, dangerReduction: 0.75, targetIds: ['mire-stalker', 'ember-hart', 'cave-warden']
  },
  {
    id: 'support', name: 'Support', description: 'Improves the whole formation through control, utility, and timing.',
    skillWeights: { Reflexes: 0.4, Healing: 0.25, Magic: 0.2, 'Melee Accuracy': 0.15 },
    derivedWeights: { combatRating: 0.25, defenseRating: 0.25, affixScore: 0.4, talentScore: 0.4, loadoutScore: 0.35 },
    preferredGearTags: ['support', 'utility'], farmingWeight: 0.9, completionWeight: 1, dangerReduction: 0.65, targetIds: ['mire-stalker', 'ember-hart', 'cave-warden']
  }
];

export const COOKING_EXPEDITION_DEFINITION: ExpeditionDefinition = {
  id: 'cooking:campfire-supper',
  name: 'Campfire Supper',
  kind: 'cooking',
  description: 'A low-danger supply run where preparation and morale determine the quality of the final meal.',
  durationMs: 2 * 60 * 60 * 1000,
  slotCount: 4,
  allowDuplicateRoles: true,
  failureMode: 'quality',
  roles: cookingRoles,
  phases: [
    { id: 'gather', name: 'Gather ingredients', durationRatio: 0.3, farmingMultiplier: 1, completionWeight: 0.8, dangerWeight: 0.1 },
    { id: 'prep', name: 'Prepare the camp', durationRatio: 0.25, farmingMultiplier: 0.95, completionWeight: 1, dangerWeight: 0.15 },
    { id: 'cook', name: 'Cook the supper', durationRatio: 0.3, farmingMultiplier: 1.05, completionWeight: 1.35, dangerWeight: 0.25 },
    { id: 'serve', name: 'Serve and clean', durationRatio: 0.15, farmingMultiplier: 1, completionWeight: 0.85, dangerWeight: 0.05 }
  ],
  targets: [
    { id: 'river-run', name: 'River Run', materialId: 'Raw Fish', requiredRoleId: 'forager', requiredSkillId: 'Fishing', requiredSkillLevel: 3, preferredTags: ['gathering'] },
    { id: 'pine-bend', name: 'Pine Bend', materialId: 'Pine Logs', requiredRoleId: 'forager', requiredSkillId: 'Woodcutting', requiredSkillLevel: 3, preferredTags: ['gathering'] }
  ],
  farmingRewards: { 'Raw Fish': 1.1, 'Pine Logs': 0.8, 'Cooked Fish': 0.35 },
  completionRewards: [
    { id: 'rough', label: 'Rough supper', minimumSuccess: 0, resources: { 'Cooked Fish': 4 } },
    { id: 'hearty', label: 'Hearty supper', minimumSuccess: 48, resources: { 'Cooked Fish': 8, Herbs: 2 } },
    { id: 'feast', label: 'Frontier feast', minimumSuccess: 72, resources: { 'Cooked Fish': 14, Herbs: 5 }, gold: 25 },
    { id: 'legendary', label: 'Legendary banquet', minimumSuccess: 90, resources: { 'Cooked Fish': 22, Herbs: 9 }, gold: 75 }
  ],
  baseSuccess: 18,
  baseDanger: 5,
  maxDanger: 45
};

export const COMBAT_EXPEDITION_DEFINITION: ExpeditionDefinition = {
  id: 'combat:forest-hunt',
  name: 'Forest Hunt',
  kind: 'combat',
  description: 'A target-driven combat expedition where composition, loadout, and coverage decide the clear.',
  durationMs: 2 * 60 * 60 * 1000,
  slotCount: 4,
  allowDuplicateRoles: true,
  failureMode: 'hard',
  roles: combatRoles,
  phases: [
    { id: 'track', name: 'Track the target', durationRatio: 0.2, farmingMultiplier: 0.85, completionWeight: 0.7, dangerWeight: 0.15 },
    { id: 'engage', name: 'Engage the target', durationRatio: 0.35, farmingMultiplier: 1, completionWeight: 1.2, dangerWeight: 0.45 },
    { id: 'break', name: 'Break its guard', durationRatio: 0.25, farmingMultiplier: 1.1, completionWeight: 1.35, dangerWeight: 0.35 },
    { id: 'secure', name: 'Secure the materials', durationRatio: 0.2, farmingMultiplier: 1.15, completionWeight: 0.85, dangerWeight: 0.1 }
  ],
  targets: [
    { id: 'mire-stalker', name: 'Mire Stalker', materialId: 'Mire Resin', preferredTags: ['ranged', 'support'], dangerModifier: 5 },
    { id: 'ember-hart', name: 'Ember Hart', materialId: 'Ember Antler', requiredRoleId: 'tank', preferredTags: ['heavy', 'melee'], dangerModifier: 12 },
    { id: 'cave-warden', name: 'Cave Warden', materialId: 'Warden Shard', requiredRoleId: 'healer', preferredTags: ['healing', 'magic'], dangerModifier: 18 }
  ],
  farmingRewards: { 'Mire Resin': 0.45, 'Ember Antler': 0.22, 'Warden Shard': 0.12, 'Boss Keys': 0.05 },
  completionRewards: [
    { id: 'salvage', label: 'Salvage only', minimumSuccess: 0, resources: { Scrap: 10 } },
    { id: 'cache', label: 'Combat cache', minimumSuccess: 58, resources: { Scrap: 18, 'Boss Keys': 2 } },
    { id: 'trophy', label: 'Target trophy', minimumSuccess: 78, resources: { Scrap: 28, 'Boss Keys': 4 }, gold: 35 },
    { id: 'masterwork', label: 'Masterwork cache', minimumSuccess: 92, resources: { Scrap: 40, 'Boss Keys': 7 }, gold: 100 }
  ],
  baseSuccess: 8,
  baseDanger: 22,
  maxDanger: 95
};

export const EXPEDITION_DEFINITIONS: readonly ExpeditionDefinition[] = [
  COOKING_EXPEDITION_DEFINITION,
  COMBAT_EXPEDITION_DEFINITION
];

export function getExpeditionDefinition(id: string): ExpeditionDefinition | null {
  return EXPEDITION_DEFINITIONS.find(definition => definition.id === id) ?? null;
}
