import { COMBAT_SKILL_IDS, type CombatSkillId } from '../src/game/combat-progression';
import { createInitialCombatProgression } from '../src/game/combat-progression';
import {
  COMBAT_SKILL_TREES,
  OFFENSE_COMBAT_SKILL_IDS,
  allocateCombatTreeNode,
  createCombatDevelopmentState,
  resolveCombatModifierSnapshot
} from '../src/game/combat-development';
import { COMBAT_LOOT_DEFINITIONS, calculateEquippedStats, createEquipmentLoadout, inspectItem, type EquipmentLoadout, type ItemInstance } from '../src/game/loot';
import {
  SOLO_FRONTIER_ENCOUNTER_RECOVERY_SECONDS,
  advanceSoloFrontier,
  createInitialSoloFrontierState,
  setSoloFrontierOrder,
  simulateSoloCombat,
  soloFrontierStage,
  type ArmourClass,
  type SoloCombatInput,
  type WeaponStyle
} from '../src/game/solo-frontier';

const WEAPONS = Object.freeze({
  melee: { definitionId: 'frontier-warhammer', style: 'medium-melee', slot: 'melee', technique: 'Power Strike' },
  firearm: { definitionId: 'ironshot-carbine', style: 'gun', slot: 'gun', technique: 'Burst Fire' },
  ranged: { definitionId: 'watcher-crossbow', style: 'ranged', slot: 'ranged', technique: 'Piercing Shot' },
  magic: { definitionId: 'tide-scepter', style: 'magic', slot: 'magic', technique: 'Arc Bolt' }
} as const);

const ARMOUR_IDS: Readonly<Record<ArmourClass, readonly string[]>> = Object.freeze({
  light: Object.freeze(['scout-helm', 'trail-jacket', 'pathfinder-gloves', 'scout-pants', 'trail-boots', 'drift-cloak']),
  medium: Object.freeze(['warden-helm', 'frontier-mail', 'forgebound-gloves', 'warden-greaves', 'march-boots', 'traveler-cloak']),
  heavy: Object.freeze(['citadel-helm', 'apex-aegis', 'bastion-gauntlets', 'citadel-cuisses', 'iron-tread', 'nightwall-cloak'])
});

type WeaponFixture = keyof typeof WEAPONS;

export interface BalanceBuild {
  name: string;
  weapon: WeaponFixture;
  armour: ArmourClass;
  level: number;
  itemLevel: number;
  stance: SoloCombatInput['stance'];
  defensiveAbility: SoloCombatInput['defensiveAbility'];
  aura: SoloCombatInput['aura'];
  rarity?: ItemInstance['rarity'];
  poor?: boolean;
}

export const SOLO_FRONTIER_BALANCE_BUILDS: readonly BalanceBuild[] = Object.freeze([
  { name: 'starter', weapon: 'firearm', armour: 'medium', level: 1, itemLevel: 1, stance: 'Balanced', defensiveAbility: 'none', aura: 'none', poor: true },
  { name: 'melee', weapon: 'melee', armour: 'medium', level: 35, itemLevel: 20, stance: 'Aggressive', defensiveAbility: 'Mend', aura: 'Battle Focus' },
  { name: 'firearm', weapon: 'firearm', armour: 'medium', level: 35, itemLevel: 20, stance: 'Aggressive', defensiveAbility: 'Mend', aura: 'Battle Focus' },
  { name: 'ranged', weapon: 'ranged', armour: 'medium', level: 35, itemLevel: 20, stance: 'Aggressive', defensiveAbility: 'Mend', aura: 'Battle Focus' },
  { name: 'magic', weapon: 'magic', armour: 'medium', level: 35, itemLevel: 20, stance: 'Aggressive', defensiveAbility: 'Arcane Barrier', aura: 'Battle Focus' },
  { name: 'light-armour', weapon: 'ranged', armour: 'light', level: 35, itemLevel: 20, stance: 'Aggressive', defensiveAbility: 'Mend', aura: 'Battle Focus' },
  { name: 'medium-armour', weapon: 'ranged', armour: 'medium', level: 35, itemLevel: 20, stance: 'Balanced', defensiveAbility: 'Mend', aura: 'Battle Focus' },
  { name: 'heavy-armour', weapon: 'ranged', armour: 'heavy', level: 35, itemLevel: 20, stance: 'Guarded', defensiveAbility: 'Mend', aura: 'Battle Focus' },
  { name: 'sustain', weapon: 'magic', armour: 'medium', level: 35, itemLevel: 20, stance: 'Guarded', defensiveAbility: 'Arcane Barrier', aura: 'Battle Focus' },
  { name: 'initiate-checkpoint', weapon: 'firearm', armour: 'medium', level: 20, itemLevel: 10, stance: 'Balanced', defensiveAbility: 'Mend', aura: 'Battle Focus' },
  { name: 'vanguard-checkpoint', weapon: 'firearm', armour: 'heavy', level: 70, itemLevel: 20, stance: 'Guarded', defensiveAbility: 'Mend', aura: 'Battle Focus' },
  { name: 'apex-checkpoint', weapon: 'firearm', armour: 'heavy', level: 100, itemLevel: 30, stance: 'Guarded', defensiveAbility: 'Mend', aura: 'Battle Focus', rarity: 'rare' },
  { name: 'intentionally-poor', weapon: 'melee', armour: 'light', level: 1, itemLevel: 1, stance: 'Aggressive', defensiveAbility: 'none', aura: 'none', poor: true }
]);

function skills(level: number): SoloCombatInput['combatSkills'] {
  return Object.fromEntries(COMBAT_SKILL_IDS.map((id: CombatSkillId) => [id, level])) as SoloCombatInput['combatSkills'];
}

function instance(definitionId: string, itemLevel: number, index: number, rarity: ItemInstance['rarity'] = 'common'): ItemInstance {
  const definition = COMBAT_LOOT_DEFINITIONS.find(candidate => candidate.id === definitionId)!;
  return {
    instanceId: `balance:${definitionId}:${index}`,
    definitionId,
    rarity,
    itemLevel,
    affixes: [],
    signatureId: definition.signatureId,
    sourceId: 'balance-harness',
    acquiredAt: 1,
    rerolls: 0
  };
}

export function balanceInputForBuild(build: BalanceBuild, stage: number, seed: string): SoloCombatInput {
  if (build.name === 'starter') {
    return {
      combatSkills: skills(1),
      equippedStats: { hitPoints: 0, accuracy: 0, evasion: 0, ward: 0, armourPieces: [] },
      activeWeapon: { id: 'pulseSidearm', name: 'Pulse Sidearm', style: 'gun', damage: 10, accuracy: 5, attackInterval: 0.25 },
      stance: build.stance,
      technique: 'Burst Fire',
      defensiveAbility: build.defensiveAbility,
      aura: build.aura,
      enemy: soloFrontierStage(stage).enemy,
      stage,
      seed
    };
  }
  const weapon = WEAPONS[build.weapon];
  const definitions = [weapon.definitionId, ...ARMOUR_IDS[build.armour]];
  const items = definitions.map((id, index) => instance(id, build.itemLevel, index, build.rarity));
  const loadout = createEquipmentLoadout({ activeWeaponSlot: weapon.slot });
  loadout[weapon.slot] = items[0].instanceId;
  (['helm', 'chest', 'gloves', 'pants', 'boots', 'cloak'] as const).forEach((slot, index) => { loadout[slot] = items[index + 1].instanceId; });
  const snapshot = calculateEquippedStats(loadout as EquipmentLoadout, items);
  const weaponInspection = inspectItem(items[0])!;
  const allStats = snapshot.stats;
  const weaponStats = weaponInspection.stats;
  return {
    combatSkills: skills(build.level),
    equippedStats: {
      hitPoints: build.poor ? 0 : Number(allStats.hp || 0),
      damage: build.poor ? 0 : Math.max(0, Number(allStats.damage || 0) - Number(weaponStats.damage || 0)),
      accuracy: build.poor ? 0 : Math.max(0, Number(allStats.accuracy || 0) - Number(weaponStats.accuracy || 0)),
      evasion: build.poor ? 0 : Number(allStats.evasion || 0),
      ward: build.poor ? 0 : Number(allStats.ward || 0),
      armourPieces: build.poor ? [] : snapshot.armourPieces
    },
    activeWeapon: {
      id: items[0].instanceId,
      name: weaponInspection.definition.name,
      style: weapon.style as WeaponStyle,
      damage: build.poor ? Number(weaponStats.damage || 1) * 0.35 : Number(weaponStats.damage || 1),
      accuracy: build.poor ? 0 : Number(weaponStats.accuracy || 0),
      attackInterval: build.poor ? Number(weaponStats.attackInterval || 1) * 1.5 : Number(weaponStats.attackInterval || 1),
      damageType: weapon.style === 'magic' ? 'magical' : 'physical'
    },
    stance: build.stance,
    technique: weapon.technique,
    defensiveAbility: build.defensiveAbility,
    aura: build.aura,
    enemy: soloFrontierStage(stage).enemy,
    stage,
    seed
  };
}

function median(values: readonly number[]): number {
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.floor(sorted.length / 2)] ?? 0;
}

const TREE_BUILD_NODES: Readonly<Record<(typeof OFFENSE_COMBAT_SKILL_IDS)[number], readonly string[]>> = Object.freeze({
  Strength: ['Brute Force', 'Weighted Blows', 'Bonebreaker', 'Titan’s Impact', 'Follow Through', 'Driving Rhythm', 'Relentless Advance', 'Finisher', 'Giant Slayer', 'Trophy Breaker'],
  'Melee Accuracy': ['Confidence', 'Certainty', 'Surgical Window', 'Inevitable', 'Steady Hand', 'Keen Sight', 'Weakpoint', 'Correction', 'Patient Hands', 'Never Twice'],
  'Light Melee Weapon Proficiency': ['Keen Edge', 'Opening Feint', 'Unreadable', 'First Blood', 'Untouched', 'Riposte', 'Counterstep', 'Quick Hands', 'Rapid Technique', 'Flash Cut'],
  'Medium Melee Weapon Proficiency': ['Centred', 'Adaptable', 'Fluid Guard', 'Tempered Response', 'Return Force', 'Vengeful Strike', 'Weapon Drill', 'Relentless', 'Exacting Blow', 'Relentless Force'],
  'Heavy Melee Weapon Proficiency': ['Massive Presence', 'Opening Weight', 'Loaded Swing', 'Cataclysm', 'Fracturing Edge', 'Breach', 'Deep Breach', 'Dominance', 'Anchored', 'Unstoppable'],
  Marksmanship: ['Trigger Discipline', 'Burst Control', 'Extended Burst', 'Lead Tempest', 'Sighted', 'First Round', 'Weakpoint Round', 'Armour-Piercing Rounds', 'Hollow Points', 'Controlled Burst'],
  Ranged: ['Bodkin Point', 'Broadhead', 'Barbed', 'Storm Piercer', 'Trophy Hunter', 'Blood Trail', 'Heartline', 'Draw Weight', 'Loose Fast', 'Fleet Quiver'],
  'Offensive Magic': ['Kindling', 'Flashfire', 'Critical Spark', 'Phoenix Spark', 'Spellflow', 'Arcane Cadence', 'Resonance', 'Null Sight', 'Entropy', 'Collapse']
});

const TREE_STYLE: Readonly<Record<(typeof OFFENSE_COMBAT_SKILL_IDS)[number], WeaponStyle>> = Object.freeze({
  Strength: 'medium-melee',
  'Melee Accuracy': 'medium-melee',
  'Light Melee Weapon Proficiency': 'light-melee',
  'Medium Melee Weapon Proficiency': 'medium-melee',
  'Heavy Melee Weapon Proficiency': 'heavy-melee',
  Marksmanship: 'gun',
  Ranged: 'ranged',
  'Offensive Magic': 'magic'
});

interface OffenseScenarioProfile {
  id: string;
  kind: 'regular' | 'boss';
  hitPoints: number;
  armour: number;
  ward: number;
  evasion: number;
  accuracy: number;
  damage: number;
  attackInterval: number;
  stance?: SoloCombatInput['stance'];
}

const CAPSTONE_SCENARIO_PROFILES: readonly OffenseScenarioProfile[] = Object.freeze([
  { id: 'opening-burst', kind: 'regular', hitPoints: 180, armour: 20, ward: 0, evasion: 20, accuracy: 20, damage: 5, attackInterval: 4 },
  { id: 'opening-skirmish', kind: 'regular', hitPoints: 500, armour: 30, ward: 0, evasion: 60, accuracy: 20, damage: 12, attackInterval: 4 },
  { id: 'sustained-target', kind: 'regular', hitPoints: 3_000, armour: 90, ward: 0, evasion: 90, accuracy: 30, damage: 15, attackInterval: 3 },
  { id: 'fortified-boss', kind: 'boss', hitPoints: 3_000, armour: 180, ward: 180, evasion: 100, accuracy: 40, damage: 20, attackInterval: 2.5 },
  { id: 'pressure-fight', kind: 'regular', hitPoints: 2_000, armour: 70, ward: 0, evasion: 80, accuracy: 140, damage: 28, attackInterval: 0.8 },
  { id: 'elusive-target', kind: 'regular', hitPoints: 2_000, armour: 40, ward: 0, evasion: 120, accuracy: 35, damage: 15, attackInterval: 2 },
  { id: 'counter-duel', kind: 'regular', hitPoints: 2_000, armour: 60, ward: 0, evasion: 60, accuracy: 0, damage: 15, attackInterval: 0.45 }
]);

function allocateTreeBuild(skillId: (typeof OFFENSE_COMBAT_SKILL_IDS)[number], nodeNames: readonly string[]) {
  const progression = createInitialCombatProgression(100);
  let development = createCombatDevelopmentState();
  const tree = COMBAT_SKILL_TREES[skillId].tree!;
  for (const name of nodeNames) {
    const node = tree.nodes.find(candidate => candidate.name === name);
    if (!node) throw new Error(`Missing ${skillId} balance node: ${name}`);
    const result = allocateCombatTreeNode(development, progression, skillId, node.id);
    if (!result.accepted) throw new Error(`Illegal ${skillId} balance build at ${name}: ${result.reason}`);
    development = result.state;
  }
  return { development, progression };
}

function capstoneVariantBuild(
  skillId: (typeof OFFENSE_COMBAT_SKILL_IDS)[number],
  capstoneId: string
): readonly string[] {
  const tree = COMBAT_SKILL_TREES[skillId].tree!;
  const selected = new Set<string>();
  const selectRequirements = (nodeId: string): void => {
    const current = tree.nodes.find(candidate => candidate.id === nodeId);
    if (!current) throw new Error(`Missing ${skillId} capstone requirement: ${nodeId}`);
    current.requires.forEach(selectRequirements);
    selected.add(nodeId);
  };
  selectRequirements(capstoneId);
  tree.rootNodeIds.forEach(nodeId => selected.add(nodeId));
  tree.nodes
    .filter(node => node.tier === 2 && !selected.has(node.id))
    .slice(0, 10 - selected.size)
    .forEach(node => selected.add(node.id));
  if (selected.size !== 10) throw new Error(`Could not complete a legal ten-point ${skillId} build for ${capstoneId}`);
  return [...selected].map(nodeId => tree.nodes.find(candidate => candidate.id === nodeId)!.name);
}

function offenseTreeScenario(
  skillId: (typeof OFFENSE_COMBAT_SKILL_IDS)[number],
  seed: string,
  nodeNames: readonly string[] = [],
  profile?: OffenseScenarioProfile
): SoloCombatInput {
  const style = TREE_STYLE[skillId];
  const technique = style === 'gun' ? 'Burst Fire' : style === 'ranged' ? 'Piercing Shot' : style === 'magic' ? 'Arc Bolt' : 'Power Strike';
  const baseInterval = style === 'ranged' ? 0.7 : style === 'heavy-melee' ? 0.8 : 0.55;
  const boss = profile ? profile.kind === 'boss' : skillId !== 'Ranged';
  const stance = profile?.stance ?? (style === 'medium-melee' ? 'Balanced' : 'Aggressive');
  const state = nodeNames.length ? allocateTreeBuild(skillId, nodeNames) : null;
  const combatModifiers = state ? resolveCombatModifierSnapshot(state.development, state.progression, {
    style,
    technique,
    stance,
    boss,
    enemyWarded: (profile?.ward ?? 100) > 0,
    enemyHealthRatio: 1,
    playerHealthRatio: 1,
    displayedHitChance: 0.90,
    baseInterval
  }) : undefined;
  return {
    combatSkills: skills(100),
    equippedStats: { hitPoints: 400, accuracy: 0, evasion: 20, ward: 20, armourPieces: [] },
    activeWeapon: { id: `tree:${skillId}`, name: skillId, style, damage: 28, accuracy: 10, attackInterval: baseInterval },
    stance,
    technique,
    defensiveAbility: 'none',
    aura: 'none',
    enemy: {
      id: 'tree-balance-dummy', name: 'Tree Balance Dummy', kind: boss ? 'boss' : 'regular', hitPoints: 3_000,
      damage: profile?.damage ?? 5,
      armour: profile?.armour ?? 100,
      ward: profile?.ward ?? 100,
      evasion: profile?.evasion ?? 100,
      accuracy: profile?.accuracy ?? 40,
      attackInterval: profile?.attackInterval ?? 10,
      damageType: 'physical',
      ...(profile ? { hitPoints: profile.hitPoints } : {})
    },
    stage: 20,
    seed,
    combatModifiers
  };
}

function offenseTreeBalanceAudit(samples = 11) {
  return OFFENSE_COMBAT_SKILL_IDS.map(skillId => {
    const performance = (input: SoloCombatInput): number => {
      const result = simulateSoloCombat(input);
      return result.metrics.damage.dealt / Math.max(0.001, result.metrics.durationSeconds);
    };
    const encounterThroughput = (input: SoloCombatInput): number => {
      const result = simulateSoloCombat(input);
      return result.metrics.damage.dealt
        / Math.max(0.001, result.metrics.durationSeconds + SOLO_FRONTIER_ENCOUNTER_RECOVERY_SECONDS);
    };
    const baseline = median(Array.from({ length: samples }, (_, index) => performance(offenseTreeScenario(skillId, `tree:${skillId}:baseline:${index}`))));
    const tenPointDamage = median(Array.from({ length: samples }, (_, index) => performance(offenseTreeScenario(skillId, `tree:${skillId}:build:${index}`, TREE_BUILD_NODES[skillId]))));
    const representativeModifiers = offenseTreeScenario(skillId, `tree:${skillId}:caps`, TREE_BUILD_NODES[skillId]).combatModifiers!.static;
    const tree = COMBAT_SKILL_TREES[skillId].tree!;
    const capstones = tree.nodes.filter(node => node.capstone).map(node => {
      const names = capstoneVariantBuild(skillId, node.id);
      const profileRatios = CAPSTONE_SCENARIO_PROFILES.map(profile => {
        const paired = Array.from({ length: samples }, (_, index) => {
          const seed = `tree:${skillId}:${profile.id}:${index}`;
          const profileBaseline = encounterThroughput(offenseTreeScenario(skillId, seed, [], profile));
          const profileDamage = encounterThroughput(offenseTreeScenario(skillId, seed, names, profile));
          return profileDamage / Math.max(1, profileBaseline);
        });
        return { profile: profile.id, ratio: median(paired) };
      });
      const representativeRatio = profileRatios.reduce((sum, result) => sum + result.ratio, 0) / profileRatios.length;
      return {
        node: node.name,
        allocatedNodes: names.length,
        damage: baseline * representativeRatio,
        improvementPct: (representativeRatio - 1) * 100,
        profiles: profileRatios.map(result => ({ profile: result.profile, improvementPct: (result.ratio - 1) * 100 }))
      };
    });
    const capstoneDamage = capstones.map(capstone => capstone.damage);
    const capstonePairs = [0, 2, 4].map(start => {
      const variants = capstones.slice(start, start + 2);
      const values = variants.map(variant => variant.damage);
      const midpoint = values.reduce((sum, value) => sum + value, 0) / values.length;
      return {
        branch: tree.branches[start / 2].name,
        variants: variants.map(variant => variant.node),
        spreadPct: midpoint ? (Math.max(...values) - Math.min(...values)) / midpoint * 100 : 0
      };
    });
    return {
      skillId,
      allocatedNodes: TREE_BUILD_NODES[skillId].length,
      baselineDamage: baseline,
      tenPointDamage,
      improvementPct: baseline ? (tenPointDamage / baseline - 1) * 100 : 0,
      modifierCaps: {
        attackSpeedPct: representativeModifiers.attackSpeedPct,
        techniqueCooldownPct: representativeModifiers.techniqueCooldownPct,
        criticalChance: representativeModifiers.criticalChance,
        penetration: Math.max(representativeModifiers.armourPenetration, representativeModifiers.wardPenetration)
      },
      capstones,
      capstonePairs,
      capstoneSpreadPct: Math.max(...capstonePairs.map(pair => pair.spreadPct)),
      allCapstoneSpreadPct: median(capstoneDamage) ? (Math.max(...capstoneDamage) - Math.min(...capstoneDamage)) / median(capstoneDamage) * 100 : 0
    };
  });
}

export function measureBuild(build: BalanceBuild, stage: number, samples = 51) {
  const results = Array.from({ length: samples }, (_, index) => simulateSoloCombat(balanceInputForBuild(build, stage, `${build.name}:${stage}:${index}`)));
  const victories = results.filter(result => result.outcome === 'victory');
  return {
    build: build.name,
    stage,
    winRate: victories.length / results.length,
    medianClearSeconds: median(victories.map(result => result.metrics.durationSeconds)),
    medianHealthRemaining: median(results.map(result => result.playerHitPointsRemaining)),
    medianDamageTaken: median(results.map(result => result.metrics.damage.taken)),
    medianMitigation: median(results.map(result => result.metrics.mitigation.armourRate)),
    medianEnemyHitRate: median(results.map(result => result.metrics.hitRate.enemyRate))
  };
}

export function runSoloFrontierBalanceAudit() {
  const stage = 15;
  const starter = SOLO_FRONTIER_BALANCE_BUILDS.find(build => build.name === 'starter')!;
  const initiate = SOLO_FRONTIER_BALANCE_BUILDS.find(build => build.name === 'initiate-checkpoint')!;
  const firearm = SOLO_FRONTIER_BALANCE_BUILDS.find(build => build.name === 'firearm')!;
  const vanguard = SOLO_FRONTIER_BALANCE_BUILDS.find(build => build.name === 'vanguard-checkpoint')!;
  const apex = SOLO_FRONTIER_BALANCE_BUILDS.find(build => build.name === 'apex-checkpoint')!;
  let cumulativeSeconds = 0;
  const milestones = { stage10Hours: 0, stage20Hours: 0, stage30Hours: 0 };
  const route = Array.from({ length: 30 }, (_, index) => {
    const routeStage = index + 1;
    const build = routeStage <= 7 ? starter : routeStage <= 10 ? initiate : routeStage < 20 ? firearm : routeStage === 20 ? vanguard : apex;
    const measurement = measureBuild(build, routeStage, 21);
    const encounterSeconds = (measurement.medianClearSeconds || 60) + SOLO_FRONTIER_ENCOUNTER_RECOVERY_SECONDS;
    cumulativeSeconds += soloFrontierStage(routeStage).victoriesToClear * encounterSeconds;
    if (routeStage === 10) milestones.stage10Hours = cumulativeSeconds / 3_600;
    if (routeStage === 20) milestones.stage20Hours = cumulativeSeconds / 3_600;
    if (routeStage === 30) milestones.stage30Hours = cumulativeSeconds / 3_600;
    return { stage: routeStage, build: build.name, encounters: soloFrontierStage(routeStage).victoriesToClear, medianEncounterSeconds: encounterSeconds, cumulativeHours: cumulativeSeconds / 3_600 };
  });
  const firstLootMinutes = Array.from({ length: 51 }, (_, index) => {
    let state = createInitialSoloFrontierState({ seed: `first-loot:${index}`, lastUpdatedAt: 1 });
    state = setSoloFrontierOrder(state, 'push');
    const result = advanceSoloFrontier(state, 10 * 60 * 1_000, { combatInput: (combatStage, seed) => balanceInputForBuild(starter, combatStage, seed) });
    const first = [...result.state.lootCache.items].sort((left, right) => left.acquiredAt - right.acquiredAt)[0];
    return first ? (first.acquiredAt - 1) / 60_000 : Number.POSITIVE_INFINITY;
  });
  const farmKeptItems = Array.from({ length: 11 }, (_, index) => {
    let state = createInitialSoloFrontierState({
      seed: `eight-hour-farm:${index}`,
      highestClearedStage: 15,
      firstClearStages: Array.from({ length: 15 }, (_, stageIndex) => stageIndex + 1),
      lastUpdatedAt: 1
    });
    state = setSoloFrontierOrder(state, 'farm', 15);
    const debrief = advanceSoloFrontier(state, 8 * 60 * 60 * 1_000, { combatInput: (combatStage, seed) => balanceInputForBuild(firearm, combatStage, seed) }).debrief;
    return Object.values(debrief.rarityCounts).reduce((sum, count) => sum + count, 0);
  });
  return {
    generatedAt: 'deterministic',
    stage,
    builds: SOLO_FRONTIER_BALANCE_BUILDS.map(build => measureBuild(build, stage)),
    milestoneBuilds: [measureBuild(vanguard, 20), measureBuild(apex, 30)],
    pacing: {
      firstLootMedianMinutes: median(firstLootMinutes),
      firstLootWithinTenMinutesRate: firstLootMinutes.filter(minutes => minutes <= 10).length / firstLootMinutes.length,
      farmEightHourMedianKeptItems: median(farmKeptItems),
      ...milestones
    },
    offenseTrees: offenseTreeBalanceAudit(),
    route,
    starterRoute: Array.from({ length: 12 }, (_, index) => measureBuild(starter, index + 1, 21))
  };
}

if (process.env.SOLO_FRONTIER_BALANCE_REPORT === '1' || process.env.SOLO_FRONTIER_BALANCE_OUTPUT) {
  const report = JSON.stringify(runSoloFrontierBalanceAudit(), null, 2);
  if (process.env.SOLO_FRONTIER_BALANCE_REPORT === '1') console.log(report);
  if (process.env.SOLO_FRONTIER_BALANCE_OUTPUT) {
    const { mkdir, writeFile } = await import('node:fs/promises');
    const { dirname } = await import('node:path');
    await mkdir(dirname(process.env.SOLO_FRONTIER_BALANCE_OUTPUT), { recursive: true });
    await writeFile(process.env.SOLO_FRONTIER_BALANCE_OUTPUT, `${report}\n`);
  }
}
