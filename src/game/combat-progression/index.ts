import { COMBAT_SKILL_DEFINITIONS, COMBAT_SKILL_IDS } from './combat-types';
import * as progression from './combat-progression';
import * as migration from './combat-migration';
import { legacyCombatCompatibility } from './legacy-combat-compatibility';

export * from './combat-types';
export * from './combat-progression';
export * from './combat-migration';
export * from './legacy-combat-compatibility';

export const MomentumCombatProgression = Object.freeze({
  skillIds: COMBAT_SKILL_IDS,
  definitions: COMBAT_SKILL_DEFINITIONS,
  // Module namespace objects carry non-configurable export descriptors in
  // browsers; copy them before freezing the public framework surface.
  progression: Object.freeze({ ...progression }),
  migration: Object.freeze({ ...migration }),
  /** @deprecated Remove with the legacy arena/runtime migration in Goal 4. */
  compatibility: legacyCombatCompatibility
});

if (typeof window !== 'undefined') window.MomentumCombatProgression = MomentumCombatProgression;
