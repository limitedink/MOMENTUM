import type { ArmourSlotId, ArmourWeight, ItemInstance, LootCacheState, LootSlot, RarityId } from '../loot';

export const COMBAT_GEAR_CATEGORIES = [
  'melee', 'gun', 'ranged', 'magic',
  'helm', 'chest', 'gloves', 'pants', 'boots', 'cloak',
  'belt', 'amulet', 'ring', 'trinket'
] as const satisfies readonly LootSlot[];

export type CombatGearCategory = (typeof COMBAT_GEAR_CATEGORIES)[number];
export const ARMOUR_GEAR_CATEGORIES = ['helm', 'chest', 'gloves', 'pants', 'boots', 'cloak'] as const satisfies readonly ArmourSlotId[];
export type FrontierArmourCategory = (typeof ARMOUR_GEAR_CATEGORIES)[number];

export interface FrontierGearTarget {
  category: CombatGearCategory;
  armourWeight?: ArmourWeight;
}

export type FrontierGearTargetInput = CombatGearCategory | FrontierGearTarget;
export type FrontierLedgerSource =
  | 'solo-time'
  | 'boss-first-clear'
  | 'tree-respec'
  | 'requisition'
  | 'target-contract'
  | 'daily-stock';

export interface FrontierGoldLedger {
  earned: number;
  spent: number;
  earnedBySource: Partial<Record<FrontierLedgerSource, number>>;
  spentBySource: Partial<Record<FrontierLedgerSource, number>>;
}

export interface TargetContractState {
  id: string;
  category: CombatGearCategory;
  /** Undefined means Any weight for legacy and unrestricted contracts. */
  armourWeight?: ArmourWeight;
  startedAt: number;
  successfulMs: number;
  requiredMs: number;
  itemLevel: number;
}

export type DailyStoreOffer =
  | {
    id: string;
    kind: 'resource';
    resource: 'Bars' | 'Crafted Components' | 'Rare Gems';
    quantity: number;
    price: number;
  }
  | {
    id: string;
    kind: 'food';
    foodId: 'cookedFish' | 'smokedRation' | 'surgefinRation';
    quantity: number;
    price: number;
  }
  | {
    id: string;
    kind: 'item';
    category: CombatGearCategory;
    item: ItemInstance;
    price: number;
  };

export interface FrontierExchangeState {
  goldFraction: number;
  ledger: FrontierGoldLedger;
  storeDay: string | null;
  dailyOffers: readonly DailyStoreOffer[];
  purchasedOfferIds: readonly string[];
  activeContract: TargetContractState | null;
  pendingContractReward: ItemInstance | null;
}

export interface FrontierWallet {
  gold: number;
  bars: number;
  craftedComponents: number;
  rareGems: number;
  food: Readonly<Record<'cookedFish' | 'smokedRation' | 'surgefinRation', number>>;
}

export interface FrontierTransactionResult {
  accepted: boolean;
  reason: string;
  exchange: FrontierExchangeState;
  wallet: FrontierWallet;
  cache: LootCacheState;
  item: ItemInstance | null;
}

export interface FrontierGoldAwardResult {
  exchange: FrontierExchangeState;
  wholeGold: number;
}

export interface FrontierGearRollOptions {
  category: CombatGearCategory;
  armourWeight?: ArmourWeight;
  itemLevel: number;
  sourceId: string;
  seed: string;
  now: number;
  rarityWeights: Partial<Record<RarityId, number>>;
}
