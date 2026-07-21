import { COMBAT_SKILL_IDS } from '../../src/game/combat-progression';

const freshCombatProgression = Object.fromEntries(COMBAT_SKILL_IDS.map(skillId => [skillId, { level: 1, xp: 0 }]));

export const NEW_V18_SAVE_FIXTURE = {
  version: 18,
  savedAt: 18_000,
  skills: [{ id: 'Mining', lvl: 1, xp: 0 }],
  combatProgression: freshCombatProgression,
  legacyCombat: null,
  resources: { Ore: 0 },
  gear: [],
  talents: [],
  arena: {},
  world: null,
  party: null
};

export const REPRESENTATIVE_V17_SAVE_FIXTURE = {
  version: 17,
  savedAt: 17_000,
  skills: [
    { id: 'Mining', lvl: 13, xp: 42, qty: 99 },
    { id: 'Combat', basePerSec: 0.5, active: true, qty: 8, lvl: 20, xp: 50, progress: 0.25 },
    { id: 'Cooking', lvl: 7, xp: 11, qty: 4 }
  ],
  combatComponentSkills: {
    Strength: 12.5,
    'Melee Accuracy': 11,
    Marksmanship: 9,
    Ranged: 8,
    Magic: 7.25,
    Reflexes: 10,
    Healing: 6,
    'Light Armour Proficiency': 9,
    'Medium Armour Proficiency': 10,
    'Heavy Armour Proficiency': 5
  },
  keys: 12,
  gold: 345,
  scrap: 67,
  rareGems: 3,
  equipment: { melee: 'ironBlade', gun: 'pulseSidearm', armor: 'platedVest' },
  ownedItems: ['pulseSidearm', 'ironBlade', 'platedVest'],
  combatTalents: ['openingAttack', 'pressure'],
  arenaRecords: { Initiate: { wins: 2 } },
  arenaWins: [2, 1, 0],
  frontier: { completedDirectives: ['no-hit'], combatPresets: [null, null] },
  world: { status: 'outpost', currentNodeId: 'frontier-outpost' },
  partyState: { partyId: 'party-1', revision: 4 }
};

export const MALFORMED_V17_SAVE_FIXTURE = {
  version: 17,
  skills: [
    { id: 'Combat', lvl: 'not-a-level', xp: Number.POSITIVE_INFINITY },
    null,
    { id: 'Mining', lvl: 4, xp: 20 }
  ],
  combatComponentSkills: {
    Strength: -8,
    Marksmanship: Number.NaN,
    Ranged: '6.5',
    'Offensive Magic': { level: 4, xp: 'bad-xp' },
    Warding: Number.POSITIVE_INFINITY
  },
  resources: { Ore: 5 }
};

export const MAX_LEVEL_V17_SAVE_FIXTURE = {
  version: 17,
  skills: [{ id: 'Combat', lvl: 100, xp: Number.POSITIVE_INFINITY }],
  combatComponentSkills: Object.fromEntries(COMBAT_SKILL_IDS.map(skillId => [skillId, 100])),
  world: { status: 'reward' },
  partyState: { revision: 99 }
};
