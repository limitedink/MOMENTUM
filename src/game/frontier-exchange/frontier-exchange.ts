import {
  COMBAT_LOOT_DEFINITIONS,
  insertLoot,
  rollLoot,
  type ItemInstance,
  type LootCacheState,
  type LootTable,
  type RarityId
} from '../loot';
import type { CombatDevelopmentState } from '../combat-development';
import { combatTreeRespecCost, resetCombatTree } from '../combat-development';
import type { CombatSkillId } from '../combat-progression';
import {
  ARMOUR_GEAR_CATEGORIES,
  COMBAT_GEAR_CATEGORIES,
  type CombatGearCategory,
  type DailyStoreOffer,
  type FrontierGearTarget,
  type FrontierGearTargetInput,
  type FrontierExchangeState,
  type FrontierGearRollOptions,
  type FrontierGoldAwardResult,
  type FrontierGoldLedger,
  type FrontierLedgerSource,
  type FrontierTransactionResult,
  type FrontierWallet,
  type TargetContractState
} from './frontier-exchange-types';
import type { ArmourWeight } from '../loot';

export const TARGET_CONTRACT_REQUIRED_MS = 8 * 60 * 60 * 1_000;

const isRecord = (value: unknown): value is Record<string, unknown> => Boolean(value) && typeof value === 'object' && !Array.isArray(value);
const finite = (value: unknown): number => Number.isFinite(Number(value)) ? Math.max(0, Number(value)) : 0;
const integer = (value: unknown): number => Math.floor(finite(value));

function emptyLedger(): FrontierGoldLedger {
  return { earned: 0, spent: 0, earnedBySource: {}, spentBySource: {} };
}

export function createFrontierExchangeState(): FrontierExchangeState {
  return {
    goldFraction: 0,
    ledger: emptyLedger(),
    storeDay: null,
    dailyOffers: [],
    purchasedOfferIds: [],
    activeContract: null,
    pendingContractReward: null
  };
}

function category(value: unknown): CombatGearCategory | null {
  return typeof value === 'string' && (COMBAT_GEAR_CATEGORIES as readonly string[]).includes(value)
    ? value as CombatGearCategory
    : null;
}

function armourWeight(value: unknown): ArmourWeight | null {
  return value === 'light' || value === 'medium' || value === 'heavy' ? value : null;
}

export function isArmourGearCategory(value: unknown): value is (typeof ARMOUR_GEAR_CATEGORIES)[number] {
  return typeof value === 'string' && (ARMOUR_GEAR_CATEGORIES as readonly string[]).includes(value);
}

/**
 * Normalizes the public exchange target. A weight on a non-armour category is
 * deliberately invalid instead of silently becoming an unrestricted target.
 */
export function normalizeFrontierGearTarget(value: unknown): FrontierGearTarget | null {
  if (typeof value === 'string') {
    const normalizedCategory = category(value);
    return normalizedCategory ? { category: normalizedCategory } : null;
  }
  if (!isRecord(value)) return null;
  const normalizedCategory = category(value.category);
  if (!normalizedCategory) return null;
  const rawWeight = value.armourWeight;
  if (rawWeight === undefined || rawWeight === null || rawWeight === 'any' || rawWeight === '') {
    return { category: normalizedCategory };
  }
  const normalizedWeight = armourWeight(rawWeight);
  if (!normalizedWeight || !isArmourGearCategory(normalizedCategory)) return null;
  return { category: normalizedCategory, armourWeight: normalizedWeight };
}

function normalizeItem(value: unknown): ItemInstance | null {
  if (!isRecord(value) || typeof value.instanceId !== 'string' || typeof value.definitionId !== 'string') return null;
  if (!COMBAT_LOOT_DEFINITIONS.some(definition => definition.id === value.definitionId)) return null;
  return value as unknown as ItemInstance;
}

function normalizeContract(value: unknown): TargetContractState | null {
  if (!isRecord(value)) return null;
  const normalizedCategory = category(value.category);
  if (!normalizedCategory) return null;
  const normalizedWeight = isArmourGearCategory(normalizedCategory) ? armourWeight(value.armourWeight) : null;
  return {
    id: typeof value.id === 'string' ? value.id : `contract:${normalizedCategory}`,
    category: normalizedCategory,
    ...(normalizedWeight ? { armourWeight: normalizedWeight } : {}),
    startedAt: finite(value.startedAt),
    successfulMs: Math.min(TARGET_CONTRACT_REQUIRED_MS, finite(value.successfulMs)),
    requiredMs: TARGET_CONTRACT_REQUIRED_MS,
    itemLevel: Math.max(1, Math.min(30, integer(value.itemLevel) || 1))
  };
}

function normalizeLedger(value: unknown): FrontierGoldLedger {
  const source = isRecord(value) ? value : {};
  const earnedBySource = isRecord(source.earnedBySource)
    ? Object.fromEntries(Object.entries(source.earnedBySource).map(([key, amount]) => [key, integer(amount)]))
    : {};
  const spentBySource = isRecord(source.spentBySource)
    ? Object.fromEntries(Object.entries(source.spentBySource).map(([key, amount]) => [key, integer(amount)]))
    : {};
  return { earned: integer(source.earned), spent: integer(source.spent), earnedBySource, spentBySource };
}

export function normalizeFrontierExchangeState(value: unknown): FrontierExchangeState {
  const source = isRecord(value) ? value : {};
  return {
    goldFraction: Math.min(0.999999, finite(source.goldFraction) % 1),
    ledger: normalizeLedger(source.ledger),
    storeDay: typeof source.storeDay === 'string' ? source.storeDay : null,
    dailyOffers: Array.isArray(source.dailyOffers) ? source.dailyOffers.filter(isRecord) as unknown as DailyStoreOffer[] : [],
    purchasedOfferIds: Array.isArray(source.purchasedOfferIds)
      ? [...new Set(source.purchasedOfferIds.filter((id): id is string => typeof id === 'string'))]
      : [],
    activeContract: normalizeContract(source.activeContract),
    pendingContractReward: normalizeItem(source.pendingContractReward)
  };
}

function ledgerEarned(ledger: FrontierGoldLedger, source: FrontierLedgerSource, amount: number): FrontierGoldLedger {
  const value = integer(amount);
  return {
    ...ledger,
    earned: ledger.earned + value,
    earnedBySource: { ...ledger.earnedBySource, [source]: integer(ledger.earnedBySource[source]) + value }
  };
}

function ledgerSpent(ledger: FrontierGoldLedger, source: FrontierLedgerSource, amount: number): FrontierGoldLedger {
  const value = integer(amount);
  return {
    ...ledger,
    spent: ledger.spent + value,
    spentBySource: { ...ledger.spentBySource, [source]: integer(ledger.spentBySource[source]) + value }
  };
}

export function awardFrontierGold(
  stateValue: unknown,
  amount: number,
  source: Extract<FrontierLedgerSource, 'solo-time' | 'boss-first-clear'>
): FrontierGoldAwardResult {
  const state = normalizeFrontierExchangeState(stateValue);
  const accrued = state.goldFraction + finite(amount);
  const wholeGold = Math.floor(accrued + 1e-9);
  return {
    wholeGold,
    exchange: {
      ...state,
      goldFraction: Math.max(0, accrued - wholeGold),
      ledger: wholeGold ? ledgerEarned(state.ledger, source, wholeGold) : state.ledger
    }
  };
}

export function requisitionPrice(highestClearedStage: number): number {
  return 150 + 20 * Math.max(0, Math.floor(finite(highestClearedStage)));
}

export function targetContractPrice(highestClearedStage: number): number {
  return 200 + 20 * Math.max(0, Math.floor(finite(highestClearedStage)));
}

function rarityTable(id: string, sourceId: string, definitionIds: readonly string[], weights: Partial<Record<RarityId, number>>): LootTable {
  return {
    id,
    sourceType: 'soloFrontier',
    sourceId,
    itemChance: 1,
    itemDefinitionIds: definitionIds,
    rarityWeights: weights,
    salvageMin: 0,
    salvageMax: 0,
    collectionProgress: 0
  };
}

function randomFor(seed: string): () => number {
  let hash = 0x811c9dc5;
  for (let index = 0; index < seed.length; index += 1) {
    hash ^= seed.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  let state = hash >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4_294_967_296;
  };
}

export function rollFrontierGear(options: FrontierGearRollOptions): ItemInstance {
  const rollSeed = options.armourWeight ? `${options.seed}:armour:${options.armourWeight}` : options.seed;
  const definitions = COMBAT_LOOT_DEFINITIONS.filter(definition => definition.kind !== 'food');
  const table = rarityTable(
    `exchange:${options.sourceId}`,
    options.sourceId,
    definitions.map(definition => definition.id),
    options.rarityWeights
  );
  const resolution = rollLoot({
    sourceType: 'soloFrontier',
    sourceId: options.sourceId,
    sourceTier: Math.max(1, Math.ceil(options.itemLevel / 10)),
    playerLevel: Math.max(1, options.itemLevel),
    itemLevel: Math.max(1, options.itemLevel),
    runId: rollSeed,
    itemChance: 1,
    targetSlots: [options.category],
    targetSlotWeight: 1,
    targetArmourWeight: options.armourWeight,
    now: options.now
  }, randomFor(rollSeed), [table], definitions);
  if (!resolution.item) throw new Error(`Frontier gear roll produced no item for ${options.category}.`);
  return resolution.item;
}

function rejected(wallet: FrontierWallet, cache: LootCacheState, exchange: FrontierExchangeState, reason: string): FrontierTransactionResult {
  return { accepted: false, reason, wallet, cache, exchange, item: null };
}

function spend(wallet: FrontierWallet, price: number): FrontierWallet {
  return { ...wallet, gold: wallet.gold - price };
}

export function purchaseRequisition(
  exchangeValue: unknown,
  wallet: FrontierWallet,
  cache: LootCacheState,
  targetInput: FrontierGearTargetInput,
  highestClearedStage: number,
  seed: string,
  now: number
): FrontierTransactionResult {
  const exchange = normalizeFrontierExchangeState(exchangeValue);
  const target = normalizeFrontierGearTarget(targetInput);
  if (!target) return rejected(wallet, cache, exchange, 'Choose a valid gear category and armour weight.');
  const price = requisitionPrice(highestClearedStage);
  if (wallet.gold < price) return rejected(wallet, cache, exchange, 'Not enough Gold.');
  const item = rollFrontierGear({
    category: target.category,
    armourWeight: target.armourWeight,
    itemLevel: Math.max(1, Math.min(30, Math.floor(highestClearedStage) || 1)),
    sourceId: 'frontier-exchange:requisition',
    seed,
    now,
    rarityWeights: { common: 50, uncommon: 35, rare: 12, epic: 3 }
  });
  const inserted = insertLoot(cache, item);
  if (!inserted.accepted) return rejected(wallet, cache, exchange, 'The 35-slot cache is full.');
  return {
    accepted: true,
    reason: 'Requisition delivered.',
    wallet: spend(wallet, price),
    cache: inserted.cache,
    exchange: { ...exchange, ledger: ledgerSpent(exchange.ledger, 'requisition', price) },
    item: inserted.item
  };
}

export function startTargetContract(
  exchangeValue: unknown,
  wallet: FrontierWallet,
  cache: LootCacheState,
  targetInput: FrontierGearTargetInput,
  highestClearedStage: number,
  now: number
): FrontierTransactionResult {
  const exchange = normalizeFrontierExchangeState(exchangeValue);
  const target = normalizeFrontierGearTarget(targetInput);
  if (!target) return rejected(wallet, cache, exchange, 'Choose a valid gear category and armour weight.');
  if (exchange.activeContract || exchange.pendingContractReward) return rejected(wallet, cache, exchange, 'Finish or claim the current contract first.');
  const price = targetContractPrice(highestClearedStage);
  if (wallet.gold < price) return rejected(wallet, cache, exchange, 'Not enough Gold.');
  const contract: TargetContractState = {
    id: `contract:${now}:${target.category}${target.armourWeight ? `:${target.armourWeight}` : ''}`,
    category: target.category,
    ...(target.armourWeight ? { armourWeight: target.armourWeight } : {}),
    startedAt: now,
    successfulMs: 0,
    requiredMs: TARGET_CONTRACT_REQUIRED_MS,
    itemLevel: Math.max(1, Math.min(30, Math.floor(highestClearedStage) || 1))
  };
  return {
    accepted: true,
    reason: 'Target contract started.',
    wallet: spend(wallet, price),
    cache,
    exchange: { ...exchange, activeContract: contract, ledger: ledgerSpent(exchange.ledger, 'target-contract', price) },
    item: null
  };
}

export function cancelTargetContract(exchangeValue: unknown): FrontierExchangeState {
  const exchange = normalizeFrontierExchangeState(exchangeValue);
  return { ...exchange, activeContract: null };
}

export function advanceTargetContract(
  exchangeValue: unknown,
  successfulMs: number,
  seed: string,
  now: number
): FrontierExchangeState {
  const exchange = normalizeFrontierExchangeState(exchangeValue);
  const contract = exchange.activeContract;
  if (!contract || exchange.pendingContractReward || successfulMs <= 0) return exchange;
  const progressed = Math.min(contract.requiredMs, contract.successfulMs + finite(successfulMs));
  if (progressed < contract.requiredMs) return { ...exchange, activeContract: { ...contract, successfulMs: progressed } };
  const item = rollFrontierGear({
    category: contract.category,
    armourWeight: contract.armourWeight,
    itemLevel: contract.itemLevel,
    sourceId: 'frontier-exchange:contract',
    seed: `${seed}:${contract.id}`,
    now,
    rarityWeights: { rare: 85, epic: 13, legendary: 2 }
  });
  return { ...exchange, activeContract: null, pendingContractReward: item };
}

export function claimTargetContractReward(
  exchangeValue: unknown,
  wallet: FrontierWallet,
  cache: LootCacheState
): FrontierTransactionResult {
  const exchange = normalizeFrontierExchangeState(exchangeValue);
  if (!exchange.pendingContractReward) return rejected(wallet, cache, exchange, 'No contract reward is waiting.');
  const inserted = insertLoot(cache, exchange.pendingContractReward);
  if (!inserted.accepted) return rejected(wallet, cache, exchange, 'The 35-slot cache is full; reward remains held.');
  return {
    accepted: true,
    reason: 'Contract reward claimed.',
    wallet,
    cache: inserted.cache,
    exchange: { ...exchange, pendingContractReward: null },
    item: inserted.item
  };
}

export function utcStoreDay(now: number): string {
  return new Date(Number.isFinite(now) ? now : 0).toISOString().slice(0, 10);
}

function gearPrice(rarity: RarityId, itemLevel: number): number {
  return rarity === 'epic' ? 700 + 35 * itemLevel : 400 + 30 * itemLevel;
}

export function refreshDailyStock(
  exchangeValue: unknown,
  saveSeed: string,
  highestClearedStage: number,
  now: number
): FrontierExchangeState {
  const exchange = normalizeFrontierExchangeState(exchangeValue);
  const today = utcStoreDay(now);
  const day = exchange.storeDay && exchange.storeDay > today ? exchange.storeDay : today;
  if (exchange.storeDay === day && exchange.dailyOffers.length === 6) return exchange;
  const itemLevel = Math.max(1, Math.min(30, Math.floor(highestClearedStage) || 1));
  const random = randomFor(`${saveSeed}:${day}:daily-stock`);
  const foodIds = ['cookedFish', 'smokedRation', 'surgefinRation'] as const;
  const foodId = foodIds[Math.floor(random() * foodIds.length)];
  const weaponCategories = ['melee', 'gun', 'ranged', 'magic'] as const;
  const gearCategories = ['helm', 'chest', 'gloves', 'pants', 'boots', 'cloak', 'belt', 'amulet', 'ring', 'trinket'] as const;
  const weaponCategory = weaponCategories[Math.floor(random() * weaponCategories.length)];
  const gearCategory = gearCategories[Math.floor(random() * gearCategories.length)];
  const dailyRarityWeights = { rare: 80, epic: 20 };
  const deterministicOfferTime = Date.parse(`${day}T00:00:00.000Z`);
  const weapon = rollFrontierGear({ category: weaponCategory, itemLevel, sourceId: 'frontier-exchange:daily-weapon', seed: `${saveSeed}:${day}:weapon`, now: deterministicOfferTime, rarityWeights: dailyRarityWeights });
  const gear = rollFrontierGear({ category: gearCategory, itemLevel, sourceId: 'frontier-exchange:daily-gear', seed: `${saveSeed}:${day}:gear`, now: deterministicOfferTime, rarityWeights: dailyRarityWeights });
  const offers: DailyStoreOffer[] = [
    { id: `${day}:bars`, kind: 'resource', resource: 'Bars', quantity: 50, price: 200 },
    { id: `${day}:components`, kind: 'resource', resource: 'Crafted Components', quantity: 10, price: 250 },
    { id: `${day}:food`, kind: 'food', foodId, quantity: 10, price: 150 },
    { id: `${day}:weapon`, kind: 'item', category: weaponCategory, item: weapon, price: gearPrice(weapon.rarity, weapon.itemLevel) },
    { id: `${day}:gear`, kind: 'item', category: gearCategory, item: gear, price: gearPrice(gear.rarity, gear.itemLevel) },
    { id: `${day}:gem`, kind: 'resource', resource: 'Rare Gems', quantity: 1, price: 750 }
  ];
  return { ...exchange, storeDay: day, dailyOffers: offers, purchasedOfferIds: [] };
}

export function purchaseDailyStock(
  exchangeValue: unknown,
  wallet: FrontierWallet,
  cache: LootCacheState,
  offerId: string
): FrontierTransactionResult {
  const exchange = normalizeFrontierExchangeState(exchangeValue);
  const offer = exchange.dailyOffers.find(candidate => candidate.id === offerId);
  if (!offer) return rejected(wallet, cache, exchange, 'Unknown daily offer.');
  if (exchange.purchasedOfferIds.includes(offer.id)) return rejected(wallet, cache, exchange, 'This offer is already purchased.');
  if (wallet.gold < offer.price) return rejected(wallet, cache, exchange, 'Not enough Gold.');
  let nextWallet = spend(wallet, offer.price);
  let nextCache = cache;
  let item: ItemInstance | null = null;
  if (offer.kind === 'item') {
    const inserted = insertLoot(cache, offer.item);
    if (!inserted.accepted) return rejected(wallet, cache, exchange, 'The 35-slot cache is full.');
    nextCache = inserted.cache;
    item = inserted.item;
  } else if (offer.kind === 'food') {
    nextWallet = { ...nextWallet, food: { ...nextWallet.food, [offer.foodId]: nextWallet.food[offer.foodId] + offer.quantity } };
  } else if (offer.resource === 'Bars') {
    nextWallet = { ...nextWallet, bars: nextWallet.bars + offer.quantity };
  } else if (offer.resource === 'Crafted Components') {
    nextWallet = { ...nextWallet, craftedComponents: nextWallet.craftedComponents + offer.quantity };
  } else {
    nextWallet = { ...nextWallet, rareGems: nextWallet.rareGems + offer.quantity };
  }
  return {
    accepted: true,
    reason: 'Daily offer purchased.',
    wallet: nextWallet,
    cache: nextCache,
    exchange: {
      ...exchange,
      purchasedOfferIds: [...exchange.purchasedOfferIds, offer.id],
      ledger: ledgerSpent(exchange.ledger, 'daily-stock', offer.price)
    },
    item
  };
}

export function purchaseTreeRespec(
  exchangeValue: unknown,
  wallet: FrontierWallet,
  cache: LootCacheState,
  development: CombatDevelopmentState,
  skillId: CombatSkillId
): FrontierTransactionResult & { development: CombatDevelopmentState } {
  const exchange = normalizeFrontierExchangeState(exchangeValue);
  const allocated = development.trees[skillId].ownedNodeIds.length;
  const price = combatTreeRespecCost(allocated);
  if (!allocated) return { ...rejected(wallet, cache, exchange, 'No points are allocated in this tree.'), development };
  if (wallet.gold < price) return { ...rejected(wallet, cache, exchange, 'Not enough Gold.'), development };
  return {
    accepted: true,
    reason: `${skillId} tree reset.`,
    wallet: spend(wallet, price),
    cache,
    exchange: { ...exchange, ledger: ledgerSpent(exchange.ledger, 'tree-respec', price) },
    item: null,
    development: resetCombatTree(development, skillId)
  };
}

export function purchaseArenaDisciplineRespec(
  exchangeValue: unknown,
  wallet: FrontierWallet,
  cache: LootCacheState,
  allocatedNodes: number,
  arenaRunActive: boolean
): FrontierTransactionResult {
  const exchange = normalizeFrontierExchangeState(exchangeValue);
  if (arenaRunActive) return rejected(wallet, cache, exchange, 'Arena Discipline is locked during an Arena run.');
  const allocated = Math.max(0, Math.floor(allocatedNodes));
  if (!allocated) return rejected(wallet, cache, exchange, 'No Arena Discipline nodes are allocated.');
  const price = combatTreeRespecCost(allocated);
  if (wallet.gold < price) return rejected(wallet, cache, exchange, 'Not enough Gold.');
  return {
    accepted: true,
    reason: 'Arena Discipline reset.',
    wallet: spend(wallet, price),
    cache,
    exchange: { ...exchange, ledger: ledgerSpent(exchange.ledger, 'tree-respec', price) },
    item: null
  };
}
