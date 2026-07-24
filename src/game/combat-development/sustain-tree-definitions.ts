import type { CombatSkillId } from '../combat-progression';
import type { SkillTreeDefinition, SkillTreeNode } from '../skills/skill-types';
import type {
  CombatEffectCondition,
  CombatModifierStat,
  CombatTreeEffectDefinition,
  CombatTrigger,
  CombatTriggeredOutcome
} from './combat-development-types';

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

const BATTLE_FOCUS = { aura: 'Battle Focus' } as const satisfies CombatEffectCondition;
const BATTLE_FOCUS_MEND = {
  aura: 'Battle Focus',
  defensiveAbility: 'Mend'
} as const satisfies CombatEffectCondition;
const MEND = { defensiveAbility: 'Mend' } as const satisfies CombatEffectCondition;

const stat = (statId: CombatModifierStat, value: number, condition?: CombatEffectCondition): EffectFactory =>
  (id, skillId) => ({ id, skillId, kind: 'stat', stat: statId, value, condition });

const trigger = (
  event: CombatTrigger,
  outcome: CombatTriggeredOutcome,
  value: number,
  options: {
    every?: number;
    limit?: number;
    count?: number;
    family?: string;
    priority?: number;
    scale?: 'overheal-pct-max-hit-points';
    minimum?: number;
    maximum?: number;
    condition?: CombatEffectCondition;
  } = {}
): EffectFactory => (id, skillId) => ({ id, skillId, kind: 'trigger', trigger: event, outcome, value, ...options });

const tempo = (
  attackSpeedPerStack: number,
  maxStacks: number,
  missBehavior: 'reset' | 'remove-one',
  damageRemoves: number,
  condition?: CombatEffectCondition
): EffectFactory => (id, skillId) => ({
  id,
  skillId,
  kind: 'tempo',
  attackSpeedPerStack,
  maxStacks,
  missBehavior,
  damageRemoves,
  condition
});

const recovery = (
  recoveryId: 'mend-echo' | 'mend-hot' | 'damage-recovery',
  value: number,
  durationSeconds: number,
  options: { capPctMaxHitPoints?: number; priority?: number; condition?: CombatEffectCondition } = {}
): EffectFactory => (id, skillId) => ({
  id,
  skillId,
  kind: 'recovery',
  recovery: recoveryId,
  value,
  durationSeconds,
  ...options
});

const reserve = (
  conversionPct: number,
  capPctMaxHitPoints: number,
  releaseBelow: number,
  priority: number,
  condition: CombatEffectCondition,
  retainUnused = false
): EffectFactory => (id, skillId) => ({
  id,
  skillId,
  kind: 'reserve',
  conversionPct,
  capPctMaxHitPoints,
  releaseBelow,
  retainUnused,
  priority,
  condition
});

const emergency = (
  threshold: number,
  options: {
    healPctMaxHitPoints?: number;
    freeMendMultiplier?: number;
    fatalGuardPctMaxHitPoints?: number;
    readyDefensive?: boolean;
    attackSpeedPct?: number;
    attackCount?: number;
    limit?: number;
    family?: string;
    priority?: number;
    condition?: CombatEffectCondition;
  }
): EffectFactory => (id, skillId) => ({
  id,
  skillId,
  kind: 'emergency',
  threshold,
  limit: options.limit ?? 1,
  ...options
});

const node = (name: string, description: string, ...effects: EffectFactory[]): NodeSpec => ({
  name,
  description,
  effects
});

const slug = (value: string): string => value
  .toLowerCase()
  .replace(/[^a-z0-9]+/g, '-')
  .replace(/^-|-$/g, '');

const effectDefinitions: CombatTreeEffectDefinition[] = [];

function buildTree(
  skillId: CombatSkillId,
  title: string,
  branches: readonly [BranchSpec, BranchSpec, BranchSpec]
): SkillTreeDefinition {
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

const supportMagicBranches: readonly [BranchSpec, BranchSpec, BranchSpec] = [
  {
    id: 'empowerment',
    name: 'Empowerment',
    description: 'Turn Battle Focus into a sharper offensive signal.',
    color: '#ffb34d',
    root: node('Focused Signal', 'Battle Focus grants +2 percentage-point damage.', stat('auraDamageBonus', 0.02, BATTLE_FOCUS)),
    pathA: [
      node('Guided Strikes', '+5 accuracy while Battle Focus is active.', stat('accuracyFlat', 5, BATTLE_FOCUS)),
      node('Keen Resonance', '+3 percentage-point critical chance while Battle Focus is active.', stat('criticalChance', 0.03, BATTLE_FOCUS)),
      node('War Chorus', 'Battle Focus grants another +5 percentage-point damage and +5 accuracy.', stat('auraDamageBonus', 0.05, BATTLE_FOCUS), stat('accuracyFlat', 5, BATTLE_FOCUS))
    ],
    pathB: [
      node('Quickening Current', '+3% attack speed while Battle Focus is active.', stat('attackSpeedPct', 0.03, BATTLE_FOCUS)),
      node('Tactical Cadence', '−10% technique cooldown while Battle Focus is active.', stat('techniqueCooldownPct', 0.10, BATTLE_FOCUS)),
      node('Overclocked Aura', 'Another +5% attack speed and −15% technique cooldown.', stat('attackSpeedPct', 0.05, BATTLE_FOCUS), stat('techniqueCooldownPct', 0.15, BATTLE_FOCUS))
    ]
  },
  {
    id: 'safeguard',
    name: 'Safeguard',
    description: 'Use the aura to stabilize incoming pressure and recovery.',
    color: '#62e6a7',
    root: node('Soothing Field', '+10% healing while Battle Focus is active.', stat('healingPct', 0.10, BATTLE_FOCUS)),
    pathA: [
      node('Steady Pulse', '−3% damage taken while Battle Focus is active.', stat('damageTakenReductionPct', 0.03, BATTLE_FOCUS)),
      node('Anchoring Wave', '+5% maximum HP while Battle Focus is active.', stat('maxHitPointsPct', 0.05, BATTLE_FOCUS)),
      node('Sanctuary Signal', 'Below 50% HP, another −8% damage taken and +15% healing.', stat('damageTakenReductionPct', 0.08, { ...BATTLE_FOCUS, playerHealthBelow: 0.50 }), stat('healingPct', 0.15, { ...BATTLE_FOCUS, playerHealthBelow: 0.50 }))
    ],
    pathB: [
      node('Restorative Chorus', 'Mend gains +10% healing while Battle Focus is active.', stat('healingPct', 0.10, BATTLE_FOCUS_MEND)),
      node('Recurrent Pattern', '−10% Mend cooldown while Battle Focus is active.', stat('mendCooldownPct', 0.10, BATTLE_FOCUS_MEND)),
      node('Renewal Echo', 'Mend repeats 30% of its effective healing over three seconds.', recovery('mend-echo', 0.30, 3, { priority: 1, condition: BATTLE_FOCUS_MEND }))
    ]
  },
  {
    id: 'convergence',
    name: 'Convergence',
    description: 'Link Battle Focus, Mend, and weapon techniques into one cycle.',
    color: '#58d9ff',
    root: node('Linked Rhythm', 'Each technique use removes 0.5 seconds from Mend’s remaining cooldown.', trigger('after-technique', 'reduce-defensive-cooldown', 0.5, { condition: BATTLE_FOCUS_MEND })),
    pathA: [
      node('Return Current', 'Mend removes 10% of remaining technique cooldown.', trigger('after-mend', 'reduce-technique-cooldown', 0.10, { condition: BATTLE_FOCUS_MEND })),
      node('Mutual Flow', 'Mend removes another 10% of remaining technique cooldown.', trigger('after-mend', 'reduce-technique-cooldown', 0.10, { condition: BATTLE_FOCUS_MEND })),
      node('Perfect Circuit', 'First Mend readies the technique; first technique used below 75% HP readies Mend.', trigger('after-mend', 'ready-technique', 1, { limit: 1, condition: BATTLE_FOCUS_MEND }), trigger('after-technique', 'ready-defensive', 1, { limit: 1, condition: { ...BATTLE_FOCUS_MEND, playerHealthBelow: 0.75 } }))
    ],
    pathB: [
      node('Rallying Pulse', 'After Mend, the next attack deals +10% damage.', trigger('after-mend', 'damage', 0.10, { count: 1, family: 'support:mend-damage', priority: 1, condition: BATTLE_FOCUS_MEND })),
      node('Accelerated Chorus', 'That attack is also 10% faster and gains +10 accuracy.', trigger('after-mend', 'attack-speed', 0.10, { count: 1, family: 'support:mend-speed', priority: 1, condition: BATTLE_FOCUS_MEND }), trigger('after-mend', 'accuracy', 10, { count: 1, condition: BATTLE_FOCUS_MEND })),
      node('Battle Hymn', 'After Mend, the next three attacks gain +15% damage and +10% speed; the first cannot miss.', trigger('after-mend', 'damage', 0.15, { count: 3, family: 'support:mend-damage', priority: 3, condition: BATTLE_FOCUS_MEND }), trigger('after-mend', 'attack-speed', 0.10, { count: 3, family: 'support:mend-speed', priority: 3, condition: BATTLE_FOCUS_MEND }), trigger('after-mend', 'guarantee-hit', 1, { count: 1, condition: BATTLE_FOCUS_MEND }))
    ]
  }
];

const reflexesBranches: readonly [BranchSpec, BranchSpec, BranchSpec] = [
  {
    id: 'tempo',
    name: 'Tempo',
    description: 'Build universal combat speed through clean execution.',
    color: '#58d9ff',
    root: node('Quick Response', '+3% attack speed.', stat('attackSpeedPct', 0.03)),
    pathA: [
      node('Fluid Motion', 'Another +4% attack speed.', stat('attackSpeedPct', 0.04)),
      node('Combat Flow', 'Successful attacks add +1% speed, maximum five; a miss clears the flow and damage removes two stacks.', tempo(0.01, 5, 'reset', 2)),
      node('Perfect Rhythm', 'Flow grants +2% per stack; a miss removes one and damage removes two.', tempo(0.02, 5, 'remove-one', 2))
    ],
    pathB: [
      node('Technique Instinct', '−5% technique cooldown.', stat('techniqueCooldownPct', 0.05)),
      node('Rehearsed Motion', 'Another −10% technique cooldown.', stat('techniqueCooldownPct', 0.10)),
      node('Zero Hesitation', 'Another −20% technique cooldown; the first technique cannot miss.', stat('techniqueCooldownPct', 0.20), trigger('first-technique', 'guarantee-hit', 1, { limit: 1 }))
    ]
  },
  {
    id: 'counter',
    name: 'Counter',
    description: 'Turn enemy contact and missed attacks into immediate answers.',
    color: '#ffb34d',
    root: node('Rebound', 'After taking damage, the next attack is 10% faster.', trigger('after-damage', 'attack-speed', 0.10, { family: 'reflex:damage-speed', priority: 1 })),
    pathA: [
      node('Counterstep', 'That attack deals +10% damage.', trigger('after-damage', 'damage', 0.10, { family: 'reflex:damage-damage', priority: 1 })),
      node('Recenter', 'That attack gains +10 accuracy.', trigger('after-damage', 'accuracy', 10)),
      node('Immediate Answer', 'Bonuses become +25% speed and damage; the attack cannot miss.', trigger('after-damage', 'attack-speed', 0.25, { family: 'reflex:damage-speed', priority: 3 }), trigger('after-damage', 'damage', 0.25, { family: 'reflex:damage-damage', priority: 3 }), trigger('after-damage', 'guarantee-hit', 1))
    ],
    pathB: [
      node('Read the Opening', 'After an enemy miss, the next attack is 10% faster.', trigger('after-enemy-miss', 'attack-speed', 0.10, { family: 'reflex:miss-speed', priority: 1 })),
      node('Turnabout', 'That attack deals +15% damage.', trigger('after-enemy-miss', 'damage', 0.15)),
      node('Perfect Read', 'An enemy miss readies the technique; the next attack is 20% faster and guaranteed critical if it hits.', trigger('after-enemy-miss', 'ready-technique', 1), trigger('after-enemy-miss', 'attack-speed', 0.20, { family: 'reflex:miss-speed', priority: 3 }), trigger('after-enemy-miss', 'guarantee-critical', 1))
    ]
  },
  {
    id: 'adrenaline',
    name: 'Adrenaline',
    description: 'Accelerate as health and defensive timing become critical.',
    color: '#ff637d',
    root: node('Heightened Senses', '+5% attack speed below 50% HP.', stat('attackSpeedPct', 0.05, { playerHealthBelow: 0.50 })),
    pathA: [
      node('Narrow Focus', '+10 accuracy below 40% HP.', stat('accuracyFlat', 10, { playerHealthBelow: 0.40 })),
      node('Crisis Tempo', 'Another +10% attack speed below 30% HP.', stat('attackSpeedPct', 0.10, { playerHealthBelow: 0.30 })),
      node('Redline', 'Below 25% HP, another +10% attack speed and −20% technique cooldown.', stat('attackSpeedPct', 0.10, { playerHealthBelow: 0.25 }), stat('techniqueCooldownPct', 0.20, { playerHealthBelow: 0.25 }))
    ],
    pathB: [
      node('Shake It Off', 'Taking damage removes 0.5 seconds from defensive cooldown, at most once per second.', trigger('after-damage', 'reduce-defensive-cooldown', 0.5, { family: 'reflex:defensive-recovery', priority: 1 })),
      node('Accelerated Recovery', 'The cooldown reduction becomes one second.', trigger('after-damage', 'reduce-defensive-cooldown', 1, { family: 'reflex:defensive-recovery', priority: 2 })),
      node('Adrenal Surge', 'Once below 35% HP, ready the defensive ability and make the next three attacks 20% faster.', emergency(0.35, { readyDefensive: true, attackSpeedPct: 0.20, attackCount: 3, family: 'reflex:adrenal-surge', priority: 3 }))
    ]
  }
];

const healingBranches: readonly [BranchSpec, BranchSpec, BranchSpec] = [
  {
    id: 'restoration',
    name: 'Restoration',
    description: 'Increase direct Mend output or add sustained recovery.',
    color: '#62e6a7',
    root: node('Field Medicine', 'Mend gains +8% healing.', stat('healingPct', 0.08, MEND)),
    pathA: [
      node('Potent Remedy', 'Another +10% Mend healing.', stat('healingPct', 0.10, MEND)),
      node('Deep Recovery', 'Another +12% Mend healing.', stat('healingPct', 0.12, MEND)),
      node('Miracle Work', 'Another +25% Mend healing.', stat('healingPct', 0.25, MEND))
    ],
    pathB: [
      node('Lingering Care', 'Mend restores 4% maximum HP over four seconds.', recovery('mend-hot', 0.04, 4, { priority: 1, condition: MEND })),
      node('Sustained Treatment', 'The restoration becomes 8% maximum HP over four seconds.', recovery('mend-hot', 0.08, 4, { priority: 2, condition: MEND })),
      node('Renewing Tide', 'The restoration becomes 15% maximum HP over five seconds.', recovery('mend-hot', 0.15, 5, { priority: 3, condition: MEND }))
    ]
  },
  {
    id: 'triage',
    name: 'Triage',
    description: 'Cast Mend earlier, faster, and at the moment of crisis.',
    color: '#58d9ff',
    root: node('Rapid Aid', '−5% Mend cooldown.', stat('mendCooldownPct', 0.05, MEND)),
    pathA: [
      node('Practised Hands', 'Another −10% Mend cooldown.', stat('mendCooldownPct', 0.10, MEND)),
      node('Ready Kit', 'Mend trigger threshold rises from 75% to 80% HP.', stat('mendThresholdBonus', 0.05, MEND)),
      node('First Responder', 'Another −20% cooldown and the trigger threshold rises to 85% HP.', stat('mendCooldownPct', 0.20, MEND), stat('mendThresholdBonus', 0.05, MEND))
    ],
    pathB: [
      node('Critical Care', '+15% Mend healing below 40% HP.', stat('healingPct', 0.15, { ...MEND, playerHealthBelow: 0.40 })),
      node('Emergency Measures', 'The first drop below 30% HP halves Mend’s remaining cooldown.', trigger('health-threshold', 'reduce-defensive-cooldown', 0.50, { limit: 1, condition: { ...MEND, playerHealthBelow: 0.30 } })),
      node('Life Support', 'Once below 20% HP while alive, cast a 150% Mend without starting or consuming its cooldown.', emergency(0.20, { freeMendMultiplier: 1.50, family: 'healing:life-support', priority: 3, condition: MEND }))
    ]
  },
  {
    id: 'conservation',
    name: 'Conservation',
    description: 'Turn overhealing into stored recovery or faster future Mends.',
    color: '#d36cff',
    root: node('No Waste', 'Bank 25% of Mend overheal, maximum 5% HP; release after damage below 50% HP.', reserve(0.25, 0.05, 0.50, 1, MEND)),
    pathA: [
      node('Deep Reservoir', 'Bank 50% of overheal with a 10% maximum-HP cap.', reserve(0.50, 0.10, 0.50, 2, MEND)),
      node('Early Release', 'Recovery Reserve releases below 75% HP.', reserve(0.50, 0.10, 0.75, 3, MEND)),
      node('Living Reserve', 'Bank 100% with a 20% cap and 90% release threshold; unused reserve remains.', reserve(1, 0.20, 0.90, 4, MEND, true))
    ],
    pathB: [
      node('Efficient Practice', 'Any Mend overheal shortens its new cooldown by 0.5 seconds.', trigger('after-mend', 'reduce-defensive-cooldown', 0.5, { family: 'healing:overheal-cooldown', priority: 1, condition: { ...MEND, overhealing: true } })),
      node('Recycled Remedy', 'The cooldown reduction becomes 1.5 seconds.', trigger('after-mend', 'reduce-defensive-cooldown', 1.5, { family: 'healing:overheal-cooldown', priority: 2, condition: { ...MEND, overhealing: true } })),
      node('Closed Loop', 'Remove one second per 10% maximum HP overhealed, minimum 1.5 and maximum four seconds.', trigger('after-mend', 'reduce-defensive-cooldown', 0, { family: 'healing:overheal-cooldown', priority: 3, scale: 'overheal-pct-max-hit-points', minimum: 1.5, maximum: 4, condition: { ...MEND, overhealing: true } }))
    ]
  }
];

const vitalityBranches: readonly [BranchSpec, BranchSpec, BranchSpec] = [
  {
    id: 'constitution',
    name: 'Constitution',
    description: 'Increase the health pool or make every recovery source stronger.',
    color: '#ff754f',
    root: node('Hardy', '+5% maximum HP.', stat('maxHitPointsPct', 0.05)),
    pathA: [
      node('Deep Reserves', 'Another +5% maximum HP.', stat('maxHitPointsPct', 0.05)),
      node('Iron Constitution', 'Another +10% maximum HP.', stat('maxHitPointsPct', 0.10)),
      node('Mountain Heart', 'Another +20% maximum HP.', stat('maxHitPointsPct', 0.20))
    ],
    pathB: [
      node('Efficient Circulation', '+10% healing received.', stat('healingPct', 0.10)),
      node('Strong Pulse', 'Another +10% healing received.', stat('healingPct', 0.10)),
      node('Life Wellspring', 'Another +20% healing and +10% maximum HP.', stat('healingPct', 0.20), stat('maxHitPointsPct', 0.10))
    ]
  },
  {
    id: 'regeneration',
    name: 'Regeneration',
    description: 'Recover continuously or reclaim a portion of incoming damage.',
    color: '#62e6a7',
    root: node('Natural Recovery', 'Restore 0.15% maximum HP per second.', stat('regenerationPctPerSecond', 0.0015)),
    pathA: [
      node('Steady Pulse', 'Restore another 0.15% maximum HP per second.', stat('regenerationPctPerSecond', 0.0015)),
      node('Rapid Renewal', 'Restore another 0.20% maximum HP per second.', stat('regenerationPctPerSecond', 0.0020)),
      node('Evergreen', 'Restore another 0.50% maximum HP per second.', stat('regenerationPctPerSecond', 0.0050))
    ],
    pathB: [
      node('Recuperation', 'Recover 5% of damage taken over four seconds; pending recovery caps at 5% maximum HP.', recovery('damage-recovery', 0.05, 4, { capPctMaxHitPoints: 0.05, priority: 1 })),
      node('Adaptive Recovery', 'Recover 10% over four seconds with an 8% maximum-HP cap.', recovery('damage-recovery', 0.10, 4, { capPctMaxHitPoints: 0.08, priority: 2 })),
      node('Living Engine', 'Recover 20% over five seconds with a 10% maximum-HP cap.', recovery('damage-recovery', 0.20, 5, { capPctMaxHitPoints: 0.10, priority: 3 }))
    ]
  },
  {
    id: 'last-stand',
    name: 'Last Stand',
    description: 'Convert critical health into recovery or stubborn endurance.',
    color: '#ffc857',
    root: node('Grit', '+15% healing below 35% HP.', stat('healingPct', 0.15, { playerHealthBelow: 0.35 })),
    pathA: [
      node('Emergency Reserve', 'The first drop below 30% HP restores 5% maximum HP.', emergency(0.30, { healPctMaxHitPoints: 0.05, family: 'vitality:threshold-heal', priority: 1 })),
      node('Second Breath', 'The threshold restoration becomes 10% maximum HP.', emergency(0.30, { healPctMaxHitPoints: 0.10, family: 'vitality:threshold-heal', priority: 2 })),
      node('Indomitable', 'Fatal damage once leaves one HP and restores 15% maximum HP.', emergency(0, { fatalGuardPctMaxHitPoints: 0.15, family: 'vitality:fatal-guard', priority: 3 }))
    ],
    pathB: [
      node('Tempered Nerves', '−3% damage taken below 50% HP.', stat('damageTakenReductionPct', 0.03, { playerHealthBelow: 0.50 })),
      node('Die Hard', 'Another −5% damage taken below 30% HP.', stat('damageTakenReductionPct', 0.05, { playerHealthBelow: 0.30 })),
      node('Last Bastion', 'Another −7% damage taken below 20% HP.', stat('damageTakenReductionPct', 0.07, { playerHealthBelow: 0.20 }))
    ]
  }
];

export const SUPPORT_MAGIC_SKILL_TREE = buildTree('Support Magic', 'Support Magic', supportMagicBranches);
export const REFLEXES_SKILL_TREE = buildTree('Reflexes', 'Reflexes', reflexesBranches);
export const HEALING_SKILL_TREE = buildTree('Healing', 'Healing', healingBranches);
export const VITALITY_SKILL_TREE = buildTree('Vitality', 'Vitality', vitalityBranches);

export const SUSTAIN_TREE_EFFECT_DEFINITIONS: Readonly<Record<string, CombatTreeEffectDefinition>> = Object.freeze(
  Object.fromEntries(effectDefinitions.map(effect => [effect.id, Object.freeze(effect)]))
);
