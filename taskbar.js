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
    expeditionBrief:document.getElementById('expeditionBrief'),
    expeditionAssignments:document.getElementById('expeditionAssignments'),
    members:document.getElementById('partyMembers'),
    actions:document.getElementById('partyActionRow'),
    checkin:document.getElementById('partyCheckin'),
    identity:document.getElementById('partyIdentity'),
    identityName:document.getElementById('partyIdentityName'),
    identityDetail:document.getElementById('partyIdentityDetail'),
    partyRoster:document.getElementById('partyRoster'),
    dockPartyRoster:document.getElementById('dockPartyRoster'),
    dock:document.getElementById('taskbarDock'),
    dockLabel:document.getElementById('dockExpeditionLabel'),
    dockLanes:document.getElementById('dockLanes'),
    dockExpeditionBrief:document.getElementById('dockExpeditionBrief'),
    dockExpeditionAssignments:document.getElementById('dockExpeditionAssignments'),
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
  let selectedExpeditionId = 'combat:forest-hunt';
  const expeditionAssignmentDrafts = new Map();

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

  function modernSnapshot(snapshot = null) {
    return snapshot?.expedition?.modern || null;
  }

  function partyMemberCount(snapshot = null) {
    if (isAuthoritative()) return currentRuntimeState().authoritative.scope.memberPlayerIds.length || currentRuntimeState().authoritative.party?.members?.length || 0;
    return snapshot?.party?.members?.length || 1;
  }

  function activePlayerId() {
    return isAuthoritative() ? currentRuntimeState().identity.authenticatedPlayerId : currentStoreState().session.authenticatedPlayerId;
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

  function expeditionFramework() {
    return window.MomentumExpeditions || null;
  }

  function localProfile(playerId, displayName) {
    const framework = expeditionFramework();
    const skillLevels = {};
    try {
      if (typeof skills !== 'undefined') skills.forEach(skill => { skillLevels[skill.id] = Number(skill.lvl) || 0; });
    } catch {}
    const combatLevel = Number(skillLevels.Combat) || 1;
    const profileSnapshot = playerId === currentStoreState().session.authenticatedPlayerId ? window.MomentumCombatProfile?.getSnapshot?.() : null;
    const profile = framework?.rules?.convertLegacyCombatProfile?.({ playerId, displayName, combatLevel, skills:skillLevels, gold:typeof gold === 'number' ? gold : 0 });
    if (profile && profileSnapshot) profile.combatSkills = { ...profile.combatSkills, ...profileSnapshot.combatSkills };
    return profile || { playerId, displayName, combatSkills:{}, skills:skillLevels, gold:0, gear:[], equippedGearIds:[], talents:[], loadout:{} };
  }

  function localAssignments(snapshot, definition) {
    const modern = modernSnapshot(snapshot);
    if (modern && modern.expeditionId === definition.id && modern.status !== 'idle') return modern.assignments || [];
    return expeditionAssignmentDrafts.get(definition.id) || [];
  }

  function draftAssignments(definition) {
    return (expeditionAssignmentDrafts.get(definition.id) || []).filter(assignment =>
      definition.roles.some(role => role.id === assignment.roleId)
    );
  }

  function updateDraftAssignment(definition, slotId, roleId) {
    const currentPlayerId = activePlayerId();
    const assignments = draftAssignments(definition).filter(assignment => assignment.slotId !== slotId);
    const policy = expeditionFramework()?.slotPolicy;
    if (roleId && policy && !policy.canPlayerOccupySlot(assignments, currentPlayerId, slotId, partyMemberCount(isAuthoritative() ? null : currentSnapshot()))) return;
    if (roleId) {
      const target = definition.targets.find(item => item.requiredRoleId === roleId) || definition.targets[0];
      assignments.push({ slotId, playerId:currentPlayerId, roleId, targetId:target?.id || null, active:true, assignedAt:new Date().toISOString() });
    }
    assignments.sort((a, b) => a.slotId.localeCompare(b.slotId));
    expeditionAssignmentDrafts.set(definition.id, assignments);
    render(true);
  }

  function localForecast(snapshot, definition) {
    const framework = expeditionFramework();
    if (!framework) return { assignments:[], successPercent:0, dangerPercent:0, roleCoveragePercent:0, farmingMultiplier:0, warnings:[], reward:{ resources:{} } };
    const assignments = localAssignments(snapshot, definition);
    const profiles = Object.fromEntries((snapshot.party.members || []).map(member => [member.id, localProfile(member.id, member.name)]));
    const currentId = currentStoreState().session.authenticatedPlayerId;
    profiles[currentId] = localProfile(currentId, 'You');
    return framework.rules.forecastExpedition(definition, assignments, profiles);
  }

  function adventureSignature() {
    const state = window.MomentumAdventure?.getState?.();
    return state ? `${state.status}:${state.currentNodeId}:${state.selectedRouteId || ''}:${state.pendingReward?.id || ''}:${state.completedEncounterIds.length}` : 'none';
  }

  function adventureSummaryMarkup() {
    const state = window.MomentumAdventure?.getState?.();
    if (!state) return '';
    const labels = {
      outpost:'Choose a route',
      ready:state.selectedRouteId ? 'Begin the next encounter' : 'Route decision waiting',
      in_encounter:'Encounter active',
      reward:'Reward waiting',
      complete:'Region secured',
      failed:'Restart at the outpost'
    };
    return `<div class="taskbar-adventure-note"><strong>Adventure</strong> · ${escapeHtml(labels[state.status] || 'Frontier ready')} <button class="btn btn-small btn-quiet" data-open-adventure>Open</button></div>`;
  }

  function bindAdventureButton(host) {
    host?.querySelector('[data-open-adventure]')?.addEventListener('click', () => window.MomentumAdventure?.open?.());
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
    const reward = currentSnapshot().expedition.modern?.pendingReward || currentSnapshot().expedition.pendingRewards;
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
      const value = Math.min(lane.target, Math.max(0, Number(lanes[lane.id]) || 0));
      return `<div class="party-lane"><div><span>${lane.name}</span><strong>${Math.floor(value)}/${lane.target}</strong></div><div class="party-lane-meter"><i style="width:${Math.min(100, value / lane.target * 100)}%;background:${lane.color}"></i></div></div>`;
    }).join('');
  }

  function renderMembers(host, snapshot) {
    const members = snapshot.party.members || [];
    const slots = Array.from({ length:4 }, (_, index) => members[index] || null);
    host.innerHTML = slots.map(member => member ? `<div class="party-member${member.id === currentStoreState().session.authenticatedPlayerId ? ' is-player' : ''}"><span class="party-avatar">◆</span><span class="party-member-name"><strong>${affinityLabel(member)} ${escapeHtml(member.name)}</strong><small>Party member · Expedition slot assignments</small></span><span class="party-presence">YOU</span></div>` : emptyMemberSlotMarkup()).join('');
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

  function expeditionRoleOptionMarkup(definition, selectedRole) {
    return definition.roles.map(role => `<option value="${escapeHtml(role.id)}"${role.id === selectedRole ? ' selected' : ''}>${escapeHtml(role.name)}</option>`).join('');
  }

  function assignmentEfficiency(assignments, assignment) {
    const index = (assignments || []).filter(candidate => candidate.playerId === assignment.playerId).findIndex(candidate => candidate.slotId === assignment.slotId);
    return [1, 0.85, 0.65, 0.45][Math.max(0, index)] || 0.45;
  }

  function renderExpeditionAssignments(host, definition, assignments, forecast, compact = false, authoritative = false) {
    if (!host) return;
    const fitBySlot = new Map((forecast?.assignments || []).map(assignment => [assignment.slotId, assignment.fit]));
    const currentPlayerId = activePlayerId();
    const authoritativeActive = authoritative && currentRuntimeState().authoritative.state?.activity.status === 'active';
    const localModernActive = !authoritative && modernSnapshot(currentSnapshot())?.status === 'active';
    const assignmentBySlot = new Map((assignments || []).map(assignment => [assignment.slotId, assignment]));
    host.innerHTML = Array.from({ length:4 }, (_, index) => {
      const slotId = `slot-${index + 1}`;
      const assignment = assignmentBySlot.get(slotId);
      const policy = expeditionFramework()?.slotPolicy;
      const canOccupy = policy ? policy.canPlayerOccupySlot(assignments || [], currentPlayerId, slotId, partyMemberCount(authoritative ? null : currentSnapshot())) : true;
      const editable = (!authoritative || !assignment || assignment.playerId === currentPlayerId) && canOccupy && (!authoritative || isConnected());
      if (!assignment) return `<div class="expedition-slot is-empty"><div class="expedition-slot-head"><span>Slot ${index + 1}</span><span>OPEN</span></div>${editable ? `<select class="btn expedition-role-select" data-expedition-role="${slotId}" aria-label="Role for ${slotId}"><option value="">Choose a role</option>${expeditionRoleOptionMarkup(definition, '')}</select>` : '<small>Awaiting assignment</small>'}</div>`;
      const role = definition.roles.find(candidate => candidate.id === assignment.roleId) || definition.roles[0];
      const fit = fitBySlot.get(assignment.slotId);
      const efficiency = fit?.slotEfficiency || assignmentEfficiency(assignments, assignment);
      return `<div class="expedition-slot"><div class="expedition-slot-head"><span>${escapeHtml(assignment.slotId)}</span><span>${assignment.active ? 'ACTIVE' : 'OFFLINE'}</span></div><strong>${escapeHtml(assignment.playerId === currentPlayerId ? 'You' : shortPlayerId(assignment.playerId))}</strong><small>${escapeHtml(role?.name || assignment.roleId)}${fit ? ` · Fit ${Math.round(fit.score)}` : ''} · ${Math.round(efficiency * 100)}% efficiency</small>${editable ? `<select class="btn expedition-role-select" data-expedition-role="${escapeHtml(assignment.slotId)}" aria-label="Role for ${escapeHtml(assignment.slotId)}">${expeditionRoleOptionMarkup(definition, assignment.roleId)}</select><button class="btn btn-small btn-quiet" data-expedition-clear="${escapeHtml(assignment.slotId)}">Clear</button>` : ''}</div>`;
    }).join('');
    host.classList.toggle('compact', compact);
    host.querySelectorAll('[data-expedition-role]').forEach(select => {
      select.onchange = () => {
        const slotId = select.dataset.expeditionRole;
        if (!slotId) return;
        if (authoritative && authoritativeActive) {
          if (select.value) void partyClient.setExpeditionAssignment(slotId, select.value, null);
          else void partyClient.clearExpeditionAssignment(slotId);
        } else if (localModernActive) {
          if (select.value) void partyClient.setExpeditionAssignment(slotId, select.value, null);
          else void partyClient.clearExpeditionAssignment(slotId);
        } else updateDraftAssignment(definition, slotId, select.value);
      };
    });
    host.querySelectorAll('[data-expedition-clear]').forEach(button => {
      button.onclick = () => {
        const slotId = button.dataset.expeditionClear;
        if (!slotId) return;
        if (authoritative && authoritativeActive) void partyClient.clearExpeditionAssignment(slotId);
        else if (localModernActive) void partyClient.clearExpeditionAssignment(slotId);
        else updateDraftAssignment(definition, slotId, '');
      };
    });
  }

  function expeditionBriefMarkup(definition, forecast, options = {}) {
    const compact = Boolean(options.compact);
    const authoritative = Boolean(options.authoritative);
    const state = options.state;
    const missionLocked = state?.activity?.status === 'active' || state?.activity?.status === 'completed';
    const hasPendingReward = Boolean(state?.modern?.pendingReward || (authoritative && state?.pendingRewards && Object.values(state.pendingRewards).some(rewards => Array.isArray(rewards) && rewards.length)));
    const canStart = Boolean(isConnected() && options.isLeader && state?.activity?.status === 'idle' && !hasPendingReward && !commandIsPending());
    const canReset = Boolean(isConnected() && options.isLeader && state?.activity?.status === 'completed' && !hasPendingReward && !commandIsPending());
    const resourceForecast = Object.entries(forecast?.reward?.resources || {}).slice(0, compact ? 2 : 4).map(([resource, amount]) => `+${Number(amount).toFixed(1)} ${escapeHtml(resource)}`).join(' · ') || 'No farming forecast yet';
    const warnings = forecast?.warnings?.[0] || (state?.activity?.status === 'active' ? 'Assignments can change while the mission is running.' : 'Choose roles that fit your build before starting.');
    const definitions = expeditionFramework()?.definitions || [];
    const missionButtons = definitions.map(candidate => `<button class="btn btn-small${candidate.id === definition.id ? ' is-selected' : ''}" data-expedition-select="${escapeHtml(candidate.id)}" ${missionLocked ? 'disabled' : ''}>${escapeHtml(candidate.kind === 'combat' ? '⚔ Combat' : '♨ Cooking')}</button>`).join('');
    const disabledReason = !isConnected() ? 'Reconnect to manage the expedition.' : !options.isLeader ? 'Only the party leader can start or abandon this expedition.' : hasPendingReward ? 'Claim the pending expedition reward first.' : state?.activity?.status === 'completed' ? 'Reset the completed expedition before starting another.' : '';
    const resetButton = state?.activity?.status === 'completed' ? `<button class="btn btn-small" data-expedition-reset ${canReset ? '' : 'disabled'}>Reset Expedition</button>` : '';
    const startButton = `<div class="expedition-control-group"><button class="btn btn-small" data-expedition-start="${escapeHtml(definition.id)}" ${canStart ? '' : 'disabled'}>Start Expedition</button>${resetButton}${state?.activity?.status === 'active' && options.isLeader ? `<button class="btn btn-small btn-danger" data-expedition-abandon>Abandon Expedition</button>` : ''}${!canStart && disabledReason ? `<small class="expedition-control-note">${escapeHtml(disabledReason)}</small>` : ''}</div>`;
    const derived = options.derived;
    const combatReadout = definition.kind === 'combat' && derived ? `<div class="expedition-brief-note">Combat Rating <strong>${Math.round(derived.combatRating)}</strong> · Defense Rating <strong>${Math.round(derived.defenseRating)}</strong> · Gold <strong>${Math.floor(options.profile?.gold || 0)}</strong> · Respec ${Math.round(options.respecCost || 0)} Gold</div>` : '';
    return `<div class="expedition-brief-heading"><div><strong>${escapeHtml(definition.name)}</strong><span>${escapeHtml(definition.description)}</span></div><div class="expedition-brief-actions">${missionButtons}${startButton}</div></div><div class="expedition-brief-meters"><div class="expedition-brief-meter"><small>Projected success</small><strong>${Math.round(forecast?.successPercent || state?.expedition?.forecast?.successPercent || 0)}%</strong></div><div class="expedition-brief-meter is-danger"><small>Danger rate</small><strong>${Math.round(forecast?.dangerPercent || state?.expedition?.forecast?.dangerPercent || 0)}%</strong></div><div class="expedition-brief-meter is-reward"><small>Farming forecast</small><strong>${escapeHtml(resourceForecast)}</strong></div></div>${combatReadout}<div class="expedition-brief-note">${escapeHtml(warnings)}</div>`;
  }

  function bindExpeditionBrief(host, snapshot, definition, authoritative = false) {
    host?.querySelectorAll('[data-expedition-select]').forEach(button => {
      button.onclick = () => { selectedExpeditionId = button.dataset.expeditionSelect || selectedExpeditionId; render(true); };
    });
    host?.querySelectorAll('[data-expedition-start]').forEach(button => {
      button.onclick = () => {
        void partyClient.startExpeditionMission(definition.id, draftAssignments(definition).map(assignment => ({ slotId:assignment.slotId, playerId:assignment.playerId, roleId:assignment.roleId, targetId:assignment.targetId })));
      };
    });
    host?.querySelector('[data-expedition-abandon]')?.addEventListener('click', () => {
      if (window.confirm('Abandon this expedition? Farming rewards will be preserved, but completion rewards will be forfeited.')) void partyClient.abandonExpedition();
    });
    host?.querySelector('[data-expedition-reset]')?.addEventListener('click', () => { void partyClient.resetExpedition(); });
  }

  function renderLocalExpedition(snapshot, compact = false) {
    const framework = expeditionFramework();
    if (!framework) return;
    const persistedModern = modernSnapshot(snapshot);
    const activeModernId = persistedModern && persistedModern.status !== 'idle' ? persistedModern.expeditionId : selectedExpeditionId;
    const definition = framework.getDefinition(activeModernId) || framework.combat;
    if (persistedModern && persistedModern.status !== 'idle') selectedExpeditionId = persistedModern.expeditionId;
    const forecast = localForecast(snapshot, definition);
    const assignments = localAssignments(snapshot, definition);
    const currentId = currentStoreState().session.authenticatedPlayerId;
    const profile = localProfile(currentId, 'You');
    const derived = definition.kind === 'combat' ? framework.rules.deriveCombatProfile(profile) : null;
    const host = compact ? elements.dockExpeditionBrief : elements.expeditionBrief;
    const slots = compact ? elements.dockExpeditionAssignments : elements.expeditionAssignments;
    const modern = modernSnapshot(snapshot) || { status:'idle', expeditionId:definition.id, assignments:[], forecast:null, pendingReward:null };
    if (host) { host.innerHTML = expeditionBriefMarkup(definition, forecast, { compact, derived, profile, respecCost:framework.rules.respecCost(profile), state:{ activity:{ status:modern.status }, modern }, isLeader:true }); bindExpeditionBrief(host, snapshot, definition); }
    renderExpeditionAssignments(slots, definition, assignments, forecast, compact, false);
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
    const modern = modernSnapshot(snapshot);
    const player = currentPlayer(snapshot);
    const pendingSignature = storeState.session.pendingCommands.map(command => `${command.type}:${command.commandId}`).join(',');
    const error = commandError(storeState);
    const signature = `${storeState.session.lastAcceptedRevision}:${storeState.session.connection.status}:${pendingSignature}:${error}:${snapshot.elapsedTicks}:${expedition.status}:${modern?.status || 'idle'}:${modern?.pendingReward?.id || 'clear'}:${modern?.assignments?.map(assignment => `${assignment.slotId}:${assignment.roleId}`).join(',') || ''}:${player?.activity || ''}:${selectedExpeditionId}:${presentation.compact}:${adventureSignature()}`;
    if (!force && signature === lastRenderSignature) return;
    lastRenderSignature = signature;
    renderIdentity(currentRuntimeState());
    elements.management.innerHTML = '';

    const connectionStatus = storeState.session.connection.status;
    if (elements.transportLabel) elements.transportLabel.textContent = 'PARTY STATE';
    const expeditionLabel = modern?.status === 'active' ? 'Active' : modern?.status === 'completed' ? 'Complete' : 'Ready';
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
    if (toggle) toggle.hidden = true;

    renderLanes(elements.lanes, snapshot);
    renderLocalExpedition(snapshot);
    renderMembers(elements.members, snapshot);
    elements.actions.innerHTML = '';
    elements.actions.hidden = true;

    renderLanes(elements.dockLanes, snapshot);
    renderLocalExpedition(snapshot, true);
    renderMembers(elements.dockMembers, snapshot);
    elements.dockActions.innerHTML = '';
    elements.dockActions.hidden = true;
    elements.dockLabel.textContent = `Forest Expedition · ${expedition.status} · ${expedition.completedExpeditions} complete`;

    const latestEvent = escapeHtml(snapshot.recentEvents[0]?.text || 'Progress continues quietly.');
    const modernReward = modern?.pendingReward;
    const rewardNotice = modernReward
      ? `<strong>Reward ready</strong><br>${escapeHtml(modernReward.ledger.outcome === 'failed' ? 'Farming preserved · completion forfeited' : 'Completion rewards ready')} ${rewardButtonMarkup('Claim')}`
      : expedition.pendingRewards ? `<strong>Reward ready</strong><br>${rewardDescription(expedition.pendingRewards)} ${rewardButtonMarkup('Claim')}` : latestEvent;
    elements.dockNotable.innerHTML = `${rewardNotice}${adventureSummaryMarkup()}`;
    if (modern?.pendingReward) {
      const outcome = modern.pendingReward.ledger.outcome === 'failed' ? 'Farming preserved; completion rewards were forfeited.' : 'Completion rewards are ready.';
      elements.checkin.innerHTML = `<strong>Expedition reward ready.</strong> ${escapeHtml(outcome)} ${rewardButtonMarkup('Claim reward')}`;
    } else {
      const lastClaimed = expedition.claimedRewards?.[0];
      const claimedText = lastClaimed ? ` Last reward claimed: ${rewardDescription(lastClaimed)}.` : '';
      const assignedSlots = localAssignments(snapshot, expeditionFramework()?.getDefinition(selectedExpeditionId) || expeditionFramework()?.combat).length;
      elements.checkin.innerHTML = `<span>${assignedSlots ? `You have ${assignedSlots} expedition slot${assignedSlots === 1 ? '' : 's'} assigned.` : 'Choose a role in an open expedition slot when you are ready.'} ${latestEvent}${claimedText}</span>`;
    }
    bindRewardButtons(elements.dockNotable);
    bindRewardButtons(elements.checkin);
    bindAdventureButton(elements.dockNotable);
  }

  function shortPlayerId(playerId) {
    return playerId ? playerId.slice(0, 8) : 'unknown';
  }

  function renderIdentity(runtimeState) {
    if (!elements.identityName || !elements.identityDetail) return;
    const modern = runtimeState.mode === 'authoritative'
      ? runtimeState.authoritative.state?.expedition
      : runtimeState.client.snapshot.expedition.modern;
    const status = runtimeState.mode === 'authoritative'
      ? authoritativeActivityLabel(runtimeState.authoritative.state)
      : modern?.status === 'active' ? 'In progress' : modern?.status === 'completed' ? 'Complete' : 'Ready';
    const renderRoster = (host) => {
      if (!host) return;
      const currentId = runtimeState.mode === 'authoritative' ? runtimeState.identity.authenticatedPlayerId : runtimeState.client.session.authenticatedPlayerId;
      const partyMembers = runtimeState.mode === 'authoritative'
        ? runtimeState.authoritative.party?.members || []
        : runtimeState.client.snapshot.party.members.map(member => ({ playerId:member.id, displayName:member.name, isLeader:member.id === currentId }));
      const presence = runtimeState.mode === 'authoritative' ? runtimeState.authoritative.presence : {};
      const slots = Array.from({ length:4 }, (_, index) => partyMembers[index] || null);
      host.innerHTML = slots.map((member, index) => member
        ? `<div class="party-roster-slot${member.playerId === currentId ? ' is-player' : ''}" title="${escapeHtml(member.displayName || 'Party member')}"><span class="party-roster-avatar">${escapeHtml((member.displayName || '?').slice(0, 1).toUpperCase())}</span><small>${escapeHtml(member.playerId === currentId ? 'You' : member.displayName || `P${index + 1}`)}</small><i>${runtimeState.mode === 'authoritative' ? (presence[member.playerId]?.status === 'online' ? '●' : '○') : '●'}</i></div>`
        : '<button class="party-roster-slot is-empty" type="button" disabled title="Steam invites coming soon"><span>+</span><small>Invite</small></button>').join('');
    };
    renderRoster(elements.partyRoster);
    renderRoster(elements.dockPartyRoster);
    if (runtimeState.mode === 'authoritative') {
      const name = runtimeState.identity.displayName || 'Player';
      const party = runtimeState.authoritative.party;
      elements.identityName.textContent = name;
      elements.identityDetail.textContent = party ? `${party.members.length === 1 ? 'Solo' : `Party ${party.members.length}/${party.maxMembers}`} · ${status}` : `Solo · ${status}`;
      elements.identity?.classList.toggle('is-online', runtimeState.connection === CONNECTION_STATES.CONNECTED);
      return;
    }
    const player = runtimeState.client.snapshot.party.members.find(member => member.id === runtimeState.client.session.authenticatedPlayerId);
    elements.identityName.textContent = player?.name || 'Player';
    elements.identityDetail.textContent = `${runtimeState.client.snapshot.party.members.length === 1 ? 'Solo' : `Party ${runtimeState.client.snapshot.party.members.length}/4`} · ${status}`;
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
    if (reward.expeditionLedger) {
      const ledger = reward.expeditionLedger;
      Object.entries(ledger.farmingRewards || {}).forEach(([resource, amount]) => { if (amount) parts.push(`+${amount} ${resource} farmed`); });
      Object.entries(ledger.completionRewards || {}).forEach(([resource, amount]) => { if (amount) parts.push(`+${amount} ${resource}`); });
      parts.push(ledger.outcome === 'failed' ? 'Completion failed · farming preserved' : `${ledger.completionTierId || 'Completion'} secured`);
    }
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
      return `<div class="party-member${playerId === currentPlayerId ? ' is-player' : ' is-authoritative-member'}" data-party-member-id="${escapeHtml(playerId)}"><span class="party-avatar">${playerId === currentPlayerId ? '◆' : '◌'}</span><span class="party-member-name"><strong>${escapeHtml(label)}</strong><span class="party-member-badges">${badges}</span><small>Party member · ${status === 'online' ? 'Online' : 'Offline'}</small></span><span class="party-presence">${status.toUpperCase()}</span></div>`;
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
    if (!runtimeState.authoritative.scope.partyId) return '<div class="small party-authoritative-note">Join a party to unlock shared expedition progress.</div>';
    const pendingReward = authoritativePendingReward(runtimeState);
    const rewardReady = pendingReward ? `<div class="party-reward-ready"><strong>Reward ready</strong><span>${authoritativeRewardDescription(pendingReward)}</span>${authoritativeRewardButtonMarkup('Claim reward', pendingReward)}</div>` : '';
    if (activity?.status === 'active') {
      return `${rewardReady}<div class="small party-authoritative-note">The expedition progresses automatically from server time. Role changes affect future contribution only.</div>`;
    }
    if (activity?.status === 'completed') return `${rewardReady}<div class="small party-authoritative-note">Expedition complete. ${pendingReward ? 'Claim your reward, then the party leader can reset it.' : 'The party leader can reset it.'}</div>`;
    const leaderName = partyLeaderLabel(runtimeState);
    return `${activityPicker}${rewardReady}<div class="small party-authoritative-note">${leaderName === 'You' ? 'You can start the shared forest expedition when your party is ready.' : `${escapeHtml(leaderName)} starts the shared forest expedition.`}</div>`;
  }

  function bindAuthoritativeActions(host) {
    bindRewardButtons(host);
  }

  function renderAuthoritativeExpedition(runtimeState, compact = false) {
    const framework = expeditionFramework();
    if (!framework) return;
    const authoritativeState = runtimeState.authoritative.state;
    const currentExpeditionId = authoritativeState?.expedition?.expeditionId;
    const definition = framework.getDefinition(currentExpeditionId) || framework.getDefinition(selectedExpeditionId) || framework.combat;
    if (currentExpeditionId && framework.getDefinition(currentExpeditionId)) selectedExpeditionId = currentExpeditionId;
    const forecastState = authoritativeState?.expedition?.forecast;
    const forecast = {
      successPercent:forecastState?.successPercent || 0,
      dangerPercent:forecastState?.dangerPercent || 0,
      roleCoveragePercent:forecastState?.roleCoveragePercent || 0,
      farmingMultiplier:forecastState?.farmingMultiplier || 0,
      warnings:[],
      assignments:[],
      reward:{ resources:{} }
    };
    const missionActive = authoritativeState?.activity.status === 'active' || authoritativeState?.activity.status === 'completed';
    const assignments = missionActive
      ? authoritativeState?.expedition?.assignments || []
      : draftAssignments(definition);
    const party = runtimeState.authoritative.party;
    const leaderId = party?.leaderId || runtimeState.authoritative.scope.leaderPlayerId;
    const isLeader = Boolean(leaderId && leaderId === runtimeState.identity.authenticatedPlayerId);
    const host = compact ? elements.dockExpeditionBrief : elements.expeditionBrief;
    const slots = compact ? elements.dockExpeditionAssignments : elements.expeditionAssignments;
    if (host) { host.innerHTML = expeditionBriefMarkup(definition, forecast, { compact, authoritative:true, state:authoritativeState, isLeader }); bindExpeditionBrief(host, null, definition, true); }
    renderExpeditionAssignments(slots, definition, assignments, forecast, compact, true);
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
    const signature = `authoritative:${connectionStatus}:${authoritative.scope.partyId || 'none'}:${party?.updatedAt || 'none'}:${party?.members.length || 0}:${displayName}:${authoritativeState?.revision ?? 'none'}:${authoritativeState?.expedition?.expeditionId || selectedExpeditionId}:${authoritativeState?.expedition?.assignments?.map(assignment => `${assignment.slotId}:${assignment.playerId}:${assignment.roleId}:${assignment.active}`).join(',') || ''}:${rewardId}:${pending}:${error}:${partyManagementBusy}:${presentation.compact}:${adventureSignature()}`;
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
      toggle.hidden = true;
      toggle.disabled = true;
    }

    renderAuthoritativeState(elements.lanes, authoritativeState);
    renderAuthoritativeExpedition(runtimeState);
    renderAuthoritativeMembers(elements.members, runtimeState);
    elements.actions.innerHTML = '';
    elements.actions.hidden = true;
    renderAuthoritativeState(elements.dockLanes, authoritativeState, true);
    renderAuthoritativeExpedition(runtimeState, true);
    renderAuthoritativeMembers(elements.dockMembers, runtimeState);
    elements.dockActions.innerHTML = '';
    elements.dockActions.hidden = true;
    elements.dockLabel.textContent = `Forest Expedition · ${stateLabel}`;
    const pendingReward = authoritativePendingReward(runtimeState);
    elements.dockNotable.innerHTML = `${error || (pendingReward ? `<strong>Reward ready</strong><br>${authoritativeRewardDescription(pendingReward)}` : authoritativeState ? 'Progress runs automatically while the party is online.' : 'Waiting for party state.')}${adventureSummaryMarkup()}`;
    bindRewardButtons(elements.dockNotable);
    bindAdventureButton(elements.dockNotable);
    const currentDefinition = expeditionFramework()?.getDefinition(authoritativeState?.expedition?.expeditionId || selectedExpeditionId);
    const currentAssignmentCount = authoritativeState?.expedition?.assignments?.filter(assignment => assignment.playerId === runtimeState.identity.authenticatedPlayerId).length || 0;
    elements.checkin.innerHTML = authoritative.scope.partyId ? `<span>${authoritativeState ? `Shared ${currentDefinition?.kind || 'expedition'} mission is ${stateLabel.toLowerCase()}.` : 'Waiting for the server to provide the shared expedition state.'} ${currentAssignmentCount ? `You occupy ${currentAssignmentCount} expedition slot${currentAssignmentCount === 1 ? '' : 's'}.` : 'Choose a role in an open slot when you are ready.'}</span>` : '<span>No party membership is currently available. The local fallback remains available by selecting local mode.</span>';
    bindRewardButtons(elements.actions);
    bindRewardButtons(elements.dockActions);
  }

  function refreshAuthoritativeProgress() {
    if (!partyClient || partyClient.getMode() !== 'authoritative') return;
    const runtimeState = currentRuntimeState();
    const authoritativeState = runtimeState.authoritative.state;
    renderAuthoritativeState(elements.lanes, authoritativeState);
    renderAuthoritativeState(elements.dockLanes, authoritativeState, true);
    renderAuthoritativeExpedition(runtimeState);
    renderAuthoritativeExpedition(runtimeState, true);
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
    startExpeditionMission:(expeditionId, assignments) => partyClient.startExpeditionMission(expeditionId, assignments),
    setExpeditionAssignment:(slotId, roleId, targetId) => partyClient.setExpeditionAssignment(slotId, roleId, targetId),
    clearExpeditionAssignment:slotId => partyClient.clearExpeditionAssignment(slotId),
    abandonExpedition:() => partyClient.abandonExpedition(),
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
    startExpeditionMission:(expeditionId, assignments) => partyClient.startExpeditionMission(expeditionId, assignments),
    setExpeditionAssignment:(slotId, roleId, targetId) => partyClient.setExpeditionAssignment(slotId, roleId, targetId),
    clearExpeditionAssignment:slotId => partyClient.clearExpeditionAssignment(slotId),
    abandonExpedition:() => partyClient.abandonExpedition(),
    pauseExpedition:() => partyClient.pauseExpedition(),
    resumeExpedition:() => partyClient.resumeExpedition(),
    claimReward
  });
  void init().catch(error => { console.error('Momentum party client failed to initialize.', error); });
})();
