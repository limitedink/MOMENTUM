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
    status:document.getElementById('partyExpeditionStatus'),
    reconnect:document.getElementById('partyReconnectBtn'),
    sync:document.getElementById('partySyncStatus'),
    tick:document.getElementById('partyTickLabel'),
    lanes:document.getElementById('partyLanes'),
    members:document.getElementById('partyMembers'),
    actions:document.getElementById('partyActionRow'),
    checkin:document.getElementById('partyCheckin'),
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

  function currentStoreState() {
    return partyClient.getState();
  }

  function currentSnapshot() {
    return currentStoreState().snapshot;
  }

  function isConnected() {
    return currentStoreState().session.connection.status === CONNECTION_STATES.CONNECTED;
  }

  function commandIsPending(type) {
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
    if (!DEFINITIONS.activities[activityId]) return false;
    return partyClient.setActivity(activityId);
  }

  async function toggleExpedition() {
    return partyClient.toggleExpedition();
  }

  async function claimReward() {
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
    return `${activity.icon} ${activity.name}`;
  }

  function affinityLabel(member) {
    return member.affinity === 'timber' ? '🌲' : member.affinity === 'supplies' ? '♨' : member.affinity === 'patrol' ? '⚔' : '◆';
  }

  function ghostRecency(member, snapshot) {
    return member.type === 'ghost' ? `sync ${Math.max(0, snapshot.elapsedTicks - member.lastActivityTick)} ticks ago` : 'you';
  }

  function memberContribution(member) {
    return Object.values(member.totals || {}).reduce((sum, value) => sum + (Number(value) || 0), 0);
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
    host.innerHTML = members.map(member => `<div class="party-member${member.id === currentStoreState().session.authenticatedPlayerId ? ' is-player' : ' is-ghost'}"><span class="party-avatar">${member.id === currentStoreState().session.authenticatedPlayerId ? '◆' : '◌'}</span><span class="party-member-name"><strong>${affinityLabel(member)} ${escapeHtml(member.name)}</strong><small>${formatActivity(member)} · ${ghostRecency(member, snapshot)} · ${Math.floor(memberContribution(member))} contribution</small></span><span class="party-presence">${member.id === currentStoreState().session.authenticatedPlayerId ? 'YOU' : 'GHOST'}</span></div>`).join('');
  }

  function actionMarkup(snapshot, compact = false) {
    const player = currentPlayer(snapshot);
    const recommended = recommendedActivity();
    const pending = commandIsPending(COMMAND_TYPES.SET_ACTIVITY);
    const disabled = !isConnected() || pending;
    return Object.entries(DEFINITIONS.activities).map(([id, activity]) => `<button class="btn party-action${player?.activity === id ? ' is-selected' : ''}${recommended === id ? ' is-recommended' : ''}" data-party-activity="${id}" title="${recommended === id ? 'Recommended by your current skill levels' : activity.name}" ${disabled ? 'disabled' : ''}><span>${activity.icon}</span>${compact ? '' : activity.name}${recommended === id && !compact ? '<small>Recommended</small>' : ''}</button>`).join('');
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

  function render(force = false) {
    const storeState = currentStoreState();
    const snapshot = storeState.snapshot;
    const expedition = snapshot.expedition;
    const player = currentPlayer(snapshot);
    const pendingSignature = storeState.session.pendingCommands.map(command => `${command.type}:${command.commandId}`).join(',');
    const error = commandError(storeState);
    const signature = `${storeState.session.lastAcceptedRevision}:${storeState.session.connection.status}:${pendingSignature}:${error}:${snapshot.elapsedTicks}:${expedition.status}:${expedition.pendingRewards?.id || 'clear'}:${player?.activity || ''}:${presentation.compact}`;
    if (!force && signature === lastRenderSignature) return;
    lastRenderSignature = signature;

    const connectionStatus = storeState.session.connection.status;
    const expeditionLabel = expedition.status === 'active' ? 'Active' : expedition.status === 'paused' ? 'Paused' : 'Ready';
    const connectionText = connectionStatus === CONNECTION_STATES.DISCONNECTED ? 'Disconnected · showing last snapshot' : connectionStatus === CONNECTION_STATES.CONNECTING ? 'Connecting · showing last snapshot' : connectionStatus === CONNECTION_STATES.RECONNECTING ? 'Reconnecting · showing last snapshot' : connectionStatus === CONNECTION_STATES.ERROR ? 'Connection problem · showing last snapshot' : `${expeditionLabel} · authoritative snapshot`;
    elements.status.textContent = `${connectionText} · Expedition ${expedition.completedExpeditions + 1}`;
    if (elements.sync) {
      elements.sync.textContent = connectionStatus === CONNECTION_STATES.DISCONNECTED ? `Offline · last confirmed revision ${storeState.session.lastAcceptedRevision}` : connectionStatus === CONNECTION_STATES.CONNECTING ? 'Connecting…' : connectionStatus === CONNECTION_STATES.RECONNECTING ? 'Reconnecting…' : pendingCommandLabel(storeState) ? `Syncing ${pendingCommandLabel(storeState)}…` : error ? `${error} · retry available` : `Synced · revision ${storeState.session.lastAcceptedRevision}`;
      elements.sync.classList.toggle('is-pending', Boolean(pendingCommandLabel(storeState)) || [CONNECTION_STATES.CONNECTING, CONNECTION_STATES.RECONNECTING].includes(connectionStatus));
      elements.sync.classList.toggle('is-error', Boolean(error) || connectionStatus === CONNECTION_STATES.ERROR);
    }
    if (elements.reconnect) {
      elements.reconnect.textContent = [CONNECTION_STATES.CONNECTING, CONNECTION_STATES.RECONNECTING].includes(connectionStatus) ? 'Connecting…' : 'Reconnect';
      elements.reconnect.disabled = [CONNECTION_STATES.CONNECTING, CONNECTION_STATES.RECONNECTING].includes(connectionStatus);
    }
    elements.tick.textContent = `Tick ${snapshot.elapsedTicks}`;

    const toggle = document.getElementById('partyExpeditionToggle');
    const toggleType = expedition.status === 'active' ? COMMAND_TYPES.PAUSE_EXPEDITION : expedition.status === 'paused' ? COMMAND_TYPES.RESUME_EXPEDITION : COMMAND_TYPES.START_EXPEDITION;
    if (toggle) {
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
    return `<div class="summary-stat-grid"><div><small>Ticks resolved</small><strong>${Math.max(0, snapshot.elapsedTicks - lastTick)}</strong></div><div><small>Expeditions</small><strong>${expedition.completedExpeditions}</strong></div><div><small>Your activity</small><strong>${DEFINITIONS.activities[player.activity]?.name || 'Activity'}</strong></div></div><h3>Party contribution</h3><ul class="summary-party">${contributions.map(member => { const total = member.total ?? memberContribution(member); return `<li><strong>${escapeHtml(member.name)}</strong> · ${member.activity ? DEFINITIONS.activities[member.activity]?.name || 'Activity' : 'Activity'} · ${Math.floor(total)} contribution</li>`; }).join('')}</ul>${rewardHtml}<h3>Notable events</h3><ul class="summary-events">${eventHtml}</ul>`;
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
  }


  document.getElementById('partyExpeditionToggle').onclick = toggleExpedition;
  document.getElementById('partyReconnectBtn').onclick = () => { void reconnect(); };
  document.getElementById('collapseTaskbarBtn').onclick = () => setCompact(true);
  document.getElementById('expandTaskbarBtn').onclick = () => setCompact(false);
  document.getElementById('closeTaskbarSummary').onclick = () => { elements.summary.style.display = 'none'; render(true); };

  async function init() {
    await initializeClient();
    previousTickForSummary = currentSnapshot().elapsedTicks;
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
    getCommandState:type => partyClient.getCommandState(type),
    requestSnapshot,
    setActivity,
    startExpedition:() => partyClient.startExpedition(),
    pauseExpedition:() => partyClient.pauseExpedition(),
    resumeExpedition:() => partyClient.resumeExpedition(),
    toggleExpedition,
    claimReward,
    reconnect,
    getConnectionState:() => partyClient.getConnectionState()
  });
  window.MomentumTaskbar = Object.freeze({
    getState:() => partyClient.getSnapshot(),
    setCompact,
    render,
    startExpedition:() => partyClient.startExpedition(),
    pauseExpedition:() => partyClient.pauseExpedition(),
    resumeExpedition:() => partyClient.resumeExpedition(),
    claimReward
  });
  void init().catch(error => { console.error('Momentum party client failed to initialize.', error); });
})();
