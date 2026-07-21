import { describe, expect, it } from 'vitest';
import {
  COMBAT_SKILL_IDS,
  applyCombatEncounterProgression,
  createInitialCombatProgression,
  type CombatSkillId
} from '../src/game/combat-progression';
import {
  createLootCache,
  createLootFilters,
  getItemDefinition,
  type ItemInstance
} from '../src/game/loot';
import {
  SOLO_FRONTIER_BOSS_KEY_REWARDS,
  SOLO_FRONTIER_ENCOUNTER_RECOVERY_SECONDS,
  arenaTierUnlockForSoloStage,
  advanceSoloFrontier,
  catchUpSoloFrontier,
  createInitialSoloFrontierState,
  migrateV19SaveToV20,
  seedSoloFrontierProgress,
  setSoloFrontierFallback,
  setSoloFrontierOrder,
  type SoloFrontierRuntimeState
} from '../src/game/solo-frontier';
import type { SoloCombatInput } from '../src/game/solo-frontier';

const STRONG_ENCOUNTER_MS = SOLO_FRONTIER_ENCOUNTER_RECOVERY_SECONDS * 1_000;

function combatInput(overrides: Partial<SoloCombatInput> = {}): SoloCombatInput {
  const combatSkills = Object.fromEntries(COMBAT_SKILL_IDS.map(skillId => [skillId, 100])) as SoloCombatInput['combatSkills'];
  return {
    combatSkills,
    equippedStats: { hitPoints: 100, accuracy: 100, evasion: 100, ward: 100, armourPieces: [] },
    activeWeapon: { id: 'test-magic', name: 'Test Magic', style: 'magic', damage: 10_000, accuracy: 100, attackInterval: 0.1 },
    stance: 'Balanced',
    technique: 'Arc Bolt',
    defensiveAbility: 'none',
    aura: 'none',
    enemy: {
      id: 'test-enemy', name: 'Test Enemy', kind: 'regular', hitPoints: 1, damage: 1,
      armour: 0, ward: 0, evasion: 0, accuracy: 0, attackInterval: 100, damageType: 'physical'
    },
    stage: 1,
    seed: 'test',
    ...overrides
  };
}

function strongOptions() {
  return { combatInput: combatInput(), useConfiguredEnemy: false, seed: 'runtime-test' };
}

function seededState(highestClearedStage: number, firstClearStages = Array.from({ length: highestClearedStage }, (_, index) => index + 1)): SoloFrontierRuntimeState {
  return createInitialSoloFrontierState({
    highestClearedStage,
    firstClearStages,
    farmStage: highestClearedStage || null,
    currentStage: null,
    lastUpdatedAt: 1_000
  });
}

function cachedItem(instanceId: string): ItemInstance {
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
    rerolls: 0
  };
}

describe('Solo Frontier v20 orders and deterministic progression', () => {
  it('unlocks Arena tiers only from Solo Frontier boss stages while retaining legacy wins as migration seeds', () => {
    expect([0, 9, 10, 19, 20, 29, 30].map(arenaTierUnlockForSoloStage)).toEqual([0, 0, 1, 1, 2, 2, 3]);
    expect(seedSoloFrontierProgress({ arenaWins: [1, 0, 0] }).highestClearedStage).toBe(10);
    expect(seedSoloFrontierProgress({ arenaWins: [0, 1, 0] }).highestClearedStage).toBe(20);
    expect(seedSoloFrontierProgress({ arenaWins: [0, 0, 1] }).highestClearedStage).toBe(30);
  });
  it('pushes from highest cleared and advances after a regular stage clear', () => {
    const initial = setSoloFrontierOrder(seededState(0, []), 'push');
    const result = advanceSoloFrontier(initial, STRONG_ENCOUNTER_MS * 25, strongOptions());
    expect(result.state.highestClearedStage).toBe(1);
    expect(result.state.currentStage).toBe(2);
    expect(result.state.order).toBe('push');
    expect(result.events.filter(event => event.stage === 1)).toHaveLength(25);
  });

  it('records a wall and farms the configured cleared fallback after defeat', () => {
    let initial = setSoloFrontierOrder(seededState(2), 'push');
    initial = setSoloFrontierFallback(initial, 1);
    const result = advanceSoloFrontier(initial, 10_000, {
      combatInput: combatInput({
        activeWeapon: { id: 'empty', name: 'Empty', style: 'magic', damage: 0, accuracy: 0, attackInterval: 1 },
        enemy: { id: 'lethal', name: 'Lethal', kind: 'regular', hitPoints: 1_000_000, damage: 1_000, armour: 0, ward: 0, evasion: 0, accuracy: 1_000, attackInterval: 0.05, damageType: 'physical' }
      }),
      useConfiguredEnemy: true,
      seed: 'wall-test',
      maxEncounters: 1
    });
    expect(result.state.order).toBe('farm');
    expect(result.state.farmStage).toBe(1);
    expect(result.state.wall).toMatchObject({ stage: 3, fallbackStage: 1, termination: 'player-defeated' });
    expect(result.debrief.deaths).toBe(1);
  });

  it('recovers to highest cleared when the configured fallback is invalid', () => {
    let initial = setSoloFrontierOrder(seededState(2), 'push');
    initial = setSoloFrontierFallback(initial, 30);
    const result = advanceSoloFrontier(initial, 10_000, {
      combatInput: combatInput({
        activeWeapon: { id: 'empty', name: 'Empty', style: 'magic', damage: 0, accuracy: 0, attackInterval: 1 },
        enemy: { id: 'lethal', name: 'Lethal', kind: 'regular', hitPoints: 1_000_000, damage: 1_000, armour: 0, ward: 0, evasion: 0, accuracy: 1_000, attackInterval: 0.05, damageType: 'physical' }
      }),
      useConfiguredEnemy: true,
      seed: 'invalid-fallback'
    });
    expect(result.state.farmStage).toBe(2);
    expect(result.state.wall?.fallbackStage).toBe(2);
  });

  it('farms an explicit cleared stage and locks stage 30 farming after its clear', () => {
    const farm = setSoloFrontierOrder(seededState(5), 'farm', 3);
    const farmResult = advanceSoloFrontier(farm, 2, strongOptions());
    expect(farmResult.state.order).toBe('farm');
    expect(farmResult.state.farmStage).toBe(3);
    expect(farmResult.state.highestClearedStage).toBe(5);

    const stage30 = setSoloFrontierOrder(seededState(29), 'push');
    const result = advanceSoloFrontier(stage30, STRONG_ENCOUNTER_MS, strongOptions());
    expect(result.state.highestClearedStage).toBe(30);
    expect(result.state.order).toBe('farm');
    expect(result.state.farmStage).toBe(30);
    expect(result.state.currentStage).toBe(30);
  });

  it('awards the existing boss key quantities and only first-clears receive guaranteed rare loot', () => {
    const state = setSoloFrontierOrder(seededState(9, Array.from({ length: 9 }, (_, index) => index + 1)), 'push');
    const first = advanceSoloFrontier(state, STRONG_ENCOUNTER_MS, strongOptions());
    expect(first.state.keys).toBe(SOLO_FRONTIER_BOSS_KEY_REWARDS[10]);
    expect(first.debrief.rarityCounts.rare + first.debrief.rarityCounts.epic + first.debrief.rarityCounts.legendary + first.debrief.rarityCounts.mythic + first.debrief.rarityCounts.ascendant + first.debrief.rarityCounts.chase).toBe(1);
    expect(first.state.lootCache.items).toHaveLength(1);

    const repeat = advanceSoloFrontier(setSoloFrontierOrder(first.state, 'farm', 10), STRONG_ENCOUNTER_MS, strongOptions());
    expect(repeat.state.keys).toBe(SOLO_FRONTIER_BOSS_KEY_REWARDS[10] * 2);
    expect(repeat.state.lootCache.items.length).toBeGreaterThanOrEqual(1);
  });

  it('routes filter rejects and full-cache drops through salvage accounting', () => {
    const items = Array.from({ length: 35 }, (_, index) => cachedItem(`cache:${index}`));
    const fullCache = createLootCache({
      items,
      filters: createLootFilters({ globalMinimumRarity: 'chase' })
    });
    const state = setSoloFrontierOrder(createInitialSoloFrontierState({
      highestClearedStage: 9,
      firstClearStages: Array.from({ length: 9 }, (_, index) => index + 1),
      lootCache: fullCache
    }), 'push');
    const result = advanceSoloFrontier(state, STRONG_ENCOUNTER_MS, strongOptions());
    expect(result.debrief.filterSalvage).toBeGreaterThan(0);
    expect(result.debrief.fullCacheSalvage).toBe(0);

    const cacheOnly = createLootCache({ items });
    const cacheResult = advanceSoloFrontier(setSoloFrontierOrder(createInitialSoloFrontierState({
      highestClearedStage: 9,
      firstClearStages: Array.from({ length: 9 }, (_, index) => index + 1),
      lootCache: cacheOnly
    }), 'push'), STRONG_ENCOUNTER_MS, strongOptions());
    expect(cacheResult.debrief.fullCacheSalvage).toBeGreaterThan(0);
  });
});

describe('Solo Frontier v20 progression, catch-up, and migration contracts', () => {
  it('applies all 17 exact event paths and gives no-use XP', () => {
    const events = COMBAT_SKILL_IDS.map(skillId => ({ type: 'combat-skill-used' as const, skillId, amount: 1 }));
    const result = applyCombatEncounterProgression(createInitialCombatProgression(), events, { outcome: 'victory', stage: 1 });
    for (const skillId of COMBAT_SKILL_IDS) expect(result.xpBySkill[skillId]).toBeGreaterThan(0);
    const noUse = applyCombatEncounterProgression(createInitialCombatProgression(), [], { outcome: 'victory', stage: 1 });
    expect(Object.values(noUse.xpBySkill).every(xp => xp === 0)).toBe(true);
    expect('Combat' in noUse.xpBySkill).toBe(false);
    expect('Defense' in noUse.xpBySkill).toBe(false);
  });

  it('keeps first-clear point grants idempotent through repeat farming', () => {
    const initial = setSoloFrontierOrder(seededState(4, [1, 2, 3, 4]), 'push');
    const first = advanceSoloFrontier(initial, STRONG_ENCOUNTER_MS * 31, strongOptions());
    expect(first.state.combatDiscipline.earnedPoints).toBe(1);
    const repeat = advanceSoloFrontier(setSoloFrontierOrder(first.state, 'farm', 5), STRONG_ENCOUNTER_MS * 31, strongOptions());
    expect(repeat.state.combatDiscipline.earnedPoints).toBe(1);
    expect(repeat.state.combatDiscipline.grantedStages).toEqual([5]);
  });

  it('keeps online and yielded offline catch-up byte-equivalent', async () => {
    const initial = setSoloFrontierOrder(createInitialSoloFrontierState({ lastUpdatedAt: 1_000 }), 'push');
    const elapsedMs = STRONG_ENCOUNTER_MS * 4;
    const online = advanceSoloFrontier(initial, elapsedMs, strongOptions()).state;
    const offline = await catchUpSoloFrontier(initial, elapsedMs / 1_000, { ...strongOptions(), batchEncounters: 2 });
    expect(offline.batches).toBeGreaterThan(1);
    expect(offline.state).toEqual(online);
  });

  it('runs solo combat concurrently with an active non-combat track', () => {
    const initial = setSoloFrontierOrder(createInitialSoloFrontierState({
      nonCombatSkills: {
        Mining: { id: 'Mining', active: true, actionsPerSecond: 0.2, xpPerAction: 20, level: 1, xp: 0, nextXp: 100, progress: 0, quantity: 0 }
      }
    }), 'push');
    const result = advanceSoloFrontier(initial, STRONG_ENCOUNTER_MS * 10, strongOptions());
    expect(result.state.totalVictories).toBe(10);
    expect(result.state.nonCombatSkills.Mining.quantity).toBe(10);
    expect(result.state.nonCombatSkills.Mining.level).toBe(2);
    expect(result.state.nonCombatSkills.Mining.xp).toBe(100);
  });

  it('continues identically after save/reload normalization and aggregates the debrief', () => {
    const initial = setSoloFrontierOrder(createInitialSoloFrontierState({ lastUpdatedAt: 1_000 }), 'push');
    const first = advanceSoloFrontier(initial, STRONG_ENCOUNTER_MS * 1.5, strongOptions());
    const reloaded = JSON.parse(JSON.stringify(first.state)) as SoloFrontierRuntimeState;
    const continued = advanceSoloFrontier(reloaded, STRONG_ENCOUNTER_MS * 8.5, { ...strongOptions(), resetDebrief: false });
    const directFirst = advanceSoloFrontier(initial, STRONG_ENCOUNTER_MS * 1.5, strongOptions());
    const direct = advanceSoloFrontier(directFirst.state, STRONG_ENCOUNTER_MS * 8.5, { ...strongOptions(), resetDebrief: false });
    expect(continued.state).toEqual(direct.state);
    expect(continued.debrief.victories).toBeGreaterThan(0);
    expect(continued.debrief.skillXp['Offensive Magic']).toBeGreaterThan(0);
    expect(continued.debrief.strongestKeptDrops.length).toBeLessThanOrEqual(3);
  });

  it('migrates v19 Arena seeds and loot idempotently without restoring generic Combat', () => {
    const v19 = {
      version: 19,
      savedAt: 1_000,
      skills: [{ id: 'Mining', lvl: 4, xp: 10 }, { id: 'Combat', lvl: 20, xp: 0 }],
      arenaWins: [1, 0, 0],
      combatProgression: createInitialCombatProgression(),
      combatTalents: ['openingAttack'],
      equipment: {},
      lootCache: []
    };
    const migrated = migrateV19SaveToV20(v19);
    expect(migrated.version).toBe(20);
    expect(migrated.soloFrontier.highestClearedStage).toBe(10);
    expect(migrated.soloFrontier.firstClearStages).toContain(10);
    expect(migrated.soloFrontier.combatDiscipline.ownedNodeIds).toEqual(['openingAttack']);
    expect(migrated.skills.some(skill => (skill as { id?: string })?.id === 'Combat')).toBe(false);
    expect(migrateV19SaveToV20(migrated)).toBe(migrated);
  });

  it('seeds legacy Combat progression to floor(level / 2), capped below stage 10 without Arena wins', () => {
    const seeded = seedSoloFrontierProgress({ legacyCombatLevel: 50, arenaWins: [0, 0, 0] });
    expect(seeded.highestClearedStage).toBe(9);
    expect(seeded.combatDiscipline.earnedPoints).toBe(6);
    expect(seeded.combatDiscipline.grantedStages).toEqual([5, 10, 15, 20, 25, 30]);
  });
});
