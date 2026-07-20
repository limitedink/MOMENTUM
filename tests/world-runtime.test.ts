import { describe, expect, it } from 'vitest';
import { FRONTIER_REGION } from '../src/game/world/world-definitions';
import { createInitialWorldState, createWorldRuntime, migrateWorldState, normalizeWorldState } from '../src/game/world/world-runtime';
import type { WorldRequirement } from '../src/game/world/world-types';

function runtimeWithRequirements(met = true) {
  return createWorldRuntime(FRONTIER_REGION, createInitialWorldState(FRONTIER_REGION, 1), {
    now: () => 1,
    createRunId: () => 'world-test-run',
    evaluateRequirements: (requirements: readonly WorldRequirement[]) => ({
      met,
      missing: met ? [] : requirements.map(requirement => requirement.type === 'skillLevel' ? `${requirement.skillId} ${requirement.level}` : requirement.type === 'resource' ? `${requirement.amount} ${requirement.resourceId}` : 'Combat loadout')
    })
  });
}

describe('frontier world runtime', () => {
  it('starts at a safe outpost and blocks a route with missing preparation', () => {
    const runtime = runtimeWithRequirements(false);
    expect(runtime.getState().status).toBe('outpost');
    expect(runtime.getState().completedNodeIds).toEqual(['frontier-outpost']);
    expect(runtime.startRun().accepted).toBe(true);
    expect(runtime.selectRoute('timberline').accepted).toBe(true);
    const blocked = runtime.beginEncounter();
    expect(blocked.accepted).toBe(false);
    expect(blocked.reason).toContain('Woodcutting 2');
    expect(runtime.getState().status).toBe('ready');
  });

  it('resolves a route, advances to the finale, and claims rewards idempotently', () => {
    const runtime = runtimeWithRequirements(true);
    runtime.startRun();
    runtime.selectRoute('ironworks');
    const started = runtime.beginEncounter();
    expect(started.accepted).toBe(true);
    expect(runtime.resolveEncounter({ runId: 'world-test-run', encounterId: 'ironworks-repair', success: true, seed: 42 }).accepted).toBe(true);
    expect(runtime.getState().status).toBe('reward');

    const claimed = runtime.claimReward();
    expect(claimed.accepted).toBe(true);
    expect(runtime.getState().currentNodeId).toBe('vanguard-gate');
    expect(runtime.getState().mastery['route-ironworks']).toBe(1);
    expect(runtime.claimReward().accepted).toBe(false);

    expect(runtime.beginEncounter('timberline-supply').accepted).toBe(false);
    expect(runtime.beginEncounter().accepted).toBe(true);
    runtime.resolveEncounter({ runId: 'world-test-run', encounterId: 'vanguard-gate', success: true });
    const finaleReward = runtime.claimReward();
    expect(finaleReward.accepted).toBe(true);
    expect(runtime.getState().status).toBe('complete');
    expect(runtime.getState().currentNodeId).toBe('frontier-outpost');
    expect(runtime.getState().mastery['vanguard-clear']).toBe(1);
  });

  it('returns safely from failure, abandonment, and cancellation', () => {
    const runtime = runtimeWithRequirements(true);
    runtime.startRun();
    runtime.selectRoute('broken-watch');
    runtime.beginEncounter();
    expect(runtime.resolveEncounter({ runId: 'world-test-run', encounterId: 'broken-watch-scout', success: false }).accepted).toBe(true);
    expect(runtime.getState().status).toBe('failed');
    expect(runtime.getState().pendingReward).toBeNull();

    runtime.startRun();
    runtime.selectRoute('timberline');
    runtime.beginEncounter();
    expect(runtime.cancelEncounter().accepted).toBe(true);
    expect(runtime.getState().status).toBe('ready');
    expect(runtime.getState().activeEncounterId).toBeNull();
    expect(runtime.abandonRun().accepted).toBe(true);
    expect(runtime.getState().lastOutcome).toBe('abandoned');
  });

  it('normalizes malformed save state without losing the safe outpost', () => {
    const normalized = normalizeWorldState(FRONTIER_REGION, {
      status: 'in_encounter',
      currentNodeId: 'not-a-node',
      selectedRouteId: 'not-a-route',
      activeEncounterId: 'not-an-encounter',
      completedNodeIds: ['not-a-node'],
      mastery: { 'route-ironworks': 3 },
      routeHistory: ['timberline', 'not-a-route']
    }, 99);
    expect(normalized.status).toBe('ready');
    expect(normalized.currentNodeId).toBe('frontier-outpost');
    expect(normalized.completedNodeIds).toEqual(['frontier-outpost']);
    expect(normalized.selectedRouteId).toBeNull();
    expect(normalized.activeEncounterId).toBeNull();
    expect(normalized.mastery['route-ironworks']).toBe(3);
    expect(normalized.routeHistory).toEqual(['timberline']);
  });

  it('migrates a version 14 save into a fresh outpost without touching personal systems', () => {
    const migrated = migrateWorldState(FRONTIER_REGION, 14, {
      status: 'complete',
      currentNodeId: 'vanguard-gate',
      completedEncounterIds: ['vanguard-gate']
    }, 1234);
    expect(migrated.status).toBe('outpost');
    expect(migrated.currentNodeId).toBe('frontier-outpost');
    expect(migrated.completedEncounterIds).toEqual([]);
    expect(migrated.lastUpdatedAt).toBe(1234);
  });
});
