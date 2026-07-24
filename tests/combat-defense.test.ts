import { describe, expect, it } from 'vitest';
import {
  COMBAT_SKILL_TREES,
  allocateCombatTreeNode,
  createCombatDevelopmentState,
  resolveArenaDefenseProfile,
  resolveCombatDefenseProfile,
  resolveCombatModifierSnapshot,
  type CombatModifierSnapshot,
  type CombatTreeEffectDefinition
} from '../src/game/combat-development';
import { COMBAT_SKILL_IDS, createInitialCombatProgression } from '../src/game/combat-progression';
import { normalizeSoloFrontierState, type SoloCombatEvent, type SoloCombatInput } from '../src/game/solo-frontier';
import { simulateSoloCombat } from '../src/game/solo-frontier/solo-combat-engine';

function emptySnapshot(effects: readonly CombatTreeEffectDefinition[] = []): CombatModifierSnapshot {
  const snapshot = resolveCombatModifierSnapshot(createCombatDevelopmentState(), createInitialCombatProgression());
  return { ...snapshot, effects, effectIds: effects.map(effect => effect.id) };
}

function defenseInput(combatModifiers: CombatModifierSnapshot, overrides: Partial<SoloCombatInput> = {}): SoloCombatInput {
  return {
    combatSkills: Object.fromEntries(COMBAT_SKILL_IDS.map(skillId => [skillId, 100])) as SoloCombatInput['combatSkills'],
    equippedStats: {
      hitPoints: 100,
      accuracy: 30,
      evasion: 0,
      ward: 10,
      armourPieces: Array.from({ length: 6 }, (_, index) => ({ id: `heavy-${index}`, armourClass: 'heavy' as const, armour: 20 }))
    },
    activeWeapon: { id: 'defense-test-weapon', name: 'Defense Test Weapon', style: 'medium-melee', damage: 5, accuracy: 30, attackInterval: 0.5 },
    stance: 'Balanced',
    technique: 'Power Strike',
    defensiveAbility: 'none',
    aura: 'none',
    enemy: {
      id: 'defense-test-enemy',
      name: 'Defense Test Enemy',
      kind: 'regular',
      hitPoints: 100_000,
      damage: 35,
      armour: 0,
      ward: 0,
      evasion: 0,
      accuracy: 1_000,
      attackInterval: 0.2,
      damageType: 'physical'
    },
    stage: 20,
    seed: 'defense-engine-test',
    combatModifiers,
    ...overrides
  };
}

describe('v21.2 Defense modifier platform', () => {
  it('resolves armour conditions and enforces static Defense caps', () => {
    const effects: CombatTreeEffectDefinition[] = [
      { id: 'heavy-armour', skillId: 'Heavy Armour Proficiency', kind: 'stat', stat: 'armourPct', value: 0.60, condition: { armourClass: 'heavy', minimumArmourPieces: 6 } },
      { id: 'ward-cap', skillId: 'Warding', kind: 'stat', stat: 'wardPct', value: 0.90 },
      { id: 'evasion-cap', skillId: 'Evasion', kind: 'stat', stat: 'evasionFlat', value: 50 },
      { id: 'hit-reduction-cap', skillId: 'Evasion', kind: 'stat', stat: 'enemyHitChanceReduction', value: 0.30 },
      { id: 'physical-cap', skillId: 'Heavy Armour Proficiency', kind: 'stat', stat: 'physicalDamageReductionPct', value: 0.40 },
      { id: 'magical-cap', skillId: 'Warding', kind: 'stat', stat: 'magicalDamageReductionPct', value: 0.40 },
      { id: 'armour-resistance-cap', skillId: 'Heavy Armour Proficiency', kind: 'stat', stat: 'armourPenetrationResistancePct', value: 0.90 },
      { id: 'ward-resistance-cap', skillId: 'Warding', kind: 'stat', stat: 'wardPenetrationResistancePct', value: 0.90 },
      { id: 'barrier-cap', skillId: 'Warding', kind: 'stat', stat: 'barrierStrengthPct', value: 2 },
      { id: 'cooldown-cap', skillId: 'Warding', kind: 'stat', stat: 'defensiveCooldownPct', value: 0.90 }
    ];
    const profile = resolveCombatDefenseProfile(emptySnapshot(effects), {
      armourPieceCounts: { light: 0, medium: 0, heavy: 6 }
    });
    expect(profile.armourMultiplierByClass.heavy).toBe(1.5);
    expect(profile.armourMultiplierByClass.light).toBe(1);
    expect(profile.wardMultiplier).toBe(1.6);
    expect(profile.evasionBonus).toBe(30);
    expect(profile.enemyHitChanceReduction).toBe(0.1);
    expect(profile.physicalDamageMultiplier).toBe(0.8);
    expect(profile.magicalDamageMultiplier).toBe(0.8);
    expect(profile.armourPenetrationResistance).toBe(0.5);
    expect(profile.wardPenetrationResistance).toBe(0.5);
    expect(profile.barrierStrengthMultiplier).toBe(2);
    expect(profile.defensiveCooldownMultiplier).toBe(0.6);
  });

  it('keeps Light and Medium allocations visible while activating them only at 2/4/6 matching pieces', () => {
    const progression = createInitialCombatProgression(100);
    let development = createCombatDevelopmentState();
    const tree = COMBAT_SKILL_TREES['Light Armour Proficiency'].tree!;
    for (const name of ['Unburdened', 'Soft Step', 'Ghost Line']) {
      const node = tree.nodes.find(candidate => candidate.name === name)!;
      development = allocateCombatTreeNode(development, progression, 'Light Armour Proficiency', node.id).state;
    }
    const snapshot = resolveCombatModifierSnapshot(development, progression, { armourPieceCounts: { light: 2, medium: 0, heavy: 0 } });
    expect(resolveCombatDefenseProfile(snapshot, { armourPieceCounts: { light: 2, medium: 0, heavy: 0 } }).evasionBonus).toBe(8);
    expect(resolveCombatDefenseProfile(snapshot, { armourPieceCounts: { light: 4, medium: 0, heavy: 0 } }).enemyHitChanceReduction).toBe(0.02);
    expect(resolveCombatDefenseProfile(snapshot, { armourPieceCounts: { light: 6, medium: 0, heavy: 0 } }).enemyHitChanceReduction).toBe(0.02);
  });

  it('runs Heavy guard and Evasion conversion capstones deterministically in Solo', () => {
    const progression = createInitialCombatProgression(100);
    const allocateNames = (skillId: 'Heavy Armour Proficiency' | 'Evasion', names: readonly string[]) => {
      let state = createCombatDevelopmentState();
      const tree = COMBAT_SKILL_TREES[skillId].tree!;
      for (const name of names) {
        const node = tree.nodes.find(candidate => candidate.name === name)!;
        const result = allocateCombatTreeNode(state, progression, skillId, node.id);
        expect(result.accepted, result.reason).toBe(true);
        state = result.state;
      }
      return resolveCombatModifierSnapshot(state, progression, { armourPieceCounts: { light: 0, medium: 0, heavy: 6 } });
    };
    const heavy = allocateNames('Heavy Armour Proficiency', ['Thick Plate', 'Brace for Impact', 'Set Feet', 'Hold Fast', 'Siegeproof']);
    const heavyResult = simulateSoloCombat(defenseInput(heavy));
    expect(heavyResult.metrics.defense.guardPrevented).toBeGreaterThan(0);
    expect(heavyResult.metrics.defense.procCounts).toEqual(expect.objectContaining({}));

    const evasion = allocateNames('Evasion', ['Side Step', 'Predictive Step', 'Pattern Read', 'Untouchable Rhythm']);
    const evasionResult = simulateSoloCombat(defenseInput(evasion, { equippedStats: { ...defenseInput(emptySnapshot()).equippedStats, armourPieces: [] } }));
    const replay = simulateSoloCombat(defenseInput(evasion, { equippedStats: { ...defenseInput(emptySnapshot()).equippedStats, armourPieces: [] } }));
    expect(evasionResult.metrics.defense.convertedMisses).toBeGreaterThan(0);
    expect(evasionResult.events).toEqual(replay.events);
  });

  it('resolves ordered conversion, glance, guard, adaptation and retaliation deterministically', () => {
    const effects: CombatTreeEffectDefinition[] = [
      { id: 'periodic-avoidance', skillId: 'Evasion', kind: 'defense', defense: 'avoidance', every: 5, charges: 3 },
      { id: 'opening-glance', skillId: 'Light Armour Proficiency', kind: 'defense', defense: 'glance', first: 1, reductionPct: 0.25 },
      { id: 'periodic-guard', skillId: 'Medium Armour Proficiency', kind: 'defense', defense: 'guard', every: 5, reductionPct: 0.25, damageType: 'physical' },
      { id: 'same-type-adaptation', skillId: 'Medium Armour Proficiency', kind: 'defense', defense: 'adaptive', mode: 'same', reductionPct: 0.20, hits: 2 },
      { id: 'armour-retaliation', skillId: 'Heavy Armour Proficiency', kind: 'defense', defense: 'retaliation', source: 'armour-prevented', damagePct: 0.25, capPctDerivedHit: 0.10 }
    ];
    const modifiers = emptySnapshot(effects);
    const first = simulateSoloCombat(defenseInput(modifiers));
    const replay = simulateSoloCombat(defenseInput(modifiers));
    expect(first.events).toEqual(replay.events);
    expect(first.metrics).toEqual(replay.metrics);
    expect(first.metrics.defense.naturalMisses).toBe(0);
    expect(first.metrics.defense.convertedMisses).toBeGreaterThan(0);
    expect(first.metrics.defense.glancingHits).toBeGreaterThan(0);
    expect(first.metrics.defense.glancingPrevented).toBeGreaterThan(0);
    expect(first.metrics.defense.guardPrevented).toBeGreaterThan(0);
    expect(first.metrics.defense.defensePrevented).toBeGreaterThan(0);
    expect(first.metrics.defense.retaliationDamage).toBeGreaterThan(0);
    expect(first.events.some(event => event.type === 'attack' && event.actor === 'enemy' && event.convertedMiss)).toBe(true);
    expect(first.events.some(event => event.type === 'attack' && event.actor === 'enemy' && event.glanced)).toBe(true);
  });

  it('records barrier breaks and applies a non-recursive barrier response', () => {
    const effects: CombatTreeEffectDefinition[] = [
      { id: 'barrier-response', skillId: 'Warding', kind: 'defense', defense: 'barrier-response', trigger: 'break', nextAttackDamagePct: 0.30, nextAttackCount: 1, readiesTechnique: true, guaranteeHit: true, guaranteeCritical: true }
    ];
    const result = simulateSoloCombat(defenseInput(emptySnapshot(effects), {
      defensiveAbility: 'Arcane Barrier',
      enemy: {
        ...defenseInput(emptySnapshot()).enemy,
        damage: 100,
        attackInterval: 0.25,
        hitPoints: 10_000
      }
    }));
    expect(result.metrics.defense.barrierBreaks).toBeGreaterThan(0);
    expect(result.metrics.defense.procCounts['barrier-response']).toBeGreaterThan(0);
    expect(result.metrics.sustain.barrierAbsorbed).toBeGreaterThan(0);
  });

  it('authors Warding magical-pressure, barrier-break and top-up behavior', () => {
    const progression = createInitialCombatProgression(100);
    let state = createCombatDevelopmentState();
    const names = [
      'Etched Wards', 'Layered Sigils', 'Deep Inscription', 'Grand Aegis',
      'Broader Aegis', 'Expanded Lattice', 'Reinforced Field',
      'Reactive Sigil', 'Feedback Pulse'
    ];
    const tree = COMBAT_SKILL_TREES.Warding.tree!;
    for (const name of names) {
      const node = tree.nodes.find(candidate => candidate.name === name)!;
      const result = allocateCombatTreeNode(state, progression, 'Warding', node.id);
      expect(result.accepted, result.reason).toBe(true);
      state = result.state;
    }
    const snapshot = resolveCombatModifierSnapshot(state, progression, {
      defensiveAbility: 'Arcane Barrier',
      armourPieceCounts: { light: 0, medium: 0, heavy: 0 }
    });
    const result = simulateSoloCombat(defenseInput(snapshot, {
      defensiveAbility: 'Arcane Barrier',
      enemy: {
        ...defenseInput(emptySnapshot()).enemy,
        damage: 100,
        attackInterval: 0.25,
        damageType: 'magical',
        ward: 100,
        hitPoints: 10_000
      }
    }));
    const replay = simulateSoloCombat(defenseInput(snapshot, {
      defensiveAbility: 'Arcane Barrier',
      enemy: {
        ...defenseInput(emptySnapshot()).enemy,
        damage: 100,
        attackInterval: 0.25,
        damageType: 'magical',
        ward: 100,
        hitPoints: 10_000
      }
    }));
    expect(result.events).toEqual(replay.events);
    expect(result.metrics.defense.barrierBreaks).toBeGreaterThan(0);
    expect(result.metrics.defense.procCounts).toEqual(expect.objectContaining({}));
    expect(result.metrics.defense.wardPrevented).toBeGreaterThan(0);

    let topUpState = createCombatDevelopmentState();
    for (const name of ['Broader Aegis', 'Quick Seal', 'Recast Pattern', 'Endless Ward']) {
      const node = tree.nodes.find(candidate => candidate.name === name)!;
      const allocation = allocateCombatTreeNode(topUpState, progression, 'Warding', node.id);
      expect(allocation.accepted, allocation.reason).toBe(true);
      topUpState = allocation.state;
    }
    const topUpSnapshot = resolveCombatModifierSnapshot(topUpState, progression, {
      defensiveAbility: 'Arcane Barrier',
      armourPieceCounts: { light: 0, medium: 0, heavy: 0 }
    });
    const topUpResult = simulateSoloCombat(defenseInput(topUpSnapshot, {
      defensiveAbility: 'Arcane Barrier',
      enemy: {
        ...defenseInput(emptySnapshot()).enemy,
        damage: 55,
        attackInterval: 8,
        damageType: 'physical',
        hitPoints: 10_000
      }
    }));
    const barrierGrants = topUpResult.events.filter((event): event is Extract<SoloCombatEvent, { type: 'barrier' }> =>
      event.type === 'barrier' && event.granted > 0);
    expect(barrierGrants.length).toBeGreaterThanOrEqual(2);
    expect(barrierGrants[1].granted).toBeLessThan(barrierGrants[0].granted);
    expect(barrierGrants[1].remaining).toBe(barrierGrants[0].remaining);
  });

  it('exposes only the representable static Defense subset to Arena', () => {
    const snapshot = emptySnapshot([
      { id: 'arena-armour', skillId: 'Heavy Armour Proficiency', kind: 'stat', stat: 'armourPct', value: 0.20, condition: { armourClass: 'heavy', minimumArmourPieces: 6 } },
      { id: 'arena-ward', skillId: 'Warding', kind: 'stat', stat: 'wardPct', value: 0.20 },
      { id: 'arena-physical', skillId: 'Heavy Armour Proficiency', kind: 'stat', stat: 'physicalDamageReductionPct', value: 0.05 },
      { id: 'arena-magical', skillId: 'Warding', kind: 'stat', stat: 'magicalDamageReductionPct', value: 0.05 },
      { id: 'arena-cooldown', skillId: 'Warding', kind: 'stat', stat: 'defensiveCooldownPct', value: 0.10 },
      { id: 'arena-barrier', skillId: 'Warding', kind: 'stat', stat: 'barrierStrengthPct', value: 0.20 }
    ]);
    expect(resolveArenaDefenseProfile(snapshot, {
      defensiveAbility: 'Arcane Barrier',
      armourPieceCounts: { light: 0, medium: 0, heavy: 6 }
    })).toEqual({
      armourMultiplierByClass: { light: 1, medium: 1, heavy: 1.2 },
      wardMultiplier: 1.2,
      physicalDamageMultiplier: 0.95,
      magicalDamageMultiplier: 0.95,
      defensiveCooldownMultiplier: 0.9,
      barrierStrengthMultiplier: 1.2,
      barrierCooldownMultiplier: 1
    });
  });

  it('normalizes old v21 debriefs without changing the save version', () => {
    const state = normalizeSoloFrontierState({
      version: 21,
      order: 'paused',
      combatProgression: Object.fromEntries(COMBAT_SKILL_IDS.map(skillId => [skillId, { level: 1, xp: 0 }])),
      debrief: { elapsedMs: 10, sustain: {} }
    });
    expect(state.version).toBe(21);
    expect(state.debrief?.defense.naturalMisses).toBe(0);
    expect(state.debrief?.defense.procCounts).toEqual({});
  });
});
