import type { PartySnapshot, PartySnapshotStore, PartySnapshotStoreState, SnapshotAcceptance, Unsubscribe } from './party-types';
import { clone } from './party-transport';
import { parsePartySnapshot } from './party-schema';

export function isPartySnapshot(value: unknown): value is PartySnapshot {
  return parsePartySnapshot(value) !== null;
}

export function createPartySnapshotStore(initialSnapshot: PartySnapshot): PartySnapshotStore {
  if (!isPartySnapshot(initialSnapshot)) throw new Error('Cannot create a party store from an invalid snapshot.');
  let acceptedRevision = initialSnapshot.revision;
  let snapshot = clone(initialSnapshot);
  const listeners = new Set<(state: PartySnapshotStoreState, reason: string) => void>();

  function getSnapshot(): PartySnapshot {
    return clone(snapshot);
  }

  function getState(): PartySnapshotStoreState {
    return { snapshot: getSnapshot(), acceptedRevision };
  }

  function notify(reason: string): void {
    const state = getState();
    listeners.forEach(listener => listener(state, reason));
  }

  function acceptSnapshot(value: unknown): SnapshotAcceptance {
    const next = parsePartySnapshot(value);
    if (!next) return { accepted: false, reason: 'invalid', error: 'Snapshot shape is invalid.' };
    if (next.revision <= acceptedRevision) {
      return { accepted: false, reason: next.revision === acceptedRevision ? 'duplicate' : 'stale', revision: next.revision };
    }
    snapshot = clone(next);
    acceptedRevision = next.revision;
    notify('snapshot');
    return { accepted: true, revision: next.revision };
  }

  function subscribe(listener: (state: PartySnapshotStoreState, reason: string) => void): Unsubscribe {
    listeners.add(listener);
    return () => listeners.delete(listener);
  }

  return Object.freeze({ acceptSnapshot, getAcceptedRevision: () => acceptedRevision, getState, getSnapshot, subscribe });
}

export const partyStoreApi = { createPartySnapshotStore, isPartySnapshot };
if (typeof window !== 'undefined') window.MomentumPartyStore = partyStoreApi;
