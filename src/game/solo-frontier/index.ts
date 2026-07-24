import {
  advanceSoloFrontier,
  arenaTierUnlockForSoloStage,
  catchUpSoloFrontier,
  createInitialSoloFrontierState,
  createSoloFrontierRuntime,
  migrateMomentumSaveToV21,
  migrateV20SaveToV21,
  migrateMomentumSaveToV20,
  migrateV19SaveToV20,
  normalizeSoloFrontierState,
  seedSoloFrontierProgress,
  setSoloFrontierFallback,
  setSoloFrontierFarmStage,
  setSoloFrontierOrder
} from './solo-frontier-runtime';
import { soloFrontierStage } from './solo-frontier-definitions';
import { calculateArmourMitigation, calculateHitChance, calculateMagicalMitigation, deriveSoloPlayerStats, simulateSoloCombat } from './solo-combat-engine';
import { normalizeSoloCombatControls } from './solo-frontier-controls';

export * from './solo-frontier-types';
export * from './solo-frontier-definitions';
export * from './solo-combat-engine';
export * from './solo-frontier-controls';
export * from './solo-frontier-runtime';

export const MomentumSoloFrontier = Object.freeze({
  advanceSoloFrontier,
  catchUpSoloFrontier,
  createInitialSoloFrontierState,
  createSoloFrontierRuntime,
  migrateMomentumSaveToV21,
  migrateV20SaveToV21,
  migrateMomentumSaveToV20,
  migrateV19SaveToV20,
  normalizeSoloFrontierState,
  seedSoloFrontierProgress,
  setSoloFrontierFallback,
  setSoloFrontierFarmStage,
  setSoloFrontierOrder,
  deriveSoloPlayerStats,
  calculateHitChance,
  calculateArmourMitigation,
  calculateMagicalMitigation,
  arenaTierUnlockForSoloStage,
  simulateSoloCombat,
  normalizeSoloCombatControls,
  stage: soloFrontierStage
});

if (typeof window !== 'undefined') window.MomentumSoloFrontier = MomentumSoloFrontier;
