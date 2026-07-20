import { EXPEDITION_DEFINITIONS, COOKING_EXPEDITION_DEFINITION, COMBAT_EXPEDITION_DEFINITION, getExpeditionDefinition } from './expedition-definitions';
import { expeditionRules } from './expedition-rules';
import * as slotPolicy from './expedition-slot-policy';

export * from './expedition-types';
export * from './expedition-definitions';
export * from './expedition-rules';
export * from './expedition-slot-policy';

export const MomentumExpeditions = Object.freeze({
  definitions: EXPEDITION_DEFINITIONS,
  cooking: COOKING_EXPEDITION_DEFINITION,
  combat: COMBAT_EXPEDITION_DEFINITION,
  getDefinition: getExpeditionDefinition,
  rules: expeditionRules,
  slotPolicy
});

if (typeof window !== 'undefined') window.MomentumExpeditions = MomentumExpeditions;
