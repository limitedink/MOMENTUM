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

export const EQUIPMENT_SLOT_IDS = [
  'melee',
  'gun',
  'ranged',
  'magic',
  'helm',
  'chest',
  'gloves',
  'pants',
  'boots',
  'belt',
  'cloak',
  'amulet',
  'ring1',
  'ring2',
  'trinket1',
  'trinket2',
  'food'
] as const;

export const PAPER_DOLL_SLOT_IDS = EQUIPMENT_SLOT_IDS;
export const EQUIPMENT_POSITIONS = EQUIPMENT_SLOT_IDS;
export const PAPER_DOLL_SLOTS = EQUIPMENT_SLOT_IDS;
export const EQUIPMENT_SLOTS = EQUIPMENT_SLOT_IDS;
export const COMBAT_EQUIPMENT_SLOT_IDS = [
  'melee', 'gun', 'ranged', 'magic', 'helm', 'chest', 'gloves', 'pants', 'boots', 'belt', 'cloak', 'amulet',
  'ring1', 'ring2', 'trinket1', 'trinket2'
] as const;
export const NON_COMBAT_TOOL_SLOTS = ['tool'] as const;
export type NonCombatToolSlotId = (typeof NON_COMBAT_TOOL_SLOTS)[number];

export type EquipmentSlotId = (typeof EQUIPMENT_SLOT_IDS)[number];
export type EquipmentPosition = EquipmentSlotId;
export type PaperDollSlot = EquipmentSlotId;
export type WeaponSlotId = 'melee' | 'gun' | 'ranged' | 'magic';
export type ArmourSlotId = 'helm' | 'chest' | 'gloves' | 'pants' | 'boots' | 'cloak';
export type AccessorySlotId = 'belt' | 'amulet' | 'ring' | 'trinket';
export type ArmourWeight = 'light' | 'medium' | 'heavy';
export type ItemKind = 'weapon' | 'armour' | 'accessory' | 'food';

/**
 * `armor`, `ring`, and `trinket` are retained as input aliases for old saves
 * and callers. New definitions use the canonical paper-doll positions.
 */
export type LootSlot = EquipmentSlotId | AccessorySlotId | 'armor';

export const WEAPON_SLOT_IDS: readonly WeaponSlotId[] = ['melee', 'gun', 'ranged', 'magic'];
export const ACTIVE_WEAPON_SLOT_IDS = WEAPON_SLOT_IDS;
export const ARMOUR_SLOT_IDS: readonly ArmourSlotId[] = ['helm', 'chest', 'gloves', 'pants', 'boots', 'cloak'];
export const ACCESSORY_SLOT_IDS: readonly AccessorySlotId[] = ['belt', 'amulet', 'ring', 'trinket'];

export type EquipmentSlotMap = { [slot in EquipmentSlotId]: string | null };

export interface EquipmentLoadout extends EquipmentSlotMap {
  activeWeaponSlot: WeaponSlotId | null;
}

export type ItemIconId = string;

export type IconRef =
  | { kind: 'asset'; id: string; src: string; alt: string }
  | { kind: 'atlas'; id: string; sheet: 'skill' | 'resource' | 'loadout'; key: string; alt: string };

export type CombatStat =
  | 'damage'
  | 'attackInterval'
  | 'accuracy'
  | 'maxHit'
  | 'range'
  | 'hp'
  | 'armour'
  | 'ward'
  | 'evasion'
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
  /** The normalized roll percentile shown by item inspection. */
  percentile: number;
  unit: '%' | 'flat' | 'seconds';
}

export interface ItemDefinition {
  id: string;
  /** Stable manifest key. Filenames are implementation details, not save data. */
  iconId: ItemIconId;
  name: string;
  slot: LootSlot;
  description: string;
  baseStats: Partial<Record<CombatStat, number>>;
  kind?: ItemKind;
  /** Weight applies to armour and cloaks, or to melee weapons where set. */
  weight?: ArmourWeight;
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
  /** Number of completed one-affix reforges. */
  rerolls?: number;
  /** Preserves the legacy +2 weapon damage per rank refinement system. */
  enhancementRank?: number;
}

export interface LootFilters {
  /** `common` (or null) means every normal drop passes by default. */
  globalMinimumRarity: RarityId | null;
  perSlotMinimumRarity: Partial<Record<EquipmentSlotId | AccessorySlotId, RarityId | null>>;
}

export interface LootCacheState {
  items: readonly ItemInstance[];
  equipment: EquipmentLoadout;
  /** Stack-backed consumables are deliberately separate from item instances. */
  foodId: string | null;
  favoriteIds: readonly string[];
  filters: LootFilters;
  capacity: 35;
  /** True when a migrated save still has more than the new capacity. */
  grandfatheredOverflow: boolean;
}

export interface LootCacheMutation {
  accepted: boolean;
  reason: string;
  item: ItemInstance | null;
  salvage: number;
  salvaged: boolean;
  cache: LootCacheState;
}

export interface ReforgeCost {
  salvage: number;
  bars: number;
  craftedComponents: number;
}

export interface ReforgeResources {
  salvage?: number;
  bars?: number;
  craftedComponents?: number;
  Salvage?: number;
  Bars?: number;
  'Crafted Components'?: number;
}

export interface ReforgeResult {
  accepted: boolean;
  reason: string;
  item: ItemInstance | null;
  cost: ReforgeCost;
  resources: ReforgeResources;
}

export interface EquippedStatsSnapshot {
  stats: Partial<Record<CombatStat, number>>;
  equippedItemIds: readonly string[];
  activeWeaponSlot: WeaponSlotId | null;
  armourPieces: readonly {
    id: string;
    armourClass: ArmourWeight;
    armour: number;
  }[];
  signatures: readonly {
    instanceId: string;
    signatureId: string;
    name: string;
    description: string;
  }[];
}

export interface LootTable {
  id: string;
  sourceType: 'arenaBoss' | 'partyBoss' | 'soloFrontier';
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
  itemLevel?: number;
  now?: number;
  /** Override the table chance for deterministic source-specific rules. */
  itemChance?: number;
  /** Force the rolled rarity to this tier or better. */
  minimumRarity?: RarityId;
  /** Stage-advertised item slots receive 60% of the slot-selection weight. */
  targetSlots?: readonly LootSlot[];
  /** Overrides the normal 60% target bucket, used by active contracts. */
  targetSlotWeight?: number;
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


export interface ItemVisualDescriptor {
  instanceId: string | null;
  definitionId: string | null;
  icon: IconRef;
  rarity: RarityDefinition | null;
  rarityColor: string;
  rarityGlow: RarityDefinition['glow'] | 'none';
  itemLevel: number | null;
  equipped: boolean;
  active: boolean;
  favorite: boolean;
  isNew: boolean;
}
