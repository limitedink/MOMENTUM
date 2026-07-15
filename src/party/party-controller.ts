import {
  COMMAND_TYPES,
  CONNECTION_STATES,
  type ClientSession,
  type CommandPayloadMap,
  type CommandType,
  type MomentumPartyTransport,
  type PartyActivityId,
  type PartySnapshot
} from './party-types';
import { assertTransport, createCommandEnvelope } from './party-transport';

export interface PartyCommandController {
  submit<T extends CommandType>(type: T, payload?: CommandPayloadMap[T]): Promise<boolean>;
  requestSnapshot(): Promise<PartySnapshot>;
  setActivity(activityId: PartyActivityId): Promise<boolean>;
  startExpedition(): Promise<boolean>;
  pauseExpedition(): Promise<boolean>;
  resumeExpedition(): Promise<boolean>;
  claimReward(rewardId: string): Promise<boolean>;
}

export function createPartyCommandController(session: ClientSession, activeTransport: MomentumPartyTransport): PartyCommandController {
  assertTransport(activeTransport);

  async function submit<T extends CommandType>(type: T, payload?: CommandPayloadMap[T]): Promise<boolean> {
    if (session.getState().connection.status !== CONNECTION_STATES.CONNECTED) return false;
    const command = createCommandEnvelope(type, (payload || {}) as CommandPayloadMap[T], session.getState().lastAcceptedRevision);
    if (!session.beginCommand(command)) return false;
    const accepted = await activeTransport.submitCommand(command);
    if (!accepted) {
      session.applyCommandResult({ commandId: command.commandId, status: 'rejected', error: { code: 'TRANSPORT_UNAVAILABLE', message: 'Changes could not be sent. Try again.' } });
    }
    return accepted;
  }

  async function requestSnapshot(): Promise<PartySnapshot> {
    if (session.getState().connection.status !== CONNECTION_STATES.CONNECTED) return session.getSnapshot();
    const snapshot = await activeTransport.requestSnapshot();
    session.acceptSnapshot(snapshot);
    return session.getSnapshot();
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
