import {
  advanceSoloFrontier,
  catchUpSoloFrontier,
  createInitialSoloFrontierState,
  createSoloFrontierRuntime,
  migrateV19SaveToV20,
  normalizeSoloFrontierState,
  seedSoloFrontierProgress,
  setSoloFrontierFallback,
  setSoloFrontierFarmStage,
  setSoloFrontierOrder
} from './solo-frontier-runtime';
import { soloFrontierStage } from './solo-frontier-definitions';
import { simulateSoloCombat } from './solo-combat-engine';

export * from './solo-frontier-types';
export * from './solo-frontier-definitions';
export * from './solo-combat-engine';
export * from './solo-frontier-runtime';

export const MomentumSoloFrontier = Object.freeze({
  advanceSoloFrontier,
  catchUpSoloFrontier,
  createInitialSoloFrontierState,
  createSoloFrontierRuntime,
  migrateV19SaveToV20,
  normalizeSoloFrontierState,
  seedSoloFrontierProgress,
  setSoloFrontierFallback,
  setSoloFrontierFarmStage,
  setSoloFrontierOrder,
  simulateSoloCombat,
  stage: soloFrontierStage
});

if (typeof window !== 'undefined') window.MomentumSoloFrontier = MomentumSoloFrontier;
