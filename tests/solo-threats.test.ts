import { describe, expect, it } from 'vitest';
import { COMBAT_SKILL_IDS } from '../src/game/combat-progression';
import {
  SOLO_THREAT_PROFILES,
  simulateSoloCombat,
  soloFrontierStage,
  type SoloCombatInput,
  type SoloEnemyDefinition
} from '../src/game/solo-frontier';

function enemy(overrides: Partial<SoloEnemyDefinition> = {}): SoloEnemyDefinition {
  return {
    id: 'threat-test-enemy',
    name: 'Threat Test Enemy',
    kind: 'regular',
    hitPoints: 1_000_000_000,
    damage: 1,
    armour: 20,
    ward: 20,
    evasion: 1_000,
    accuracy: 1_000,
    attackInterval: 0.1,
    damageType: 'physical',
    ...overrides
  };
}

function input(enemyDefinition: SoloEnemyDefinition): SoloCombatInput {
  return {
    combatSkills: Object.fromEntries(COMBAT_SKILL_IDS.map(skillId => [skillId, 1])),
    equippedStats: { hitPoints: 1_000_000, accuracy: 0, evasion: 0, ward: 20, armourPieces: [{ id: 'mail', armourClass: 'medium', armour: 50 }] },
    activeWeapon: { id: 'slow', name: 'Slow', style: 'medium-melee', damage: 0, accuracy: 0, attackInterval: 100 },
    stance: 'Balanced',
    technique: 'Power Strike',
    defensiveAbility: 'none',
    aura: 'none',
    enemy: enemyDefinition,
    stage: 10,
    seed: 'threat-test'
  } as unknown as SoloCombatInput;
}

describe('v21.2 Solo threat profiles', () => {
  it('assigns the approved threat profile to every stage', () => {
    expect(Array.from({ length: 30 }, (_, index) => soloFrontierStage(index + 1).enemy.threat?.profileId)).toEqual([
      'standard', 'standard', 'standard', 'skirmisher', 'breaker', 'standard', 'arcanist', 'spellblade', 'breaker', 'initiate',
      'skirmisher', 'breaker', 'arcanist', 'spellblade', 'skirmisher', 'standard', 'arcanist', 'breaker', 'spellblade', 'vanguard',
      'skirmisher', 'breaker', 'arcanist', 'spellblade', 'skirmisher', 'breaker', 'arcanist', 'spellblade', 'breaker', 'apex'
    ]);
  });

  it('preserves legacy single-physical behavior when threat metadata is absent', () => {
    const legacy = simulateSoloCombat(input(enemy()));
    const explicitStandard = simulateSoloCombat(input(enemy({ threat: SOLO_THREAT_PROFILES.standard })));
    expect(explicitStandard).toEqual(legacy);
  });

  it('cycles mixed damage types without adding random rolls', () => {
    const result = simulateSoloCombat(input(enemy({ threat: SOLO_THREAT_PROFILES.spellblade })));
    const attacks = result.events.filter(event => event.type === 'attack' && event.actor === 'enemy').slice(0, 6);
    expect(attacks).toHaveLength(6);
    expect(attacks.map(event => event.type === 'attack' ? event.damageType : null)).toEqual(['physical', 'magical', 'physical', 'magical', 'physical', 'magical']);
  });

  it('keeps profile intervals and penetration data on the authoritative definitions', () => {
    expect(SOLO_THREAT_PROFILES.skirmisher.intervalMultiplier).toBe(0.72);
    expect(SOLO_THREAT_PROFILES.breaker.attackCycle[0]).toMatchObject({ damageType: 'physical', tag: 'heavy', armourPenetrationPct: 0.20 });
    expect(SOLO_THREAT_PROFILES.arcanist.attackCycle[0]).toMatchObject({ damageType: 'magical', tag: 'arcane', wardPenetrationPct: 0.10 });
  });
});
