import {
  ARENA_LOOT_TABLES,
  COMBAT_LOOT_DEFINITIONS,
  ITEM_LEVEL_STAT_SCALING,
  PARTY_BOSS_LOOT_TABLE,
  RARITY_DEFINITIONS,
  SKILL_TOOL_DEFINITIONS,
  SOLO_FRONTIER_LOOT_TABLE
} from './loot-definitions';
import { ACCESSORY_SLOT_IDS, ARMOUR_SLOT_IDS, EQUIPMENT_SLOT_IDS } from './loot-types';
import type {
  AccessorySlotId,
  AffixDefinition,
  AffixRoll,
  ArmourSlotId,
  EquipmentLoadout,
  EquipmentSlotId,
  EquippedStatsSnapshot,
  ItemDefinition,
  ItemInstance,
  LootCacheMutation,
  LootCacheState,
  LootFilters,
  LootInspection,
  LootResolution,
  LootSourceContext,
  LootSlot,
  LootTable,
  RarityDefinition,
  ReforgeCost,
  ReforgeResources,
  ReforgeResult,
  SkillToolDefinition,
  WeaponSlotId
} from './loot-types';

export const UNEQUIPPED_CACHE_CAPACITY = 35 as const;
export const LOOT_CACHE_CAPACITY = UNEQUIPPED_CACHE_CAPACITY;

export const AFFIX_TIER_BANDS = Object.freeze([
  { tier: 1, minItemLevel: 1, maxItemLevel: 5 },
  { tier: 2, minItemLevel: 6, maxItemLevel: 11 },
  { tier: 3, minItemLevel: 12, maxItemLevel: 17 },
  { tier: 4, minItemLevel: 18, maxItemLevel: 23 },
  { tier: 5, minItemLevel: 24, maxItemLevel: 30 }
] as const);

export const DEFAULT_LOOT_FILTERS: LootFilters = Object.freeze({
  globalMinimumRarity: 'common',
  perSlotMinimumRarity: {}
});

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function finiteNumber(value: unknown, fallback = 0): number {
  const number = typeof value === 'number' || typeof value === 'string' ? Number(value) : Number.NaN;
  return Number.isFinite(number) ? number : fallback;
}

function randomUnit(random: () => number): number {
  return clamp(Number(random()) || 0, 0, 0.999999999);
}

function pickWeighted<T>(items: readonly T[], weights: readonly number[], random: () => number): T {
  const total = weights.reduce((sum, weight) => sum + Math.max(0, weight), 0);
  if (total <= 0) return items[0];
  let cursor = randomUnit(random) * total;
  for (let index = 0; index < items.length; index += 1) {
    cursor -= Math.max(0, weights[index] || 0);
    if (cursor <= 0) return items[index];
  }
  return items[items.length - 1];
}

function rarityById(id: string): RarityDefinition {
  return RARITY_DEFINITIONS.find(rarity => rarity.id === id) || RARITY_DEFINITIONS[0];
}

export function rarityIndex(id: string): number {
  const index = RARITY_DEFINITIONS.findIndex(rarity => rarity.id === id);
  return index >= 0 ? index : 0;
}

export function affixTierForItemLevel(itemLevel: number): number {
  const level = clamp(Math.floor(finiteNumber(itemLevel, 1)), 1, 30);
  return AFFIX_TIER_BANDS.find(band => level >= band.minItemLevel && level <= band.maxItemLevel)?.tier || 5;
}

/** Normalizes legacy `armor` and human-readable ring/trinket slot spellings. */
export function normalizeEquipmentSlot(value: string | null | undefined): EquipmentSlotId | AccessorySlotId | null {
  if (!value) return null;
  const compact = value.toLowerCase().replace(/[\s_-]/g, '');
  if (compact === 'armor') return 'chest';
  if (compact === 'ring1') return 'ring1';
  if (compact === 'ring2') return 'ring2';
  if (compact === 'trinket1') return 'trinket1';
  if (compact === 'trinket2') return 'trinket2';
  if (compact === 'ring') return 'ring';
  if (compact === 'trinket') return 'trinket';
  return (['melee', 'gun', 'ranged', 'magic', 'helm', 'chest', 'gloves', 'pants', 'boots', 'belt', 'cloak', 'amulet', 'food'] as const)
    .find(slot => slot === compact) || null;
}

function isWeaponSlot(slot: string | null | undefined): slot is WeaponSlotId {
  return slot === 'melee' || slot === 'gun' || slot === 'ranged' || slot === 'magic';
}

function definitionKind(definition: ItemDefinition): ItemDefinition['kind'] {
  if (definition.kind) return definition.kind;
  const slot = normalizeEquipmentSlot(definition.slot);
  if (isWeaponSlot(slot)) return 'weapon';
  if (ARMOUR_SLOT_IDS.includes(slot as ArmourSlotId)) return 'armour';
  if (ACCESSORY_SLOT_IDS.includes(definition.slot as AccessorySlotId)) return 'accessory';
  return 'food';
}

function isAccessoryDefinition(definition: ItemDefinition): boolean {
  return definitionKind(definition) === 'accessory'
    || definition.slot === 'belt'
    || definition.slot === 'amulet'
    || definition.slot === 'ring'
    || definition.slot === 'trinket';
}

function itemFitsSlot(definition: ItemDefinition, requestedSlot: string): boolean {
  const normalizedRequested = normalizeEquipmentSlot(requestedSlot);
  if (!normalizedRequested) return false;
  if (requestedSlot.toLowerCase().replace(/[\s_-]/g, '') === 'armor') {
    return normalizeEquipmentSlot(definition.slot) === 'chest';
  }
  const definitionSlot = normalizeEquipmentSlot(definition.slot);
  if (definitionSlot === normalizedRequested) return true;
  if (definition.slot === 'ring' && (normalizedRequested === 'ring1' || normalizedRequested === 'ring2')) return true;
  if (definition.slot === 'trinket' && (normalizedRequested === 'trinket1' || normalizedRequested === 'trinket2')) return true;
  return false;
}

function tableFor(tables: readonly LootTable[], context: LootSourceContext): LootTable {
  return tables.find(table => table.sourceType === context.sourceType && table.sourceId === context.sourceId)
    || tables.find(table => table.sourceType === context.sourceType)
    || (context.sourceType === 'partyBoss'
      ? PARTY_BOSS_LOOT_TABLE
      : context.sourceType === 'soloFrontier'
        ? SOLO_FRONTIER_LOOT_TABLE
        : ARENA_LOOT_TABLES[0]);
}

function rollRarity(table: LootTable, random: () => number, minimumRarity?: string): RarityDefinition {
  const minimumIndex = minimumRarity ? rarityIndex(minimumRarity) : 0;
  const ids = RARITY_DEFINITIONS.slice(minimumIndex).map(rarity => rarity.id);
  const weights = ids.map(id => table.rarityWeights[id] || 0);
  return rarityById(pickWeighted(ids, weights, random));
}

function pickLootDefinition(
  definitionIds: readonly string[],
  definitions: readonly ItemDefinition[],
  targetSlots: readonly LootSlot[] | undefined,
  random: () => number
): ItemDefinition {
  const candidates = definitionIds
    .map(id => definitions.find(item => item.id === id))
    .filter((item): item is ItemDefinition => Boolean(item));
  if (!candidates.length) return definitions[0];
  if (!targetSlots?.length) return candidates[Math.floor(randomUnit(random) * candidates.length)];

  const targetSet = new Set(targetSlots);
  const targeted = candidates.filter(item => targetSet.has(item.slot));
  const untargeted = candidates.filter(item => !targetSet.has(item.slot));
  if (!targeted.length || !untargeted.length) return candidates[Math.floor(randomUnit(random) * candidates.length)];
  // Advertised slots get 60% of the source's slot-selection weight. This is
  // intentionally a two-bucket roll so the result is independent of how many
  // bases happen to exist in either bucket.
  const bucket = randomUnit(random) < 0.60 ? targeted : untargeted;
  return bucket[Math.floor(randomUnit(random) * bucket.length)];
}

export function rollAffixes(
  definition: ItemDefinition,
  rarity: RarityDefinition,
  itemLevel: number,
  random: () => number = Math.random
): AffixRoll[] {
  const available = [...definition.affixPool];
  const rolls: AffixRoll[] = [];
  for (let index = 0; index < rarity.affixCount && available.length > 0; index += 1) {
    const affix = available.splice(Math.floor(randomUnit(random) * available.length), 1)[0];
    const percentile = Math.round(randomUnit(random) * 100);
    const value = affix.min + (affix.max - affix.min) * percentile / 100;
    rolls.push({
      id: affix.id,
      name: affix.name,
      stat: affix.stat,
      value: Number(value.toFixed(2)),
      tier: affixTierForItemLevel(itemLevel),
      percentile,
      unit: affix.unit || 'flat'
    });
  }
  return rolls;
}

export function calculateItemStats(definition: ItemDefinition, instance: ItemInstance): Partial<Record<string, number>> {
  const rarity = rarityById(instance.rarity);
  const itemLevelMultiplier = 1 + ITEM_LEVEL_STAT_SCALING.perLevel * Math.max(0, Math.min(30, instance.itemLevel) - 1);
  const scalesWithItemLevel = new Set<string>(ITEM_LEVEL_STAT_SCALING.scalableStats);
  const stats: Partial<Record<string, number>> = {};
  Object.entries(definition.baseStats).forEach(([stat, value]) => {
    const levelMultiplier = scalesWithItemLevel.has(stat) ? itemLevelMultiplier : 1;
    stats[stat] = Number(((value || 0) * rarity.statMultiplier * levelMultiplier).toFixed(2));
  });
  instance.affixes.forEach(affix => {
    const levelMultiplier = scalesWithItemLevel.has(affix.stat) ? itemLevelMultiplier : 1;
    stats[affix.stat] = Number(((stats[affix.stat] || 0) + affix.value * levelMultiplier).toFixed(2));
  });
  return stats;
}

export function rollLoot(
  context: LootSourceContext,
  random: () => number = Math.random,
  tables: readonly LootTable[] = [...ARENA_LOOT_TABLES, PARTY_BOSS_LOOT_TABLE],
  definitions: readonly ItemDefinition[] = COMBAT_LOOT_DEFINITIONS
): LootResolution {
  const table = tableFor(tables, context);
  const salvage = Math.round(table.salvageMin + (table.salvageMax - table.salvageMin) * randomUnit(random));
  const collectionTrackId = table.sourceId;
  const itemChance = clamp(finiteNumber(context.itemChance, table.itemChance), 0, 1);
  if (randomUnit(random) > itemChance || table.itemDefinitionIds.length === 0 || definitions.length === 0) {
    return { tableId: table.id, item: null, salvage, collectionTrackId, collectionProgress: table.collectionProgress, rarity: null };
  }

  const rarity = rollRarity(table, random, context.minimumRarity);
  const definition = pickLootDefinition(table.itemDefinitionIds, definitions, context.targetSlots, random);
  const itemLevel = clamp(Math.floor(finiteNumber(context.itemLevel, context.sourceTier * 10 + Math.floor(context.playerLevel / 5))), 1, 30);
  const now = context.now || Date.now();
  const instance: ItemInstance = {
    instanceId: `${context.sourceId}:${context.runId}:${now}:${Math.floor(randomUnit(random) * 1_000_000)}`,
    definitionId: definition.id,
    rarity: rarity.id,
    itemLevel,
    affixes: rollAffixes(definition, rarity, itemLevel, random),
    signatureId: definition.signatureId,
    sourceId: context.sourceId,
    acquiredAt: now,
    rerolls: 0
  };
  return { tableId: table.id, item: instance, salvage, collectionTrackId, collectionProgress: table.collectionProgress, rarity: rarity.id };
}

export function inspectItem(instance: ItemInstance, definitions: readonly ItemDefinition[] = COMBAT_LOOT_DEFINITIONS): LootInspection | null {
  const definition = definitions.find(item => item.id === instance.definitionId);
  if (!definition) return null;
  const rarity = rarityById(instance.rarity);
  const stats = calculateItemStats(definition, instance);
  return { definition, instance, stats, rarity, signature: `${definition.signatureName}: ${definition.signatureDescription}` };
}

export function validateEquipItem(
  instance: ItemInstance,
  slot?: string,
  definitions: readonly ItemDefinition[] = COMBAT_LOOT_DEFINITIONS
) {
  const inspection = inspectItem(instance, definitions);
  if (!inspection) return { accepted: false, reason: 'Unknown item definition.', item: null, inspection: null };
  if (slot && !itemFitsSlot(inspection.definition, slot)) {
    return { accepted: false, reason: `This item belongs in the ${inspection.definition.slot} slot.`, item: null, inspection };
  }
  if (definitionKind(inspection.definition) === 'food' && slot && normalizeEquipmentSlot(slot) !== 'food') {
    return { accepted: false, reason: 'Food can only be equipped in the Food slot.', item: null, inspection };
  }
  return { accepted: true, reason: '', item: instance, inspection };
}

type EquipmentLoadoutInput = Partial<EquipmentLoadout> & {
  slots?: Partial<Record<EquipmentSlotId, string | null>>;
};

export function createEquipmentLoadout(overrides: EquipmentLoadoutInput = {}): EquipmentLoadout {
  const loadout = Object.fromEntries([
    'melee', 'gun', 'ranged', 'magic', 'helm', 'chest', 'gloves', 'pants', 'boots', 'belt', 'cloak', 'amulet',
    'ring1', 'ring2', 'trinket1', 'trinket2', 'food'
  ].map(slot => [slot, null])) as unknown as EquipmentLoadout;
  const source = overrides.slots || overrides;
  EQUIPMENT_SLOT_IDS.forEach(slot => {
    const value = source[slot];
    if (typeof value === 'string' || value === null) loadout[slot] = value;
  });
  loadout.activeWeaponSlot = isWeaponSlot(overrides.activeWeaponSlot) ? overrides.activeWeaponSlot : null;
  return loadout;
}

export function equippedItemIds(loadout: EquipmentLoadout): string[] {
  return [...new Set(EQUIPMENT_SLOT_IDS
    .map(slot => loadout[slot])
    .filter((id): id is string => typeof id === 'string') )];
}

export function equipItem(
  loadout: EquipmentLoadout,
  instance: ItemInstance,
  requestedSlot?: string,
  definitions: readonly ItemDefinition[] = COMBAT_LOOT_DEFINITIONS
) {
  const inspection = inspectItem(instance, definitions);
  if (!inspection) return { accepted: false, reason: 'Unknown item definition.', loadout, slot: null, replacedItemId: null, inspection: null };
  const definitionSlot = normalizeEquipmentSlot(inspection.definition.slot);
  let slot = normalizeEquipmentSlot(requestedSlot) || definitionSlot;
  if (inspection.definition.slot === 'ring' && (!slot || (slot !== 'ring1' && slot !== 'ring2'))) {
    slot = loadout.ring1 ? 'ring2' : 'ring1';
  }
  if (inspection.definition.slot === 'trinket' && (!slot || (slot !== 'trinket1' && slot !== 'trinket2'))) {
    slot = loadout.trinket1 ? 'trinket2' : 'trinket1';
  }
  if (!slot || slot === 'ring' || slot === 'trinket' || !itemFitsSlot(inspection.definition, slot)) {
    return { accepted: false, reason: `This item cannot be equipped in the ${requestedSlot || inspection.definition.slot} slot.`, loadout, slot: null, replacedItemId: null, inspection };
  }
  const next = createEquipmentLoadout(loadout);
  const replacedItemId = next[slot as EquipmentSlotId];
  EQUIPMENT_SLOT_IDS.forEach(candidate => {
    if (next[candidate] === instance.instanceId) next[candidate] = null;
  });
  next[slot as EquipmentSlotId] = instance.instanceId;
  if (isWeaponSlot(slot) && next.activeWeaponSlot === null) next.activeWeaponSlot = slot;
  return { accepted: true, reason: '', loadout: next, slot, replacedItemId, inspection };
}

export function unequipItem(loadout: EquipmentLoadout, slot: EquipmentSlotId): EquipmentLoadout {
  const next = createEquipmentLoadout(loadout);
  next[slot] = null;
  if (isWeaponSlot(slot) && next.activeWeaponSlot === slot) next.activeWeaponSlot = null;
  return next;
}

export function setActiveWeaponSlot(loadout: EquipmentLoadout, slot: WeaponSlotId | null): EquipmentLoadout {
  const next = createEquipmentLoadout(loadout);
  next.activeWeaponSlot = slot;
  return next;
}

export function getEquippedItems(loadout: EquipmentLoadout, items: readonly ItemInstance[]): ItemInstance[] {
  const ids = new Set(equippedItemIds(loadout));
  return items.filter(item => ids.has(item.instanceId));
}

/**
 * Computes combat contributions from the paper doll. Weapon slots are all
 * retained in the loadout, but only the explicitly active weapon contributes.
 */
export function calculateEquippedStats(
  loadout: EquipmentLoadout,
  items: readonly ItemInstance[],
  definitions: readonly ItemDefinition[] = COMBAT_LOOT_DEFINITIONS
): EquippedStatsSnapshot {
  const stats: Partial<Record<string, number>> = {};
  const signatures: EquippedStatsSnapshot['signatures'][number][] = [];
  const armourPieces: EquippedStatsSnapshot['armourPieces'][number][] = [];
  const included = new Set<string>();
  const allEquippedIds = equippedItemIds(loadout);
  const activeWeaponSlot = isWeaponSlot(loadout.activeWeaponSlot) ? loadout.activeWeaponSlot : null;
  EQUIPMENT_SLOT_IDS.forEach(slot => {
    const instanceId = loadout[slot];
    if (!instanceId || included.has(instanceId)) return;
    const instance = items.find(candidate => candidate.instanceId === instanceId);
    const inspection = instance ? inspectItem(instance, definitions) : null;
    if (!inspection) return;
    const kind = definitionKind(inspection.definition);
    if (kind === 'weapon' && slot !== activeWeaponSlot) return;
    if (kind === 'food') return;
    included.add(instanceId);
    Object.entries(inspection.stats).forEach(([stat, value]) => {
      stats[stat] = Number(((stats[stat] || 0) + (value || 0)).toFixed(2));
    });
    if (kind === 'armour') {
      armourPieces.push({
        id: instanceId,
        armourClass: inspection.definition.weight || 'medium',
        armour: Number((inspection.stats.armour || 0).toFixed(2))
      });
    }
    signatures.push({
      instanceId,
      signatureId: inspection.definition.signatureId,
      name: inspection.definition.signatureName,
      description: inspection.definition.signatureDescription
    });
  });
  return {
    stats: stats as EquippedStatsSnapshot['stats'],
    equippedItemIds: allEquippedIds,
    activeWeaponSlot,
    armourPieces,
    signatures
  };
}

export function calculateEquipmentStats(
  loadout: EquipmentLoadout,
  items: readonly ItemInstance[],
  definitions: readonly ItemDefinition[] = COMBAT_LOOT_DEFINITIONS
): EquippedStatsSnapshot['stats'] {
  return calculateEquippedStats(loadout, items, definitions).stats;
}

export const calculatePaperDollStats = calculateEquippedStats;

export function updateCollectionProgress(
  current: Readonly<Record<string, number>>,
  resolution: Pick<LootResolution, 'collectionTrackId' | 'collectionProgress'>
): Record<string, number> {
  const next = { ...current };
  if (resolution.collectionTrackId && resolution.collectionProgress > 0) {
    next[resolution.collectionTrackId] = (next[resolution.collectionTrackId] || 0) + resolution.collectionProgress;
  }
  return next;
}

function salvageValue(instance: ItemInstance, definitions: readonly ItemDefinition[]): number {
  const inspection = inspectItem(instance, definitions);
  return Math.max(1, Math.round(4 * (inspection?.rarity.statMultiplier || 1)));
}

export function salvageItem(
  inventory: readonly ItemInstance[],
  instanceId: string,
  equippedIds: readonly string[],
  definitions: readonly ItemDefinition[] = COMBAT_LOOT_DEFINITIONS,
  favoriteIds: readonly string[] = []
) {
  const item = inventory.find(instance => instance.instanceId === instanceId);
  if (!item || equippedIds.includes(instanceId) || favoriteIds.includes(instanceId)) {
    const reason = !item
      ? 'Unknown item.'
      : equippedIds.includes(instanceId)
        ? 'Equipped items cannot be salvaged.'
        : 'Favourited items cannot be salvaged.';
    return { accepted: false, reason, item: null, value: 0 };
  }
  const inspection = inspectItem(item, definitions);
  if (!inspection) return { accepted: false, reason: 'Unknown item definition.', item: null, value: 0 };
  return { accepted: true, reason: '', item, value: salvageValue(item, definitions) };
}

function cloneFilters(value: Partial<LootFilters> | null | undefined): LootFilters {
  const perSlot = value?.perSlotMinimumRarity && typeof value.perSlotMinimumRarity === 'object'
    ? { ...value.perSlotMinimumRarity }
    : {};
  return {
    globalMinimumRarity: value?.globalMinimumRarity === undefined ? DEFAULT_LOOT_FILTERS.globalMinimumRarity : value.globalMinimumRarity,
    perSlotMinimumRarity: perSlot
  };
}

export function createLootFilters(value: Partial<LootFilters> = {}): LootFilters {
  return cloneFilters(value);
}

export function effectiveMinimumRarity(
  definition: ItemDefinition,
  filters: LootFilters
): RarityDefinition {
  const globalIndex = filters.globalMinimumRarity === null ? 0 : rarityIndex(filters.globalMinimumRarity);
  const candidateSlots: (EquipmentSlotId | AccessorySlotId)[] = [];
  const definitionSlot = normalizeEquipmentSlot(definition.slot);
  if (definitionSlot) candidateSlots.push(definitionSlot);
  if (definition.slot === 'ring') candidateSlots.push('ring1', 'ring2');
  if (definition.slot === 'trinket') candidateSlots.push('trinket1', 'trinket2');
  const slotIndexes = candidateSlots
    .map(slot => filters.perSlotMinimumRarity[slot])
    .filter(rarity => typeof rarity === 'string')
    .map(rarity => rarityIndex(rarity as string));
  // Global is a floor; a per-slot rule can only make a drop stricter.
  const minimum = Math.max(globalIndex, ...slotIndexes);
  return RARITY_DEFINITIONS[minimum] || RARITY_DEFINITIONS[0];
}

export function passesLootFilters(
  instance: ItemInstance,
  filters: LootFilters,
  definitions: readonly ItemDefinition[] = COMBAT_LOOT_DEFINITIONS
): boolean {
  const definition = definitions.find(item => item.id === instance.definitionId);
  if (!definition) return false;
  return rarityIndex(instance.rarity) >= rarityIndex(effectiveMinimumRarity(definition, filters).id);
}

function normalizeCache(cache: LootCacheState): LootCacheState {
  const equipment = createEquipmentLoadout(cache.equipment || {});
  const items = [...(cache.items || [])];
  const favoriteIds = [...new Set(cache.favoriteIds || [])];
  const grandfatheredOverflow = countUnequippedItems(items, equippedItemIds(equipment)) > UNEQUIPPED_CACHE_CAPACITY;
  return {
    items,
    equipment,
    favoriteIds,
    filters: cloneFilters(cache.filters),
    capacity: UNEQUIPPED_CACHE_CAPACITY,
    grandfatheredOverflow
  };
}

export interface LootCacheOptions {
  items?: readonly ItemInstance[];
  equipment?: EquipmentLoadout;
  favoriteIds?: readonly string[];
  filters?: Partial<LootFilters>;
}

export function createLootCache(options: LootCacheOptions = {}): LootCacheState {
  const equipment = createEquipmentLoadout(options.equipment || {});
  const items = [...(options.items || [])];
  const cache: LootCacheState = {
    items,
    equipment,
    favoriteIds: [...new Set(options.favoriteIds || [])],
    filters: cloneFilters(options.filters),
    capacity: UNEQUIPPED_CACHE_CAPACITY,
    grandfatheredOverflow: countUnequippedItems(items, equippedItemIds(equipment)) > UNEQUIPPED_CACHE_CAPACITY
  };
  return cache;
}

export function countUnequippedItems(cache: LootCacheState): number;
export function countUnequippedItems(items: readonly ItemInstance[], equippedIds?: readonly string[]): number;
export function countUnequippedItems(
  cacheOrItems: LootCacheState | readonly ItemInstance[],
  equippedIds: readonly string[] = []
): number {
  const items = Array.isArray(cacheOrItems) ? cacheOrItems as readonly ItemInstance[] : (cacheOrItems as LootCacheState).items;
  const ids = Array.isArray(cacheOrItems)
    ? new Set(equippedIds)
    : new Set(equippedItemIds((cacheOrItems as LootCacheState).equipment));
  return items.filter(item => !ids.has(item.instanceId)).length;
}

export interface LootInsertionOptions {
  equipment?: EquipmentLoadout;
  filters?: LootFilters;
  favoriteIds?: readonly string[];
  favouritedIds?: readonly string[];
  definitions?: readonly ItemDefinition[];
}

export function insertLoot(
  sourceCache: LootCacheState,
  incoming: ItemInstance,
  options: LootInsertionOptions = {}
): LootCacheMutation {
  const cache = normalizeCache({
    ...sourceCache,
    equipment: options.equipment || sourceCache.equipment,
    filters: options.filters || sourceCache.filters,
    favoriteIds: options.favoriteIds || options.favouritedIds || sourceCache.favoriteIds
  });
  const definitions = options.definitions || COMBAT_LOOT_DEFINITIONS;
  if (!passesLootFilters(incoming, cache.filters, definitions)) {
    return {
      accepted: false,
      reason: 'Drop rejected by loot filters; the item was salvaged.',
      item: null,
      salvage: salvageValue(incoming, definitions),
      salvaged: true,
      cache
    };
  }
  if (cache.items.some(item => item.instanceId === incoming.instanceId)) {
    return { accepted: false, reason: 'This loot instance is already in the cache.', item: null, salvage: 0, salvaged: false, cache };
  }
  if (countUnequippedItems(cache) >= cache.capacity) {
    const value = salvageValue(incoming, definitions);
    return {
      accepted: false,
      reason: 'Unequipped loot cache is full; the incoming item was salvaged.',
      item: null,
      salvage: value,
      salvaged: true,
      cache
    };
  }
  const next = { ...cache, items: [...cache.items, incoming] };
  return { accepted: true, reason: '', item: incoming, salvage: 0, salvaged: false, cache: next };
}

export const addLootToCache = insertLoot;
export const applyLootDrop = insertLoot;
export const insertLootItem = insertLoot;
export const getUnequippedCacheCount = countUnequippedItems;

export function setLootFavorite(cache: LootCacheState, instanceId: string, favorite = true): LootCacheState {
  const current = new Set(cache.favoriteIds);
  if (favorite) current.add(instanceId);
  else current.delete(instanceId);
  return normalizeCache({ ...cache, favoriteIds: [...current] });
}

export const setLootFavourite = setLootFavorite;

export function setLootFilters(cache: LootCacheState, filters: Partial<LootFilters>): LootCacheState {
  return normalizeCache({ ...cache, filters: cloneFilters({ ...cache.filters, ...filters }) });
}

export function salvageCachedItem(cache: LootCacheState, instanceId: string, definitions: readonly ItemDefinition[] = COMBAT_LOOT_DEFINITIONS) {
  const result = salvageItem(cache.items, instanceId, equippedItemIds(cache.equipment), definitions, cache.favoriteIds);
  if (!result.accepted || !result.item) return { ...result, cache };
  return {
    ...result,
    cache: normalizeCache({
      ...cache,
      items: cache.items.filter(item => item.instanceId !== instanceId),
      favoriteIds: cache.favoriteIds.filter(id => id !== instanceId)
    })
  };
}

export const salvageLootItem = salvageCachedItem;

function resourceAmount(resources: ReforgeResources, lower: keyof ReforgeResources, upper: keyof ReforgeResources): number {
  return Math.max(0, finiteNumber(resources[lower] ?? resources[upper], 0));
}

function resourceLedger(resources: ReforgeResources, cost: ReforgeCost): ReforgeResources {
  const hasTitleCase = resources.Salvage !== undefined || resources.Bars !== undefined || resources['Crafted Components'] !== undefined;
  const salvage = resourceAmount(resources, 'salvage', 'Salvage') - cost.salvage;
  const bars = resourceAmount(resources, 'bars', 'Bars') - cost.bars;
  const craftedComponents = resourceAmount(resources, 'craftedComponents', 'Crafted Components') - cost.craftedComponents;
  return hasTitleCase
    ? { Salvage: salvage, Bars: bars, 'Crafted Components': craftedComponents }
    : { salvage, bars, craftedComponents };
}

export function calculateReforgeCost(
  instance: ItemInstance,
  definitions: readonly ItemDefinition[] = COMBAT_LOOT_DEFINITIONS
): ReforgeCost {
  const definition = definitions.find(item => item.id === instance.definitionId);
  const priorRerolls = Math.max(0, Math.floor(finiteNumber(instance.rerolls, 0)));
  return {
    salvage: 10 + 5 * rarityIndex(instance.rarity) + 5 * priorRerolls,
    bars: definition && (definitionKind(definition) === 'weapon' || definitionKind(definition) === 'armour') ? 2 : 0,
    craftedComponents: definition && isAccessoryDefinition(definition) ? 1 : 0
  };
}

export function reforgeOneAffix(
  instance: ItemInstance,
  affixId: string,
  random: () => number = Math.random,
  definitions: readonly ItemDefinition[] = COMBAT_LOOT_DEFINITIONS
): { accepted: boolean; reason: string; item: ItemInstance | null } {
  const definition = definitions.find(item => item.id === instance.definitionId);
  const targetIndex = instance.affixes.findIndex(affix => affix.id === affixId);
  if (!definition) return { accepted: false, reason: 'Unknown item definition.', item: null };
  if (targetIndex < 0) return { accepted: false, reason: 'The selected affix is not present on this item.', item: null };
  if (new Set(instance.affixes.map(affix => affix.id)).size !== instance.affixes.length) {
    return { accepted: false, reason: 'Items cannot be reforged while they contain duplicate affix IDs.', item: null };
  }
  const usedIds = new Set(instance.affixes.filter((_, index) => index !== targetIndex).map(affix => affix.id));
  const available = definition.affixPool.filter(affix => !usedIds.has(affix.id));
  if (available.length === 0) return { accepted: false, reason: 'No unique affix is available for this reforge.', item: null };
  const replacement = available[Math.floor(randomUnit(random) * available.length)];
  const percentile = Math.round(randomUnit(random) * 100);
  const value = replacement.min + (replacement.max - replacement.min) * percentile / 100;
  const affix: AffixRoll = {
    id: replacement.id,
    name: replacement.name,
    stat: replacement.stat,
    value: Number(value.toFixed(2)),
    tier: affixTierForItemLevel(instance.itemLevel),
    percentile,
    unit: replacement.unit || 'flat'
  };
  const affixes = [...instance.affixes];
  affixes[targetIndex] = affix;
  return {
    accepted: true,
    reason: '',
    item: { ...instance, affixes, rerolls: Math.max(0, Math.floor(finiteNumber(instance.rerolls, 0))) + 1 }
  };
}

export function reforgeAffix(
  instance: ItemInstance,
  affixId: string,
  random: () => number = Math.random,
  definitions: readonly ItemDefinition[] = COMBAT_LOOT_DEFINITIONS
) {
  return reforgeOneAffix(instance, affixId, random, definitions);
}

export function reforgeItem(
  instance: ItemInstance,
  affixId: string,
  resources: ReforgeResources,
  random: () => number = Math.random,
  definitions: readonly ItemDefinition[] = COMBAT_LOOT_DEFINITIONS
): ReforgeResult {
  const cost = calculateReforgeCost(instance, definitions);
  const available = {
    salvage: resourceAmount(resources, 'salvage', 'Salvage'),
    bars: resourceAmount(resources, 'bars', 'Bars'),
    craftedComponents: resourceAmount(resources, 'craftedComponents', 'Crafted Components')
  };
  if (available.salvage < cost.salvage || available.bars < cost.bars || available.craftedComponents < cost.craftedComponents) {
    return { accepted: false, reason: 'Insufficient Salvage or crafting materials.', item: null, cost, resources };
  }
  const rerolled = reforgeOneAffix(instance, affixId, random, definitions);
  if (!rerolled.accepted || !rerolled.item) return { accepted: false, reason: rerolled.reason, item: null, cost, resources };
  return { accepted: true, reason: '', item: rerolled.item, cost, resources: resourceLedger(resources, cost) };
}

export const reforgeLootItem = reforgeItem;
export const getRarityIndex = rarityIndex;
export const isLootAllowedByFilters = passesLootFilters;
export const calculateCombatEquipmentStats = calculateEquippedStats;

export function getRarity(id: string): RarityDefinition { return rarityById(id); }
export function getItemDefinition(id: string, definitions: readonly ItemDefinition[] = COMBAT_LOOT_DEFINITIONS): ItemDefinition | undefined {
  return definitions.find(item => item.id === id);
}
export function getSkillToolDefinition(id: string): SkillToolDefinition | undefined { return SKILL_TOOL_DEFINITIONS.find(tool => tool.id === id); }
export function listSkillTools(skillId: string): SkillToolDefinition[] { return SKILL_TOOL_DEFINITIONS.filter(tool => tool.skillId === skillId); }

export const lootTables = Object.freeze([...ARENA_LOOT_TABLES, PARTY_BOSS_LOOT_TABLE, SOLO_FRONTIER_LOOT_TABLE]);
export const lootDefinitions = Object.freeze([...COMBAT_LOOT_DEFINITIONS]);
export const rarityDefinitions = Object.freeze([...RARITY_DEFINITIONS]);
export const skillToolDefinitions = Object.freeze([...SKILL_TOOL_DEFINITIONS]);
