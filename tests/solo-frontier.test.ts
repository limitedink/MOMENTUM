import { describe, expect, it } from 'vitest';
import {
  COMBAT_SKILL_IDS,
  combatUseBySkill,
  type CombatSkillId
} from '../src/game/combat-progression';
import {
  SOLO_FRONTIER_STAGES,
  SOLO_FRONTIER_BALANCE,
  STANCE_MODIFIERS,
  calculateArmourMitigation,
  calculateHitChance,
  calculateMagicalMitigation,
  createSoloFrontierEnemy,
  deriveSoloPlayerStats,
  simulateSoloCombat,
  soloFrontierStage,
  type ActiveWeaponSnapshot,
  type CombatSkillSnapshot,
  type SoloCombatInput,
  type SoloEnemyDefinition,
  type WeaponStyle
} from '../src/game/solo-frontier';

function skillSnapshot(level = 20, overrides: Partial<Record<CombatSkillId, number>> = {}): CombatSkillSnapshot {
  return Object.fromEntries(COMBAT_SKILL_IDS.map(skillId => [skillId, overrides[skillId] ?? level])) as unknown as CombatSkillSnapshot;
}

const TECHNIQUE_BY_STYLE: Readonly<Record<WeaponStyle, SoloCombatInput['technique']>> = {
  'light-melee': 'Power Strike',
  'medium-melee': 'Power Strike',
  'heavy-melee': 'Power Strike',
  gun: 'Burst Fire',
  ranged: 'Piercing Shot',
  magic: 'Arc Bolt'
};

function weapon(style: WeaponStyle = 'medium-melee', overrides: Partial<ActiveWeaponSnapshot> = {}): ActiveWeaponSnapshot {
  return {
    id: `test-${style}`,
    name: `Test ${style}`,
    style,
    damage: 18,
    accuracy: 8,
    attackInterval: 1.4,
    ...overrides
  };
}

function enemy(overrides: Partial<SoloEnemyDefinition> = {}): SoloEnemyDefinition {
  return {
    id: 'test-enemy',
    name: 'Test Enemy',
    kind: 'regular',
    hitPoints: 240,
    damage: 8,
    armour: 12,
    ward: 8,
    evasion: 8,
    accuracy: 10,
    attackInterval: 1.6,
    damageType: 'physical',
    ...overrides
  };
}

function combatInput(overrides: Partial<SoloCombatInput> = {}): SoloCombatInput {
  return {
    combatSkills: skillSnapshot(),
    equippedStats: {
      hitPoints: 20,
      accuracy: 6,
      evasion: 5,
      ward: 18,
      armourPieces: [
        { id: 'mail', armourClass: 'medium', armour: 28 }
      ],
      criticalChanceBonus: 0.02,
      criticalMultiplierBonus: 0.1
    },
    activeWeapon: weapon(),
    stance: 'Balanced',
    technique: 'Power Strike',
    defensiveAbility: 'Mend',
    aura: 'Battle Focus',
    enemy: enemy(),
    stage: 5,
    seed: 'frontier-test',
    ...overrides
  };
}

describe('Solo Frontier stage definitions', () => {
  it('creates exactly stages 1-30 with the regular tuning and clear requirements', () => {
    expect(SOLO_FRONTIER_STAGES.map(definition => definition.stage)).toEqual(Array.from({ length: 30 }, (_, index) => index + 1));
    for (const definition of SOLO_FRONTIER_STAGES) {
      const stage = definition.stage;
      const boss = stage === 10 || stage === 20 || stage === 30;
      const tuning = SOLO_FRONTIER_BALANCE.enemy;
      const baseHitPoints = Math.round(tuning.baseHitPoints * tuning.hitPointGrowth ** (stage - 1));
      const earlyDamageExponent = Math.min(stage - 1, tuning.earlyDamageStages);
      const lateDamageExponent = Math.max(0, stage - 1 - tuning.earlyDamageStages);
      const baseDamage = Math.round(tuning.baseDamage * tuning.earlyDamageGrowth ** earlyDamageExponent * tuning.lateDamageGrowth ** lateDamageExponent);
      const baseArmour = Math.round(tuning.baseArmour + tuning.armourPerStage * stage);
      const expectedVictories = boss ? 1 : stage < 5 ? 25 : stage < 8 ? 30 : stage < 10 ? 600 : stage < 20 ? 3_300 : 8_000;
      expect(definition.victoriesToClear).toBe(expectedVictories);
      expect(definition.encounterTimeoutSeconds).toBe(60);
      expect(definition.enemy.hitPoints).toBe(boss ? Math.round(baseHitPoints * tuning.bossHitPointMultiplier) : baseHitPoints);
      expect(definition.enemy.damage).toBe(boss ? Math.round(baseDamage * tuning.bossDamageMultiplier) : baseDamage);
      expect(definition.enemy.armour).toBe(boss ? Math.round(baseArmour * tuning.bossArmourMultiplier) : baseArmour);
      expect(definition.enemy.evasion).toBe(tuning.baseEvasion + tuning.evasionPerStage * stage);
      expect(definition.enemy.attackInterval).toBe(Math.max(tuning.minimumAttackInterval, tuning.baseAttackInterval - tuning.attackIntervalPerStage * stage));
    }
  });

  it('uses the three named one-victory bosses and rejects out-of-route stages', () => {
    expect([10, 20, 30].map(stage => soloFrontierStage(stage).enemy.name)).toEqual(['Initiate', 'Vanguard', 'Apex']);
    expect([10, 20, 30].map(stage => soloFrontierStage(stage).enemy.kind)).toEqual(['boss', 'boss', 'boss']);
    expect(() => createSoloFrontierEnemy(0)).toThrow(RangeError);
    expect(() => soloFrontierStage(31)).toThrow(RangeError);
  });
});

describe('derived player formulas', () => {
  it('applies skills, piece proficiency, critical bases, Reflexes, then stance modifiers', () => {
    const input = combatInput({
      combatSkills: skillSnapshot(0, {
        Strength: 20,
        'Melee Accuracy': 25,
        'Medium Melee Weapon Proficiency': 30,
        Reflexes: 100,
        Vitality: 10,
        Evasion: 12,
        'Medium Armour Proficiency': 40
      }),
      equippedStats: {
        hitPoints: 5,
        accuracy: 7,
        evasion: 3,
        ward: 20,
        armourPieces: [{ id: 'mail', armourClass: 'medium', armour: 50 }],
        criticalChanceBonus: 0.1,
        criticalMultiplierBonus: 0.2
      },
      activeWeapon: weapon('medium-melee', { damage: 10, accuracy: 8, attackInterval: 2 }),
      stance: 'Guarded',
      enemy: enemy({ evasion: 20, accuracy: 30 }),
      stage: 5
    });
    const derived = deriveSoloPlayerStats(input);
    expect(derived.maxHitPoints).toBe(125);
    expect(derived.damage).toBeCloseTo(10 * (1 + 0.006 * 20 + 0.004 * 30) * STANCE_MODIFIERS.Guarded.damage, 6);
    expect(derived.accuracy).toBe(7 + 8 + 25);
    expect(derived.evasion).toBe(3 + 12);
    expect(derived.armour).toBeCloseTo(50 * (1 + 0.005 * 40) * STANCE_MODIFIERS.Guarded.armour, 6);
    expect(derived.ward).toBe(20 * STANCE_MODIFIERS.Guarded.ward);
    expect(derived.attackInterval).toBeCloseTo(2 * (1 - 0.002 * 100) * STANCE_MODIFIERS.Guarded.attackInterval, 6);
    expect(derived.criticalChance).toBe(0.15);
    expect(derived.criticalMultiplier).toBe(1.7);
  });

  it('implements the exact hit and mitigation clamps', () => {
    expect(calculateHitChance(0, 1_000)).toBe(0.20);
    expect(calculateHitChance(1_000, 0)).toBe(0.98);
    expect(calculateHitChance(40, 20)).toBe(0.85);
    expect(calculateArmourMitigation(200, 10)).toBe(0.5);
    expect(calculateArmourMitigation(10_000, 1)).toBe(0.75);
    expect(calculateMagicalMitigation(200, 10)).toBe(0.5);
    expect(calculateMagicalMitigation(10_000, 1)).toBe(0.60);
  });

  it('caps the Reflexes interval reduction at 35 percent', () => {
    const derived = deriveSoloPlayerStats(combatInput({
      combatSkills: skillSnapshot(0, { Reflexes: 1_000 }),
      activeWeapon: weapon('medium-melee', { attackInterval: 2 }),
      stance: 'Balanced'
    }));
    expect(derived.attackInterval).toBe(1.3);
  });

  it('covers light, medium, and heavy piece proficiency independently', () => {
    const derived = deriveSoloPlayerStats(combatInput({
      combatSkills: skillSnapshot(0, {
        'Light Armour Proficiency': 10,
        'Medium Armour Proficiency': 20,
        'Heavy Armour Proficiency': 30
      }),
      equippedStats: {
        hitPoints: 0,
        accuracy: 0,
        evasion: 0,
        ward: 0,
        armourPieces: [
          { id: 'light', armourClass: 'light', armour: 10 },
          { id: 'medium', armourClass: 'medium', armour: 10 },
          { id: 'heavy', armourClass: 'heavy', armour: 10 }
        ]
      },
      stance: 'Balanced'
    }));
    expect(derived.armour).toBe(10 * 1.05 + 10 * 1.10 + 10 * 1.15);
  });
});

describe('weapon styles, starter abilities, and stances', () => {
  it.each(Object.keys(TECHNIQUE_BY_STYLE) as WeaponStyle[])('executes the valid starter technique for %s', style => {
    const technique = TECHNIQUE_BY_STYLE[style];
    const result = simulateSoloCombat(combatInput({
      activeWeapon: weapon(style, { damage: 50, attackInterval: 1 }),
      technique,
      enemy: enemy({ hitPoints: 500 }),
      seed: `style:${style}`
    }));
    expect(result.effectiveTechnique).toBe(technique);
    expect(result.events.some(event => event.type === 'ability-used' && event.ability === technique)).toBe(true);
    expect(result.skillEvents.length).toBeGreaterThan(0);
  });

  it('routes Arena-ready weapon paths through their own use-based skills', () => {
    const expected = {
      'light-melee': 'Strength',
      'medium-melee': 'Strength',
      'heavy-melee': 'Strength',
      gun: 'Marksmanship',
      ranged: 'Ranged',
      magic: 'Offensive Magic'
    } as const;
    for (const style of Object.keys(expected) as WeaponStyle[]) {
      const result = simulateSoloCombat(combatInput({
        activeWeapon: weapon(style, { damage: 50, attackInterval: 1 }),
        technique: TECHNIQUE_BY_STYLE[style],
        enemy: enemy({ hitPoints: 500 }),
        seed: `arena-style-xp:${style}`
      }));
      expect(combatUseBySkill(result.skillEvents)[expected[style]]).toBeGreaterThan(0);
    }
  });

  it('scales Mend, Arcane Barrier, and Battle Focus with their matching skills', () => {
    const scaledSkills = skillSnapshot(0, { Healing: 50, Warding: 50, 'Support Magic': 40, Vitality: 20 });
    const hardEnemy = enemy({ hitPoints: 10_000, damage: 55, accuracy: 1_000, attackInterval: 1 });
    const mend = simulateSoloCombat(combatInput({
      combatSkills: scaledSkills,
      defensiveAbility: 'Mend',
      aura: 'Battle Focus',
      enemy: hardEnemy,
      seed: 'mend-scaling'
    }));
    const healEvent = mend.events.find(event => event.type === 'healing');
    const auraEvent = mend.events.find(event => event.type === 'aura-activated');
    expect(healEvent && healEvent.type === 'healing' ? healEvent.amount : 0).toBe(Math.round(24 * (1 + 0.006 * 50)));
    expect(auraEvent && auraEvent.type === 'aura-activated' ? auraEvent.damageBonus : 0).toBe(0.1 * (1 + 0.005 * 40));
    expect(combatUseBySkill(mend.skillEvents).Healing).toBeGreaterThan(0);
    expect(combatUseBySkill(mend.skillEvents)['Support Magic']).toBeGreaterThan(0);

    const barrier = simulateSoloCombat(combatInput({
      combatSkills: scaledSkills,
      defensiveAbility: 'Arcane Barrier',
      aura: 'none',
      enemy: hardEnemy,
      seed: 'barrier-scaling'
    }));
    expect(barrier.metrics.sustain.barrierGranted).toBeGreaterThanOrEqual(Math.round(24 * (1 + 0.006 * 50)));
    expect(barrier.metrics.sustain.barrierAbsorbed).toBeGreaterThan(0);
    expect(combatUseBySkill(barrier.skillEvents).Warding).toBeGreaterThan(0);
  });

  it('applies all three stances to the same pre-stance derived stats', () => {
    const balanced = deriveSoloPlayerStats(combatInput({ stance: 'Balanced' }));
    const aggressive = deriveSoloPlayerStats(combatInput({ stance: 'Aggressive' }));
    const guarded = deriveSoloPlayerStats(combatInput({ stance: 'Guarded' }));
    expect(aggressive.damage).toBeCloseTo(balanced.damage * STANCE_MODIFIERS.Aggressive.damage, 5);
    expect(aggressive.armour).toBeCloseTo(balanced.armour * STANCE_MODIFIERS.Aggressive.armour, 5);
    expect(guarded.damage).toBeCloseTo(balanced.damage * STANCE_MODIFIERS.Guarded.damage, 5);
    expect(guarded.armour).toBeCloseTo(balanced.armour * STANCE_MODIFIERS.Guarded.armour, 5);
  });

  it('falls back to Basic Attack and warns for an incompatible weapon technique', () => {
    const result = simulateSoloCombat(combatInput({
      activeWeapon: weapon('magic'),
      technique: 'Burst Fire',
      defensiveAbility: 'none',
      aura: 'none'
    }));
    expect(result.effectiveTechnique).toBe('Basic Attack');
    expect(result.warnings).toEqual(['Weapon technique "Burst Fire" is incompatible with magic; Basic Attack used instead.']);
    expect(result.events.some(event => event.type === 'attack' && event.actor === 'player' && event.action === 'Basic Attack')).toBe(true);
  });
});

describe('seeded encounter outcomes and diagnostics', () => {
  it.each([10, 20, 30])('simulates boss stage %i through the same renderer-free engine', stage => {
    const definition = soloFrontierStage(stage);
    const result = simulateSoloCombat(combatInput({
      combatSkills: skillSnapshot(100),
      activeWeapon: weapon('magic', { damage: 2_000, attackInterval: 0.2 }),
      technique: 'Arc Bolt',
      defensiveAbility: 'Arcane Barrier',
      enemy: definition.enemy,
      stage,
      seed: `boss:${stage}`
    }));
    expect(definition.enemy.kind).toBe('boss');
    expect(result.outcome).toBe('victory');
    expect(result.termination).toBe('enemy-defeated');
  });

  it('times out exactly at 60 seconds and diagnoses low hit rate versus insufficient damage', () => {
    const durableEnemy = enemy({ hitPoints: 1_000_000, damage: 1, evasion: 1_000, attackInterval: 100 });
    const lowAccuracy = simulateSoloCombat(combatInput({
      combatSkills: skillSnapshot(0),
      activeWeapon: weapon('magic', { damage: 1, accuracy: 0, attackInterval: 1 }),
      technique: 'Arc Bolt',
      defensiveAbility: 'none',
      aura: 'none',
      enemy: durableEnemy,
      seed: 'timeout-low-accuracy'
    }));
    expect(lowAccuracy.termination).toBe('timeout');
    expect(lowAccuracy.timedOut).toBe(true);
    expect(lowAccuracy.metrics.durationSeconds).toBe(60);
    expect(lowAccuracy.metrics.defeatReason).toBe('low-hit-rate');

    const accurate = simulateSoloCombat(combatInput({
      combatSkills: skillSnapshot(100),
      activeWeapon: weapon('magic', { damage: 1, accuracy: 1_000, attackInterval: 1 }),
      technique: 'Arc Bolt',
      defensiveAbility: 'none',
      aura: 'none',
      enemy: { ...durableEnemy, evasion: 0 },
      seed: 'timeout-accurate'
    }));
    expect(accurate.metrics.hitRate.playerRate).toBeGreaterThan(0.5);
    expect(accurate.metrics.defeatReason).toBe('insufficient-damage');
  });

  it('diagnoses physical, magical, and sustain defeats from concrete encounter evidence', () => {
    const lethal = enemy({ hitPoints: 10_000, damage: 10_000, accuracy: 1_000, attackInterval: 0.05 });
    const physical = simulateSoloCombat(combatInput({ defensiveAbility: 'none', aura: 'none', enemy: lethal, seed: 'physical-defeat' }));
    const magical = simulateSoloCombat(combatInput({ defensiveAbility: 'none', aura: 'none', enemy: { ...lethal, damageType: 'magical' }, seed: 'magical-defeat' }));
    const sustain = simulateSoloCombat(combatInput({ defensiveAbility: 'Arcane Barrier', aura: 'none', enemy: lethal, seed: 'sustain-defeat' }));
    expect(physical.metrics.defeatReason).toBe('low-physical-mitigation');
    expect(magical.metrics.defeatReason).toBe('low-magical-mitigation');
    expect(sustain.metrics.sustain.barrierAbsorbed).toBeGreaterThan(0);
    expect(sustain.metrics.defeatReason).toBe('insufficient-sustain');
  });

  it('emits ordered progression events and complete combat metrics', () => {
    const result = simulateSoloCombat(combatInput({ seed: 'event-contract' }));
    expect(result.events[0]).toMatchObject({ sequence: 0, atMs: 0, type: 'encounter-started' });
    expect(result.events.at(-1)).toMatchObject({ type: 'encounter-ended', outcome: result.outcome });
    expect(result.events.every((event, index) => event.sequence === index)).toBe(true);
    expect(result.events.every((event, index, events) => index === 0 || event.atMs >= events[index - 1].atMs)).toBe(true);
    expect(result.metrics.damage.dealt).toBeGreaterThan(0);
    expect(result.metrics.hitRate.playerAttempts).toBeGreaterThan(0);
    expect(result.metrics.mitigation.armourRate).toBeGreaterThan(0);
    expect(combatUseBySkill(result.skillEvents).Strength).toBeGreaterThan(0);
  });

  it('is byte-equivalent for the same seed and inputs without mutating its snapshots', () => {
    const input = combatInput({ seed: 'byte-for-byte', enemy: enemy({ hitPoints: 2_000 }) });
    const before = JSON.stringify(input);
    const first = JSON.stringify(simulateSoloCombat(input));
    const second = JSON.stringify(simulateSoloCombat(input));
    expect(second).toBe(first);
    expect(JSON.stringify(input)).toBe(before);
    expect(JSON.stringify(simulateSoloCombat({ ...input, seed: 'different-seed' }))).not.toBe(first);
  });
});
