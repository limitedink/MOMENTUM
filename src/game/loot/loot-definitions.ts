import type { AffixDefinition, ArmourWeight, ItemDefinition, LootTable, RarityDefinition, SkillToolDefinition } from './loot-types';

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

export const COMBAT_AFFIX_DEFINITIONS: readonly AffixDefinition[] = [
  { id: 'keen-edge', name: 'Keen Edge', stat: 'damage', min: 1, max: 4, unit: 'flat' },
  { id: 'quick-hand', name: 'Quick Hand', stat: 'attackInterval', min: -0.08, max: -0.02, unit: 'seconds' },
  { id: 'true-sight', name: 'True Sight', stat: 'accuracy', min: 1, max: 5, unit: 'flat' },
  { id: 'heavy-impact', name: 'Heavy Impact', stat: 'maxHit', min: 1, max: 3, unit: 'flat' },
  { id: 'long-reach', name: 'Long Reach', stat: 'range', min: 4, max: 16, unit: 'flat' },
  { id: 'reinforced', name: 'Reinforced', stat: 'hp', min: 4, max: 18, unit: 'flat' },
  { id: 'boss-hunter', name: 'Boss Hunter', stat: 'bossDamage', min: 2, max: 8, unit: '%' },
  { id: 'evasive', name: 'Evasive', stat: 'dashCooldown', min: -0.2, max: -0.05, unit: 'seconds' }
];

const DEFAULT_SOURCE_TAGS = ['arena:1', 'arena:2', 'arena:3', 'party:forest'] as const;

type BaseInput = Omit<ItemDefinition, 'affixPool' | 'sourceTags'> & {
  affixPool?: readonly AffixDefinition[];
  sourceTags?: readonly string[];
};

function itemBase(input: BaseInput): ItemDefinition {
  return {
    ...input,
    affixPool: input.affixPool || COMBAT_AFFIX_DEFINITIONS,
    sourceTags: input.sourceTags || DEFAULT_SOURCE_TAGS
  };
}

function weaponBase(
  id: string,
  name: string,
  slot: 'melee' | 'gun' | 'ranged' | 'magic',
  weight: ArmourWeight,
  baseStats: ItemDefinition['baseStats'],
  signatureId: string,
  signatureName: string,
  signatureDescription: string,
  description = `A ${weight} ${slot} weapon built for the frontier.`
): ItemDefinition {
  return itemBase({ id, name, slot, kind: 'weapon', weight, description, baseStats, signatureId, signatureName, signatureDescription });
}

function armourBase(
  id: string,
  name: string,
  slot: 'helm' | 'chest' | 'gloves' | 'pants' | 'boots' | 'cloak',
  weight: ArmourWeight,
  baseStats: ItemDefinition['baseStats'],
  signatureId: string,
  signatureName: string,
  signatureDescription: string,
  description = `A ${weight} ${slot} armour base.`
): ItemDefinition {
  return itemBase({ id, name, slot, kind: 'armour', weight, description, baseStats, signatureId, signatureName, signatureDescription });
}

function accessoryBase(
  id: string,
  name: string,
  slot: 'belt' | 'amulet' | 'ring' | 'trinket',
  baseStats: ItemDefinition['baseStats'],
  signatureId: string,
  signatureName: string,
  signatureDescription: string,
  description = `A frontier ${slot} accessory.`
): ItemDefinition {
  return itemBase({ id, name, slot, kind: 'accessory', description, baseStats, signatureId, signatureName, signatureDescription });
}

/** The v19 paper doll's data-driven item bases. Legacy IDs remain unchanged. */
export const COMBAT_LOOT_DEFINITIONS: readonly ItemDefinition[] = [
  // Three melee weights. `initiates-edge` and `black-star-crescent` are legacy IDs.
  weaponBase('initiates-edge', "Initiate's Edge", 'melee', 'light', { damage: 16, attackInterval: 0.52, accuracy: 4, maxHit: 7, range: 66 }, 'shockbreaker', 'Shockbreaker', 'Successful swings deal +10% damage to bosses currently telegraphing a shockwave.', 'A frontier blade marked by the first gate.'),
  weaponBase('frontier-warhammer', 'Frontier Warhammer', 'melee', 'medium', { damage: 22, attackInterval: 0.7, accuracy: 2, maxHit: 11, range: 58 }, 'earthshaker', 'Earthshaker', 'Heavy hits briefly stagger enemies below half health.'),
  weaponBase('black-star-crescent', 'Black-Star Crescent', 'melee', 'heavy', { damage: 25, attackInterval: 0.48, accuracy: 8, maxHit: 12, range: 72 }, 'black-star', 'Black Star', 'Every fifth hit creates a brief gravity well that interrupts hostile projectiles.', 'An impossible edge that appears only in the deepest frontier records.'),

  // Three guns. `vanguard-repeater` is a legacy ID.
  weaponBase('vanguard-repeater', 'Vanguard Repeater', 'gun', 'light', { damage: 12, attackInterval: 0.23, accuracy: 7, maxHit: 5, projectileDamage: 2 }, 'overwatch', 'Overwatch', 'The first shot after a dash deals +20% damage.', 'A compact sidearm tuned for sustained pressure.'),
  weaponBase('ironshot-carbine', 'Ironshot Carbine', 'gun', 'medium', { damage: 18, attackInterval: 0.34, accuracy: 10, maxHit: 8, projectileDamage: 4 }, 'pinning-fire', 'Pinning Fire', 'A critical shot reduces the target\'s movement briefly.'),
  weaponBase('sunbreak-pistol', 'Sunbreak Pistol', 'gun', 'heavy', { damage: 28, attackInterval: 0.52, accuracy: 6, maxHit: 14, projectileDamage: 7 }, 'solar-flare', 'Solar Flare', 'The first hit on a full-health enemy burns through its ward.'),

  // Three ranged weapons.
  weaponBase('reedline-bow', 'Reedline Bow', 'ranged', 'light', { damage: 14, attackInterval: 0.42, accuracy: 9, maxHit: 6, range: 110, projectileDamage: 3 }, 'windstep', 'Windstep', 'A charged shot after a dash travels farther and faster.'),
  weaponBase('watcher-crossbow', 'Watcher Crossbow', 'ranged', 'medium', { damage: 21, attackInterval: 0.66, accuracy: 12, maxHit: 10, range: 125, projectileDamage: 5 }, 'deadeye', 'Deadeye', 'The first projectile against a telegraphing boss cannot miss.'),
  weaponBase('stormlance', 'Stormlance', 'ranged', 'heavy', { damage: 31, attackInterval: 0.82, accuracy: 8, maxHit: 16, range: 135, projectileDamage: 8 }, 'storm-piercer', 'Storm Piercer', 'Every fourth projectile pierces one additional target.'),

  // Three magic weapons.
  weaponBase('ember-focus', 'Ember Focus', 'magic', 'light', { damage: 13, attackInterval: 0.38, accuracy: 8, maxHit: 7, projectileDamage: 5 }, 'kindled-core', 'Kindled Core', 'Magic damage leaves a short-lived ember on the target.'),
  weaponBase('tide-scepter', 'Tide Scepter', 'magic', 'medium', { damage: 20, attackInterval: 0.55, accuracy: 11, maxHit: 10, range: 96, projectileDamage: 6 }, 'undertow', 'Undertow', 'The first spell after a dash pulls hostile projectiles inward.'),
  weaponBase('void-grimoire', 'Void Grimoire', 'magic', 'heavy', { damage: 30, attackInterval: 0.78, accuracy: 9, maxHit: 15, range: 104, projectileDamage: 10 }, 'null-script', 'Null Script', 'Every fifth spell strips one temporary enemy enhancement.'),

  // One light, medium, and heavy base for every armour and cloak position.
  armourBase('scout-helm', 'Scout Helm', 'helm', 'light', { hp: 12, armour: 4, dashCooldown: -0.08 }, 'quick-visor', 'Quick Visor', 'Dashing after a hit grants a brief accuracy bonus.'),
  armourBase('warden-helm', 'Warden Helm', 'helm', 'medium', { hp: 20, armour: 6, accuracy: 2 }, 'watchful-crown', 'Watchful Crown', 'Telegraphed attacks are easier to read.'),
  armourBase('citadel-helm', 'Citadel Helm', 'helm', 'heavy', { hp: 30, armour: 9, maxHit: 2 }, 'iron-brow', 'Iron Brow', 'The first stagger received each run is reduced.'),
  armourBase('trail-jacket', 'Trail Jacket', 'chest', 'light', { hp: 18, armour: 8, dashCooldown: -0.1 }, 'trailblazer', 'Trailblazer', 'Moving through a shockwave restores a little momentum.'),
  armourBase('frontier-mail', 'Frontier Mail', 'chest', 'medium', { hp: 28, armour: 12, accuracy: 1 }, 'steady-heart', 'Steady Heart', 'Taking damage does not interrupt the next attack wind-up.'),
  armourBase('apex-aegis', 'Apex Aegis', 'chest', 'heavy', { hp: 34, armour: 16, dashCooldown: 0.1 }, 'last-stand', 'Last Stand', 'Once per arena run, lethal damage leaves the player at 1 HP.', 'A plated mantle cut from the Apex frontier.'),
  armourBase('pathfinder-gloves', 'Pathfinder Gloves', 'gloves', 'light', { armour: 3, accuracy: 3, dashCooldown: -0.05 }, 'sure-grip', 'Sure Grip', 'A dash never drops the current aim.'),
  armourBase('forgebound-gloves', 'Forgebound Gloves', 'gloves', 'medium', { armour: 5, damage: 3, hp: 8 }, 'tempered-grip', 'Tempered Grip', 'The next attack after taking damage gains force.'),
  armourBase('bastion-gauntlets', 'Bastion Gauntlets', 'gloves', 'heavy', { armour: 7, damage: 5, hp: 15 }, 'crushing-guard', 'Crushing Guard', 'Blocking a shockwave empowers the next hit.'),
  armourBase('scout-pants', 'Scout Pants', 'pants', 'light', { hp: 14, armour: 5, dashCooldown: -0.12 }, 'free-stride', 'Free Stride', 'The first dash in a run has reduced cooldown.'),
  armourBase('warden-greaves', 'Warden Greaves', 'pants', 'medium', { hp: 24, armour: 8, range: 8 }, 'rooted-step', 'Rooted Step', 'Being hit while grounded grants a short ward.'),
  armourBase('citadel-cuisses', 'Citadel Cuisses', 'pants', 'heavy', { hp: 38, armour: 11, maxHit: 2 }, 'unyielding', 'Unyielding', 'The player cannot be staggered twice in quick succession.'),
  armourBase('trail-boots', 'Trail Boots', 'boots', 'light', { armour: 3, dashCooldown: -0.15, range: 5 }, 'windwalker', 'Windwalker', 'A successful dash briefly improves range.'),
  armourBase('march-boots', 'March Boots', 'boots', 'medium', { armour: 5, hp: 16, dashCooldown: -0.07 }, 'marching-song', 'Marching Song', 'The next attack after a dash has improved accuracy.'),
  armourBase('iron-tread', 'Iron Tread', 'boots', 'heavy', { armour: 7, hp: 27, maxHit: 3 }, 'grounded', 'Grounded', 'Shockwaves deal slightly less damage while grounded.'),
  armourBase('drift-cloak', 'Drift Cloak', 'cloak', 'light', { hp: 10, armour: 4, ward: 4, dashCooldown: -0.1, range: 10 }, 'afterimage', 'Afterimage', 'A dash leaves an afterimage that draws projectiles.'),
  armourBase('traveler-cloak', 'Traveler Cloak', 'cloak', 'medium', { hp: 20, armour: 6, ward: 6, accuracy: 2, range: 6 }, 'long-road', 'Long Road', 'The first attack in each encounter gains range.'),
  armourBase('nightwall-cloak', 'Nightwall Cloak', 'cloak', 'heavy', { hp: 32, armour: 9, ward: 10, dashCooldown: 0.08 }, 'nightwall', 'Nightwall', 'A cloak woven from the frontier night absorbs a hit.', 'A heavy cloak that turns aside hostile magic.'),

  // Accessories: two belts, two amulets, three rings, and three trinkets.
  accessoryBase('utility-belt', 'Utility Belt', 'belt', { hp: 10, dashCooldown: -0.04 }, 'quick-access', 'Quick Access', 'The first consumable used each encounter is faster.'),
  accessoryBase('warbelt', 'Warbelt', 'belt', { damage: 4, maxHit: 2 }, 'battle-ready', 'Battle Ready', 'Entering an encounter grants a small damage surge.'),
  accessoryBase('amulet-of-embers', 'Amulet of Embers', 'amulet', { damage: 3, projectileDamage: 3 }, 'ember-oath', 'Ember Oath', 'The first spell or projectile ignites the target.'),
  accessoryBase('amulet-of-guarding', 'Amulet of Guarding', 'amulet', { hp: 18, ward: 8, bossDamage: 2 }, 'ward-oath', 'Ward Oath', 'A boss telegraph grants a brief ward.'),
  accessoryBase('frontier-ring', 'Frontier Ring', 'ring', { accuracy: 3, range: 6 }, 'frontier-mark', 'Frontier Mark', 'The first attack on a new target gains accuracy.'),
  accessoryBase('ring-of-momentum', 'Ring of Momentum', 'ring', { dashCooldown: -0.08, damage: 2 }, 'rolling-start', 'Rolling Start', 'A dash resets a small part of attack recovery.'),
  accessoryBase('ring-of-the-apex', 'Ring of the Apex', 'ring', { hp: 12, bossDamage: 5 }, 'apex-mark', 'Apex Mark', 'Bosses below half health take increased damage.'),
  accessoryBase('glass-compass', 'Glass Compass', 'trinket', { range: 12, accuracy: 2 }, 'true-north', 'True North', 'Projectile paths subtly correct toward marked targets.'),
  accessoryBase('frontier-talisman', 'Frontier Talisman', 'trinket', { hp: 16, dashCooldown: -0.05 }, 'safe-return', 'Safe Return', 'The first failed dash each run does not consume its recovery.'),
  accessoryBase('boss-key-fragment', 'Boss-Key Fragment', 'trinket', { bossDamage: 4, maxHit: 1 }, 'keyed-fate', 'Keyed Fate', 'The first boss hit of an encounter marks the boss.'),
];

export const LEGACY_ITEM_DEFINITION_IDS = Object.freeze([
  'initiates-edge',
  'vanguard-repeater',
  'apex-aegis',
  'black-star-crescent'
] as const);

export const COMBAT_LOOT_ITEM_IDS = Object.freeze(COMBAT_LOOT_DEFINITIONS.map(item => item.id));

const withUniqueItemIds = (...ids: readonly string[]) => [...new Set(ids)];

export const SKILL_TOOL_DEFINITIONS: readonly SkillToolDefinition[] = [
  { id: 'guitar', name: 'Guitar', skillId: 'Music', tier: 1, requiredLevel: 1, xpMultiplier: 1, description: 'Unlocks Music training and provides a reliable practice baseline.', recipeId: 'guitar' },
  { id: 'drums', name: 'Drums', skillId: 'Music', tier: 2, requiredLevel: 5, xpMultiplier: 1.2, description: 'A louder practice setup that accelerates Music training.', recipeId: 'drums' },
  { id: 'piano', name: 'Piano', skillId: 'Music', tier: 3, requiredLevel: 12, xpMultiplier: 1.5, description: 'A precision instrument for high-rate Music training.', recipeId: 'piano' },
  { id: 'harp', name: 'Harp', skillId: 'Music', tier: 4, requiredLevel: 20, xpMultiplier: 1.8, description: 'A rare instrument that turns long practice sessions into mastery.', recipeId: 'harp' }
];

/** Non-combat tools intentionally remain outside the paper-doll item bases. */
export const NON_COMBAT_TOOL_DEFINITIONS = SKILL_TOOL_DEFINITIONS;

const standardRarityWeights = { common: 45, uncommon: 28, rare: 15, epic: 7, legendary: 3.5, mythic: 1, ascendant: 0.45, chase: 0.05 } as const;

export const ARENA_LOOT_TABLES: readonly LootTable[] = [
  {
    id: 'arena:1', sourceType: 'arenaBoss', sourceId: 'arena:1', itemChance: 0.35, salvageMin: 4, salvageMax: 8, collectionProgress: 1,
    rarityWeights: standardRarityWeights, itemDefinitionIds: withUniqueItemIds('initiates-edge', ...COMBAT_LOOT_ITEM_IDS)
  },
  {
    id: 'arena:2', sourceType: 'arenaBoss', sourceId: 'arena:2', itemChance: 0.45, salvageMin: 8, salvageMax: 14, collectionProgress: 2,
    rarityWeights: standardRarityWeights, itemDefinitionIds: withUniqueItemIds('initiates-edge', 'vanguard-repeater', ...COMBAT_LOOT_ITEM_IDS)
  },
  {
    id: 'arena:3', sourceType: 'arenaBoss', sourceId: 'arena:3', itemChance: 0.6, salvageMin: 14, salvageMax: 24, collectionProgress: 3,
    rarityWeights: standardRarityWeights, itemDefinitionIds: withUniqueItemIds('vanguard-repeater', 'apex-aegis', 'black-star-crescent', ...COMBAT_LOOT_ITEM_IDS)
  }
];

export const PARTY_BOSS_LOOT_TABLE: LootTable = {
  id: 'party:forest', sourceType: 'partyBoss', sourceId: 'party:forest', itemChance: 0.5, salvageMin: 10, salvageMax: 18, collectionProgress: 2,
  rarityWeights: standardRarityWeights, itemDefinitionIds: withUniqueItemIds('initiates-edge', 'vanguard-repeater', 'apex-aegis', 'black-star-crescent', ...COMBAT_LOOT_ITEM_IDS)
};

/** Solo Frontier uses the same item bases, but its runtime supplies the
 * encounter-specific chance, rarity floor, and advertised slot weighting. */
export const SOLO_FRONTIER_LOOT_TABLE: LootTable = {
  id: 'solo-frontier', sourceType: 'soloFrontier', sourceId: 'solo-frontier', itemChance: 0.01, salvageMin: 2, salvageMax: 8, collectionProgress: 1,
  rarityWeights: standardRarityWeights, itemDefinitionIds: withUniqueItemIds(...COMBAT_LOOT_ITEM_IDS)
};
