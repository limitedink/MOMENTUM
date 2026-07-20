import {
  COMPONENT_COMBAT_SKILL_IDS,
  type CombatSkillMap,
  type DerivedCombatProfile,
  type ExpeditionAssignment,
  type ExpeditionDefinition,
  type ExpeditionForecast,
  type ExpeditionOutcome,
  type ExpeditionRewardLedger,
  type ExpeditionRewardTier,
  type ExpeditionRoleDefinition,
  type ExpeditionTargetDefinition,
  type GearSnapshot,
  type PlayerProfileSnapshot,
  type RoleFitScore
} from './expedition-types';
import { EXPEDITION_SLOT_EFFICIENCY } from './expedition-slot-policy';

const clamp = (value: number, min = 0, max = 100): number => Math.max(min, Math.min(max, value));
const round = (value: number, digits = 2): number => {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
};
export const SOLO_SLOT_EFFICIENCY = EXPEDITION_SLOT_EFFICIENCY;

const LEGACY_SKILL_DISTRIBUTION: Readonly<Record<(typeof COMPONENT_COMBAT_SKILL_IDS)[number], number>> = {
  Strength: 1,
  'Melee Accuracy': 0.95,
  Marksmanship: 0.8,
  Ranged: 0.75,
  Magic: 0.75,
  Reflexes: 0.8,
  Healing: 0.65,
  'Light Armour Proficiency': 0.8,
  'Medium Armour Proficiency': 0.9,
  'Heavy Armour Proficiency': 0.7
};

function nonNegative(value: unknown): number {
  return Math.max(0, Number.isFinite(Number(value)) ? Number(value) : 0);
}

function legacyCombatLevel(profile: PlayerProfileSnapshot): number {
  if (profile.legacyCombatLevel !== undefined) return nonNegative(profile.legacyCombatLevel);
  return nonNegative(profile.skills?.Combat);
}

export function convertLegacyCombatSkills(level: number): Record<(typeof COMPONENT_COMBAT_SKILL_IDS)[number], number> {
  const normalizedLevel = Math.max(1, nonNegative(level));
  return Object.fromEntries(COMPONENT_COMBAT_SKILL_IDS.map(skillId => [
    skillId,
    round(normalizedLevel * LEGACY_SKILL_DISTRIBUTION[skillId], 2)
  ])) as Record<(typeof COMPONENT_COMBAT_SKILL_IDS)[number], number>;
}

export function convertLegacyCombatProfile(input: {
  playerId: string;
  displayName?: string;
  combatLevel: number;
  gold?: number;
  skills?: Readonly<Record<string, number>>;
  gear?: readonly GearSnapshot[];
  equippedGearIds?: readonly string[];
  talents?: readonly string[];
  loadout?: PlayerProfileSnapshot['loadout'];
}): PlayerProfileSnapshot {
  return {
    playerId: input.playerId,
    displayName: input.displayName,
    combatSkills: convertLegacyCombatSkills(input.combatLevel),
    skills: { ...input.skills, Combat: input.combatLevel },
    gold: nonNegative(input.gold),
    gear: input.gear ?? [],
    equippedGearIds: input.equippedGearIds ?? [],
    talents: input.talents ?? [],
    loadout: input.loadout ?? {},
    legacyCombatLevel: input.combatLevel
  };
}

export function respecCost(profile: Pick<PlayerProfileSnapshot, 'combatSkills' | 'legacyCombatLevel'>): number {
  const level = Math.max(1, profile.legacyCombatLevel ?? Math.round(Object.values(profile.combatSkills).reduce((sum, value) => sum + nonNegative(value), 0) / COMPONENT_COMBAT_SKILL_IDS.length));
  return 100 + level * 25;
}

export interface CombatRespecResult {
  accepted: boolean;
  cost: number;
  profile: PlayerProfileSnapshot;
  reason?: 'insufficient_gold' | 'invalid_allocation';
}

export function respecCombatSkills(
  profile: PlayerProfileSnapshot,
  allocation: CombatSkillMap
): CombatRespecResult {
  const cost = respecCost(profile);
  const nextSkills = {} as Record<(typeof COMPONENT_COMBAT_SKILL_IDS)[number], number>;
  let total = 0;
  for (const skillId of COMPONENT_COMBAT_SKILL_IDS) {
    const value = Number(allocation[skillId] ?? 0);
    if (!Number.isFinite(value) || value < 0 || value > 99) return { accepted: false, cost, profile, reason: 'invalid_allocation' };
    nextSkills[skillId] = round(value, 2);
    total += value;
  }
  const currentTotal = COMPONENT_COMBAT_SKILL_IDS.reduce((sum, skillId) => sum + nonNegative(profile.combatSkills[skillId]), 0);
  if (total > Math.max(1, currentTotal) * 1.01) return { accepted: false, cost, profile, reason: 'invalid_allocation' };
  if (nonNegative(profile.gold) < cost) return { accepted: false, cost, profile, reason: 'insufficient_gold' };
  return {
    accepted: true,
    cost,
    profile: { ...profile, gold: round(profile.gold - cost, 2), combatSkills: nextSkills, legacyCombatLevel: undefined }
  };
}

function equippedGear(profile: PlayerProfileSnapshot): GearSnapshot[] {
  const ids = new Set(profile.equippedGearIds);
  return profile.gear.filter(item => ids.has(item.id));
}

function gearTags(gear: readonly GearSnapshot[]): string[] {
  return [...new Set(gear.flatMap(item => item.tags ?? []))];
}

function affixTotal(gear: readonly GearSnapshot[], stats?: readonly string[]): number {
  const allowed = stats ? new Set(stats) : null;
  return gear.reduce((sum, item) => sum + (item.affixes ?? []).reduce((affixSum, affix) => {
    if (allowed && !allowed.has(affix.stat)) return affixSum;
    return affixSum + Math.max(0, affix.value);
  }, 0), 0);
}

export function deriveCombatProfile(profile: PlayerProfileSnapshot): DerivedCombatProfile {
  const legacy = legacyCombatLevel(profile);
  const componentSkills = Object.fromEntries(COMPONENT_COMBAT_SKILL_IDS.map(skillId => [
    skillId,
    nonNegative(profile.combatSkills[skillId]) || (legacy > 0 ? convertLegacyCombatSkills(legacy)[skillId] : 0)
  ])) as Record<(typeof COMPONENT_COMBAT_SKILL_IDS)[number], number>;
  const skillScore = COMPONENT_COMBAT_SKILL_IDS.reduce((sum, skillId) => sum + componentSkills[skillId], 0) / COMPONENT_COMBAT_SKILL_IDS.length;
  const melee = (componentSkills.Strength + componentSkills['Melee Accuracy']) / 2;
  const ranged = (componentSkills.Marksmanship + componentSkills.Ranged) / 2;
  const magic = componentSkills.Magic;
  const gear = equippedGear(profile);
  const gearScore = gear.reduce((sum, item) => sum + nonNegative(item.power), 0);
  const defenseGearScore = gear.reduce((sum, item) => sum + nonNegative(item.defense), 0);
  const affixScore = affixTotal(gear);
  const talentScore = profile.talents.length * 2 + profile.talents.filter(id => /master|capstone|guardian|overwatch/i.test(id)).length * 3;
  const loadoutScore = profile.loadout.weaponStyle ? 5 : 0;
  const armourWeight = profile.loadout.armourWeight ?? (gear.some(item => item.tags?.includes('heavy')) ? 'heavy' : gear.some(item => item.tags?.includes('medium')) ? 'medium' : gear.length ? 'light' : 'none');
  const tags = gearTags(gear);
  return {
    playerId: profile.playerId,
    componentSkills,
    combatRating: round(skillScore * 2.8 + melee * 0.35 + ranged * 0.25 + magic * 0.2 + gearScore * 0.9 + affixScore * 0.55 + talentScore * 0.7 + loadoutScore),
    defenseRating: round((componentSkills.Reflexes * 0.45 + componentSkills['Light Armour Proficiency'] * 0.35 + componentSkills['Medium Armour Proficiency'] * 0.65 + componentSkills['Heavy Armour Proficiency'] * 0.9 + componentSkills.Healing * 0.2) + defenseGearScore * 1.25 + affixScore * 0.35 + talentScore * 0.45),
    skillScore: round(skillScore),
    gearScore: round(gearScore),
    defenseGearScore: round(defenseGearScore),
    affixScore: round(affixScore),
    talentScore: round(talentScore),
    loadoutScore: round(loadoutScore),
    armourWeight,
    tags
  };
}

function skillValue(profile: PlayerProfileSnapshot, skillId: string, derived: DerivedCombatProfile): number {
  if ((COMPONENT_COMBAT_SKILL_IDS as readonly string[]).includes(skillId)) return derived.componentSkills[skillId as keyof CombatSkillMap] ?? 0;
  return nonNegative(profile.skills?.[skillId]);
}

function targetFor(definition: ExpeditionDefinition, targetId: string | null | undefined): ExpeditionTargetDefinition | null {
  return targetId ? definition.targets.find(target => target.id === targetId) ?? null : null;
}

function roleFor(definition: ExpeditionDefinition, roleId: string): ExpeditionRoleDefinition | null {
  return definition.roles.find(role => role.id === roleId) ?? null;
}

export function scoreRoleFit(
  definition: ExpeditionDefinition,
  roleId: string,
  profile: PlayerProfileSnapshot,
  targetId: string | null = null
): RoleFitScore {
  const role = roleFor(definition, roleId);
  const derived = deriveCombatProfile(profile);
  if (!role) {
    return { roleId, playerId: profile.playerId, score: 0, skillScore: 0, derivedScore: 0, gearScore: 0, requirementScore: 0, requirementsMet: false, missingRequirements: ['Unknown role'], targetId, targetRequirementMet: false, slotEfficiency: 1 };
  }
  const weights = Object.entries(role.skillWeights);
  const totalSkillWeight = weights.reduce((sum, [, weight]) => sum + Math.max(0, weight), 0) || 1;
  const skillScore = weights.reduce((sum, [skillId, weight]) => sum + clamp(skillValue(profile, skillId, derived) * 5) * weight, 0) / totalSkillWeight;
  const derivedWeights = role.derivedWeights ?? {};
  const derivedEntries = Object.entries(derivedWeights) as Array<[keyof DerivedCombatProfile, number]>;
  const derivedWeightTotal = derivedEntries.reduce((sum, [, weight]) => sum + Math.max(0, weight), 0) || 1;
  const derivedScore = derivedEntries.reduce((sum, [key, weight]) => sum + clamp(Number(derived[key]) * 1.5) * weight, 0) / derivedWeightTotal;
  const tags = new Set(derived.tags);
  const preferred = role.preferredGearTags ?? [];
  const preferredScore = preferred.length ? preferred.filter(tag => tags.has(tag)).length / preferred.length * 100 : 50;
  const missing = (role.requiredGearTags ?? []).filter(tag => !tags.has(tag)).map(tag => `Gear: ${tag}`);
  for (const talentId of role.requiredTalentIds ?? []) if (!profile.talents.includes(talentId)) missing.push(`Talent: ${talentId}`);
  const target = targetFor(definition, targetId);
  let targetRequirementMet = true;
  if (target?.requiredRoleId && target.requiredRoleId !== roleId) { targetRequirementMet = false; missing.push(`Target role: ${target.requiredRoleId}`); }
  if (target?.requiredSkillId && skillValue(profile, target.requiredSkillId, derived) < (target.requiredSkillLevel ?? 1)) { targetRequirementMet = false; missing.push(`Target skill: ${target.requiredSkillId} ${target.requiredSkillLevel}`); }
  const targetTags = target?.preferredTags ?? [];
  const targetTagScore = targetTags.length ? targetTags.filter(tag => tags.has(tag) || profile.loadout.weaponStyle === tag).length / targetTags.length * 100 : 50;
  const requirementScore = (missing.length ? 35 : 100) * (targetRequirementMet ? 1 : 0.55);
  const gearScore = preferredScore * 0.65 + targetTagScore * 0.35;
  const score = clamp(skillScore * 0.46 + derivedScore * 0.26 + gearScore * 0.16 + requirementScore * 0.12);
  return {
    roleId, playerId: profile.playerId, score: round(score), skillScore: round(skillScore), derivedScore: round(derivedScore), gearScore: round(gearScore),
    requirementScore: round(requirementScore), requirementsMet: missing.length === 0 && targetRequirementMet,
    missingRequirements: missing, targetId, targetRequirementMet, slotEfficiency: 1
  };
}

function profileFor(assignments: readonly ExpeditionAssignment[], profiles: Readonly<Record<string, PlayerProfileSnapshot>>, playerId: string): PlayerProfileSnapshot {
  return profiles[playerId] ?? { playerId, combatSkills: {}, gold: 0, gear: [], equippedGearIds: [], talents: [], loadout: {} };
}

function tierFor(definition: ExpeditionDefinition, successPercent: number): ExpeditionRewardTier {
  return [...definition.completionRewards].reverse().find(tier => successPercent >= tier.minimumSuccess) ?? definition.completionRewards[0];
}

function rewardResources(definition: ExpeditionDefinition, assignments: readonly (ExpeditionAssignment & { fit: RoleFitScore })[], farmingMultiplier: number): Record<string, number> {
  const resources: Record<string, number> = {};
  for (const assignment of assignments) {
    const role = roleFor(definition, assignment.roleId);
    if (!role || !assignment.active) continue;
    const target = targetFor(definition, assignment.targetId);
    const targetResource = target?.materialId;
    const fitMultiplier = 0.45 + assignment.fit.score / 100 * 0.75;
    for (const [resourceId, hourlyRate] of Object.entries(definition.farmingRewards)) {
      const targetMatch = targetResource === resourceId ? 1.8 : targetResource ? 0.35 : 1;
      resources[resourceId] = (resources[resourceId] ?? 0) + hourlyRate * role.farmingWeight * fitMultiplier * targetMatch * farmingMultiplier * assignment.fit.slotEfficiency;
    }
  }
  return Object.fromEntries(Object.entries(resources).map(([key, value]) => [key, Math.max(0, Math.floor(value * 100) / 100)]));
}

export function forecastExpedition(
  definition: ExpeditionDefinition,
  assignments: readonly ExpeditionAssignment[],
  profiles: Readonly<Record<string, PlayerProfileSnapshot>>
): ExpeditionForecast {
  const activeAssignments = assignments.filter(assignment => assignment.active).slice(0, definition.slotCount);
  const roleCounts = new Map<string, number>();
  activeAssignments.forEach(assignment => roleCounts.set(assignment.roleId, (roleCounts.get(assignment.roleId) ?? 0) + 1));
  const slotsByPlayer = new Map<string, number>();
  const scoredAssignments = activeAssignments.map(assignment => {
    const playerSlotIndex = slotsByPlayer.get(assignment.playerId) ?? 0;
    slotsByPlayer.set(assignment.playerId, playerSlotIndex + 1);
    return {
      ...assignment,
      fit: {
        ...scoreRoleFit(definition, assignment.roleId, profileFor(assignments, profiles, assignment.playerId), assignment.targetId ?? null),
        slotEfficiency: SOLO_SLOT_EFFICIENCY[playerSlotIndex] ?? SOLO_SLOT_EFFICIENCY.at(-1)!
      }
    };
  });
  const totalRoleWeight = definition.roles.reduce((sum, role) => sum + role.completionWeight, 0) || 1;
  const coveredWeight = definition.roles.reduce((sum, role) => sum + (roleCounts.has(role.id) ? role.completionWeight : 0), 0);
  const roleCoveragePercent = clamp(coveredWeight / totalRoleWeight * 100);
  const duplicateRolePenalty = definition.allowDuplicateRoles ? [...roleCounts.values()].reduce((sum, count) => sum + Math.max(0, count - 1) * 8, 0) : [...roleCounts.values()].reduce((sum, count) => sum + Math.max(0, count - 1) * 22, 0);
  const uniquePlayers = new Set(activeAssignments.map(assignment => assignment.playerId)).size;
  const soloEfficiency = scoredAssignments.length ? round(scoredAssignments.reduce((sum, assignment) => sum + assignment.fit.slotEfficiency, 0) / scoredAssignments.length) : 0;
  const averageRoleFit = scoredAssignments.length ? scoredAssignments.reduce((sum, assignment) => sum + assignment.fit.score * assignment.fit.slotEfficiency, 0) / scoredAssignments.length : 0;
  const dangerReduction = scoredAssignments.reduce((sum, assignment) => sum + (roleFor(definition, assignment.roleId)?.dangerReduction ?? 0) * (assignment.fit.score / 100) * assignment.fit.slotEfficiency, 0);
  const targetDanger = scoredAssignments.reduce((sum, assignment) => sum + (targetFor(definition, assignment.targetId)?.dangerModifier ?? 0), 0) / Math.max(1, scoredAssignments.length);
  const baseDanger = definition.baseDanger + targetDanger - dangerReduction * 8;
  const dangerPercent = clamp(baseDanger + (100 - averageRoleFit) * 0.42 + duplicateRolePenalty * 0.3, 0, definition.maxDanger);
  const successPercent = clamp(definition.baseSuccess + averageRoleFit * 0.5 + roleCoveragePercent * 0.35 - dangerPercent * 0.22 - duplicateRolePenalty * 0.25);
  const partyCoverageMultiplier = round(Math.max(0, 0.65 + roleCoveragePercent / 100 * 0.35));
  const farmingMultiplier = round(partyCoverageMultiplier * soloEfficiency);
  const rewardResourcesForecast = rewardResources(definition, scoredAssignments, partyCoverageMultiplier);
  const warnings: string[] = [];
  if (activeAssignments.length < definition.slotCount) warnings.push(`${definition.slotCount - activeAssignments.length} expedition slot(s) are uncovered.`);
  if (duplicateRolePenalty > 0) warnings.push('Duplicate roles reduce coverage efficiency.');
  scoredAssignments.filter(assignment => !assignment.fit.requirementsMet).forEach(assignment => warnings.push(`${assignment.playerId} is missing ${assignment.fit.missingRequirements.join(', ')} for ${assignment.roleId}.`));
  if (definition.kind === 'combat' && !scoredAssignments.some(assignment => assignment.roleId === 'tank')) warnings.push('No Tank coverage increases danger.');
  if (definition.kind === 'combat' && !scoredAssignments.some(assignment => assignment.roleId === 'healer')) warnings.push('No Healer coverage reduces recovery.');
  return {
    successPercent: round(successPercent), dangerPercent: round(dangerPercent), roleCoveragePercent: round(roleCoveragePercent), averageRoleFit: round(averageRoleFit),
    duplicateRolePenalty: round(duplicateRolePenalty), soloEfficiency, assignments: scoredAssignments,
    reward: { resources: rewardResourcesForecast, completionTiers: definition.completionRewards, farmingMultiplier, soloEfficiency }, warnings
  };
}

function ledgerFor(
  missionId: string,
  assignments: readonly (ExpeditionAssignment & { fit: RoleFitScore })[],
  resources: Readonly<Record<string, number>>,
  completion: Readonly<Record<string, number>>,
  tierId: string | null,
  status: ExpeditionRewardLedger['status'],
  now: string
): ExpeditionRewardLedger {
  const farmingByPlayer: Record<string, Readonly<Record<string, number>>> = {};
  const completionByPlayer: Record<string, Readonly<Record<string, number>>> = {};
  const playerIds = [...new Set(assignments.map(assignment => assignment.playerId))];
  for (const playerId of playerIds) {
    const assignmentCount = assignments.filter(assignment => assignment.playerId === playerId).length || 1;
    const share = 1 / assignmentCount;
    farmingByPlayer[playerId] = Object.fromEntries(Object.entries(resources).map(([key, value]) => [key, round(value * share / Math.max(1, playerIds.length), 2)]));
    completionByPlayer[playerId] = completion;
  }
  return { id: `${missionId}:${status}:${Date.parse(now) || now}`, missionId, farmingByPlayer, completionByPlayer, completionTierId: tierId, status, generatedAt: now };
}

export function resolveExpeditionOutcome(
  definition: ExpeditionDefinition,
  missionId: string,
  assignments: readonly ExpeditionAssignment[],
  profiles: Readonly<Record<string, PlayerProfileSnapshot>>,
  random: () => number = Math.random,
  now = new Date().toISOString()
): ExpeditionOutcome {
  const forecast = forecastExpedition(definition, assignments, profiles);
  const tier = tierFor(definition, forecast.successPercent);
  const completed = definition.failureMode === 'quality' || random() * 100 < forecast.successPercent;
  const farmingLedger = ledgerFor(missionId, forecast.assignments, forecast.reward.resources, {}, null, completed ? 'pending' : 'preserved-on-failure', now);
  const completionResources = completed ? tier.resources : {};
  const completion = completed ? ledgerFor(missionId, forecast.assignments, {}, completionResources, tier.id, 'pending', now) : null;
  return { status: completed ? 'completed' : 'failed', forecast, farmingLedger, completionLedger: completion };
}

export function targetDefinition(definition: ExpeditionDefinition, targetId: string | null | undefined): ExpeditionTargetDefinition | null {
  return targetFor(definition, targetId);
}

export const expeditionRules = Object.freeze({
  convertLegacyCombatSkills,
  convertLegacyCombatProfile,
  respecCost,
  respecCombatSkills,
  deriveCombatProfile,
  scoreRoleFit,
  forecastExpedition,
  resolveExpeditionOutcome,
  targetDefinition
});
