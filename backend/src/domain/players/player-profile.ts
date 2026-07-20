export interface StoredPlayerProfile {
  combatSkills: Record<string, number>;
  skills: Record<string, number>;
  gold: number;
  gear: unknown[];
  equippedGearIds: string[];
  talents: string[];
  loadout: Record<string, unknown>;
  unlockedTargetIds: string[];
}

export const DEFAULT_PLAYER_PROFILE: StoredPlayerProfile = {
  combatSkills: {},
  skills: {},
  gold: 0,
  gear: [],
  equippedGearIds: [],
  talents: [],
  loadout: {},
  unlockedTargetIds: []
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function numericMap(value: unknown): Record<string, number> | null {
  if (value === undefined) return {};
  if (!isRecord(value)) return null;
  const result: Record<string, number> = {};
  for (const [key, entry] of Object.entries(value)) {
    if (key.length > 80 || typeof entry !== 'number' || !Number.isFinite(entry) || entry < 0 || entry > 99) return null;
    result[key] = Math.round(entry * 100) / 100;
  }
  return result;
}

export function normalizeStoredPlayerProfile(value: unknown): StoredPlayerProfile | null {
  if (!isRecord(value)) return null;
  const combatSkills = numericMap(value.combatSkills);
  const skills = numericMap(value.skills);
  if (!combatSkills || !skills || (value.gold !== undefined && (typeof value.gold !== 'number' || !Number.isFinite(value.gold) || value.gold < 0))) return null;
  const gear = value.gear === undefined ? [] : Array.isArray(value.gear) ? value.gear.slice(0, 100) : null;
  const equippedGearIds = value.equippedGearIds === undefined ? [] : Array.isArray(value.equippedGearIds) && value.equippedGearIds.every(id => typeof id === 'string') ? value.equippedGearIds.slice(0, 100) as string[] : null;
  const talents = value.talents === undefined ? [] : Array.isArray(value.talents) && value.talents.every(id => typeof id === 'string') ? value.talents.slice(0, 200) as string[] : null;
  const unlockedTargetIds = value.unlockedTargetIds === undefined ? [] : Array.isArray(value.unlockedTargetIds) && value.unlockedTargetIds.every(id => typeof id === 'string') ? value.unlockedTargetIds.slice(0, 100) as string[] : null;
  if (!gear || !equippedGearIds || !talents || !unlockedTargetIds || (value.loadout !== undefined && !isRecord(value.loadout))) return null;
  return {
    combatSkills,
    skills,
    gold: Math.round((value.gold === undefined ? 0 : value.gold) * 100) / 100,
    gear,
    equippedGearIds,
    talents,
    loadout: value.loadout === undefined ? {} : value.loadout,
    unlockedTargetIds
  };
}
