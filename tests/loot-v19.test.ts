import { describe, expect, it } from 'vitest';
import {
  AFFIX_TIER_BANDS,
  COMBAT_LOOT_DEFINITIONS,
  RARITY_DEFINITIONS,
  affixTierForItemLevel,
  calculateEquippedStats,
  calculateReforgeCost,
  countUnequippedItems,
  createEquipmentLoadout,
  createLootCache,
  createLootFilters,
  equipItem,
  getItemDefinition,
  insertLoot,
  migrateV18SaveToV19,
  reforgeItem,
  rollAffixes,
  salvageCachedItem,
  setLootFavorite,
  setLootFilters
} from '../src/game/loot';
import type { AffixRoll, ItemInstance } from '../src/game/loot';

function item(definitionId: string, instanceId = definitionId, overrides: Partial<ItemInstance> = {}): ItemInstance {
  const definition = getItemDefinition(definitionId)!;
  return {
    instanceId,
    definitionId,
    rarity: 'common',
    itemLevel: 10,
    affixes: [],
    signatureId: definition.signatureId,
    sourceId: 'test',
    acquiredAt: 1,
    rerolls: 0,
    ...overrides
  };
}

function equip(loadout: ReturnType<typeof createEquipmentLoadout>, instance: ItemInstance, slot?: string) {
  const result = equipItem(loadout, instance, slot);
  expect(result.accepted).toBe(true);
  return result.loadout;
}

describe('v19 ARPG paper doll and loot rules', () => {
  it('authors the requested data-driven base matrix while preserving old IDs', () => {
    expect(COMBAT_LOOT_DEFINITIONS).toHaveLength(40);
    expect(new Set(COMBAT_LOOT_DEFINITIONS.map(definition => definition.id)).size).toBe(40);
    expect(COMBAT_LOOT_DEFINITIONS.filter(definition => definition.slot === 'melee')).toHaveLength(3);
    expect(COMBAT_LOOT_DEFINITIONS.filter(definition => definition.slot === 'gun')).toHaveLength(3);
    expect(COMBAT_LOOT_DEFINITIONS.filter(definition => definition.slot === 'ranged')).toHaveLength(3);
    expect(COMBAT_LOOT_DEFINITIONS.filter(definition => definition.slot === 'magic')).toHaveLength(3);
    for (const slot of ['helm', 'chest', 'gloves', 'pants', 'boots', 'cloak']) {
      expect(COMBAT_LOOT_DEFINITIONS.filter(definition => definition.slot === slot)).toHaveLength(3);
      expect(new Set(COMBAT_LOOT_DEFINITIONS.filter(definition => definition.slot === slot).map(definition => definition.weight))).toEqual(new Set(['light', 'medium', 'heavy']));
    }
    expect(COMBAT_LOOT_DEFINITIONS.filter(definition => definition.slot === 'belt')).toHaveLength(2);
    expect(COMBAT_LOOT_DEFINITIONS.filter(definition => definition.slot === 'amulet')).toHaveLength(2);
    expect(COMBAT_LOOT_DEFINITIONS.filter(definition => definition.slot === 'ring')).toHaveLength(3);
    expect(COMBAT_LOOT_DEFINITIONS.filter(definition => definition.slot === 'trinket')).toHaveLength(3);
    expect(getItemDefinition('initiates-edge')).toBeTruthy();
    expect(getItemDefinition('apex-aegis')?.slot).toBe('chest');
  });

  it('keeps dual rings and trinkets equipped and excludes inactive weapons from combat', () => {
    let loadout = createEquipmentLoadout({ activeWeaponSlot: 'melee' });
    const melee = item('initiates-edge', 'melee-instance');
    const gun = item('vanguard-repeater', 'gun-instance');
    const chest = item('frontier-mail', 'chest-instance');
    const ring1 = item('frontier-ring', 'ring-1');
    const ring2 = item('ring-of-momentum', 'ring-2');
    const trinket1 = item('glass-compass', 'trinket-1');
    const trinket2 = item('frontier-talisman', 'trinket-2');
    for (const [instance, slot] of [[melee, 'melee'], [gun, 'gun'], [chest, 'chest'], [ring1, 'ring1'], [ring2, 'ring2'], [trinket1, 'trinket1'], [trinket2, 'trinket2']] as const) {
      loadout = equip(loadout, instance, slot);
    }

    const snapshot = calculateEquippedStats(loadout, [melee, gun, chest, ring1, ring2, trinket1, trinket2]);
    expect(snapshot.stats.damage).toBeCloseTo(16 * 1.135 + 2 * 1.135, 6);
    expect(snapshot.signatures.map(signature => signature.signatureId)).not.toContain('overwatch');
    expect(snapshot.signatures).toHaveLength(6);
    expect(loadout.ring1).toBe('ring-1');
    expect(loadout.ring2).toBe('ring-2');
    expect(loadout.trinket1).toBe('trinket-1');
    expect(loadout.trinket2).toBe('trinket-2');

    const gunActive = calculateEquippedStats({ ...loadout, activeWeaponSlot: 'gun' }, [melee, gun, chest, ring1, ring2, trinket1, trinket2]);
    expect(gunActive.stats.damage).toBeCloseTo(12 * 1.135 + 2 * 1.135, 6);
    expect(gunActive.signatures.map(signature => signature.signatureId)).toContain('overwatch');
    expect(gunActive.signatures.map(signature => signature.signatureId)).not.toContain('shockbreaker');
  });

  it('uses item-level bands and persists a displayable percentile on every roll', () => {
    expect(AFFIX_TIER_BANDS.map(band => [band.minItemLevel, band.maxItemLevel])).toEqual([[1, 5], [6, 11], [12, 17], [18, 23], [24, 30]]);
    expect([1, 5, 6, 11, 12, 17, 18, 23, 24, 30].map(affixTierForItemLevel)).toEqual([1, 1, 2, 2, 3, 3, 4, 4, 5, 5]);
    const rolls = rollAffixes(COMBAT_LOOT_DEFINITIONS[0], RARITY_DEFINITIONS[3], 12, () => 0.5);
    expect(rolls).toHaveLength(3);
    expect(rolls.every(roll => roll.tier === 3 && roll.percentile === 50)).toBe(true);
    expect(new Set(rolls.map(roll => roll.id)).size).toBe(rolls.length);
  });

  it('enforces 34/35/36 unequipped capacity without replacing protected items', () => {
    const makeItems = (count: number) => Array.from({ length: count }, (_, index) => item('initiates-edge', `cache-${index}`));
    const at34 = createLootCache({ items: makeItems(34) });
    const inserted = insertLoot(at34, item('vanguard-repeater', 'cache-34'));
    expect(inserted.accepted).toBe(true);
    expect(countUnequippedItems(inserted.cache)).toBe(35);

    const full = insertLoot(inserted.cache, item('frontier-warhammer', 'cache-35'));
    expect(full.accepted).toBe(false);
    expect(full.salvaged).toBe(true);
    expect(full.salvage).toBeGreaterThan(0);
    expect(full.cache.items).toHaveLength(35);

    const grandfathered = createLootCache({ items: makeItems(36) });
    expect(countUnequippedItems(grandfathered)).toBe(36);
    expect(grandfathered.grandfatheredOverflow).toBe(true);
    expect(insertLoot(grandfathered, item('frontier-warhammer', 'cache-36')).accepted).toBe(false);

    const favoriteFull = setLootFavorite(inserted.cache, 'cache-0');
    const favoriteDrop = insertLoot(favoriteFull, item('frontier-warhammer', 'favorite-protection'));
    expect(favoriteDrop.cache.items.some(candidate => candidate.instanceId === 'cache-0')).toBe(true);
    expect(salvageCachedItem(favoriteFull, 'cache-0').accepted).toBe(false);
  });

  it('keeps equipped items outside the 35-slot cache contract, including QA-style filling', () => {
    const equipped = item('initiates-edge', 'equipped-weapon');
    const loadout = equip(createEquipmentLoadout({ activeWeaponSlot: 'melee' }), equipped, 'melee');
    const cacheAt = (unequippedCount: number) => createLootCache({
      items: [equipped, ...Array.from({ length: unequippedCount }, (_, index) => item('initiates-edge', `unequipped-${unequippedCount}-${index}`))],
      equipment: loadout
    });

    const at34 = cacheAt(34);
    expect(countUnequippedItems(at34)).toBe(34);
    const full = insertLoot(at34, item('vanguard-repeater', 'equipped-contract-35'));
    expect(full.accepted).toBe(true);
    expect(countUnequippedItems(full.cache)).toBe(35);
    expect(insertLoot(full.cache, item('frontier-warhammer', 'equipped-contract-36')).accepted).toBe(false);

    const grandfathered = cacheAt(36);
    expect(countUnequippedItems(grandfathered)).toBe(36);
    expect(grandfathered.grandfatheredOverflow).toBe(true);

    let cache = cacheAt(33);
    expect(countUnequippedItems(cache)).toBe(33);

    for (let index = 33; countUnequippedItems(cache) < 35; index += 1) {
      cache = insertLoot(cache, item('vanguard-repeater', `qa-fill-${index}`)).cache;
    }
    expect(countUnequippedItems(cache)).toBe(35);
    expect(cache.items).toHaveLength(36);
    expect(cache.grandfatheredOverflow).toBe(false);
    expect(insertLoot(cache, item('frontier-warhammer', 'qa-overflow')).accepted).toBe(false);
  });

  it('applies global and per-slot minimums before insertion, with global as the floor', () => {
    const rareRing = item('frontier-ring', 'rare-ring', { rarity: 'rare' });
    const rareChest = item('frontier-mail', 'rare-chest', { rarity: 'rare' });
    const commonRing = item('frontier-ring', 'common-ring');
    const filters = createLootFilters({ globalMinimumRarity: 'rare', perSlotMinimumRarity: { ring1: 'legendary' } });
    const cache = createLootCache({ filters, items: [commonRing] });
    expect(insertLoot(cache, rareRing).accepted).toBe(false);
    expect(insertLoot(cache, rareChest).accepted).toBe(true);

    const changed = setLootFilters(cache, { globalMinimumRarity: 'legendary' });
    expect(changed.items).toContain(commonRing);
    expect(insertLoot(changed, rareChest).accepted).toBe(false);
  });

  it('migrates v18 equipment and overflow to v19 idempotently without deleting old loot', () => {
    const overflow = Array.from({ length: 36 }, (_, index) => item('initiates-edge', `legacy-${index}`));
    const v18 = {
      version: 18,
      equipment: { melee: 'initiates-edge', gun: 'vanguard-repeater', armor: 'apex-aegis' },
      lootCache: overflow,
      lootFilters: { globalMinimumRarity: 'common', perSlotMinimumRarity: {} },
      other: { kept: true }
    };
    const migrated = migrateV18SaveToV19(v18);
    expect(migrated.version).toBe(19);
    expect(migrated.equipment.chest).toBe('apex-aegis');
    expect((migrated.equipment as unknown as Record<string, unknown>).armor).toBeUndefined();
    expect(migrated.equipment.activeWeaponSlot).toBe('melee');
    expect(migrated.lootCache).toHaveLength(36);
    expect(migrated.grandfatheredLootOverflow).toBe(true);
    expect(migrated.other).toEqual({ kept: true });
    expect(migrateV18SaveToV19(migrated)).toBe(migrated);
  });

  it('charges deterministic one-affix reforges, keeps signatures separate, and avoids duplicates', () => {
    const definition = getItemDefinition('vanguard-repeater')!;
    const affixes: AffixRoll[] = [
      { id: 'keen-edge', name: 'Keen Edge', stat: 'damage', value: 4, tier: 3, percentile: 100, unit: 'flat' },
      { id: 'true-sight', name: 'True Sight', stat: 'accuracy', value: 1, tier: 3, percentile: 0, unit: 'flat' }
    ];
    const original = item('vanguard-repeater', 'reforge-item', { rarity: 'rare', itemLevel: 12, affixes, signatureId: definition.signatureId, rerolls: 0 });
    const result = reforgeItem(original, 'keen-edge', { salvage: 20, bars: 2 }, () => 0);
    expect(result.accepted).toBe(true);
    expect(result.cost).toEqual({ salvage: 20, bars: 2, craftedComponents: 0 });
    expect(result.resources).toEqual({ salvage: 0, bars: 0, craftedComponents: 0 });
    expect(result.item?.signatureId).toBe(original.signatureId);
    expect(result.item?.rerolls).toBe(1);
    expect(new Set(result.item!.affixes.map(affix => affix.id)).size).toBe(result.item!.affixes.length);
    expect(calculateReforgeCost(result.item!)).toEqual({ salvage: 25, bars: 2, craftedComponents: 0 });
  });
});
