import {
  COMBAT_SKILL_IDS,
  applyCombatEncounterProgression,
  combatSkillLevels,
  createInitialCombatProgression,
  migrateV17SaveToV18,
  migrateV18SaveToV19,
  normalizeCombatProgression,
  xpToNextCombatLevel,
  type CombatProgressionState,
  type CombatSkillId
} from '../combat-progression';
import {
  advanceCombatDrill,
  createCombatDevelopmentState,
  normalizeCombatDevelopmentState,
  resolveCombatModifierSnapshot,
  type CombatDevelopmentState
} from '../combat-development';
import {
  advanceTargetContract,
  awardFrontierGold,
  createFrontierExchangeState,
  normalizeFrontierExchangeState,
  type FrontierExchangeState,
  type FrontierLedgerSource
} from '../frontier-exchange';
import {
  COMBAT_LOOT_DEFINITIONS,
  COMBAT_EQUIPMENT_SLOT_IDS,
  RARITY_DEFINITIONS,
  createLootCache,
  insertLoot,
  inspectItem,
  rollLoot,
  updateCollectionProgress,
  type ItemInstance,
  type LootCacheState,
  type LootFilters,
  type RarityId
} from '../loot';
import { SOLO_FRONTIER_ENCOUNTER_RECOVERY_SECONDS, SOLO_FRONTIER_STAGE_COUNT, soloFrontierStage } from './solo-frontier-definitions';
import { simulateSoloCombat } from './solo-combat-engine';
import {
  COMBAT_RECOVERY_SOURCES,
  type CombatRecoverySource,
  type SoloCombatInput,
  type SoloCombatResult
} from './solo-frontier-types';

export const SOLO_FRONTIER_SAVE_VERSION = 21 as const;
export const MOMENTUM_SAVE_VERSION = SOLO_FRONTIER_SAVE_VERSION;
export const SOLO_FRONTIER_OFFLINE_CAP_SECONDS = 8 * 60 * 60;
export const SOLO_FRONTIER_EXTENDED_OFFLINE_CAP_SECONDS = 12 * 60 * 60;
export const SOLO_FRONTIER_BATCH_ENCOUNTERS = 24;
export const SOLO_FRONTIER_BATCH_YIELD_MS = 0;
export const SOLO_FRONTIER_POINT_STAGES = Object.freeze([5, 10, 15, 20, 25, 30]);
export const SOLO_FRONTIER_BOSS_STAGES = Object.freeze([10, 20, 30]);
export const ARENA_TIER_UNLOCK_STAGES = Object.freeze([10, 20, 30]);
export const SOLO_FRONTIER_BOSS_KEY_REWARDS: Readonly<Record<number, number>> = Object.freeze({ 10: 3, 20: 5, 30: 8 });
export const SOLO_FRONTIER_BOSS_GOLD_REWARDS: Readonly<Record<number, number>> = Object.freeze({ 10: 250, 20: 750, 30: 2_000 });
export const SOLO_FRONTIER_LOOT_CHANCE = Object.freeze({
  onboardingRegular: 0.012,
  onboardingThroughStage: 7,
  regular: 0.0045,
  repeatBoss: 0.15,
  firstBoss: 1
});

export function arenaTierUnlockForSoloStage(highestClearedStage: number): number {
  const stage = Math.max(0, Math.floor(Number(highestClearedStage) || 0));
  return ARENA_TIER_UNLOCK_STAGES.reduce((unlocked, unlockStage, index) => stage >= unlockStage ? index + 1 : unlocked, 0);
}

export type SoloFrontierOrder = 'paused' | 'push' | 'farm';

export interface NonCombatSkillRuntimeState {
  id: string;
  active: boolean;
  actionsPerSecond: number;
  xpPerAction: number;
  level: number;
  xp: number;
  nextXp: number;
  progress: number;
  quantity: number;
}

export interface CombatDisciplineState {
  earnedPoints: number;
  grantedStages: readonly number[];
  ownedNodeIds: readonly string[];
}

export interface SoloFrontierWallReport {
  stage: number;
  order: Exclude<SoloFrontierOrder, 'paused'>;
  termination: 'player-defeated' | 'timeout';
  reason: string;
  atMs: number;
  fallbackStage: number | null;
}

export interface StrongestKeptDrop {
  instanceId: string;
  definitionId: string;
  rarity: RarityId;
  itemLevel: number;
  score: number;
}

export interface SoloFrontierSustainDebrief {
  healing: number;
  overhealing: number;
  healingBySource: Record<CombatRecoverySource, number>;
  mendCasts: number;
  reserveStored: number;
  reserveReleased: number;
  damageRecovered: number;
  damagePrevented: number;
  cooldownRemovedMs: number;
  emergencyTriggers: number;
  fatalGuards: number;
  minimumHealthRatio: number;
  timeBelowHalfMs: number;
}

export interface SoloFrontierDebrief {
  elapsedMs: number;
  priorOrder: SoloFrontierOrder;
  finalOrder: SoloFrontierOrder;
  wall: SoloFrontierWallReport | null;
  victories: number;
  deaths: number;
  skillXp: Record<CombatSkillId, number>;
  skillLevels: Record<CombatSkillId, number>;
  keys: number;
  gold: number;
  goldBySource: Partial<Record<FrontierLedgerSource, number>>;
  contractProgressMs: number;
  keptDrops: readonly ItemInstance[];
  keptDropCount: number;
  filterSalvage: number;
  fullCacheSalvage: number;
  rarityCounts: Record<RarityId, number>;
  strongestKeptDrops: readonly StrongestKeptDrop[];
  sustain: SoloFrontierSustainDebrief;
}

export interface SoloFrontierRuntimeState {
  version: 21;
  order: SoloFrontierOrder;
  configuredFallbackStage: number | null;
  farmStage: number | null;
  currentStage: number | null;
  currentStageVictories: number;
  encounterElapsedMs: number;
  encounterSequence: number;
  highestClearedStage: number;
  clearedStages: readonly number[];
  firstClearStages: readonly number[];
  stageVictories: Readonly<Record<string, number>>;
  wall: SoloFrontierWallReport | null;
  wallReports: readonly SoloFrontierWallReport[];
  totalVictories: number;
  totalDeaths: number;
  keys: number;
  combatProgression: CombatProgressionState;
  combatDiscipline: CombatDisciplineState;
  combatDevelopment: CombatDevelopmentState;
  frontierExchange: FrontierExchangeState;
  lootCache: LootCacheState;
  collectionProgress: Readonly<Record<string, number>>;
  nonCombatSkills: Readonly<Record<string, NonCombatSkillRuntimeState>>;
  debrief: SoloFrontierDebrief | null;
  seed: string;
  lastUpdatedAt: number;
}

export interface SoloFrontierLegacySeedInput {
  arenaWins?: readonly unknown[];
  legacyCombatLevel?: unknown;
  combatLevel?: unknown;
  existingCombatDisciplinePoints?: unknown;
  existingCombatTalents?: readonly unknown[];
}

export interface SoloFrontierSeedResult {
  highestClearedStage: number;
  clearedStages: readonly number[];
  firstClearStages: readonly number[];
  combatDiscipline: CombatDisciplineState;
}

export interface SoloFrontierSimulationOptions {
  /** A fixed input is convenient for tests; a factory is used by the app. */
  combatInput?: SoloCombatInput | ((stage: number, seed: string, state: Readonly<SoloFrontierRuntimeState>) => SoloCombatInput);
  /** Tests can supply a controlled enemy. App callers use the stage enemy. */
  useConfiguredEnemy?: boolean;
  seed?: string;
  now?: number;
  maxEncounters?: number;
  resetDebrief?: boolean;
  offlineCapSeconds?: number;
}

export interface SoloFrontierEncounterEvent {
  type: 'solo-frontier-encounter';
  sequence: number;
  stage: number;
  outcome: SoloCombatResult['outcome'];
  termination: SoloCombatResult['termination'];
  durationMs: number;
  firstClear: boolean;
  orderBefore: SoloFrontierOrder;
}

export interface SoloFrontierAdvanceResult {
  state: SoloFrontierRuntimeState;
  debrief: SoloFrontierDebrief;
  elapsedMs: number;
  remainingMs: number;
  events: readonly SoloFrontierEncounterEvent[];
}

export interface SoloFrontierCatchUpResult extends SoloFrontierAdvanceResult {
  capped: boolean;
  batches: number;
}

const RARITY_IDS = RARITY_DEFINITIONS.map(rarity => rarity.id);

const finiteNonNegative = (value: unknown, fallback = 0): number => {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? Math.max(0, numeric) : fallback;
};

const integerInRange = (value: unknown, minimum: number, maximum: number, fallback: number): number => {
  if (value === null || value === undefined || value === '') return fallback;
  const numeric = Math.floor(Number(value));
  return Number.isFinite(numeric) ? Math.min(maximum, Math.max(minimum, numeric)) : fallback;
};

const round = (value: number, places = 6): number => {
  const scale = 10 ** places;
  return Math.round((value + Number.EPSILON) * scale) / scale;
};

const isRecord = (value: unknown): value is Record<string, unknown> => Boolean(value && typeof value === 'object' && !Array.isArray(value));

function canonicalSeed(seed: unknown): string {
  return typeof seed === 'string' && seed.length ? seed : 'solo-frontier-v20';
}

/** The same explicit FNV-1a/Mulberry32 family used by deterministic combat. */
export function soloFrontierRandom(seed: string): () => number {
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

function combatMilestonesAtLevel(level: number): number[] {
  return SOLO_FRONTIER_POINT_STAGES.filter(stage => level >= stage);
}

function legacyCombatLevel(input: SoloFrontierLegacySeedInput): number {
  return integerInRange(input.legacyCombatLevel ?? input.combatLevel, 1, 100, 1);
}

function normalizeStageList(value: unknown, maximum = SOLO_FRONTIER_STAGE_COUNT): number[] {
  if (!Array.isArray(value)) return [];
  return [...new Set(value
    .map(stage => integerInRange(stage, 1, maximum, 0))
    .filter(stage => stage > 0))].sort((left, right) => left - right);
}

function contiguousStages(highest: number): number[] {
  return Array.from({ length: Math.max(0, highest) }, (_, index) => index + 1);
}

/**
 * Converts the old Arena/Combat gates into contiguous Solo Frontier clears.
 * Arena wins and legacy level points are both treated as already-earned
 * history, so v20 cannot pay the same first-clear point twice.
 */
export function seedSoloFrontierProgress(input: SoloFrontierLegacySeedInput = {}): SoloFrontierSeedResult {
  const wins = Array.isArray(input.arenaWins) ? input.arenaWins : [];
  const arenaSeed = wins.reduce((highest, winsAtTier, index) => Number(winsAtTier) > 0 ? Math.max(highest, [10, 20, 30][index] || 0) : highest, 0);
  const level = legacyCombatLevel(input);
  const legacySeed = Math.min(9, Math.floor(level / 2));
  const highestClearedStage = Math.min(SOLO_FRONTIER_STAGE_COUNT, Math.max(arenaSeed, legacySeed));
  const clearedStages = contiguousStages(highestClearedStage);
  const legacyPointStages = combatMilestonesAtLevel(level);
  const seededPointStages = SOLO_FRONTIER_POINT_STAGES.filter(stage => stage <= highestClearedStage);
  const grantedStages = [...new Set([...legacyPointStages, ...seededPointStages])].sort((left, right) => left - right);
  const existingPoints = integerInRange(input.existingCombatDisciplinePoints, 0, 100, 0);
  const ownedNodeIds = Array.isArray(input.existingCombatTalents)
    ? [...new Set(input.existingCombatTalents.filter((id): id is string => typeof id === 'string'))]
    : [];
  return {
    highestClearedStage,
    clearedStages,
    // Legacy Arena victories are already clears for loot and point idempotency.
    firstClearStages: clearedStages,
    combatDiscipline: {
      earnedPoints: Math.max(existingPoints, grantedStages.length),
      grantedStages,
      ownedNodeIds
    }
  };
}

function normalizeNonCombatSkill(value: unknown, fallbackId: string): NonCombatSkillRuntimeState {
  const source = isRecord(value) ? value : {};
  const level = integerInRange(source.level ?? source.lvl, 1, 100, 1);
  const xp = finiteNonNegative(source.xp);
  const nextXp = Math.max(1, finiteNonNegative(source.nextXp ?? source.next, xpToNextCombatLevel(level)) || xpToNextCombatLevel(level));
  return {
    id: typeof source.id === 'string' ? source.id : fallbackId,
    active: Boolean(source.active),
    actionsPerSecond: finiteNonNegative(source.actionsPerSecond ?? source.basePerSec),
    xpPerAction: finiteNonNegative(source.xpPerAction, 20),
    level,
    xp,
    nextXp,
    progress: finiteNonNegative(source.progress),
    quantity: finiteNonNegative(source.quantity ?? source.qty)
  };
}

function normalizeRarityCounts(value: unknown): Record<RarityId, number> {
  const source = isRecord(value) ? value : {};
  return Object.fromEntries(RARITY_IDS.map(id => [id, finiteNonNegative(source[id])])) as Record<RarityId, number>;
}

function normalizeLootCache(value: unknown, fallback?: Partial<LootCacheState>): LootCacheState {
  if (isRecord(value)) {
    return createLootCache({
      items: Array.isArray(value.items) ? value.items.filter(item => inspectItem(item as ItemInstance) !== null) as ItemInstance[] : fallback?.items,
      equipment: isRecord(value.equipment) ? value.equipment as unknown as LootCacheState['equipment'] : fallback?.equipment,
      foodId: typeof value.foodId === 'string' ? value.foodId : fallback?.foodId,
      favoriteIds: Array.isArray(value.favoriteIds) ? value.favoriteIds.filter((id): id is string => typeof id === 'string') : fallback?.favoriteIds,
      filters: isRecord(value.filters) ? value.filters as unknown as LootFilters : fallback?.filters
    });
  }
  return createLootCache(fallback || {});
}

export function normalizeSoloFrontierState(value: unknown, now = Date.now()): SoloFrontierRuntimeState {
  const source = isRecord(value) ? value : {};
  const highestClearedStage = integerInRange(source.highestClearedStage, 0, SOLO_FRONTIER_STAGE_COUNT, 0);
  const clearedStages = contiguousStages(highestClearedStage);
  const validFirstClears = normalizeStageList(source.firstClearStages).filter(stage => stage <= highestClearedStage);
  const stageVictoriesSource = isRecord(source.stageVictories) ? source.stageVictories : {};
  const persistedCurrentStage = integerInRange(source.currentStage, 1, SOLO_FRONTIER_STAGE_COUNT, 0);
  const stageVictoryKeys = [...new Set([...clearedStages, ...(persistedCurrentStage ? [persistedCurrentStage] : [])])];
  const stageVictories = Object.fromEntries(stageVictoryKeys.map(stage => [String(stage), finiteNonNegative(stageVictoriesSource[String(stage)])])) as Record<string, number>;
  const rawDiscipline = isRecord(source.combatDiscipline) ? source.combatDiscipline : {};
  const grantedStages = normalizeStageList(rawDiscipline.grantedStages).filter(stage => SOLO_FRONTIER_POINT_STAGES.includes(stage));
  const combatDiscipline: CombatDisciplineState = {
    earnedPoints: Math.max(integerInRange(rawDiscipline.earnedPoints, 0, 100, 0), grantedStages.length),
    grantedStages,
    ownedNodeIds: Array.isArray(rawDiscipline.ownedNodeIds) ? [...new Set(rawDiscipline.ownedNodeIds.filter((id): id is string => typeof id === 'string'))] : []
  };
  const rawFarmStage = integerInRange(source.farmStage, 1, SOLO_FRONTIER_STAGE_COUNT, 0);
  const rawCurrentStage = persistedCurrentStage;
  const configuredFallbackStage = integerInRange(source.configuredFallbackStage ?? source.fallbackStage, 1, SOLO_FRONTIER_STAGE_COUNT, 0);
  const order: SoloFrontierOrder = source.order === 'push' || source.order === 'farm' ? source.order : 'paused';
  const farmStage = order === 'farm'
    ? (rawFarmStage > 0 && rawFarmStage <= highestClearedStage ? rawFarmStage : highestClearedStage || null)
    : (rawFarmStage > 0 && rawFarmStage <= highestClearedStage ? rawFarmStage : null);
  const currentStage = rawCurrentStage > 0 ? rawCurrentStage : order === 'push' && highestClearedStage < SOLO_FRONTIER_STAGE_COUNT ? highestClearedStage + 1 : farmStage;
  const nonCombatSource = isRecord(source.nonCombatSkills) ? source.nonCombatSkills : {};
  const nonCombatSkills = Object.fromEntries(Object.entries(nonCombatSource).map(([id, skill]) => [id, normalizeNonCombatSkill(skill, id)]));
  const cache = normalizeLootCache(source.lootCache);
  const combatProgression = normalizeCombatProgression(source.combatProgression);
  return {
    version: SOLO_FRONTIER_SAVE_VERSION,
    order: highestClearedStage >= SOLO_FRONTIER_STAGE_COUNT && order === 'push' ? 'farm' : order,
    configuredFallbackStage: configuredFallbackStage || null,
    farmStage,
    currentStage: currentStage && currentStage <= SOLO_FRONTIER_STAGE_COUNT ? currentStage : null,
    currentStageVictories: finiteNonNegative(source.currentStageVictories),
    encounterElapsedMs: finiteNonNegative(source.encounterElapsedMs),
    encounterSequence: Math.floor(finiteNonNegative(source.encounterSequence)),
    highestClearedStage,
    clearedStages,
    firstClearStages: validFirstClears,
    stageVictories,
    wall: isRecord(source.wall) ? source.wall as unknown as SoloFrontierWallReport : null,
    wallReports: Array.isArray(source.wallReports) ? source.wallReports.filter(isRecord) as unknown as SoloFrontierWallReport[] : [],
    totalVictories: finiteNonNegative(source.totalVictories),
    totalDeaths: finiteNonNegative(source.totalDeaths),
    keys: finiteNonNegative(source.keys),
    combatProgression,
    combatDiscipline,
    combatDevelopment: normalizeCombatDevelopmentState(source.combatDevelopment, combatProgression),
    frontierExchange: normalizeFrontierExchangeState(source.frontierExchange),
    lootCache: cache,
    collectionProgress: isRecord(source.collectionProgress) ? Object.fromEntries(Object.entries(source.collectionProgress).map(([id, amount]) => [id, finiteNonNegative(amount)])) : {},
    nonCombatSkills,
    debrief: isRecord(source.debrief) ? normalizeDebrief(source.debrief, order, combatProgression) : null,
    seed: canonicalSeed(source.seed),
    lastUpdatedAt: finiteNonNegative(source.lastUpdatedAt, now) || now
  };
}

export function createInitialSoloFrontierState(options: Partial<SoloFrontierRuntimeState> = {}): SoloFrontierRuntimeState {
  const initial = normalizeSoloFrontierState({
    version: SOLO_FRONTIER_SAVE_VERSION,
    order: 'paused',
    currentStage: null,
    farmStage: null,
    highestClearedStage: 0,
    clearedStages: [],
    firstClearStages: [],
    stageVictories: {},
    combatProgression: createInitialCombatProgression(),
    combatDiscipline: { earnedPoints: 0, grantedStages: [], ownedNodeIds: [] },
    combatDevelopment: createCombatDevelopmentState(),
    frontierExchange: createFrontierExchangeState(),
    lootCache: createLootCache(),
    nonCombatSkills: {},
    ...options
  }, options.lastUpdatedAt || Date.now());
  return initial;
}

function defaultCombatInput(stage: number, seed: string): SoloCombatInput {
  const enemy = soloFrontierStage(stage).enemy;
  const skills = Object.fromEntries(COMBAT_SKILL_IDS.map(skillId => [skillId, 1]));
  return {
    combatSkills: skills,
    equippedStats: { hitPoints: 0, accuracy: 0, evasion: 0, ward: 0, armourPieces: [] },
    activeWeapon: { id: 'starter-gun', name: 'Starter Gun', style: 'gun', damage: 10, accuracy: 0, attackInterval: 1 },
    stance: 'Balanced',
    technique: 'Burst Fire',
    defensiveAbility: 'none',
    aura: 'none',
    enemy,
    stage,
    seed
  } as unknown as SoloCombatInput;
}

function inputForEncounter(options: SoloFrontierSimulationOptions, stage: number, seed: string, state: SoloFrontierRuntimeState): SoloCombatInput {
  const configured = typeof options.combatInput === 'function'
    ? options.combatInput(stage, seed, state)
    : options.combatInput || defaultCombatInput(stage, seed);
  return {
    ...configured,
    stage,
    seed,
    combatModifiers: resolveCombatModifierSnapshot(state.combatDevelopment, state.combatProgression, {
      style: configured.activeWeapon.style,
      technique: configured.technique,
      stance: configured.stance,
      aura: configured.aura,
      defensiveAbility: configured.defensiveAbility,
      boss: (options.useConfiguredEnemy ? configured.enemy : soloFrontierStage(stage).enemy).kind === 'boss',
      enemyWarded: (options.useConfiguredEnemy ? configured.enemy : soloFrontierStage(stage).enemy).ward > 0,
      playerHealthRatio: 1,
      enemyHealthRatio: 1,
      baseInterval: configured.activeWeapon.attackInterval
    }),
    enemy: options.useConfiguredEnemy ? configured.enemy : soloFrontierStage(stage).enemy
  };
}

function applyGenericSkillXp(skill: NonCombatSkillRuntimeState, amount: number): NonCombatSkillRuntimeState {
  let level = integerInRange(skill.level, 1, 100, 1);
  let xp = finiteNonNegative(skill.xp) + finiteNonNegative(amount);
  while (level < 100) {
    const required = xpToNextCombatLevel(level);
    if (xp < required) break;
    xp -= required;
    level += 1;
  }
  return { ...skill, level, xp: level >= 100 ? 0 : xp, nextXp: xpToNextCombatLevel(level) };
}

function advanceNonCombatSkills(state: SoloFrontierRuntimeState, elapsedMs: number): SoloFrontierRuntimeState {
  if (elapsedMs <= 0) return state;
  const seconds = elapsedMs / 1_000;
  const next = Object.fromEntries(Object.entries(state.nonCombatSkills).map(([id, source]) => {
    const skill = normalizeNonCombatSkill(source, id);
    if (!skill.active || skill.actionsPerSecond <= 0) return [id, skill];
    const totalProgress = skill.progress + skill.actionsPerSecond * seconds;
    const actions = Math.floor(totalProgress);
    let progressed = { ...skill, progress: totalProgress - actions };
    for (let action = 0; action < actions; action += 1) {
      progressed = applyGenericSkillXp({ ...progressed, quantity: progressed.quantity + 1 }, progressed.xpPerAction);
    }
    return [id, progressed];
  })) as Record<string, NonCombatSkillRuntimeState>;
  return { ...state, nonCombatSkills: next };
}

function emptySkillXp(): Record<CombatSkillId, number> {
  return Object.fromEntries(COMBAT_SKILL_IDS.map(skillId => [skillId, 0])) as Record<CombatSkillId, number>;
}

function emptyRarityCounts(): Record<RarityId, number> {
  return Object.fromEntries(RARITY_IDS.map(rarity => [rarity, 0])) as Record<RarityId, number>;
}

function emptyHealingBySource(): Record<CombatRecoverySource, number> {
  return Object.fromEntries(COMBAT_RECOVERY_SOURCES.map(source => [source, 0])) as Record<CombatRecoverySource, number>;
}

function emptySustainDebrief(): SoloFrontierSustainDebrief {
  return {
    healing: 0,
    overhealing: 0,
    healingBySource: emptyHealingBySource(),
    mendCasts: 0,
    reserveStored: 0,
    reserveReleased: 0,
    damageRecovered: 0,
    damagePrevented: 0,
    cooldownRemovedMs: 0,
    emergencyTriggers: 0,
    fatalGuards: 0,
    minimumHealthRatio: 1,
    timeBelowHalfMs: 0
  };
}

function createDebrief(order: SoloFrontierOrder): SoloFrontierDebrief {
  return {
    elapsedMs: 0,
    priorOrder: order,
    finalOrder: order,
    wall: null,
    victories: 0,
    deaths: 0,
    skillXp: emptySkillXp(),
    skillLevels: combatSkillLevels(createInitialCombatProgression()),
    keys: 0,
    gold: 0,
    goldBySource: {},
    contractProgressMs: 0,
    keptDrops: [],
    keptDropCount: 0,
    filterSalvage: 0,
    fullCacheSalvage: 0,
    rarityCounts: emptyRarityCounts(),
    strongestKeptDrops: [],
    sustain: emptySustainDebrief()
  };
}

function normalizeDebrief(value: unknown, order: SoloFrontierOrder, progression: CombatProgressionState): SoloFrontierDebrief {
  const source = isRecord(value) ? value : {};
  const fallback = createDebrief(order);
  const sourceSkillXp = isRecord(source.skillXp) ? source.skillXp : {};
  const sourceSustain = isRecord(source.sustain) ? source.sustain : {};
  const sourceHealingBySource = isRecord(sourceSustain.healingBySource) ? sourceSustain.healingBySource : {};
  return {
    ...fallback,
    ...source,
    elapsedMs: finiteNonNegative(source.elapsedMs),
    priorOrder: source.priorOrder === 'push' || source.priorOrder === 'farm' ? source.priorOrder : order,
    finalOrder: source.finalOrder === 'push' || source.finalOrder === 'farm' ? source.finalOrder : order,
    victories: finiteNonNegative(source.victories),
    deaths: finiteNonNegative(source.deaths),
    skillXp: Object.fromEntries(COMBAT_SKILL_IDS.map(skillId => [skillId, finiteNonNegative(sourceSkillXp[skillId])])) as Record<CombatSkillId, number>,
    skillLevels: combatSkillLevels(progression),
    keys: finiteNonNegative(source.keys),
    gold: finiteNonNegative(source.gold),
    goldBySource: isRecord(source.goldBySource)
      ? Object.fromEntries(Object.entries(source.goldBySource).map(([sourceId, amount]) => [sourceId, finiteNonNegative(amount)]))
      : {},
    contractProgressMs: finiteNonNegative(source.contractProgressMs),
    keptDrops: validItemInstances(source.keptDrops),
    keptDropCount: finiteNonNegative(source.keptDropCount),
    filterSalvage: finiteNonNegative(source.filterSalvage),
    fullCacheSalvage: finiteNonNegative(source.fullCacheSalvage),
    rarityCounts: normalizeRarityCounts(source.rarityCounts),
    strongestKeptDrops: Array.isArray(source.strongestKeptDrops)
      ? source.strongestKeptDrops.filter(isRecord) as unknown as StrongestKeptDrop[]
      : [],
    sustain: {
      healing: finiteNonNegative(sourceSustain.healing),
      overhealing: finiteNonNegative(sourceSustain.overhealing),
      healingBySource: Object.fromEntries(COMBAT_RECOVERY_SOURCES.map(recoverySource => [
        recoverySource,
        finiteNonNegative(sourceHealingBySource[recoverySource])
      ])) as Record<CombatRecoverySource, number>,
      mendCasts: finiteNonNegative(sourceSustain.mendCasts),
      reserveStored: finiteNonNegative(sourceSustain.reserveStored),
      reserveReleased: finiteNonNegative(sourceSustain.reserveReleased),
      damageRecovered: finiteNonNegative(sourceSustain.damageRecovered),
      damagePrevented: finiteNonNegative(sourceSustain.damagePrevented),
      cooldownRemovedMs: finiteNonNegative(sourceSustain.cooldownRemovedMs),
      emergencyTriggers: finiteNonNegative(sourceSustain.emergencyTriggers),
      fatalGuards: finiteNonNegative(sourceSustain.fatalGuards),
      minimumHealthRatio: Math.min(1, finiteNonNegative(sourceSustain.minimumHealthRatio, 1)),
      timeBelowHalfMs: finiteNonNegative(sourceSustain.timeBelowHalfMs)
    }
  } as SoloFrontierDebrief;
}

function dropScore(item: ItemInstance): number {
  const inspection = inspectItem(item, COMBAT_LOOT_DEFINITIONS);
  if (!inspection) return 0;
  const stats = Object.values(inspection.stats).reduce((sum, value) => sum + Math.max(0, Number(value) || 0), 0);
  return round(item.itemLevel * inspection.rarity.statMultiplier + stats);
}

function withDebrief(state: SoloFrontierRuntimeState, debrief: SoloFrontierDebrief): SoloFrontierRuntimeState {
  const strongestKeptDrops = [...debrief.keptDrops]
    .map(item => ({ instanceId: item.instanceId, definitionId: item.definitionId, rarity: item.rarity, itemLevel: item.itemLevel, score: dropScore(item) }))
    .sort((left, right) => right.score - left.score || right.itemLevel - left.itemLevel || left.instanceId.localeCompare(right.instanceId))
    .slice(0, 3);
  return { ...state, debrief: { ...debrief, finalOrder: state.order, skillLevels: combatSkillLevels(state.combatProgression), strongestKeptDrops } };
}

function addLootToDebrief(
  state: SoloFrontierRuntimeState,
  debrief: SoloFrontierDebrief,
  stage: number,
  firstClear: boolean,
  seed: string,
  atMs: number
): { state: SoloFrontierRuntimeState; debrief: SoloFrontierDebrief } {
  const boss = SOLO_FRONTIER_BOSS_STAGES.includes(stage);
  const itemChance = boss
    ? (firstClear ? SOLO_FRONTIER_LOOT_CHANCE.firstBoss : SOLO_FRONTIER_LOOT_CHANCE.repeatBoss)
    : stage <= SOLO_FRONTIER_LOOT_CHANCE.onboardingThroughStage
      ? SOLO_FRONTIER_LOOT_CHANCE.onboardingRegular
      : SOLO_FRONTIER_LOOT_CHANCE.regular;
  // Kept local to the encounter seed so online and offline consume exactly
  // the same reward sequence regardless of wall-clock timing.
  const resolution = rollLoot({
    sourceType: 'soloFrontier',
    sourceId: `solo-frontier:stage-${stage}`,
    sourceTier: Math.ceil(stage / 10),
    playerLevel: Math.max(1, Math.round(combatSkillLevels(state.combatProgression).Strength)),
    runId: `${state.seed}:${state.encounterSequence}`,
    itemChance,
    minimumRarity: firstClear && boss ? 'rare' : undefined,
    targetSlots: state.frontierExchange.activeContract
      ? [state.frontierExchange.activeContract.category]
      : soloFrontierStage(stage).advertisedTargetSlots,
    targetSlotWeight: state.frontierExchange.activeContract ? 0.70 : 0.60,
    now: atMs
  }, soloFrontierRandom(`${seed}:loot`));

  let nextState = {
    ...state,
    collectionProgress: updateCollectionProgress(state.collectionProgress, resolution),
    lootCache: state.lootCache
  };
  const nextRarityCounts = { ...debrief.rarityCounts };
  if (resolution.rarity) nextRarityCounts[resolution.rarity] += 1;
  let nextDebrief = { ...debrief, rarityCounts: nextRarityCounts };
  if (resolution.item) {
    const mutation = insertLoot(state.lootCache, resolution.item);
    nextState = { ...nextState, lootCache: mutation.cache };
    if (mutation.accepted) {
      nextDebrief = {
        ...nextDebrief,
        keptDrops: [...nextDebrief.keptDrops, mutation.item!],
        keptDropCount: nextDebrief.keptDropCount + 1
      };
    } else if (mutation.reason.startsWith('Drop rejected by loot filters')) {
      nextDebrief = { ...nextDebrief, filterSalvage: nextDebrief.filterSalvage + mutation.salvage };
    } else if (mutation.salvaged) {
      nextDebrief = { ...nextDebrief, fullCacheSalvage: nextDebrief.fullCacheSalvage + mutation.salvage };
    }
  }
  return { state: nextState, debrief: nextDebrief };
}

function addKeysForVictory(
  state: SoloFrontierRuntimeState,
  debrief: SoloFrontierDebrief,
  stage: number,
  seed: string
): { state: SoloFrontierRuntimeState; debrief: SoloFrontierDebrief } {
  const random = soloFrontierRandom(`${seed}:keys`);
  const bossReward = SOLO_FRONTIER_BOSS_KEY_REWARDS[stage];
  const amount = bossReward || (random() < 0.05 ? 1 : 0);
  if (!amount) return { state, debrief };
  return {
    state: { ...state, keys: state.keys + amount },
    debrief: { ...debrief, keys: debrief.keys + amount }
  };
}

function resolveFallbackStage(state: SoloFrontierRuntimeState): number | null {
  const configured = state.configuredFallbackStage;
  if (configured && configured >= 1 && configured <= state.highestClearedStage) return configured;
  return state.highestClearedStage || null;
}

function ensureActiveStage(state: SoloFrontierRuntimeState): SoloFrontierRuntimeState {
  if (state.order === 'paused') return state;
  if (state.order === 'push') {
    if (state.highestClearedStage >= SOLO_FRONTIER_STAGE_COUNT) {
      return { ...state, order: 'farm', farmStage: SOLO_FRONTIER_STAGE_COUNT, currentStage: SOLO_FRONTIER_STAGE_COUNT, currentStageVictories: 0 };
    }
    return { ...state, currentStage: state.currentStage || state.highestClearedStage + 1 };
  }
  const farmStage = state.farmStage && state.farmStage <= state.highestClearedStage ? state.farmStage : state.highestClearedStage || null;
  return { ...state, farmStage, currentStage: state.currentStage || farmStage };
}

function copyDebrief(debrief: SoloFrontierDebrief): SoloFrontierDebrief {
  return {
    ...debrief,
    skillXp: { ...debrief.skillXp },
    skillLevels: { ...debrief.skillLevels },
    goldBySource: { ...debrief.goldBySource },
    keptDrops: [...debrief.keptDrops],
    rarityCounts: { ...debrief.rarityCounts },
    strongestKeptDrops: [...debrief.strongestKeptDrops],
    sustain: {
      ...debrief.sustain,
      healingBySource: { ...debrief.sustain.healingBySource }
    }
  };
}

function addCombatXpToDebrief(debrief: SoloFrontierDebrief, xpBySkill: Record<CombatSkillId, number>): SoloFrontierDebrief {
  const skillXp = { ...debrief.skillXp };
  COMBAT_SKILL_IDS.forEach(skillId => { skillXp[skillId] += finiteNonNegative(xpBySkill[skillId]); });
  return { ...debrief, skillXp };
}

function addSustainToDebrief(
  debrief: SoloFrontierDebrief,
  sustain: SoloCombatResult['metrics']['sustain']
): SoloFrontierDebrief {
  const healingBySource = { ...debrief.sustain.healingBySource };
  COMBAT_RECOVERY_SOURCES.forEach(source => {
    healingBySource[source] += finiteNonNegative(sustain.healingBySource[source]);
  });
  return {
    ...debrief,
    sustain: {
      healing: debrief.sustain.healing + finiteNonNegative(sustain.healing),
      overhealing: debrief.sustain.overhealing + finiteNonNegative(sustain.overhealing),
      healingBySource,
      mendCasts: debrief.sustain.mendCasts + finiteNonNegative(sustain.mendCasts),
      reserveStored: debrief.sustain.reserveStored + finiteNonNegative(sustain.reserveStored),
      reserveReleased: debrief.sustain.reserveReleased + finiteNonNegative(sustain.reserveReleased),
      damageRecovered: debrief.sustain.damageRecovered + finiteNonNegative(sustain.damageRecovered),
      damagePrevented: debrief.sustain.damagePrevented + finiteNonNegative(sustain.damagePrevented),
      cooldownRemovedMs: debrief.sustain.cooldownRemovedMs + finiteNonNegative(sustain.cooldownRemovedMs),
      emergencyTriggers: debrief.sustain.emergencyTriggers + finiteNonNegative(sustain.emergencyTriggers),
      fatalGuards: debrief.sustain.fatalGuards + finiteNonNegative(sustain.fatalGuards),
      minimumHealthRatio: Math.min(debrief.sustain.minimumHealthRatio, finiteNonNegative(sustain.minimumHealthRatio, 1)),
      timeBelowHalfMs: debrief.sustain.timeBelowHalfMs + finiteNonNegative(sustain.timeBelowHalfMs)
    }
  };
}

function addGoldToDebrief(debrief: SoloFrontierDebrief, source: FrontierLedgerSource, amount: number): SoloFrontierDebrief {
  if (!amount) return debrief;
  return {
    ...debrief,
    gold: debrief.gold + amount,
    goldBySource: { ...debrief.goldBySource, [source]: finiteNonNegative(debrief.goldBySource[source]) + amount }
  };
}

function completeStage(
  state: SoloFrontierRuntimeState,
  stage: number,
  debrief: SoloFrontierDebrief
): { state: SoloFrontierRuntimeState; debrief: SoloFrontierDebrief; firstClear: boolean } {
  const firstClear = !state.firstClearStages.includes(stage);
  const firstClearStages = firstClear ? [...state.firstClearStages, stage].sort((left, right) => left - right) : [...state.firstClearStages];
  const highestClearedStage = Math.max(state.highestClearedStage, stage);
  const clearedStages = contiguousStages(highestClearedStage);
  let combatDiscipline = state.combatDiscipline;
  if (firstClear && SOLO_FRONTIER_POINT_STAGES.includes(stage) && !combatDiscipline.grantedStages.includes(stage)) {
    combatDiscipline = {
      ...combatDiscipline,
      earnedPoints: combatDiscipline.earnedPoints + 1,
      grantedStages: [...combatDiscipline.grantedStages, stage].sort((left, right) => left - right)
    };
  }
  let nextState: SoloFrontierRuntimeState = {
    ...state,
    highestClearedStage,
    clearedStages,
    firstClearStages,
    combatDiscipline,
    currentStageVictories: 0,
    stageVictories: { ...state.stageVictories, [String(stage)]: 0 }
  };
  if (state.order === 'push') {
    if (stage >= SOLO_FRONTIER_STAGE_COUNT) {
      nextState = { ...nextState, order: 'farm', farmStage: SOLO_FRONTIER_STAGE_COUNT, currentStage: SOLO_FRONTIER_STAGE_COUNT };
    } else {
      nextState = { ...nextState, currentStage: stage + 1 };
    }
  } else {
    nextState = { ...nextState, farmStage: stage, currentStage: stage };
  }
  return { state: nextState, debrief, firstClear };
}

function wallState(
  state: SoloFrontierRuntimeState,
  stage: number,
  result: SoloCombatResult,
  atMs: number
): { state: SoloFrontierRuntimeState; report: SoloFrontierWallReport } {
  const fallbackStage = resolveFallbackStage(state);
  const report: SoloFrontierWallReport = {
    stage,
    order: state.order === 'push' ? 'push' : 'farm',
    termination: result.termination === 'timeout' ? 'timeout' : 'player-defeated',
    reason: result.metrics.defeatReason || result.termination,
    atMs,
    fallbackStage
  };
  const nextState: SoloFrontierRuntimeState = {
    ...state,
    order: 'farm',
    farmStage: fallbackStage,
    currentStage: fallbackStage,
    currentStageVictories: 0,
    stageVictories: fallbackStage ? { ...state.stageVictories, [String(fallbackStage)]: 0 } : state.stageVictories,
    wall: report,
    wallReports: [...state.wallReports, report]
  };
  return { state: nextState, report };
}

function applyEncounter(
  state: SoloFrontierRuntimeState,
  debrief: SoloFrontierDebrief,
  stage: number,
  result: SoloCombatResult,
  atMs: number,
  seed: string,
  encounterDurationMs: number
): { state: SoloFrontierRuntimeState; debrief: SoloFrontierDebrief; firstClear: boolean } {
  const progression = applyCombatEncounterProgression(
    state.combatProgression,
    result.skillEvents,
    result.outcome === 'victory'
      ? { outcome: 'victory', stage }
      : { outcome: 'defeat', stage, enemyHealthRemovedPercent: result.enemyHealthRemovedPercent }
  );
  let nextState: SoloFrontierRuntimeState = {
    ...state,
    combatProgression: progression.progression,
    encounterSequence: state.encounterSequence + 1,
    currentStageVictories: state.currentStageVictories,
    totalVictories: state.totalVictories + (result.outcome === 'victory' ? 1 : 0),
    totalDeaths: state.totalDeaths + (result.outcome === 'defeat' ? 1 : 0)
  };
  let nextDebrief = addSustainToDebrief(
    addCombatXpToDebrief(debrief, progression.xpBySkill),
    result.metrics.sustain
  );
  let firstClear = false;
  if (result.outcome === 'defeat') {
    const wall = wallState(nextState, stage, result, atMs);
    nextState = wall.state;
    nextDebrief = { ...nextDebrief, deaths: nextDebrief.deaths + 1, wall: wall.report };
    return { state: nextState, debrief: nextDebrief, firstClear };
  }

  nextDebrief = { ...nextDebrief, victories: nextDebrief.victories + 1 };
  const nextStageVictories = finiteNonNegative(state.stageVictories[String(stage)]) + 1;
  nextState = {
    ...nextState,
    currentStageVictories: nextStageVictories,
    stageVictories: { ...state.stageVictories, [String(stage)]: nextStageVictories }
  };
  const stageDefinition = soloFrontierStage(stage);
  if (nextStageVictories >= stageDefinition.victoriesToClear) {
    const completed = completeStage(nextState, stage, nextDebrief);
    nextState = completed.state;
    firstClear = completed.firstClear;
  }
  // Regular victories roll independently, including the nine victories before
  // a regular stage is cleared. Boss first-clear status is known only after
  // the one required boss victory completes the stage.
  const loot = addLootToDebrief(nextState, nextDebrief, stage, firstClear, seed, atMs);
  nextState = loot.state;
  nextDebrief = loot.debrief;
  const keys = addKeysForVictory(nextState, nextDebrief, stage, seed);
  nextState = keys.state;
  nextDebrief = keys.debrief;
  const timedGold = awardFrontierGold(
    nextState.frontierExchange,
    (1 + 0.1 * stage) * encounterDurationMs / 60_000,
    'solo-time'
  );
  nextState = { ...nextState, frontierExchange: timedGold.exchange };
  nextDebrief = addGoldToDebrief(nextDebrief, 'solo-time', timedGold.wholeGold);
  const bossGold = firstClear ? (SOLO_FRONTIER_BOSS_GOLD_REWARDS[stage] || 0) : 0;
  if (bossGold) {
    const firstClearGold = awardFrontierGold(nextState.frontierExchange, bossGold, 'boss-first-clear');
    nextState = { ...nextState, frontierExchange: firstClearGold.exchange };
    nextDebrief = addGoldToDebrief(nextDebrief, 'boss-first-clear', firstClearGold.wholeGold);
  }
  if (nextState.frontierExchange.activeContract) {
    nextState = {
      ...nextState,
      frontierExchange: advanceTargetContract(nextState.frontierExchange, encounterDurationMs, seed, atMs)
    };
    nextDebrief = { ...nextDebrief, contractProgressMs: nextDebrief.contractProgressMs + encounterDurationMs };
  }
  return { state: nextState, debrief: nextDebrief, firstClear };
}

/** Advances online time and offline time through the same encounter loop. */
export function advanceSoloFrontier(
  initialState: SoloFrontierRuntimeState,
  elapsedMs: number,
  options: SoloFrontierSimulationOptions = {}
): SoloFrontierAdvanceResult {
  let state = normalizeSoloFrontierState(initialState);
  const requestedMs = finiteNonNegative(elapsedMs);
  let debrief = options.resetDebrief === false && state.debrief ? copyDebrief(state.debrief) : createDebrief(state.order);
  let remainingMs = requestedMs;
  let processedMs = 0;
  let encounterCount = 0;
  const maxEncounters = options.maxEncounters === undefined ? Number.POSITIVE_INFINITY : Math.max(0, Math.floor(options.maxEncounters));
  const events: SoloFrontierEncounterEvent[] = [];
  const resultCache = new Map<string, SoloCombatResult>();

  const consumeTime = (amount: number): void => {
    if (amount <= 0) return;
    state = advanceNonCombatSkills(state, amount);
    const drilledSkillId = state.combatDevelopment.drill.skillId;
    const drill = advanceCombatDrill(state.combatDevelopment, state.combatProgression, amount);
    state = { ...state, combatDevelopment: drill.state, combatProgression: drill.progression };
    if (drill.xpAwarded && drilledSkillId) {
      const skillXp = { ...debrief.skillXp };
      skillXp[drilledSkillId] += drill.xpAwarded;
      debrief = { ...debrief, skillXp };
    }
    processedMs += amount;
    remainingMs -= amount;
    debrief.elapsedMs += amount;
  };

  while (remainingMs > 0) {
    if (state.order === 'paused' || encounterCount >= maxEncounters) {
      if (encounterCount >= maxEncounters) break;
      consumeTime(remainingMs);
      break;
    }
    state = ensureActiveStage(state);
    const stage = state.currentStage;
    if (!stage || stage < 1 || stage > SOLO_FRONTIER_STAGE_COUNT) {
      consumeTime(remainingMs);
      break;
    }
    const encounterSeed = `${state.seed}:encounter:${state.encounterSequence}:stage:${stage}:victory:${state.currentStageVictories}`;
    let combat = resultCache.get(encounterSeed);
    if (!combat) {
      combat = simulateSoloCombat(inputForEncounter(options, stage, encounterSeed, state));
      resultCache.set(encounterSeed, combat);
    }
    const encounterDurationMs = Math.max(1, Math.round((combat.metrics.durationSeconds + SOLO_FRONTIER_ENCOUNTER_RECOVERY_SECONDS) * 1_000));
    const availableMs = state.encounterElapsedMs + remainingMs;
    if (availableMs < encounterDurationMs) {
      state = { ...state, encounterElapsedMs: availableMs };
      consumeTime(remainingMs);
      break;
    }
    const timeToCompletion = Math.max(0, encounterDurationMs - state.encounterElapsedMs);
    consumeTime(timeToCompletion);
    state = { ...state, encounterElapsedMs: 0 };
    const orderBefore = state.order;
    const outcome = applyEncounter(state, debrief, stage, combat, state.lastUpdatedAt + processedMs, encounterSeed, encounterDurationMs);
    state = outcome.state;
    debrief = outcome.debrief;
    events.push({
      type: 'solo-frontier-encounter',
      sequence: state.encounterSequence - 1,
      stage,
      outcome: combat.outcome,
      termination: combat.termination,
      durationMs: encounterDurationMs,
      firstClear: outcome.firstClear,
      orderBefore
    });
    encounterCount += 1;
  }

  state = { ...state, lastUpdatedAt: state.lastUpdatedAt + processedMs };
  state = withDebrief(state, debrief);
  return { state, debrief: state.debrief!, elapsedMs: processedMs, remainingMs: Math.max(0, remainingMs), events };
}

/**
 * Event-driven catch-up. It yields after bounded encounter batches, while
 * preserving the same state and deterministic seeds used by online advance.
 */
export async function catchUpSoloFrontier(
  initialState: SoloFrontierRuntimeState,
  elapsedSeconds: number,
  options: SoloFrontierSimulationOptions & { batchEncounters?: number } = {}
): Promise<SoloFrontierCatchUpResult> {
  const rawSeconds = finiteNonNegative(elapsedSeconds);
  const capSeconds = options.offlineCapSeconds ?? SOLO_FRONTIER_OFFLINE_CAP_SECONDS;
  const cappedSeconds = Math.min(rawSeconds, Math.max(0, capSeconds));
  const capped = rawSeconds > cappedSeconds;
  const batchEncounters = Math.max(1, Math.floor(options.batchEncounters || SOLO_FRONTIER_BATCH_ENCOUNTERS));
  let state = normalizeSoloFrontierState(initialState);
  let remainingMs = cappedSeconds * 1_000;
  let totalElapsedMs = 0;
  let batches = 0;
  let events: SoloFrontierEncounterEvent[] = [];
  let last: SoloFrontierAdvanceResult = {
    state,
    debrief: state.debrief || createDebrief(state.order),
    elapsedMs: 0,
    remainingMs,
    events: []
  };
  while (remainingMs > 0) {
    last = advanceSoloFrontier(state, remainingMs, {
      ...options,
      maxEncounters: batchEncounters,
      resetDebrief: batches === 0
    });
    state = last.state;
    remainingMs = last.remainingMs;
    totalElapsedMs += last.elapsedMs;
    events = [...events, ...last.events];
    batches += 1;
    if (!last.elapsedMs && !last.events.length) break;
    if (remainingMs > 0) {
      await new Promise<void>(resolve => setTimeout(resolve, SOLO_FRONTIER_BATCH_YIELD_MS));
    }
  }
  return {
    state,
    debrief: state.debrief || last.debrief,
    elapsedMs: totalElapsedMs,
    remainingMs,
    events,
    capped,
    batches
  };
}

export function setSoloFrontierOrder(
  initialState: SoloFrontierRuntimeState,
  order: SoloFrontierOrder,
  selectedFarmStage?: number | null
): SoloFrontierRuntimeState {
  const state = normalizeSoloFrontierState(initialState);
  if (order === 'paused') return { ...state, order, currentStage: null, encounterElapsedMs: 0 };
  if (order === 'push') {
    if (state.highestClearedStage >= SOLO_FRONTIER_STAGE_COUNT) return { ...state, order: 'farm', farmStage: SOLO_FRONTIER_STAGE_COUNT, currentStage: SOLO_FRONTIER_STAGE_COUNT, currentStageVictories: 0 };
    return { ...state, order, currentStage: state.highestClearedStage + 1, currentStageVictories: 0, encounterElapsedMs: 0 };
  }
  const farmStage = selectedFarmStage && selectedFarmStage >= 1 && selectedFarmStage <= state.highestClearedStage
    ? Math.floor(selectedFarmStage)
    : state.highestClearedStage || null;
  return { ...state, order, farmStage, currentStage: farmStage, currentStageVictories: 0, encounterElapsedMs: 0 };
}

export function setSoloFrontierFallback(initialState: SoloFrontierRuntimeState, fallbackStage: number | null): SoloFrontierRuntimeState {
  const state = normalizeSoloFrontierState(initialState);
  const normalized = fallbackStage && fallbackStage >= 1 && fallbackStage <= SOLO_FRONTIER_STAGE_COUNT ? Math.floor(fallbackStage) : null;
  return { ...state, configuredFallbackStage: normalized };
}

export function setSoloFrontierFarmStage(initialState: SoloFrontierRuntimeState, farmStage: number): SoloFrontierRuntimeState {
  const state = normalizeSoloFrontierState(initialState);
  if (farmStage < 1 || farmStage > state.highestClearedStage) return state;
  return { ...state, farmStage: Math.floor(farmStage), currentStage: Math.floor(farmStage), currentStageVictories: 0, encounterElapsedMs: 0 };
}

export function createSoloFrontierRuntime(
  initialState: SoloFrontierRuntimeState = createInitialSoloFrontierState(),
  options: SoloFrontierSimulationOptions = {}
) {
  let state = normalizeSoloFrontierState(initialState);
  const runtimeOptions = { ...options };
  return Object.freeze({
    getState(): SoloFrontierRuntimeState { return state; },
    setOrder(order: SoloFrontierOrder, farmStage?: number | null): SoloFrontierRuntimeState {
      state = setSoloFrontierOrder(state, order, farmStage);
      return state;
    },
    setFallbackStage(fallbackStage: number | null): SoloFrontierRuntimeState {
      state = setSoloFrontierFallback(state, fallbackStage);
      return state;
    },
    setFarmStage(farmStage: number): SoloFrontierRuntimeState {
      state = setSoloFrontierFarmStage(state, farmStage);
      return state;
    },
    advance(elapsedMs: number, advanceOptions: SoloFrontierSimulationOptions = {}): SoloFrontierAdvanceResult {
      const result = advanceSoloFrontier(state, elapsedMs, { ...runtimeOptions, ...advanceOptions });
      state = result.state;
      return result;
    },
    async catchUp(elapsedSeconds: number, catchUpOptions: { batchEncounters?: number; offlineCapSeconds?: number } = {}): Promise<SoloFrontierCatchUpResult> {
      const result = await catchUpSoloFrontier(state, elapsedSeconds, { ...runtimeOptions, ...catchUpOptions });
      state = result.state;
      return result;
    },
    hydrate(nextState: unknown): SoloFrontierRuntimeState {
      state = normalizeSoloFrontierState(nextState);
      return state;
    }
  });
}

export type SoloFrontierRuntimeStateV20 = Omit<SoloFrontierRuntimeState, 'version'> & { version: 20 };

export type MomentumSaveV20 = Record<string, unknown> & {
  version: 20;
  skills: unknown[];
  soloFrontier: SoloFrontierRuntimeStateV20;
};

/** Idempotent v19 -> v20 migration. */
export function migrateV19SaveToV20(value: unknown): MomentumSaveV20 {
  const source = isRecord(value) ? value : {};
  if (source.version === 20 && isRecord(source.soloFrontier)) return source as MomentumSaveV20;
  const compatibility = isRecord(source.combatCompatibility) && isRecord(source.combatCompatibility.skill)
    ? source.combatCompatibility.skill
    : isRecord(source.legacyCombat) && isRecord(source.legacyCombat.combatSkill)
      ? source.legacyCombat.combatSkill
      : {};
  const discipline = isRecord(source.combatDiscipline) ? source.combatDiscipline : {};
  const seed = seedSoloFrontierProgress({
    arenaWins: Array.isArray(source.arenaWins) ? source.arenaWins : [],
    legacyCombatLevel: compatibility.lvl ?? compatibility.level,
    existingCombatDisciplinePoints: discipline.earnedPoints,
    existingCombatTalents: Array.isArray(source.combatTalents)
      ? source.combatTalents
      : Array.isArray(discipline.ownedNodeIds)
        ? discipline.ownedNodeIds
        : []
  });
  const lootCache = normalizeLootCache(source.lootCache, {
    items: Array.isArray(source.lootCache) ? source.lootCache.filter(item => inspectItem(item as ItemInstance) !== null) as ItemInstance[] : [],
    equipment: isRecord(source.equipment) ? source.equipment as unknown as LootCacheState['equipment'] : undefined,
    favoriteIds: Array.isArray(source.lootFavorites) ? source.lootFavorites.filter((id): id is string => typeof id === 'string') : [],
    filters: isRecord(source.lootFilters) ? source.lootFilters as unknown as LootFilters : undefined
  });
  const skills = Array.isArray(source.skills)
    ? source.skills.filter(skill => !(isRecord(skill) && skill.id === 'Combat'))
    : [];
  const nonCombatSkills = Object.fromEntries(skills.filter(isRecord).map(skill => [String(skill.id || ''), normalizeNonCombatSkill(skill, String(skill.id || ''))]).filter(([id]) => Boolean(id)));
  const initial = createInitialSoloFrontierState({
    ...seed,
    order: 'paused',
    currentStage: null,
    farmStage: seed.highestClearedStage || null,
    keys: finiteNonNegative(source.keys),
    combatProgression: normalizeCombatProgression(source.combatProgression),
    combatDiscipline: seed.combatDiscipline,
    lootCache,
    collectionProgress: isRecord(source.collectionProgress) ? source.collectionProgress as Record<string, number> : {},
    nonCombatSkills,
    seed: canonicalSeed(isRecord(source.soloFrontier) ? source.soloFrontier.seed : undefined),
    lastUpdatedAt: finiteNonNegative(source.savedAt, Date.now())
  });
  const {
    combatCompatibility: _combatCompatibility,
    legacyCombat: _legacyCombat,
    lootInventory: _lootInventory,
    lootCache: _lootCache,
    lootFilters: _lootFilters,
    lootFavorites: _lootFavorites,
    lootCapacity: _lootCapacity,
    grandfatheredLootOverflow: _grandfatheredLootOverflow,
    weaponRefinements: _weaponRefinements,
    foodId: _foodId,
    combatDevelopment: _combatDevelopment,
    frontierExchange: _frontierExchange,
    combatProgression: _combatProgression,
    ...preserved
  } = source;
  return {
    ...preserved,
    version: 20,
    skills,
    ownedBaseUps: Array.isArray(source.ownedBaseUps) ? source.ownedBaseUps : [],
    ownedSkillUps: Array.isArray(source.ownedSkillUps) ? source.ownedSkillUps : [],
    ownedGear: Array.isArray(source.ownedGear) ? source.ownedGear : [],
    ownedItems: Array.isArray(source.ownedItems) ? source.ownedItems : [],
    globalBuff: isRecord(source.globalBuff) ? source.globalBuff : {},
    unlockedNormalSlots: Math.min(Math.max(1, Math.floor(finiteNonNegative(source.unlockedNormalSlots, skills.length))), skills.length),
    lootCache: lootCache.items,
    lootFilters: lootCache.filters,
    lootFavorites: lootCache.favoriteIds,
    lootCapacity: lootCache.capacity,
    grandfatheredLootOverflow: lootCache.grandfatheredOverflow,
    soloFrontier: { ...initial, version: 20 }
  };
}

/** Runs every supported historical save through the complete, idempotent chain. */
export function migrateMomentumSaveToV20(value: unknown): MomentumSaveV20 {
  const source = isRecord(value) ? value : {};
  const version = integerInRange(source.version, 1, 20, 1);
  if (version === 20) return migrateV19SaveToV20(source);
  const v18 = version <= 17 ? migrateV17SaveToV18(source) : source;
  const v19 = version <= 18 ? migrateV18SaveToV19(v18) : v18;
  return migrateV19SaveToV20(v19);
}

export const migrateV19ToV20 = migrateV19SaveToV20;
export const migrateSoloFrontierSaveToV20 = migrateV19SaveToV20;

export type MomentumSaveV21 = Record<string, unknown> & {
  version: 21;
  skills: unknown[];
  soloFrontier: SoloFrontierRuntimeState;
};

const LEGACY_COMBAT_ITEM_IDS: Readonly<Record<string, string>> = Object.freeze({
  pulseSidearm: 'pulse-sidearm',
  'pulse-sidearm': 'pulse-sidearm',
  ironBlade: 'iron-blade',
  'iron-blade': 'iron-blade',
  frontierBow: 'frontier-bow',
  'frontier-bow': 'frontier-bow',
  emberFocus: 'ember-focus',
  'ember-focus': 'ember-focus',
  platedVest: 'plated-vest',
  'plated-vest': 'plated-vest'
});

function validItemInstances(value: unknown): ItemInstance[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is ItemInstance => inspectItem(item as ItemInstance) !== null);
}

function mergeInstances(...groups: readonly ItemInstance[][]): ItemInstance[] {
  const byId = new Map<string, ItemInstance>();
  groups.flat().forEach(item => {
    if (!byId.has(item.instanceId)) byId.set(item.instanceId, item);
  });
  return [...byId.values()];
}

function legacyCombatItem(
  legacyId: string,
  definitionId: string,
  enhancementRank: number,
  acquiredAt: number,
  usedIds: ReadonlySet<string>
): ItemInstance {
  const definition = COMBAT_LOOT_DEFINITIONS.find(item => item.id === definitionId)!;
  let instanceId = `legacy:${legacyId}`;
  let suffix = 2;
  while (usedIds.has(instanceId)) {
    instanceId = `legacy:${legacyId}:${suffix}`;
    suffix += 1;
  }
  return {
    instanceId,
    definitionId,
    rarity: 'common',
    itemLevel: 1,
    affixes: [],
    signatureId: definition.signatureId,
    sourceId: 'legacy-equipment',
    acquiredAt,
    rerolls: 0,
    enhancementRank: Math.max(0, Math.min(5, Math.floor(enhancementRank)))
  };
}

function canonicalV21LootCache(source: Record<string, unknown>, soloSource: Record<string, unknown>): LootCacheState {
  const rawSoloCache = isRecord(soloSource.lootCache) ? soloSource.lootCache : {};
  const nestedItems = validItemInstances(rawSoloCache.items);
  const projectedItems = validItemInstances(source.lootInventory);
  const legacyArray = validItemInstances(source.lootCache);
  const items = mergeInstances(nestedItems, projectedItems, legacyArray);
  const itemById = new Map(items.map(item => [item.instanceId, item]));
  const rawNestedEquipment = isRecord(rawSoloCache.equipment) ? rawSoloCache.equipment : {};
  const legacyEquipment = isRecord(source.equipment) ? source.equipment : {};
  const rawRefinements = isRecord(source.weaponRefinements) ? source.weaponRefinements : {};
  const refinementRankFor = (definitionId: string, ...candidateIds: unknown[]): number => Math.max(
    0,
    ...candidateIds.filter((id): id is string => typeof id === 'string').map(id => finiteNonNegative(rawRefinements[id])),
    ...Object.entries(LEGACY_COMBAT_ITEM_IDS)
      .filter(([, canonicalId]) => canonicalId === definitionId)
      .map(([legacyId]) => finiteNonNegative(rawRefinements[legacyId]))
  );
  const equipment = Object.fromEntries(COMBAT_EQUIPMENT_SLOT_IDS.map(slot => [slot, null])) as unknown as LootCacheState['equipment'];
  equipment.food = null;
  equipment.activeWeaponSlot = rawNestedEquipment.activeWeaponSlot === 'melee'
    || rawNestedEquipment.activeWeaponSlot === 'gun'
    || rawNestedEquipment.activeWeaponSlot === 'ranged'
    || rawNestedEquipment.activeWeaponSlot === 'magic'
    ? rawNestedEquipment.activeWeaponSlot
    : null;

  const usedIds = new Set(items.map(item => item.instanceId));
  const definitionByLegacyItem = new Map<string, ItemInstance>();
  const equippedSourceForSlot = (slot: string): unknown => {
    if (typeof rawNestedEquipment[slot] === 'string') return rawNestedEquipment[slot];
    if (slot === 'chest' && typeof legacyEquipment.armor === 'string') return legacyEquipment.armor;
    return legacyEquipment[slot];
  };

  for (const slot of COMBAT_EQUIPMENT_SLOT_IDS) {
    const rawValue = equippedSourceForSlot(slot);
    if (typeof rawValue !== 'string') continue;
    if (itemById.has(rawValue)) {
      equipment[slot] = rawValue;
      const existing = itemById.get(rawValue)!;
      const rank = Math.max(
        finiteNonNegative(existing.enhancementRank),
        refinementRankFor(existing.definitionId, rawValue, legacyEquipment[slot])
      );
      if (rank !== finiteNonNegative(existing.enhancementRank)) {
        const enhanced = { ...existing, enhancementRank: Math.max(0, Math.min(5, Math.floor(rank))) };
        items[items.findIndex(item => item.instanceId === rawValue)] = enhanced;
        itemById.set(rawValue, enhanced);
      }
      continue;
    }
    const definitionId = LEGACY_COMBAT_ITEM_IDS[rawValue] || (COMBAT_LOOT_DEFINITIONS.some(item => item.id === rawValue) ? rawValue : null);
    if (!definitionId) continue;
    let item = definitionByLegacyItem.get(rawValue);
    if (!item) {
      const matchingEquippedItem = items.find(candidate =>
        candidate.definitionId === definitionId
        && candidate.sourceId === 'legacy-equipment'
      );
      item = matchingEquippedItem || legacyCombatItem(
        rawValue,
        definitionId,
        refinementRankFor(definitionId, rawValue, legacyEquipment[slot]),
        finiteNonNegative(source.savedAt),
        usedIds
      );
      if (!matchingEquippedItem) {
        items.push(item);
        itemById.set(item.instanceId, item);
        usedIds.add(item.instanceId);
      }
      definitionByLegacyItem.set(rawValue, item);
    }
    equipment[slot] = item.instanceId;
  }

  if (!equipment.activeWeaponSlot || !equipment[equipment.activeWeaponSlot]) {
    equipment.activeWeaponSlot = (['melee', 'gun', 'ranged', 'magic'] as const).find(slot => Boolean(equipment[slot])) || null;
  }
  const foodId = typeof rawSoloCache.foodId === 'string'
    ? rawSoloCache.foodId
    : typeof rawNestedEquipment.food === 'string'
      ? rawNestedEquipment.food
      : typeof legacyEquipment.food === 'string'
        ? legacyEquipment.food
        : null;
  const favorites = [...new Set([
    ...(Array.isArray(rawSoloCache.favoriteIds) ? rawSoloCache.favoriteIds : []),
    ...(Array.isArray(source.lootFavorites) ? source.lootFavorites : [])
  ].filter((id): id is string => typeof id === 'string' && itemById.has(id)))];
  return createLootCache({
    items,
    equipment,
    foodId,
    favoriteIds: favorites,
    filters: isRecord(rawSoloCache.filters)
      ? rawSoloCache.filters as unknown as LootFilters
      : isRecord(source.lootFilters)
        ? source.lootFilters as unknown as LootFilters
        : undefined
  });
}

/** Converts every v20 combat-equipment projection into one v21 cache authority. */
export function migrateV20SaveToV21(value: unknown): MomentumSaveV21 {
  const source = isRecord(value) ? value : {};
  const sourceSolo = isRecord(source.soloFrontier) ? source.soloFrontier : {};
  const lootCache = canonicalV21LootCache(source, sourceSolo);
  const combatProgression = normalizeCombatProgression(sourceSolo.combatProgression ?? source.combatProgression);
  const initial = normalizeSoloFrontierState({
    ...sourceSolo,
    version: 21,
    combatProgression,
    combatDevelopment: sourceSolo.combatDevelopment ?? source.combatDevelopment,
    frontierExchange: sourceSolo.frontierExchange ?? source.frontierExchange,
    lootCache,
    seed: canonicalSeed(sourceSolo.seed),
    lastUpdatedAt: finiteNonNegative(sourceSolo.lastUpdatedAt ?? source.savedAt, Date.now())
  });
  const legacyEquipment = isRecord(source.equipment) ? source.equipment : {};
  const {
    combatCompatibility: _combatCompatibility,
    legacyCombat: _legacyCombat,
    lootInventory: _lootInventory,
    lootCache: _lootCache,
    lootFilters: _lootFilters,
    lootFavorites: _lootFavorites,
    lootCapacity: _lootCapacity,
    grandfatheredLootOverflow: _grandfatheredLootOverflow,
    weaponRefinements: _weaponRefinements,
    foodId: _foodId,
    combatDevelopment: _combatDevelopment,
    frontierExchange: _frontierExchange,
    combatProgression: _combatProgression,
    ...preserved
  } = source;
  return {
    ...preserved,
    version: 21,
    skills: Array.isArray(source.skills) ? source.skills : [],
    equipment: {
      tool: typeof legacyEquipment.tool === 'string'
        ? legacyEquipment.tool
        : typeof source.equippedTool === 'string'
          ? source.equippedTool
          : null
    },
    soloFrontier: initial
  };
}

/** Single idempotent entry point for every supported v1-v21 save. */
export function migrateMomentumSaveToV21(value: unknown): MomentumSaveV21 {
  const source = isRecord(value) ? value : {};
  const version = integerInRange(source.version, 1, 21, 1);
  if (version === 21) return migrateV20SaveToV21(source);
  return migrateV20SaveToV21(migrateMomentumSaveToV20(source));
}

export const migrateV20ToV21 = migrateV20SaveToV21;
export const migrateSoloFrontierSaveToV21 = migrateV20SaveToV21;
