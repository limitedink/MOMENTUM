import { calculateEquippedStats, calculateItemStats, createEquipmentLoadout, createLootCache, getItemDefinition, getRarity, getSkillToolDefinition, inspectItem, insertLoot, listSkillTools, lootDefinitions, lootTables, rarityDefinitions, rollLoot, salvageItem, skillToolDefinitions, updateCollectionProgress, validateEquipItem } from './loot-registry';
import { ARENA_LOOT_TABLES, COMBAT_LOOT_DEFINITIONS, PARTY_BOSS_LOOT_TABLE, RARITY_DEFINITIONS, SKILL_TOOL_DEFINITIONS } from './loot-definitions';
import { migrateV18SaveToV19 } from './loot-migration';

export const momentumLootFramework = Object.freeze({
  rollLoot,
  inspectItem,
  calculateItemStats,
  calculateEquippedStats,
  createEquipmentLoadout,
  createLootCache,
  insertLoot,
  validateEquipItem,
  salvageItem,
  migrateV18SaveToV19,
  updateCollectionProgress,
  getRarity,
  getItemDefinition,
  getSkillToolDefinition,
  listSkillTools,
  lootTables,
  lootDefinitions,
  rarityDefinitions,
  skillToolDefinitions,
  arenaTables: ARENA_LOOT_TABLES,
  partyBossTable: PARTY_BOSS_LOOT_TABLE,
  rarities: RARITY_DEFINITIONS,
  skillTools: SKILL_TOOL_DEFINITIONS
});

if (typeof window !== 'undefined') window.MomentumLootFramework = momentumLootFramework;

export * from './loot-types';
export * from './loot-definitions';
export * from './loot-registry';
export * from './loot-migration';
