import {
  CONNECTION_STATES,
  type ClientSession,
  type MomentumPartyClient,
  type MomentumPartyTransport,
  type PartyActivityId,
  type PartyClientState,
  type PartySnapshot,
  type Unsubscribe
} from './party-types';
import { assertTransport, normalizeCommandType } from './party-transport';
import { createPartySnapshotStore } from './party-store';
import { createClientSession } from './party-session';
import { createPartyCommandController, type PartyCommandController } from './party-controller';

export function createPartyClient(value: unknown): MomentumPartyClient {
  const transport = assertTransport(value) as MomentumPartyTransport;
  let store: ReturnType<typeof createPartySnapshotStore> | null = null;
  let session: ClientSession | null = null;
  let controller: PartyCommandController | null = null;
  let ready = false;
  let destroyed = false;
  const listeners = new Set<(state: PartyClientState, reason: string) => void>();
  const unsubscribers: Unsubscribe[] = [];

  function requireSession(): ClientSession {
    if (!session || !store || !controller || !ready || destroyed) throw new Error('Momentum party client is not initialized.');
    return session;
  }

  function notify(reason: string): void {
    if (!session || !store) return;
    const state = { snapshot: store.getSnapshot(), session: session.getState() };
    listeners.forEach(listener => listener(state, reason));
  }

  async function initialize(): Promise<boolean> {
    if (destroyed) return false;
    if (ready) return true;
    const [connection, identity, initialSnapshot] = await Promise.all([
      transport.getConnectionState(),
      transport.getSessionIdentity(),
      transport.requestSnapshot()
    ]);
    store = createPartySnapshotStore(initialSnapshot);
    session = createClientSession(store, identity, connection);
    controller = createPartyCommandController(session, transport);
    unsubscribers.push(transport.subscribeToSnapshots(snapshot => { session?.acceptSnapshot(snapshot); }));
    unsubscribers.push(transport.subscribeToConnection(status => {
      session?.setConnection(status);
      if (status === CONNECTION_STATES.DISCONNECTED) session?.rejectPendingCommands('TRANSPORT_DISCONNECTED', 'Changes were not saved because the party connection was lost.');
    }));
    unsubscribers.push(transport.subscribeToCommandResults(result => { session?.applyCommandResult(result); }));
    unsubscribers.push(session.subscribe((_state, reason) => notify(reason)));
    ready = true;
    notify('initialized');
    return true;
  }

  async function connect(): Promise<boolean> {
    requireSession();
    return transport.connect();
  }

  async function disconnect(): Promise<boolean> {
    requireSession();
    return transport.disconnect();
  }

  async function reconnect(): Promise<boolean> {
    requireSession();
    await transport.disconnect();
    return transport.connect();
  }

  async function destroy(): Promise<void> {
    if (destroyed) return;
    destroyed = true;
    unsubscribers.splice(0).forEach(unsubscribe => unsubscribe());
    listeners.clear();
    await transport.destroy();
  }

  function getSnapshot(): PartySnapshot {
    return requireSession().getSnapshot();
  }

  function getState(): PartyClientState {
    const activeSession = requireSession();
    return { snapshot: getSnapshot(), session: activeSession.getState() };
  }

  return Object.freeze({
    initialize,
    connect,
    disconnect,
    reconnect,
    destroy,
    getSnapshot,
    getState,
    getSessionState: () => requireSession().getState(),
    getCommandState: (type: string) => requireSession().getCommandState(normalizeCommandType(type) || type as never),
    getConnectionState: () => requireSession().getState().connection.status,
    requestSnapshot: () => requireSessionController(controller).requestSnapshot(),
    setActivity: (activityId: PartyActivityId) => requireSessionController(controller).setActivity(activityId),
    startExpedition: () => requireSessionController(controller).startExpedition(),
    pauseExpedition: () => requireSessionController(controller).pauseExpedition(),
    resumeExpedition: () => requireSessionController(controller).resumeExpedition(),
    toggleExpedition: async () => {
      const activeSession = requireSession();
      const status = activeSession.getSnapshot().expedition.status;
      if (status === 'active') return requireSessionController(controller).pauseExpedition();
      if (status === 'paused') return requireSessionController(controller).resumeExpedition();
      return requireSessionController(controller).startExpedition();
    },
    claimReward: async (rewardId?: string) => {
      const reward = requireSession().getSnapshot().expedition.pendingRewards;
      return reward ? requireSessionController(controller).claimReward(rewardId || reward.id) : false;
    },
    subscribe: (listener: (state: PartyClientState, reason: string) => void): Unsubscribe => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    }
  });
}

function requireSessionController(controller: PartyCommandController | null): PartyCommandController {
  if (!controller) throw new Error('Momentum party client is not initialized.');
  return controller;
}
