import { FRONTIER_REGION, WORLD_REGIONS } from './world-definitions';
import { createInitialWorldState, createWorldRuntime, migrateWorldState, normalizeWorldState } from './world-runtime';

export const MomentumWorldFramework = Object.freeze({
  regions: WORLD_REGIONS,
  frontier: FRONTIER_REGION,
  createInitialWorldState,
  migrateWorldState,
  normalizeWorldState,
  createWorldRuntime
});

if (typeof window !== 'undefined') window.MomentumWorldFramework = MomentumWorldFramework;

export * from './world-types';
export * from './world-definitions';
export * from './world-runtime';
