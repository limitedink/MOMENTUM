import { describe, expect, it } from 'vitest';
import {
  COMBAT_SKILL_TREES,
  COMBAT_TREE_EFFECT_DEFINITIONS,
  OFFENSE_COMBAT_SKILL_IDS,
  SUSTAIN_COMBAT_SKILL_IDS,
  advanceCombatDrill,
  allocateCombatTreeNode,
  availableCombatTreePoints,
  combatTreeRespecCost,
  createCombatDevelopmentState,
  earnedCombatTreePoints,
  normalizeCombatDevelopmentState,
  resolveCombatModifierSnapshot,
  resolveCombatSustainProfile,
  selectCombatDrill
} from '../src/game/combat-development';
import {
  COMBAT_SKILL_IDS,
  createInitialCombatProgression,
  xpToNextCombatLevel,
  type CombatProgressionState,
  type CombatSkillId
} from '../src/game/combat-progression';
import { simulateSoloCombat, type SoloCombatInput, type WeaponStyle } from '../src/game/solo-frontier';

const STYLE_BY_SKILL: Readonly<Record<(typeof OFFENSE_COMBAT_SKILL_IDS)[number], WeaponStyle>> = {
  Strength: 'medium-melee',
  'Melee Accuracy': 'medium-melee',
  'Light Melee Weapon Proficiency': 'light-melee',
  'Medium Melee Weapon Proficiency': 'medium-melee',
  'Heavy Melee Weapon Proficiency': 'heavy-melee',
  Marksmanship: 'gun',
  Ranged: 'ranged',
  'Offensive Magic': 'magic'
};

function deterministicTreeInput(
  skillId: (typeof OFFENSE_COMBAT_SKILL_IDS)[number],
  modifiers: SoloCombatInput['combatModifiers'],
  seed: string
): SoloCombatInput {
  const style = STYLE_BY_SKILL[skillId];
  const technique = style === 'gun' ? 'Burst Fire' : style === 'ranged' ? 'Piercing Shot' : style === 'magic' ? 'Arc Bolt' : 'Power Strike';
  return {
    combatSkills: Object.fromEntries(COMBAT_SKILL_IDS.map(id => [id, 100])) as SoloCombatInput['combatSkills'],
    equippedStats: { hitPoints: 400, accuracy: 25, evasion: 20, ward: 20, armourPieces: [] },
    activeWeapon: { id: `test:${skillId}`, name: skillId, style, damage: 36, accuracy: 35, attackInterval: style === 'ranged' ? 0.7 : 0.55 },
    stance: style === 'medium-melee' ? 'Balanced' : 'Aggressive',
    technique,
    defensiveAbility: 'none',
    aura: 'none',
    enemy: {
      id: 'tree-target', name: 'Tree Target', kind: 'boss', hitPoints: 7_500, damage: 26,
      armour: 95, ward: 95, evasion: 32, accuracy: 42, attackInterval: 0.8, damageType: 'physical'
    },
    stage: 20,
    seed,
    combatModifiers: modifiers
  };
}

function developmentForNode(skillId: CombatSkillId, nodeId: string) {
  const tree = COMBAT_SKILL_TREES[skillId].tree!;
  const required = new Set<string>();
  const visit = (id: string): void => {
    const node = tree.nodes.find(candidate => candidate.id === id)!;
    node.requires.forEach(visit);
    required.add(id);
  };
  visit(nodeId);
  const state = createCombatDevelopmentState();
  state.trees[skillId] = {
    ...state.trees[skillId],
    ownedNodeIds: tree.nodes.filter(node => required.has(node.id)).map(node => node.id)
  };
  return state;
}

function deterministicSustainInput(
  modifiers: SoloCombatInput['combatModifiers'],
  seed: string,
  enemyDamage = 54
): SoloCombatInput {
  return {
    combatSkills: Object.fromEntries(COMBAT_SKILL_IDS.map(id => [id, 100])) as SoloCombatInput['combatSkills'],
    equippedStats: { hitPoints: 80, accuracy: 20, evasion: 10, ward: 10, armourPieces: [] },
    activeWeapon: {
      id: 'sustain-test-weapon',
      name: 'Sustain Test Weapon',
      style: 'medium-melee',
      damage: 24,
      accuracy: 30,
      attackInterval: 0.72
    },
    stance: 'Balanced',
    technique: 'Power Strike',
    defensiveAbility: 'Mend',
    aura: 'Battle Focus',
    enemy: {
      id: 'sustain-target',
      name: 'Sustain Target',
      kind: 'boss',
      hitPoints: 5_500,
      damage: enemyDamage,
      armour: 70,
      ward: 50,
      evasion: 25,
      accuracy: 54,
      attackInterval: 0.85,
      damageType: 'physical'
    },
    stage: 20,
    seed,
    combatModifiers: modifiers
  };
}

function allocateByName(
  state: ReturnType<typeof createCombatDevelopmentState>,
  progression: CombatProgressionState,
  skillId: CombatSkillId,
  names: readonly string[]
) {
  let next = state;
  for (const name of names) {
    const tree = COMBAT_SKILL_TREES[skillId].tree!;
    const node = tree.nodes.find(candidate => candidate.name === name);
    expect(node, `${skillId} is missing ${name}`).toBeTruthy();
    const allocation = allocateCombatTreeNode(next, progression, skillId, node!.id);
    expect(allocation.accepted, allocation.reason).toBe(true);
    next = allocation.state;
  }
  return next;
}

describe('v21 combat development', () => {
  it('registers all 17 skills and authors the v21.2 Light and Medium Defense trees', () => {
    expect(Object.keys(COMBAT_SKILL_TREES)).toEqual([...COMBAT_SKILL_IDS]);
    expect(OFFENSE_COMBAT_SKILL_IDS).toHaveLength(8);
    expect(SUSTAIN_COMBAT_SKILL_IDS).toHaveLength(4);
    const referencedEffectIds: string[] = [];

    for (const skillId of COMBAT_SKILL_IDS.filter(skillId => COMBAT_SKILL_TREES[skillId].tree)) {
      const entry = COMBAT_SKILL_TREES[skillId];
      const tree = entry.tree!;
      expect(entry.status).toBe('authored');
      expect(tree.nodes).toHaveLength(21);
      expect(tree.branches).toHaveLength(3);
      expect(tree.rootNodeIds).toHaveLength(3);
      expect(new Set(tree.nodes.map(node => node.id)).size).toBe(21);
      expect(tree.nodes.every(node => node.cost === 1 && node.effectIds?.length)).toBe(true);
      expect(tree.nodes.every(node => node.effectIds?.every(effectId => COMBAT_TREE_EFFECT_DEFINITIONS[effectId]))).toBe(true);
      referencedEffectIds.push(...tree.nodes.flatMap(node => node.effectIds || []));

      const capstones = tree.nodes.filter(node => node.capstone);
      expect(capstones).toHaveLength(6);
      expect(new Set(capstones.map(node => node.exclusiveGroup))).toHaveLength(1);
      for (const branch of tree.branches) {
        const nodes = tree.nodes.filter(node => node.branch === branch.id);
        expect(nodes).toHaveLength(7);
        expect(nodes.filter(node => node.requires.length === 0)).toHaveLength(1);
        expect(nodes.filter(node => node.capstone)).toHaveLength(2);
      }
    }

    expect(Object.values(COMBAT_SKILL_TREES).filter(entry => entry.status === 'authored')).toHaveLength(16);
    expect(Object.values(COMBAT_SKILL_TREES).filter(entry => entry.release === 'v21.1')).toHaveLength(4);
    expect(Object.values(COMBAT_SKILL_TREES).filter(entry => entry.status === 'planned-defense')).toHaveLength(1);
    expect(new Set(referencedEffectIds).size).toBe(referencedEffectIds.length);
    expect(new Set(Object.keys(COMBAT_TREE_EFFECT_DEFINITIONS))).toEqual(new Set(referencedEffectIds));
  });

  it('awards one point per ten levels, caps at ten, and grants no automatic allocation', () => {
    expect([1, 9, 10, 49, 50, 99, 100, 999].map(earnedCombatTreePoints)).toEqual([0, 0, 1, 4, 5, 9, 10, 10]);
    const progression = createInitialCombatProgression(100);
    const state = normalizeCombatDevelopmentState(undefined, progression);
    expect(state.trees.Strength.ownedNodeIds).toEqual([]);
    expect(availableCombatTreePoints(state, progression, 'Strength')).toBe(10);
    expect(combatTreeRespecCost(0)).toBe(100);
    expect(combatTreeRespecCost(10)).toBe(600);
  });

  it('enforces prerequisites and one exclusive capstone while allowing both lower paths', () => {
    const progression = createInitialCombatProgression(100);
    let state = createCombatDevelopmentState();
    const tree = COMBAT_SKILL_TREES.Strength.tree!;
    const firstCapstone = tree.nodes.find(node => node.name === 'Titan’s Impact')!;
    expect(allocateCombatTreeNode(state, progression, 'Strength', firstCapstone.id).accepted).toBe(false);

    state = allocateByName(state, progression, 'Strength', [
      'Brute Force', 'Weighted Blows', 'Bonebreaker', 'Titan’s Impact',
      'Full Commitment', 'Overpower'
    ]);
    expect(state.trees.Strength.ownedNodeIds).toHaveLength(6);

    const otherCapstone = tree.nodes.find(node => node.name === 'Colossus')!;
    const rejected = allocateCombatTreeNode(state, progression, 'Strength', otherCapstone.id);
    expect(rejected.accepted).toBe(false);
    expect(rejected.reason).toBe('Another capstone selected');
  });

  it('runs one persisted Drill at exactly 0.1 XP/s and stops at level 100', () => {
    let progression = createInitialCombatProgression(1);
    let state = createCombatDevelopmentState();
    const selected = selectCombatDrill(state, progression, 'Strength');
    expect(selected.accepted).toBe(true);
    state = selected.state;

    const first = advanceCombatDrill(state, progression, 5_500);
    expect(first.xpAwarded).toBe(0);
    expect(first.state.drill.fractionalXp).toBeCloseTo(0.55, 8);
    const restored = normalizeCombatDevelopmentState(JSON.parse(JSON.stringify(first.state)), first.progression);
    const second = advanceCombatDrill(restored, first.progression, 4_500);
    expect(second.xpAwarded).toBe(1);
    expect(second.progression.Strength.xp).toBe(1);
    expect(second.state.drill.fractionalXp).toBeCloseTo(0, 8);

    progression = {
      ...progression,
      Strength: { level: 99, xp: xpToNextCombatLevel(99) - 1 }
    };
    state = selectCombatDrill(createCombatDevelopmentState(), progression, 'Strength').state;
    const capped = advanceCombatDrill(state, progression, 10_000);
    expect(capped.progression.Strength).toEqual({ level: 100, xp: 0 });
    expect(capped.state.drill.skillId).toBeNull();
    expect(capped.stoppedAtLevelCap).toBe(true);
    expect(selectCombatDrill(capped.state, capped.progression, 'Strength').accepted).toBe(false);

    const overCap = advanceCombatDrill(state, progression, 8 * 60 * 60 * 1_000);
    expect(overCap.xpAwarded).toBe(1);
    expect(overCap.state.drill.totalXp).toBe(1);
  });

  it('resolves additive typed effects and applies the normal penetration cap', () => {
    const progression = createInitialCombatProgression(100);
    let state = createCombatDevelopmentState();
    state = allocateByName(state, progression, 'Marksmanship', [
      'Armour-Piercing Rounds', 'Hardened Core', 'Penetrator', 'Tungsten Core'
    ]);
    const snapshot = resolveCombatModifierSnapshot(state, progression, { style: 'gun', technique: 'Burst Fire' });
    expect(snapshot.static.armourPenetration).toBe(60);
    expect(snapshot.effectIds).toHaveLength(4);
    expect(snapshot.static.attackSpeedPct).toBeLessThanOrEqual(0.30);
    expect(snapshot.static.techniqueCooldownPct).toBeLessThanOrEqual(0.40);
    expect(snapshot.static.criticalChance).toBeLessThanOrEqual(0.60);
  });

  it('executes deterministic combat scenarios for every Offense root and capstone', () => {
    const progression = createInitialCombatProgression(100);
    for (const skillId of OFFENSE_COMBAT_SKILL_IDS) {
      const tree = COMBAT_SKILL_TREES[skillId].tree!;
      const targets = tree.nodes.filter(node => node.requires.length === 0 || node.capstone);
      expect(targets).toHaveLength(9);
      for (const node of targets) {
        const development = developmentForNode(skillId, node.id);
        const style = STYLE_BY_SKILL[skillId];
        const technique = style === 'gun' ? 'Burst Fire' : style === 'ranged' ? 'Piercing Shot' : style === 'magic' ? 'Arc Bolt' : 'Power Strike';
        const modifiers = resolveCombatModifierSnapshot(development, progression, {
          style,
          technique,
          stance: style === 'medium-melee' ? 'Balanced' : 'Aggressive',
          boss: true,
          enemyWarded: true,
          enemyHealthRatio: 1,
          playerHealthRatio: 1,
          displayedHitChance: 0.98,
          baseInterval: style === 'ranged' ? 0.7 : 0.55
        });
        expect(node.effectIds?.every(effectId => modifiers.effectIds.includes(effectId))).toBe(true);
        const seed = `${skillId}:${node.id}`;
        const first = simulateSoloCombat(deterministicTreeInput(skillId, modifiers, seed));
        const replay = simulateSoloCombat(deterministicTreeInput(skillId, modifiers, seed));
        expect(replay).toEqual(first);
        expect(first.events.length).toBeGreaterThan(1);
      }
    }
  });

  it('executes deterministic combat scenarios for every Sustain root and capstone', () => {
    const progression = createInitialCombatProgression(100);
    for (const skillId of SUSTAIN_COMBAT_SKILL_IDS) {
      const tree = COMBAT_SKILL_TREES[skillId].tree!;
      const targets = tree.nodes.filter(node => node.requires.length === 0 || node.capstone);
      expect(targets).toHaveLength(9);
      for (const node of targets) {
        const development = developmentForNode(skillId, node.id);
        const modifiers = resolveCombatModifierSnapshot(development, progression, {
          style: 'medium-melee',
          technique: 'Power Strike',
          stance: 'Balanced',
          aura: 'Battle Focus',
          defensiveAbility: 'Mend',
          boss: true,
          enemyWarded: true,
          enemyHealthRatio: 1,
          playerHealthRatio: 1,
          displayedHitChance: 0.90,
          baseInterval: 0.72
        });
        expect(node.effectIds?.every(effectId => modifiers.effectIds.includes(effectId))).toBe(true);
        const seed = `${skillId}:${node.id}`;
        const first = simulateSoloCombat(deterministicSustainInput(modifiers, seed));
        const replay = simulateSoloCombat(deterministicSustainInput(modifiers, seed));
        expect(replay).toEqual(first);
        expect(first.events.length).toBeGreaterThan(1);
      }
    }
  });

  it('caps Sustain modifiers and reports an inspectable Sustain profile', () => {
    const progression = createInitialCombatProgression(100);
    let state = createCombatDevelopmentState();
    state = allocateByName(state, progression, 'Vitality', [
      'Hardy', 'Deep Reserves', 'Iron Constitution', 'Mountain Heart',
      'Efficient Circulation', 'Strong Pulse'
    ]);
    state = allocateByName(state, progression, 'Support Magic', [
      'Soothing Field', 'Steady Pulse', 'Anchoring Wave', 'Sanctuary Signal'
    ]);
    const snapshot = resolveCombatModifierSnapshot(state, progression, {
      style: 'medium-melee',
      technique: 'Power Strike',
      aura: 'Battle Focus',
      defensiveAbility: 'Mend',
      playerHealthRatio: 1
    });
    const profile = resolveCombatSustainProfile(snapshot, {
      aura: 'Battle Focus',
      defensiveAbility: 'Mend',
      playerHealthRatio: 0.25
    });
    expect(snapshot.static.maxHitPointsPct).toBeLessThanOrEqual(0.40);
    expect(snapshot.static.healingPct).toBeLessThanOrEqual(0.75);
    expect(snapshot.static.damageTakenReductionPct).toBeLessThanOrEqual(0.15);
    expect(profile.maxHitPointsMultiplier).toBeLessThanOrEqual(1.40);
    expect(profile.damageTakenMultiplier).toBeGreaterThanOrEqual(0.85);
    expect(profile.damageTakenMultiplier).toBeLessThan(1 - snapshot.static.damageTakenReductionPct);
    expect(profile.healingMultiplier).toBeGreaterThan(1 + snapshot.static.healingPct);
    expect(profile.mendTriggerHealthPercent).toBeLessThanOrEqual(0.85);
  });

  it('makes Sustain recovery observable without granting tree-generated skill XP', () => {
    const progression = createInitialCombatProgression(100);
    let state = createCombatDevelopmentState();
    state = allocateByName(state, progression, 'Healing', [
      'Field Medicine', 'Lingering Care', 'Sustained Treatment', 'Renewing Tide'
    ]);
    state = allocateByName(state, progression, 'Vitality', [
      'Natural Recovery', 'Recuperation', 'Adaptive Recovery'
    ]);
    const snapshot = resolveCombatModifierSnapshot(state, progression, {
      style: 'medium-melee',
      technique: 'Power Strike',
      aura: 'Battle Focus',
      defensiveAbility: 'Mend',
      playerHealthRatio: 1
    });
    const result = simulateSoloCombat(deterministicSustainInput(snapshot, 'sustain-observable', 64));
    expect(result.metrics.sustain.mendCasts).toBeGreaterThan(0);
    expect(
      result.metrics.sustain.healingBySource['mend-hot']
      + result.metrics.sustain.healingBySource.regeneration
      + result.metrics.sustain.healingBySource['damage-recovery']
    ).toBeGreaterThan(0);
    expect(result.skillEvents.filter(event => event.skillId === 'Healing').length)
      .toBe(result.metrics.sustain.mendCasts);
  });

  it('repeats Renewal Echo from effective Mend healing without applying healing bonuses twice', () => {
    const progression = createInitialCombatProgression(100);
    let state = createCombatDevelopmentState();
    state = allocateByName(state, progression, 'Support Magic', [
      'Soothing Field', 'Restorative Chorus', 'Recurrent Pattern', 'Renewal Echo'
    ]);
    const snapshot = resolveCombatModifierSnapshot(state, progression, {
      style: 'medium-melee',
      technique: 'Power Strike',
      stance: 'Balanced',
      aura: 'Battle Focus',
      defensiveAbility: 'Mend',
      playerHealthRatio: 1
    });
    const result = simulateSoloCombat(deterministicSustainInput(snapshot, 'renewal-echo-effective-healing', 35));
    const firstMend = result.events.find(event => event.type === 'healing' && event.amount > 0);
    expect(firstMend?.type).toBe('healing');
    if (!firstMend || firstMend.type !== 'healing') return;
    const echo = result.events
      .filter(event =>
        event.type === 'recovery'
        && event.source === 'mend-echo'
        && event.atMs > firstMend.atMs
        && event.atMs <= firstMend.atMs + 3_000)
      .reduce((sum, event) => sum + (event.type === 'recovery' ? event.amount : 0), 0);
    expect(echo).toBeCloseTo(firstMend.amount * 0.30, 3);
    const livingReserve = COMBAT_SKILL_TREES.Healing.tree!.nodes.find(node => node.name === 'Living Reserve')!;
    const reserveEffects = livingReserve.effectIds!.map(effectId => COMBAT_TREE_EFFECT_DEFINITIONS[effectId]);
    expect(reserveEffects).toContainEqual(expect.objectContaining({ kind:'reserve', retainUnused:true }));
  });
});
