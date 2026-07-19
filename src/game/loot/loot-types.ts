export const RARITY_IDS = [
  'common',
  'uncommon',
  'rare',
  'epic',
  'legendary',
  'mythic',
  'ascendant',
  'chase'
] as const;

export type RarityId = (typeof RARITY_IDS)[number];

export type LootSlot = 'melee' | 'ranged' | 'gun' | 'magic' | 'armor';

export type CombatStat =
  | 'damage'
  | 'attackInterval'
  | 'accuracy'
  | 'maxHit'
  | 'range'
  | 'hp'
  | 'critChance'
  | 'bossDamage'
  | 'dashCooldown'
  | 'projectileDamage';

export interface RarityDefinition {
  id: RarityId;
  name: string;
  color: string;
  glow: 'none' | 'soft' | 'strong' | 'pulse';
  affixCount: number;
  statMultiplier: number;
}

export interface AffixDefinition {
  id: string;
  name: string;
  stat: CombatStat;
  min: number;
  max: number;
  unit?: '%' | 'flat' | 'seconds';
}

export interface AffixRoll {
  id: string;
  name: string;
  stat: CombatStat;
  value: number;
  tier: number;
  unit: '%' | 'flat' | 'seconds';
}

export interface ItemDefinition {
  id: string;
  name: string;
  slot: LootSlot;
  description: string;
  baseStats: Partial<Record<CombatStat, number>>;
  signatureId: string;
  signatureName: string;
  signatureDescription: string;
  affixPool: readonly AffixDefinition[];
  sourceTags: readonly string[];
}

export interface ItemInstance {
  instanceId: string;
  definitionId: string;
  rarity: RarityId;
  itemLevel: number;
  affixes: readonly AffixRoll[];
  signatureId: string;
  sourceId: string;
  acquiredAt: number;
}

export interface LootTable {
  id: string;
  sourceType: 'arenaBoss' | 'partyBoss';
  sourceId: string;
  itemChance: number;
  salvageMin: number;
  salvageMax: number;
  collectionProgress: number;
  rarityWeights: Readonly<Partial<Record<RarityId, number>>>;
  itemDefinitionIds: readonly string[];
}

export interface LootSourceContext {
  sourceType: LootTable['sourceType'];
  sourceId: string;
  sourceTier: number;
  playerLevel: number;
  runId: string;
  now?: number;
}

export interface LootResolution {
  tableId: string;
  item: ItemInstance | null;
  salvage: number;
  collectionTrackId: string;
  collectionProgress: number;
  rarity: RarityId | null;
}

export interface SkillToolDefinition {
  id: string;
  name: string;
  skillId: string;
  tier: number;
  requiredLevel: number;
  xpMultiplier: number;
  description: string;
  recipeId: string;
}

export interface SkillToolInstance {
  instanceId: string;
  toolId: string;
  acquiredAt: number;
}

export interface LootInspection {
  definition: ItemDefinition;
  instance: ItemInstance;
  stats: Partial<Record<CombatStat, number>>;
  rarity: RarityDefinition;
  signature: string;
}
