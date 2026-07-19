import { describe, expect, it } from 'vitest';
import {
  COMBAT_SKILL_TREE,
  allocateSkillTreeNode,
  canAllocateSkillTreeNode,
  createSkillTreeState,
  normalizeSkillTreeNodeIds,
  resetSkillTreeState,
  skillTreeNodeState
} from '../src/game/skills/skill-trees';

describe('Combat Skill Tree', () => {
  it('keeps the legacy Combat Discipline IDs as a reusable graph definition', () => {
    expect(COMBAT_SKILL_TREE.nodes).toHaveLength(21);
    expect(COMBAT_SKILL_TREE.rootNodeIds).toEqual(['openingAttack', 'dashStrike', 'fieldRation']);
    expect(COMBAT_SKILL_TREE.nodes.every(node => node.skillId === 'Combat' && node.effectIds?.includes(node.id))).toBe(true);
    expect(COMBAT_SKILL_TREE.edges).toHaveLength(18);
  });

  it('blocks prerequisites, then exposes the next node as available', () => {
    const initial = createSkillTreeState(COMBAT_SKILL_TREE);
    expect(skillTreeNodeState(COMBAT_SKILL_TREE, initial, 'pressure')).toBe('locked');
    expect(canAllocateSkillTreeNode(COMBAT_SKILL_TREE, initial, 'pressure', 1)).toEqual({
      allowed: false,
      reason: 'Requires previous node'
    });

    const root = allocateSkillTreeNode(COMBAT_SKILL_TREE, initial, 'openingAttack', 1);
    expect(root.accepted).toBe(true);
    expect(skillTreeNodeState(COMBAT_SKILL_TREE, root.state, 'pressure')).toBe('available');
  });

  it('enforces one fork and one capstone across the whole Combat tree', () => {
    let state = createSkillTreeState(COMBAT_SKILL_TREE, ['openingAttack', 'pressure']);
    expect(canAllocateSkillTreeNode(COMBAT_SKILL_TREE, state, 'counterforce', 1)).toEqual({
      allowed: false,
      reason: 'Other fork selected'
    });

    state = createSkillTreeState(COMBAT_SKILL_TREE, ['openingAttack', 'pressure', 'dashStrike', 'slipstream']);
    expect(canAllocateSkillTreeNode(COMBAT_SKILL_TREE, state, 'phaseRush', 1).allowed).toBe(true);
    state = createSkillTreeState(COMBAT_SKILL_TREE, ['openingAttack', 'pressure', 'executioner', 'dashStrike', 'slipstream']);
    expect(canAllocateSkillTreeNode(COMBAT_SKILL_TREE, state, 'phaseRush', 1)).toEqual({
      allowed: false,
      reason: 'Another capstone selected'
    });
  });

  it('resets allocations without losing the stored view state', () => {
    const state = createSkillTreeState(COMBAT_SKILL_TREE, ['openingAttack'], { zoom: 1.2, panX: 40, focusNodeId: 'openingAttack' });
    const reset = resetSkillTreeState(state);
    expect(reset.ownedNodeIds).toEqual([]);
    expect(reset.view).toMatchObject({ zoom: 1.2, panX: 40, focusNodeId: null });
  });

  it('normalizes legacy saved IDs without invalidating valid progress', () => {
    const legacyIds = ['phaseRush', 'slipstream', 'dashStrike', 'phaseRush', 'counterforce', 'openingAttack', 'reprisal', 'overdrive', 'cadence'];
    expect(normalizeSkillTreeNodeIds(COMBAT_SKILL_TREE, legacyIds, 5)).toEqual([
      'openingAttack',
      'counterforce',
      'reprisal',
      'dashStrike',
      'slipstream'
    ]);
    expect(normalizeSkillTreeNodeIds(COMBAT_SKILL_TREE, ['openingAttack', 'pressure', 'executioner', 'reprisal'], 4)).toEqual([
      'openingAttack',
      'pressure',
      'executioner'
    ]);
  });
});
