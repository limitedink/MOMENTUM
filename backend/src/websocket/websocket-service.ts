import { randomUUID } from 'node:crypto';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { Pool } from 'pg';
import type { RawData, WebSocket } from 'ws';
import type { AppConfig } from '../config/environment.js';
import {
  authenticateAuthorizationHeader,
  authenticateToken
} from '../authentication/auth.js';
import { createPartyService } from '../domain/parties/party-service.js';
import { createPostgresPartyRepository } from '../domain/parties/postgres-party-repository.js';
import type { PartyWithMembers } from '../domain/parties/party.js';
import {
  createPartyStateService,
  PartyStateError,
  type PartyState,
  type PartyStateErrorCode
} from '../domain/party-state/index.js';
import {
  createConnectionRegistry,
  type ConnectionRegistry,
  type RegisteredConnection,
  type RegistrySocket,
  type WebSocketConnectionSession
} from './connection-registry.js';
import {
  createServerMessage,
  parseClientMessage,
  rawMessageByteLength,
  rawMessageToText,
  WEBSOCKET_CLOSE_CODES,
  WEBSOCKET_CLOSE_REASONS,
  WEBSOCKET_PROTOCOL_VERSION,
  type ClientMessage,
  type PartySnapshotPayload,
  type PartyCommandMessage,
  type PartyStateSnapshotPayload,
  type ServerMessage
} from './protocol.js';

type WebSocketLogger = Pick<FastifyInstance['log'], 'info' | 'warn' | 'error'>;

export interface WebSocketService {
  close(): void;
  getRegistry(): ConnectionRegistry;
}

function safeErrorName(error: unknown): string {
  return error instanceof Error ? error.name : 'UnknownError';
}

function asRegistrySocket(socket: WebSocket): RegistrySocket {
  return socket;
}

function partySnapshotPayload(party: PartyWithMembers | null): PartySnapshotPayload {
  return {
    partyId: party?.party.id ?? null,
    leaderPlayerId: party?.party.leaderId ?? null,
    memberPlayerIds: party?.members.map(member => member.playerId) ?? [],
    members: party?.members.map(member => ({
      playerId: member.playerId,
      displayName: member.displayName,
      isLeader: member.playerId === party.party.leaderId
    })) ?? [],
    joinCode: party?.party.joinCode ?? null,
    serverTimestamp: Date.now()
  };
}

function stringifyMessage(message: ServerMessage): string {
  return JSON.stringify(message);
}

function partyStateSnapshotPayload(state: PartyState): PartyStateSnapshotPayload {
  return {
    partyId: state.partyId,
    revision: state.revision,
    activity: {
      kind: state.activity.kind,
      status: state.activity.status,
      destination: state.activity.destination,
      startedAt: state.activity.startedAt?.toISOString() ?? null,
      completesAt: state.activity.completesAt?.toISOString() ?? null
    },
    contributions: state.contributions,
    memberActivities: state.memberActivities,
    pendingRewards: state.pendingRewards,
    updatedAt: state.updatedAt.toISOString(),
    serverTimestamp: Date.now()
  };
}

function failureReason(failure: 'invalid_json' | 'unsupported_version' | 'unknown_message_type' | 'invalid_message' | 'binary_message'): string {
  switch (failure) {
    case 'invalid_json': return WEBSOCKET_CLOSE_REASONS.INVALID_JSON;
    case 'unsupported_version': return WEBSOCKET_CLOSE_REASONS.UNSUPPORTED_VERSION;
    case 'unknown_message_type': return WEBSOCKET_CLOSE_REASONS.UNKNOWN_MESSAGE_TYPE;
    case 'binary_message': return WEBSOCKET_CLOSE_REASONS.BINARY_MESSAGE;
    case 'invalid_message': return WEBSOCKET_CLOSE_REASONS.INVALID_MESSAGE;
  }
}

function failureCode(failure: 'invalid_json' | 'unsupported_version' | 'unknown_message_type' | 'invalid_message' | 'binary_message'): number {
  return failure === 'unsupported_version'
    ? WEBSOCKET_CLOSE_CODES.PROTOCOL_ERROR
    : WEBSOCKET_CLOSE_CODES.INVALID_MESSAGE;
}

export function registerWebSocketRoute(
  app: FastifyInstance,
  database: Pool,
  config: AppConfig,
  logger: WebSocketLogger = app.log
): WebSocketService {
  const registry = createConnectionRegistry();
  const partyService = createPartyService(createPostgresPartyRepository(database));
  const partyStateService = createPartyStateService(database, {
    expeditionDurationMs: config.partyStateExpeditionDurationMs,
    maxContribution: config.partyStateMaxContribution,
    maxCommandIdLength: config.partyStateMaxCommandIdLength
  });
  const pendingSockets = new Set<RegistrySocket>();
  let closing = false;

  async function authenticateHeader(request: FastifyRequest, reply: FastifyReply): Promise<void> {
    // A missing header is allowed to continue to the explicit first-message
    // flow for browser clients. A present but invalid header is never allowed
    // to fall back to that flow.
    if (request.headers.authorization === undefined) return;

    try {
      const context = await authenticateAuthorizationHeader(database, request.headers.authorization);
      if (!context) {
        logger.warn({ requestId: request.id, reason: WEBSOCKET_CLOSE_REASONS.AUTH_FAILED }, 'websocket authentication rejected');
        reply.code(401).send({ error: 'websocket_authentication_failed' });
        return;
      }
      request.currentPlayer = context.player;
      request.currentSession = context.session;
    } catch (error) {
      logger.error({ requestId: request.id, error: safeErrorName(error) }, 'websocket authentication handler failed');
      reply.code(503).send({ error: 'websocket_authentication_unavailable' });
    }
  }

  app.get('/v1/ws', { websocket: true, preHandler: authenticateHeader }, (socket, request) => {
    const registrySocket = asRegistrySocket(socket);
    const connectionId = randomUUID();
    const session: WebSocketConnectionSession = {
      connectionId,
      playerId: null,
      partyId: null,
      sessionId: null,
      connectedAt: Date.now(),
      lastActivityAt: Date.now(),
      status: 'authenticating'
    };
    let registered = false;
    let cleanedUp = false;
    let authTimer: NodeJS.Timeout | undefined;
    let idleTimer: NodeJS.Timeout | undefined;
    let messageChain = Promise.resolve();
    let messageTimes: number[] = [];
    let partyCommandTimes: number[] = [];
    let partyContributionTimes: number[] = [];

    pendingSockets.add(registrySocket);

    const clearTimers = (): void => {
      if (authTimer) clearTimeout(authTimer);
      if (idleTimer) clearTimeout(idleTimer);
      authTimer = undefined;
      idleTimer = undefined;
    };

    const send = (message: ServerMessage): boolean => {
      if (cleanedUp || socket.readyState !== socket.OPEN) return false;
      try {
        socket.send(stringifyMessage(message));
        return true;
      } catch {
        closeConnection(WEBSOCKET_CLOSE_CODES.INTERNAL_ERROR, WEBSOCKET_CLOSE_REASONS.INTERNAL_ERROR);
        return false;
      }
    };

    const closeConnection = (code: number, reason: string): void => {
      if (cleanedUp) return;
      session.status = 'closing';
      cleanup(code);
      try {
        if (socket.readyState === socket.OPEN || socket.readyState === socket.CONNECTING) socket.close(code, reason);
      } catch {
        // The socket may already be closed; cleanup has already removed it.
      }
    };

    const scheduleIdleTimeout = (): void => {
      if (session.status !== 'connected') return;
      if (idleTimer) clearTimeout(idleTimer);
      idleTimer = setTimeout(() => {
        const elapsed = Date.now() - session.lastActivityAt;
        if (elapsed >= config.websocketIdleTimeoutMs) {
          logger.info({ connectionId, playerId: session.playerId }, 'websocket idle timeout');
          closeConnection(WEBSOCKET_CLOSE_CODES.IDLE_TIMEOUT, WEBSOCKET_CLOSE_REASONS.IDLE_TIMEOUT);
          return;
        }
        scheduleIdleTimeout();
      }, config.websocketIdleTimeoutMs);
      idleTimer.unref?.();
    };

    const cleanup = (closeCode: number): void => {
      if (cleanedUp) return;
      cleanedUp = true;
      clearTimers();
      pendingSockets.delete(registrySocket);

      const removed = registered ? registry.remove(connectionId) : null;
      registered = false;
      const playerId = removed?.session.playerId;
      const partyId = removed?.session.partyId;
      session.status = 'closed';

      if (removed && playerId && partyId && registry.countPlayerConnections(playerId, partyId) === 0) {
        registry.broadcastParty(
          partyId,
          stringifyMessage(createServerMessage('party.presence', null, {
            playerId,
            status: 'offline',
            connectedSessionCount: 0,
            serverTimestamp: Date.now()
          }))
        );
      }

      logger.info({ connectionId, playerId, partyId, closeCode }, 'websocket connection closed');
    };

    const consumeRateLimit = (): boolean => {
      const now = Date.now();
      const cutoff = now - config.websocketRateWindowMs;
      messageTimes = messageTimes.filter(timestamp => timestamp > cutoff);
      if (messageTimes.length >= config.websocketMaxMessages) {
        logger.warn({ connectionId, playerId: session.playerId, reason: WEBSOCKET_CLOSE_REASONS.RATE_LIMIT }, 'websocket rate limit exceeded');
        closeConnection(WEBSOCKET_CLOSE_CODES.POLICY_VIOLATION, WEBSOCKET_CLOSE_REASONS.RATE_LIMIT);
        return false;
      }
      messageTimes.push(now);
      return true;
    };

    const consumePartyCommandRateLimit = (message: PartyCommandMessage): boolean => {
      const now = Date.now();
      const commandCutoff = now - config.partyStateCommandWindowMs;
      partyCommandTimes = partyCommandTimes.filter(timestamp => timestamp > commandCutoff);
      if (partyCommandTimes.length >= config.partyStateMaxCommands) return false;
      partyCommandTimes.push(now);

      if (message.payload.command.type === 'expedition.contribute') {
        const contributionCutoff = now - config.partyStateContributionWindowMs;
        partyContributionTimes = partyContributionTimes.filter(timestamp => timestamp > contributionCutoff);
        if (partyContributionTimes.length >= config.partyStateMaxContributions) return false;
        partyContributionTimes.push(now);
      }
      return true;
    };

    const broadcastPartyState = (partyId: string, state: PartyState, memberPlayerIds: string[]): void => {
      const data = stringifyMessage(createServerMessage('party.state.snapshot', null, partyStateSnapshotPayload(state)));
      const authorized = new Set(memberPlayerIds);
      for (const connection of registry.getByParty(partyId)) {
        if (!connection.session.playerId || !authorized.has(connection.session.playerId)) continue;
        if (connection.socket.readyState !== 1) continue;
        try {
          connection.socket.send(data);
        } catch {
          try {
            connection.socket.close(WEBSOCKET_CLOSE_CODES.INTERNAL_ERROR, WEBSOCKET_CLOSE_REASONS.INTERNAL_ERROR);
          } catch {
            // Cleanup remains owned by the connection's close handler.
          }
        }
      }
    };

    const broadcastPresence = (
      partyId: string,
      playerId: string,
      status: 'online' | 'offline',
      connectedSessionCount: number,
      excludeConnectionId?: string
    ): void => {
      registry.broadcastParty(
        partyId,
        stringifyMessage(createServerMessage('party.presence', null, {
          playerId,
          status,
          connectedSessionCount,
          serverTimestamp: Date.now()
        })),
        excludeConnectionId
      );
    };

    const refreshPartyScope = async (requestId: string): Promise<void> => {
      if (!session.playerId || session.status !== 'connected') return;
      const party = await partyService.getCurrentParty(session.playerId);
      if (cleanedUp) return;

      const newPartyId = party?.party.id ?? null;
      const changes = registry.updatePlayerParty(session.playerId, newPartyId);
      const oldPartyIds = new Set(
        changes.map(change => change.oldPartyId).filter((partyId): partyId is string => partyId !== null)
      );

      for (const oldPartyId of oldPartyIds) {
        if (registry.countPlayerConnections(session.playerId, oldPartyId) === 0) {
          broadcastPresence(oldPartyId, session.playerId, 'offline', 0);
        }
      }
      if (newPartyId && changes.some(change => change.newPartyId === newPartyId)) {
        broadcastPresence(
          newPartyId,
          session.playerId,
          'online',
          registry.countPlayerConnections(session.playerId, newPartyId),
          connectionId
        );
      }

      const snapshot = createServerMessage('party.snapshot', requestId, partySnapshotPayload(party));
      send(snapshot);
      for (const connection of registry.getByPlayer(session.playerId)) {
        if (connection.session.connectionId !== connectionId && changes.some(change => change.connection === connection)) {
          try {
            if (connection.socket.readyState === socket.OPEN) {
              connection.socket.send(stringifyMessage(createServerMessage('party.snapshot', null, partySnapshotPayload(party))));
            }
          } catch {
            try {
              connection.socket.close(WEBSOCKET_CLOSE_CODES.INTERNAL_ERROR, WEBSOCKET_CLOSE_REASONS.INTERNAL_ERROR);
            } catch {
              // Cleanup remains owned by the connection's close handler.
            }
          }
        }
      }
      logger.info({ connectionId, playerId: session.playerId, oldPartyIds: [...oldPartyIds], newPartyId }, 'websocket party scope refreshed');
    };

    const handleAuthenticatedMessage = async (message: Exclude<ClientMessage, { type: 'auth' }>): Promise<void> => {
      if (message.type === 'ping') {
        send(createServerMessage('pong', message.requestId, { serverTimestamp: Date.now() }));
        return;
      }
      if (message.type === 'party.refresh') {
        await refreshPartyScope(message.requestId);
        return;
      }
      if (!session.playerId) {
        if (message.type === 'party.state.get') {
          send(createServerMessage('party.state.error', message.requestId, {
            errorCode: 'not_authenticated',
            serverTimestamp: Date.now()
          }));
        } else {
          send(createServerMessage('party.command.result', message.requestId, {
            commandId: message.payload.commandId,
            accepted: false,
            resultingRevision: null,
            currentRevision: null,
            errorCode: 'not_authenticated',
            serverTimestamp: Date.now()
          }));
        }
        return;
      }

      if (message.type === 'party.state.get') {
        try {
          const result = await partyStateService.getState(session.playerId, session.partyId);
          if (result.reconciled) broadcastPartyState(result.state.partyId, result.state, result.party.members.map(member => member.playerId));
          send(createServerMessage('party.state.snapshot', message.requestId, partyStateSnapshotPayload(result.state)));
        } catch (error) {
          const code: PartyStateErrorCode = error instanceof PartyStateError ? error.code : 'internal_error';
          if (!(error instanceof PartyStateError)) {
            logger.error({ connectionId, playerId: session.playerId, error: safeErrorName(error) }, 'party state read failed');
          }
          send(createServerMessage('party.state.error', message.requestId, {
            errorCode: code,
            serverTimestamp: Date.now()
          }));
        }
        return;
      }

      if (!consumePartyCommandRateLimit(message)) {
        send(createServerMessage('party.command.result', message.requestId, {
          commandId: message.payload.commandId,
          accepted: false,
          resultingRevision: null,
          currentRevision: null,
          errorCode: 'rate_limited',
          serverTimestamp: Date.now()
        }));
        return;
      }

      try {
        const result = await partyStateService.executeCommand(session.playerId, session.partyId, message.payload);
        if (result.accepted && !result.duplicate || result.reconciled) {
          broadcastPartyState(result.state.partyId, result.state, result.memberPlayerIds);
        }
        logger.info({
          connectionId,
          playerId: session.playerId,
          partyId: result.state.partyId,
          commandId: result.commandId,
          commandType: message.payload.command.type,
          accepted: result.accepted,
          duplicate: result.duplicate,
          resultingRevision: result.resultingRevision,
          errorCode: result.errorCode
        }, result.accepted ? 'party command accepted' : 'party command rejected');
        send(createServerMessage('party.command.result', message.requestId, {
          commandId: result.commandId,
          accepted: result.accepted,
          resultingRevision: result.resultingRevision,
          currentRevision: result.currentRevision,
          errorCode: result.errorCode,
          serverTimestamp: Date.now()
        }));
      } catch (error) {
        const code: PartyStateErrorCode = error instanceof PartyStateError ? error.code : 'internal_error';
        if (!(error instanceof PartyStateError)) {
          logger.error({ connectionId, playerId: session.playerId, error: safeErrorName(error) }, 'party command failed');
        }
        send(createServerMessage('party.command.result', message.requestId, {
          commandId: message.payload.commandId,
          accepted: false,
          resultingRevision: null,
          currentRevision: null,
          errorCode: code,
          serverTimestamp: Date.now()
        }));
      }
    };

    const acceptAuthenticatedConnection = async (context: Awaited<ReturnType<typeof authenticateToken>>): Promise<void> => {
      if (!context || cleanedUp || closing) return;
      if (registry.countPlayerConnections(context.player.id) >= config.websocketMaxConnectionsPerPlayer) {
        logger.warn({ connectionId, playerId: context.player.id, reason: WEBSOCKET_CLOSE_REASONS.CONNECTION_LIMIT }, 'websocket connection limit exceeded');
        closeConnection(WEBSOCKET_CLOSE_CODES.CONNECTION_LIMIT, WEBSOCKET_CLOSE_REASONS.CONNECTION_LIMIT);
        return;
      }

      const party = await partyService.getCurrentParty(context.player.id);
      if (cleanedUp || closing) return;

      session.playerId = context.player.id;
      session.sessionId = context.session.id;
      session.partyId = party?.party.id ?? null;
      registry.register({ session, socket: registrySocket });
      registered = true;
      pendingSockets.delete(registrySocket);
      if (authTimer) clearTimeout(authTimer);
      authTimer = undefined;
      scheduleIdleTimeout();

      const ready = createServerMessage('connection.ready', null, {
        connectionId,
        playerId: context.player.id,
        partyId: session.partyId,
        partyMemberIds: party?.members.map(member => member.playerId) ?? [],
        serverTimestamp: Date.now(),
        protocolVersion: WEBSOCKET_PROTOCOL_VERSION
      });
      if (!send(ready)) return;

      if (session.partyId) {
        broadcastPresence(
          session.partyId,
          context.player.id,
          'online',
          registry.countPlayerConnections(context.player.id, session.partyId),
          connectionId
        );
      }
      logger.info({ connectionId, playerId: context.player.id, partyId: session.partyId }, 'authenticated websocket connection established');
    };

    const handleMessage = async (raw: RawData, isBinary: boolean): Promise<void> => {
      if (cleanedUp) return;
      const messageBytes = rawMessageByteLength(raw);
      if (messageBytes > config.websocketMaxMessageBytes) {
        logger.warn({ connectionId, playerId: session.playerId, reason: WEBSOCKET_CLOSE_REASONS.MESSAGE_TOO_LARGE }, 'websocket message too large');
        closeConnection(WEBSOCKET_CLOSE_CODES.MESSAGE_TOO_LARGE, WEBSOCKET_CLOSE_REASONS.MESSAGE_TOO_LARGE);
        return;
      }
      if (!consumeRateLimit()) return;

      const rawText = rawMessageToText(raw, isBinary);
      if (rawText === null) {
        closeConnection(WEBSOCKET_CLOSE_CODES.INVALID_MESSAGE, WEBSOCKET_CLOSE_REASONS.BINARY_MESSAGE);
        return;
      }
      session.lastActivityAt = Date.now();
      scheduleIdleTimeout();

      const parsed = parseClientMessage(rawText, session.status === 'authenticating');
      if (!parsed.ok) {
        logger.warn({ connectionId, playerId: session.playerId, reason: failureReason(parsed.failure) }, 'websocket protocol validation failed');
        closeConnection(failureCode(parsed.failure), failureReason(parsed.failure));
        return;
      }

      if (parsed.message.type === 'party.command' && messageBytes > config.partyStateMaxCommandPayloadBytes) {
        send(createServerMessage('party.command.result', parsed.message.requestId, {
          commandId: parsed.message.payload.commandId,
          accepted: false,
          resultingRevision: null,
          currentRevision: null,
          errorCode: 'invalid_command',
          serverTimestamp: Date.now()
        }));
        return;
      }

      if (session.status === 'authenticating') {
        if (parsed.message.type !== 'auth') {
          closeConnection(WEBSOCKET_CLOSE_CODES.AUTH_REQUIRED, WEBSOCKET_CLOSE_REASONS.AUTH_REQUIRED);
          return;
        }
        const context = await authenticateToken(database, parsed.message.payload.token);
        if (!context) {
          logger.warn({ connectionId, reason: WEBSOCKET_CLOSE_REASONS.AUTH_FAILED }, 'websocket first-message authentication rejected');
          closeConnection(WEBSOCKET_CLOSE_CODES.AUTH_FAILED, WEBSOCKET_CLOSE_REASONS.AUTH_FAILED);
          return;
        }
        await acceptAuthenticatedConnection(context);
        return;
      }

      if (parsed.message.type === 'auth') {
        closeConnection(WEBSOCKET_CLOSE_CODES.INVALID_MESSAGE, WEBSOCKET_CLOSE_REASONS.UNKNOWN_MESSAGE_TYPE);
        return;
      }
      await handleAuthenticatedMessage(parsed.message);
    };

    const handleUnexpectedError = (error: unknown): void => {
      if (cleanedUp) return;
      logger.error({ connectionId, playerId: session.playerId, error: safeErrorName(error) }, 'unexpected websocket handler error');
      closeConnection(WEBSOCKET_CLOSE_CODES.INTERNAL_ERROR, WEBSOCKET_CLOSE_REASONS.INTERNAL_ERROR);
    };

    const enqueueMessage = (raw: RawData, isBinary: boolean): void => {
      messageChain = messageChain.then(() => handleMessage(raw, isBinary)).catch(handleUnexpectedError);
    };

    const handleSocketError = (error: Error): void => {
      const isPayloadError = error.message.toLowerCase().includes('max payload');
      if (isPayloadError) {
        closeConnection(WEBSOCKET_CLOSE_CODES.MESSAGE_TOO_LARGE, WEBSOCKET_CLOSE_REASONS.MESSAGE_TOO_LARGE);
        return;
      }
      logger.error({ connectionId, playerId: session.playerId, error: safeErrorName(error) }, 'websocket socket error');
      closeConnection(WEBSOCKET_CLOSE_CODES.INTERNAL_ERROR, WEBSOCKET_CLOSE_REASONS.INTERNAL_ERROR);
    };

    socket.on('message', enqueueMessage);
    socket.on('pong', () => {
      if (session.status === 'connected') {
        session.lastActivityAt = Date.now();
        scheduleIdleTimeout();
      }
    });
    socket.once('error', handleSocketError);
    socket.once('close', (code: number) => cleanup(code));

    if (request.currentPlayer && request.currentSession) {
      void acceptAuthenticatedConnection({ player: request.currentPlayer, session: request.currentSession }).catch(handleUnexpectedError);
    } else {
      authTimer = setTimeout(() => {
        logger.info({ connectionId, reason: WEBSOCKET_CLOSE_REASONS.AUTH_TIMEOUT }, 'websocket authentication timed out');
        closeConnection(WEBSOCKET_CLOSE_CODES.AUTH_REQUIRED, WEBSOCKET_CLOSE_REASONS.AUTH_TIMEOUT);
      }, config.websocketAuthTimeoutMs);
      authTimer.unref?.();
    }
  });

  return {
    close(): void {
      closing = true;
      for (const socket of pendingSockets) {
        try {
          socket.close(1001, WEBSOCKET_CLOSE_REASONS.SERVER_SHUTDOWN);
        } catch {
          // Shutdown continues for the remaining sockets.
        }
      }
      pendingSockets.clear();
      registry.closeAll(1001, WEBSOCKET_CLOSE_REASONS.SERVER_SHUTDOWN);
    },
    getRegistry(): ConnectionRegistry {
      return registry;
    }
  };
}
