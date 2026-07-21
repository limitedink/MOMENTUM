import { COMBAT_SKILL_IDS, type CombatSkillId } from '../src/game/combat-progression';
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
