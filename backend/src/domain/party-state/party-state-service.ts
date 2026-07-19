import { createHash } from 'node:crypto';
import type { Pool, PoolClient, QueryResultRow } from 'pg';
import { createPostgresPartyRepositoryWithClient } from '../parties/postgres-party-repository.js';
import type { PartyWithMembers } from '../parties/party.js';
import {
  PARTY_ACTIVITY_KIND,
  PARTY_MEMBER_ACTIVITY_IDS,
  PartyStateError,
  type PartyMemberActivityId,
  type PartyReward,
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

interface MemberActivityRow extends QueryResultRow {
  player_id: string;
  activity_id: PartyState['memberActivities'][string];
}

interface ActivitySegmentRow extends QueryResultRow {
  player_id: string;
  activity_id: PartyMemberActivityId;
  started_at: Date;
  ended_at: Date | null;
}

interface RewardRow extends QueryResultRow {
  player_id: string;
  reward_json: unknown;
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

function mapState(
  row: PartyStateRow,
  contributions: Record<string, number>,
  memberActivities: PartyState['memberActivities'],
  pendingRewards: Record<string, PartyReward[]>
): PartyState {
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
    memberActivities,
    pendingRewards,
    updatedAt: row.updated_at
  };
}

function rewardItemForActivity(activityId: PartyMemberActivityId): keyof PartyReward['rewards'] {
  if (activityId === 'forest_patrol') return 'bossKeys';
  if (activityId === 'pine_chopping') return 'pineLogs';
  if (activityId === 'camp_cooking') return 'cookedFish';
  return 'game';
}

function createActivityReward(
  rewardId: string,
  ownDurations: Record<PartyMemberActivityId, number>,
  partyDurations: Record<PartyMemberActivityId, number>
): PartyReward {
  const primaryActivity = PARTY_MEMBER_ACTIVITY_IDS.reduce((best, activityId) =>
    ownDurations[activityId] > ownDurations[best] ? activityId : best,
    'rest' as PartyMemberActivityId
  );
  const primarySeconds = Math.max(1, Math.round(ownDurations[primaryActivity] / 1000));
  const partyXp: Partial<Record<PartyMemberActivityId, number>> = {};
  for (const activityId of PARTY_MEMBER_ACTIVITY_IDS) {
    const xp = Math.max(0, Math.round(partyDurations[activityId] / 1000 * 0.25));
    if (xp > 0) partyXp[activityId] = xp;
  }
  const rewards = { bossKeys: 0, pineLogs: 0, cookedFish: 0, game: 0 };
  rewards[rewardItemForActivity(primaryActivity)] = Math.max(1, Math.floor(primarySeconds / 30));
  return {
    id: rewardId,
    primaryActivity,
    primaryXp: primarySeconds,
    partyXp,
    rewards
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
    case 'invalid_activity': return 'That party activity is not available.';
    case 'activity_not_idle': return 'The expedition is not idle.';
    case 'activity_not_active': return 'The expedition is not active.';
    case 'activity_not_completed': return 'The expedition is not completed.';
    case 'reward_not_available': return 'That expedition reward is no longer available.';
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

  async function listMemberActivities(partyId: string, members: string[]): Promise<PartyState['memberActivities']> {
    await client.query(
      `INSERT INTO party_member_activities (party_id, player_id)
       SELECT party_id, player_id
       FROM party_memberships
       WHERE party_id = $1
       ON CONFLICT (party_id, player_id) DO NOTHING`,
      [partyId]
    );
    const { rows } = await client.query<MemberActivityRow>(
      `SELECT player_id, activity_id
       FROM party_member_activities
       WHERE party_id = $1`,
      [partyId]
    );
    const activities: PartyState['memberActivities'] = {};
    for (const playerId of members) activities[playerId] = 'rest';
    for (const row of rows) activities[row.player_id] = row.activity_id;
    return activities;
  }

  async function listPendingRewards(partyId: string, members: string[]): Promise<Record<string, PartyReward[]>> {
    const pendingRewards: Record<string, PartyReward[]> = {};
    for (const playerId of members) pendingRewards[playerId] = [];
    const { rows } = await client.query<RewardRow>(
      `SELECT player_id, reward_json
       FROM party_state_rewards
       WHERE party_id = $1 AND claimed_at IS NULL
       ORDER BY created_at ASC, reward_id ASC`,
      [partyId]
    );
    for (const row of rows) {
      if (!pendingRewards[row.player_id]) continue;
      const reward = typeof row.reward_json === 'string' ? JSON.parse(row.reward_json) : row.reward_json;
      if (reward && typeof reward === 'object' && !Array.isArray(reward)) pendingRewards[row.player_id].push(reward as PartyReward);
    }
    return pendingRewards;
  }

  async function readState(row: PartyStateRow, members: string[]): Promise<PartyState> {
    const [contributions, memberActivities, pendingRewards] = await Promise.all([
      listContributions(row.party_id, members),
      listMemberActivities(row.party_id, members),
      listPendingRewards(row.party_id, members)
    ]);
    return mapState(row, contributions, memberActivities, pendingRewards);
  }

  async function createCompletionRewards(row: PartyStateRow, members: string[], memberActivities: PartyState['memberActivities']): Promise<void> {
    if (!row.started_at || !row.completes_at) return;
    const rewardId = `expedition-${row.party_id}-${row.started_at.getTime()}`;
    const { rows } = await client.query<ActivitySegmentRow>(
      `SELECT player_id, activity_id, started_at, ended_at
       FROM party_state_activity_segments
       WHERE party_id = $1
         AND started_at < $3
         AND (ended_at IS NULL OR ended_at > $2)
       ORDER BY started_at ASC, id ASC`,
      [row.party_id, row.started_at, row.completes_at]
    );
    const durationMs = Math.max(1, row.completes_at.getTime() - row.started_at.getTime());
    const ownDurationsByPlayer = new Map<string, Record<PartyMemberActivityId, number>>();
    const partyDurations: Record<PartyMemberActivityId, number> = { forest_patrol: 0, pine_chopping: 0, camp_cooking: 0, rest: 0 };
    for (const playerId of members) {
      const durations = { forest_patrol: 0, pine_chopping: 0, camp_cooking: 0, rest: 0 };
      ownDurationsByPlayer.set(playerId, durations);
    }
    for (const segment of rows) {
      const playerDurations = ownDurationsByPlayer.get(segment.player_id);
      if (!playerDurations) continue;
      const segmentStart = Math.max(row.started_at.getTime(), segment.started_at.getTime());
      const segmentEnd = Math.min(row.completes_at.getTime(), segment.ended_at?.getTime() ?? row.completes_at.getTime());
      const segmentDuration = Math.max(0, segmentEnd - segmentStart);
      playerDurations[segment.activity_id] += segmentDuration;
      partyDurations[segment.activity_id] += segmentDuration;
    }
    for (const playerId of members) {
      const durations = ownDurationsByPlayer.get(playerId)!;
      if (Object.values(durations).every(value => value === 0)) {
        durations[memberActivities[playerId] || 'rest'] = durationMs;
        partyDurations[memberActivities[playerId] || 'rest'] += durationMs;
      }
    }
    for (const playerId of members) {
      const durations = ownDurationsByPlayer.get(playerId)!;
      const reward = createActivityReward(rewardId, durations, partyDurations);
      await client.query(
        `INSERT INTO party_state_rewards (party_id, player_id, reward_id, reward_json)
         VALUES ($1, $2, $3, $4::jsonb)
         ON CONFLICT (party_id, player_id, reward_id) DO NOTHING`,
        [row.party_id, playerId, rewardId, JSON.stringify(reward)]
      );
    }
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
        const memberActivities = await listMemberActivities(row.party_id, members);
        await createCompletionRewards(row, members, memberActivities);
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
      } else if (input.command.type === 'party.activity.set') {
        if (!PARTY_MEMBER_ACTIVITY_IDS.includes(input.command.activityId as typeof PARTY_MEMBER_ACTIVITY_IDS[number])) errorCode = 'invalid_activity';
      } else if (input.command.type === 'expedition.reward.claim') {
        if (typeof input.command.rewardId !== 'string' || input.command.rewardId.length < 1 || input.command.rewardId.length > 160 ||
          !(state.pendingRewards[playerId] || []).some(reward => reward.id === input.command.rewardId)) errorCode = 'reward_not_available';
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
        if (updated.rows.length > 0) {
          const activityState = await repository.readState(updated.rows[0], memberIds);
          for (const memberId of memberIds) {
            await client.query(
              `INSERT INTO party_state_activity_segments (party_id, player_id, activity_id, started_at)
               VALUES ($1, $2, $3, $4)`,
              [party.party.id, memberId, activityState.memberActivities[memberId] || 'rest', updated.rows[0].started_at]
            );
          }
        }
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
      } else if (input.command.type === 'party.activity.set') {
        updated = await client.query<PartyStateRow>(
          `UPDATE party_states
           SET revision = revision + 1
           WHERE party_id = $1 AND revision = $2
           RETURNING party_id, revision, activity_kind, status, destination, started_at, completes_at, updated_at`,
          [party.party.id, input.expectedRevision]
        );
        if (updated.rows.length > 0) {
          if (updated.rows[0].status === 'active') {
            await client.query(
              `UPDATE party_state_activity_segments
               SET ended_at = NOW()
               WHERE party_id = $1 AND player_id = $2 AND ended_at IS NULL`,
              [party.party.id, playerId]
            );
            await client.query(
              `INSERT INTO party_state_activity_segments (party_id, player_id, activity_id, started_at)
               VALUES ($1, $2, $3, NOW())`,
              [party.party.id, playerId, input.command.activityId]
            );
          }
          await client.query(
            `INSERT INTO party_member_activities (party_id, player_id, activity_id)
             VALUES ($1, $2, $3)
             ON CONFLICT (party_id, player_id)
             DO UPDATE SET activity_id = EXCLUDED.activity_id, updated_at = NOW()`,
            [party.party.id, playerId, input.command.activityId]
          );
        }
      } else if (input.command.type === 'expedition.reward.claim') {
        const claimed = await client.query(
          `UPDATE party_state_rewards
           SET claimed_at = NOW()
           WHERE party_id = $1 AND player_id = $2 AND reward_id = $3 AND claimed_at IS NULL
           RETURNING reward_id`,
          [party.party.id, playerId, input.command.rewardId]
        );
        if (claimed.rows.length > 0) {
          updated = await client.query<PartyStateRow>(
            `UPDATE party_states
             SET revision = revision + 1
             WHERE party_id = $1 AND revision = $2
             RETURNING party_id, revision, activity_kind, status, destination, started_at, completes_at, updated_at`,
            [party.party.id, input.expectedRevision]
          );
        } else {
          updated = { rows: [] };
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
