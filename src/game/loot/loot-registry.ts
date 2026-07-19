import { ARENA_LOOT_TABLES, COMBAT_LOOT_DEFINITIONS, PARTY_BOSS_LOOT_TABLE, RARITY_DEFINITIONS, SKILL_TOOL_DEFINITIONS } from './loot-definitions';
import type { ItemDefinition, ItemInstance, LootInspection, LootResolution, LootSourceContext, LootTable, RarityDefinition, SkillToolDefinition } from './loot-types';

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
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

function tableFor(tables: readonly LootTable[], context: LootSourceContext): LootTable {
  return tables.find(table => table.sourceType === context.sourceType && table.sourceId === context.sourceId)
    || tables.find(table => table.sourceType === context.sourceType)
    || (context.sourceType === 'partyBoss' ? PARTY_BOSS_LOOT_TABLE : ARENA_LOOT_TABLES[0]);
}

function rollRarity(table: LootTable, random: () => number): RarityDefinition {
  const ids = RARITY_DEFINITIONS.map(rarity => rarity.id);
  const weights = ids.map(id => table.rarityWeights[id] || 0);
  return rarityById(pickWeighted(ids, weights, random));
}

function rollAffixes(definition: ItemDefinition, rarity: RarityDefinition, random: () => number) {
  const available = [...definition.affixPool];
  const rolls = [];
  for (let index = 0; index < rarity.affixCount && available.length > 0; index += 1) {
    const affix = available.splice(Math.floor(randomUnit(random) * available.length), 1)[0];
    const value = affix.min + (affix.max - affix.min) * randomUnit(random);
    rolls.push({
      id: affix.id,
      name: affix.name,
      stat: affix.stat,
      value: Number(value.toFixed(2)),
      tier: Math.min(5, Math.max(1, Math.ceil(rarity.statMultiplier * 3))),
      unit: affix.unit || 'flat'
    });
  }
  return rolls;
}

export function calculateItemStats(definition: ItemDefinition, instance: ItemInstance): Partial<Record<string, number>> {
  const rarity = rarityById(instance.rarity);
  const stats: Partial<Record<string, number>> = {};
  Object.entries(definition.baseStats).forEach(([stat, value]) => {
    stats[stat] = Number(((value || 0) * rarity.statMultiplier).toFixed(2));
  });
  instance.affixes.forEach(affix => {
    stats[affix.stat] = Number(((stats[affix.stat] || 0) + affix.value).toFixed(2));
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
  if (randomUnit(random) > table.itemChance || table.itemDefinitionIds.length === 0) {
    return { tableId: table.id, item: null, salvage, collectionTrackId, collectionProgress: table.collectionProgress, rarity: null };
  }

  const rarity = rollRarity(table, random);
  const definitionId = table.itemDefinitionIds[Math.floor(randomUnit(random) * table.itemDefinitionIds.length)];
  const definition = definitions.find(item => item.id === definitionId) || definitions[0];
  const now = context.now || Date.now();
  const instance: ItemInstance = {
    instanceId: `${context.sourceId}:${context.runId}:${now}:${Math.floor(randomUnit(random) * 1_000_000)}`,
    definitionId: definition.id,
    rarity: rarity.id,
    itemLevel: Math.max(1, context.sourceTier * 10 + Math.floor(context.playerLevel / 5)),
    affixes: rollAffixes(definition, rarity, random),
    signatureId: definition.signatureId,
    sourceId: context.sourceId,
    acquiredAt: now
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
  if (slot && inspection.definition.slot !== slot) {
    return { accepted: false, reason: `This item belongs in the ${inspection.definition.slot} slot.`, item: null, inspection };
  }
  return { accepted: true, reason: '', item: instance, inspection };
}

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

export function salvageItem(inventory: readonly ItemInstance[], instanceId: string, equippedIds: readonly string[], definitions: readonly ItemDefinition[] = COMBAT_LOOT_DEFINITIONS) {
  const item = inventory.find(instance => instance.instanceId === instanceId);
  if (!item || equippedIds.includes(instanceId)) return { accepted: false, reason: !item ? 'Unknown item.' : 'Equipped items cannot be salvaged.', item: null, value: 0 };
  const inspection = inspectItem(item, definitions);
  if (!inspection) return { accepted: false, reason: 'Unknown item definition.', item: null, value: 0 };
  return { accepted: true, reason: '', item, value: Math.max(1, Math.round(4 * inspection.rarity.statMultiplier)) };
}

export function getRarity(id: string): RarityDefinition { return rarityById(id); }
export function getItemDefinition(id: string): ItemDefinition | undefined { return COMBAT_LOOT_DEFINITIONS.find(item => item.id === id); }
export function getSkillToolDefinition(id: string): SkillToolDefinition | undefined { return SKILL_TOOL_DEFINITIONS.find(tool => tool.id === id); }
export function listSkillTools(skillId: string): SkillToolDefinition[] { return SKILL_TOOL_DEFINITIONS.filter(tool => tool.skillId === skillId); }

export const lootTables = Object.freeze([...ARENA_LOOT_TABLES, PARTY_BOSS_LOOT_TABLE]);
export const lootDefinitions = Object.freeze([...COMBAT_LOOT_DEFINITIONS]);
export const rarityDefinitions = Object.freeze([...RARITY_DEFINITIONS]);
export const skillToolDefinitions = Object.freeze([...SKILL_TOOL_DEFINITIONS]);
