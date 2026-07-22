import { describe, expect, it } from 'vitest';
import {
  calculateItemStats,
  countUnequippedItems,
  getItemDefinition,
  type ItemInstance
} from '../src/game/loot';
import { migrateV20SaveToV21 } from '../src/game/solo-frontier';

function generatedItem(index: number): ItemInstance {
  const definition = getItemDefinition(index === 0 ? 'vanguard-repeater' : 'initiates-edge')!;
  return {
    instanceId: `generated-${index}`,
    definitionId: definition.id,
    rarity: index === 0 ? 'epic' : 'common',
    itemLevel: 12,
    affixes: [],
    signatureId: definition.signatureId,
    sourceId: 'solo-frontier',
    acquiredAt: 10 + index,
    rerolls: index % 2,
    enhancementRank: 0
  };
}

describe('v21 canonical equipment migration', () => {
  it('preserves generated instances, rarity, favorites, active weapon, overflow, food and refinements idempotently', () => {
    const generated = Array.from({ length: 37 }, (_, index) => generatedItem(index));
    const v20 = {
      version: 20,
      savedAt: 50_000,
      skills: [],
      equipment: {
        melee: 'ironBlade',
        armor: 'platedVest',
        food: 'smokedRation',
        tool: 'hardenedPick'
      },
      weaponRefinements: { ironBlade: 3 },
      lootInventory: generated,
      lootCache: generated,
      lootFavorites: ['generated-0'],
      soloFrontier: {
        version: 20,
        seed: 'migration-seed',
        lastUpdatedAt: 50_000,
        lootCache: {
          items: generated,
          equipment: {
            gun: 'generated-0',
            activeWeaponSlot: 'gun'
          },
          favoriteIds: ['generated-0']
        }
      }
    };

    const migrated = migrateV20SaveToV21(v20);
    const cache = migrated.soloFrontier.lootCache;
    expect(migrated.version).toBe(21);
    expect(migrated.equipment).toEqual({ tool: 'hardenedPick' });
    expect('lootInventory' in migrated).toBe(false);
    expect('lootCache' in migrated).toBe(false);
    expect('weaponRefinements' in migrated).toBe(false);
    expect('combatProgression' in migrated).toBe(false);
    expect(cache.foodId).toBe('smokedRation');
    expect(cache.equipment.gun).toBe('generated-0');
    expect(cache.equipment.activeWeaponSlot).toBe('gun');
    expect(cache.favoriteIds).toContain('generated-0');
    expect(cache.items.find(item => item.instanceId === 'generated-0')?.rarity).toBe('epic');
    expect(new Set(cache.items.map(item => item.instanceId)).size).toBe(cache.items.length);
    expect(countUnequippedItems(cache)).toBeGreaterThan(35);
    expect(cache.grandfatheredOverflow).toBe(true);

    const ironId = cache.equipment.melee!;
    const iron = cache.items.find(item => item.instanceId === ironId)!;
    const definition = getItemDefinition(iron.definitionId)!;
    expect(iron.definitionId).toBe('iron-blade');
    expect(iron.enhancementRank).toBe(3);
    expect(calculateItemStats(definition, iron).damage).toBe((definition.baseStats.damage || 0) + 6);
    expect(cache.items.find(item => item.instanceId === cache.equipment.chest)?.definitionId).toBe('plated-vest');

    expect(migrateV20SaveToV21(JSON.parse(JSON.stringify(migrated)))).toEqual(migrated);
  });

  it('applies a legacy refinement to an overlapping canonical equipped instance without replacing its id', () => {
    const definition = getItemDefinition('iron-blade')!;
    const canonical: ItemInstance = {
      instanceId: 'preserved-iron-instance',
      definitionId: definition.id,
      rarity: 'legendary',
      itemLevel: 19,
      affixes: [],
      signatureId: definition.signatureId,
      sourceId: 'existing-v20-projection',
      acquiredAt: 123,
      rerolls: 2
    };
    const migrated = migrateV20SaveToV21({
      version: 20,
      skills: [],
      savedAt: 500,
      equipment: { melee: 'ironBlade' },
      weaponRefinements: { ironBlade: 4 },
      soloFrontier: {
        version: 20,
        seed: 'overlap',
        lastUpdatedAt: 500,
        lootCache: {
          items: [canonical],
          equipment: { melee: canonical.instanceId, activeWeaponSlot: 'melee' }
        }
      }
    });
    const equipped = migrated.soloFrontier.lootCache.items.find(item => item.instanceId === canonical.instanceId)!;
    expect(migrated.soloFrontier.lootCache.equipment.melee).toBe(canonical.instanceId);
    expect(equipped).toMatchObject({ rarity: 'legendary', itemLevel: 19, rerolls: 2, enhancementRank: 4 });
    expect(migrated.soloFrontier.lootCache.items).toHaveLength(1);
  });
});
