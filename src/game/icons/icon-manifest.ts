import { COMBAT_SKILL_DEFINITIONS, type CombatSkillId } from '../combat-progression';
import { COMBAT_LOOT_DEFINITIONS } from '../loot/loot-definitions';
import { PAPER_DOLL_SLOT_IDS, type IconRef, type PaperDollSlot } from '../loot/loot-types';

const slug = (value: string): string => value
  .toLowerCase()
  .replace(/[^a-z0-9]+/g, '-')
  .replace(/^-|-$/g, '');

export const ITEM_ICON_MANIFEST: Readonly<Record<string, IconRef>> = Object.freeze(Object.fromEntries(
  COMBAT_LOOT_DEFINITIONS.map(definition => [definition.iconId, {
    kind: 'asset' as const,
    id: definition.iconId,
    src: `./assets/icons/items/${definition.id}.webp`,
    alt: definition.name
  }])
));

export const COMBAT_SKILL_ICON_MANIFEST: Readonly<Record<CombatSkillId, IconRef>> = Object.freeze(Object.fromEntries(
  COMBAT_SKILL_DEFINITIONS.map(definition => [definition.id, {
    kind: 'asset' as const,
    id: `skill:${slug(definition.id)}`,
    src: `./assets/icons/combat-skills/${slug(definition.id)}.webp`,
    alt: definition.name
  }])
) as Record<CombatSkillId, IconRef>);

export const PAPER_DOLL_SLOT_ICON_MANIFEST: Readonly<Record<PaperDollSlot, IconRef>> = Object.freeze(Object.fromEntries(
  PAPER_DOLL_SLOT_IDS.map(slot => [slot, {
    kind: 'asset' as const,
    id: `slot:${slot}`,
    src: `./assets/icons/equipment-slots/${slot}.webp`,
    alt: `${slot.replace(/([0-9])/g, ' $1')} slot`
  }])
) as Record<PaperDollSlot, IconRef>);

export const WAYFINDER_ICON_MANIFEST: Readonly<Record<string, IconRef>> = Object.freeze({
  ...ITEM_ICON_MANIFEST,
  ...Object.fromEntries(Object.values(COMBAT_SKILL_ICON_MANIFEST).map(icon => [icon.id, icon])),
  ...Object.fromEntries(Object.values(PAPER_DOLL_SLOT_ICON_MANIFEST).map(icon => [icon.id, icon]))
});

export function iconForItem(iconId: string): IconRef {
  return ITEM_ICON_MANIFEST[iconId] || PAPER_DOLL_SLOT_ICON_MANIFEST.trinket1;
}

export function iconForCombatSkill(skillId: CombatSkillId): IconRef {
  return COMBAT_SKILL_ICON_MANIFEST[skillId];
}

export function iconForPaperDollSlot(slot: PaperDollSlot): IconRef {
  return PAPER_DOLL_SLOT_ICON_MANIFEST[slot];
}
