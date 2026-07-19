(() => {
  'use strict';

  const transportApi = window.MomentumPartyTransport;
  const { CONNECTION_STATES, COMMAND_TYPES, DEFINITIONS } = transportApi;
  const COMMAND_LABELS = {
    [COMMAND_TYPES.SET_ACTIVITY]:'activity change',
    [COMMAND_TYPES.START_EXPEDITION]:'expedition start',
    [COMMAND_TYPES.PAUSE_EXPEDITION]:'expedition pause',
    [COMMAND_TYPES.RESUME_EXPEDITION]:'expedition resume',
    [COMMAND_TYPES.CLAIM_REWARD]:'reward claim',
    [COMMAND_TYPES.REQUEST_SNAPSHOT]:'snapshot request'
  };
  const COMPACT_STORAGE_KEY = 'momentum-taskbar-compact';
  const elements = {
    card:document.getElementById('partyCard'),
    status:document.getElementById('partySyncStatus'),
    transportLabel:document.getElementById('partyTransportLabel'),
    reconnect:document.getElementById('partyReconnectBtn'),
    sync:null,
    tick:null,
    management:document.getElementById('partyManagement'),
    lanes:document.getElementById('partyLanes'),
    members:document.getElementById('partyMembers'),
    actions:document.getElementById('partyActionRow'),
    checkin:document.getElementById('partyCheckin'),
    identity:document.getElementById('partyIdentity'),
    identityName:document.getElementById('partyIdentityName'),
    identityDetail:document.getElementById('partyIdentityDetail'),
    dock:document.getElementById('taskbarDock'),
    dockLabel:document.getElementById('dockExpeditionLabel'),
    dockLanes:document.getElementById('dockLanes'),
    dockMembers:document.getElementById('dockMembers'),
    dockActions:document.getElementById('dockActionRow'),
    dockNotable:document.getElementById('dockNotable'),
    summary:document.getElementById('taskbarSummaryModal'),
    summaryBody:document.getElementById('taskbarSummaryBody')
  };
  const presentation = { compact:false };
  let partyClient = null;
  let reconnectTimer = null;
  let previousTickForSummary = null;
  let lastRenderSignature = '';
  let partyJoinCodeDraft = '';
  let partyManagementBusy = false;
  let authoritativeProgressTimer = null;
  let completionRefreshPending = false;

  function currentRuntimeState() {
    return partyClient.getState();
  }

  function isAuthoritative() {
    return currentRuntimeState().mode === 'authoritative';
  }

  function currentStoreState() {
    return currentRuntimeState().client;
  }

  function currentSnapshot() {
    return currentStoreState().snapshot;
  }

  function isConnected() {
    return partyClient.getConnectionState() === CONNECTION_STATES.CONNECTED;
  }

  function commandIsPending(type) {
    if (isAuthoritative()) return currentRuntimeState().authoritative.pendingCommandIds.length > 0;
    return currentStoreState().session.pendingCommands.some(command => command.type === type);
  }

  function commandStatus(type) {
    return partyClient.getCommandState(type).status;
  }

  function escapeHtml(value) {
    return String(value).replace(/[&<>"']/g, character => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[character]));
  }

  function rewardDescription(reward) {
    return reward ? `+${escapeHtml(reward.pineLogs)} Pine Logs · +${escapeHtml(reward.cookedFish)} Cooked Fish` : '';
  }

  function currentPlayer(snapshot) {
    const playerId = currentStoreState().session.authenticatedPlayerId;
    return snapshot.party.members.find(member => member.id === playerId) || snapshot.party.members[0];
  }

  function realSkillLevel(id) {
    try {
      return typeof skills !== 'undefined' ? (skills.find(skill => skill.id === id)?.lvl || 0) : 0;
    } catch {
      return 0;
    }
  }

  function recommendedActivity() {
    const scores = {
      forest_patrol:realSkillLevel('Combat'),
      pine_chopping:realSkillLevel('Woodchopping'),
      camp_cooking:realSkillLevel('Cooking') + realSkillLevel('Fishing') * .5,
      rest:0
    };
    return Object.entries(scores).sort((a,b) => b[1] - a[1])[0][0];
  }

  async function setActivity(activityId) {
    if (isAuthoritative()) return false;
    if (!DEFINITIONS.activities[activityId]) return false;
    return partyClient.setActivity(activityId);
  }

  async function toggleExpedition() {
    return partyClient.toggleExpedition();
  }

  async function claimReward() {
    if (isAuthoritative()) {
      const runtimeState = currentRuntimeState();
      const reward = authoritativePendingReward(runtimeState);
      if (!reward || !isConnected() || commandIsPending('expedition.reward.claim')) return false;
      const accepted = await partyClient.claimReward(reward.id);
      if (accepted) window.MomentumGameRewards?.claimPartyReward(reward);
      return accepted;
    }
    const reward = currentSnapshot().expedition.pendingRewards;
    if (!reward || commandIsPending(COMMAND_TYPES.CLAIM_REWARD)) return false;
    return partyClient.claimReward(reward.id);
  }

  async function requestSnapshot() {
    return partyClient.requestSnapshot();
  }

  async function reconnect() {
    return partyClient.reconnect();
  }

  function formatActivity(member) {
    const activity = DEFINITIONS.activities[member.activity] || DEFINITIONS.activities.rest;
    return `${activity.icon} ${activity.rosterName}`;
  }

  function affinityLabel(member) {
    return member.affinity === 'timber' ? '🌲' : member.affinity === 'supplies' ? '♨' : member.affinity === 'patrol' ? '⚔' : '◆';
  }

  function memberContribution(member) {
    return Object.values(member.totals || {}).reduce((sum, value) => sum + (Number(value) || 0), 0);
  }

  function emptyMemberSlotMarkup() {
    return '<div class="party-member is-empty"><strong>EMPTY</strong></div>';
  }

  function renderLanes(host, snapshot) {
    const lanes = snapshot.expedition.lanes || {};
    host.innerHTML = DEFINITIONS.lanes.map(lane => {
      const value = Number(lanes[lane.id]) || 0;
      return `<div class="party-lane"><div><span>${lane.name}</span><strong>${Math.floor(value)}/${lane.target}</strong></div><div class="party-lane-meter"><i style="width:${Math.min(100, value / lane.target * 100)}%;background:${lane.color}"></i></div></div>`;
    }).join('');
  }

  function renderMembers(host, snapshot) {
    const members = snapshot.party.members || [];
    const slots = Array.from({ length:4 }, (_, index) => members[index] || null);
    host.innerHTML = slots.map(member => member ? `<div class="party-member${member.id === currentStoreState().session.authenticatedPlayerId ? ' is-player' : ''}"><span class="party-avatar">◆</span><span class="party-member-name"><strong>${affinityLabel(member)} ${escapeHtml(member.name)}</strong><small>${formatActivity(member)} · Passive activity output</small></span><span class="party-presence">YOU</span></div>` : emptyMemberSlotMarkup()).join('');
  }

  function actionMarkup(snapshot, compact = false) {
    const player = currentPlayer(snapshot);
    const recommended = recommendedActivity();
    const pending = commandIsPending(COMMAND_TYPES.SET_ACTIVITY);
    const disabled = !isConnected() || pending;
    return Object.entries(DEFINITIONS.activities).map(([id, activity]) => `<button class="btn party-action${player?.activity === id ? ' is-selected' : ''}${recommended === id ? ' is-recommended' : ''}" data-party-activity="${id}" title="${recommended === id ? `Recommended by your current skill levels · ${activity.rewardFocus}` : activity.rewardFocus}" ${disabled ? 'disabled' : ''}><span>${activity.icon}</span>${compact ? '' : activity.name}${recommended === id && !compact ? '<small>Recommended</small>' : ''}</button>`).join('');
  }

  function bindActions(host) {
    host.querySelectorAll('[data-party-activity]').forEach(button => { button.onclick = () => { void setActivity(button.dataset.partyActivity); }; });
  }

  function pendingCommandLabel(storeState) {
    const pending = storeState.session.pendingCommands[0];
    return pending ? COMMAND_LABELS[pending.type] || 'command' : '';
  }

  function commandError(storeState) {
    return storeState.session.commandErrors[0]?.message || '';
  }

  function rewardButtonMarkup(label) {
    const disabled = !isConnected() || commandIsPending(COMMAND_TYPES.CLAIM_REWARD);
    return `<button class="btn btn-small" data-claim-party-reward ${disabled ? 'disabled' : ''}>${commandIsPending(COMMAND_TYPES.CLAIM_REWARD) ? 'Claiming…' : label}</button>`;
  }

  function renderLocal(force = false) {
    const storeState = currentStoreState();
    const snapshot = storeState.snapshot;
    const expedition = snapshot.expedition;
    const player = currentPlayer(snapshot);
    const pendingSignature = storeState.session.pendingCommands.map(command => `${command.type}:${command.commandId}`).join(',');
    const error = commandError(storeState);
    const signature = `${storeState.session.lastAcceptedRevision}:${storeState.session.connection.status}:${pendingSignature}:${error}:${snapshot.elapsedTicks}:${expedition.status}:${expedition.pendingRewards?.id || 'clear'}:${player?.activity || ''}:${presentation.compact}`;
    if (!force && signature === lastRenderSignature) return;
    lastRenderSignature = signature;
    renderIdentity(currentRuntimeState());
    elements.management.innerHTML = '';

    const connectionStatus = storeState.session.connection.status;
    if (elements.transportLabel) elements.transportLabel.textContent = 'PARTY STATE';
    const expeditionLabel = expedition.status === 'active' ? 'Active' : expedition.status === 'paused' ? 'Paused' : 'Ready';
    const fallbackLabel = currentRuntimeState().fallbackReason ? 'Local fallback · ' : '';
    const connectionText = fallbackLabel + (connectionStatus === CONNECTION_STATES.DISCONNECTED ? 'Disconnected · showing last snapshot' : connectionStatus === CONNECTION_STATES.CONNECTING ? 'Connecting · showing last snapshot' : connectionStatus === CONNECTION_STATES.RECONNECTING ? 'Reconnecting · showing last snapshot' : connectionStatus === CONNECTION_STATES.ERROR ? 'Connection problem · showing last snapshot' : `${expeditionLabel} · local snapshot`);
    elements.status.textContent = currentRuntimeState().fallbackReason ? 'Party state · Local preview' : connectionStatus === CONNECTION_STATES.CONNECTED ? `Party state · ${expeditionLabel}` : connectionStatus === CONNECTION_STATES.ERROR ? 'Party state · Broken' : connectionStatus === CONNECTION_STATES.DISCONNECTED ? 'Party state · Offline' : `Party state · ${connectionStatus === CONNECTION_STATES.RECONNECTING ? 'Reconnecting' : 'Connecting'}`;
    elements.status.classList.toggle('is-pending', [CONNECTION_STATES.CONNECTING, CONNECTION_STATES.RECONNECTING].includes(connectionStatus));
    elements.status.classList.toggle('is-error', Boolean(error) || connectionStatus === CONNECTION_STATES.ERROR);
    if (elements.reconnect) {
      elements.reconnect.textContent = [CONNECTION_STATES.CONNECTING, CONNECTION_STATES.RECONNECTING].includes(connectionStatus) ? 'Connecting…' : 'Reconnect';
      elements.reconnect.disabled = [CONNECTION_STATES.CONNECTING, CONNECTION_STATES.RECONNECTING].includes(connectionStatus);
    }

    const toggle = document.getElementById('partyExpeditionToggle');
    const toggleType = expedition.status === 'active' ? COMMAND_TYPES.PAUSE_EXPEDITION : expedition.status === 'paused' ? COMMAND_TYPES.RESUME_EXPEDITION : COMMAND_TYPES.START_EXPEDITION;
    if (toggle) {
      toggle.hidden = false;
      toggle.textContent = expedition.status === 'active' ? 'Pause' : expedition.status === 'paused' ? 'Resume' : expedition.pendingRewards ? 'Claim reward' : 'Start Expedition';
      toggle.disabled = !isConnected() || Boolean(expedition.pendingRewards) || commandIsPending(toggleType);
    }

    renderLanes(elements.lanes, snapshot);
    renderMembers(elements.members, snapshot);
    elements.actions.innerHTML = actionMarkup(snapshot);
    elements.actions.setAttribute('aria-busy', String(commandIsPending(COMMAND_TYPES.SET_ACTIVITY)));
    bindActions(elements.actions);

    renderLanes(elements.dockLanes, snapshot);
    renderMembers(elements.dockMembers, snapshot);
    elements.dockActions.innerHTML = actionMarkup(snapshot, true);
    elements.dockActions.setAttribute('aria-busy', String(commandIsPending(COMMAND_TYPES.SET_ACTIVITY)));
    bindActions(elements.dockActions);
    elements.dockLabel.textContent = `Forest Expedition · ${expedition.status} · ${expedition.completedExpeditions} complete`;

    const latestEvent = escapeHtml(snapshot.recentEvents[0]?.text || 'Progress continues quietly.');
    elements.dockNotable.innerHTML = expedition.pendingRewards ? `<strong>Reward ready</strong><br>${rewardDescription(expedition.pendingRewards)} ${rewardButtonMarkup('Claim')}` : latestEvent;
    if (expedition.pendingRewards) {
      elements.checkin.innerHTML = `<strong>Expedition complete.</strong> ${rewardDescription(expedition.pendingRewards)} ${rewardButtonMarkup('Claim reward')}`;
    } else {
      const lastClaimed = expedition.claimedRewards?.[0];
      const claimedText = lastClaimed ? ` Last reward claimed: ${rewardDescription(lastClaimed)}.` : '';
      elements.checkin.innerHTML = `<span>Recommended activity: <strong>${DEFINITIONS.activities[recommendedActivity()].name}</strong>. ${latestEvent}${claimedText}</span>`;
    }
    bindRewardButtons(elements.dockNotable);
    bindRewardButtons(elements.checkin);
  }

  function shortPlayerId(playerId) {
    return playerId ? playerId.slice(0, 8) : 'unknown';
  }

  function renderIdentity(runtimeState) {
    if (!elements.identityName || !elements.identityDetail) return;
    if (runtimeState.mode === 'authoritative') {
      const name = runtimeState.identity.displayName || 'Player';
      const party = runtimeState.authoritative.party;
      elements.identityName.textContent = name;
      elements.identityDetail.textContent = party ? `Party roster · ${party.members.length}/${party.maxMembers}` : 'No party membership';
      elements.identity?.classList.toggle('is-online', runtimeState.connection === CONNECTION_STATES.CONNECTED);
      return;
    }
    const player = runtimeState.client.snapshot.party.members.find(member => member.id === runtimeState.client.session.authenticatedPlayerId);
    elements.identityName.textContent = player?.name || 'Player';
    elements.identityDetail.textContent = runtimeState.fallbackReason ? `Local preview · ${runtimeState.fallbackReason}` : 'Local party profile';
    elements.identity?.classList.toggle('is-online', runtimeState.client.session.connection.status === CONNECTION_STATES.CONNECTED);
  }

  function authoritativeActivityLabel(authoritativeState) {
    if (!authoritativeState) return 'Awaiting party state';
    const activity = authoritativeState.activity;
    return activity.status === 'active' ? 'In progress' : activity.status === 'completed' ? 'Complete' : 'Ready';
  }

  function authoritativeProgressPercent(authoritativeState) {
    if (!authoritativeState) return 0;
    const activity = authoritativeState.activity;
    if (activity.status === 'completed') return 100;
    if (activity.status !== 'active' || !activity.startedAt || !activity.completesAt) return 0;
    const startedAt = Date.parse(activity.startedAt);
    const completesAt = Date.parse(activity.completesAt);
    if (!Number.isFinite(startedAt) || !Number.isFinite(completesAt) || completesAt <= startedAt) return 0;
    return Math.max(0, Math.min(100, Math.round((Date.now() - startedAt) / (completesAt - startedAt) * 100)));
  }

  function authoritativeElapsedLabel(authoritativeState) {
    const activity = authoritativeState?.activity;
    if (!activity?.startedAt) return 'Not started';
    const startedAt = Date.parse(activity.startedAt);
    if (!Number.isFinite(startedAt)) return 'Not started';
    const completedAt = activity.status === 'completed' && activity.completesAt ? Date.parse(activity.completesAt) : Date.now();
    const elapsedSeconds = Math.max(0, Math.floor((completedAt - startedAt) / 1000));
    const minutes = Math.floor(elapsedSeconds / 60).toString().padStart(2, '0');
    const seconds = (elapsedSeconds % 60).toString().padStart(2, '0');
    return `${minutes}:${seconds}`;
  }

  function authoritativePendingReward(runtimeState) {
    const playerId = runtimeState.identity.authenticatedPlayerId;
    return playerId ? runtimeState.authoritative.state?.pendingRewards?.[playerId]?.[0] || null : null;
  }

  function authoritativeRewardDescription(reward) {
    if (!reward) return '';
    const activity = DEFINITIONS.activities[reward.primaryActivity] || DEFINITIONS.activities.rest;
    const parts = [];
    if (reward.primaryXp) parts.push(`+${reward.primaryXp} ${activity.rewardFocus.split(' XP')[0]} XP`);
    Object.entries(reward.partyXp || {}).forEach(([activityId, xp]) => {
      const definition = DEFINITIONS.activities[activityId] || DEFINITIONS.activities.rest;
      if (xp) parts.push(`+${xp} ${definition.rewardFocus.split(' XP')[0]} XP`);
    });
    if (reward.rewards?.bossKeys) parts.push(`+${reward.rewards.bossKeys} Boss Keys`);
    if (reward.rewards?.pineLogs) parts.push(`+${reward.rewards.pineLogs} Pine Logs`);
    if (reward.rewards?.cookedFish) parts.push(`+${reward.rewards.cookedFish} Cooked Fish`);
    if (reward.rewards?.game) parts.push(`+${reward.rewards.game} Game`);
    return parts.map(escapeHtml).join(' · ');
  }

  function authoritativeRewardButtonMarkup(label, reward) {
    if (!reward) return '';
    const disabled = !isConnected() || commandIsPending('expedition.reward.claim');
    return `<button class="btn btn-small" data-claim-party-reward ${disabled ? 'disabled' : ''}>${disabled && commandIsPending('expedition.reward.claim') ? 'Claiming…' : label}</button>`;
  }

  function renderAuthoritativeState(host, authoritativeState, compact = false) {
    const activity = authoritativeState?.activity;
    const runtimeState = currentRuntimeState();
    const party = runtimeState.authoritative.party;
    const members = runtimeState.authoritative.scope.memberPlayerIds.length || party?.members?.length || 0;
    const progress = authoritativeProgressPercent(authoritativeState);
    const progressDetail = authoritativeState?.activity.status === 'active' ? `Time elapsed · ${authoritativeElapsedLabel(authoritativeState)} · ${progress}% complete` : authoritativeState?.activity.status === 'completed' ? `Time elapsed · ${authoritativeElapsedLabel(authoritativeState)} · Ready for leader reset` : 'Waiting for the party leader';
    const cards = [
      { label: 'Expedition status', value: authoritativeActivityLabel(authoritativeState), detail: activity?.destination ? `Destination · ${activity.destination} · ${progressDetail}` : progressDetail, progress },
      { label: 'Party members', value: party ? `${members}/${party.maxMembers}` : '—', detail: 'Players in this party' }
    ];
    host.innerHTML = cards.map(card => `<div class="party-lane party-authoritative-lane"><div><span>${escapeHtml(card.label)}</span><strong>${escapeHtml(card.value)}</strong></div><small>${escapeHtml(card.detail)}</small>${card.progress !== undefined ? `<div class="party-progress" role="progressbar" aria-label="Expedition progress" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${card.progress}"><i style="width:${card.progress}%"></i></div>` : ''}${compact ? '' : '<div class="party-authoritative-rule"></div>'}</div>`).join('');
  }

  function renderAuthoritativeMembers(host, runtimeState) {
    const authoritative = runtimeState.authoritative;
    const currentPlayerId = runtimeState.identity.authenticatedPlayerId;
    const party = authoritative.party;
    const partyMembers = party?.members || [];
    const partyMembersById = new Map(partyMembers.map(member => [member.playerId, member]));
    const scopeMembersById = new Map((authoritative.scope.members || []).map(member => [member.playerId, member]));
    const scopeMemberIds = authoritative.scope.memberPlayerIds.length ? authoritative.scope.memberPlayerIds : [...scopeMembersById.keys()];
    const memberIds = scopeMemberIds.length ? scopeMemberIds : partyMembers.map(member => member.playerId);
    const members = memberIds.map(playerId => {
      const scopeMember = scopeMembersById.get(playerId);
      const partyMember = partyMembersById.get(playerId);
      return {
        playerId,
        displayName: scopeMember?.displayName || partyMember?.displayName || '',
        isLeader: Boolean(scopeMember?.isLeader || partyMember?.isLeader || playerId === authoritative.scope.leaderPlayerId)
      };
    });
    const maxMembers = party?.maxMembers || 4;
    const slots = party || authoritative.scope.partyId ? Array.from({ length:Math.max(maxMembers, members.length) }, (_, index) => members[index] || null) : [];
    host.innerHTML = slots.length ? slots.map(member => {
      if (!member) return emptyMemberSlotMarkup();
      const playerId = member.playerId;
      const presence = authoritative.presence[playerId];
      const status = presence?.status || (playerId === currentPlayerId ? 'online' : 'offline');
      const leader = member.isLeader || playerId === authoritative.scope.leaderPlayerId;
      const label = member.displayName || `Player ${shortPlayerId(playerId)}`;
      const badges = `${playerId === currentPlayerId ? '<span class="party-badge is-you">YOU</span>' : ''}${leader ? '<span class="party-badge is-leader">LEADER</span>' : ''}`;
      const activityId = authoritative.state?.memberActivities?.[playerId] || 'rest';
      const activity = DEFINITIONS.activities[activityId] || DEFINITIONS.activities.rest;
      return `<div class="party-member${playerId === currentPlayerId ? ' is-player' : ' is-authoritative-member'}" data-party-member-id="${escapeHtml(playerId)}"><span class="party-avatar">${playerId === currentPlayerId ? '◆' : '◌'}</span><span class="party-member-name"><strong>${escapeHtml(label)}</strong><span class="party-member-badges">${badges}</span><small>${activity.icon} ${escapeHtml(activity.rosterName)} · ${status === 'online' ? 'Online' : 'Offline'}</small></span><span class="party-presence">${status.toUpperCase()}</span></div>`;
    }).join('') : '<div class="small party-empty-state">No party membership is currently available.</div>';
  }

  function displayJoinCode(joinCode) {
    return joinCode ? `${joinCode.slice(0, 5)}-${joinCode.slice(5)}` : '—';
  }

  function partyLeaderLabel(runtimeState) {
    const party = runtimeState.authoritative.party;
    const leaderId = party?.leaderId || runtimeState.authoritative.scope.leaderPlayerId;
    if (!leaderId) return 'Awaiting party details';
    if (leaderId === runtimeState.identity.authenticatedPlayerId) return 'You';
    const leader = party?.members?.find(member => member.playerId === leaderId) || runtimeState.authoritative.scope.members?.find(member => member.playerId === leaderId);
    return leader?.displayName || `Player ${shortPlayerId(leaderId)}`;
  }

  function authoritativePartyManagementMarkup(runtimeState) {
    const party = runtimeState.authoritative.party;
    const disabled = partyManagementBusy ? ' disabled' : '';
    if (!party) return `<div class="party-management-heading"><div><small>PARTY ACCESS · DEVELOPMENT</small><span>Create a party or enter a join code from another PC.</span></div><button class="btn btn-small" data-party-create${disabled}>Create party</button></div><div class="party-management-join"><input id="partyJoinCodeInput" type="text" inputmode="text" autocomplete="off" maxlength="11" placeholder="ABCDE-2345" value="${escapeHtml(partyJoinCodeDraft)}"${disabled}><button class="btn btn-small" data-party-join${disabled}>Join</button></div>`;
    const members = party.members?.length || runtimeState.authoritative.scope.memberPlayerIds.length;
    return `<div class="party-management-heading"><div><small>PARTY JOIN CODE</small><strong class="party-join-code">${escapeHtml(displayJoinCode(party.joinCode))}</strong><span>Leader: ${escapeHtml(partyLeaderLabel(runtimeState))} · ${members}/${party.maxMembers} members</span></div><button class="btn btn-small" data-party-leave${disabled}>Leave party</button></div>`;
  }

  function bindAuthoritativePartyManagement(host) {
    const input = host.querySelector('#partyJoinCodeInput');
    if (input) input.oninput = () => { partyJoinCodeDraft = input.value; };
    const create = host.querySelector('[data-party-create]');
    if (create) create.onclick = () => { void runPartyManagement(() => partyClient.createParty()); };
    const join = host.querySelector('[data-party-join]');
    if (join) join.onclick = () => { void runPartyManagement(() => partyClient.joinParty(partyJoinCodeDraft)); };
    const leave = host.querySelector('[data-party-leave]');
    if (leave) leave.onclick = () => { void runPartyManagement(() => partyClient.leaveParty()); };
  }

  async function runPartyManagement(action) {
    if (partyManagementBusy) return;
    partyManagementBusy = true;
    render(true);
    try {
      await action();
    } finally {
      partyManagementBusy = false;
      render(true);
    }
  }

  function authoritativeActionMarkup(runtimeState, compact = false) {
    const activity = runtimeState.authoritative.state?.activity;
    const party = runtimeState.authoritative.party;
    if (!runtimeState.authoritative.scope.partyId) return '<div class="small party-authoritative-note">Join a party to unlock shared server progress.</div>';
    const currentPlayerId = runtimeState.identity.authenticatedPlayerId;
    const selectedActivity = runtimeState.authoritative.state?.memberActivities?.[currentPlayerId || ''] || 'rest';
    const activityButtons = Object.entries(DEFINITIONS.activities).map(([id, definition]) => `<button class="btn party-action party-activity-action${selectedActivity === id ? ' is-selected' : ''}" data-authoritative-activity="${id}" title="${escapeHtml(definition.rewardFocus)}" ${!isConnected() || commandIsPending() ? 'disabled' : ''}><span>${definition.icon}</span>${compact ? '' : `${escapeHtml(definition.name)}<small>${escapeHtml(definition.rewardFocus)}</small>`}</button>`).join('');
    const activityPicker = `<div class="party-activity-picker"><div class="small party-authoritative-note">Your party activity · selected activity is your primary reward focus; party activity adds shared XP.</div><div class="party-activity-actions">${activityButtons}</div></div>`;
    const pendingReward = authoritativePendingReward(runtimeState);
    const rewardReady = pendingReward ? `<div class="party-reward-ready"><strong>Reward ready</strong><span>${authoritativeRewardDescription(pendingReward)}</span>${authoritativeRewardButtonMarkup('Claim reward', pendingReward)}</div>` : '';
    if (activity?.status === 'active') {
      return `${activityPicker}${rewardReady}<div class="small party-authoritative-note">The expedition progresses automatically from server time. Change activity whenever you like; time already spent is kept.</div>`;
    }
    if (activity?.status === 'completed') return `${activityPicker}${rewardReady}<div class="small party-authoritative-note">Expedition complete. ${pendingReward ? 'Claim your reward, then the party leader can reset it.' : 'The party leader can reset it.'}</div>`;
    const leaderName = partyLeaderLabel(runtimeState);
    return `${activityPicker}${rewardReady}<div class="small party-authoritative-note">${leaderName === 'You' ? 'You can start the shared forest expedition when your party is ready.' : `${escapeHtml(leaderName)} starts the shared forest expedition.`}</div>`;
  }

  function bindAuthoritativeActions(host) {
    host.querySelectorAll('[data-authoritative-activity]').forEach(button => {
      button.onclick = () => { void partyClient.setActivity(button.dataset.authoritativeActivity); };
    });
  }

  function renderAuthoritative(runtimeState, force = false) {
    const authoritative = runtimeState.authoritative;
    const authoritativeState = authoritative.state;
    const connectionStatus = runtimeState.connection;
    const pending = authoritative.pendingCommandIds.join(',');
    const error = authoritative.lastError?.message || '';
    const party = authoritative.party;
    const displayName = runtimeState.identity.displayName || '';
    const rewardId = authoritativePendingReward(runtimeState)?.id || 'none';
    const signature = `authoritative:${connectionStatus}:${authoritative.scope.partyId || 'none'}:${party?.updatedAt || 'none'}:${party?.members.length || 0}:${displayName}:${authoritativeState?.revision ?? 'none'}:${rewardId}:${pending}:${error}:${partyManagementBusy}:${presentation.compact}`;
    if (!force && signature === lastRenderSignature) return;
    lastRenderSignature = signature;
    renderIdentity(runtimeState);

    const partyLabel = authoritative.scope.partyId ? 'Party' : 'No party membership';
    if (elements.transportLabel) elements.transportLabel.textContent = 'PARTY STATE';
    const stateLabel = authoritativeActivityLabel(authoritativeState);
    const connectionText = connectionStatus === CONNECTION_STATES.CONNECTED ? `${partyLabel} · ${stateLabel}` : connectionStatus === CONNECTION_STATES.RECONNECTING ? 'Reconnecting · showing last server state' : connectionStatus === CONNECTION_STATES.CONNECTING ? 'Connecting · acquiring server state' : connectionStatus === CONNECTION_STATES.ERROR ? 'Connection problem · showing last server state' : 'Disconnected · showing last server state';
    elements.status.textContent = error || connectionStatus === CONNECTION_STATES.ERROR ? 'Party state · Broken' : connectionStatus === CONNECTION_STATES.CONNECTED ? 'Party state · Synced' : connectionStatus === CONNECTION_STATES.RECONNECTING ? 'Party state · Reconnecting' : connectionStatus === CONNECTION_STATES.CONNECTING ? 'Party state · Connecting' : 'Party state · Offline';
    elements.status.classList.toggle('is-pending', Boolean(pending) || [CONNECTION_STATES.CONNECTING, CONNECTION_STATES.RECONNECTING].includes(connectionStatus));
    elements.status.classList.toggle('is-error', Boolean(error) || connectionStatus === CONNECTION_STATES.ERROR);
    if (elements.reconnect) {
      elements.reconnect.textContent = [CONNECTION_STATES.CONNECTING, CONNECTION_STATES.RECONNECTING].includes(connectionStatus) ? 'Connecting…' : 'Reconnect';
      elements.reconnect.disabled = [CONNECTION_STATES.CONNECTING, CONNECTION_STATES.RECONNECTING].includes(connectionStatus);
    }
    elements.management.innerHTML = authoritativePartyManagementMarkup(runtimeState);
    bindAuthoritativePartyManagement(elements.management);

    const toggle = document.getElementById('partyExpeditionToggle');
    const leaderId = party?.leaderId || authoritative.scope.leaderPlayerId;
    const isPartyLeader = Boolean(leaderId && leaderId === runtimeState.identity.authenticatedPlayerId);
    const canToggle = Boolean(authoritative.scope.partyId) && isPartyLeader && isConnected() && !pending;
    if (toggle) {
      toggle.hidden = !authoritative.scope.partyId || !isPartyLeader;
      toggle.textContent = !authoritative.scope.partyId ? 'No Party' : authoritativeState?.activity.status === 'completed' ? 'Reset Expedition' : authoritativeState?.activity.status === 'active' ? 'Server Running' : 'Start Expedition';
      toggle.disabled = !canToggle || authoritativeState?.activity.status === 'active';
    }

    renderAuthoritativeState(elements.lanes, authoritativeState);
    renderAuthoritativeMembers(elements.members, runtimeState);
    elements.actions.innerHTML = authoritativeActionMarkup(runtimeState);
    elements.actions.setAttribute('aria-busy', String(Boolean(pending)));
    bindAuthoritativeActions(elements.actions);
    renderAuthoritativeState(elements.dockLanes, authoritativeState, true);
    renderAuthoritativeMembers(elements.dockMembers, runtimeState);
    elements.dockActions.innerHTML = authoritativeActionMarkup(runtimeState, true);
    elements.dockActions.setAttribute('aria-busy', String(Boolean(pending)));
    bindAuthoritativeActions(elements.dockActions);
    elements.dockLabel.textContent = `Forest Expedition · ${stateLabel}`;
    const pendingReward = authoritativePendingReward(runtimeState);
    elements.dockNotable.innerHTML = error || (pendingReward ? `<strong>Reward ready</strong><br>${authoritativeRewardDescription(pendingReward)}` : authoritativeState ? 'Progress runs automatically while the party is online.' : 'Waiting for party state.');
    bindRewardButtons(elements.dockNotable);
    const yourActivityId = authoritativeState?.memberActivities?.[runtimeState.identity.authenticatedPlayerId || ''] || 'rest';
    const yourActivity = DEFINITIONS.activities[yourActivityId] || DEFINITIONS.activities.rest;
    elements.checkin.innerHTML = authoritative.scope.partyId ? `<span>${authoritativeState ? `Shared forest expedition is ${stateLabel.toLowerCase()}.` : 'Waiting for the server to provide the shared expedition state.'} You are on <strong>${yourActivity.icon} ${escapeHtml(yourActivity.name)}</strong>. ${authoritativeState?.activity.status === 'active' ? 'Progress updates automatically while the server runs the expedition.' : ''}</span>` : '<span>No party membership is currently available. The local fallback remains available by selecting local mode.</span>';
    bindRewardButtons(elements.actions);
    bindRewardButtons(elements.dockActions);
  }

  function refreshAuthoritativeProgress() {
    if (!partyClient || partyClient.getMode() !== 'authoritative') return;
    const runtimeState = currentRuntimeState();
    const authoritativeState = runtimeState.authoritative.state;
    renderAuthoritativeState(elements.lanes, authoritativeState);
    renderAuthoritativeState(elements.dockLanes, authoritativeState, true);
    if (authoritativeState?.activity.status === 'active' && authoritativeProgressPercent(authoritativeState) >= 100 && !completionRefreshPending) {
      completionRefreshPending = true;
      void partyClient.requestSnapshot().catch(() => undefined).finally(() => { completionRefreshPending = false; });
    }
  }

  function render(force = false) {
    const runtimeState = currentRuntimeState();
    if (runtimeState.mode === 'authoritative') return renderAuthoritative(runtimeState, force);
    return renderLocal(force);
  }

  function bindRewardButtons(host) {
    host.querySelectorAll('[data-claim-party-reward]').forEach(button => { button.onclick = () => { void claimReward(); }; });
  }

  function summarySince(snapshot, lastTick) {
    const expedition = snapshot.expedition;
    const events = snapshot.recentEvents.filter(event => event.tick > lastTick).slice(0,8);
    const player = currentPlayer(snapshot);
    const eventHtml = events.length ? events.map(event => `<li>${escapeHtml(event.text)}</li>`).join('') : '<li>No notable events yet. Your party is still progressing.</li>';
    const contributions = expedition.lastContributions || snapshot.party.members.map(member => ({ ...member, total:memberContribution(member) }));
    const rewardHtml = expedition.pendingRewards ? `<div class="summary-reward"><strong>Expedition reward ready</strong><span>${rewardDescription(expedition.pendingRewards)}</span>${rewardButtonMarkup('Claim reward')}</div>` : '';
    return `<div class="summary-stat-grid"><div><small>Ticks resolved</small><strong>${Math.max(0, snapshot.elapsedTicks - lastTick)}</strong></div><div><small>Expeditions</small><strong>${expedition.completedExpeditions}</strong></div><div><small>Your activity</small><strong>${DEFINITIONS.activities[player.activity]?.name || 'Activity'}</strong></div></div><h3>Party activities</h3><ul class="summary-party">${contributions.map(member => `<li><strong>${escapeHtml(member.name)}</strong> · ${member.activity ? DEFINITIONS.activities[member.activity]?.rosterName || 'Activity' : 'Activity'} · passive output</li>`).join('')}</ul>${rewardHtml}<h3>Notable events</h3><ul class="summary-events">${eventHtml}</ul>`;
  }

  function showReturnSummary(previousTick) {
    const snapshot = currentSnapshot();
    if (snapshot.elapsedTicks - previousTick < 10 && !snapshot.recentEvents.length) return;
    elements.summaryBody.innerHTML = summarySince(snapshot, previousTick);
    bindRewardButtons(elements.summaryBody);
    elements.summary.style.display = 'flex';
  }

  function setCompact(compact) {
    presentation.compact = Boolean(compact);
    document.body.classList.toggle('taskbar-compact-mode', presentation.compact);
    elements.dock.setAttribute('aria-hidden', String(!presentation.compact));
    elements.dock.style.display = presentation.compact ? 'block' : 'none';
    try { localStorage.setItem(COMPACT_STORAGE_KEY, presentation.compact ? '1' : '0'); } catch {}
    render(true);
  }

  async function initializeClient() {
    partyClient = window.MomentumPartyRuntime;
    await partyClient.initialize();
    partyClient.subscribe(() => render(true));
    authoritativeProgressTimer = window.setInterval(refreshAuthoritativeProgress, 1000);
  }


  document.getElementById('partyExpeditionToggle').onclick = toggleExpedition;
  document.getElementById('partyReconnectBtn').onclick = () => { void reconnect(); };
  document.getElementById('collapseTaskbarBtn').onclick = () => setCompact(true);
  document.getElementById('expandTaskbarBtn').onclick = () => setCompact(false);
  document.getElementById('closeTaskbarSummary').onclick = () => { elements.summary.style.display = 'none'; render(true); };

  async function init() {
    await initializeClient();
    const initialState = currentRuntimeState();
    previousTickForSummary = initialState.mode === 'local' ? initialState.client.snapshot.elapsedTicks : initialState.authoritative.state?.revision ?? 0;
    render(true);
    let compact = false;
    try { compact = localStorage.getItem(COMPACT_STORAGE_KEY) === '1'; } catch {}
    setCompact(compact);
    await partyClient.connect();
  }

  window.MomentumPartySync = Object.freeze({
    getSnapshot:() => partyClient.getSnapshot(),
    getStoreState:() => partyClient.getState(),
    getSessionState:() => partyClient.getSessionState(),
    getMode:() => partyClient.getMode(),
    getRequestedMode:() => partyClient.getRequestedMode(),
    getCommandState:type => partyClient.getCommandState(type),
    getParty:() => partyClient.getParty(),
    createParty:() => partyClient.createParty(),
    joinParty:joinCode => partyClient.joinParty(joinCode),
    leaveParty:() => partyClient.leaveParty(),
    requestSnapshot,
    setActivity,
    startExpedition:() => partyClient.startExpedition(),
    pauseExpedition:() => partyClient.pauseExpedition(),
    resumeExpedition:() => partyClient.resumeExpedition(),
    resetExpedition:() => partyClient.resetExpedition(),
    contribute:amount => partyClient.contribute(amount),
    toggleExpedition,
    claimReward,
    reconnect,
    getConnectionState:() => partyClient.getConnectionState()
  });
  window.MomentumTaskbar = Object.freeze({
    getState:() => partyClient.getState(),
    setCompact,
    render,
    startExpedition:() => partyClient.startExpedition(),
    pauseExpedition:() => partyClient.pauseExpedition(),
    resumeExpedition:() => partyClient.resumeExpedition(),
    claimReward
  });
  void init().catch(error => { console.error('Momentum party client failed to initialize.', error); });
})();
