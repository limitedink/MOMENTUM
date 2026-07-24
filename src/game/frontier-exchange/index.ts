export * from './frontier-exchange-types';
export * from './frontier-exchange';

import * as exchange from './frontier-exchange';
import { ARMOUR_GEAR_CATEGORIES, COMBAT_GEAR_CATEGORIES } from './frontier-exchange-types';

export const MomentumFrontierExchange = Object.freeze({ ...exchange, COMBAT_GEAR_CATEGORIES, ARMOUR_GEAR_CATEGORIES });

if (typeof window !== 'undefined') window.MomentumFrontierExchange = MomentumFrontierExchange;
