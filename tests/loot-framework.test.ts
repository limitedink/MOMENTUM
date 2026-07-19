import { describe, expect, it } from 'vitest';
import {
  ARENA_LOOT_TABLES,
  COMBAT_LOOT_DEFINITIONS,
  PARTY_BOSS_LOOT_TABLE,
  RARITY_DEFINITIONS,
  SKILL_TOOL_DEFINITIONS
} from '../src/game/loot';
import { CRAFTING_RECIPES } from '../src/game/skills/definitions';
import { inspectItem, rollLoot, salvageItem, updateCollectionProgress, validateEquipItem } from '../src/game/loot/loot-registry';

const context = {
  sourceType: 'arenaBoss' as const,
  sourceId: 'arena:3',
  sourceTier: 3,
  playerLevel: 15,
  runId: 'test-run',
  now: 1_700_000_000_000
};

describe('loot framework', () => {
  it('defines the eight ordered rarity tiers and their visual treatments', () => {
    expect(RARITY_DEFINITIONS.map(rarity => rarity.id)).toEqual([
      'common', 'uncommon', 'rare', 'epic', 'legendary', 'mythic', 'ascendant', 'chase'
    ]);
    expect(RARITY_DEFINITIONS.find(rarity => rarity.id === 'ascendant')?.glow).toBe('pulse');
    expect(RARITY_DEFINITIONS.find(rarity => rarity.id === 'chase')?.color).toBe('#080b12');
  });

  it('produces deterministic common loot with bounded base stats', () => {
    const first = rollLoot(context, () => 0);
    const second = rollLoot(context, () => 0);
    expect(first).toEqual(second);
    expect(first.item?.rarity).toBe('common');
    expect(first.item?.affixes).toHaveLength(0);
    expect(first.salvage).toBeGreaterThan(0);
    expect(first.collectionProgress).toBe(3);
    expect(inspectItem(first.item!, COMBAT_LOOT_DEFINITIONS)?.stats.damage).toBeGreaterThan(0);
  });

  it('caps top-tier affixes and keeps chase signatures separate from raw stat inflation', () => {
    const values = [0.5, 0, 0.999999, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0];
    const result = rollLoot(context, () => values.shift() ?? 0);
    expect(result.item?.rarity).toBe('chase');
    expect(result.item?.affixes).toHaveLength(5);
    expect(result.item?.signatureId).toBeTruthy();
  });

  it('protects equipped loot and salvages duplicate instances', () => {
    const result = rollLoot(context, () => 0);
    const item = result.item!;
    expect(salvageItem([item], item.instanceId, [item.instanceId]).accepted).toBe(false);
    const salvaged = salvageItem([item], item.instanceId, []);
    expect(salvaged.accepted).toBe(true);
    expect(salvaged.value).toBeGreaterThan(0);
  });

  it('validates equip slots and updates collection progress without mutating the source', () => {
    const item = rollLoot(context, () => 0).item!;
    expect(validateEquipItem(item, 'gun').accepted).toBe(true);
    expect(validateEquipItem(item, 'armor').accepted).toBe(false);
    const current = { 'arena:3': 2 };
    const next = updateCollectionProgress(current, { collectionTrackId: 'arena:3', collectionProgress: 3 });
    expect(current).toEqual({ 'arena:3': 2 });
    expect(next).toEqual({ 'arena:3': 5 });
  });

  it('keeps arena and party boss tables compatible and tools tied to Crafting recipes', () => {
    expect(ARENA_LOOT_TABLES).toHaveLength(3);
    expect(PARTY_BOSS_LOOT_TABLE.sourceType).toBe('partyBoss');
    expect(SKILL_TOOL_DEFINITIONS.map(tool => tool.id)).toEqual(['guitar', 'drums', 'piano', 'harp']);
    expect(CRAFTING_RECIPES.filter(recipe => recipe.skillToolId).map(recipe => recipe.skillToolId)).toEqual(['guitar', 'drums', 'piano', 'harp']);
  });
});
