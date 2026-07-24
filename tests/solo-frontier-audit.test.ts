import { performance } from 'node:perf_hooks';
import { describe, expect, it } from 'vitest';
import { combatSkillLevels, migrateV17SaveToV18, migrateV18SaveToV19 } from '../src/game/combat-progression';
import {
  advanceSoloFrontier,
  catchUpSoloFrontier,
  createInitialSoloFrontierState,
  migrateMomentumSaveToV21,
  migrateMomentumSaveToV20,
  setSoloFrontierOrder
} from '../src/game/solo-frontier';
import {
  SOLO_FRONTIER_BALANCE_BUILDS,
  balanceInputForBuild,
  runSoloFrontierBalanceAudit
} from '../scripts/solo-frontier-balance';
import { REPRESENTATIVE_V17_SAVE_FIXTURE } from './fixtures/combat-save-fixtures';

const median = (values: readonly number[]) => [...values].sort((left, right) => left - right)[Math.floor(values.length / 2)];

describe('Solo Frontier deterministic acceptance harness', () => {
  it('meets pacing, style, armour, sustain, Defense, poor-build, and loot targets', { timeout: 45_000 }, () => {
    const audit = runSoloFrontierBalanceAudit();
    const firstWall = audit.starterRoute.find(measurement => measurement.winRate < 0.8)!;
    const wallArrival = audit.route[firstWall.stage - 2].cumulativeHours * 60;
    expect(firstWall.stage).toBeGreaterThanOrEqual(5);
    expect(firstWall.stage).toBeLessThanOrEqual(8);
    expect(wallArrival).toBeGreaterThanOrEqual(20);
    expect(wallArrival).toBeLessThanOrEqual(40);

    expect(audit.pacing.firstLootMedianMinutes).toBeLessThanOrEqual(10);
    expect(audit.pacing.stage10Hours).toBeGreaterThanOrEqual(2);
    expect(audit.pacing.stage10Hours).toBeLessThanOrEqual(4);
    expect(audit.pacing.stage20Hours / 24).toBeGreaterThanOrEqual(2);
    expect(audit.pacing.stage20Hours / 24).toBeLessThanOrEqual(4);
    expect(audit.pacing.stage30Hours / 24).toBeGreaterThanOrEqual(10);
    expect(audit.pacing.stage30Hours / 24).toBeLessThanOrEqual(14);
    expect(audit.pacing.farmEightHourMedianKeptItems).toBeGreaterThanOrEqual(10);
    expect(audit.pacing.farmEightHourMedianKeptItems).toBeLessThanOrEqual(30);

    const styles = ['melee', 'firearm', 'ranged', 'magic'].map(name => audit.builds.find(build => build.build === name)!);
    const styleMedian = median(styles.map(build => build.medianClearSeconds));
    styles.forEach(build => expect(Math.abs(build.medianClearSeconds - styleMedian) / styleMedian).toBeLessThanOrEqual(0.15));

    const light = audit.builds.find(build => build.build === 'light-armour')!;
    const medium = audit.builds.find(build => build.build === 'medium-armour')!;
    const heavy = audit.builds.find(build => build.build === 'heavy-armour')!;
    const sustain = audit.builds.find(build => build.build === 'sustain')!;
    expect(light.medianClearSeconds).toBeLessThan(medium.medianClearSeconds);
    expect(medium.medianClearSeconds).toBeLessThan(heavy.medianClearSeconds);
    expect(medium.medianMitigation).toBeGreaterThan(light.medianMitigation);
    expect(heavy.medianMitigation).toBeGreaterThan(medium.medianMitigation);
    expect(heavy.medianHealthRemaining).toBeGreaterThan(medium.medianHealthRemaining);
    expect(sustain.medianDamageTaken).toBeLessThan(medium.medianDamageTaken);
    expect(audit.builds.find(build => build.build === 'intentionally-poor')!.winRate).toBe(0);
    expect(audit.milestoneBuilds.every(build => build.winRate >= 0.8)).toBe(true);
    expect(audit.milestoneBuilds.find(build => build.stage === 20)!.winRate).toBeGreaterThanOrEqual(0.90);
    expect(audit.milestoneBuilds.find(build => build.stage === 30)!.winRate).toBeGreaterThanOrEqual(0.75);

    expect(audit.authoredCombatTrees).toEqual({ total: 17, nodes: 357, allTreesHaveTwentyOneNodes: true });
    expect(audit.defenseTrees).toHaveLength(5);
    audit.defenseTrees.forEach(tree => {
      expect(tree.allocatedNodes).toBe(10);
      expect(tree.improvementPct).toBeGreaterThanOrEqual(8);
      expect(tree.improvementPct).toBeLessThanOrEqual(28);
      expect(tree.capstones).toHaveLength(6);
      expect(tree.capstones.every(capstone => capstone.allocatedNodes === 10)).toBe(true);
      expect(tree.capstonePairs).toHaveLength(3);
      expect(tree.capstoneSpreadPct).toBeLessThanOrEqual(20);
      expect(tree.modifierCaps.armour).toBeLessThanOrEqual(0.50);
      expect(tree.modifierCaps.ward).toBeLessThanOrEqual(0.60);
      expect(tree.modifierCaps.evasion).toBeLessThanOrEqual(30);
      expect(tree.modifierCaps.enemyHitChanceReduction).toBeLessThanOrEqual(0.10);
      expect(tree.modifierCaps.physicalReduction).toBeLessThanOrEqual(0.20);
      expect(tree.modifierCaps.magicalReduction).toBeLessThanOrEqual(0.20);
      expect(tree.modifierCaps.penetrationResistance).toBeLessThanOrEqual(0.50);
      expect(tree.modifierCaps.barrierStrength).toBeLessThanOrEqual(1);
      expect(tree.modifierCaps.barrierCooldown).toBeLessThanOrEqual(0.40);
    });
    expect(audit.threatPortfolios).toHaveLength(5);
    expect(audit.threatPortfolios.every(portfolio => portfolio.standardRatio >= 0.92 && portfolio.standardRatio <= 1.08)).toBe(true);
    expect(audit.threatPortfolios.every(portfolio => portfolio.bestBuild === portfolio.expectedBuild)).toBe(true);
    expect(new Set(audit.threatPortfolios.map(portfolio => portfolio.bestBuild)).size).toBe(5);
    expect(audit.counterPressure.maxThroughputIncreasePct).toBeLessThanOrEqual(15);

    expect(audit.offenseTrees).toHaveLength(8);
    audit.offenseTrees.forEach(tree => {
      expect(tree.allocatedNodes).toBe(10);
      expect(tree.improvementPct).toBeGreaterThanOrEqual(12);
      expect(tree.improvementPct).toBeLessThanOrEqual(30);
      expect(tree.capstones).toHaveLength(6);
      expect(tree.capstones.every(capstone => capstone.allocatedNodes === 10)).toBe(true);
      expect(tree.capstonePairs).toHaveLength(3);
      expect(tree.capstoneSpreadPct).toBeLessThanOrEqual(15);
      expect(tree.modifierCaps.attackSpeedPct).toBeLessThanOrEqual(0.30);
      expect(tree.modifierCaps.techniqueCooldownPct).toBeLessThanOrEqual(0.40);
      expect(tree.modifierCaps.criticalChance).toBeLessThanOrEqual(0.60);
      expect(tree.modifierCaps.penetration).toBeLessThanOrEqual(60);
    });

    expect(audit.sustainTrees).toHaveLength(4);
    audit.sustainTrees.forEach(tree => {
      expect(tree.allocatedNodes).toBe(10);
      expect(tree.improvementPct).toBeGreaterThanOrEqual(5);
      expect(tree.improvementPct).toBeLessThanOrEqual(30);
      expect(tree.capstones).toHaveLength(6);
      expect(tree.capstones.every(capstone => capstone.allocatedNodes === 10)).toBe(true);
      expect(tree.capstones.every(capstone => capstone.improvementPct > 0)).toBe(true);
      expect(tree.modifierCaps.maxHitPointsMultiplier).toBeLessThanOrEqual(1.40);
      expect(tree.modifierCaps.healingMultiplier).toBeLessThanOrEqual(1.75);
      expect(tree.modifierCaps.mendCooldownMultiplier).toBeGreaterThanOrEqual(0.60);
      expect(tree.modifierCaps.damageTakenMultiplier).toBeGreaterThanOrEqual(0.85);
      expect(tree.modifierCaps.regenerationPctPerSecond).toBeLessThanOrEqual(0.01);
      expect(tree.modifierCaps.reserveCapPct).toBeLessThanOrEqual(0.20);
      expect(tree.modifierCaps.damageRecoveryPct).toBeLessThanOrEqual(0.20);
      expect(tree.modifierCaps.fatalGuardPct).toBeLessThanOrEqual(0.15);
    });
  });
});

describe('Solo Frontier complete save migration chain', () => {
  const v1 = {
    version: 1,
    savedAt: 1_000,
    skills: [{ id: 'Mining', lvl: 3, xp: 10 }, { id: 'Combat', lvl: 12, xp: 25 }],
    arenaWins: [0, 0, 0],
    keys: 2
  };
  const legacyItem = {
    instanceId: 'v14-edge', definitionId: 'initiates-edge', rarity: 'rare', itemLevel: 8,
    affixes: [], signatureId: 'shockbreaker', sourceId: 'arena:1', acquiredAt: 14_000, rerolls: 0
  };
  const v14 = {
    ...v1,
    version: 14,
    savedAt: 14_000,
    arenaWins: [2, 0, 0],
    lootInventory: [legacyItem],
    lootFilters: { globalMinimumRarity: 'uncommon', perSlotMinimumRarity: {} },
    lootFavorites: ['v14-edge']
  };
  const v18 = migrateV17SaveToV18(REPRESENTATIVE_V17_SAVE_FIXTURE);
  const v19 = migrateV18SaveToV19(v18);
  const v20 = migrateMomentumSaveToV20(v19);

  it.each([
    ['v1', v1],
    ['v14', v14],
    ['v17', REPRESENTATIVE_V17_SAVE_FIXTURE],
    ['v18', v18],
    ['v19', v19]
  ] as const)('migrates representative %s data to normalized v20', (_label, source) => {
    const migrated = migrateMomentumSaveToV20(source);
    expect(migrated.version).toBe(20);
    expect(migrated.soloFrontier.version).toBe(20);
    expect(migrated.skills.every(skill => !(skill && typeof skill === 'object' && 'id' in skill && skill.id === 'Combat'))).toBe(true);
    expect(migrated.soloFrontier.combatProgression.Strength.level).toBeGreaterThanOrEqual(1);
    expect(Array.isArray(migrated.ownedItems)).toBe(true);
    expect(migrateMomentumSaveToV20(migrated)).toBe(migrated);
  });

  it('preserves v14 loot, filters, favourites, and legacy Arena clear credit', () => {
    const migrated = migrateMomentumSaveToV20(v14);
    expect(migrated.soloFrontier.lootCache.items.map(item => item.instanceId)).toContain('v14-edge');
    expect(migrated.soloFrontier.lootCache.filters.globalMinimumRarity).toBe('uncommon');
    expect(migrated.soloFrontier.lootCache.favoriteIds).toContain('v14-edge');
    expect(migrated.soloFrontier.highestClearedStage).toBe(10);
  });

  it.each([
    ['v1', v1],
    ['v14', v14],
    ['v17', REPRESENTATIVE_V17_SAVE_FIXTURE],
    ['v18', v18],
    ['v19', v19],
    ['v20', v20]
  ] as const)('migrates representative %s data through the single v21 entry point idempotently', (_label, source) => {
    const migrated = migrateMomentumSaveToV21(source);
    expect(migrated.version).toBe(21);
    expect(migrated.soloFrontier.version).toBe(21);
    expect(migrated.soloFrontier.lootCache.capacity).toBe(35);
    expect(Object.keys(migrated.soloFrontier.combatProgression)).toHaveLength(17);
    expect(Object.keys(migrated.soloFrontier.combatDevelopment.trees)).toHaveLength(17);
    expect(migrateMomentumSaveToV21(JSON.parse(JSON.stringify(migrated)))).toEqual(migrated);
  });

  it('preserves v14 loot and filters without retaining root loot projections in v21', () => {
    const migrated = migrateMomentumSaveToV21(v14);
    expect(migrated.soloFrontier.lootCache.items.map(item => item.instanceId)).toContain('v14-edge');
    expect(migrated.soloFrontier.lootCache.filters.globalMinimumRarity).toBe('uncommon');
    expect(migrated.soloFrontier.lootCache.favoriteIds).toContain('v14-edge');
    expect('lootInventory' in migrated).toBe(false);
    expect('lootCache' in migrated).toBe(false);
  });
});

describe('Solo Frontier online/offline determinism and catch-up responsiveness', () => {
  const build = SOLO_FRONTIER_BALANCE_BUILDS.find(candidate => candidate.name === 'firearm')!;
  const initialFarmState = () => setSoloFrontierOrder(createInitialSoloFrontierState({
    seed: 'online-offline-audit',
    highestClearedStage: 15,
    firstClearStages: Array.from({ length: 15 }, (_, index) => index + 1),
    lastUpdatedAt: 1
  }), 'farm', 15);
  const dynamicInput = (stage: number, seed: string, state: ReturnType<typeof initialFarmState>) => ({
    ...balanceInputForBuild(build, stage, seed),
    combatSkills: combatSkillLevels(state.combatProgression)
  });

  it('keeps evolving-skill online and offline results identical', { timeout: 20_000 }, async () => {
    const elapsedMs = 60 * 60 * 1_000;
    const online = advanceSoloFrontier(initialFarmState(), elapsedMs, { combatInput: dynamicInput });
    const offline = await catchUpSoloFrontier(initialFarmState(), elapsedMs / 1_000, { combatInput: dynamicInput, batchEncounters: 24 });
    expect(offline.state).toEqual(online.state);
    expect(offline.events).toEqual(online.events);
  });

  it('processes eight hours in bounded batches while yielding to the event loop', { timeout: 20_000 }, async () => {
    let timerTicks = 0;
    const timer = setInterval(() => { timerTicks += 1; }, 0);
    const startedAt = performance.now();
    const result = await catchUpSoloFrontier(initialFarmState(), 8 * 60 * 60, { combatInput: dynamicInput, batchEncounters: 24 });
    const wallTimeMs = performance.now() - startedAt;
    clearInterval(timer);
    expect(result.elapsedMs).toBe(8 * 60 * 60 * 1_000);
    expect(result.remainingMs).toBe(0);
    expect(result.batches).toBeGreaterThan(1);
    expect(timerTicks).toBeGreaterThan(5);
    expect(wallTimeMs).toBeLessThan(5_000);
  });
});
