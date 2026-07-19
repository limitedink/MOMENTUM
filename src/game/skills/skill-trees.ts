import type {
  SkillTreeDefinition,
  SkillTreeNode,
  SkillTreeNodeState,
  SkillTreeState,
  SkillTreeViewState
} from './skill-types';

const DEFAULT_VIEW: SkillTreeViewState = {
  zoom: 1,
  panX: 0,
  panY: 0,
  focusNodeId: null,
  activeBranch: null
};

const combatNode = (
  node: Omit<SkillTreeNode, 'skillId' | 'effectIds' | 'cost'> & {
    cost?: number;
  }
): SkillTreeNode => ({
  ...node,
  skillId: 'Combat',
  cost: node.cost ?? 1,
  effectIds: [node.id]
});

const edge = (from: string, to: string) => ({
  id: `${from}->${to}`,
  from,
  to,
  kind: 'prerequisite' as const
});

/**
 * Combat is the first authored tree. Its node IDs intentionally match the
 * legacy Combat Discipline talent IDs used by arena effects, presets, and v14
 * saves so the graph is a new presentation over the existing progression.
 */
export const COMBAT_SKILL_TREE: SkillTreeDefinition = {
  id: 'combat',
  name: 'Combat Skill Tree',
  skillId: 'Combat',
  currencyLabel: 'Combat Points',
  description: 'Shape how you strike, move, and survive in the Arena.',
  viewBox: { width: 1000, height: 650 },
  branches: [
    { id: 'assault', name: 'Assault', description: 'Build pressure and finish the fight.', color: '#ff637d' },
    { id: 'mobility', name: 'Mobility', description: 'Turn every Dash into momentum.', color: '#50d9ff' },
    { id: 'survival', name: 'Survival', description: 'Stay standing when the arena turns.', color: '#62e6a7' }
  ],
  rootNodeIds: ['openingAttack', 'dashStrike', 'fieldRation'],
  nodes: [
    combatNode({ id: 'openingAttack', branch: 'assault', tier: 1, name: 'Opening Attack', description: 'First successful hit of each run deals double damage.', requires: [], position: { x: 150, y: 540 }, icon: { sheet: 'loadout', key: 'melee', fallback: '⚔' } }),
    combatNode({ id: 'pressure', branch: 'assault', tier: 2, fork: 'assaultTechnique', exclusiveGroup: 'assaultTechnique', name: 'Pressure', description: 'Consecutive hits build damage; missing or taking damage resets it.', requires: ['openingAttack'], position: { x: 55, y: 325 }, icon: { sheet: 'loadout', key: 'gun', fallback: '↗' } }),
    combatNode({ id: 'counterforce', branch: 'assault', tier: 2, fork: 'assaultTechnique', exclusiveGroup: 'assaultTechnique', name: 'Counterforce', description: 'Taking damage arms the next attack for 50% additional damage.', requires: ['openingAttack'], position: { x: 150, y: 325 }, icon: { sheet: 'loadout', key: 'armor', fallback: '✦' } }),
    combatNode({ id: 'cadence', branch: 'assault', tier: 2, fork: 'assaultTechnique', exclusiveGroup: 'assaultTechnique', name: 'Cadence', description: 'Every third consecutive hit deals 40% additional damage.', requires: ['openingAttack'], position: { x: 245, y: 325 }, icon: { sheet: 'loadout', key: 'magic', fallback: '◌' } }),
    combatNode({ id: 'executioner', branch: 'assault', tier: 3, capstone: true, name: 'Executioner', description: 'Once per run, hitting below 25% HP deals 15% maximum HP bonus damage.', requires: ['pressure'], position: { x: 55, y: 110 }, icon: { sheet: 'loadout', key: 'melee', fallback: '☠' } }),
    combatNode({ id: 'reprisal', branch: 'assault', tier: 3, capstone: true, name: 'Reprisal', description: 'Counterforce hits also restore 12 HP.', requires: ['counterforce'], position: { x: 150, y: 110 }, icon: { sheet: 'loadout', key: 'armor', fallback: '↺' } }),
    combatNode({ id: 'overdrive', branch: 'assault', tier: 3, capstone: true, name: 'Overdrive', description: 'Cadence hits stagger the boss and immediately ready the next attack.', requires: ['cadence'], position: { x: 245, y: 110 }, icon: { sheet: 'loadout', key: 'gun', fallback: '⚡' } }),

    combatNode({ id: 'dashStrike', branch: 'mobility', tier: 1, name: 'Dash Strike', description: 'First attack within 0.75s after a Dash deals 50% additional damage.', requires: [], position: { x: 500, y: 540 }, icon: { sheet: 'loadout', key: 'ranged', fallback: '➤' } }),
    combatNode({ id: 'flowRecovery', branch: 'mobility', tier: 2, fork: 'mobilityTechnique', exclusiveGroup: 'mobilityTechnique', name: 'Flow Recovery', description: 'Evading a shockwave during Dash reduces Dash cooldown by 0.4s.', requires: ['dashStrike'], position: { x: 405, y: 325 }, icon: { sheet: 'loadout', key: 'armor', fallback: '↻' } }),
    combatNode({ id: 'slipstream', branch: 'mobility', tier: 2, fork: 'mobilityTechnique', exclusiveGroup: 'mobilityTechnique', name: 'Slipstream', description: 'After Dashing, move faster for one second.', requires: ['dashStrike'], position: { x: 500, y: 325 }, icon: { sheet: 'loadout', key: 'ranged', fallback: '≈' } }),
    combatNode({ id: 'longstride', branch: 'mobility', tier: 2, fork: 'mobilityTechnique', exclusiveGroup: 'mobilityTechnique', name: 'Longstride', description: 'Dash lasts 40% longer, trading frequency for safer traversal.', requires: ['dashStrike'], position: { x: 595, y: 325 }, icon: { sheet: 'loadout', key: 'empty', fallback: '»' } }),
    combatNode({ id: 'afterimage', branch: 'mobility', tier: 3, capstone: true, name: 'Afterimage', description: 'Dashing creates a 1.5s projectile-decoy.', requires: ['flowRecovery'], position: { x: 405, y: 110 }, icon: { sheet: 'loadout', key: 'ranged', fallback: '◇' } }),
    combatNode({ id: 'phaseRush', branch: 'mobility', tier: 3, capstone: true, name: 'Phase Rush', description: 'Dashing through the boss staggers it once per Dash.', requires: ['slipstream'], position: { x: 500, y: 110 }, icon: { sheet: 'loadout', key: 'magic', fallback: '✧' } }),
    combatNode({ id: 'ghostStep', branch: 'mobility', tier: 3, capstone: true, name: 'Ghost Step', description: 'Remain invulnerable for 0.35s after Dash ends.', requires: ['longstride'], position: { x: 595, y: 110 }, icon: { sheet: 'loadout', key: 'empty', fallback: '◈' } }),

    combatNode({ id: 'fieldRation', branch: 'survival', tier: 1, name: 'Field Ration', description: 'Automatically consumes equipped Food below 35% HP.', requires: [], position: { x: 850, y: 540 }, icon: { sheet: 'resource', key: 'Smoked Rations', fallback: '♥' } }),
    combatNode({ id: 'secondWind', branch: 'survival', tier: 2, fork: 'survivalTechnique', exclusiveGroup: 'survivalTechnique', name: 'Second Wind', description: 'Once per run, lethal damage leaves you at 1 HP.', requires: ['fieldRation'], position: { x: 755, y: 325 }, icon: { sheet: 'loadout', key: 'armor', fallback: '↑' } }),
    combatNode({ id: 'guardedRecovery', branch: 'survival', tier: 2, fork: 'survivalTechnique', exclusiveGroup: 'survivalTechnique', name: 'Guarded Recovery', description: 'Successfully Dashing a shockwave restores 8 HP.', requires: ['fieldRation'], position: { x: 850, y: 325 }, icon: { sheet: 'loadout', key: 'armor', fallback: '⌁' } }),
    combatNode({ id: 'combatNutrition', branch: 'survival', tier: 2, fork: 'survivalTechnique', exclusiveGroup: 'survivalTechnique', name: 'Combat Nutrition', description: 'Consuming Food grants a barrier against the next damage instance.', requires: ['fieldRation'], position: { x: 945, y: 325 }, icon: { sheet: 'resource', key: 'Cooked Fish', fallback: '◆' } }),
    combatNode({ id: 'fortifiedRecovery', branch: 'survival', tier: 3, capstone: true, name: 'Fortified Recovery', description: 'Once per run, recover 25 HP after avoiding damage for 6s.', requires: ['secondWind'], position: { x: 755, y: 110 }, icon: { sheet: 'loadout', key: 'armor', fallback: '✚' } }),
    combatNode({ id: 'aegis', branch: 'survival', tier: 3, capstone: true, name: 'Aegis', description: 'A shockwave evade arms a barrier that prevents the next damage instance.', requires: ['guardedRecovery'], position: { x: 850, y: 110 }, icon: { sheet: 'loadout', key: 'armor', fallback: '⬡' } }),
    combatNode({ id: 'lastSupper', branch: 'survival', tier: 3, capstone: true, name: 'Last Supper', description: 'Combat Nutrition barriers absorb two damage instances instead of one.', requires: ['combatNutrition'], position: { x: 945, y: 110 }, icon: { sheet: 'resource', key: 'Smoked Rations', fallback: '♜' } })
  ],
  edges: [
    edge('openingAttack', 'pressure'), edge('openingAttack', 'counterforce'), edge('openingAttack', 'cadence'),
    edge('pressure', 'executioner'), edge('counterforce', 'reprisal'), edge('cadence', 'overdrive'),
    edge('dashStrike', 'flowRecovery'), edge('dashStrike', 'slipstream'), edge('dashStrike', 'longstride'),
    edge('flowRecovery', 'afterimage'), edge('slipstream', 'phaseRush'), edge('longstride', 'ghostStep'),
    edge('fieldRation', 'secondWind'), edge('fieldRation', 'guardedRecovery'), edge('fieldRation', 'combatNutrition'),
    edge('secondWind', 'fortifiedRecovery'), edge('guardedRecovery', 'aegis'), edge('combatNutrition', 'lastSupper')
  ]
};

function nodeMap(tree: SkillTreeDefinition): Map<string, SkillTreeNode> {
  return new Map(tree.nodes.map(node => [node.id, node]));
}

export function defaultSkillTreeView(): SkillTreeViewState {
  return { ...DEFAULT_VIEW };
}

export function createSkillTreeState(
  tree: SkillTreeDefinition,
  ownedNodeIds: readonly string[] = [],
  view: Partial<SkillTreeViewState> = {}
): SkillTreeState {
  const known = nodeMap(tree);
  const owned = [...new Set(ownedNodeIds)].filter(id => known.has(id));
  return {
    treeId: tree.id,
    ownedNodeIds: owned,
    view: {
      ...DEFAULT_VIEW,
      ...view,
      zoom: clampZoom(view.zoom ?? DEFAULT_VIEW.zoom),
      panX: Number.isFinite(view.panX) ? Number(view.panX) : DEFAULT_VIEW.panX,
      panY: Number.isFinite(view.panY) ? Number(view.panY) : DEFAULT_VIEW.panY,
      focusNodeId: view.focusNodeId && known.has(view.focusNodeId) ? view.focusNodeId : null,
      activeBranch: view.activeBranch && tree.branches.some(branch => branch.id === view.activeBranch) ? view.activeBranch : null
    }
  };
}

function clampZoom(value: number): number {
  return Math.max(0.55, Math.min(1.45, Number.isFinite(value) ? value : 1));
}

function nodeFor(tree: SkillTreeDefinition, nodeId: string): SkillTreeNode | undefined {
  return nodeMap(tree).get(nodeId);
}

function nodeExclusivity(node: SkillTreeNode): string | null {
  return node.exclusiveGroup || node.fork || (node.capstone ? 'capstone' : null);
}

export function skillTreeNodeState(tree: SkillTreeDefinition, state: SkillTreeState, nodeId: string): SkillTreeNodeState {
  if (state.ownedNodeIds.includes(nodeId)) return 'owned';
  const node = nodeFor(tree, nodeId);
  if (!node) return 'locked';
  if (!node.requires.every(id => state.ownedNodeIds.includes(id))) return 'locked';
  const group = nodeExclusivity(node);
  if (group && state.ownedNodeIds.some(id => id !== node.id && nodeExclusivity(nodeFor(tree, id)!) === group)) return 'locked';
  return 'available';
}

export interface SkillTreeAllocationResult {
  accepted: boolean;
  state: SkillTreeState;
  reason?: string;
}

export function canAllocateSkillTreeNode(
  tree: SkillTreeDefinition,
  state: SkillTreeState,
  nodeId: string,
  availablePoints: number
): { allowed: boolean; reason: string } {
  const node = nodeFor(tree, nodeId);
  if (!node) return { allowed: false, reason: 'Unknown node' };
  if (state.ownedNodeIds.includes(nodeId)) return { allowed: false, reason: 'Selected' };
  if (availablePoints < (node.cost ?? 1)) return { allowed: false, reason: 'No points available' };
  const missing = node.requires.filter(id => !state.ownedNodeIds.includes(id));
  if (missing.length) return { allowed: false, reason: 'Requires previous node' };
  const group = nodeExclusivity(node);
  if (group && state.ownedNodeIds.some(id => nodeExclusivity(nodeFor(tree, id)!) === group)) {
    return { allowed: false, reason: node.capstone ? 'Another capstone selected' : 'Other fork selected' };
  }
  return { allowed: true, reason: 'Available' };
}

export function allocateSkillTreeNode(
  tree: SkillTreeDefinition,
  state: SkillTreeState,
  nodeId: string,
  availablePoints: number
): SkillTreeAllocationResult {
  const result = canAllocateSkillTreeNode(tree, state, nodeId, availablePoints);
  if (!result.allowed) return { accepted: false, state, reason: result.reason };
  return {
    accepted: true,
    state: {
      ...state,
      ownedNodeIds: [...state.ownedNodeIds, nodeId],
      view: { ...state.view, focusNodeId: nodeId }
    }
  };
}

export function resetSkillTreeState(state: SkillTreeState): SkillTreeState {
  return { ...state, ownedNodeIds: [], view: { ...state.view, focusNodeId: null } };
}

/** Normalizes legacy IDs without dropping valid prerequisites or exceeding earned points. */
export function normalizeSkillTreeNodeIds(
  tree: SkillTreeDefinition,
  ids: readonly string[],
  earnedPoints: number
): string[] {
  const candidates = new Set(ids);
  let normalized = createSkillTreeState(tree);
  let changed = true;
  while (changed && normalized.ownedNodeIds.length < earnedPoints) {
    changed = false;
    for (const node of tree.nodes) {
      if (!candidates.has(node.id) || normalized.ownedNodeIds.includes(node.id)) continue;
      const allocation = allocateSkillTreeNode(tree, normalized, node.id, earnedPoints - normalized.ownedNodeIds.length);
      if (!allocation.accepted) continue;
      normalized = allocation.state;
      changed = true;
    }
  }
  return [...normalized.ownedNodeIds];
}

export function skillTreeBranchProgress(tree: SkillTreeDefinition, state: SkillTreeState, branchId: string): { owned: number; total: number } {
  const nodes = tree.nodes.filter(node => node.branch === branchId);
  return { owned: nodes.filter(node => state.ownedNodeIds.includes(node.id)).length, total: nodes.length };
}
