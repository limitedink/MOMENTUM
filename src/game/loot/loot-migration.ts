import { COMBAT_LOOT_DEFINITIONS, RARITY_DEFINITIONS } from './loot-definitions';
import {
  createEquipmentLoadout,
  createLootFilters,
  equippedItemIds,
  getItemDefinition,
  normalizeEquipmentSlot,
  countUnequippedItems
} from './loot-registry';
import type {
  AffixRoll,
  EquipmentLoadout,
  ItemInstance,
  LootFilters
} from './loot-types';

export const LOOT_SAVE_VERSION = 19 as const;
export const MOMENTUM_SAVE_VERSION = LOOT_SAVE_VERSION;
const MIGRATION_LOOT_CACHE_CAPACITY = 35 as const;

type JsonRecord = Record<string, unknown>;

export type MomentumSaveV19 = JsonRecord & {
  version: 19;
  equipment: EquipmentLoadout;
  lootCache: readonly ItemInstance[];
  lootFilters: LootFilters;
  lootFavorites: readonly string[];
  lootCapacity: 35;
  grandfatheredLootOverflow: boolean;
};

const isRecord = (value: unknown): value is JsonRecord => Boolean(value && typeof value === 'object' && !Array.isArray(value));

function numberOr(value: unknown, fallback: number): number {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function stringOr(value: unknown, fallback: string): string {
  return typeof value === 'string' && value.length > 0 ? value : fallback;
}

function normalizeAffix(value: unknown): AffixRoll | null {
  if (!isRecord(value) || typeof value.id !== 'string' || typeof value.name !== 'string' || typeof value.stat !== 'string') return null;
  return {
    id: value.id,
    name: value.name,
    stat: value.stat as AffixRoll['stat'],
    value: numberOr(value.value, 0),
    tier: Math.max(1, Math.min(5, Math.floor(numberOr(value.tier, 1)))),
    percentile: Math.max(0, Math.min(100, Math.round(numberOr(value.percentile, 0)))),
    unit: value.unit === '%' || value.unit === 'seconds' ? value.unit : 'flat'
  };
}

function normalizeItem(value: unknown, index: number): ItemInstance | null {
  if (!isRecord(value)) return null;
  const definitionId = stringOr(value.definitionId ?? value.itemId ?? (getItemDefinition(String(value.id || '')) ? value.id : ''), '');
  if (!definitionId) return null;
  const definition = getItemDefinition(definitionId);
  const itemLevel = Math.max(1, Math.min(30, Math.floor(numberOr(value.itemLevel, 1))));
  const affixes = Array.isArray(value.affixes)
    ? value.affixes.map(normalizeAffix).filter((affix): affix is AffixRoll => Boolean(affix))
    : [];
  return {
    instanceId: stringOr(value.instanceId ?? value.id, `legacy:${definitionId}:${index}`),
    definitionId,
    rarity: RARITY_DEFINITIONS.some(rarity => rarity.id === value.rarity) ? value.rarity as ItemInstance['rarity'] : 'common',
    itemLevel,
    affixes,
    signatureId: stringOr(value.signatureId, definition?.signatureId || ''),
    sourceId: stringOr(value.sourceId, 'legacy'),
    acquiredAt: numberOr(value.acquiredAt, 0),
    rerolls: Math.max(0, Math.floor(numberOr(value.rerolls, 0)))
  };
}

function rawLootItems(save: JsonRecord): unknown[] {
  const values: unknown[] = [];
  const cache = save.lootCache;
  if (Array.isArray(cache)) values.push(...cache);
  else if (isRecord(cache) && Array.isArray(cache.items)) values.push(...cache.items);
  if (Array.isArray(save.inventory)) values.push(...save.inventory);
  if (Array.isArray(save.lootInventory)) values.push(...save.lootInventory);
  if (Array.isArray(save.loot)) values.push(...save.loot);
  if (Array.isArray(save.ownedLoot)) values.push(...save.ownedLoot);
  return values;
}

function oldEquipment(save: JsonRecord): EquipmentLoadout {
  const source = isRecord(save.equipment)
    ? save.equipment
    : isRecord(save.equipmentSlots)
      ? save.equipmentSlots
      : isRecord(save.loadout)
        ? save.loadout
        : {};
  const loadout = createEquipmentLoadout();
  Object.entries(source).forEach(([rawSlot, value]) => {
    if (typeof value !== 'string') return;
    const slot = normalizeEquipmentSlot(rawSlot);
    if (!slot || slot === 'ring' || slot === 'trinket') return;
    loadout[slot] = value;
  });
  const requestedActive = normalizeEquipmentSlot(
    typeof save.activeWeaponSlot === 'string'
      ? save.activeWeaponSlot
      : typeof source.activeWeaponSlot === 'string'
        ? source.activeWeaponSlot
        : undefined
  );
  if (requestedActive === 'melee' || requestedActive === 'gun' || requestedActive === 'ranged' || requestedActive === 'magic') {
    loadout.activeWeaponSlot = requestedActive;
  } else if (loadout.melee) {
    loadout.activeWeaponSlot = 'melee';
  } else if (loadout.gun) {
    loadout.activeWeaponSlot = 'gun';
  } else if (loadout.ranged) {
    loadout.activeWeaponSlot = 'ranged';
  } else if (loadout.magic) {
    loadout.activeWeaponSlot = 'magic';
  }
  return loadout;
}

function oldFavoriteIds(save: JsonRecord): string[] {
  const value = save.lootFavorites ?? save.favoriteIds ?? save.favouriteIds ?? save.favorites;
  return Array.isArray(value) ? value.filter((id): id is string => typeof id === 'string') : [];
}

function oldFilters(save: JsonRecord): LootFilters {
  const value = isRecord(save.lootFilters) ? save.lootFilters : isRecord(save.filters) ? save.filters : {};
  const perSlot = isRecord(value.perSlotMinimumRarity) ? value.perSlotMinimumRarity : {};
  return createLootFilters({
    globalMinimumRarity: typeof value.globalMinimumRarity === 'string' ? value.globalMinimumRarity as LootFilters['globalMinimumRarity'] : 'common',
    perSlotMinimumRarity: Object.fromEntries(Object.entries(perSlot).map(([slot, rarity]) => {
      const canonical = normalizeEquipmentSlot(slot);
      return [canonical || slot, rarity];
    }))
  });
}

function collectLegacyOwnedItems(save: JsonRecord, existing: readonly ItemInstance[], equipment: EquipmentLoadout): ItemInstance[] {
  if (!Array.isArray(save.ownedItems)) return [];
  const occupied = new Set(equippedItemIds(equipment));
  const knownIds = new Set(existing.map(item => item.definitionId));
  return save.ownedItems
    .filter((id): id is string => typeof id === 'string' && Boolean(getItemDefinition(id)))
    .filter(id => !knownIds.has(id) && !occupied.has(id))
    .map((definitionId, index) => normalizeItem({ definitionId, instanceId: `legacy-owned:${definitionId}:${index}` }, existing.length + index))
    .filter((item): item is ItemInstance => Boolean(item));
}

/**
 * Migrate the loot/equipment portion of a v18 save. The migration is
 * intentionally non-destructive: migrated overflow remains in the cache and
 * capacity enforcement only applies to later insertions.
 */
export function migrateV18SaveToV19(value: unknown): MomentumSaveV19 {
  const save = isRecord(value) ? value : {};
  if (save.version === LOOT_SAVE_VERSION) return save as MomentumSaveV19;

  const equipment = oldEquipment(save);
  const normalized = rawLootItems(save)
    .map(normalizeItem)
    .filter((item): item is ItemInstance => Boolean(item));
  const items = [...normalized, ...collectLegacyOwnedItems(save, normalized, equipment)];
  const lootFavorites = oldFavoriteIds(save);
  const grandfatheredLootOverflow = countUnequippedItems(items, equippedItemIds(equipment)) > MIGRATION_LOOT_CACHE_CAPACITY;
  const { equipment: _oldEquipment, lootCache: _oldLootCache, lootFilters: _oldLootFilters, lootFavorites: _oldLootFavorites, ...preserved } = save;

  return {
    ...preserved,
    version: LOOT_SAVE_VERSION,
    equipment,
    lootCache: items,
    lootFilters: oldFilters(save),
    lootFavorites,
    lootCapacity: MIGRATION_LOOT_CACHE_CAPACITY,
    grandfatheredLootOverflow
  };
}

export const migrateV18ToV19 = migrateV18SaveToV19;
export const migrateLootSaveToV19 = migrateV18SaveToV19;
export const migrateV18Save = migrateV18SaveToV19;
