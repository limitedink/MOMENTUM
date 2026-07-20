import { describe, expect, it } from 'vitest';
import {
  COMBAT_EXPEDITION_DEFINITION,
  COOKING_EXPEDITION_DEFINITION,
  convertLegacyCombatProfile,
  deriveCombatProfile,
  forecastExpedition,
  respecCombatSkills,
  respecCost,
  resolveExpeditionOutcome,
  scoreRoleFit,
  type ExpeditionAssignment,
  type PlayerProfileSnapshot
} from '../src/game/expeditions';

function profile(overrides: Partial<PlayerProfileSnapshot> = {}): PlayerProfileSnapshot {
  return {
    playerId: 'player-1',
    combatSkills: {
      Strength: 12,
      'Melee Accuracy': 12,
      Marksmanship: 8,
      Ranged: 8,
      Magic: 6,
      Reflexes: 10,
      Healing: 5,
      'Light Armour Proficiency': 8,
      'Medium Armour Proficiency': 10,
      'Heavy Armour Proficiency': 4
    },
    skills: { Mining: 8, Smithing: 8, Crafting: 10, Fishing: 12, Cooking: 14, Woodcutting: 10, Music: 5 },
    gold: 10_000,
    gear: [{ id: 'blade', slot: 'weapon', power: 12, tags: ['melee'] }, { id: 'mail', slot: 'armor', defense: 16, tags: ['medium'] }],
    equippedGearIds: ['blade', 'mail'],
    talents: ['guardian-step'],
    loadout: { weaponStyle: 'melee', armourWeight: 'medium' },
    ...overrides
  };
}

function assignment(slotId: string, playerId: string, roleId: string, targetId?: string): ExpeditionAssignment {
  return { slotId, playerId, roleId, targetId, active: true, assignedAt: '2026-07-20T00:00:00.000Z' };
}

describe('expedition combat profile rules', () => {
  it('converts legacy Combat progression into a balanced component profile', () => {
    const converted = convertLegacyCombatProfile({ playerId: 'legacy', combatLevel: 20, gold: 400 });
    expect(converted.combatSkills.Strength).toBe(20);
    expect(converted.combatSkills['Medium Armour Proficiency']).toBe(18);
    expect(Number(converted.combatSkills.Healing)).toBeLessThan(Number(converted.combatSkills.Strength));
    expect(converted.skills?.Combat).toBe(20);
  });

  it('derives combat and defense ratings from skills, gear, affixes, talents, and loadout', () => {
    const bare = deriveCombatProfile(profile({ gear: [], equippedGearIds: [], talents: [], loadout: {} }));
    const equipped = deriveCombatProfile(profile({
      gear: [{ id: 'aegis', slot: 'armor', power: 30, defense: 40, tags: ['heavy'], affixes: [{ id: 'guard', stat: 'defense', value: 8 }] }],
      equippedGearIds: ['aegis'],
      talents: ['guardian-step', 'guardian-capstone'],
      loadout: { weaponStyle: 'support', armourWeight: 'heavy' }
    }));
    expect(equipped.combatRating).toBeGreaterThan(bare.combatRating);
    expect(equipped.defenseRating).toBeGreaterThan(bare.defenseRating);
    expect(equipped.tags).toContain('heavy');
  });

  it('charges Gold for a valid respec and rejects allocations that exceed the converted profile', () => {
    const current = profile({ legacyCombatLevel: 12 });
    const cost = respecCost(current);
    const accepted = respecCombatSkills(current, current.combatSkills);
    expect(cost).toBe(400);
    expect(accepted.accepted).toBe(true);
    expect(accepted.profile.gold).toBe(9_600);
    expect(respecCombatSkills(current, { Strength: 99 }).reason).toBe('invalid_allocation');
  });
});

describe('expedition role and outcome rules', () => {
  it('scores target farming requirements instead of trusting a client-provided success value', () => {
    const lowFishing = profile({ skills: { Fishing: 1, Cooking: 14 } });
    const fit = scoreRoleFit(COOKING_EXPEDITION_DEFINITION, 'forager', lowFishing, 'river-run');
    expect(fit.targetRequirementMet).toBe(false);
    expect(fit.missingRequirements).toContain('Target skill: Fishing 3');
    expect(fit.score).toBeLessThan(70);
  });

  it('applies duplicate-role and solo multi-slot penalties while rewarding coverage', () => {
    const player = profile();
    const profiles = { [player.playerId]: player };
    const duplicate = forecastExpedition(COMBAT_EXPEDITION_DEFINITION, [
      assignment('slot-1', player.playerId, 'dps', 'mire-stalker'),
      assignment('slot-2', player.playerId, 'dps', 'mire-stalker'),
      assignment('slot-3', player.playerId, 'dps', 'mire-stalker'),
      assignment('slot-4', player.playerId, 'dps', 'mire-stalker')
    ], profiles);
    const covered = forecastExpedition(COMBAT_EXPEDITION_DEFINITION, [
      assignment('slot-1', player.playerId, 'dps', 'mire-stalker'),
      assignment('slot-2', 'player-2', 'tank', 'mire-stalker'),
      assignment('slot-3', 'player-3', 'healer', 'mire-stalker'),
      assignment('slot-4', 'player-4', 'support', 'mire-stalker')
    ], { ...profiles, 'player-2': profile({ playerId: 'player-2' }), 'player-3': profile({ playerId: 'player-3' }), 'player-4': profile({ playerId: 'player-4' }) });
    expect(duplicate.duplicateRolePenalty).toBeGreaterThan(0);
    expect(duplicate.soloEfficiency).toBeLessThan(1);
    expect(covered.roleCoveragePercent).toBeGreaterThan(duplicate.roleCoveragePercent);
  });

  it('uses the exact per-player slot efficiency curve and keeps separate players at full efficiency', () => {
    const solo = profile({ playerId: 'solo' });
    const soloForecast = forecastExpedition(COMBAT_EXPEDITION_DEFINITION, [
      assignment('slot-1', 'solo', 'dps'),
      assignment('slot-2', 'solo', 'dps'),
      assignment('slot-3', 'solo', 'dps'),
      assignment('slot-4', 'solo', 'dps')
    ], { solo });
    expect(soloForecast.assignments.map(item => item.fit.slotEfficiency)).toEqual([1, 0.85, 0.65, 0.45]);
    expect(soloForecast.soloEfficiency).toBe(0.74);

    const partyForecast = forecastExpedition(COMBAT_EXPEDITION_DEFINITION, [
      assignment('slot-1', 'one', 'dps'),
      assignment('slot-2', 'two', 'tank'),
      assignment('slot-3', 'three', 'healer'),
      assignment('slot-4', 'four', 'support')
    ], {
      one: profile({ playerId: 'one' }),
      two: profile({ playerId: 'two' }),
      three: profile({ playerId: 'three' }),
      four: profile({ playerId: 'four' })
    });
    expect(partyForecast.assignments.map(item => item.fit.slotEfficiency)).toEqual([1, 1, 1, 1]);
    expect(partyForecast.soloEfficiency).toBe(1);
    expect(partyForecast.reward.resources['Mire Resin']).toBeGreaterThan(soloForecast.reward.resources['Mire Resin']);
  });

  it('keeps farming rewards when a combat expedition fails', () => {
    const player = profile({ playerId: 'player-1' });
    const result = resolveExpeditionOutcome(
      COMBAT_EXPEDITION_DEFINITION,
      'mission-fail',
      [assignment('slot-1', player.playerId, 'dps', 'cave-warden')],
      { [player.playerId]: player },
      () => 0.999,
      '2026-07-20T02:00:00.000Z'
    );
    expect(result.status).toBe('failed');
    expect(result.completionLedger).toBeNull();
    expect(result.farmingLedger.status).toBe('preserved-on-failure');
    expect(Object.keys(result.farmingLedger.farmingByPlayer)).toContain(player.playerId);
  });

  it('uses quality tiers instead of hard failure for cooking', () => {
    const player = profile({ playerId: 'cook', skills: { Cooking: 1 } });
    const result = resolveExpeditionOutcome(
      COOKING_EXPEDITION_DEFINITION,
      'mission-cook',
      [assignment('slot-1', player.playerId, 'cooking')],
      { [player.playerId]: player },
      () => 0.999,
      '2026-07-20T02:00:00.000Z'
    );
    expect(result.status).toBe('completed');
    expect(result.completionLedger?.completionTierId).toBe('rough');
  });
});
