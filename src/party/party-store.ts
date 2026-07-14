import {
  CONNECTION_STATES,
  type CommandType,
  type PartyCommand,
  type PartyCommandResult,
  type PartySnapshot,
  type PartySnapshotStore,
  type PartyStoreState,
  type PendingCommand,
  type SettledCommand,
  type ConnectionState,
  type CommandResolution,
  type SnapshotAcceptance,
  type Unsubscribe
} from './party-types';
import { clone } from './party-transport';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

export function isPartySnapshot(value: unknown): value is PartySnapshot {
  if (!isRecord(value)) return false;
  const party = value.party;
  const expedition = value.expedition;
  return typeof value.revision === 'number' && Number.isInteger(value.revision) && value.revision >= 0 &&
    isRecord(party) && Array.isArray(party.members) &&
    isRecord(expedition) && isRecord(expedition.lanes) &&
    Array.isArray(value.recentEvents) && Number.isFinite(value.elapsedTicks) &&
    isRecord(value.connection);
}

export function createPartySnapshotStore(
  initialSnapshot: PartySnapshot,
  initialConnection: ConnectionState = CONNECTION_STATES.DISCONNECTED
): PartySnapshotStore {
  let acceptedRevision = initialSnapshot.revision;
  const model: {
    snapshot: PartySnapshot;
    connection: { status: ConnectionState; lastConfirmedAt: number };
    pendingCommands: Record<string, PendingCommand>;
    commandStates: Partial<Record<CommandType, PendingCommand | SettledCommand>>;
    commandErrors: Array<{ code: string; message: string; commandId: string; type: CommandType; at: number }>;
  } = {
    snapshot: clone(initialSnapshot),
    connection: {
      status: initialConnection,
      lastConfirmedAt: initialSnapshot.connection.lastConfirmedAt || Date.now()
    },
    pendingCommands: {},
    commandStates: {},
    commandErrors: []
  };
  const listeners = new Set<(state: PartyStoreState, reason: string) => void>();

  function getSnapshot(): PartySnapshot {
    return {
      ...clone(model.snapshot),
      connection: {
        ...model.snapshot.connection,
        status: model.connection.status,
        lastConfirmedAt: model.connection.lastConfirmedAt
      }
    };
  }

  function getState(): PartyStoreState {
    return {
      snapshot: getSnapshot(),
      acceptedRevision,
      connection: { ...model.connection },
      pendingCommands: clone(Object.values(model.pendingCommands)),
      commandStates: clone(model.commandStates),
      commandErrors: clone(model.commandErrors)
    };
  }

  function notify(reason: string): void {
    const state = getState();
    listeners.forEach(listener => listener(state, reason));
  }

  function acceptSnapshot(snapshot: PartySnapshot): SnapshotAcceptance {
    if (!isPartySnapshot(snapshot)) return { accepted: false, reason: 'invalid', error: 'Snapshot shape is invalid.' };
    const revision = snapshot.revision;
    // Revision authority is strict: equal revisions are duplicates and lower
    // revisions are stale, so neither may replace confirmed state.
    if (revision <= acceptedRevision) {
      return { accepted: false, reason: revision === acceptedRevision ? 'duplicate' : 'stale', revision };
    }
    model.snapshot = clone(snapshot);
    acceptedRevision = revision;
    model.connection.lastConfirmedAt = snapshot.connection.lastConfirmedAt || Date.now();
    notify('snapshot');
    return { accepted: true, revision };
  }

  function setConnection(status: ConnectionState): boolean {
    if (model.connection.status === status) return false;
    model.connection.status = status;
    notify('connection');
    return true;
  }

  function beginCommand(command: PartyCommand): string | null {
    if (model.connection.status !== CONNECTION_STATES.CONNECTED) return null;
    if (Object.values(model.pendingCommands).some(pending => pending.type === command.type)) return null;
    const pending = {
      ...clone(command),
      status: 'pending' as const,
      submittedAt: Date.now()
    } as PendingCommand;
    model.pendingCommands[pending.commandId] = pending;
    model.commandStates[pending.type] = pending;
    model.commandErrors = [];
    notify('command-pending');
    return pending.commandId;
  }

  function applyCommandResult(result: PartyCommandResult): CommandResolution {
    if (!result || typeof result.commandId !== 'string') return { matched: false, reason: 'invalid' };
    const snapshotResult = result.status === 'confirmed' && result.snapshot ? acceptSnapshot(result.snapshot) : null;
    const pending = model.pendingCommands[result.commandId];
    if (!pending) return { matched: false, reason: 'unknown', snapshotResult };
    delete model.pendingCommands[result.commandId];
    const settled: SettledCommand = {
      ...pending,
      status: result.status,
      settledAt: Date.now(),
      ...(result.status === 'rejected'
        ? { error: clone(result.error) }
        : { snapshotRevision: result.snapshot?.revision ?? null })
    } as SettledCommand;
    model.commandStates[pending.type] = settled;
    if (result.status === 'rejected') {
      model.commandErrors.unshift({
        ...clone(result.error),
        commandId: pending.commandId,
        type: pending.type,
        at: Date.now()
      });
      model.commandErrors = model.commandErrors.slice(0, 5);
    }
    notify(`command-${result.status}`);
    return { matched: true, status: result.status, snapshotResult };
  }

  function rejectPendingCommands(code: string, message: string): number {
    const pending = Object.values(model.pendingCommands);
    pending.forEach(command => applyCommandResult({
      commandId: command.commandId,
      status: 'rejected',
      error: { code, message }
    }));
    return pending.length;
  }

  function getCommandState(type: CommandType): PendingCommand | SettledCommand | { type: CommandType; status: 'idle' } {
    return clone(model.commandStates[type] || { type, status: 'idle' });
  }

  function subscribe(listener: (state: PartyStoreState, reason: string) => void): Unsubscribe {
    listeners.add(listener);
    return () => listeners.delete(listener);
  }

  return Object.freeze({
    acceptSnapshot,
    applyCommandResult,
    beginCommand,
    getAcceptedRevision: () => acceptedRevision,
    getCommandState,
    getState,
    getSnapshot,
    rejectPendingCommands,
    setConnection,
    subscribe
  });
}

export const partyStoreApi = { createPartySnapshotStore, isPartySnapshot };
if (typeof window !== 'undefined') window.MomentumPartyStore = partyStoreApi;
