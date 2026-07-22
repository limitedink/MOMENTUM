export * from './combat-development-types';
export * from './offense-tree-definitions';
export * from './combat-development';

import { MomentumCombatDevelopment } from './combat-development';

if (typeof window !== 'undefined') window.MomentumCombatDevelopment = MomentumCombatDevelopment;
