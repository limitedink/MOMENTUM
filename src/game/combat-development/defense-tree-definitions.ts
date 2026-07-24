import type { CombatSkillId } from '../combat-progression';
import type { SkillTreeDefinition, SkillTreeNode } from '../skills/skill-types';
import type {
  ArmourClass,
  DamageType,
  EnemyAttackTag
} from '../solo-frontier/solo-frontier-types';
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

const stat = (
  statId: CombatModifierStat,
  value: number,
  condition?: CombatEffectCondition,
  family?: string,
  priority?: number
): EffectFactory => (id, skillId) => ({
  id, skillId, kind: 'stat', stat: statId, value,
  ...(family ? { family, priority } : {}),
  ...(condition ? { condition } : {})
});

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
    cooldownSeconds?: number;
    condition?: CombatEffectCondition;
  } = {}
): EffectFactory => (id, skillId) => ({ id, skillId, kind: 'trigger', trigger: event, outcome, value, ...options });

const defense = (shape: Record<string, unknown>): EffectFactory => (id, skillId) => ({
  id,
  skillId,
  kind: 'defense',
  ...shape
} as CombatTreeEffectDefinition);

const glance = (reductionPct: number, options: Record<string, unknown> = {}): EffectFactory => defense({ defense: 'glance', reductionPct, ...options });
const guard = (reductionPct: number, options: Record<string, unknown> = {}): EffectFactory => defense({ defense: 'guard', reductionPct, ...options });
const avoidance = (options: Record<string, unknown> = {}): EffectFactory => defense({ defense: 'avoidance', charges: 99, ...options });
const adaptive = (mode: 'same' | 'opposite' | 'change', reductionPct: number, hits: number, options: Record<string, unknown> = {}): EffectFactory => defense({ defense: 'adaptive', mode, reductionPct, hits, ...options });
const evasionStreak = (
  evasionPerStack: number,
  maxStacks: number,
  hitBehavior: 'clear' | 'remove-two',
  options: Record<string, unknown> = {}
): EffectFactory => defense({ defense: 'evasion-streak', evasionPerStack, maxStacks, hitBehavior, ...options });
const retaliation = (damagePct: number, capPctDerivedHit: number, options: Record<string, unknown> = {}): EffectFactory => defense({
  defense: 'retaliation', source: 'armour-prevented', damagePct, capPctDerivedHit, ...options
});
const barrierResponse = (options: Record<string, unknown> = {}): EffectFactory => defense({ defense: 'barrier-response', trigger: 'break', ...options });

const emergency = (
  threshold: number,
  options: {
    readyDefensive?: boolean;
    attackSpeedPct?: number;
    attackCount?: number;
    limit?: number;
    family?: string;
    priority?: number;
    condition?: CombatEffectCondition;
  } = {}
): EffectFactory => (id, skillId) => ({
  id,
  skillId,
  kind: 'emergency',
  threshold,
  limit: options.limit ?? 1,
  ...options
});

const node = (name: string, description: string, ...effects: EffectFactory[]): NodeSpec => ({ name, description, effects });
const slug = (value: string): string => value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
const effectDefinitions: CombatTreeEffectDefinition[] = [];

function buildTree(
  skillId: CombatSkillId,
  title: string,
  branches: readonly [BranchSpec, BranchSpec, BranchSpec],
  armourWeight?: ArmourClass
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
    const minimumArmourPieces = armourWeight ? (capstone ? 6 : tier >= 3 ? 4 : 2) : undefined;
    const effectIds = spec.effects.map((factory, index) => {
      const effectId = `${id}:${index + 1}`;
      const effect = factory(effectId, skillId);
      if (armourWeight) {
        effect.condition = {
          ...(effect.condition || {}),
          armourClass: armourWeight,
          minimumArmourPieces
        };
      }
      effectDefinitions.push(effect);
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
    branches: branches.map(branch => ({ id: branch.id, name: branch.name, description: branch.description, color: branch.color })),
    nodes: Object.freeze(nodes),
    edges: Object.freeze(edges),
    rootNodeIds: Object.freeze(rootNodeIds),
    viewBox: { width: 1000, height: 700 }
  });
}

const lightBranches: readonly [BranchSpec, BranchSpec, BranchSpec] = [
  {
    id: 'fleet', name: 'Fleet', description: 'Stay mobile and turn enemy misses into tempo.', color: '#55d9ff',
    root: node('Unburdened', '+4 Evasion.', stat('evasionFlat', 4)),
    pathA: [
      node('Soft Step', '+4 Evasion.', stat('evasionFlat', 4)),
      node('Ghost Line', 'Reduce enemy hit chance by 2 percentage points.', stat('enemyHitChanceReduction', 0.02)),
      node('Windborne', '+8 Evasion and another 3 percentage-point enemy hit-chance reduction.', stat('evasionFlat', 8), stat('enemyHitChanceReduction', 0.03))
    ],
    pathB: [
      node('Read the Gap', 'After an enemy miss, your next attack is 5% faster.', trigger('after-enemy-miss', 'attack-speed', 0.05)),
      node('Slipstream', 'The Read the Gap attack also deals +10% damage.', trigger('after-enemy-miss', 'damage', 0.10)),
      node('Flow State', 'The gap bonuses become +20% speed and +20% damage; the attack cannot miss.', trigger('after-enemy-miss', 'attack-speed', 0.20, { family: 'light.fleet.gap-speed', priority: 2 }), trigger('after-enemy-miss', 'damage', 0.20, { family: 'light.fleet.gap-damage', priority: 2 }), trigger('after-enemy-miss', 'guarantee-hit', 1, { family: 'light.fleet.gap-hit', priority: 2 }))
    ]
  },
  {
    id: 'deflection', name: 'Deflection', description: 'Turn clean hits into glances and disciplined counters.', color: '#66e6a9',
    root: node('Flexible Guard', 'The first enemy hit each encounter glances for 25% less damage.', glance(0.25, { first: 1, family: 'light.deflection.opening', priority: 1 })),
    pathA: [
      node('Roll With It', 'The first enemy hit glances for 35% less damage.', glance(0.35, { first: 1, family: 'light.deflection.opening', priority: 2 })),
      node('Shallow Angle', 'Every eighth enemy hit glances.', glance(0.35, { every: 8, family: 'light.deflection.periodic', priority: 1 })),
      node('No Clean Hit', 'Every fifth enemy hit glances for 50% less damage.', glance(0.50, { every: 5, family: 'light.deflection.periodic', priority: 2 }))
    ],
    pathB: [
      node('Kinetic Escape', 'After a glance, your next attack is 10% faster.', trigger('after-damage', 'attack-speed', 0.10)),
      node('Reposition', 'The attack after a glance also deals +15% damage.', trigger('after-damage', 'damage', 0.15)),
      node('Phantom Reprisal', 'The first glance readies your technique; every glance grants +20% speed and damage to the next attack.', trigger('after-damage', 'ready-technique', 1, { limit: 1 }), trigger('after-damage', 'attack-speed', 0.20, { family: 'light.deflection.counter-speed', priority: 2 }), trigger('after-damage', 'damage', 0.20, { family: 'light.deflection.counter-damage', priority: 2 }))
    ]
  },
  {
    id: 'escape', name: 'Escape', description: 'Make low-health danger a window for one more attack.', color: '#a678ff',
    root: node('Edge of Reach', '+4 Evasion below 50% HP.', stat('evasionFlat', 4, { playerHealthBelow: 0.50 })),
    pathA: [
      node('Desperate Footwork', 'Gain another +4 Evasion below 40% HP.', stat('evasionFlat', 4, { playerHealthBelow: 0.40 })),
      node('Narrow Escape', 'Once below 35% HP, the next would-be hit glances for 50% less damage.', glance(0.50, { threshold: 0.35, charges: 1, family: 'light.escape.conversion', priority: 1 })),
      node('Last Horizon', 'Once below 40% HP, the next two would-be hits glance for 50% less damage.', glance(0.50, { threshold: 0.40, charges: 2, family: 'light.escape.conversion', priority: 2 }))
    ],
    pathB: [
      node('Adrenal Response', 'After damage below 50% HP, your next attack is 10% faster.', trigger('after-damage', 'attack-speed', 0.10, { condition: { playerHealthBelow: 0.50 } })),
      node('Breakaway', 'That attack also deals +15% damage.', trigger('after-damage', 'damage', 0.15, { condition: { playerHealthBelow: 0.50 } })),
      node('Live Wire', 'The first drop below 35% HP grants the next three attacks +20% speed and damage; the first cannot miss.', trigger('after-damage', 'attack-speed', 0.20, { limit: 3, family: 'light.escape.live-speed', priority: 2, condition: { playerHealthBelow: 0.35 } }), trigger('after-damage', 'damage', 0.20, { limit: 3, family: 'light.escape.live-damage', priority: 2, condition: { playerHealthBelow: 0.35 } }), trigger('after-damage', 'guarantee-hit', 1, { limit: 1, family: 'light.escape.live-hit', priority: 2, condition: { playerHealthBelow: 0.35 } }))
    ]
  }
];

const mediumBranches: readonly [BranchSpec, BranchSpec, BranchSpec] = [
  {
    id: 'balance', name: 'Balance', description: 'Make a complete medium set a stable all-round defense.', color: '#55d9ff',
    root: node('Layered Defence', '+5% matching-piece armour and +5% total ward.', stat('armourPct', 0.05), stat('wardPct', 0.05)),
    pathA: [
      node('Tempered Layers', 'Gain another +10% matching-piece armour.', stat('armourPct', 0.10)),
      node('Reinforced Weave', 'Gain another +15% matching-piece armour.', stat('armourPct', 0.15)),
      node('Masterwork Mail', 'Gain another +20% matching-piece armour and take 5% less physical damage after mitigation.', stat('armourPct', 0.20), stat('physicalDamageReductionPct', 0.05))
    ],
    pathB: [
      node('Runed Lining', 'Gain another +10% ward.', stat('wardPct', 0.10)),
      node('Dual Insulation', 'Gain another +15% ward.', stat('wardPct', 0.15)),
      node('Aegis Mail', 'Gain another +30% ward and take 5% less magical damage after mitigation.', stat('wardPct', 0.30), stat('magicalDamageReductionPct', 0.05))
    ]
  },
  {
    id: 'adaptation', name: 'Adaptation', description: 'Learn enemy damage patterns and blunt the next lesson.', color: '#ffc857',
    root: node('Read the Blow', 'After a hit, the next hit of the same damage type deals 5% less.', adaptive('same', 0.05, 1, { family: 'medium.adaptation.same', priority: 1 })),
    pathA: [
      node('Hardened Response', 'The same-type reduction becomes 10%.', adaptive('same', 0.10, 1, { family: 'medium.adaptation.same', priority: 2 })),
      node('Retained Lesson', 'The same-type reduction applies to the next two hits.', adaptive('same', 0.10, 2, { family: 'medium.adaptation.same', priority: 3 })),
      node('Learned Resistance', 'The same-type reduction becomes 20% for the next two hits.', adaptive('same', 0.20, 2, { family: 'medium.adaptation.same', priority: 4 }))
    ],
    pathB: [
      node('Cross Training', 'The next opposite-type hit deals 10% less.', adaptive('opposite', 0.10, 1, { family: 'medium.adaptation.opposite', priority: 1 })),
      node('Seamless Transition', 'The opposite-type reduction becomes 15%.', adaptive('opposite', 0.15, 1, { family: 'medium.adaptation.opposite', priority: 2 })),
      node('Perfect Adaptation', 'A damage-type change deals 30% less; a repeated type deals 10% less.', adaptive('change', 0.30, 1, { family: 'medium.adaptation.change', priority: 2 }), adaptive('same', 0.10, 1, { family: 'medium.adaptation.same.secondary', priority: 1 }))
    ]
  },
  {
    id: 'readiness', name: 'Readiness', description: 'Keep defensive abilities available and answer damage with a prepared strike.', color: '#66e6a9',
    root: node('Field Ready', 'Mend and Arcane Barrier cooldowns are 5% shorter.', stat('defensiveCooldownPct', 0.05)),
    pathA: [
      node('Reset the Guard', 'Damage removes 0.5 seconds from defensive cooldown, at most once per second.', trigger('after-damage', 'reduce-defensive-cooldown', 0.5, { family: 'medium.readiness.reset', priority: 1 })),
      node('Drilled Recovery', 'The cooldown reduction becomes one second.', trigger('after-damage', 'reduce-defensive-cooldown', 1, { family: 'medium.readiness.reset', priority: 2 })),
      node('Always Prepared', 'Also readies the defensive ability on the first drop below 50% HP.', emergency(0.50, { readyDefensive: true, family: 'medium.readiness.emergency', priority: 1 }))
    ],
    pathB: [
      node('Set and Answer', 'After damage, your next attack deals +8%.', trigger('after-damage', 'damage', 0.08, { family: 'medium.readiness.answer-damage', priority: 1 })),
      node('Measured Counter', 'The attack also gains +15% damage and +10 accuracy.', trigger('after-damage', 'damage', 0.15, { family: 'medium.readiness.answer-damage', priority: 2 }), trigger('after-damage', 'accuracy', 10, { family: 'medium.readiness.answer-accuracy', priority: 1 })),
      node('Decisive Response', 'The next technique deals +30% damage and cannot miss, at most once every five seconds.', trigger('after-damage', 'damage', 0.30, { family: 'medium.readiness.answer-damage', priority: 3, cooldownSeconds: 5, condition: { isTechnique: true } }), trigger('after-damage', 'guarantee-hit', 1, { family: 'medium.readiness.answer-hit', priority: 1, cooldownSeconds: 5, condition: { isTechnique: true } }))
    ]
  }
];

export const LIGHT_ARMOUR_SKILL_TREE = buildTree('Light Armour Proficiency', 'Light Armour Proficiency', lightBranches, 'light');
export const MEDIUM_ARMOUR_SKILL_TREE = buildTree('Medium Armour Proficiency', 'Medium Armour Proficiency', mediumBranches, 'medium');

export const DEFENSE_TREE_EFFECT_DEFINITIONS: Readonly<Record<string, CombatTreeEffectDefinition>> = Object.freeze(
  Object.fromEntries(effectDefinitions.map(effect => [effect.id, effect]))
);
