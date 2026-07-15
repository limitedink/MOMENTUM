import type { Pool, PoolClient, QueryResultRow } from 'pg';
import type {
  CreatePartyInput,
  Party,
  PartyMembership,
  PartyRepository,
  PartyWithMembers,
  TransactionalPartyRepository
} from './party.js';

interface PartyRow extends QueryResultRow {
  id: string;
  leader_id: string;
  join_code: string;
  max_members: number;
  created_at: Date;
  updated_at: Date;
}

interface MembershipRow extends QueryResultRow {
  party_id: string;
  player_id: string;
  joined_at: Date;
}

function mapParty(row: PartyRow): Party {
  return {
    id: row.id,
    leaderId: row.leader_id,
    joinCode: row.join_code,
    maxMembers: row.max_members,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

function mapMembership(row: MembershipRow): PartyMembership {
  return {
    partyId: row.party_id,
    playerId: row.player_id,
    joinedAt: row.joined_at
  };
}

function createRepository(query: <T extends QueryResultRow = QueryResultRow>(text: string, values?: unknown[]) => Promise<{ rows: T[] }>): PartyRepository {
  async function findPartyByQuery(text: string, values?: unknown[]): Promise<Party | null> {
    const { rows } = await query<PartyRow>(text, values);
    return rows.length === 0 ? null : mapParty(rows[0]);
  }

  async function listMembers(partyId: string): Promise<PartyMembership[]> {
    const { rows } = await query<MembershipRow>(
      `SELECT party_id, player_id, joined_at
       FROM party_memberships
       WHERE party_id = $1
       ORDER BY joined_at ASC, player_id ASC`,
      [partyId]
    );
    return rows.map(mapMembership);
  }

  return {
    async lockPlayer(playerId: string): Promise<boolean> {
      const { rows } = await query<{ id: string }>(
        'SELECT id FROM players WHERE id = $1 FOR UPDATE',
        [playerId]
      );
      return rows.length > 0;
    },

    async create(input: CreatePartyInput): Promise<Party> {
      const { rows } = await query<PartyRow>(
        `INSERT INTO parties (leader_id, join_code, max_members)
         VALUES ($1, $2, $3)
         RETURNING id, leader_id, join_code, max_members, created_at, updated_at`,
        [input.leaderId, input.joinCode, input.maxMembers]
      );
      return mapParty(rows[0]);
    },

    findById: (id: string) => findPartyByQuery(
      `SELECT id, leader_id, join_code, max_members, created_at, updated_at
       FROM parties WHERE id = $1`,
      [id]
    ),

    async findByJoinCode(joinCode: string, forUpdate = false): Promise<Party | null> {
      return findPartyByQuery(
        `SELECT id, leader_id, join_code, max_members, created_at, updated_at
         FROM parties WHERE join_code = $1${forUpdate ? ' FOR UPDATE' : ''}`,
        [joinCode]
      );
    },

    async findByMemberId(playerId: string, forUpdate = false): Promise<Party | null> {
      return findPartyByQuery(
        `SELECT p.id, p.leader_id, p.join_code, p.max_members, p.created_at, p.updated_at
         FROM parties p
         INNER JOIN party_memberships pm ON pm.party_id = p.id
         WHERE pm.player_id = $1${forUpdate ? ' FOR UPDATE OF p, pm' : ''}`,
        [playerId]
      );
    },

    async getWithMembers(partyId: string): Promise<PartyWithMembers | null> {
      const party = await findPartyByQuery(
        `SELECT id, leader_id, join_code, max_members, created_at, updated_at
         FROM parties WHERE id = $1`,
        [partyId]
      );
      if (!party) return null;
      return { party, members: await listMembers(partyId) };
    },

    listMembers,

    async countMembers(partyId: string): Promise<number> {
      const { rows } = await query<{ count: string }>(
        'SELECT COUNT(*)::text AS count FROM party_memberships WHERE party_id = $1',
        [partyId]
      );
      return Number(rows[0]?.count ?? 0);
    },

    async addMember(partyId: string, playerId: string): Promise<PartyMembership> {
      const { rows } = await query<MembershipRow>(
        `INSERT INTO party_memberships (party_id, player_id)
         VALUES ($1, $2)
         RETURNING party_id, player_id, joined_at`,
        [partyId, playerId]
      );
      return mapMembership(rows[0]);
    },

    async removeMember(partyId: string, playerId: string): Promise<void> {
      await query(
        'DELETE FROM party_memberships WHERE party_id = $1 AND player_id = $2',
        [partyId, playerId]
      );
    },

    async setLeader(partyId: string, playerId: string): Promise<void> {
      await query(
        'UPDATE parties SET leader_id = $2 WHERE id = $1',
        [partyId, playerId]
      );
    },

    async delete(partyId: string): Promise<void> {
      await query('DELETE FROM parties WHERE id = $1', [partyId]);
    }
  };
}

export function createPostgresPartyRepositoryWithClient(client: PoolClient): PartyRepository {
  return createRepository(<T extends QueryResultRow>(text: string, values?: unknown[]) =>
    client.query<T>(text, values)
  );
}

export function createPostgresPartyRepository(pool: Pool): TransactionalPartyRepository {
  const repository = createRepository(<T extends QueryResultRow>(text: string, values?: unknown[]) =>
    pool.query<T>(text, values)
  );

  return {
    ...repository,
    async withTransaction<T>(work: (transactionRepository: PartyRepository) => Promise<T>): Promise<T> {
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        const result = await work(createPostgresPartyRepositoryWithClient(client));
        await client.query('COMMIT');
        return result;
      } catch (error) {
        try {
          await client.query('ROLLBACK');
        } catch {
          // Preserve the original error; the client is released below.
        }
        throw error;
      } finally {
        client.release();
      }
    }
  };
}
