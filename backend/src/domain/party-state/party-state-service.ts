import { createHash } from 'node:crypto';
import type { Pool, PoolClient, QueryResultRow } from 'pg';
import { createPostgresPartyRepositoryWithClient } from '../parties/postgres-party-repository.js';
import type { PartyWithMembers } from '../parties/party.js';
import {
  PARTY_ACTIVITY_KIND,
  EXPEDITION_SLOT_IDS,
  PARTY_MEMBER_ACTIVITY_IDS,
  PartyStateError,
  type PartyMemberActivityId,
  type PartyExpeditionAssignment,
  type PartyExpeditionState,
  type PartyReward,
  type PartyCommandResult,
  type PartyState,
  type PartyStateCommandInput,
  type PartyStateErrorCode
} from './party-state.js';
import { canPlayerOccupySlot, EXPEDITION_SLOT_EFFICIENCY, normalizeAssignmentsForPartySize } from './expedition-slot-policy.js';

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
  markPlayerDisconnected(playerId: string, partyId: string): Promise<void>;
  markPlayerConnected(playerId: string, partyId: string): Promise<void>;
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
  expedition_id: string;
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

interface ExpeditionAssignmentRow extends QueryResultRow {
  slot_id: PartyExpeditionAssignment['slotId'];
  player_id: string;
  role_id: string;
  target_id: string | null;
  active: boolean;
  assigned_at: Date;
  disconnected_at: Date | null;
}

interface ExpeditionAssignmentHistoryRow extends QueryResultRow {
  slot_id: PartyExpeditionAssignment['slotId'];
  player_id: string;
  role_id: string;
  target_id: string | null;
  active: boolean;
  effective_from: Date;
  effective_to: Date | null;
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
  pendingRewards: Record<string, PartyReward[]>,
  assignments: PartyExpeditionState['assignments'],
  forecast: PartyExpeditionState['forecast'] = null
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
    expedition: {
      expeditionId: row.expedition_id || 'forest',
      assignments,
      forecast
    },
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
    case 'invalid_expedition': return 'That expedition is not available.';
    case 'invalid_assignment': return 'That expedition assignment is invalid.';
    case 'assignment_not_allowed': return 'That assignment is not allowed for this party member.';
    case 'activity_not_idle': return 'The expedition is not idle.';
    case 'activity_not_active': return 'The expedition is not active.';
    case 'activity_not_completed': return 'The expedition is not completed.';
    case 'reward_not_available': return 'That expedition reward is no longer available.';
    case 'revision_conflict': return 'The party state revision is stale.';
    case 'not_party_leader': return 'Only the party leader can manage the expedition.';
    case 'expedition_not_active': return 'The expedition is not active.';
    case 'duplicate_command_mismatch': return 'The command ID was already used with different content.';
    case 'not_in_party': return 'The player is not currently in a party.';
    case 'party_refresh_required': return 'Refresh the party scope before using authoritative state.';
    case 'rate_limited': return 'Party commands are temporarily rate limited.';
    case 'not_authenticated': return 'Authentication is required.';
    case 'internal_error': return 'The party state is temporarily unavailable.';
  }
}

const MODERN_EXPEDITION_IDS = ['cooking:campfire-supper', 'combat:forest-hunt'] as const;
const MODERN_ROLE_IDS: Readonly<Record<(typeof MODERN_EXPEDITION_IDS)[number], readonly string[]>> = {
  'cooking:campfire-supper': ['forager', 'preparation', 'cooking', 'stewardship', 'quartermaster', 'host'],
  'combat:forest-hunt': ['dps', 'tank', 'healer', 'support']
};

function isModernExpeditionId(value: unknown): value is (typeof MODERN_EXPEDITION_IDS)[number] {
  return typeof value === 'string' && (MODERN_EXPEDITION_IDS as readonly string[]).includes(value);
}

function isSlotId(value: unknown): value is (typeof EXPEDITION_SLOT_IDS)[number] {
  return typeof value === 'string' && (EXPEDITION_SLOT_IDS as readonly string[]).includes(value);
}

interface ModernAssignmentInput {
  slotId: (typeof EXPEDITION_SLOT_IDS)[number];
  playerId: string;
  roleId: string;
  targetId: string | null;
}

function modernAssignments(value: unknown, members: readonly string[], expeditionId: string): ModernAssignmentInput[] | null {
  if (!Array.isArray(value) || value.length > 4) return null;
  const memberIds = new Set(members);
  const roleIds = MODERN_ROLE_IDS[expeditionId as (typeof MODERN_EXPEDITION_IDS)[number]] ?? [];
  const slots = new Set<string>();
  const assignments: ModernAssignmentInput[] = [];
  for (const item of value) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) return null;
    const record = item as Record<string, unknown>;
    if (!isSlotId(record.slotId) || typeof record.playerId !== 'string' || !memberIds.has(record.playerId) ||
      typeof record.roleId !== 'string' || !roleIds.includes(record.roleId) || slots.has(record.slotId) ||
      (record.targetId !== undefined && record.targetId !== null && typeof record.targetId !== 'string')) return null;
    slots.add(record.slotId);
    assignments.push({ slotId: record.slotId, playerId: record.playerId, roleId: record.roleId, targetId: typeof record.targetId === 'string' ? record.targetId : null });
  }
  const normalized = normalizeAssignmentsForPartySize(assignments, members.length);
  return normalized.length === assignments.length ? assignments : null;
}

function profileNumber(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? Math.max(0, value) : 0;
}

async function resolveServerForecast(client: PoolClient, expeditionId: string, assignments: readonly PartyExpeditionAssignment[]): Promise<PartyExpeditionState['forecast']> {
  const activeAssignments = assignments.filter(assignment => assignment.active);
  if (!isModernExpeditionId(expeditionId)) return null;
  const playerIds = [...new Set(activeAssignments.map(assignment => assignment.playerId))];
  const { rows } = playerIds.length > 0
    ? await client.query<{ player_id: string; profile_json: unknown }>(
        `SELECT player_id, profile_json FROM player_profiles WHERE player_id = ANY($1::uuid[])`,
        [playerIds]
      )
    : { rows: [] };
  const profiles = new Map(rows.map(row => [row.player_id, row.profile_json && typeof row.profile_json === 'object' ? row.profile_json as Record<string, unknown> : {}]));
  const roleWeight = (roleId: string): number => expeditionId.startsWith('combat:')
    ? ({ dps: 1, tank: 1.1, healer: 1, support: 1 }[roleId] ?? 0)
    : ({ forager: 0.8, preparation: 1, cooking: 1.35, stewardship: 0.75, quartermaster: 0.9, host: 0.8 }[roleId] ?? 0);
  const slotCounts = new Map<string, number>();
  const roleFit = activeAssignments.map(assignment => {
    const slotIndex = slotCounts.get(assignment.playerId) ?? 0;
    slotCounts.set(assignment.playerId, slotIndex + 1);
    const profile = profiles.get(assignment.playerId) ?? {};
    const skills = profile.skills && typeof profile.skills === 'object' ? profile.skills as Record<string, unknown> : {};
    const combatSkills = profile.combatSkills && typeof profile.combatSkills === 'object' ? profile.combatSkills as Record<string, unknown> : {};
    const level = expeditionId.startsWith('combat:')
      ? Object.values(combatSkills).reduce<number>((sum, value) => sum + profileNumber(value), 0) / 8
      : assignment.roleId === 'forager'
        ? (profileNumber(skills.Woodcutting) + profileNumber(skills.Fishing)) / 2
        : assignment.roleId === 'host' ? profileNumber(skills.Music) : profileNumber(skills.Cooking) * 0.8 + profileNumber(skills.Crafting) * 0.2;
    return { assignment, fit: Math.min(100, level * 5), efficiency: EXPEDITION_SLOT_EFFICIENCY[slotIndex] ?? EXPEDITION_SLOT_EFFICIENCY[EXPEDITION_SLOT_EFFICIENCY.length - 1] };
  });
  const averageFit = roleFit.length ? roleFit.reduce((sum, value) => sum + value.fit * value.efficiency, 0) / roleFit.length : 0;
  const requiredRoles = MODERN_ROLE_IDS[expeditionId];
  const coveredRoles = new Set(activeAssignments.map(assignment => assignment.roleId)).size;
  const roleCoveragePercent = Math.min(100, coveredRoles / requiredRoles.length * 100);
  const duplicatePenalty = activeAssignments.length - coveredRoles;
  const soloEfficiency = roleFit.length ? roleFit.reduce((sum, value) => sum + value.efficiency, 0) / roleFit.length : 0;
  const dangerReduction = roleFit.reduce((sum, value) => sum + (expeditionId.startsWith('combat:')
    ? ({ dps: 0.08, tank: 1, healer: 0.75, support: 0.65 }[value.assignment.roleId] ?? 0)
    : ({ forager: 0.45, preparation: 0.65, cooking: 0.8, stewardship: 0.7, quartermaster: 0.55, host: 0.5 }[value.assignment.roleId] ?? 0)) * (value.fit / 100) * value.efficiency, 0);
  const weightAverage = roleFit.length ? roleFit.reduce((sum, value) => sum + roleWeight(value.assignment.roleId) * value.efficiency, 0) / roleFit.length : 0;
  const dangerPercent = Math.min(95, Math.max(0, (expeditionId.startsWith('combat:') ? 22 : 5) + (100 - averageFit) * 0.4 - dangerReduction * 8 - weightAverage * 2 + duplicatePenalty * 8));
  const successPercent = Math.min(100, Math.max(0, (expeditionId.startsWith('combat:') ? 8 : 18) + averageFit * 0.5 + roleCoveragePercent * 0.35 + soloEfficiency * 10 - dangerPercent * 0.2));
  return { successPercent: Math.round(successPercent * 100) / 100, dangerPercent: Math.round(dangerPercent * 100) / 100, roleCoveragePercent: Math.round(roleCoveragePercent * 100) / 100, farmingMultiplier: Math.round(Math.max(0, (0.65 + roleCoveragePercent / 100 * 0.35) * soloEfficiency) * 100) / 100 };
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
      `SELECT party_id, revision, activity_kind, status, destination, started_at, completes_at, updated_at, expedition_id
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

  async function listExpeditionAssignments(partyId: string, members: string[]): Promise<PartyExpeditionState['assignments']> {
    const allowedMembers = new Set(members);
    const { rows } = await client.query<ExpeditionAssignmentRow>(
      `SELECT slot_id, player_id, role_id, target_id, active, assigned_at, disconnected_at
       FROM party_expedition_assignments
       WHERE party_id = $1
       ORDER BY slot_id ASC`,
      [partyId]
    );
    return rows
      .filter(row => allowedMembers.has(row.player_id))
      .map(row => ({
        slotId: row.slot_id,
        playerId: row.player_id,
        roleId: row.role_id,
        targetId: row.target_id,
        active: row.active,
        assignedAt: row.assigned_at,
        disconnectedAt: row.disconnected_at
      }));
  }

  async function enforcePartySlotPolicy(partyId: string, members: string[]): Promise<boolean> {
    if (members.length <= 1) return false;
    const { rows } = await client.query<ExpeditionAssignmentRow>(
      `SELECT slot_id, player_id, role_id, target_id, active, assigned_at, disconnected_at
       FROM party_expedition_assignments
       WHERE party_id = $1
       ORDER BY slot_id ASC`,
      [partyId]
    );
    const keep = new Set(normalizeAssignmentsForPartySize(rows.map(row => ({ slotId: row.slot_id, playerId: row.player_id, roleId: row.role_id })), members.length).map(row => row.slotId));
    const extras = rows.filter(row => !keep.has(row.slot_id));
    if (!extras.length) return false;
    for (const extra of extras) {
      await client.query('DELETE FROM party_expedition_assignments WHERE party_id = $1 AND slot_id = $2', [partyId, extra.slot_id]);
      await client.query('DELETE FROM party_expedition_assignment_history WHERE party_id = $1 AND slot_id = $2', [partyId, extra.slot_id]);
    }
    await client.query('UPDATE party_states SET revision = revision + 1 WHERE party_id = $1', [partyId]);
    return true;
  }

  async function closeAssignmentHistory(partyId: string, slotId: string, endedAt = new Date()): Promise<void> {
    await client.query(
      `UPDATE party_expedition_assignment_history
       SET effective_to = $3
       WHERE party_id = $1 AND slot_id = $2 AND effective_to IS NULL`,
      [partyId, slotId, endedAt]
    );
  }

  async function recordAssignmentHistory(
    partyId: string,
    assignment: { slotId: string; playerId: string; roleId: string; targetId?: string | null; active?: boolean },
    effectiveFrom = new Date()
  ): Promise<void> {
    await client.query(
      `INSERT INTO party_expedition_assignment_history
         (party_id, slot_id, player_id, role_id, target_id, active, effective_from)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [partyId, assignment.slotId, assignment.playerId, assignment.roleId, assignment.targetId ?? null, assignment.active ?? true, effectiveFrom]
    );
  }

  async function historicalForecast(row: PartyStateRow, members: string[], resolvedAt: Date): Promise<PartyExpeditionState['forecast']> {
    if (!isModernExpeditionId(row.expedition_id) || !row.started_at) return null;
    const { rows } = await client.query<ExpeditionAssignmentHistoryRow>(
      `SELECT slot_id, player_id, role_id, target_id, active, effective_from, effective_to
       FROM party_expedition_assignment_history
       WHERE party_id = $1 AND effective_from < $3 AND (effective_to IS NULL OR effective_to > $2)
       ORDER BY effective_from ASC, id ASC`,
      [row.party_id, row.started_at, resolvedAt]
    );
    if (rows.length === 0) return resolveServerForecast(client, row.expedition_id, await listExpeditionAssignments(row.party_id, members));
    const points = [...new Set([
      row.started_at.getTime(),
      resolvedAt.getTime(),
      ...rows.flatMap(history => [history.effective_from.getTime(), history.effective_to?.getTime() ?? resolvedAt.getTime()])
    ])].filter(point => point >= row.started_at!.getTime() && point <= resolvedAt.getTime()).sort((a, b) => a - b);
    const weighted = { success: 0, danger: 0, coverage: 0, farming: 0, duration: 0 };
    for (let index = 0; index < points.length - 1; index += 1) {
      const start = points[index];
      const end = points[index + 1];
      if (end <= start) continue;
      const midpoint = (start + end) / 2;
      const assignments = rows
        .filter(history => history.effective_from.getTime() <= midpoint && (history.effective_to === null || history.effective_to.getTime() > midpoint) && members.includes(history.player_id))
        .map(history => ({
          slotId: history.slot_id,
          playerId: history.player_id,
          roleId: history.role_id,
          targetId: history.target_id,
          active: history.active,
          assignedAt: history.effective_from,
          disconnectedAt: history.effective_to
        }));
      const forecast = await resolveServerForecast(client, row.expedition_id, assignments);
      if (!forecast) continue;
      const duration = end - start;
      weighted.success += forecast.successPercent * duration;
      weighted.danger += forecast.dangerPercent * duration;
      weighted.coverage += forecast.roleCoveragePercent * duration;
      weighted.farming += forecast.farmingMultiplier * duration;
      weighted.duration += duration;
    }
    if (!weighted.duration) return { successPercent: 0, dangerPercent: 0, roleCoveragePercent: 0, farmingMultiplier: 0 };
    return {
      successPercent: Math.round(weighted.success / weighted.duration * 100) / 100,
      dangerPercent: Math.round(weighted.danger / weighted.duration * 100) / 100,
      roleCoveragePercent: Math.round(weighted.coverage / weighted.duration * 100) / 100,
      farmingMultiplier: Math.round(weighted.farming / weighted.duration * 100) / 100
    };
  }

  async function readState(row: PartyStateRow, members: string[]): Promise<PartyState> {
    const [contributions, memberActivities, pendingRewards, assignments] = await Promise.all([
      listContributions(row.party_id, members),
      listMemberActivities(row.party_id, members),
      listPendingRewards(row.party_id, members),
      listExpeditionAssignments(row.party_id, members)
    ]);
    const forecast = await resolveServerForecast(client, row.expedition_id, assignments);
    return mapState(row, contributions, memberActivities, pendingRewards, assignments, forecast);
  }

  async function createModernExpeditionRewards(row: PartyStateRow, members: string[], resolvedAt: Date, forceSuccess?: boolean): Promise<void> {
    if (!row.started_at || !row.completes_at || !isModernExpeditionId(row.expedition_id)) return;
    const forecast = await historicalForecast(row, members, resolvedAt);
    const success = forceSuccess ?? (row.expedition_id.startsWith('cooking:') || (forecast?.successPercent ?? 0) >= 55);
    const durationMs = Math.max(1, row.completes_at.getTime() - row.started_at.getTime());
    const progressScale = Math.min(1, Math.max(0, (resolvedAt.getTime() - row.started_at.getTime()) / durationMs));
    const farmingMultiplier = (forecast?.farmingMultiplier ?? 0) * progressScale;
    const completionTierId = row.expedition_id.startsWith('cooking:')
      ? (forecast && forecast.successPercent >= 72 ? 'feast' : forecast && forecast.successPercent >= 48 ? 'hearty' : 'rough')
      : (forecast && forecast.successPercent >= 92 ? 'masterwork' : forecast && forecast.successPercent >= 78 ? 'trophy' : forecast && forecast.successPercent >= 58 ? 'cache' : null);
    const farmingRewards: Record<string, number> = row.expedition_id.startsWith('cooking:')
      ? { 'Raw Fish': Math.floor(farmingMultiplier * 5), 'Pine Logs': Math.floor(farmingMultiplier * 3) }
      : { Scrap: Math.floor(farmingMultiplier * 8), 'Boss Keys': Math.floor(farmingMultiplier * 2) };
    const completionRewards: Record<string, number> = success
      ? row.expedition_id.startsWith('cooking:')
        ? { 'Cooked Fish': completionTierId === 'feast' ? 14 : completionTierId === 'hearty' ? 8 : 4 }
        : { Scrap: completionTierId === 'masterwork' ? 40 : completionTierId === 'trophy' ? 28 : completionTierId === 'cache' ? 18 : 10 }
      : {};
    const rewardId = `expedition-${row.party_id}-${row.started_at.getTime()}`;
    for (const playerId of members) {
      const reward: PartyReward = {
        id: rewardId,
        primaryActivity: 'rest',
        primaryXp: 0,
        partyXp: {},
        rewards: { bossKeys: 0, pineLogs: 0, cookedFish: 0, game: 0 },
        expeditionLedger: {
          expeditionId: row.expedition_id,
          outcome: success ? 'completed' : 'failed',
          farmingRewards,
          completionRewards,
          completionTierId,
          status: success ? 'pending' : 'preserved-on-failure',
          successPercent: forecast?.successPercent ?? 0,
          dangerPercent: forecast?.dangerPercent ?? 0
        }
      };
      await client.query(
        `INSERT INTO party_state_rewards (party_id, player_id, reward_id, reward_json)
         VALUES ($1, $2, $3, $4::jsonb)
         ON CONFLICT (party_id, player_id, reward_id) DO NOTHING`,
        [row.party_id, playerId, rewardId, JSON.stringify(reward)]
      );
    }
  }

  async function createCompletionRewards(row: PartyStateRow, members: string[], memberActivities: PartyState['memberActivities']): Promise<void> {
    if (!row.started_at || !row.completes_at) return;
    if (isModernExpeditionId(row.expedition_id)) {
      await createModernExpeditionRewards(row, members, row.completes_at);
      return;
    }
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
    const pruned = await enforcePartySlotPolicy(row.party_id, members);
    if (pruned) row = await ensureState(row.party_id);
    if (row.status === 'active' && row.completes_at !== null && row.completes_at.getTime() <= Date.now()) {
      const updated = await client.query<PartyStateRow>(
        `UPDATE party_states
         SET status = 'completed', revision = revision + 1
         WHERE party_id = $1 AND status = 'active' AND completes_at <= NOW()
         RETURNING party_id, revision, activity_kind, status, destination, started_at, completes_at, updated_at, expedition_id`,
        [row.party_id]
      );
      if (updated.rows.length > 0) {
        row = updated.rows[0];
        const memberActivities = await listMemberActivities(row.party_id, members);
        await createCompletionRewards(row, members, memberActivities);
        return { row, state: await readState(row, members), reconciled: true };
      }
    }
    return { row, state: await readState(row, members), reconciled: pruned };
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

  return {
    ensureState,
    readState,
    reconcile,
    getCommand,
    insertCommand,
    createModernExpeditionRewards,
    closeAssignmentHistory,
    recordAssignmentHistory
  };
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
      let normalizedAssignments: ModernAssignmentInput[] = [];
      if (input.command.type === 'expedition.start') {
        if (input.command.expeditionId !== undefined) {
          if (!isModernExpeditionId(input.command.expeditionId)) errorCode = 'invalid_expedition';
          else if (state.activity.status !== 'idle') errorCode = 'activity_not_idle';
          else {
            const parsedAssignments = modernAssignments(input.command.assignments, memberIds, input.command.expeditionId);
            if (!parsedAssignments) errorCode = 'invalid_assignment';
            else normalizedAssignments = parsedAssignments;
          }
        } else if (input.command.destination !== 'forest') errorCode = 'invalid_destination';
        else if (state.activity.status !== 'idle') errorCode = 'activity_not_idle';
      } else if (input.command.type === 'expedition.assignment.set') {
        const expeditionId = state.expedition.expeditionId;
        if (!isModernExpeditionId(expeditionId)) errorCode = 'invalid_expedition';
        else if (!isSlotId(input.command.slotId) || typeof input.command.roleId !== 'string' || !MODERN_ROLE_IDS[expeditionId].includes(input.command.roleId)) errorCode = 'invalid_assignment';
        else {
          const existing = state.expedition.assignments.find(assignment => assignment.slotId === input.command.slotId);
          if (existing && existing.playerId !== playerId) errorCode = 'assignment_not_allowed';
          else if (!canPlayerOccupySlot(state.expedition.assignments, playerId, input.command.slotId, memberIds.length)) errorCode = 'assignment_not_allowed';
          else if (state.activity.status === 'completed') errorCode = 'activity_not_active';
        }
      } else if (input.command.type === 'expedition.assignment.clear') {
        const expeditionId = state.expedition.expeditionId;
        if (!isModernExpeditionId(expeditionId) || !isSlotId(input.command.slotId)) errorCode = 'invalid_assignment';
        else {
          const existing = state.expedition.assignments.find(assignment => assignment.slotId === input.command.slotId);
          if (existing && existing.playerId !== playerId) errorCode = 'assignment_not_allowed';
          else if (state.activity.status === 'completed') errorCode = 'activity_not_active';
        }
      } else if (input.command.type === 'expedition.abandon') {
        if (party.party.leaderId !== playerId) errorCode = 'not_party_leader';
        else if (state.activity.status !== 'active') errorCode = 'expedition_not_active';
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
        const expeditionId = isModernExpeditionId(input.command.expeditionId) ? input.command.expeditionId : 'forest';
        updated = await client.query<PartyStateRow>(
          `UPDATE party_states
           SET status = 'active', destination = 'forest', expedition_id = $2, started_at = NOW(),
               completes_at = NOW() + ($3::double precision * INTERVAL '1 millisecond'),
               revision = revision + 1
           WHERE party_id = $1 AND revision = $4 AND status = 'idle'
           RETURNING party_id, revision, activity_kind, status, destination, started_at, completes_at, updated_at, expedition_id`,
          [party.party.id, expeditionId, config.expeditionDurationMs, input.expectedRevision]
        );
        if (updated.rows.length > 0) {
          if (isModernExpeditionId(expeditionId)) {
            await client.query('DELETE FROM party_expedition_assignments WHERE party_id = $1', [party.party.id]);
            await client.query('DELETE FROM party_expedition_assignment_history WHERE party_id = $1', [party.party.id]);
            for (const assignment of normalizedAssignments) {
              await client.query(
                `INSERT INTO party_expedition_assignments
                   (party_id, slot_id, player_id, role_id, target_id, active, assigned_at, disconnected_at)
                 VALUES ($1, $2, $3, $4, $5, TRUE, NOW(), NULL)`,
                [party.party.id, assignment.slotId, assignment.playerId, assignment.roleId, assignment.targetId]
              );
              await repository.recordAssignmentHistory(party.party.id, assignment, updated.rows[0].started_at ?? new Date());
            }
          }
          const activityState = await repository.readState(updated.rows[0], memberIds);
          if (!isModernExpeditionId(expeditionId)) {
            for (const memberId of memberIds) {
              await client.query(
                `INSERT INTO party_state_activity_segments (party_id, player_id, activity_id, started_at)
                 VALUES ($1, $2, $3, $4)`,
                [party.party.id, memberId, activityState.memberActivities[memberId] || 'rest', updated.rows[0].started_at]
              );
            }
          }
        }
      } else if (input.command.type === 'expedition.assignment.set') {
        updated = await client.query<PartyStateRow>(
          `UPDATE party_states
           SET revision = revision + 1
           WHERE party_id = $1 AND revision = $2 AND status IN ('idle', 'active')
           RETURNING party_id, revision, activity_kind, status, destination, started_at, completes_at, updated_at, expedition_id`,
          [party.party.id, input.expectedRevision]
        );
        if (updated.rows.length > 0) {
          if (state.activity.status === 'active') await repository.closeAssignmentHistory(party.party.id, input.command.slotId as string);
          await client.query(
            `INSERT INTO party_expedition_assignments
               (party_id, slot_id, player_id, role_id, target_id, active, assigned_at, disconnected_at)
             VALUES ($1, $2, $3, $4, $5, TRUE, NOW(), NULL)
             ON CONFLICT (party_id, slot_id)
             DO UPDATE SET player_id = EXCLUDED.player_id, role_id = EXCLUDED.role_id,
               target_id = EXCLUDED.target_id, active = TRUE, assigned_at = NOW(), disconnected_at = NULL`,
            [party.party.id, input.command.slotId, playerId, input.command.roleId, input.command.targetId ?? null]
          );
          if (state.activity.status === 'active') {
            await repository.recordAssignmentHistory(party.party.id, {
              slotId: input.command.slotId as string,
              playerId,
              roleId: input.command.roleId as string,
              targetId: typeof input.command.targetId === 'string' ? input.command.targetId : null
            });
          }
        }
      } else if (input.command.type === 'expedition.assignment.clear') {
        updated = await client.query<PartyStateRow>(
          `UPDATE party_states
           SET revision = revision + 1
           WHERE party_id = $1 AND revision = $2 AND status IN ('idle', 'active')
           RETURNING party_id, revision, activity_kind, status, destination, started_at, completes_at, updated_at, expedition_id`,
          [party.party.id, input.expectedRevision]
        );
        if (updated.rows.length > 0) {
          if (state.activity.status === 'active') await repository.closeAssignmentHistory(party.party.id, input.command.slotId as string);
          await client.query(
            `DELETE FROM party_expedition_assignments
             WHERE party_id = $1 AND slot_id = $2`,
            [party.party.id, input.command.slotId]
          );
        }
      } else if (input.command.type === 'expedition.abandon') {
        if (isModernExpeditionId(state.expedition.expeditionId)) {
          const currentRow = await repository.ensureState(party.party.id);
          await repository.createModernExpeditionRewards(currentRow, memberIds, new Date(), false);
        }
        updated = await client.query<PartyStateRow>(
          `UPDATE party_states
           SET status = 'idle', destination = NULL, expedition_id = 'forest', started_at = NULL, completes_at = NULL, revision = revision + 1
           WHERE party_id = $1 AND revision = $2 AND status = 'active'
           RETURNING party_id, revision, activity_kind, status, destination, started_at, completes_at, updated_at, expedition_id`,
          [party.party.id, input.expectedRevision]
        );
        if (updated.rows.length > 0) {
          await client.query('DELETE FROM party_state_contributions WHERE party_id = $1', [party.party.id]);
          await client.query('DELETE FROM party_expedition_assignments WHERE party_id = $1', [party.party.id]);
          await client.query('UPDATE party_expedition_assignment_history SET effective_to = NOW() WHERE party_id = $1 AND effective_to IS NULL', [party.party.id]);
        }
      } else if (input.command.type === 'expedition.contribute') {
        updated = await client.query<PartyStateRow>(
          `UPDATE party_states
           SET revision = revision + 1
           WHERE party_id = $1 AND revision = $2 AND status = 'active' AND completes_at > NOW()
           RETURNING party_id, revision, activity_kind, status, destination, started_at, completes_at, updated_at, expedition_id`,
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
           RETURNING party_id, revision, activity_kind, status, destination, started_at, completes_at, updated_at, expedition_id`,
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
             RETURNING party_id, revision, activity_kind, status, destination, started_at, completes_at, updated_at, expedition_id`,
            [party.party.id, input.expectedRevision]
          );
        } else {
          updated = { rows: [] };
        }
      } else {
        updated = await client.query<PartyStateRow>(
          `UPDATE party_states
           SET status = 'idle', destination = NULL, expedition_id = 'forest', started_at = NULL, completes_at = NULL, revision = revision + 1
           WHERE party_id = $1 AND revision = $2 AND status = 'completed'
           RETURNING party_id, revision, activity_kind, status, destination, started_at, completes_at, updated_at, expedition_id`,
          [party.party.id, input.expectedRevision]
        );
        if (updated.rows.length > 0) {
          await client.query('DELETE FROM party_state_contributions WHERE party_id = $1', [party.party.id]);
          await client.query('DELETE FROM party_expedition_assignments WHERE party_id = $1', [party.party.id]);
          await client.query('DELETE FROM party_expedition_assignment_history WHERE party_id = $1', [party.party.id]);
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

  async function markPlayerDisconnected(playerId: string, partyId: string): Promise<void> {
    await pool.query(
      `UPDATE party_expedition_assignments
       SET active = FALSE, disconnected_at = NOW()
       WHERE party_id = $1 AND player_id = $2 AND active = TRUE`,
      [partyId, playerId]
    );
    await pool.query(
      `UPDATE party_expedition_assignment_history
       SET effective_to = NOW()
       WHERE party_id = $1 AND player_id = $2 AND effective_to IS NULL`,
      [partyId, playerId]
    );
  }

  async function markPlayerConnected(playerId: string, partyId: string): Promise<void> {
    const result = await pool.query<ExpeditionAssignmentRow>(
      `UPDATE party_expedition_assignments
       SET active = TRUE, disconnected_at = NULL
       WHERE party_id = $1 AND player_id = $2 AND disconnected_at IS NOT NULL
       RETURNING slot_id, player_id, role_id, target_id, active, assigned_at, disconnected_at`,
      [partyId, playerId]
    );
    for (const assignment of result.rows) {
      await pool.query(
        `INSERT INTO party_expedition_assignment_history
           (party_id, slot_id, player_id, role_id, target_id, active, effective_from)
         VALUES ($1, $2, $3, $4, $5, TRUE, NOW())`,
        [partyId, assignment.slot_id, assignment.player_id, assignment.role_id, assignment.target_id]
      );
    }
  }

  return Object.freeze({ getState, executeCommand, markPlayerDisconnected, markPlayerConnected });
}

export function partyStateErrorMessage(code: PartyStateErrorCode): string {
  return commandErrorMessage(code);
}
