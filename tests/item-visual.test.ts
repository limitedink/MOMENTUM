import { describe, expect, it } from 'vitest';
import {
  RARITY_DEFINITIONS,
  createEquipmentLoadout,
  createLootCache,
  describeItemVisual,
  getItemDefinition,
  type ItemInstance
} from '../src/game/loot';

describe('v21 item visual contract', () => {
  it('keeps every authoritative rarity frame while equipped and marks active weapons separately', () => {
    for (const rarity of RARITY_DEFINITIONS) {
      const definition = getItemDefinition('iron-blade')!;
      const instance: ItemInstance = {
        instanceId: `visual-${rarity.id}`,
        definitionId: definition.id,
        rarity: rarity.id,
        itemLevel: 21,
        affixes: [],
        signatureId: definition.signatureId,
        sourceId: 'visual-test',
        acquiredAt: 1,
        rerolls: 0,
        enhancementRank: 0
      };
      const cache = createLootCache({
        items: [instance],
        favoriteIds: [instance.instanceId],
        equipment: createEquipmentLoadout({ melee: instance.instanceId, activeWeaponSlot: 'melee' })
      });
      const visual = describeItemVisual(instance, cache, { isNew: true })!;
      expect(visual.rarity?.id).toBe(rarity.id);
      expect(visual.rarityColor).toBe(rarity.color);
      expect(visual.equipped).toBe(true);
      expect(visual.active).toBe(true);
      expect(visual.favorite).toBe(true);
      expect(visual.isNew).toBe(true);
      expect(visual.icon.kind).toBe('asset');
    }
  });
});
