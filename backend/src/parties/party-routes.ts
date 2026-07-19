import type { FastifyInstance, FastifyReply } from 'fastify';
import type { Pool } from 'pg';
import { createAuthHook } from '../authentication/auth.js';
import { createPartyService, PartyServiceError, type PartyWithMembers } from '../domain/parties/index.js';
import { createPostgresPartyRepository } from '../domain/parties/postgres-party-repository.js';

function serializeParty(value: PartyWithMembers) {
  return {
    id: value.party.id,
    leaderId: value.party.leaderId,
    joinCode: value.party.joinCode,
    maxMembers: value.party.maxMembers,
    createdAt: value.party.createdAt.toISOString(),
    updatedAt: value.party.updatedAt.toISOString(),
    members: value.members.map(member => ({
      playerId: member.playerId,
      displayName: member.displayName,
      joinedAt: member.joinedAt.toISOString(),
      isLeader: member.playerId === value.party.leaderId
    }))
  };
}

function sendPartyError(reply: FastifyReply, error: unknown): void {
  if (error instanceof PartyServiceError) {
    reply.code(error.statusCode).send({
      error: error.code,
      message: error.message
    });
    return;
  }
  throw error;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

export async function registerPartyRoutes(app: FastifyInstance, database: Pool): Promise<void> {
  const service = createPartyService(createPostgresPartyRepository(database));
  const auth = createAuthHook(database);

  app.post('/v1/parties', { preHandler: auth }, async (request, reply) => {
    try {
      const party = await service.createParty(request.currentPlayer!.id);
      reply.code(201).send({ party: serializeParty(party) });
    } catch (error) {
      sendPartyError(reply, error);
    }
  });

  app.get('/v1/parties/current', { preHandler: auth }, async (request, reply) => {
    try {
      const party = await service.getCurrentParty(request.currentPlayer!.id);
      if (!party) {
        reply.code(404).send({ error: 'not_in_party', message: 'Player is not a member of a party.' });
        return;
      }
      reply.send({ party: serializeParty(party) });
    } catch (error) {
      sendPartyError(reply, error);
    }
  });

  app.post('/v1/parties/join', { preHandler: auth }, async (request, reply) => {
    try {
      const body = isRecord(request.body) ? request.body : {};
      const party = await service.joinParty(request.currentPlayer!.id, body.joinCode);
      reply.send({ party: serializeParty(party) });
    } catch (error) {
      sendPartyError(reply, error);
    }
  });

  app.delete('/v1/parties/current', { preHandler: auth }, async (request, reply) => {
    try {
      await service.leaveParty(request.currentPlayer!.id);
      reply.code(204).send();
    } catch (error) {
      sendPartyError(reply, error);
    }
  });
}
