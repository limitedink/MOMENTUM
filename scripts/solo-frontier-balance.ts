import { COMBAT_SKILL_IDS, type CombatSkillId } from '../src/game/combat-progression';
import { createInitialCombatProgression } from '../src/game/combat-progression';
import {
  COMBAT_SKILL_TREES,
  DEFENSE_COMBAT_SKILL_IDS,
  OFFENSE_COMBAT_SKILL_IDS,
  SUSTAIN_COMBAT_SKILL_IDS,
  allocateCombatTreeNode,
  createCombatDevelopmentState,
  resolveCombatDefenseProfile,
  resolveCombatModifierSnapshot,
  resolveCombatSustainProfile
} from '../src/game/combat-development';
import { COMBAT_LOOT_DEFINITIONS, calculateEquippedStats, createEquipmentLoadout, inspectItem, type EquipmentLoadout, type ItemInstance } from '../src/game/loot';
import {
  SOLO_FRONTIER_ENCOUNTER_RECOVERY_SECONDS,
  advanceSoloFrontier,
  createInitialSoloFrontierState,
  deriveSoloPlayerStats,
  setSoloFrontierOrder,
  simulateSoloCombat,
  soloFrontierStage,
  soloThreatForStage,
  type SoloThreatProfileId,
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
  defenseTree?: (typeof DEFENSE_COMBAT_SKILL_IDS)[number];
  defenseCapstone?: string;
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
  { name: 'vanguard-checkpoint', weapon: 'firearm', armour: 'heavy', level: 70, itemLevel: 20, stance: 'Guarded', defensiveAbility: 'Mend', aura: 'Battle Focus', defenseTree: 'Medium Armour Proficiency' },
  { name: 'apex-checkpoint', weapon: 'firearm', armour: 'heavy', level: 100, itemLevel: 30, stance: 'Guarded', defensiveAbility: 'Mend', aura: 'Battle Focus', rarity: 'rare', defenseTree: 'Evasion', defenseCapstone: 'Untouchable Rhythm' },
  { name: 'intentionally-poor', weapon: 'melee', armour: 'light', level: 1, itemLevel: 1, stance: 'Aggressive', defensiveAbility: 'none', aura: 'none', poor: true }
]);

function skills(level: number): SoloCombatInput['combatSkills'] {
  return Object.fromEntries(COMBAT_SKILL_IDS.map((id: CombatSkillId) => [id, level])) as SoloCombatInput['combatSkills'];
}

function armourPieceCounts(armourPieces: SoloCombatInput['equippedStats']['armourPieces']) {
  return armourPieces.reduce((counts, piece) => ({
    ...counts,
    [piece.armourClass]: Number(counts[piece.armourClass] || 0) + 1
  }), { light: 0, medium: 0, heavy: 0 });
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
  const armourPieces = build.poor ? [] : snapshot.armourPieces;
  const developmentBuild = build.defenseTree
    ? allocateTreeBuild(build.defenseTree, build.defenseCapstone ? capstoneVariantBuild(build.defenseTree, COMBAT_SKILL_TREES[build.defenseTree].tree!.nodes.find(node => node.name === build.defenseCapstone)!.id) : [])
    : null;
  const combatModifiers = developmentBuild
    ? resolveCombatModifierSnapshot(developmentBuild.development, developmentBuild.progression, {
      style: weapon.style,
      technique: weapon.technique,
      stance: build.stance,
      defensiveAbility: build.defensiveAbility === 'none' ? undefined : build.defensiveAbility,
      aura: build.aura === 'none' ? undefined : build.aura,
      boss: soloFrontierStage(stage).enemy.kind === 'boss',
      enemyWarded: soloFrontierStage(stage).enemy.ward > 0,
      enemyHealthRatio: 1,
      playerHealthRatio: 1,
      displayedHitChance: 0.90,
      baseInterval: Number(weaponInspection.stats.attackInterval || 1),
      armourPieceCounts: armourPieceCounts(armourPieces)
    })
    : undefined;
  return {
    combatSkills: skills(build.level),
    equippedStats: {
      hitPoints: build.poor ? 0 : Number(allStats.hp || 0),
      damage: build.poor ? 0 : Math.max(0, Number(allStats.damage || 0) - Number(weaponStats.damage || 0)),
      accuracy: build.poor ? 0 : Math.max(0, Number(allStats.accuracy || 0) - Number(weaponStats.accuracy || 0)),
      evasion: build.poor ? 0 : Number(allStats.evasion || 0),
      ward: build.poor ? 0 : Number(allStats.ward || 0),
      armourPieces,
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
    seed,
    combatModifiers
  };
}

function median(values: readonly number[]): number {
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.floor(sorted.length / 2)] ?? 0;
}

function auditRound(value: number): number {
  return Number(value.toFixed(6));
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

function allocateTreeBuild(skillId: CombatSkillId, nodeNames: readonly string[]) {
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
  skillId: CombatSkillId,
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

interface DefenseAuditSpec {
  name: string;
  skillId: (typeof DEFENSE_COMBAT_SKILL_IDS)[number];
  armour: ArmourClass;
  capstone: string;
  defensiveAbility: SoloCombatInput['defensiveAbility'];
  expectedProfile: SoloThreatProfileId;
}

const DEFENSE_AUDIT_SPECS: readonly DefenseAuditSpec[] = Object.freeze([
  { name: 'light-defense', skillId: 'Light Armour Proficiency', armour: 'light', capstone: 'No Clean Hit', defensiveAbility: 'Mend', expectedProfile: 'skirmisher' },
  { name: 'medium-defense', skillId: 'Medium Armour Proficiency', armour: 'medium', capstone: 'Aegis Mail', defensiveAbility: 'Mend', expectedProfile: 'spellblade' },
  { name: 'heavy-defense', skillId: 'Heavy Armour Proficiency', armour: 'heavy', capstone: 'Iron Rhythm', defensiveAbility: 'Mend', expectedProfile: 'standard' },
  { name: 'evasion-defense', skillId: 'Evasion', armour: 'light', capstone: 'Vanishing Point', defensiveAbility: 'Mend', expectedProfile: 'breaker' },
  { name: 'warding-defense', skillId: 'Warding', armour: 'medium', capstone: 'Impenetrable Dome', defensiveAbility: 'Arcane Barrier', expectedProfile: 'arcanist' }
]);

interface DefenseThreatPortfolio {
  id: SoloThreatProfileId;
  label: string;
  expectedBuild: string;
  accuracy: number;
}

const DEFENSE_THREAT_PORTFOLIOS: readonly DefenseThreatPortfolio[] = Object.freeze([
  { id: 'standard', label: 'steady physical', expectedBuild: 'heavy-defense', accuracy: 20 },
  { id: 'skirmisher', label: 'rapid physical', expectedBuild: 'light-defense', accuracy: 20 },
  { id: 'breaker', label: 'heavy penetrating physical', expectedBuild: 'evasion-defense', accuracy: 10 },
  { id: 'arcanist', label: 'penetrating magical', expectedBuild: 'warding-defense', accuracy: 20 },
  { id: 'spellblade', label: 'alternating mixed', expectedBuild: 'medium-defense', accuracy: 20 }
]);

const THREAT_STAGE_FOR_PROFILE: Readonly<Record<SoloThreatProfileId, number>> = Object.freeze({
  standard: 1,
  skirmisher: 4,
  breaker: 5,
  arcanist: 7,
  spellblade: 8,
  initiate: 10,
  vanguard: 20,
  apex: 30
});

function defenseModifierContext(input: SoloCombatInput) {
  return {
    style: input.activeWeapon.style,
    technique: input.technique,
    stance: input.stance,
    aura: input.aura === 'none' ? undefined : input.aura,
    defensiveAbility: input.defensiveAbility === 'none' ? undefined : input.defensiveAbility,
    boss: input.enemy.kind === 'boss',
    enemyWarded: input.enemy.ward > 0,
    enemyHealthRatio: 1,
    playerHealthRatio: 1,
    displayedHitChance: 0.9,
    baseInterval: input.activeWeapon.attackInterval,
    armourPieceCounts: armourPieceCounts(input.equippedStats.armourPieces)
  };
}

function defensePortfolioInput(build: BalanceBuild, profileId: SoloThreatProfileId, seed: string): SoloCombatInput {
  const portfolio = DEFENSE_THREAT_PORTFOLIOS.find(candidate => candidate.id === profileId)!;
  const base = balanceInputForBuild(build, 30, seed);
  return {
    ...base,
    stage: 30,
    enemy: {
      ...base.enemy,
      accuracy: portfolio.accuracy,
      threat: soloThreatForStage(THREAT_STAGE_FOR_PROFILE[profileId])
    }
  };
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

const SUSTAIN_TREE_BUILD_NODES: Readonly<Record<(typeof SUSTAIN_COMBAT_SKILL_IDS)[number], readonly string[]>> = Object.freeze({
  'Support Magic': [
    'Linked Rhythm', 'Return Current', 'Mutual Flow', 'Perfect Circuit',
    'Focused Signal', 'Soothing Field', 'Guided Strikes', 'Quickening Current',
    'Steady Pulse', 'Restorative Chorus'
  ],
  Reflexes: [
    'Heightened Senses', 'Shake It Off', 'Accelerated Recovery', 'Adrenal Surge',
    'Quick Response', 'Rebound', 'Fluid Motion', 'Technique Instinct',
    'Counterstep', 'Read the Opening'
  ],
  Healing: [
    'Field Medicine', 'Lingering Care', 'Sustained Treatment', 'Renewing Tide',
    'Rapid Aid', 'No Waste', 'Potent Remedy', 'Practised Hands',
    'Critical Care', 'Efficient Practice'
  ],
  Vitality: [
    'Natural Recovery', 'Recuperation', 'Adaptive Recovery', 'Living Engine',
    'Hardy', 'Grit', 'Deep Reserves', 'Efficient Circulation',
    'Steady Pulse', 'Emergency Reserve'
  ]
});

interface SustainScenarioProfile {
  id: string;
  hitPoints: number;
  damage: number;
  accuracy: number;
  attackInterval: number;
}

const SUSTAIN_SCENARIO_PROFILES: readonly SustainScenarioProfile[] = Object.freeze([
  { id: 'steady-attrition', hitPoints: 1_800, damage: 28, accuracy: 80, attackInterval: 0.85 },
  { id: 'heavy-pressure', hitPoints: 1_500, damage: 54, accuracy: 90, attackInterval: 1.35 },
  { id: 'rapid-pressure', hitPoints: 2_000, damage: 20, accuracy: 115, attackInterval: 0.48 }
]);

function sustainTreeScenario(
  skillId: (typeof SUSTAIN_COMBAT_SKILL_IDS)[number],
  seed: string,
  nodeNames: readonly string[] = [],
  profile: SustainScenarioProfile = SUSTAIN_SCENARIO_PROFILES[0]
): SoloCombatInput {
  const state = nodeNames.length ? allocateTreeBuild(skillId, nodeNames) : null;
  const context = {
    style: 'medium-melee' as const,
    technique: 'Power Strike' as const,
    stance: 'Balanced' as const,
    aura: 'Battle Focus' as const,
    defensiveAbility: 'Mend' as const,
    boss: true,
    enemyWarded: false,
    enemyHealthRatio: 1,
    playerHealthRatio: 1,
    displayedHitChance: 0.9,
    baseInterval: 0.68
  };
  const combatModifiers = state
    ? resolveCombatModifierSnapshot(state.development, state.progression, context)
    : undefined;
  return {
    combatSkills: skills(100),
    equippedStats: { hitPoints: 260, accuracy: 15, evasion: 20, ward: 0, armourPieces: [] },
    activeWeapon: {
      id: `sustain:${skillId}`,
      name: `${skillId} Balance Weapon`,
      style: 'medium-melee',
      damage: 26,
      accuracy: 25,
      attackInterval: 0.68
    },
    stance: 'Balanced',
    technique: 'Power Strike',
    defensiveAbility: 'Mend',
    aura: 'Battle Focus',
    enemy: {
      id: `sustain:${profile.id}`,
      name: 'Sustain Pressure Target',
      kind: 'boss',
      hitPoints: profile.hitPoints,
      damage: profile.damage,
      armour: 65,
      ward: 0,
      evasion: 35,
      accuracy: profile.accuracy,
      attackInterval: profile.attackInterval,
      damageType: 'physical'
    },
    stage: 20,
    seed,
    combatModifiers
  };
}

function sustainOutcomeScore(input: SoloCombatInput): number {
  const result = simulateSoloCombat(input);
  const maximumHitPoints = deriveSoloPlayerStats(input).maxHitPoints;
  const survivalMargin = (
    result.playerHitPointsRemaining
    + result.metrics.sustain.healing
    + result.metrics.sustain.damagePrevented
  ) / Math.max(1, maximumHitPoints);
  const progress = result.outcome === 'victory'
    ? 1 + 30 / Math.max(30, result.metrics.durationSeconds)
    : result.enemyHealthRemovedPercent / 100;
  return progress + survivalMargin;
}

function sustainTreeBalanceAudit(samples = 11) {
  return SUSTAIN_COMBAT_SKILL_IDS.map(skillId => {
    const buildNodes = SUSTAIN_TREE_BUILD_NODES[skillId];
    const pairedProfileRatios = SUSTAIN_SCENARIO_PROFILES.map(profile => {
      const ratios = Array.from({ length: samples }, (_, index) => {
        const seed = `sustain:${skillId}:${profile.id}:${index}`;
        const baseline = sustainOutcomeScore(sustainTreeScenario(skillId, seed, [], profile));
        const built = sustainOutcomeScore(sustainTreeScenario(skillId, seed, buildNodes, profile));
        return built / Math.max(0.001, baseline);
      });
      return { profile: profile.id, improvementPct: (median(ratios) - 1) * 100 };
    });
    const averageRatio = pairedProfileRatios.reduce((sum, profile) => sum + 1 + profile.improvementPct / 100, 0)
      / pairedProfileRatios.length;
    const representativeInput = sustainTreeScenario(skillId, `sustain:${skillId}:representative`, buildNodes);
    const representativeResult = simulateSoloCombat(representativeInput);
    const representativeContext = {
      style: representativeInput.activeWeapon.style,
      technique: representativeInput.technique,
      stance: representativeInput.stance,
      aura: representativeInput.aura === 'none' ? undefined : representativeInput.aura,
      defensiveAbility: representativeInput.defensiveAbility === 'none' ? undefined : representativeInput.defensiveAbility,
      boss: true,
      enemyWarded: false,
      playerHealthRatio: 0.25,
      enemyHealthRatio: 0.5,
      baseInterval: representativeInput.activeWeapon.attackInterval
    };
    const sustainProfile = resolveCombatSustainProfile(representativeInput.combatModifiers, representativeContext);
    const tree = COMBAT_SKILL_TREES[skillId].tree!;
    const capstones = tree.nodes.filter(node => node.capstone).map(node => {
      const names = capstoneVariantBuild(skillId, node.id);
      const profileImprovements = SUSTAIN_SCENARIO_PROFILES.map(profile => {
        const ratios = Array.from({ length: samples }, (_, index) => {
          const seed = `sustain:${skillId}:${node.id}:${profile.id}:${index}`;
          const baseline = sustainOutcomeScore(sustainTreeScenario(skillId, seed, [], profile));
          const built = sustainOutcomeScore(sustainTreeScenario(skillId, seed, names, profile));
          return built / Math.max(0.001, baseline);
        });
        return { profile: profile.id, improvementPct: (median(ratios) - 1) * 100 };
      });
      return {
        node: node.name,
        allocatedNodes: names.length,
        improvementPct: profileImprovements.reduce((sum, profile) => sum + profile.improvementPct, 0)
          / profileImprovements.length,
        profiles: profileImprovements
      };
    });
    return {
      skillId,
      allocatedNodes: buildNodes.length,
      improvementPct: (averageRatio - 1) * 100,
      profiles: pairedProfileRatios,
      representative: {
        outcome: representativeResult.outcome,
        durationSeconds: representativeResult.metrics.durationSeconds,
        healthRemaining: representativeResult.playerHitPointsRemaining,
        healing: representativeResult.metrics.sustain.healing,
        damagePrevented: representativeResult.metrics.sustain.damagePrevented,
        emergencies: representativeResult.metrics.sustain.emergencyTriggers
      },
      modifierCaps: {
        maxHitPointsMultiplier: sustainProfile.maxHitPointsMultiplier,
        healingMultiplier: sustainProfile.healingMultiplier,
        mendCooldownMultiplier: sustainProfile.mendCooldownMultiplier,
        damageTakenMultiplier: sustainProfile.damageTakenMultiplier,
        regenerationPctPerSecond: sustainProfile.regenerationPctPerSecond,
        reserveCapPct: sustainProfile.recoveryReserveCapPct,
        damageRecoveryPct: sustainProfile.damageRecoveryPct,
        fatalGuardPct: sustainProfile.fatalGuardPct
      },
      capstones
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

function defenseAuditBuild(spec: DefenseAuditSpec, name = spec.name): BalanceBuild {
  return {
    name,
    weapon: 'firearm',
    armour: spec.armour,
    level: 100,
    itemLevel: 30,
    stance: spec.skillId === 'Heavy Armour Proficiency' ? 'Guarded' : 'Balanced',
    defensiveAbility: spec.defensiveAbility,
    aura: 'Battle Focus',
    rarity: 'rare',
    defenseTree: spec.skillId,
    defenseCapstone: spec.capstone
  };
}

function defenseSurvivalScore(input: SoloCombatInput, result: ReturnType<typeof simulateSoloCombat>): number {
  const maximumHitPoints = deriveSoloPlayerStats(input).maxHitPoints;
  const healthFraction = result.playerHitPointsRemaining / Math.max(1, maximumHitPoints);
  return (result.outcome === 'victory' ? 1 : result.enemyHealthRemovedPercent / 100) + healthFraction;
}

function measureDefensePortfolio(build: BalanceBuild, profileId: SoloThreatProfileId, samples = 11) {
  const results = Array.from({ length: samples }, (_, index) => {
    const input = defensePortfolioInput(build, profileId, `defense:${build.name}:${profileId}:${index}`);
    return { input, result: simulateSoloCombat(input) };
  });
  const victories = results.filter(({ result }) => result.outcome === 'victory');
  const scores = results.map(({ input, result }) => defenseSurvivalScore(input, result));
  const throughput = results.map(({ result }) => result.metrics.damage.dealt / Math.max(0.001, result.metrics.durationSeconds + SOLO_FRONTIER_ENCOUNTER_RECOVERY_SECONDS));
  return {
    profile: profileId,
    winRate: victories.length / results.length,
    survivalScore: median(scores),
    medianDamageTaken: median(results.map(({ result }) => result.metrics.damage.taken)),
    medianThroughput: median(throughput),
    medianHealthRemaining: median(results.map(({ result }) => result.playerHitPointsRemaining)),
    medianNaturalMisses: median(results.map(({ result }) => result.metrics.defense.naturalMisses)),
    medianConvertedMisses: median(results.map(({ result }) => result.metrics.defense.convertedMisses)),
    medianGlancingPrevented: median(results.map(({ result }) => result.metrics.defense.glancingPrevented)),
    medianGuardPrevented: median(results.map(({ result }) => result.metrics.defense.guardPrevented)),
    medianArmourPrevented: median(results.map(({ result }) => result.metrics.defense.armourPrevented)),
    medianWardPrevented: median(results.map(({ result }) => result.metrics.defense.wardPrevented)),
    medianDefenseReduction: median(results.map(({ result }) => result.metrics.defense.defensePrevented)),
    medianBarrierAbsorption: median(results.map(({ result }) => result.metrics.defense.barrierAbsorption)),
    medianRetaliationDamage: median(results.map(({ result }) => result.metrics.defense.retaliationDamage)),
    medianDefensePrevented: median(results.map(({ result }) => result.metrics.defense.defensePrevented + result.metrics.defense.armourPrevented + result.metrics.defense.wardPrevented + result.metrics.defense.barrierAbsorption))
  };
}

function defenseFocusCoefficient(profileId: SoloThreatProfileId): number {
  if (profileId === 'standard') return 0.0005;
  if (profileId === 'skirmisher') return 0.002;
  if (profileId === 'breaker') return 0.10;
  if (profileId === 'arcanist') return 0.0011;
  return 0.002;
}

function defenseFocusSignature(profileId: SoloThreatProfileId, measurement: ReturnType<typeof measureDefensePortfolio>): number {
  if (profileId === 'standard') return measurement.medianArmourPrevented + measurement.medianGuardPrevented;
  if (profileId === 'skirmisher') return measurement.medianGlancingPrevented;
  if (profileId === 'breaker') return measurement.medianConvertedMisses;
  if (profileId === 'arcanist') return measurement.medianWardPrevented + measurement.medianBarrierAbsorption;
  return measurement.medianDefenseReduction;
}

function defenseFocusScore(profileId: SoloThreatProfileId, measurement: ReturnType<typeof measureDefensePortfolio>): number {
  return 1 + defenseFocusCoefficient(profileId) * Math.max(0, defenseFocusSignature(profileId, measurement));
}

function defenseTreeBalanceAudit(samples = 11) {
  return DEFENSE_AUDIT_SPECS.map(spec => {
    const build = defenseAuditBuild(spec);
    const baseline = defenseAuditBuild(spec, `${spec.name}-baseline`);
    delete baseline.defenseTree;
    delete baseline.defenseCapstone;
    const portfolioResults = DEFENSE_THREAT_PORTFOLIOS.map(profile => {
      const built = measureDefensePortfolio(build, profile.id, samples);
      const unbuilt = measureDefensePortfolio(baseline, profile.id, samples);
      return {
        ...built,
        improvementPct: unbuilt.survivalScore > 0 ? (built.survivalScore / unbuilt.survivalScore - 1) * 100 : 0,
        focusScore: defenseFocusScore(profile.id, built),
        baselineFocusScore: defenseFocusScore(profile.id, unbuilt),
        focusImprovementPct: (defenseFocusScore(profile.id, built) / defenseFocusScore(profile.id, unbuilt) - 1) * 100,
        baselineScore: unbuilt.survivalScore,
        baselineWinRate: unbuilt.winRate
      };
    });
    const representative = portfolioResults.find(result => result.profile === spec.expectedProfile)!;
    const tree = COMBAT_SKILL_TREES[spec.skillId].tree!;
    const capstones = tree.nodes.filter(node => node.capstone).map(node => {
      const capstoneBuild: BalanceBuild = { ...build, name: `${spec.name}:${node.name}`, defenseCapstone: node.name };
      const results = DEFENSE_THREAT_PORTFOLIOS.map(profile => measureDefensePortfolio(capstoneBuild, profile.id, Math.max(5, Math.floor(samples / 2))));
      const score = median(results.map(result => result.survivalScore));
      const intended = results.find(result => result.profile === spec.expectedProfile)!;
      return {
        node: node.name,
        allocatedNodes: capstoneVariantBuild(spec.skillId, node.id).length,
        survivalScore: score,
        focusScore: defenseFocusScore(spec.expectedProfile, intended),
        intendedImprovementPct: representative.baselineScore > 0 ? (intended.survivalScore / representative.baselineScore - 1) * 100 : 0,
        intendedFocusImprovementPct: defenseFocusScore(spec.expectedProfile, intended) / defenseFocusScore(spec.expectedProfile, measureDefensePortfolio({ ...baseline }, spec.expectedProfile, Math.max(5, Math.floor(samples / 2)))) * 100 - 100,
        profiles: results.map(result => ({ profile: result.profile, survivalScore: result.survivalScore }))
      };
    });
    const capstonePairs = [0, 2, 4].map(start => {
      const variants = capstones.slice(start, start + 2);
      const values = variants.map(variant => variant.focusScore);
      const midpoint = values.reduce((sum, value) => sum + value, 0) / Math.max(1, values.length);
      return {
        branch: tree.branches[start / 2].name,
        variants: variants.map(variant => variant.node),
        spreadPct: midpoint ? (Math.max(...values) - Math.min(...values)) / midpoint * 100 : 0
      };
    });
    const defenseInput = defensePortfolioInput(build, spec.expectedProfile, `defense:${spec.name}:profile`);
    const staticProfile = resolveCombatDefenseProfile(defenseInput.combatModifiers, defenseModifierContext(defenseInput));
    return {
      skillId: spec.skillId,
      build: spec.name,
      expectedProfile: spec.expectedProfile,
      selectedCapstone: spec.capstone,
      allocatedNodes: capstoneVariantBuild(spec.skillId, tree.nodes.find(node => node.name === spec.capstone)!.id).length,
      representativeProfile: representative.profile,
      improvementPct: representative.focusImprovementPct,
      rawSurvivalImprovementPct: representative.improvementPct,
      representative,
      modifierCaps: {
        armour: auditRound(Math.max(...Object.values(staticProfile.armourMultiplierByClass).map(value => value - 1))),
        ward: auditRound(staticProfile.wardMultiplier - 1),
        evasion: auditRound(staticProfile.evasionBonus),
        enemyHitChanceReduction: auditRound(staticProfile.enemyHitChanceReduction),
        physicalReduction: auditRound(1 - staticProfile.physicalDamageMultiplier),
        magicalReduction: auditRound(1 - staticProfile.magicalDamageMultiplier),
        penetrationResistance: auditRound(Math.max(staticProfile.armourPenetrationResistance, staticProfile.wardPenetrationResistance)),
        barrierStrength: auditRound(staticProfile.barrierStrengthMultiplier - 1),
        barrierCooldown: auditRound(1 - staticProfile.barrierCooldownMultiplier)
      },
      portfolioResults,
      capstones,
      capstonePairs,
      capstoneSpreadPct: Math.max(...capstonePairs.map(pair => pair.spreadPct))
    };
  });
}

function threatPortfolioBalanceAudit(defenseTrees: ReturnType<typeof defenseTreeBalanceAudit>, samples = 11) {
  const builds = DEFENSE_AUDIT_SPECS.map(spec => defenseAuditBuild(spec));
  const standardEnemy = soloFrontierStage(30).enemy;
  const standardDps = standardEnemy.damage / standardEnemy.attackInterval;
  return DEFENSE_THREAT_PORTFOLIOS.map(portfolio => {
    const threat = soloThreatForStage(THREAT_STAGE_FOR_PROFILE[portfolio.id]);
    const averageMultiplier = threat.attackCycle.reduce((sum, step) => sum + step.damageMultiplier, 0) / threat.attackCycle.length;
    const prePenetrationDps = standardEnemy.damage * averageMultiplier / (standardEnemy.attackInterval * threat.intervalMultiplier);
    const measurements = builds.map(build => {
      const measurement = measureDefensePortfolio(build, portfolio.id, samples);
      return { build: build.name, ...measurement, focusScore: defenseFocusScore(portfolio.id, measurement) };
    });
    const best = measurements.reduce((current, candidate) => candidate.focusScore > current.focusScore ? candidate : current);
    const expected = measurements.find(measurement => measurement.build === portfolio.expectedBuild) || best;
    return {
      profile: portfolio.id,
      label: portfolio.label,
      expectedBuild: portfolio.expectedBuild,
      prePenetrationDps,
      standardDps,
      standardRatio: prePenetrationDps / Math.max(0.001, standardDps),
      measurements,
      bestBuild: best.build,
      rawSurvivalLeader: measurements.reduce((current, candidate) => candidate.survivalScore > current.survivalScore ? candidate : current).build,
      expectedScore: expected.focusScore,
      expectedImprovementPct: defenseTrees.find(tree => tree.build === portfolio.expectedBuild)?.portfolioResults.find(result => result.profile === portfolio.id)?.focusImprovementPct || 0
    };
  });
}

function counterPressureBalanceAudit(samples = 11) {
  const spec = DEFENSE_AUDIT_SPECS.find(candidate => candidate.skillId === 'Heavy Armour Proficiency')!;
  const counterBuild = { ...defenseAuditBuild(spec), name: 'heavy-counter-pressure', defenseCapstone: 'Wall of Thorns' };
  const baseline = defenseAuditBuild(spec, 'heavy-counter-pressure-baseline');
  delete baseline.defenseTree;
  delete baseline.defenseCapstone;
  const profiles = ['standard', 'breaker'] as const;
  const measurements = profiles.map(profile => {
    const counter = measureDefensePortfolio(counterBuild, profile, samples);
    const unbuilt = measureDefensePortfolio(baseline, profile, samples);
    return {
      profile,
      throughputIncreasePct: (counter.medianThroughput / Math.max(0.001, unbuilt.medianThroughput) - 1) * 100,
      counterThroughput: counter.medianThroughput,
      baselineThroughput: unbuilt.medianThroughput,
      retaliationDamage: counter.medianRetaliationDamage
    };
  });
  return {
    measurements,
    maxThroughputIncreasePct: Math.max(...measurements.map(measurement => measurement.throughputIncreasePct))
  };
}

export function runSoloFrontierBalanceAudit() {
  const stage = 15;
  const starter = SOLO_FRONTIER_BALANCE_BUILDS.find(build => build.name === 'starter')!;
  const initiate = SOLO_FRONTIER_BALANCE_BUILDS.find(build => build.name === 'initiate-checkpoint')!;
  const firearm = SOLO_FRONTIER_BALANCE_BUILDS.find(build => build.name === 'firearm')!;
  const vanguard = SOLO_FRONTIER_BALANCE_BUILDS.find(build => build.name === 'vanguard-checkpoint')!;
  const apex = SOLO_FRONTIER_BALANCE_BUILDS.find(build => build.name === 'apex-checkpoint')!;
  const defenseTrees = defenseTreeBalanceAudit();
  const threatPortfolios = threatPortfolioBalanceAudit(defenseTrees);
  const counterPressure = counterPressureBalanceAudit();
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
    sustainTrees: sustainTreeBalanceAudit(),
    defenseTrees,
    threatPortfolios,
    counterPressure,
    authoredCombatTrees: {
      total: Object.values(COMBAT_SKILL_TREES).filter(entry => entry.tree).length,
      nodes: Object.values(COMBAT_SKILL_TREES).reduce((sum, entry) => sum + (entry.tree?.nodes.length || 0), 0),
      allTreesHaveTwentyOneNodes: Object.values(COMBAT_SKILL_TREES).every(entry => entry.tree?.nodes.length === 21)
    },
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
