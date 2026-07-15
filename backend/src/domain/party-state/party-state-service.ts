import { createHash } from 'node:crypto';
import type { Pool, PoolClient, QueryResultRow } from 'pg';
import { createPostgresPartyRepositoryWithClient } from '../parties/postgres-party-repository.js';
import type { PartyWithMembers } from '../parties/party.js';
import {
  PARTY_ACTIVITY_KIND,
  PartyStateError,
  type PartyCommandResult,
  type PartyState,
  type PartyStateCommandInput,
  type PartyStateErrorCode
} from './party-state.js';

export interface PartyStateConfig {
  expeditionDurationMs: number;
  maxContribution: number;
  maxCommandIdLength: number;
}

export interface PartyStateAccessResult {
  party: PartyWithMembers;
  state: PartyState;
  reconciled: boolean;
}

export interface PartyStateService {
  getState(playerId: string, expectedPartyId: string | null): Promise<PartyStateAccessResult>;
  executeCommand(
    playerId: string,
    expectedPartyId: string | null,
    input: PartyStateCommandInput
  ): Promise<PartyCommandResult>;
}

interface PartyStateRow extends QueryResultRow {
  party_id: string;
  revision: string;
  activity_kind: string;
  status: PartyState['activity']['status'];
  destination: string | null;
  started_at: Date | null;
  completes_at: Date | null;
  updated_at: Date;
}

interface ContributionRow extends QueryResultRow {
  player_id: string;
  amount: string;
}

interface CommandRow extends QueryResultRow {
  party_id: string;
  command_id: string;
  player_id: string;
  command_type: string;
  request_hash: string;
  status: 'accepted' | 'rejected';
  resulting_revision: string | null;
  current_revision: string | null;
  error_code: PartyStateErrorCode | null;
}

function mapState(row: PartyStateRow, contributions: Record<string, number>): PartyState {
  if (row.activity_kind !== PARTY_ACTIVITY_KIND) {
    throw new Error('Unsupported persisted party activity kind.');
  }

  return {
    partyId: row.party_id,
    revision: Number(row.revision),
    activity: {
      kind: PARTY_ACTIVITY_KIND,
      status: row.status,
      destination: row.destination === null ? null : row.destination as PartyState['activity']['destination'],
      startedAt: row.started_at,
      completesAt: row.completes_at
    },
    contributions,
    updatedAt: row.updated_at
  };
}

function requestHash(input: PartyStateCommandInput): string {
  const normalized = JSON.stringify({
    expectedRevision: input.expectedRevision,
    command: input.command
  });
  return createHash('sha256').update(normalized, 'utf8').digest('hex');
}

function commandErrorMessage(code: PartyStateErrorCode): string {
  switch (code) {
    case 'invalid_command': return 'The party command is not supported.';
    case 'invalid_destination': return 'The expedition destination is not supported.';
    case 'invalid_contribution': return 'The contribution amount is outside the allowed range.';
    case 'activity_not_idle': return 'The expedition is not idle.';
    case 'activity_not_active': return 'The expedition is not active.';
    case 'activity_not_completed': return 'The expedition is not completed.';
    case 'revision_conflict': return 'The party state revision is stale.';
    case 'not_party_leader': return 'Only the party leader can reset the expedition.';
    case 'duplicate_command_mismatch': return 'The command ID was already used with different content.';
    case 'not_in_party': return 'The player is not currently in a party.';
    case 'party_refresh_required': return 'Refresh the party scope before using authoritative state.';
    case 'rate_limited': return 'Party commands are temporarily rate limited.';
    case 'not_authenticated': return 'Authentication is required.';
    case 'internal_error': return 'The party state is temporarily unavailable.';
  }
}

function createStateRepository(client: PoolClient) {
  async function ensureState(partyId: string): Promise<PartyStateRow> {
    await client.query(
      `INSERT INTO party_states (party_id)
       VALUES ($1)
       ON CONFLICT (party_id) DO NOTHING`,
      [partyId]
    );
    const { rows } = await client.query<PartyStateRow>(
      `SELECT party_id, revision, activity_kind, status, destination, started_at, completes_at, updated_at
       FROM party_states
       WHERE party_id = $1
       FOR UPDATE`,
      [partyId]
    );
    if (rows.length === 0) throw new Error('Party state was not available after initialization.');
    return rows[0];
  }

  async function listContributions(partyId: string, members: string[]): Promise<Record<string, number>> {
    const { rows } = await client.query<ContributionRow>(
      `SELECT pm.player_id, COALESCE(c.amount, 0)::text AS amount
       FROM party_memberships pm
       LEFT JOIN party_state_contributions c
         ON c.party_id = pm.party_id AND c.player_id = pm.player_id
       WHERE pm.party_id = $1
       ORDER BY pm.joined_at ASC, pm.player_id ASC`,
      [partyId]
    );
    const contributions: Record<string, number> = {};
    for (const playerId of members) contributions[playerId] = 0;
    for (const row of rows) contributions[row.player_id] = Number(row.amount);
    return contributions;
  }

  async function readState(row: PartyStateRow, members: string[]): Promise<PartyState> {
    return mapState(row, await listContributions(row.party_id, members));
  }

  async function reconcile(row: PartyStateRow, members: string[]): Promise<{ row: PartyStateRow; state: PartyState; reconciled: boolean }> {
    if (row.status === 'active' && row.completes_at !== null && row.completes_at.getTime() <= Date.now()) {
      const updated = await client.query<PartyStateRow>(
        `UPDATE party_states
         SET status = 'completed', revision = revision + 1
         WHERE party_id = $1 AND status = 'active' AND completes_at <= NOW()
         RETURNING party_id, revision, activity_kind, status, destination, started_at, completes_at, updated_at`,
        [row.party_id]
      );
      if (updated.rows.length > 0) {
        row = updated.rows[0];
        return { row, state: await readState(row, members), reconciled: true };
      }
    }
    return { row, state: await readState(row, members), reconciled: false };
  }

  async function getCommand(partyId: string, commandId: string): Promise<CommandRow | null> {
    const { rows } = await client.query<CommandRow>(
      `SELECT party_id, command_id, player_id, command_type, request_hash, status,
              resulting_revision, current_revision, error_code
       FROM party_commands
       WHERE party_id = $1 AND command_id = $2
       FOR UPDATE`,
      [partyId, commandId]
    );
    return rows[0] ?? null;
  }

  async function insertCommand(
    partyId: string,
    playerId: string,
    input: PartyStateCommandInput,
    hash: string,
    accepted: boolean,
    revision: number,
    errorCode: PartyStateErrorCode | null
  ): Promise<void> {
    await client.query(
      `INSERT INTO party_commands
         (party_id, command_id, player_id, command_type, request_hash, status,
          resulting_revision, current_revision, error_code)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
      [
        partyId,
        input.commandId,
        playerId,
        input.command.type,
        hash,
        accepted ? 'accepted' : 'rejected',
        accepted ? revision : null,
        accepted ? null : revision,
        errorCode
      ]
    );
  }

  return { ensureState, readState, reconcile, getCommand, insertCommand };
}

function assertPartyScope(party: PartyWithMembers | null, expectedPartyId: string | null): PartyWithMembers {
  if (!party) {
    if (expectedPartyId !== null) {
      throw new PartyStateError('party_refresh_required', commandErrorMessage('party_refresh_required'));
    }
    throw new PartyStateError('not_in_party', commandErrorMessage('not_in_party'));
  }
  if (party.party.id !== expectedPartyId) {
    throw new PartyStateError('party_refresh_required', commandErrorMessage('party_refresh_required'));
  }
  return party;
}

function duplicateResult(
  command: CommandRow,
  state: PartyState
): Pick<PartyCommandResult, 'accepted' | 'resultingRevision' | 'currentRevision' | 'errorCode'> {
  if (command.status === 'accepted') {
    const revision = Number(command.resulting_revision);
    return { accepted: true, resultingRevision: revision, currentRevision: revision, errorCode: null };
  }
  return {
    accepted: false,
    resultingRevision: null,
    currentRevision: Number(command.current_revision ?? state.revision),
    errorCode: command.error_code ?? 'internal_error'
  };
}

export function createPartyStateService(pool: Pool, config: PartyStateConfig): PartyStateService {
  if (config.expeditionDurationMs < 1 || config.maxContribution < 10 || config.maxCommandIdLength < 1) {
    throw new Error('Invalid party state configuration.');
  }

  async function withAuthorizedParty<T>(
    playerId: string,
    expectedPartyId: string | null,
    work: (client: PoolClient, party: PartyWithMembers) => Promise<T>
  ): Promise<T> {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const partyRepository = createPostgresPartyRepositoryWithClient(client);
      if (!await partyRepository.lockPlayer(playerId)) {
        throw new PartyStateError('not_authenticated', commandErrorMessage('not_authenticated'));
      }
      const memberParty = await partyRepository.findByMemberId(playerId, true);
      const party = assertPartyScope(
        memberParty ? await partyRepository.getWithMembers(memberParty.id) : null,
        expectedPartyId
      );
      const result = await work(client, party);
      await client.query('COMMIT');
      return result;
    } catch (error) {
      try {
        await client.query('ROLLBACK');
      } catch {
        // Preserve the original error while releasing the client.
      }
      throw error;
    } finally {
      client.release();
    }
  }

  async function getState(playerId: string, expectedPartyId: string | null): Promise<PartyStateAccessResult> {
    return withAuthorizedParty(playerId, expectedPartyId, async (client, party) => {
      const repository = createStateRepository(client);
      const initial = await repository.ensureState(party.party.id);
      const memberIds = party.members.map(member => member.playerId);
      const reconciled = await repository.reconcile(initial, memberIds);
      return { party, state: reconciled.state, reconciled: reconciled.reconciled };
    });
  }

  async function executeCommand(
    playerId: string,
    expectedPartyId: string | null,
    input: PartyStateCommandInput
  ): Promise<PartyCommandResult> {
    if (!Number.isSafeInteger(input.expectedRevision) || input.expectedRevision < 0) {
      throw new PartyStateError('invalid_command', commandErrorMessage('invalid_command'));
    }
    if (typeof input.commandId !== 'string' || input.commandId.length < 1 || input.commandId.length > config.maxCommandIdLength) {
      throw new PartyStateError('invalid_command', commandErrorMessage('invalid_command'));
    }

    return withAuthorizedParty(playerId, expectedPartyId, async (client, party) => {
      const repository = createStateRepository(client);
      const initial = await repository.ensureState(party.party.id);
      const memberIds = party.members.map(member => member.playerId);
      const reconciled = await repository.reconcile(initial, memberIds);
      let state = reconciled.state;
      const hash = requestHash(input);
      const existing = await repository.getCommand(party.party.id, input.commandId);
      if (existing) {
        if (existing.request_hash !== hash) {
          return {
            commandId: input.commandId,
            accepted: false,
            resultingRevision: null,
            currentRevision: state.revision,
            errorCode: 'duplicate_command_mismatch',
            state,
            memberPlayerIds: memberIds,
            reconciled: reconciled.reconciled,
            duplicate: true
          };
        }
        return {
          commandId: input.commandId,
          ...duplicateResult(existing, state),
          state,
          memberPlayerIds: memberIds,
          reconciled: reconciled.reconciled,
          duplicate: true
        };
      }

      let errorCode: PartyStateErrorCode | null = null;
      if (input.command.type === 'expedition.start') {
        if (input.command.destination !== 'forest') errorCode = 'invalid_destination';
        else if (state.activity.status !== 'idle') errorCode = 'activity_not_idle';
      } else if (input.command.type === 'expedition.contribute') {
        if (!Number.isSafeInteger(input.command.amount) || Number(input.command.amount) < 1 || Number(input.command.amount) > 10) {
          errorCode = 'invalid_contribution';
        } else if (state.activity.status !== 'active') {
          errorCode = 'activity_not_active';
        } else {
          const currentAmount = state.contributions[playerId] ?? 0;
          if (currentAmount + Number(input.command.amount) > config.maxContribution) errorCode = 'invalid_contribution';
        }
      } else if (input.command.type === 'expedition.reset') {
        if (party.party.leaderId !== playerId) errorCode = 'not_party_leader';
        else if (state.activity.status !== 'completed') errorCode = 'activity_not_completed';
      } else {
        errorCode = 'invalid_command';
      }

      if (!errorCode && input.expectedRevision !== state.revision) errorCode = 'revision_conflict';

      if (errorCode) {
        await repository.insertCommand(party.party.id, playerId, input, hash, false, state.revision, errorCode);
        return {
          commandId: input.commandId,
          accepted: false,
          resultingRevision: null,
          currentRevision: state.revision,
          errorCode,
          state,
          memberPlayerIds: memberIds,
          reconciled: reconciled.reconciled,
          duplicate: false
        };
      }

      let updated: { rows: PartyStateRow[] };
      if (input.command.type === 'expedition.start') {
        updated = await client.query<PartyStateRow>(
          `UPDATE party_states
           SET status = 'active', destination = 'forest', started_at = NOW(),
               completes_at = NOW() + ($2::double precision * INTERVAL '1 millisecond'),
               revision = revision + 1
           WHERE party_id = $1 AND revision = $3 AND status = 'idle'
           RETURNING party_id, revision, activity_kind, status, destination, started_at, completes_at, updated_at`,
          [party.party.id, config.expeditionDurationMs, input.expectedRevision]
        );
      } else if (input.command.type === 'expedition.contribute') {
        updated = await client.query<PartyStateRow>(
          `UPDATE party_states
           SET revision = revision + 1
           WHERE party_id = $1 AND revision = $2 AND status = 'active' AND completes_at > NOW()
           RETURNING party_id, revision, activity_kind, status, destination, started_at, completes_at, updated_at`,
          [party.party.id, input.expectedRevision]
        );
        if (updated.rows.length > 0) {
          await client.query(
            `INSERT INTO party_state_contributions (party_id, player_id, amount)
             VALUES ($1, $2, $3)
             ON CONFLICT (party_id, player_id)
             DO UPDATE SET amount = party_state_contributions.amount + EXCLUDED.amount`,
            [party.party.id, playerId, input.command.amount]
          );
        }
      } else {
        updated = await client.query<PartyStateRow>(
          `UPDATE party_states
           SET status = 'idle', destination = NULL, started_at = NULL, completes_at = NULL, revision = revision + 1
           WHERE party_id = $1 AND revision = $2 AND status = 'completed'
           RETURNING party_id, revision, activity_kind, status, destination, started_at, completes_at, updated_at`,
          [party.party.id, input.expectedRevision]
        );
        if (updated.rows.length > 0) {
          await client.query('DELETE FROM party_state_contributions WHERE party_id = $1', [party.party.id]);
        }
      }

      if (updated.rows.length === 0) {
        const current = await repository.ensureState(party.party.id);
        state = await repository.readState(current, memberIds);
        await repository.insertCommand(party.party.id, playerId, input, hash, false, state.revision, 'revision_conflict');
        return {
          commandId: input.commandId,
          accepted: false,
          resultingRevision: null,
          currentRevision: state.revision,
          errorCode: 'revision_conflict',
          state,
          memberPlayerIds: memberIds,
          reconciled: reconciled.reconciled,
          duplicate: false
        };
      }

      state = await repository.readState(updated.rows[0], memberIds);
      await repository.insertCommand(party.party.id, playerId, input, hash, true, state.revision, null);
      return {
        commandId: input.commandId,
        accepted: true,
        resultingRevision: state.revision,
        currentRevision: state.revision,
        errorCode: null,
        state,
        memberPlayerIds: memberIds,
        reconciled: reconciled.reconciled,
        duplicate: false
      };
    });
  }

  return Object.freeze({ getState, executeCommand });
}

export function partyStateErrorMessage(code: PartyStateErrorCode): string {
  return commandErrorMessage(code);
}
