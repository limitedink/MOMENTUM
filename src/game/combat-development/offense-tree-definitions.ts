import type { CombatSkillId } from '../combat-progression';
import type { SkillTreeDefinition, SkillTreeNode } from '../skills/skill-types';
import type {
  CombatEffectCondition,
  CombatModifierStat,
  CombatSpecialEffect,
  CombatTreeEffectDefinition,
  CombatTrigger,
  CombatTriggeredOutcome
} from './combat-development-types';

const MELEE = ['light-melee', 'medium-melee', 'heavy-melee'] as const;
const LIGHT = ['light-melee'] as const;
const MEDIUM = ['medium-melee'] as const;
const HEAVY = ['heavy-melee'] as const;
const GUN = ['gun'] as const;
const RANGED = ['ranged'] as const;
const MAGIC = ['magic'] as const;

type EffectFactory = (id: string, skillId: CombatSkillId) => CombatTreeEffectDefinition;

interface NodeSpec {
  name: string;
  description: string;
  effects: readonly EffectFactory[];
}

interface BranchSpec {
  id: string;
  name: string;
  description: string;
  color: string;
  root: NodeSpec;
  pathA: readonly [NodeSpec, NodeSpec, NodeSpec];
  pathB: readonly [NodeSpec, NodeSpec, NodeSpec];
}

const stat = (statId: CombatModifierStat, value: number, condition?: CombatEffectCondition): EffectFactory =>
  (id, skillId) => ({ id, skillId, kind: 'stat', stat: statId, value, condition });

const trigger = (
  event: CombatTrigger,
  outcome: CombatTriggeredOutcome,
  value: number,
  options: { every?: number; limit?: number; count?: number; condition?: CombatEffectCondition } = {}
): EffectFactory => (id, skillId) => ({ id, skillId, kind: 'trigger', trigger: event, outcome, value, ...options });

const streak = (
  damagePerStack: number,
  maxStacks: number,
  options: { resetOnDamage?: boolean; missBehavior?: 'reset' | 'remove-one' | 'preserve'; condition?: CombatEffectCondition } = {}
): EffectFactory => (id, skillId) => ({ id, skillId, kind: 'streak', damagePerStack, maxStacks, ...options });

const shred = (amount: number, maximum: number, techniqueOnly = false, condition?: CombatEffectCondition): EffectFactory =>
  (id, skillId) => ({ id, skillId, kind: 'shred', amount, maximum, techniqueOnly, condition });

const dot = (
  dotType: 'bleed' | 'burn',
  damagePct: number,
  durationSeconds: number,
  maximumStacks: number,
  options: { criticalMultiplier?: number; condition?: CombatEffectCondition } = {}
): EffectFactory => (id, skillId) => ({
  id,
  skillId,
  kind: 'dot',
  dot: dotType,
  damagePct,
  durationSeconds,
  maximumStacks,
  ...options
});

const mark = (damagePct: number, bossDamagePct = 0, condition?: CombatEffectCondition): EffectFactory =>
  (id, skillId) => ({ id, skillId, kind: 'mark', damagePct, bossDamagePct, condition });

const special = (specialId: CombatSpecialEffect, value: number, condition?: CombatEffectCondition): EffectFactory =>
  (id, skillId) => ({ id, skillId, kind: 'special', special: specialId, value, condition });

const node = (name: string, description: string, ...effects: EffectFactory[]): NodeSpec => ({ name, description, effects });

const slug = (value: string): string => value
  .toLowerCase()
  .replace(/[^a-z0-9]+/g, '-')
  .replace(/^-|-$/g, '');

const effectDefinitions: CombatTreeEffectDefinition[] = [];

function buildTree(skillId: CombatSkillId, title: string, branches: readonly [BranchSpec, BranchSpec, BranchSpec]): SkillTreeDefinition {
  const skillSlug = slug(skillId);
  const nodes: SkillTreeNode[] = [];
  const edges: SkillTreeDefinition['edges'][number][] = [];
  const rootNodeIds: string[] = [];
  const branchCenters = [170, 500, 830];

  const addNode = (
    branch: BranchSpec,
    spec: NodeSpec,
    branchIndex: number,
    tier: number,
    path: 'root' | 'a' | 'b',
    capstone: boolean,
    requires: readonly string[]
  ): string => {
    const id = `${skillSlug}.${branch.id}.${slug(spec.name)}`;
    const effectIds = spec.effects.map((factory, index) => {
      const effectId = `${id}:${index + 1}`;
      effectDefinitions.push(factory(effectId, skillId));
      return effectId;
    });
    const center = branchCenters[branchIndex];
    const position = path === 'root'
      ? { x: center, y: 590 }
      : { x: center + (path === 'a' ? -70 : 70), y: 470 - (tier - 2) * 180 };
    nodes.push({
      id,
      skillId,
      branch: branch.id,
      tier,
      name: spec.name,
      description: spec.description,
      requires,
      cost: 1,
      capstone,
      exclusiveGroup: capstone ? `${skillSlug}:capstone` : undefined,
      icon: { assetId: `skill:${skillSlug}`, fallback: capstone ? '★' : '◆' },
      position,
      effectIds
    });
    return id;
  };

  branches.forEach((branch, branchIndex) => {
    const rootId = addNode(branch, branch.root, branchIndex, 1, 'root', false, []);
    rootNodeIds.push(rootId);
    for (const [pathId, path] of [['a', branch.pathA], ['b', branch.pathB]] as const) {
      let previous = rootId;
      path.forEach((spec, pathIndex) => {
        const id = addNode(branch, spec, branchIndex, pathIndex + 2, pathId, pathIndex === 2, [previous]);
        edges.push({ id: `${previous}->${id}`, from: previous, to: id, kind: 'prerequisite' });
        previous = id;
      });
    }
  });

  return Object.freeze({
    id: skillSlug,
    name: `${title} Tree`,
    skillId,
    currencyLabel: `${title} Points`,
    description: `Specialise ${title} with one point earned every ten levels.`,
    branches: branches.map(branch => ({
      id: branch.id,
      name: branch.name,
      description: branch.description,
      color: branch.color
    })),
    nodes: Object.freeze(nodes),
    edges: Object.freeze(edges),
    rootNodeIds: Object.freeze(rootNodeIds),
    viewBox: { width: 1000, height: 700 }
  });
}

const strengthBranches: readonly [BranchSpec, BranchSpec, BranchSpec] = [
  {
    id: 'power', name: 'Power', description: 'Overwhelm armour with committed melee force.', color: '#ff754f',
    root: node('Brute Force', '+3% melee damage.', stat('damagePct', 0.03, { styles: MELEE })),
    pathA: [
      node('Weighted Blows', '+10% Power Strike damage.', stat('techniqueDamagePct', 0.10, { styles: MELEE, technique: 'Power Strike' })),
      node('Bonebreaker', '+10 armour penetration on Power Strike.', stat('armourPenetration', 10, { styles: MELEE, technique: 'Power Strike' })),
      node('Titan’s Impact', 'Power Strike gains +25% damage and +25 armour penetration.', stat('techniqueDamagePct', 0.25, { styles: MELEE, technique: 'Power Strike' }), stat('armourPenetration', 25, { styles: MELEE, technique: 'Power Strike' }))
    ],
    pathB: [
      node('Full Commitment', '+8% melee damage; attacks are 5% slower.', stat('damagePct', 0.08, { styles: MELEE }), stat('attackSpeedPct', -0.05, { styles: MELEE })),
      node('Overpower', '+10% damage above 75% HP.', stat('damagePct', 0.10, { styles: MELEE, playerHealthAbove: 0.75 })),
      node('Colossus', '+20% damage above 75% HP; −5 percentage-point hit chance.', stat('damagePct', 0.20, { styles: MELEE, playerHealthAbove: 0.75 }), stat('hitChanceBonus', -0.05, { styles: MELEE }))
    ]
  },
  {
    id: 'momentum', name: 'Momentum', description: 'Turn uninterrupted contact into mounting pressure.', color: '#58d9ff',
    root: node('Follow Through', '+1% damage per consecutive hit, maximum three stacks.', streak(0.01, 3, { condition: { styles: MELEE } })),
    pathA: [
      node('Driving Rhythm', 'Follow Through can build to five stacks.', streak(0.01, 5, { condition: { styles: MELEE } })),
      node('Relentless Advance', 'A miss removes one Momentum stack instead of all stacks.', streak(0.01, 5, { missBehavior: 'remove-one', condition: { styles: MELEE } })),
      node('Unbroken Chain', '+2% per stack, maximum eight; taking damage resets the chain.', streak(0.02, 8, { resetOnDamage: true, missBehavior: 'remove-one', condition: { styles: MELEE } }))
    ],
    pathB: [
      node('Opening Force', 'First successful hit deals +15% damage.', trigger('first-hit', 'damage', 0.15, { limit: 1, condition: { styles: MELEE } })),
      node('Seize Initiative', 'First technique deals +25% damage.', trigger('first-technique', 'damage', 0.25, { limit: 1, condition: { styles: MELEE, technique: 'Power Strike' } })),
      node('Avalanche', 'The first three successful hits each deal +25% damage.', trigger('first-hit', 'damage', 0.25, { limit: 3, condition: { styles: MELEE } }))
    ]
  },
  {
    id: 'execution', name: 'Execution', description: 'Convert wounded targets and bosses into decisive kills.', color: '#d36cff',
    root: node('Finisher', '+8% damage below 35% enemy HP.', stat('damagePct', 0.08, { styles: MELEE, enemyHealthBelow: 0.35 })),
    pathA: [
      node('Blood in the Water', 'Finisher activates below 45% enemy HP.', stat('damagePct', 0.08, { styles: MELEE, enemyHealthBelow: 0.45, enemyHealthAbove: 0.35 })),
      node('Decisive Blow', 'Techniques gain another +15% damage below the threshold.', stat('techniqueDamagePct', 0.15, { styles: MELEE, technique: 'Power Strike', enemyHealthBelow: 0.45 })),
      node('Cull the Weak', 'Once below 20%, bonus damage is capped at the lower of one derived hit or 10% enemy maximum HP.', special('cull-once', 1, { styles: MELEE, enemyHealthBelow: 0.20 }))
    ],
    pathB: [
      node('Giant Slayer', '+6% damage against bosses.', stat('bossDamagePct', 0.06, { styles: MELEE, boss: true })),
      node('Trophy Breaker', 'Techniques deal +12% damage against bosses.', stat('techniqueDamagePct', 0.12, { styles: MELEE, technique: 'Power Strike', boss: true })),
      node('Kingslayer', '+20% boss damage and −20% Power Strike cooldown against bosses.', stat('bossDamagePct', 0.20, { styles: MELEE, boss: true }), stat('techniqueCooldownPct', 0.20, { styles: MELEE, technique: 'Power Strike', boss: true }))
    ]
  }
];

const meleeAccuracyBranches: readonly [BranchSpec, BranchSpec, BranchSpec] = [
  {
    id: 'precision', name: 'Precision', description: 'Make clean contact and turn it into lethal criticals.', color: '#57d7ff',
    root: node('Steady Hand', '+5 melee accuracy.', stat('accuracyFlat', 5, { styles: MELEE })),
    pathA: [
      node('True Edge', '+5 melee accuracy.', stat('accuracyFlat', 5, { styles: MELEE })),
      node('Certain Contact', '+2 percentage-point melee hit chance.', stat('hitChanceBonus', 0.02, { styles: MELEE })),
      node('Perfect Contact', 'Every eighth melee attack converts a miss into a hit.', special('miss-conversion-every', 8, { styles: MELEE }))
    ],
    pathB: [
      node('Keen Sight', '+3 percentage-point critical chance.', stat('criticalChance', 0.03, { styles: MELEE })),
      node('Weakpoint', '+0.15 critical multiplier.', stat('criticalMultiplier', 0.15, { styles: MELEE })),
      node('Needle Threader', 'Critical hits ignore 25 armour.', stat('criticalArmourPenetration', 25, { styles: MELEE }))
    ]
  },
  {
    id: 'recovery', name: 'Recovery', description: 'Turn misses into immediate correction and tempo.', color: '#70e1a8',
    root: node('Correction', 'After a miss, the next attack gains +10 accuracy.', trigger('after-miss', 'accuracy', 10, { condition: { styles: MELEE } })),
    pathA: [
      node('Reacquire', 'Correction grants +20 accuracy.', trigger('after-miss', 'accuracy', 10, { condition: { styles: MELEE } })),
      node('Recovered Tempo', 'The attack after a miss has a 10% shorter interval.', trigger('after-miss', 'attack-speed', 0.10, { condition: { styles: MELEE } })),
      node('Snap Recovery', 'The next successful hit deals +25% and removes 20% of remaining Power Strike cooldown.', trigger('after-miss', 'damage', 0.25, { condition: { styles: MELEE } }), trigger('after-miss', 'reduce-technique-cooldown', 0.20, { condition: { styles: MELEE } }))
    ],
    pathB: [
      node('Patient Hands', 'Misses do not clear hit-streak effects.', special('miss-preserves-streak', 1, { styles: MELEE })),
      node('Never Twice', 'The second consecutive miss converts to a hit.', special('second-miss-converts', 2, { styles: MELEE })),
      node('No Wasted Motion', 'After any miss, the next attack is 25% faster and cannot miss.', trigger('after-miss', 'guarantee-hit', 1, { condition: { styles: MELEE } }), trigger('after-miss', 'attack-speed', 0.25, { condition: { styles: MELEE } }))
    ]
  },
  {
    id: 'exploitation', name: 'Exploitation', description: 'Reward high displayed hit chance and exposed guards.', color: '#ffb34d',
    root: node('Confidence', '+5% damage at 85% displayed hit chance.', stat('damagePct', 0.05, { styles: MELEE, minimumHitChance: 0.85 })),
    pathA: [
      node('Certainty', '+3 critical chance at 90% displayed hit chance.', stat('criticalChance', 0.03, { styles: MELEE, minimumHitChance: 0.90 })),
      node('Surgical Window', '+0.25 critical multiplier at 95% displayed hit chance.', stat('criticalMultiplier', 0.25, { styles: MELEE, minimumHitChance: 0.95 })),
      node('Inevitable', 'Minimum melee hit chance becomes 90%; +10% damage at the 98% cap.', stat('hitChanceFloor', 0.90, { styles: MELEE }), stat('damagePct', 0.10, { styles: MELEE, minimumHitChance: 0.98 }))
    ],
    pathB: [
      node('Expose Guard', 'Consecutive hits gain 2 penetration, maximum 10.', shred(2, 10, false, { styles: MELEE })),
      node('Press Opening', 'Power Strike deals +15% damage at maximum Expose Guard stacks.', stat('techniqueDamagePct', 0.15, { styles: MELEE, technique: 'Power Strike', maximumShred: true })),
      node('Perfect Exploit', 'At five stacks, the next Power Strike is a guaranteed critical and consumes the stacks.', trigger('maximum-shred', 'guarantee-critical', 1, { condition: { styles: MELEE, technique: 'Power Strike', maximumShred: true } }), special('consume-exploit-stacks', 1, { styles: MELEE, technique: 'Power Strike' }))
    ]
  }
];

const lightMeleeBranches: readonly [BranchSpec, BranchSpec, BranchSpec] = [
  {
    id: 'flurry', name: 'Flurry', description: 'Attack rapidly and punctuate the sequence with extra cuts.', color: '#58dcff',
    root: node('Quick Hands', 'Light melee attacks are 3% faster.', stat('attackSpeedPct', 0.03, { styles: LIGHT })),
    pathA: [
      node('Quicksilver', 'Light melee attacks are another 4% faster.', stat('attackSpeedPct', 0.04, { styles: LIGHT })),
      node('Fivefold', 'Every fifth successful hit deals +25% damage.', trigger('nth-hit', 'damage', 0.25, { every: 5, condition: { styles: LIGHT } })),
      node('Thousand Cuts', 'Every fifth successful hit also repeats for 50% damage.', trigger('nth-hit', 'repeat', 0.50, { every: 5, condition: { styles: LIGHT } }))
    ],
    pathB: [
      node('Rapid Technique', 'Power Strike cooldown is reduced by 10%.', stat('techniqueCooldownPct', 0.10, { styles: LIGHT, technique: 'Power Strike' })),
      node('Flash Cut', 'Power Strike deals +15% damage.', stat('techniqueDamagePct', 0.15, { styles: LIGHT, technique: 'Power Strike' })),
      node('Lightning Edge', 'Power Strike cooldown is reduced by 30% and damage is increased by 10%.', stat('techniqueCooldownPct', 0.30, { styles: LIGHT, technique: 'Power Strike' }), stat('techniqueDamagePct', 0.10, { styles: LIGHT, technique: 'Power Strike' }))
    ]
  },
  {
    id: 'finesse', name: 'Finesse', description: 'Build critical precision and a lethal opening.', color: '#c276ff',
    root: node('Keen Edge', '+3 percentage-point critical chance.', stat('criticalChance', 0.03, { styles: LIGHT })),
    pathA: [
      node('Fine Point', '+0.15 critical multiplier.', stat('criticalMultiplier', 0.15, { styles: LIGHT })),
      node('Vital Line', 'Critical hits ignore 15 armour.', stat('criticalArmourPenetration', 15, { styles: LIGHT })),
      node('Surgical Grace', 'Critical hits ignore 35 armour and gain +0.25 multiplier.', stat('criticalArmourPenetration', 35, { styles: LIGHT }), stat('criticalMultiplier', 0.25, { styles: LIGHT }))
    ],
    pathB: [
      node('Opening Feint', 'The first successful hit deals +20% damage.', trigger('first-hit', 'damage', 0.20, { limit: 1, condition: { styles: LIGHT } })),
      node('Unreadable', 'The first Power Strike cannot miss.', trigger('first-technique', 'guarantee-hit', 1, { limit: 1, condition: { styles: LIGHT, technique: 'Power Strike' } })),
      node('First Blood', 'The first successful hit is a critical with +0.5 critical multiplier.', trigger('first-hit', 'guarantee-critical', 0.50, { limit: 1, condition: { styles: LIGHT } }))
    ]
  },
  {
    id: 'duelist', name: 'Duelist', description: 'Preserve poise and punish failed enemy attacks.', color: '#6ce3a4',
    root: node('Untouched', '+6% damage above 90% HP.', stat('damagePct', 0.06, { styles: LIGHT, playerHealthAbove: 0.90 })),
    pathA: [
      node('Poise', 'Untouched activates above 75% HP.', stat('damagePct', 0.06, { styles: LIGHT, playerHealthAbove: 0.75, playerHealthBelow: 0.90 })),
      node('Blade Dance', 'Attacks are 8% faster above 75% HP.', stat('attackSpeedPct', 0.08, { styles: LIGHT, playerHealthAbove: 0.75 })),
      node('Perfect Tempo', '+15% damage and 10% faster attacks above 75% HP.', stat('damagePct', 0.15, { styles: LIGHT, playerHealthAbove: 0.75 }), stat('attackSpeedPct', 0.10, { styles: LIGHT, playerHealthAbove: 0.75 }))
    ],
    pathB: [
      node('Riposte', 'After an enemy misses, the next hit deals +15% damage.', trigger('after-enemy-miss', 'damage', 0.15, { condition: { styles: LIGHT } })),
      node('Counterstep', 'The Riposte attack is 20% faster.', trigger('after-enemy-miss', 'attack-speed', 0.20, { condition: { styles: LIGHT } })),
      node('Ghost Riposte', 'The Riposte hit repeats for 40% damage.', trigger('after-enemy-miss', 'repeat', 0.40, { condition: { styles: LIGHT } }))
    ]
  }
];

const mediumMeleeBranches: readonly [BranchSpec, BranchSpec, BranchSpec] = [
  {
    id: 'balance', name: 'Balance', description: 'Master Balanced stance and reduce every stance compromise.', color: '#58d9ff',
    root: node('Centred', 'Balanced stance gains +3% damage and +3 accuracy.', stat('damagePct', 0.03, { styles: MEDIUM, stance: 'Balanced' }), stat('accuracyFlat', 3, { styles: MEDIUM, stance: 'Balanced' })),
    pathA: [
      node('Measured Force', 'Balanced stance gains another +5% damage.', stat('damagePct', 0.05, { styles: MEDIUM, stance: 'Balanced' })),
      node('Clear Intent', 'Balanced stance gains +3 critical chance.', stat('criticalChance', 0.03, { styles: MEDIUM, stance: 'Balanced' })),
      node('Master-at-Arms', 'Balanced gains +10% damage and +5 critical chance.', stat('damagePct', 0.10, { styles: MEDIUM, stance: 'Balanced' }), stat('criticalChance', 0.05, { styles: MEDIUM, stance: 'Balanced' }))
    ],
    pathB: [
      node('Adaptable', 'Stance penalties are reduced by 25%.', stat('stancePenaltyReductionPct', 0.25, { styles: MEDIUM })),
      node('Fluid Guard', 'Stance bonuses are increased by 10%.', stat('stanceBonusPct', 0.10, { styles: MEDIUM })),
      node('Perfect Balance', 'Stance penalties are halved and bonuses increased by 15%.', stat('stancePenaltyReductionPct', 0.50, { styles: MEDIUM }), stat('stanceBonusPct', 0.15, { styles: MEDIUM }))
    ]
  },
  {
    id: 'counterforce', name: 'Counterforce', description: 'Answer incoming damage with force and recovered tempo.', color: '#ff7a55',
    root: node('Tempered Response', 'After taking damage, the next hit deals +10%.', trigger('after-damage', 'damage', 0.10, { condition: { styles: MEDIUM } })),
    pathA: [
      node('Return Force', 'Tempered Response deals +20%.', trigger('after-damage', 'damage', 0.10, { condition: { styles: MEDIUM } })),
      node('Vengeful Strike', 'The next Power Strike gains another +20% damage.', trigger('after-damage', 'damage', 0.20, { condition: { styles: MEDIUM, technique: 'Power Strike' } })),
      node('Reprisal', 'Once per encounter, taking damage readies Power Strike and gives it +50% damage.', trigger('after-damage', 'ready-technique', 1, { limit: 1, condition: { styles: MEDIUM, technique: 'Power Strike' } }), trigger('after-damage', 'damage', 0.50, { limit: 1, condition: { styles: MEDIUM, technique: 'Power Strike' } }))
    ],
    pathB: [
      node('Return Tempo', 'After taking damage, the next attack interval is 10% shorter.', trigger('after-damage', 'attack-speed', 0.10, { condition: { styles: MEDIUM } })),
      node('Steady Recovery', 'The next three attacks deal +5% damage.', trigger('after-damage', 'damage', 0.05, { limit: 3, condition: { styles: MEDIUM } })),
      node('Turn the Tide', 'Once below 50% HP, the next three attacks deal +25%; the first cannot miss.', trigger('health-threshold', 'damage', 0.25, { limit: 3, condition: { styles: MEDIUM, playerHealthBelow: 0.50 } }), trigger('health-threshold', 'guarantee-hit', 1, { limit: 1, condition: { styles: MEDIUM, playerHealthBelow: 0.50 } }))
    ]
  },
  {
    id: 'technique', name: 'Technique', description: 'Refine Power Strike into a precise, relentless breach.', color: '#c878ff',
    root: node('Weapon Drill', 'Power Strike deals +10% damage.', stat('techniqueDamagePct', 0.10, { styles: MEDIUM, technique: 'Power Strike' })),
    pathA: [
      node('Relentless', 'Power Strike cooldown is reduced by 10%.', stat('techniqueCooldownPct', 0.10, { styles: MEDIUM, technique: 'Power Strike' })),
      node('Exacting Blow', 'Power Strike gains +5 percentage-point hit chance.', stat('techniqueHitChanceBonus', 0.05, { styles: MEDIUM, technique: 'Power Strike' })),
      node('Relentless Force', 'Power Strike cooldown is reduced by 30% and damage increased by 15%.', stat('techniqueCooldownPct', 0.30, { styles: MEDIUM, technique: 'Power Strike' }), stat('techniqueDamagePct', 0.15, { styles: MEDIUM, technique: 'Power Strike' }))
    ],
    pathB: [
      node('Deep Impact', 'Power Strike ignores 10 armour.', stat('armourPenetration', 10, { styles: MEDIUM, technique: 'Power Strike' })),
      node('Earthbound', 'Power Strike gains another 15 armour penetration.', stat('armourPenetration', 15, { styles: MEDIUM, technique: 'Power Strike' })),
      node('Earthshaker', 'Power Strike deals +30% damage and applies 15% non-stacking armour shred for the encounter.', stat('techniqueDamagePct', 0.30, { styles: MEDIUM, technique: 'Power Strike' }), shred(0.15, 0.15, true, { styles: MEDIUM, technique: 'Power Strike' }))
    ]
  }
];

const heavyMeleeBranches: readonly [BranchSpec, BranchSpec, BranchSpec] = [
  {
    id: 'impact', name: 'Impact', description: 'Make every heavy opening and cadence strike seismic.', color: '#ff8755',
    root: node('Massive Presence', '+5% heavy melee damage.', stat('damagePct', 0.05, { styles: HEAVY })),
    pathA: [
      node('Massive Blows', 'Power Strike deals +15% damage.', stat('techniqueDamagePct', 0.15, { styles: HEAVY, technique: 'Power Strike' })),
      node('Crushing Cadence', 'Every third heavy hit deals +35% damage.', trigger('nth-hit', 'damage', 0.35, { every: 3, condition: { styles: HEAVY } })),
      node('Seismic Blow', 'Every third heavy hit cannot miss and deals +75% damage.', trigger('nth-action', 'guarantee-hit', 1, { every: 3, condition: { styles: HEAVY } }), trigger('nth-hit', 'damage', 0.75, { every: 3, condition: { styles: HEAVY } }))
    ],
    pathB: [
      node('Opening Weight', 'The first successful hit deals +25% damage.', trigger('first-hit', 'damage', 0.25, { limit: 1, condition: { styles: HEAVY } })),
      node('Loaded Swing', 'The first Power Strike deals +40% damage.', trigger('first-technique', 'damage', 0.40, { limit: 1, condition: { styles: HEAVY, technique: 'Power Strike' } })),
      node('Cataclysm', 'The first Power Strike deals +100% damage.', trigger('first-technique', 'damage', 1, { limit: 1, condition: { styles: HEAVY, technique: 'Power Strike' } }))
    ]
  },
  {
    id: 'breaker', name: 'Breaker', description: 'Fracture armour until raw force passes through.', color: '#d5a24f',
    root: node('Fracturing Edge', '+8 armour penetration.', stat('armourPenetration', 8, { styles: HEAVY })),
    pathA: [
      node('Sunder', 'Hits apply 2% armour shred, maximum 10%.', shred(0.02, 0.10, false, { styles: HEAVY })),
      node('Fracture', 'Sunder can shred up to 20% armour.', shred(0.02, 0.20, false, { styles: HEAVY })),
      node('Ruinous Force', '+20% damage at maximum armour shred.', stat('damagePct', 0.20, { styles: HEAVY, maximumShred: true }))
    ],
    pathB: [
      node('Breach', 'Power Strike gains 15 armour penetration.', stat('armourPenetration', 15, { styles: HEAVY, technique: 'Power Strike' })),
      node('Deep Breach', 'Power Strike gains 25 armour penetration.', stat('armourPenetration', 25, { styles: HEAVY, technique: 'Power Strike' })),
      node('Irresistible Power', 'Power Strike ignores all armour and gains +10% damage.', special('ignore-armour', 1, { styles: HEAVY, technique: 'Power Strike' }), stat('techniqueDamagePct', 0.10, { styles: HEAVY, technique: 'Power Strike' }))
    ]
  },
  {
    id: 'juggernaut', name: 'Juggernaut', description: 'Trade speed for dominance and unstoppable retaliation.', color: '#a076ff',
    root: node('Dominance', '+8% damage above 75% HP.', stat('damagePct', 0.08, { styles: HEAVY, playerHealthAbove: 0.75 })),
    pathA: [
      node('Anchored', 'After taking damage, the next attack cannot miss.', trigger('after-damage', 'guarantee-hit', 1, { condition: { styles: HEAVY } })),
      node('Unstoppable', 'The Anchored hit deals +25% damage.', trigger('after-damage', 'damage', 0.25, { condition: { styles: HEAVY } })),
      node('Dreadnought', 'Once per encounter, taking damage readies Power Strike and grants +40% damage.', trigger('after-damage', 'ready-technique', 1, { limit: 1, condition: { styles: HEAVY, technique: 'Power Strike' } }), trigger('after-damage', 'damage', 0.40, { limit: 1, condition: { styles: HEAVY, technique: 'Power Strike' } }))
    ],
    pathB: [
      node('Slow and Sure', '+10% damage; attacks are 5% slower.', stat('damagePct', 0.10, { styles: HEAVY }), stat('attackSpeedPct', -0.05, { styles: HEAVY })),
      node('Immovable', '+10% damage after three consecutive hits.', trigger('nth-hit', 'damage', 0.10, { every: 3, condition: { styles: HEAVY } })),
      node('Worldbreaker', '+25% heavy damage and +0.5 critical multiplier; attacks are 10% slower.', stat('damagePct', 0.25, { styles: HEAVY }), stat('criticalMultiplier', 0.50, { styles: HEAVY }), stat('attackSpeedPct', -0.10, { styles: HEAVY }))
    ]
  }
];

const marksmanshipBranches: readonly [BranchSpec, BranchSpec, BranchSpec] = [
  {
    id: 'rapid-fire', name: 'Rapid Fire', description: 'Build firearm cadence into controlled projectile storms.', color: '#55dfff',
    root: node('Trigger Discipline', 'Gun attacks are 3% faster.', stat('attackSpeedPct', 0.03, { styles: GUN })),
    pathA: [
      node('Hair Trigger', 'Gun attacks are another 4% faster.', stat('attackSpeedPct', 0.04, { styles: GUN })),
      node('Sustained Fire', 'Every sixth gun action deals +30% damage.', trigger('nth-action', 'damage', 0.30, { every: 6, condition: { styles: GUN } })),
      node('Bullet Storm', 'Every sixth gun action fires two additional 50% shots.', trigger('nth-action', 'add-projectile', 0.50, { every: 6, count: 2, condition: { styles: GUN } }))
    ],
    pathB: [
      node('Burst Control', 'Burst Fire cooldown is reduced by 10%.', stat('techniqueCooldownPct', 0.10, { styles: GUN, technique: 'Burst Fire' })),
      node('Extended Burst', 'Burst Fire adds one 50% projectile.', trigger('technique', 'add-projectile', 0.50, { count: 1, condition: { styles: GUN, technique: 'Burst Fire' } })),
      node('Lead Tempest', 'Burst Fire adds two 60% projectiles but its base cooldown increases by 10%.', trigger('technique', 'add-projectile', 0.60, { count: 2, condition: { styles: GUN, technique: 'Burst Fire' } }), stat('baseTechniqueCooldownPct', 0.10, { styles: GUN, technique: 'Burst Fire' }))
    ]
  },
  {
    id: 'deadeye', name: 'Deadeye', description: 'Calibrate accurate shots into guaranteed critical openings.', color: '#bf78ff',
    root: node('Sighted', '+5 gun accuracy.', stat('accuracyFlat', 5, { styles: GUN })),
    pathA: [
      node('Calibrated', '+3 critical chance.', stat('criticalChance', 0.03, { styles: GUN })),
      node('Zeroed', '+0.2 critical multiplier.', stat('criticalMultiplier', 0.20, { styles: GUN })),
      node('Deadeye', 'The first and every tenth gun action is a guaranteed critical if it hits.', trigger('first-hit', 'guarantee-critical', 1, { limit: 1, condition: { styles: GUN } }), trigger('nth-action', 'guarantee-critical', 1, { every: 10, condition: { styles: GUN } }))
    ],
    pathB: [
      node('First Round', 'The first gun shot cannot miss.', trigger('first-hit', 'guarantee-hit', 1, { limit: 1, condition: { styles: GUN } })),
      node('Weakpoint Round', 'Critical hits ignore 20 armour.', stat('criticalArmourPenetration', 20, { styles: GUN })),
      node('One Shot, One Mark', 'The first shot is a guaranteed hit and critical with +50% damage.', trigger('first-hit', 'guarantee-hit', 1, { limit: 1, condition: { styles: GUN } }), trigger('first-hit', 'guarantee-critical', 1, { limit: 1, condition: { styles: GUN } }), trigger('first-hit', 'damage', 0.50, { limit: 1, condition: { styles: GUN } }))
    ]
  },
  {
    id: 'munitions', name: 'Munitions', description: 'Choose penetration or execution-focused ammunition.', color: '#ffad52',
    root: node('Armour-Piercing Rounds', '+8 armour penetration.', stat('armourPenetration', 8, { styles: GUN })),
    pathA: [
      node('Hardened Core', 'Gain another +8 armour penetration.', stat('armourPenetration', 8, { styles: GUN })),
      node('Penetrator', 'Burst Fire gains 25 armour penetration.', stat('armourPenetration', 25, { styles: GUN, technique: 'Burst Fire' })),
      node('Tungsten Core', 'All gun damage ignores 30 armour.', stat('armourPenetration', 30, { styles: GUN }))
    ],
    pathB: [
      node('Hollow Points', '+8% damage below 50% enemy HP.', stat('damagePct', 0.08, { styles: GUN, enemyHealthBelow: 0.50 })),
      node('Controlled Burst', '+15% damage below 35% enemy HP.', stat('damagePct', 0.15, { styles: GUN, enemyHealthBelow: 0.35 })),
      node('Execution Magazine', 'Every fifth successful gun hit below 50% enemy HP deals +50% damage.', trigger('nth-hit', 'damage', 0.50, { every: 5, condition: { styles: GUN, enemyHealthBelow: 0.50 } }))
    ]
  }
];

const rangedBranches: readonly [BranchSpec, BranchSpec, BranchSpec] = [
  {
    id: 'draw', name: 'Draw', description: 'Choose deliberate full draws or an accelerating volley.', color: '#65dfac',
    root: node('Draw Weight', '+4% ranged damage.', stat('damagePct', 0.04, { styles: RANGED })),
    pathA: [
      node('Full Draw', 'Piercing Shot deals +10% damage.', stat('techniqueDamagePct', 0.10, { styles: RANGED, technique: 'Piercing Shot' })),
      node('Long Hold', '+15% damage when base attack interval is at least 0.6 seconds.', stat('damagePct', 0.15, { styles: RANGED, minimumBaseInterval: 0.60 })),
      node('Perfect Release', 'Piercing Shot gains +35% damage and is a guaranteed critical when base interval is at least 0.6 seconds.', stat('techniqueDamagePct', 0.35, { styles: RANGED, technique: 'Piercing Shot', minimumBaseInterval: 0.60 }), trigger('technique', 'guarantee-critical', 1, { condition: { styles: RANGED, technique: 'Piercing Shot', minimumBaseInterval: 0.60 } }))
    ],
    pathB: [
      node('Loose Fast', 'Ranged attacks are 3% faster.', stat('attackSpeedPct', 0.03, { styles: RANGED })),
      node('Fleet Quiver', 'Ranged attacks are another 5% faster.', stat('attackSpeedPct', 0.05, { styles: RANGED })),
      node('Endless Volley', 'Every fourth ranged action repeats for 45% damage.', trigger('nth-action', 'repeat', 0.45, { every: 4, condition: { styles: RANGED } }))
    ]
  },
  {
    id: 'hunt', name: 'Hunt', description: 'Mark quarry and finish bosses along a blood trail.', color: '#ff795a',
    root: node('Trophy Hunter', '+5% damage against bosses.', stat('bossDamagePct', 0.05, { styles: RANGED, boss: true })),
    pathA: [
      node('Mark Quarry', 'The first hit marks the target to take +5% damage.', mark(0.05, 0, { styles: RANGED })),
      node('Tracking', 'Marked targets take +10% damage.', mark(0.10, 0, { styles: RANGED })),
      node('Apex Hunter', 'Marked bosses take +25% damage.', mark(0.10, 0.25, { styles: RANGED, boss: true }))
    ],
    pathB: [
      node('Blood Trail', '+8% damage below 50% enemy HP.', stat('damagePct', 0.08, { styles: RANGED, enemyHealthBelow: 0.50 })),
      node('Heartline', 'Piercing Shot deals +15% damage below 35% enemy HP.', stat('techniqueDamagePct', 0.15, { styles: RANGED, technique: 'Piercing Shot', enemyHealthBelow: 0.35 })),
      node('Heartseeker', 'Piercing Shot below 30% enemy HP cannot miss and gains +50% damage.', stat('techniqueDamagePct', 0.50, { styles: RANGED, technique: 'Piercing Shot', enemyHealthBelow: 0.30 }), trigger('health-threshold', 'guarantee-hit', 1, { condition: { styles: RANGED, technique: 'Piercing Shot', enemyHealthBelow: 0.30 } }))
    ]
  },
  {
    id: 'pierce', name: 'Pierce', description: 'Drive through armour with points, bleeds and critical lines.', color: '#c779ff',
    root: node('Bodkin Point', '+10 armour penetration.', stat('armourPenetration', 10, { styles: RANGED })),
    pathA: [
      node('Broadhead', 'Piercing Shot inflicts 5% bleed over three seconds.', dot('bleed', 0.05, 3, 1, { condition: { styles: RANGED, technique: 'Piercing Shot' } })),
      node('Barbed', 'Piercing Shot inflicts 10% bleed over four seconds.', dot('bleed', 0.10, 4, 1, { condition: { styles: RANGED, technique: 'Piercing Shot' } })),
      node('Storm Piercer', 'Piercing Shot inflicts 20% bleed over four seconds, stacking twice.', dot('bleed', 0.20, 4, 2, { condition: { styles: RANGED, technique: 'Piercing Shot' } }))
    ],
    pathB: [
      node('Threading', '+3 critical chance.', stat('criticalChance', 0.03, { styles: RANGED })),
      node('Splinterpoint', 'Critical hits ignore 20 armour.', stat('criticalArmourPenetration', 20, { styles: RANGED })),
      node('Needle Storm', 'Critical hits ignore 40 armour and gain +0.25 multiplier.', stat('criticalArmourPenetration', 40, { styles: RANGED }), stat('criticalMultiplier', 0.25, { styles: RANGED }))
    ]
  }
];

const offensiveMagicBranches: readonly [BranchSpec, BranchSpec, BranchSpec] = [
  {
    id: 'embercraft', name: 'Embercraft', description: 'Apply, amplify and consume deterministic burns.', color: '#ff724d',
    root: node('Kindling', 'Arc Bolt burns for 4% damage over three seconds.', dot('burn', 0.04, 3, 1, { condition: { styles: MAGIC, technique: 'Arc Bolt' } })),
    pathA: [
      node('Stoke', 'Arc Bolt burn increases to 8%.', dot('burn', 0.08, 3, 1, { condition: { styles: MAGIC, technique: 'Arc Bolt' } })),
      node('Accelerant', '+10% direct damage against burning targets.', stat('damagePct', 0.10, { styles: MAGIC, burning: true })),
      node('Conflagration', 'Arc Bolt burns for 15% over four seconds, stacking three times.', dot('burn', 0.15, 4, 3, { condition: { styles: MAGIC, technique: 'Arc Bolt' } }))
    ],
    pathB: [
      node('Flashfire', 'The first spell deals +15% damage.', trigger('first-hit', 'damage', 0.15, { limit: 1, condition: { styles: MAGIC } })),
      node('Critical Spark', 'Critical Arc Bolt doubles its applied burn.', special('critical-dot-double', 2, { styles: MAGIC, technique: 'Arc Bolt' })),
      node('Phoenix Spark', 'Critical Arc Bolt consumes the remaining burn for 150% of its value and reapplies base burn.', trigger('critical-technique', 'consume-dot', 1.50, { condition: { styles: MAGIC, technique: 'Arc Bolt' } }))
    ]
  },
  {
    id: 'channeling', name: 'Channeling', description: 'Accelerate spellflow and echo Arc Bolt cadence.', color: '#58d9ff',
    root: node('Spellflow', 'Magic attacks are 3% faster.', stat('attackSpeedPct', 0.03, { styles: MAGIC })),
    pathA: [
      node('Focused Flow', 'Arc Bolt cooldown is reduced by 10%.', stat('techniqueCooldownPct', 0.10, { styles: MAGIC, technique: 'Arc Bolt' })),
      node('Deep Channel', 'Arc Bolt cooldown is reduced by another 10%.', stat('techniqueCooldownPct', 0.10, { styles: MAGIC, technique: 'Arc Bolt' })),
      node('Spellstorm', 'Arc Bolt cooldown is reduced by 35% and magic attacks are 5% faster.', stat('techniqueCooldownPct', 0.35, { styles: MAGIC, technique: 'Arc Bolt' }), stat('attackSpeedPct', 0.05, { styles: MAGIC }))
    ],
    pathB: [
      node('Arcane Cadence', 'Every fifth magic action deals +25% damage.', trigger('nth-action', 'damage', 0.25, { every: 5, condition: { styles: MAGIC } })),
      node('Resonance', 'Every fifth magic action removes two seconds from Arc Bolt cooldown.', trigger('nth-action', 'reduce-technique-cooldown', 2, { every: 5, condition: { styles: MAGIC, technique: 'Arc Bolt' } })),
      node('Arcane Echo', 'Every fifth Arc Bolt repeats for 60% damage.', trigger('nth-action', 'repeat', 0.60, { every: 5, condition: { styles: MAGIC, technique: 'Arc Bolt' } }))
    ]
  },
  {
    id: 'voidcraft', name: 'Voidcraft', description: 'Collapse warded targets and erase weakened enemies.', color: '#a678ff',
    root: node('Null Sight', '+8% damage against bosses or warded enemies.', stat('damagePct', 0.08, { styles: MAGIC, bossOrWarded: true })),
    pathA: [
      node('Unmaking', '+15 ward penetration.', stat('wardPenetration', 15, { styles: MAGIC })),
      node('Collapse Ward', '+30 ward penetration.', stat('wardPenetration', 30, { styles: MAGIC })),
      node('Null Script', 'Arc Bolt ignores all ward and gains +20% damage against warded targets.', special('ignore-ward', 1, { styles: MAGIC, technique: 'Arc Bolt', enemyWarded: true }), stat('techniqueDamagePct', 0.20, { styles: MAGIC, technique: 'Arc Bolt', enemyWarded: true }))
    ],
    pathB: [
      node('Entropy', '+8% damage below 50% enemy HP.', stat('damagePct', 0.08, { styles: MAGIC, enemyHealthBelow: 0.50 })),
      node('Collapse', '+15% damage below 30% enemy HP.', stat('damagePct', 0.15, { styles: MAGIC, enemyHealthBelow: 0.30 })),
      node('Oblivion', 'Arc Bolt below 25% enemy HP cannot miss and gains +50% damage.', stat('techniqueDamagePct', 0.50, { styles: MAGIC, technique: 'Arc Bolt', enemyHealthBelow: 0.25 }), trigger('health-threshold', 'guarantee-hit', 1, { condition: { styles: MAGIC, technique: 'Arc Bolt', enemyHealthBelow: 0.25 } }))
    ]
  }
];

export const STRENGTH_SKILL_TREE = buildTree('Strength', 'Strength', strengthBranches);
export const MELEE_ACCURACY_SKILL_TREE = buildTree('Melee Accuracy', 'Melee Accuracy', meleeAccuracyBranches);
export const LIGHT_MELEE_SKILL_TREE = buildTree('Light Melee Weapon Proficiency', 'Light Melee Weapon Proficiency', lightMeleeBranches);
export const MEDIUM_MELEE_SKILL_TREE = buildTree('Medium Melee Weapon Proficiency', 'Medium Melee Weapon Proficiency', mediumMeleeBranches);
export const HEAVY_MELEE_SKILL_TREE = buildTree('Heavy Melee Weapon Proficiency', 'Heavy Melee Weapon Proficiency', heavyMeleeBranches);
export const MARKSMANSHIP_SKILL_TREE = buildTree('Marksmanship', 'Marksmanship', marksmanshipBranches);
export const RANGED_SKILL_TREE = buildTree('Ranged', 'Ranged', rangedBranches);
export const OFFENSIVE_MAGIC_SKILL_TREE = buildTree('Offensive Magic', 'Offensive Magic', offensiveMagicBranches);

export const OFFENSE_TREE_EFFECT_DEFINITIONS: Readonly<Record<string, CombatTreeEffectDefinition>> = Object.freeze(
  Object.fromEntries(effectDefinitions.map(effect => [effect.id, Object.freeze(effect)]))
);
