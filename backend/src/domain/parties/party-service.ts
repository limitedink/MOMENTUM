import { randomBytes } from 'crypto';
import { DEFAULT_PARTY_MAX_MEMBERS } from './party.js';
import type {
  Party,
  PartyMembership,
  PartyWithMembers,
  TransactionalPartyRepository
} from './party.js';

const JOIN_CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
export const PARTY_JOIN_CODE_LENGTH = 10;
const JOIN_CODE_ATTEMPTS = 5;

export type PartyServiceErrorCode =
  | 'player_not_found'
  | 'already_in_party'
  | 'party_not_found'
  | 'party_full'
  | 'not_in_party'
  | 'invalid_join_code'
  | 'join_code_unavailable';

export class PartyServiceError extends Error {
  constructor(
    public readonly code: PartyServiceErrorCode,
    public readonly statusCode: number,
    message: string
  ) {
    super(message);
    this.name = 'PartyServiceError';
  }
}

export interface PartyService {
  createParty(playerId: string): Promise<PartyWithMembers>;
  getCurrentParty(playerId: string): Promise<PartyWithMembers | null>;
  joinParty(playerId: string, rawJoinCode: unknown): Promise<PartyWithMembers>;
  leaveParty(playerId: string): Promise<PartyWithMembers | null>;
}

export function generateJoinCode(): string {
  const bytes = randomBytes(PARTY_JOIN_CODE_LENGTH);
  let code = '';
  for (const byte of bytes) code += JOIN_CODE_ALPHABET[byte & 31];
  return code;
}

export function normalizeJoinCode(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const normalized = value.replace(/[\s-]/g, '').toUpperCase();
  if (normalized.length !== PARTY_JOIN_CODE_LENGTH) return null;
  if ([...normalized].some(character => !JOIN_CODE_ALPHABET.includes(character))) return null;
  return normalized;
}

function isUniqueViolation(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === '23505';
}

function toPartyWithMembers(party: Party, members: PartyMembership[]): PartyWithMembers {
  return { party, members };
}

export function createPartyService(
  repository: TransactionalPartyRepository,
  maxMembers = DEFAULT_PARTY_MAX_MEMBERS
): PartyService {
  if (!Number.isInteger(maxMembers) || maxMembers < 2 || maxMembers > 8) {
    throw new Error('Party maxMembers must be an integer between 2 and 8.');
  }

  async function createParty(playerId: string): Promise<PartyWithMembers> {
    for (let attempt = 0; attempt < JOIN_CODE_ATTEMPTS; attempt += 1) {
      try {
        return await repository.withTransaction(async transaction => {
          if (!await transaction.lockPlayer(playerId)) {
            throw new PartyServiceError('player_not_found', 404, 'Player was not found.');
          }
          if (await transaction.findByMemberId(playerId)) {
            throw new PartyServiceError('already_in_party', 409, 'Player is already a member of a party.');
          }

          const party = await transaction.create({
            leaderId: playerId,
            joinCode: generateJoinCode(),
            maxMembers
          });
          await transaction.addMember(party.id, playerId);
          return toPartyWithMembers(party, await transaction.listMembers(party.id));
        });
      } catch (error) {
        if (isUniqueViolation(error)) continue;
        throw error;
      }
    }

    throw new PartyServiceError(
      'join_code_unavailable',
      503,
      'A unique party join code could not be allocated. Try again.'
    );
  }

  async function getCurrentParty(playerId: string): Promise<PartyWithMembers | null> {
    const party = await repository.findByMemberId(playerId);
    return party ? repository.getWithMembers(party.id) : null;
  }

  async function joinParty(playerId: string, rawJoinCode: unknown): Promise<PartyWithMembers> {
    const joinCode = normalizeJoinCode(rawJoinCode);
    if (!joinCode) {
      throw new PartyServiceError('invalid_join_code', 400, 'Join code is invalid.');
    }

    return repository.withTransaction(async transaction => {
      if (!await transaction.lockPlayer(playerId)) {
        throw new PartyServiceError('player_not_found', 404, 'Player was not found.');
      }
      if (await transaction.findByMemberId(playerId)) {
        throw new PartyServiceError('already_in_party', 409, 'Player is already a member of a party.');
      }

      const party = await transaction.findByJoinCode(joinCode, true);
      if (!party) {
        throw new PartyServiceError('party_not_found', 404, 'Party was not found.');
      }
      if (await transaction.countMembers(party.id) >= party.maxMembers) {
        throw new PartyServiceError('party_full', 409, 'Party is full.');
      }

      await transaction.addMember(party.id, playerId);
      return toPartyWithMembers(party, await transaction.listMembers(party.id));
    });
  }

  async function leaveParty(playerId: string): Promise<PartyWithMembers | null> {
    return repository.withTransaction(async transaction => {
      if (!await transaction.lockPlayer(playerId)) {
        throw new PartyServiceError('player_not_found', 404, 'Player was not found.');
      }

      const party = await transaction.findByMemberId(playerId, true);
      if (!party) {
        throw new PartyServiceError('not_in_party', 404, 'Player is not a member of a party.');
      }

      const members = await transaction.listMembers(party.id);
      const remainingMembers = members.filter(member => member.playerId !== playerId);
      if (remainingMembers.length === 0) {
        await transaction.delete(party.id);
        return null;
      }

      if (party.leaderId === playerId) {
        await transaction.setLeader(party.id, remainingMembers[0].playerId);
      }
      await transaction.removeMember(party.id, playerId);
      const updatedParty = await transaction.findById(party.id);
      if (!updatedParty) throw new Error('Party disappeared while its member was leaving.');
      return toPartyWithMembers(updatedParty, await transaction.listMembers(party.id));
    });
  }

  return Object.freeze({ createParty, getCurrentParty, joinParty, leaveParty });
}
