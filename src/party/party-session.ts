import {
  CONNECTION_STATES,
  RECONNECT_STATES,
  type ClientSession,
  type ClientSessionState,
  type CommandResolution,
  type CommandType,
  type PartyCommand,
  type PartySessionIdentity,
  type PartySnapshotStore,
  type SettledCommand,
  type PendingCommand,
  type SnapshotAcceptance,
  type ConnectionState,
  type Unsubscribe
} from './party-types';
import { clone } from './party-transport';
import { parsePartyCommandResult } from './party-schema';

export function createClientSession(store: PartySnapshotStore, identity: PartySessionIdentity, initialConnection: ConnectionState = CONNECTION_STATES.DISCONNECTED): ClientSession {
  let model: ClientSessionState = {
    connection: { status: initialConnection, lastConfirmedAt: null },
    reconnectState: initialConnection === CONNECTION_STATES.RECONNECTING ? RECONNECT_STATES.RECONNECTING : initialConnection === CONNECTION_STATES.CONNECTING ? RECONNECT_STATES.CONNECTING : RECONNECT_STATES.IDLE,
    authenticatedPlayerId: identity.authenticatedPlayerId,
    currentPartyId: identity.currentPartyId,
    pendingCommands: [],
    commandStates: {},
    commandErrors: [],
    lastAcceptedRevision: store.getAcceptedRevision(),
    latencyMs: null
  };
  const pending = new Map<string, PendingCommand>();
  const listeners = new Set<(state: ClientSessionState, reason: string) => void>();

  function getState(): ClientSessionState {
    return clone({ ...model, pendingCommands: [...pending.values()], commandStates: model.commandStates, commandErrors: model.commandErrors });
  }

  function notify(reason: string): void {
    const state = getState();
    listeners.forEach(listener => listener(state, reason));
  }

  function acceptSnapshot(value: unknown): SnapshotAcceptance {
    const acceptance = store.acceptSnapshot(value);
    if (!acceptance.accepted) return acceptance;
    model = {
      ...model,
      currentPartyId: store.getSnapshot().party.id,
      lastAcceptedRevision: store.getAcceptedRevision(),
      connection: { ...model.connection, lastConfirmedAt: Date.now() }
    };
    notify('snapshot');
    return acceptance;
  }

  function setConnection(status: ConnectionState): boolean {
    if (model.connection.status === status) return false;
    const reconnectState = status === CONNECTION_STATES.CONNECTING ? RECONNECT_STATES.CONNECTING : status === CONNECTION_STATES.RECONNECTING ? RECONNECT_STATES.RECONNECTING : RECONNECT_STATES.IDLE;
    model = { ...model, connection: { ...model.connection, status }, reconnectState };
    notify('connection');
    return true;
  }

  function beginCommand(command: PartyCommand): string | null {
    if (model.connection.status !== CONNECTION_STATES.CONNECTED || [...pending.values()].some(item => item.type === command.type)) return null;
    const next = { ...clone(command), status: 'pending' as const, submittedAt: Date.now() } as PendingCommand;
    pending.set(next.commandId, next);
    model = { ...model, commandStates: { ...model.commandStates, [next.type]: next }, commandErrors: [] };
    notify('command-pending');
    return next.commandId;
  }

  function applyCommandResult(value: unknown): CommandResolution {
    const result = parsePartyCommandResult(value);
    if (!result) return { matched: false, reason: 'invalid' };
    const snapshotResult = result.status === 'confirmed' && result.snapshot ? acceptSnapshot(result.snapshot) : null;
    const command = pending.get(result.commandId);
    if (!command) return { matched: false, reason: 'unknown', snapshotResult };
    pending.delete(result.commandId);
    const settled = {
      ...command,
      status: result.status,
      settledAt: Date.now(),
      ...(result.status === 'rejected' ? { error: clone(result.error) } : { snapshotRevision: result.snapshot?.revision ?? null })
    } as SettledCommand;
    model = { ...model, commandStates: { ...model.commandStates, [command.type]: settled }, latencyMs: Math.max(0, Date.now() - command.submittedAt) };
    if (result.status === 'rejected') {
      model = { ...model, commandErrors: [{ ...clone(result.error), commandId: command.commandId, type: command.type, at: Date.now() }, ...model.commandErrors].slice(0, 5) };
    }
    model = { ...model, lastAcceptedRevision: store.getAcceptedRevision() };
    notify(`command-${result.status}`);
    return { matched: true, status: result.status, snapshotResult };
  }

  function rejectPendingCommands(code: string, message: string): number {
    const commands = [...pending.values()];
    commands.forEach(command => applyCommandResult({ commandId: command.commandId, status: 'rejected', error: { code, message } }));
    return commands.length;
  }

  function getCommandState(type: CommandType): PendingCommand | SettledCommand | { type: CommandType; status: 'idle' } {
    return clone(model.commandStates[type] || { type, status: 'idle' });
  }

  return Object.freeze({
    acceptSnapshot,
    applyCommandResult,
    beginCommand,
    getCommandState,
    getSnapshot: store.getSnapshot,
    getState,
    rejectPendingCommands,
    setConnection,
    subscribe: (listener: (state: ClientSessionState, reason: string) => void): Unsubscribe => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    }
  });
}
