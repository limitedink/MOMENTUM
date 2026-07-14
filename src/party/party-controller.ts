import {
  COMMAND_TYPES,
  CONNECTION_STATES,
  type CommandPayloadMap,
  type CommandType,
  type MomentumPartyTransport,
  type PartyActivityId,
  type PartySnapshotStore
} from './party-types';
import { assertTransport, createCommandEnvelope } from './party-transport';

export interface PartyCommandController {
  submit<T extends CommandType>(type: T, payload?: CommandPayloadMap[T]): boolean;
  requestSnapshot(): ReturnType<PartySnapshotStore['getSnapshot']>;
  setActivity(activityId: PartyActivityId): boolean;
  startExpedition(): boolean;
  pauseExpedition(): boolean;
  resumeExpedition(): boolean;
  claimReward(rewardId: string): boolean;
}

export function createPartyCommandController(
  store: PartySnapshotStore,
  activeTransport: MomentumPartyTransport
): PartyCommandController {
  assertTransport(activeTransport);

  function submit<T extends CommandType>(type: T, payload?: CommandPayloadMap[T]): boolean {
    if (store.getState().connection.status !== CONNECTION_STATES.CONNECTED) return false;
    const command = createCommandEnvelope(
      type,
      (payload || {}) as CommandPayloadMap[T],
      store.getAcceptedRevision()
    );
    if (!store.beginCommand(command)) return false;
    if (activeTransport.submitCommand(command)) return true;
    store.applyCommandResult({
      commandId: command.commandId,
      status: 'rejected',
      error: { code: 'TRANSPORT_UNAVAILABLE', message: 'Changes could not be sent. Try again.' }
    });
    return false;
  }

  function requestSnapshot() {
    if (store.getState().connection.status !== CONNECTION_STATES.CONNECTED) return store.getSnapshot();
    const command = createCommandEnvelope(
      COMMAND_TYPES.REQUEST_SNAPSHOT,
      {},
      store.getAcceptedRevision()
    );
    if (!store.beginCommand(command)) return store.getSnapshot();
    if (!activeTransport.submitCommand(command)) {
      store.applyCommandResult({
        commandId: command.commandId,
        status: 'rejected',
        error: { code: 'TRANSPORT_UNAVAILABLE', message: 'The snapshot could not be requested. Try again.' }
      });
    }
    return store.getSnapshot();
  }

  return Object.freeze({
    submit,
    requestSnapshot,
    setActivity: (activityId: PartyActivityId) => submit(COMMAND_TYPES.SET_ACTIVITY, { activityId }),
    startExpedition: () => submit(COMMAND_TYPES.START_EXPEDITION, {}),
    pauseExpedition: () => submit(COMMAND_TYPES.PAUSE_EXPEDITION, {}),
    resumeExpedition: () => submit(COMMAND_TYPES.RESUME_EXPEDITION, {}),
    claimReward: (rewardId: string) => submit(COMMAND_TYPES.CLAIM_REWARD, { rewardId })
  });
}

export const partyControllerApi = { createPartyCommandController };
if (typeof window !== 'undefined') window.MomentumPartyController = partyControllerApi;
