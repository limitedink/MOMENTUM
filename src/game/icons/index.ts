export {
  COMBAT_SKILL_ICON_MANIFEST,
  ITEM_ICON_MANIFEST,
  PAPER_DOLL_SLOT_ICON_MANIFEST,
  WAYFINDER_ICON_MANIFEST,
  iconForCombatSkill,
  iconForItem,
  iconForPaperDollSlot
} from './icon-manifest';

import * as manifest from './icon-manifest';

export const MomentumIconManifest = Object.freeze({ ...manifest });

if (typeof window !== 'undefined') window.MomentumIconManifest = MomentumIconManifest;
