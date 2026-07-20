import type {
  PendingWorldReward,
  RegionDefinition,
  WorldActionResult,
  WorldEncounterDefinition,
  WorldOutcome,
  WorldRequirement,
  WorldRuntimeOptions,
  WorldState
} from './world-types';

const DEFAULT_NOW = () => Date.now();
let runSequence = 0;

export function createInitialWorldState(region: RegionDefinition, now = Date.now()): WorldState {
  return {
    version: 1,
    regionId: region.id,
    runId: null,
    status: 'outpost',
    currentNodeId: region.outpostNodeId,
    selectedRouteId: null,
    activeEncounterId: null,
    lastSafeNodeId: region.outpostNodeId,
    completedNodeIds: [region.outpostNodeId],
    completedEncounterIds: [],
    mastery: Object.fromEntries(region.mastery.map(item => [item.id, 0])),
    routeHistory: [],
    pendingReward: null,
    claimedRewardIds: [],
    lastOutcome: null,
    lastUpdatedAt: now
  };
}

export function migrateWorldState(region: RegionDefinition, saveVersion: number, value: unknown, now = Date.now()): WorldState {
  return saveVersion >= 15 ? normalizeWorldState(region, value, now) : createInitialWorldState(region, now);
}

export function normalizeWorldState(region: RegionDefinition, value: unknown, now = Date.now()): WorldState {
  const initial = createInitialWorldState(region, now);
  if (!value || typeof value !== 'object') return initial;
  const candidate = value as Partial<WorldState>;
  const nodeIds = new Set(region.nodes.map(node => node.id));
  const encounterIds = new Set(region.encounters.map(encounter => encounter.id));
  const routeIds = new Set(region.routes.map(route => route.id));
  const status = ['outpost', 'ready', 'in_encounter', 'reward', 'complete', 'failed'].includes(String(candidate.status))
    ? candidate.status as WorldState['status']
    : initial.status;
  const pending = candidate.pendingReward && typeof candidate.pendingReward === 'object'
    ? candidate.pendingReward as PendingWorldReward
    : null;
  const normalizedActiveEncounterId = status === 'in_encounter' && encounterIds.has(String(candidate.activeEncounterId))
    ? String(candidate.activeEncounterId)
    : null;
  const normalizedPendingReward = pending && typeof pending.id === 'string' && typeof pending.runId === 'string' ? pending : null;
  const normalizedStatus = normalizedPendingReward ? 'reward'
    : status === 'in_encounter' && !normalizedActiveEncounterId ? 'ready'
      : status === 'reward' ? 'ready' : status;
  return {
    ...initial,
    ...candidate,
    regionId: region.id,
    status: normalizedStatus,
    runId: typeof candidate.runId === 'string' ? candidate.runId : null,
    currentNodeId: nodeIds.has(String(candidate.currentNodeId)) ? String(candidate.currentNodeId) : initial.currentNodeId,
    selectedRouteId: candidate.selectedRouteId && routeIds.has(candidate.selectedRouteId) ? candidate.selectedRouteId : null,
    activeEncounterId: normalizedActiveEncounterId,
    lastSafeNodeId: nodeIds.has(String(candidate.lastSafeNodeId)) ? String(candidate.lastSafeNodeId) : initial.lastSafeNodeId,
    completedNodeIds: Array.isArray(candidate.completedNodeIds)
      ? [...new Set([region.outpostNodeId, ...candidate.completedNodeIds.filter(id => nodeIds.has(id))])]
      : [region.outpostNodeId],
    completedEncounterIds: Array.isArray(candidate.completedEncounterIds) ? candidate.completedEncounterIds.filter(id => encounterIds.has(id)) : [],
    mastery: Object.fromEntries(region.mastery.map(item => [item.id, Math.max(0, Number(candidate.mastery?.[item.id]) || 0)])),
    routeHistory: Array.isArray(candidate.routeHistory) ? candidate.routeHistory.filter(id => routeIds.has(id)) : [],
    pendingReward: normalizedPendingReward,
    claimedRewardIds: Array.isArray(candidate.claimedRewardIds) ? candidate.claimedRewardIds.filter(id => typeof id === 'string') : [],
    lastOutcome: ['success', 'failure', 'abandoned'].includes(String(candidate.lastOutcome)) ? candidate.lastOutcome as WorldState['lastOutcome'] : null,
    lastUpdatedAt: Number(candidate.lastUpdatedAt) || now
  };
}

function result(state: WorldState, accepted: boolean, reason?: string, encounter?: WorldEncounterDefinition): WorldActionResult {
  return { accepted, state, reason, encounter, pendingReward: state.pendingReward };
}

export function createWorldRuntime(
  region: RegionDefinition,
  initialState: WorldState = createInitialWorldState(region),
  options: WorldRuntimeOptions = {}
) {
  const now = options.now || DEFAULT_NOW;
  const createRunId = options.createRunId || (() => `world-run-${now()}-${++runSequence}`);
  let state = normalizeWorldState(region, initialState, now());

  const encounterById = (id: string | null) => id ? region.encounters.find(encounter => encounter.id === id) : undefined;
  const nodeById = (id: string) => region.nodes.find(node => node.id === id);
  const routeById = (id: string | null) => id ? region.routes.find(route => route.id === id) : undefined;
  const evaluate = (requirements: readonly WorldRequirement[]) => options.evaluateRequirements?.(requirements, state) || { met: true, missing: [] };
  const commit = (next: WorldState) => { state = { ...next, lastUpdatedAt: now() }; return state; };

  function getState(): WorldState { return state; }
  function getRegion(): RegionDefinition { return region; }

  function startRun(): WorldActionResult {
    if (!['outpost', 'complete', 'failed'].includes(state.status)) return result(state, false, 'Finish or abandon the current adventure first.');
    const runId = createRunId();
    commit({
      ...state,
      runId,
      status: 'ready',
      currentNodeId: region.outpostNodeId,
      lastSafeNodeId: region.outpostNodeId,
      selectedRouteId: null,
      activeEncounterId: null,
      pendingReward: null,
      lastOutcome: null
    });
    return result(state, true);
  }

  function selectRoute(routeId: string): WorldActionResult {
    const route = routeById(routeId);
    if (!route) return result(state, false, 'Unknown frontier route.');
    if (!['ready', 'outpost'].includes(state.status)) return result(state, false, 'Choose a route when the adventure is ready.');
    if (state.currentNodeId !== region.outpostNodeId) return result(state, false, 'The next encounter at this node must be resolved first.');
    if (!state.runId) {
      const started = startRun();
      if (!started.accepted) return started;
    }
    commit({ ...state, status: 'ready', selectedRouteId: route.id, routeHistory: [...state.routeHistory, route.id] });
    return result(state, true, undefined, encounterById(route.encounterId));
  }

  function beginEncounter(encounterId?: string): WorldActionResult {
    const currentNodeEncounterId = nodeById(state.currentNodeId)?.encounterId;
    const encounter = encounterById(
      encounterId ||
      currentNodeEncounterId ||
      (state.selectedRouteId && routeById(state.selectedRouteId)?.encounterId) ||
      state.activeEncounterId
    );
    if (!encounter) return result(state, false, 'No encounter is available at this node.');
    if (!state.runId) return result(state, false, 'Start an adventure before entering an encounter.');
    if (!['ready', 'outpost'].includes(state.status)) return result(state, false, 'Resolve the current encounter first.');
    if (encounter.routeId !== 'finale' && state.selectedRouteId !== encounter.routeId) return result(state, false, 'Select this route before entering it.', encounter);
    const encounterNode = region.nodes.find(node => node.encounterId === encounter.id);
    const isFinale = encounter.routeId === 'finale';
    if (isFinale ? encounterNode?.id !== state.currentNodeId : state.currentNodeId !== region.outpostNodeId) {
      return result(state, false, 'That encounter is not available from the current node.', encounter);
    }
    const requirements = evaluate(encounter.requirements || []);
    if (!requirements.met) return result(state, false, `Missing ${requirements.missing.join(' · ')}`, encounter);
    commit({ ...state, status: 'in_encounter', activeEncounterId: encounter.id });
    return result(state, true, undefined, encounter);
  }

  function resolveEncounter(outcome: WorldOutcome): WorldActionResult {
    const encounter = encounterById(outcome.encounterId);
    if (!encounter) return result(state, false, 'Unknown encounter.');
    if (state.runId !== outcome.runId || state.activeEncounterId !== encounter.id || state.status !== 'in_encounter') {
      return result(state, false, 'This encounter is no longer active.', encounter);
    }
    if (!outcome.success) {
      commit({
        ...state,
        status: 'failed',
        activeEncounterId: null,
        selectedRouteId: null,
        pendingReward: null,
        lastOutcome: 'failure'
      });
      return result(state, true, undefined, encounter);
    }
    const rewardId = `${outcome.runId}:${encounter.id}`;
    const completesRegion = encounter.nextNodeId === region.outpostNodeId;
    const pendingReward: PendingWorldReward = {
      id: rewardId,
      runId: outcome.runId,
      encounterId: encounter.id,
      reward: encounter.reward,
      nextNodeId: encounter.nextNodeId,
      completesRegion
    };
    commit({
      ...state,
      status: 'reward',
      activeEncounterId: null,
      pendingReward,
      lastOutcome: 'success'
    });
    return result(state, true, undefined, encounter);
  }

  function claimReward(rewardId?: string): WorldActionResult {
    const pending = state.pendingReward;
    if (!pending) return result(state, false, 'There is no frontier reward waiting.');
    if (rewardId && rewardId !== pending.id) return result(state, false, 'That frontier reward is no longer pending.');
    if (state.claimedRewardIds.includes(pending.id)) return result(state, false, 'That frontier reward was already claimed.');
    const nextNode = nodeById(pending.nextNodeId) || nodeById(region.outpostNodeId)!;
    const mastery = { ...state.mastery };
    if (pending.completesRegion) mastery['vanguard-clear'] = Math.min(1, (mastery['vanguard-clear'] || 0) + (pending.reward.mastery || 1));
    const routeMastery = pending.encounterId === 'timberline-supply' ? 'route-timberline'
      : pending.encounterId === 'ironworks-repair' ? 'route-ironworks'
      : pending.encounterId === 'broken-watch-scout' ? 'route-watch' : null;
    if (routeMastery) mastery[routeMastery] = Math.min(1, (mastery[routeMastery] || 0) + 1);
    const completeEncounterIds = state.completedEncounterIds.includes(pending.encounterId)
      ? state.completedEncounterIds
      : [...state.completedEncounterIds, pending.encounterId];
    const completeNodeIds = state.completedNodeIds.includes(nextNode.id)
      ? state.completedNodeIds
      : [...state.completedNodeIds, nextNode.id];
    commit({
      ...state,
      status: pending.completesRegion ? 'complete' : 'ready',
      currentNodeId: nextNode.id,
      lastSafeNodeId: nextNode.safe ? nextNode.id : state.lastSafeNodeId,
      selectedRouteId: pending.completesRegion ? null : state.selectedRouteId,
      pendingReward: null,
      completedEncounterIds: completeEncounterIds,
      completedNodeIds: completeNodeIds,
      mastery,
      claimedRewardIds: [...state.claimedRewardIds, pending.id]
    });
    return result(state, true, undefined, encounterById(pending.encounterId));
  }

  function abandonRun(): WorldActionResult {
    if (state.status === 'outpost') return result(state, false, 'No active adventure to abandon.');
    commit({
      ...state,
      runId: null,
      status: 'failed',
      currentNodeId: state.lastSafeNodeId || region.outpostNodeId,
      selectedRouteId: null,
      activeEncounterId: null,
      pendingReward: null,
      lastOutcome: 'abandoned'
    });
    return result(state, true);
  }

  function cancelEncounter(): WorldActionResult {
    if (state.status !== 'in_encounter' || !state.activeEncounterId) {
      return result(state, false, 'There is no active encounter to cancel.');
    }
    commit({
      ...state,
      status: 'ready',
      activeEncounterId: null,
      pendingReward: null,
      lastOutcome: null
    });
    return result(state, true);
  }

  function hydrate(nextState: unknown): WorldActionResult {
    commit(normalizeWorldState(region, nextState, now()));
    return result(state, true);
  }

  return Object.freeze({ getState, getRegion, startRun, selectRoute, beginEncounter, resolveEncounter, claimReward, abandonRun, cancelEncounter, hydrate });
}
