import { describe, expect, it } from 'vitest';
import {
  COMBAT_SKILL_IDS,
  combatSkillEffectiveLevel,
  migrateV17SaveToV18,
  xpToNextCombatLevel
} from '../src/game/combat-progression';
import {
  MALFORMED_V17_SAVE_FIXTURE,
  MAX_LEVEL_V17_SAVE_FIXTURE,
  NEW_V18_SAVE_FIXTURE,
  REPRESENTATIVE_V17_SAVE_FIXTURE
} from './fixtures/combat-save-fixtures';

describe('v17 to v18 combat save migration', () => {
  it('leaves a new v18 save unchanged', () => {
    expect(migrateV17SaveToV18(NEW_V18_SAVE_FIXTURE)).toBe(NEW_V18_SAVE_FIXTURE);
  });

  it('preserves unrelated state, audits Combat, and keeps existing component values', () => {
    const migrated = migrateV17SaveToV18(REPRESENTATIVE_V17_SAVE_FIXTURE);
    expect(migrated.version).toBe(18);
    expect(migrated.skills).toEqual([
      REPRESENTATIVE_V17_SAVE_FIXTURE.skills[0],
      REPRESENTATIVE_V17_SAVE_FIXTURE.skills[2]
    ]);
    expect(migrated.keys).toBe(REPRESENTATIVE_V17_SAVE_FIXTURE.keys);
    expect(migrated.gold).toBe(REPRESENTATIVE_V17_SAVE_FIXTURE.gold);
    expect(migrated.scrap).toBe(REPRESENTATIVE_V17_SAVE_FIXTURE.scrap);
    expect(migrated.equipment).toEqual(REPRESENTATIVE_V17_SAVE_FIXTURE.equipment);
    expect(migrated.combatTalents).toEqual(REPRESENTATIVE_V17_SAVE_FIXTURE.combatTalents);
    expect(migrated.arenaRecords).toEqual(REPRESENTATIVE_V17_SAVE_FIXTURE.arenaRecords);
    expect(migrated.frontier).toEqual(REPRESENTATIVE_V17_SAVE_FIXTURE.frontier);
    expect(migrated.world).toEqual(REPRESENTATIVE_V17_SAVE_FIXTURE.world);
    expect(migrated.partyState).toEqual(REPRESENTATIVE_V17_SAVE_FIXTURE.partyState);
    expect(migrated.legacyCombat?.combatSkill).toEqual(REPRESENTATIVE_V17_SAVE_FIXTURE.skills[1]);
    expect(migrated.legacyCombat?.componentSkills).toEqual(REPRESENTATIVE_V17_SAVE_FIXTURE.combatComponentSkills);
    expect('combatComponentSkills' in migrated).toBe(false);
    expect(migrated.combatProgression.Strength).toEqual({ level: 12, xp: xpToNextCombatLevel(12) * 0.5 });
    expect(combatSkillEffectiveLevel(migrated.combatProgression.Strength)).toBe(12.5);
    expect(migrated.combatProgression.Marksmanship).toEqual({ level: 9, xp: 0 });
    expect(migrated.combatProgression['Offensive Magic']).toEqual({ level: 7, xp: xpToNextCombatLevel(7) * 0.25 });
    expect(migrated.combatProgression['Support Magic'].level).toBe(6);
  });

  it('normalizes malformed values without losing non-combat data', () => {
    const migrated = migrateV17SaveToV18(MALFORMED_V17_SAVE_FIXTURE);
    expect(migrated.skills).toEqual([null, MALFORMED_V17_SAVE_FIXTURE.skills[2]]);
    expect(migrated.resources).toEqual(MALFORMED_V17_SAVE_FIXTURE.resources);
    expect(migrated.combatProgression.Ranged.level).toBe(6);
    expect(migrated.combatProgression.Ranged.xp).toBe(xpToNextCombatLevel(6) * 0.5);
    for (const skillId of COMBAT_SKILL_IDS) {
      expect(migrated.combatProgression[skillId].level).toBeGreaterThanOrEqual(1);
      expect(migrated.combatProgression[skillId].level).toBeLessThanOrEqual(100);
      expect(Number.isFinite(migrated.combatProgression[skillId].xp)).toBe(true);
    }
  });

  it('is idempotent when migration is repeated', () => {
    const once = migrateV17SaveToV18(REPRESENTATIVE_V17_SAVE_FIXTURE);
    const twice = migrateV17SaveToV18(once);
    expect(twice).toBe(once);
    expect(twice).toEqual(once);
  });

  it('preserves max-level components with finite capped XP', () => {
    const migrated = migrateV17SaveToV18(MAX_LEVEL_V17_SAVE_FIXTURE);
    expect(Object.values(migrated.combatProgression)).toHaveLength(17);
    expect(Object.values(migrated.combatProgression).every(value => value.level === 100 && value.xp === 0)).toBe(true);
    expect(migrated.world).toEqual(MAX_LEVEL_V17_SAVE_FIXTURE.world);
    expect(migrated.partyState).toEqual(MAX_LEVEL_V17_SAVE_FIXTURE.partyState);
  });
});
