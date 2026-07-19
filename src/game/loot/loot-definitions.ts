import type { AffixDefinition, ItemDefinition, LootTable, RarityDefinition, SkillToolDefinition } from './loot-types';

export const RARITY_DEFINITIONS: readonly RarityDefinition[] = [
  { id: 'common', name: 'Common', color: '#9aa4b2', glow: 'none', affixCount: 0, statMultiplier: 1 },
  { id: 'uncommon', name: 'Uncommon', color: '#63d77b', glow: 'soft', affixCount: 1, statMultiplier: 1.08 },
  { id: 'rare', name: 'Rare', color: '#55a9ff', glow: 'soft', affixCount: 2, statMultiplier: 1.18 },
  { id: 'epic', name: 'Epic', color: '#b780ff', glow: 'strong', affixCount: 3, statMultiplier: 1.3 },
  { id: 'legendary', name: 'Legendary', color: '#ff9a42', glow: 'strong', affixCount: 4, statMultiplier: 1.45 },
  { id: 'mythic', name: 'Mythic', color: '#ff4d5f', glow: 'strong', affixCount: 5, statMultiplier: 1.62 },
  { id: 'ascendant', name: 'Ascendant', color: '#ff3e62', glow: 'pulse', affixCount: 5, statMultiplier: 1.72 },
  { id: 'chase', name: 'Chase Unique', color: '#080b12', glow: 'pulse', affixCount: 5, statMultiplier: 1.8 }
];

const combatAffixes: readonly AffixDefinition[] = [
  { id: 'keen-edge', name: 'Keen Edge', stat: 'damage', min: 1, max: 4, unit: 'flat' },
  { id: 'quick-hand', name: 'Quick Hand', stat: 'attackInterval', min: -0.08, max: -0.02, unit: 'seconds' },
  { id: 'true-sight', name: 'True Sight', stat: 'accuracy', min: 1, max: 5, unit: 'flat' },
  { id: 'heavy-impact', name: 'Heavy Impact', stat: 'maxHit', min: 1, max: 3, unit: 'flat' },
  { id: 'long-reach', name: 'Long Reach', stat: 'range', min: 4, max: 16, unit: 'flat' },
  { id: 'reinforced', name: 'Reinforced', stat: 'hp', min: 4, max: 18, unit: 'flat' },
  { id: 'boss-hunter', name: 'Boss Hunter', stat: 'bossDamage', min: 2, max: 8, unit: '%' },
  { id: 'evasive', name: 'Evasive', stat: 'dashCooldown', min: -0.2, max: -0.05, unit: 'seconds' }
];

export const COMBAT_LOOT_DEFINITIONS: readonly ItemDefinition[] = [
  {
    id: 'initiates-edge',
    name: "Initiate's Edge",
    slot: 'melee',
    description: 'A frontier blade marked by the first gate.',
    baseStats: { damage: 16, attackInterval: 0.52, accuracy: 4, maxHit: 7, range: 66 },
    signatureId: 'shockbreaker',
    signatureName: 'Shockbreaker',
    signatureDescription: 'Successful swings deal +10% damage to bosses currently telegraphing a shockwave.',
    affixPool: combatAffixes,
    sourceTags: ['arena:1', 'party:forest']
  },
  {
    id: 'vanguard-repeater',
    name: 'Vanguard Repeater',
    slot: 'gun',
    description: 'A compact sidearm tuned for sustained pressure.',
    baseStats: { damage: 12, attackInterval: 0.23, accuracy: 7, maxHit: 5, projectileDamage: 2 },
    signatureId: 'overwatch',
    signatureName: 'Overwatch',
    signatureDescription: 'The first shot after a dash deals +20% damage.',
    affixPool: combatAffixes,
    sourceTags: ['arena:2', 'party:forest']
  },
  {
    id: 'apex-aegis',
    name: 'Apex Aegis',
    slot: 'armor',
    description: 'A plated mantle cut from the Apex frontier.',
    baseStats: { hp: 34, dashCooldown: 0.1 },
    signatureId: 'last-stand',
    signatureName: 'Last Stand',
    signatureDescription: 'Once per arena run, lethal damage leaves the player at 1 HP.',
    affixPool: combatAffixes,
    sourceTags: ['arena:3', 'party:forest']
  },
  {
    id: 'black-star-crescent',
    name: 'Black-Star Crescent',
    slot: 'melee',
    description: 'An impossible edge that appears only in the deepest frontier records.',
    baseStats: { damage: 25, attackInterval: 0.48, accuracy: 8, maxHit: 12, range: 72 },
    signatureId: 'black-star',
    signatureName: 'Black Star',
    signatureDescription: 'Every fifth hit creates a brief gravity well that interrupts hostile projectiles.',
    affixPool: combatAffixes,
    sourceTags: ['arena:3', 'party:forest']
  }
];

export const SKILL_TOOL_DEFINITIONS: readonly SkillToolDefinition[] = [
  { id: 'guitar', name: 'Guitar', skillId: 'Music', tier: 1, requiredLevel: 1, xpMultiplier: 1, description: 'Unlocks Music training and provides a reliable practice baseline.', recipeId: 'guitar' },
  { id: 'drums', name: 'Drums', skillId: 'Music', tier: 2, requiredLevel: 5, xpMultiplier: 1.2, description: 'A louder practice setup that accelerates Music training.', recipeId: 'drums' },
  { id: 'piano', name: 'Piano', skillId: 'Music', tier: 3, requiredLevel: 12, xpMultiplier: 1.5, description: 'A precision instrument for high-rate Music training.', recipeId: 'piano' },
  { id: 'harp', name: 'Harp', skillId: 'Music', tier: 4, requiredLevel: 20, xpMultiplier: 1.8, description: 'A rare instrument that turns long practice sessions into mastery.', recipeId: 'harp' }
];

const standardRarityWeights = { common: 45, uncommon: 28, rare: 15, epic: 7, legendary: 3.5, mythic: 1, ascendant: 0.45, chase: 0.05 } as const;

export const ARENA_LOOT_TABLES: readonly LootTable[] = [
  {
    id: 'arena:1', sourceType: 'arenaBoss', sourceId: 'arena:1', itemChance: 0.35, salvageMin: 4, salvageMax: 8, collectionProgress: 1,
    rarityWeights: standardRarityWeights, itemDefinitionIds: ['initiates-edge']
  },
  {
    id: 'arena:2', sourceType: 'arenaBoss', sourceId: 'arena:2', itemChance: 0.45, salvageMin: 8, salvageMax: 14, collectionProgress: 2,
    rarityWeights: standardRarityWeights, itemDefinitionIds: ['initiates-edge', 'vanguard-repeater']
  },
  {
    id: 'arena:3', sourceType: 'arenaBoss', sourceId: 'arena:3', itemChance: 0.6, salvageMin: 14, salvageMax: 24, collectionProgress: 3,
    rarityWeights: standardRarityWeights, itemDefinitionIds: ['vanguard-repeater', 'apex-aegis', 'black-star-crescent']
  }
];

export const PARTY_BOSS_LOOT_TABLE: LootTable = {
  id: 'party:forest', sourceType: 'partyBoss', sourceId: 'party:forest', itemChance: 0.5, salvageMin: 10, salvageMax: 18, collectionProgress: 2,
  rarityWeights: standardRarityWeights, itemDefinitionIds: ['initiates-edge', 'vanguard-repeater', 'apex-aegis', 'black-star-crescent']
};
