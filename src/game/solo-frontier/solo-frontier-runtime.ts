import {
  COMBAT_SKILL_IDS,
  applyCombatEncounterProgression,
  combatSkillLevels,
  createInitialCombatProgression,
  normalizeCombatProgression,
  xpToNextCombatLevel,
  type CombatProgressionState,
  type CombatSkillId
} from '../combat-progression';
import {
  COMBAT_LOOT_DEFINITIONS,
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
import { SOLO_FRONTIER_STAGE_COUNT, soloFrontierStage } from './solo-frontier-definitions';
import { simulateSoloCombat } from './solo-combat-engine';
import type { SoloCombatInput, SoloCombatResult } from './solo-frontier-types';

export const SOLO_FRONTIER_SAVE_VERSION = 20 as const;
export const MOMENTUM_SAVE_VERSION = SOLO_FRONTIER_SAVE_VERSION;
export const SOLO_FRONTIER_OFFLINE_CAP_SECONDS = 8 * 60 * 60;
export const SOLO_FRONTIER_EXTENDED_OFFLINE_CAP_SECONDS = 12 * 60 * 60;
export const SOLO_FRONTIER_BATCH_ENCOUNTERS = 24;
export const SOLO_FRONTIER_POINT_STAGES = Object.freeze([5, 10, 15, 20, 25, 30]);
export const SOLO_FRONTIER_BOSS_STAGES = Object.freeze([10, 20, 30]);
export const ARENA_TIER_UNLOCK_STAGES = Object.freeze([10, 20, 30]);
export const SOLO_FRONTIER_BOSS_KEY_REWARDS: Readonly<Record<number, number>> = Object.freeze({ 10: 3, 20: 5, 30: 8 });

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
  keptDrops: readonly ItemInstance[];
  keptDropCount: number;
  filterSalvage: number;
  fullCacheSalvage: number;
  rarityCounts: Record<RarityId, number>;
  strongestKeptDrops: readonly StrongestKeptDrop[];
}

export interface SoloFrontierRuntimeState {
  version: 20;
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
  combatInput?: SoloCombatInput | ((stage: number, seed: string) => SoloCombatInput);
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
    combatProgression: normalizeCombatProgression(source.combatProgression),
    combatDiscipline,
    lootCache: cache,
    collectionProgress: isRecord(source.collectionProgress) ? Object.fromEntries(Object.entries(source.collectionProgress).map(([id, amount]) => [id, finiteNonNegative(amount)])) : {},
    nonCombatSkills,
    debrief: isRecord(source.debrief) ? source.debrief as unknown as SoloFrontierDebrief : null,
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

function inputForEncounter(options: SoloFrontierSimulationOptions, stage: number, seed: string): SoloCombatInput {
  const configured = typeof options.combatInput === 'function'
    ? options.combatInput(stage, seed)
    : options.combatInput || defaultCombatInput(stage, seed);
  return {
    ...configured,
    stage,
    seed,
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
    keptDrops: [],
    keptDropCount: 0,
    filterSalvage: 0,
    fullCacheSalvage: 0,
    rarityCounts: emptyRarityCounts(),
    strongestKeptDrops: []
  };
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
  const itemChance = boss ? (firstClear ? 1 : 0.15) : 0.01;
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
    targetSlots: soloFrontierStage(stage).advertisedTargetSlots,
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
    keptDrops: [...debrief.keptDrops],
    rarityCounts: { ...debrief.rarityCounts },
    strongestKeptDrops: [...debrief.strongestKeptDrops]
  };
}

function addCombatXpToDebrief(debrief: SoloFrontierDebrief, xpBySkill: Record<CombatSkillId, number>): SoloFrontierDebrief {
  const skillXp = { ...debrief.skillXp };
  COMBAT_SKILL_IDS.forEach(skillId => { skillXp[skillId] += finiteNonNegative(xpBySkill[skillId]); });
  return { ...debrief, skillXp };
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
  seed: string
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
  let nextDebrief = addCombatXpToDebrief(debrief, progression.xpBySkill);
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
      combat = simulateSoloCombat(inputForEncounter(options, stage, encounterSeed));
      resultCache.set(encounterSeed, combat);
    }
    const encounterDurationMs = Math.max(1, Math.round(combat.metrics.durationSeconds * 1_000));
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
    const outcome = applyEncounter(state, debrief, stage, combat, state.lastUpdatedAt + processedMs, encounterSeed);
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
    if (remainingMs > 0) await Promise.resolve();
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
    advance(elapsedMs: number): SoloFrontierAdvanceResult {
      const result = advanceSoloFrontier(state, elapsedMs, runtimeOptions);
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

export type MomentumSaveV20 = Record<string, unknown> & {
  version: 20;
  skills: unknown[];
  soloFrontier: SoloFrontierRuntimeState;
};

/** Idempotent v19 -> v20 migration. */
export function migrateV19SaveToV20(value: unknown): MomentumSaveV20 {
  const source = isRecord(value) ? value : {};
  if (source.version === SOLO_FRONTIER_SAVE_VERSION && isRecord(source.soloFrontier)) return source as MomentumSaveV20;
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
  const { combatCompatibility: _combatCompatibility, legacyCombat: _legacyCombat, ...preserved } = source;
  return {
    ...preserved,
    version: SOLO_FRONTIER_SAVE_VERSION,
    skills,
    unlockedNormalSlots: Math.min(Math.max(1, Math.floor(finiteNonNegative(source.unlockedNormalSlots, skills.length))), skills.length),
    lootCache: lootCache.items,
    lootFilters: lootCache.filters,
    lootFavorites: lootCache.favoriteIds,
    lootCapacity: lootCache.capacity,
    grandfatheredLootOverflow: lootCache.grandfatheredOverflow,
    soloFrontier: initial
  };
}

export const migrateV19ToV20 = migrateV19SaveToV20;
export const migrateSoloFrontierSaveToV20 = migrateV19SaveToV20;
