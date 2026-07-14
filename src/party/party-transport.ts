import {
  COMMAND_TYPES,
  CONNECTION_STATES,
  type CommandError,
  type CommandPayloadMap,
  type CommandType,
  type LaneDefinition,
  type MomentumPartyTransport,
  type PartyActivityId,
  type PartyCommand,
  type PartyCommandResult,
  type PartySnapshot,
  type PartyTransportApi
} from './party-types';

export const DEFINITIONS = {
  lanes: [
    { id: 'threat', name: 'Threat Control', target: 100, color: 'var(--red)' },
    { id: 'timber', name: 'Timber', target: 100, color: '#77c66e' },
    { id: 'supplies', name: 'Travel Supplies', target: 100, color: 'var(--gold)' }
  ],
  activities: {
    forest_patrol: { name: 'Forest Patrol', icon: '⚔', output: { threat: 2, supplies: 0.25 } },
    pine_chopping: { name: 'Pine Woodchopping', icon: '▥', output: { timber: 3, supplies: 0.2 } },
    camp_cooking: { name: 'Camp Cooking', icon: '♨', output: { supplies: 2 } },
    rest: { name: 'Resting', icon: '·', output: {} }
  }
} as const satisfies {
  lanes: readonly LaneDefinition[];
  activities: Readonly<Record<PartyActivityId, { name: string; icon: string; output: Record<string, number> }>>;
};

const COMMAND_ALIASES: Readonly<Record<string, CommandType>> = {
  setActivity: COMMAND_TYPES.SET_ACTIVITY,
  startExpedition: COMMAND_TYPES.START_EXPEDITION,
  pauseExpedition: COMMAND_TYPES.PAUSE_EXPEDITION,
  resumeExpedition: COMMAND_TYPES.RESUME_EXPEDITION,
  claimReward: COMMAND_TYPES.CLAIM_REWARD,
  requestSnapshot: COMMAND_TYPES.REQUEST_SNAPSHOT
};

const TRANSPORT_METHODS = [
  'connect',
  'disconnect',
  'getConnectionState',
  'requestSnapshot',
  'submitCommand',
  'subscribeToSnapshots',
  'subscribeToConnection',
  'subscribeToCommandResults',
  'destroy'
] as const;

let commandSequence = 0;

export function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

export function normalizeCommandType(type: unknown): CommandType | null {
  if (typeof type !== 'string') return null;
  if (COMMAND_ALIASES[type]) return COMMAND_ALIASES[type];
  return (Object.values(COMMAND_TYPES) as string[]).includes(type) ? type as CommandType : null;
}

export function createCommandEnvelope<T extends CommandType>(
  type: T,
  payload: CommandPayloadMap[T],
  clientRevision = 0
): Extract<PartyCommand, { type: T }> {
  commandSequence += 1;
  return Object.freeze({
    commandId: `cmd_${Date.now()}_${commandSequence}`,
    type,
    payload: clone(payload),
    clientRevision: Math.max(0, Math.floor(Number(clientRevision) || 0)),
    createdAt: Date.now()
  }) as unknown as Extract<PartyCommand, { type: T }>;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function isPayloadForCommand(type: CommandType, payload: unknown): boolean {
  if (!isRecord(payload)) return false;
  if (type === COMMAND_TYPES.SET_ACTIVITY) return typeof payload.activityId === 'string' && payload.activityId in DEFINITIONS.activities;
  if (type === COMMAND_TYPES.CLAIM_REWARD) return typeof payload.rewardId === 'string' && payload.rewardId.length > 0;
  return Object.keys(payload).length === 0;
}

export function isCommandEnvelope(value: unknown): value is PartyCommand {
  if (!isRecord(value)) return false;
  const type = normalizeCommandType(value.type);
  return Boolean(
    typeof value.commandId === 'string' && value.commandId.length > 0 &&
    type && isPayloadForCommand(type, value.payload) &&
    typeof value.clientRevision === 'number' && Number.isInteger(value.clientRevision) && value.clientRevision >= 0 &&
    Number.isFinite(value.createdAt)
  );
}

export function createCommandResult(commandId: string, status: 'confirmed', snapshot?: PartySnapshot): Extract<PartyCommandResult, { status: 'confirmed' }>;
export function createCommandResult(commandId: string, status: 'rejected', error?: Partial<CommandError>): Extract<PartyCommandResult, { status: 'rejected' }>;
export function createCommandResult(commandId: string, status: 'confirmed' | 'rejected', value?: PartySnapshot | Partial<CommandError>): PartyCommandResult {
  if (status === 'confirmed') return { commandId, status, snapshot: value as PartySnapshot | undefined };
  const error = value as Partial<CommandError> | undefined;
  return {
    commandId,
    status,
    error: {
      code: error?.code || 'COMMAND_REJECTED',
      message: error?.message || 'The command was rejected.'
    }
  };
}

export function assertTransport(value: unknown): MomentumPartyTransport {
  if (!isRecord(value)) throw new Error('Party transport must be an object.');
  const missing = TRANSPORT_METHODS.filter(method => typeof value[method] !== 'function');
  if (missing.length > 0) throw new Error(`Party transport is missing: ${missing.join(', ')}`);
  return value as unknown as MomentumPartyTransport;
}

export { COMMAND_TYPES, CONNECTION_STATES };

export const partyTransportApi: PartyTransportApi = {
  CONNECTION_STATES,
  COMMAND_TYPES,
  DEFINITIONS,
  assertTransport,
  clone,
  createCommandEnvelope: createCommandEnvelope as PartyTransportApi['createCommandEnvelope'],
  createCommandResult: createCommandResult as PartyTransportApi['createCommandResult'],
  isCommandEnvelope,
  normalizeCommandType
};

if (typeof window !== 'undefined') window.MomentumPartyTransport = partyTransportApi;
