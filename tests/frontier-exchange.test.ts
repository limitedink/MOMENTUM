import { describe, expect, it } from 'vitest';
import {
  TARGET_CONTRACT_REQUIRED_MS,
  advanceTargetContract,
  cancelTargetContract,
  claimTargetContractReward,
  createFrontierExchangeState,
  normalizeFrontierExchangeState,
  purchaseArenaDisciplineRespec,
  purchaseDailyStock,
  purchaseRequisition,
  purchaseTreeRespec,
  refreshDailyStock,
  startTargetContract
} from '../src/game/frontier-exchange';
import { createLootCache, getItemDefinition, type ItemInstance } from '../src/game/loot';
import type { FrontierWallet } from '../src/game/frontier-exchange';
import { COMBAT_SKILL_TREES, allocateCombatTreeNode, createCombatDevelopmentState } from '../src/game/combat-development';
import { createInitialCombatProgression } from '../src/game/combat-progression';

const wallet = (gold: number): FrontierWallet => ({
  gold,
  bars: 0,
  craftedComponents: 0,
  rareGems: 0,
  food: { cookedFish: 0, smokedRation: 0, surgefinRation: 0 }
});

function item(instanceId: string): ItemInstance {
  const definition = getItemDefinition('initiates-edge')!;
  return {
    instanceId,
    definitionId: definition.id,
    rarity: 'common',
    itemLevel: 1,
    affixes: [],
    signatureId: definition.signatureId,
    sourceId: 'test',
    acquiredAt: 1,
    rerolls: 0,
    enhancementRank: 0
  };
}

describe('v21 Frontier Exchange', () => {
  it('builds deterministic six-offer stock and never rolls its saved UTC day backward', () => {
    const day1 = Date.UTC(2026, 6, 21, 12);
    const day2 = Date.UTC(2026, 6, 22, 12);
    const first = refreshDailyStock(createFrontierExchangeState(), 'save-seed', 20, day1);
    const repeated = refreshDailyStock(createFrontierExchangeState(), 'save-seed', 20, day1 + 11 * 60 * 60 * 1_000);
    expect(first.dailyOffers).toHaveLength(6);
    expect(repeated).toEqual(first);
    expect(first.dailyOffers.filter(offer => offer.kind === 'resource')).toEqual(expect.arrayContaining([
      expect.objectContaining({ resource: 'Bars', quantity: 50, price: 200 }),
      expect.objectContaining({ resource: 'Crafted Components', quantity: 10, price: 250 }),
      expect.objectContaining({ resource: 'Rare Gems', quantity: 1, price: 750 })
    ]));
    expect(first.dailyOffers.find(offer => offer.kind === 'food')).toMatchObject({ quantity: 10, price: 150 });
    for (const offer of first.dailyOffers.filter((candidate): candidate is Extract<(typeof first.dailyOffers)[number], { kind: 'item' }> => candidate.kind === 'item')) {
      expect(['rare', 'epic']).toContain(offer.item.rarity);
      expect(offer.price).toBe(offer.item.rarity === 'epic' ? 700 + 35 * offer.item.itemLevel : 400 + 30 * offer.item.itemLevel);
    }
    expect(normalizeFrontierExchangeState(JSON.parse(JSON.stringify(first)))).toEqual(first);

    const advanced = refreshDailyStock(first, 'save-seed', 20, day2);
    expect(advanced.storeDay).toBe('2026-07-22');
    const rolledBack = refreshDailyStock(advanced, 'save-seed', 20, day1);
    expect(rolledBack).toEqual(advanced);
  });

  it('keeps requisition spending and delivery atomic when funds or cache space are missing', () => {
    const exchange = createFrontierExchangeState();
    const cache = createLootCache();
    const poor = purchaseRequisition(exchange, wallet(100), cache, 'melee', 10, 'poor', 1);
    expect(poor.accepted).toBe(false);
    expect(poor.wallet.gold).toBe(100);
    expect(poor.cache).toEqual(cache);

    const full = createLootCache({ items: Array.from({ length: 35 }, (_, index) => item(`full-${index}`)) });
    const blocked = purchaseRequisition(exchange, wallet(1_000), full, 'gun', 10, 'full', 1);
    expect(blocked.accepted).toBe(false);
    expect(blocked.wallet.gold).toBe(1_000);
    expect(blocked.cache).toEqual(full);
    expect(blocked.exchange.ledger.spent).toBe(0);

    const delivered = purchaseRequisition(exchange, wallet(1_000), cache, 'gun', 10, 'delivered', 1);
    expect(delivered.accepted).toBe(true);
    expect(delivered.wallet.gold).toBe(650);
    expect(delivered.item?.itemLevel).toBe(10);
    expect(getItemDefinition(delivered.item!.definitionId)?.slot).toBe('gun');
    expect(['common', 'uncommon', 'rare', 'epic']).toContain(delivered.item?.rarity);
  });

  it('progresses contracts only through successful time and holds Rare+ rewards for a full cache', () => {
    const cache = createLootCache({ items: Array.from({ length: 35 }, (_, index) => item(`full-${index}`)) });
    const started = startTargetContract(createFrontierExchangeState(), wallet(2_000), cache, 'ranged', 20, 100);
    expect(started.accepted).toBe(true);
    expect(started.wallet.gold).toBe(1_400);
    expect(started.exchange.ledger.spentBySource['target-contract']).toBe(600);

    const halfway = advanceTargetContract(started.exchange, TARGET_CONTRACT_REQUIRED_MS / 2, 'contract-seed', 200);
    expect(halfway.activeContract?.successfulMs).toBe(TARGET_CONTRACT_REQUIRED_MS / 2);
    const completed = advanceTargetContract(halfway, TARGET_CONTRACT_REQUIRED_MS / 2, 'contract-seed', 300);
    expect(completed.activeContract).toBeNull();
    expect(completed.pendingContractReward).toBeTruthy();
    expect(['rare', 'epic', 'legendary']).toContain(completed.pendingContractReward?.rarity);

    const blockedClaim = claimTargetContractReward(completed, started.wallet, cache);
    expect(blockedClaim.accepted).toBe(false);
    expect(blockedClaim.wallet).toEqual(started.wallet);
    expect(blockedClaim.exchange.pendingContractReward).toEqual(completed.pendingContractReward);

    const claimed = claimTargetContractReward(completed, started.wallet, createLootCache());
    expect(claimed.accepted).toBe(true);
    expect(claimed.exchange.pendingContractReward).toBeNull();
    expect(claimed.cache.items).toContainEqual(completed.pendingContractReward);
  });

  it('does not refund a cancelled contract and permits each daily offer once', () => {
    const started = startTargetContract(createFrontierExchangeState(), wallet(1_000), createLootCache(), 'chest', 10, 100);
    const cancelled = cancelTargetContract(started.exchange);
    expect(cancelled.activeContract).toBeNull();
    expect(started.wallet.gold).toBe(600);
    expect(cancelled.ledger.spent).toBe(400);

    const stock = refreshDailyStock(cancelled, 'store-seed', 10, Date.UTC(2026, 6, 22));
    const bars = stock.dailyOffers.find(offer => offer.kind === 'resource' && offer.resource === 'Bars')!;
    const bought = purchaseDailyStock(stock, wallet(1_000), createLootCache(), bars.id);
    expect(bought.accepted).toBe(true);
    expect(bought.wallet).toMatchObject({ gold: 800, bars: 50 });
    expect(bought.exchange.ledger.spentBySource['daily-stock']).toBe(200);
    const duplicate = purchaseDailyStock(bought.exchange, bought.wallet, bought.cache, bars.id);
    expect(duplicate.accepted).toBe(false);
    expect(duplicate.wallet).toEqual(bought.wallet);
  });

  it('performs paid tree respecs atomically and locks Arena Discipline only during a run', () => {
    const progression = createInitialCombatProgression(100);
    const empty = createCombatDevelopmentState();
    const root = COMBAT_SKILL_TREES.Strength.tree!.rootNodeIds[0];
    const allocated = allocateCombatTreeNode(empty, progression, 'Strength', root).state;
    const exchange = createFrontierExchangeState();
    const cache = createLootCache();

    const poor = purchaseTreeRespec(exchange, wallet(149), cache, allocated, 'Strength');
    expect(poor.accepted).toBe(false);
    expect(poor.wallet.gold).toBe(149);
    expect(poor.development).toEqual(allocated);
    expect(poor.exchange.ledger.spent).toBe(0);

    const paid = purchaseTreeRespec(exchange, wallet(150), cache, allocated, 'Strength');
    expect(paid.accepted).toBe(true);
    expect(paid.wallet.gold).toBe(0);
    expect(paid.development.trees.Strength.ownedNodeIds).toEqual([]);
    expect(paid.exchange.ledger.spentBySource['tree-respec']).toBe(150);

    const locked = purchaseArenaDisciplineRespec(exchange, wallet(1_000), cache, 2, true);
    expect(locked.accepted).toBe(false);
    expect(locked.wallet.gold).toBe(1_000);
    const arenaPaid = purchaseArenaDisciplineRespec(exchange, wallet(1_000), cache, 2, false);
    expect(arenaPaid.accepted).toBe(true);
    expect(arenaPaid.wallet.gold).toBe(800);
  });
});
