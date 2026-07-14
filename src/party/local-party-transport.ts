import {
  COMMAND_TYPES,
  CONNECTION_STATES,
  DEFINITIONS,
  clone,
  createCommandResult,
  isCommandEnvelope
} from './party-transport';
import type {
  ClaimedReward,
  ConnectionState,
  ContributionSummary,
  PartyCommand,
  PartyCommandResult,
  PartyEvent,
  PartyMember,
  PartySnapshot,
  PendingReward,
  MomentumPartyTransport
} from './party-types';

declare const woodInventory: { pine: number } | undefined;
declare const skills: Array<{ id: string; qty: number; lvl: number }> | undefined;
declare function saveGame(): void;

const STORAGE_KEY = 'momentum-taskbar-party-v1';
const TICK_MS = 2000;
const DEFAULT_COMMAND_DELAY_MS = 120;
const DEFAULT_CONNECT_DELAY_MS = 0;

type LocalStorageLike = {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
};

type LocalTransportOptions = {
  commandDelay?: number;
  connectDelay?: number;
  storage?: LocalStorageLike;
};

type LocalPartyState = {
  version: 1;
  elapsedTicks: number;
  lastResolvedAt: number;
  lastConfirmedAt: number;
  revision: number;
  completedExpeditions: number;
  expeditionStatus: 'active' | 'paused' | 'ready';
  lanes: { threat: number; timber: number; supplies: number };
  pendingRewards: PendingReward | null;
  claimedRewards: ClaimedReward[];
  lastContributions: ContributionSummary[] | null;
  party: PartyMember[];
  ledger: PartyEvent[];
  notable: string[];
};

type LocalPartySave = LocalPartyState;
type RawRecord = Record<string, unknown>;
type CommandProcessResult = { ok: true } | { ok: false; code: string; message: string };
type LocalTransport = MomentumPartyTransport & {
  resolveElapsed(): number;
  simulateTick(): boolean;
};

const DEFAULT_PARTY: PartyMember[] = [
  { id: 'player', name: 'You', type: 'human', affinity: 'balanced', activity: 'forest_patrol', efficiency: 1, lastActivityTick: 0, totals: { threat: 0, timber: 0, supplies: 0 } },
  { id: 'faith', name: 'Faith', type: 'ghost', affinity: 'timber', activity: 'pine_chopping', efficiency: 1.2, lastActivityTick: 0, totals: { threat: 0, timber: 0, supplies: 0 } },
  { id: 'sofia', name: 'Sofia', type: 'ghost', affinity: 'supplies', activity: 'camp_cooking', efficiency: 0.9, lastActivityTick: 0, totals: { threat: 0, timber: 0, supplies: 0 } },
  { id: 'maya', name: 'Maya', type: 'ghost', affinity: 'patrol', activity: 'forest_patrol', efficiency: 0.8, lastActivityTick: 0, totals: { threat: 0, timber: 0, supplies: 0 } }
];

function isRecord(value: unknown): value is RawRecord {
  return typeof value === 'object' && value !== null;
}

function numberOr(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function nonNegativeInteger(value: unknown, fallback: number): number {
  return Math.max(0, Math.floor(numberOr(value, fallback)));
}

function activityIsValid(value: unknown): value is PartyMember['activity'] {
  return typeof value === 'string' && value in DEFINITIONS.activities;
}

function cloneDefaultParty(): PartyMember[] {
  return clone(DEFAULT_PARTY);
}

function createDefaultState(): LocalPartyState {
  return {
    version: 1,
    elapsedTicks: 0,
    lastResolvedAt: Date.now(),
    lastConfirmedAt: Date.now(),
    revision: 0,
    completedExpeditions: 0,
    expeditionStatus: 'active',
    lanes: { threat: 0, timber: 0, supplies: 0 },
    pendingRewards: null,
    claimedRewards: [],
    lastContributions: null,
    party: cloneDefaultParty(),
    ledger: [],
    notable: []
  };
}

function rewardId(value: unknown): string {
  if (isRecord(value) && typeof value.id === 'string' && value.id.length > 0) return value.id;
  return `forest-expedition-${isRecord(value) ? nonNegativeInteger(value.expedition, 0) : 0}`;
}

function normalizeReward(value: unknown): PendingReward | null {
  if (!isRecord(value)) return null;
  return {
    id: rewardId(value),
    expedition: nonNegativeInteger(value.expedition, 0),
    pineLogs: Math.max(0, numberOr(value.pineLogs, 0)),
    cookedFish: Math.max(0, numberOr(value.cookedFish, 0))
  };
}

function normalizeClaimedRewards(value: unknown): ClaimedReward[] {
  if (!Array.isArray(value)) return [];
  return value.map(item => {
    const reward = normalizeReward(item);
    return reward ? { ...reward, claimedAt: isRecord(item) ? numberOr(item.claimedAt, 0) : 0 } : null;
  }).filter((reward): reward is ClaimedReward => reward !== null).slice(0, 30);
}

function normalizeMember(value: unknown, fallback: PartyMember): PartyMember {
  const raw = isRecord(value) ? value : {};
  const legacyId = raw.id === 'alex' ? 'sofia' : raw.id === 'rowan' ? 'maya' : raw.id;
  const fallbackById = DEFAULT_PARTY.find(candidate => candidate.id === legacyId) || fallback;
  const totals = isRecord(raw.totals) ? raw.totals : {};
  return {
    ...clone(fallbackById),
    ...raw,
    id: typeof legacyId === 'string' ? legacyId : fallbackById.id,
    name: raw.name === 'Alex' || legacyId === 'sofia' ? 'Sofia' : raw.name === 'Rowan' || legacyId === 'maya' ? 'Maya' : typeof raw.name === 'string' ? raw.name : fallbackById.name,
    type: typeof raw.type === 'string' ? raw.type : fallbackById.type,
    affinity: typeof raw.affinity === 'string' ? raw.affinity : fallbackById.affinity,
    activity: activityIsValid(raw.activity) ? raw.activity : fallbackById.activity,
    efficiency: numberOr(raw.efficiency, fallbackById.efficiency),
    lastActivityTick: nonNegativeInteger(raw.lastActivityTick, 0),
    totals: {
      threat: numberOr(totals.threat, fallbackById.totals.threat),
      timber: numberOr(totals.timber, fallbackById.totals.timber),
      supplies: numberOr(totals.supplies, fallbackById.totals.supplies)
    }
  };
}

export function normalizePartySave(value: unknown): LocalPartySave {
  const defaults = createDefaultState();
  const raw = isRecord(value) ? value : {};
  const rawParty = Array.isArray(raw.party) ? raw.party : [];
  const party = rawParty.length > 0
    ? rawParty.map((member, index) => normalizeMember(member, DEFAULT_PARTY[index] || DEFAULT_PARTY[0]))
    : cloneDefaultParty();
  if (!party.some(member => member.id === 'player')) party.unshift(clone(DEFAULT_PARTY[0]));

  const claimedRewards = normalizeClaimedRewards(raw.claimedRewards);
  const claimedIds = new Set(claimedRewards.map(reward => reward.id));
  const pendingRewards = normalizeReward(raw.pendingRewards);
  const lanes = isRecord(raw.lanes) ? raw.lanes : {};
  const expeditionStatus = raw.expeditionStatus === 'paused' || raw.expeditionStatus === 'ready' ? raw.expeditionStatus : 'active';
  const ledger = Array.isArray(raw.ledger) ? raw.ledger.filter(isRecord).slice(0, 30).map(event => ({
    text: typeof event.text === 'string' ? event.text : '',
    tick: nonNegativeInteger(event.tick, 0),
    at: numberOr(event.at, Date.now())
  })) : [];
  const notable = Array.isArray(raw.notable) ? raw.notable.filter((item): item is string => typeof item === 'string').slice(0, 10) : [];
  const lastContributions = Array.isArray(raw.lastContributions) ? raw.lastContributions.filter(isRecord).slice(0, 30).map(item => ({
    id: typeof item.id === 'string' ? item.id : 'unknown',
    name: typeof item.name === 'string' ? item.name : 'Party member',
    activity: activityIsValid(item.activity) ? item.activity : 'rest',
    total: numberOr(item.total, 0)
  })) : null;

  return {
    ...defaults,
    revision: nonNegativeInteger(raw.revision, 0),
    elapsedTicks: nonNegativeInteger(raw.elapsedTicks, 0),
    lastResolvedAt: numberOr(raw.lastResolvedAt, Date.now()),
    lastConfirmedAt: numberOr(raw.lastConfirmedAt, Date.now()),
    completedExpeditions: nonNegativeInteger(raw.completedExpeditions, 0),
    expeditionStatus,
    lanes: {
      threat: numberOr(lanes.threat, 0),
      timber: numberOr(lanes.timber, 0),
      supplies: numberOr(lanes.supplies, 0)
    },
    pendingRewards: pendingRewards && !claimedIds.has(pendingRewards.id) ? pendingRewards : null,
    claimedRewards,
    lastContributions,
    party,
    ledger,
    notable
  };
}

function loadState(storage: LocalStorageLike): LocalPartyState {
  try {
    const stored = storage.getItem(STORAGE_KEY);
    return normalizePartySave(stored ? JSON.parse(stored) as unknown : null);
  } catch {
    return createDefaultState();
  }
}

function persistState(state: LocalPartyState, storage: LocalStorageLike): void {
  try {
    storage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    // The local simulation remains usable in memory if storage is unavailable.
  }
}

function memberSnapshot(member: PartyMember): PartyMember {
  return {
    ...member,
    totals: { ...member.totals }
  };
}

function buildSnapshot(state: LocalPartyState): PartySnapshot {
  const generatedAt = Date.now();
  const members = state.party.map(memberSnapshot);
  const contributions = members.reduce<Record<string, Record<string, number>>>((result, member) => {
    result[member.id] = { ...member.totals };
    return result;
  }, {});
  const pendingRewards = state.pendingRewards ? { ...state.pendingRewards } : null;
  const claimedRewards = state.claimedRewards.map(reward => ({ ...reward }));
  const lastContributions = state.lastContributions ? state.lastContributions.map(contribution => ({ ...contribution })) : null;
  const recentEvents = state.ledger.map(event => ({ ...event }));
  return {
    revision: state.revision,
    generatedAt,
    connection: { status: CONNECTION_STATES.CONNECTED, lastConfirmedAt: state.lastConfirmedAt || generatedAt },
    party: { id: 'local-party', members },
    expedition: {
      status: state.expeditionStatus,
      completedExpeditions: state.completedExpeditions,
      lanes: { ...state.lanes },
      contributions,
      lastContributions,
      pendingRewards,
      claimedRewards
    },
    recentEvents,
    notable: [...state.notable],
    elapsedTicks: state.elapsedTicks,
    lastResolvedAt: state.lastResolvedAt,
    expeditionStatus: state.expeditionStatus,
    completedExpeditions: state.completedExpeditions,
    lanes: { ...state.lanes },
    partyMembers: members,
    pendingRewards,
    claimedRewards,
    lastContributions
  };
}

function rewardDescription(reward: PendingReward): string {
  return `+${reward.pineLogs} Pine Logs · +${reward.cookedFish} Cooked Fish`;
}

export function createLocalMomentumPartyTransport(options: LocalTransportOptions = {}): LocalTransport {
  const commandDelay = Math.max(0, Number(options.commandDelay) || DEFAULT_COMMAND_DELAY_MS);
  const connectDelay = Math.max(0, Number(options.connectDelay) || DEFAULT_CONNECT_DELAY_MS);
  const storage = options.storage || globalThis.localStorage;
  const state = loadState(storage);
  const snapshotListeners = new Set<(snapshot: PartySnapshot) => void>();
  const connectionListeners = new Set<(status: ConnectionState) => void>();
  const resultListeners = new Set<(result: PartyCommandResult) => void>();
  const commandTimers = new Map<ReturnType<typeof setTimeout>, PartyCommand | null>();
  let connection: ConnectionState = CONNECTION_STATES.DISCONNECTED;
  let hasConnected = false;
  let destroyed = false;
  let connectTimer: ReturnType<typeof setTimeout> | null = null;
  let tickTimer: ReturnType<typeof setInterval> | null = null;

  function notifyConnection(nextState: ConnectionState): void {
    if (connection === nextState) return;
    connection = nextState;
    state.lastConfirmedAt = Date.now();
    connectionListeners.forEach(listener => listener(connection));
  }

  function notifySnapshot(snapshot: PartySnapshot): void {
    state.lastConfirmedAt = Date.now();
    snapshotListeners.forEach(listener => listener(clone(snapshot)));
  }

  function notifyResult(result: PartyCommandResult): void {
    resultListeners.forEach(listener => listener(clone(result)));
  }

  function isConnected(): boolean {
    return connection === CONNECTION_STATES.CONNECTED;
  }

  function clearTimer(timer: ReturnType<typeof setTimeout> | null): void {
    if (timer) clearTimeout(timer);
    if (timer) commandTimers.delete(timer);
  }

  function stopTickLoop(): void {
    if (tickTimer) clearInterval(tickTimer);
    tickTimer = null;
  }

  function startTickLoop(): void {
    stopTickLoop();
    tickTimer = setInterval(() => {
      if (isConnected()) simulateTick();
    }, TICK_MS);
  }

  function addEvent(text: string, notable = false): void {
    state.ledger.unshift({ text, tick: state.elapsedTicks, at: Date.now() });
    state.ledger = state.ledger.slice(0, 30);
    if (notable) {
      state.notable.unshift(text);
      state.notable = state.notable.slice(0, 10);
    }
  }

  function hasClaimedReward(id: string): boolean {
    return state.claimedRewards.some(reward => reward.id === id);
  }

  function grantReward(reward: PendingReward): boolean {
    try {
      if (typeof woodInventory !== 'undefined') woodInventory.pine += reward.pineLogs;
      if (typeof skills !== 'undefined') {
        const cooking = skills.find(skill => skill.id === 'Cooking');
        if (cooking) cooking.qty += reward.cookedFish;
      }
      if (typeof saveGame === 'function') saveGame();
      return true;
    } catch {
      return false;
    }
  }

  function commitAuthoritativeState(): PartySnapshot {
    state.revision += 1;
    state.lastConfirmedAt = Date.now();
    state.lastResolvedAt = Date.now();
    persistState(state, storage);
    return buildSnapshot(state);
  }

  function forceFreshSnapshot(): PartySnapshot {
    state.revision += 1;
    state.lastConfirmedAt = Date.now();
    state.lastResolvedAt = Date.now();
    persistState(state, storage);
    return buildSnapshot(state);
  }

  function updateGhostActivities(): void {
    state.party.filter(member => member.type === 'ghost').forEach(member => {
      const cycleLength = member.affinity === 'timber' ? 18 : member.affinity === 'supplies' ? 22 : 26;
      const cycle = Math.floor(state.elapsedTicks / cycleLength);
      const plans: PartyMember['activity'][] = member.affinity === 'timber'
        ? ['pine_chopping', 'pine_chopping', 'forest_patrol', 'rest']
        : member.affinity === 'supplies'
          ? ['camp_cooking', 'camp_cooking', 'pine_chopping', 'rest']
          : ['forest_patrol', 'forest_patrol', 'camp_cooking', 'rest'];
      const nextActivity = plans[cycle % plans.length];
      if (nextActivity !== member.activity) {
        member.activity = nextActivity;
        member.lastActivityTick = state.elapsedTicks;
        addEvent(`${member.name} is now ${DEFINITIONS.activities[nextActivity].name.toLowerCase()}.`);
      }
    });
  }

  function applySimulationTick(): boolean {
    if (state.expeditionStatus !== 'active' || state.completedExpeditions >= 999999) return false;
    state.elapsedTicks += 1;
    updateGhostActivities();
    state.party.forEach(member => {
      const activity = DEFINITIONS.activities[member.activity] || DEFINITIONS.activities.rest;
      Object.entries(activity.output).forEach(([lane, base]) => {
        const amount = base * member.efficiency;
        if (lane === 'threat' || lane === 'timber' || lane === 'supplies') {
          state.lanes[lane] += amount;
          member.totals[lane] = (member.totals[lane] || 0) + amount;
        }
      });
    });
    if (state.elapsedTicks % 25 === 0) addEvent(`The party reached expedition tick ${state.elapsedTicks}.`);
    const complete = DEFINITIONS.lanes.every(lane => state.lanes[lane.id] >= lane.target);
    if (complete && !state.pendingRewards) {
      state.completedExpeditions += 1;
      state.pendingRewards = { id: `forest-expedition-${state.completedExpeditions}`, expedition: state.completedExpeditions, pineLogs: 20, cookedFish: 3 };
      state.lastContributions = state.party.map(member => ({ id: member.id, name: member.name, activity: member.activity, total: Object.values(member.totals).reduce((sum, value) => sum + value, 0) }));
      addEvent(`Forest Expedition ${state.completedExpeditions} completed. Reward ready: ${rewardDescription(state.pendingRewards)}.`, true);
      state.lanes = { threat: 0, timber: 0, supplies: 0 };
      state.party.forEach(member => { member.totals = { threat: 0, timber: 0, supplies: 0 }; });
      state.expeditionStatus = 'ready';
    }
    return true;
  }

  function simulateTick(): boolean {
    if (!isConnected() || !applySimulationTick()) return false;
    notifySnapshot(commitAuthoritativeState());
    return true;
  }

  function resolveElapsed(options: { allowDisconnected?: boolean; emit?: boolean } = {}): number {
    if ((!isConnected() && !options.allowDisconnected) || state.expeditionStatus !== 'active') return 0;
    const elapsed = Math.max(0, Math.floor((Date.now() - Number(state.lastResolvedAt || Date.now())) / TICK_MS));
    const capped = Math.min(elapsed, 60 * 60 * 4);
    for (let tick = 0; tick < capped; tick += 1) applySimulationTick();
    if (capped > 0) {
      const snapshot = commitAuthoritativeState();
      if (options.emit !== false) notifySnapshot(snapshot);
    }
    return capped;
  }

  function processCommand(command: PartyCommand): CommandProcessResult {
    if (command.type === COMMAND_TYPES.SET_ACTIVITY) {
      const activityCommand = command as Extract<PartyCommand, { type: typeof COMMAND_TYPES.SET_ACTIVITY }>;
      const activityId = activityCommand.payload.activityId;
      const player = state.party.find(member => member.id === 'player');
      if (!player) return { ok: false, code: 'PLAYER_UNAVAILABLE', message: 'Your party member is unavailable. Try again.' };
      if (player.activity === activityId) return { ok: false, code: 'ACTIVITY_UNCHANGED', message: `You are already ${DEFINITIONS.activities[activityId].name.toLowerCase()}.` };
      player.activity = activityId;
      player.lastActivityTick = state.elapsedTicks;
      addEvent(`You began ${DEFINITIONS.activities[activityId].name.toLowerCase()}.`);
      return { ok: true };
    }
    if (command.type === COMMAND_TYPES.START_EXPEDITION) {
      if (state.pendingRewards) return { ok: false, code: 'REWARD_PENDING', message: 'Claim the pending expedition reward first.' };
      if (state.expeditionStatus === 'active') return { ok: false, code: 'EXPEDITION_ALREADY_ACTIVE', message: 'The expedition is already active.' };
      state.expeditionStatus = 'active';
      addEvent(`Forest Expedition ${state.completedExpeditions + 1} launched.`, true);
      return { ok: true };
    }
    if (command.type === COMMAND_TYPES.PAUSE_EXPEDITION) {
      if (state.expeditionStatus !== 'active') return { ok: false, code: 'EXPEDITION_NOT_ACTIVE', message: 'The expedition is not active.' };
      state.expeditionStatus = 'paused';
      addEvent('Forest Expedition paused.');
      return { ok: true };
    }
    if (command.type === COMMAND_TYPES.RESUME_EXPEDITION) {
      if (state.pendingRewards) return { ok: false, code: 'REWARD_PENDING', message: 'Claim the pending expedition reward first.' };
      if (state.expeditionStatus !== 'paused') return { ok: false, code: 'EXPEDITION_NOT_PAUSED', message: 'The expedition is not paused.' };
      state.expeditionStatus = 'active';
      addEvent('Forest Expedition resumed.');
      return { ok: true };
    }
    if (command.type === COMMAND_TYPES.CLAIM_REWARD) {
      const claimCommand = command as Extract<PartyCommand, { type: typeof COMMAND_TYPES.CLAIM_REWARD }>;
      const reward = state.pendingRewards;
      if (!reward) return { ok: false, code: 'NO_PENDING_REWARD', message: 'No expedition reward is available.' };
      if (claimCommand.payload.rewardId !== reward.id) return { ok: false, code: 'REWARD_CHANGED', message: 'That reward is no longer current. Refresh and try again.' };
      if (hasClaimedReward(reward.id)) return { ok: false, code: 'REWARD_ALREADY_CLAIMED', message: 'That expedition reward has already been claimed.' };
      if (!grantReward(reward)) return { ok: false, code: 'REWARD_GRANT_FAILED', message: 'The reward could not be added. Try again.' };
      state.pendingRewards = null;
      state.claimedRewards.unshift({ ...reward, claimedAt: Date.now() });
      state.claimedRewards = state.claimedRewards.slice(0, 30);
      addEvent(`Expedition reward claimed: ${rewardDescription(reward)}.`, true);
      return { ok: true };
    }
    return { ok: false, code: 'UNKNOWN_COMMAND', message: 'That party command is unavailable.' };
  }

  function scheduleCommandResult(command: PartyCommand): void {
    const timer = setTimeout(() => {
      commandTimers.delete(timer);
      if (!isConnected()) {
        notifyResult(createCommandResult(command.commandId, 'rejected', { code: 'TRANSPORT_DISCONNECTED', message: 'Changes were not saved because the party connection was lost.' }));
        return;
      }
      const result = processCommand(command);
      if (!result.ok) {
        notifyResult(createCommandResult(command.commandId, 'rejected', { code: result.code, message: result.message }));
        return;
      }
      notifyResult(createCommandResult(command.commandId, 'confirmed', commitAuthoritativeState()));
    }, commandDelay);
    commandTimers.set(timer, command);
  }

  function submitCommand(command: PartyCommand): boolean {
    if (destroyed || !isConnected() || !isCommandEnvelope(command)) return false;
    if (command.type === COMMAND_TYPES.REQUEST_SNAPSHOT) {
      const timer = setTimeout(() => {
        commandTimers.delete(timer);
        if (!isConnected()) {
          notifyResult(createCommandResult(command.commandId, 'rejected', { code: 'TRANSPORT_DISCONNECTED', message: 'The snapshot could not be requested because the party connection was lost.' }));
          return;
        }
        notifyResult(createCommandResult(command.commandId, 'confirmed', requestSnapshot()));
      }, commandDelay);
      commandTimers.set(timer, command);
      return true;
    }
    scheduleCommandResult(command);
    return true;
  }

  function requestSnapshot(): PartySnapshot {
    return buildSnapshot(state);
  }

  function connect(): boolean {
    if (destroyed || connection === CONNECTION_STATES.CONNECTED || connection === CONNECTION_STATES.CONNECTING || connection === CONNECTION_STATES.RECONNECTING) return false;
    notifyConnection(hasConnected ? CONNECTION_STATES.RECONNECTING : CONNECTION_STATES.CONNECTING);
    connectTimer = setTimeout(() => {
      connectTimer = null;
      if (destroyed) return;
      hasConnected = true;
      notifyConnection(CONNECTION_STATES.CONNECTED);
      resolveElapsed({ allowDisconnected: true, emit: false });
      notifySnapshot(forceFreshSnapshot());
      startTickLoop();
    }, connectDelay);
    return true;
  }

  function disconnect(): boolean {
    if (destroyed || connection === CONNECTION_STATES.DISCONNECTED) return false;
    if (connectTimer) clearTimeout(connectTimer);
    connectTimer = null;
    stopTickLoop();
    [...commandTimers.entries()].forEach(([timer, command]) => {
      clearTimer(timer);
      if (command) notifyResult(createCommandResult(command.commandId, 'rejected', { code: 'TRANSPORT_DISCONNECTED', message: 'Changes were not saved because the party connection was lost.' }));
    });
    notifyConnection(CONNECTION_STATES.DISCONNECTED);
    return true;
  }

  function subscribeToSnapshots(listener: (snapshot: PartySnapshot) => void): () => void {
    snapshotListeners.add(listener);
    return () => snapshotListeners.delete(listener);
  }

  function subscribeToConnection(listener: (status: ConnectionState) => void): () => void {
    connectionListeners.add(listener);
    return () => connectionListeners.delete(listener);
  }

  function subscribeToCommandResults(listener: (result: PartyCommandResult) => void): () => void {
    resultListeners.add(listener);
    return () => resultListeners.delete(listener);
  }

  function destroy(): void {
    if (destroyed) return;
    disconnect();
    destroyed = true;
    snapshotListeners.clear();
    connectionListeners.clear();
    resultListeners.clear();
  }

  const transport: LocalTransport = {
    connect,
    disconnect,
    getConnectionState: () => connection,
    requestSnapshot,
    submitCommand,
    subscribeToSnapshots,
    subscribeToConnection,
    subscribeToCommandResults,
    resolveElapsed,
    simulateTick,
    destroy
  };
  return Object.freeze(transport);
}

export type { LocalTransport };
if (typeof window !== 'undefined') window.LocalMomentumPartyTransport = createLocalMomentumPartyTransport;
