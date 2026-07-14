(() => {
  'use strict';

  const transportApi = window.MomentumPartyTransport;
  const { CONNECTION_STATES, COMMAND_TYPES, DEFINITIONS, assertTransport, clone, createCommandEnvelope } = transportApi;
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
  const responseLog = [];
  let transport = null;
  let partyStore = null;
  let commandController = null;
  let reconnectTimer = null;
  let previousTickForSummary = null;
  let lastRenderSignature = '';

  const { createPartySnapshotStore } = window.MomentumPartyStore;
  const { createPartyCommandController } = window.MomentumPartyController;

  function currentStoreState() {
    return partyStore.getState();
  }

  function currentSnapshot() {
    return currentStoreState().snapshot;
  }

  function isConnected() {
    return currentStoreState().connection.status === CONNECTION_STATES.CONNECTED;
  }

  function commandIsPending(type) {
    return currentStoreState().pendingCommands.some(command => command.type === type);
  }

  function commandStatus(type) {
    return partyStore.getCommandState(type).status;
  }

  function rewardDescription(reward) {
    return reward ? `+${reward.pineLogs} Pine Logs · +${reward.cookedFish} Cooked Fish` : '';
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

  function setActivity(activityId) {
    if (!DEFINITIONS.activities[activityId]) return false;
    return commandController.submit(COMMAND_TYPES.SET_ACTIVITY, { activityId });
  }

  function startExpedition() {
    return commandController.submit(COMMAND_TYPES.START_EXPEDITION);
  }

  function pauseExpedition() {
    return commandController.submit(COMMAND_TYPES.PAUSE_EXPEDITION);
  }

  function resumeExpedition() {
    return commandController.submit(COMMAND_TYPES.RESUME_EXPEDITION);
  }

  function toggleExpedition() {
    const status = currentSnapshot().expedition.status;
    if (status === 'active') return pauseExpedition();
    if (status === 'paused') return resumeExpedition();
    return startExpedition();
  }

  function claimReward() {
    const reward = currentSnapshot().expedition.pendingRewards;
    if (!reward || commandIsPending(COMMAND_TYPES.CLAIM_REWARD)) return false;
    return commandController.submit(COMMAND_TYPES.CLAIM_REWARD, { rewardId:reward.id || `forest-expedition-${reward.expedition}` });
  }

  function requestSnapshot() {
    return commandController.requestSnapshot();
  }

  function resolveElapsed() {
    return typeof transport.resolveElapsed === 'function' ? transport.resolveElapsed() : 0;
  }

  function simulateTick() {
    return typeof transport.simulateTick === 'function' ? transport.simulateTick() : false;
  }

  function simulateReconnect() {
    const status = currentStoreState().connection.status;
    if (status === CONNECTION_STATES.CONNECTING || status === CONNECTION_STATES.RECONNECTING) return false;
    clearTimeout(reconnectTimer);
    if (status === CONNECTION_STATES.CONNECTED) {
      transport.disconnect();
      reconnectTimer = setTimeout(() => {
        reconnectTimer = null;
        transport.connect();
      }, 800);
      return true;
    }
    return transport.connect();
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
    host.innerHTML = members.map(member => `<div class="party-member${member.id === 'player' ? ' is-player' : ' is-ghost'}"><span class="party-avatar">${member.id === 'player' ? '◆' : '◌'}</span><span class="party-member-name"><strong>${affinityLabel(member)} ${member.name}</strong><small>${formatActivity(member)} · ${ghostRecency(member, snapshot)} · ${Math.floor(memberContribution(member))} contribution</small></span><span class="party-presence">${member.id === 'player' ? 'YOU' : 'GHOST'}</span></div>`).join('');
  }

  function actionMarkup(snapshot, compact = false) {
    const player = snapshot.party.members.find(member => member.id === 'player') || snapshot.party.members[0];
    const recommended = recommendedActivity();
    const pending = commandIsPending(COMMAND_TYPES.SET_ACTIVITY);
    const disabled = !isConnected() || pending;
    return Object.entries(DEFINITIONS.activities).map(([id, activity]) => `<button class="btn party-action${player?.activity === id ? ' is-selected' : ''}${recommended === id ? ' is-recommended' : ''}" data-party-activity="${id}" title="${recommended === id ? 'Recommended by your current skill levels' : activity.name}" ${disabled ? 'disabled' : ''}><span>${activity.icon}</span>${compact ? '' : activity.name}${recommended === id && !compact ? '<small>Recommended</small>' : ''}</button>`).join('');
  }

  function bindActions(host) {
    host.querySelectorAll('[data-party-activity]').forEach(button => { button.onclick = () => setActivity(button.dataset.partyActivity); });
  }

  function pendingCommandLabel(storeState) {
    const pending = storeState.pendingCommands[0];
    return pending ? COMMAND_LABELS[pending.type] || 'command' : '';
  }

  function commandError(storeState) {
    return storeState.commandErrors[0]?.message || '';
  }

  function rewardButtonMarkup(label) {
    const disabled = !isConnected() || commandIsPending(COMMAND_TYPES.CLAIM_REWARD);
    return `<button class="btn btn-small" data-claim-party-reward ${disabled ? 'disabled' : ''}>${commandIsPending(COMMAND_TYPES.CLAIM_REWARD) ? 'Claiming…' : label}</button>`;
  }

  function render(force = false) {
    const storeState = currentStoreState();
    const snapshot = storeState.snapshot;
    const expedition = snapshot.expedition;
    const player = snapshot.party.members.find(member => member.id === 'player') || snapshot.party.members[0];
    const pendingSignature = storeState.pendingCommands.map(command => `${command.type}:${command.commandId}`).join(',');
    const error = commandError(storeState);
    const signature = `${storeState.acceptedRevision}:${storeState.connection.status}:${pendingSignature}:${error}:${snapshot.elapsedTicks}:${expedition.status}:${expedition.pendingRewards?.id || 'clear'}:${player?.activity || ''}:${presentation.compact}`;
    if (!force && signature === lastRenderSignature) return;
    lastRenderSignature = signature;

    const connectionStatus = storeState.connection.status;
    const expeditionLabel = expedition.status === 'active' ? 'Active' : expedition.status === 'paused' ? 'Paused' : 'Ready';
    const connectionText = connectionStatus === CONNECTION_STATES.DISCONNECTED ? 'Disconnected · showing last snapshot' : connectionStatus === CONNECTION_STATES.CONNECTING ? 'Connecting · showing last snapshot' : connectionStatus === CONNECTION_STATES.RECONNECTING ? 'Reconnecting · showing last snapshot' : connectionStatus === CONNECTION_STATES.ERROR ? 'Connection problem · showing last snapshot' : `${expeditionLabel} · local async simulation`;
    elements.status.textContent = `${connectionText} · Expedition ${expedition.completedExpeditions + 1}`;
    if (elements.sync) {
      elements.sync.textContent = connectionStatus === CONNECTION_STATES.DISCONNECTED ? `Offline · last confirmed revision ${storeState.acceptedRevision}` : connectionStatus === CONNECTION_STATES.CONNECTING ? 'Connecting…' : connectionStatus === CONNECTION_STATES.RECONNECTING ? 'Reconnecting…' : pendingCommandLabel(storeState) ? `Syncing ${pendingCommandLabel(storeState)}…` : error ? `${error} · retry available` : `Synced · revision ${storeState.acceptedRevision}`;
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

    const latestEvent = snapshot.recentEvents[0]?.text || 'Progress continues quietly.';
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
    host.querySelectorAll('[data-claim-party-reward]').forEach(button => { button.onclick = claimReward; });
  }

  function summarySince(snapshot, lastTick) {
    const expedition = snapshot.expedition;
    const events = snapshot.recentEvents.filter(event => event.tick > lastTick).slice(0,8);
    const player = snapshot.party.members.find(member => member.id === 'player') || snapshot.party.members[0];
    const eventHtml = events.length ? events.map(event => `<li>${event.text}</li>`).join('') : '<li>No notable events yet. Your party is still progressing.</li>';
    const contributions = expedition.lastContributions || snapshot.party.members.map(member => ({ ...member, total:memberContribution(member) }));
    const rewardHtml = expedition.pendingRewards ? `<div class="summary-reward"><strong>Expedition reward ready</strong><span>${rewardDescription(expedition.pendingRewards)}</span>${rewardButtonMarkup('Claim reward')}</div>` : '';
    return `<div class="summary-stat-grid"><div><small>Ticks resolved</small><strong>${Math.max(0, snapshot.elapsedTicks - lastTick)}</strong></div><div><small>Expeditions</small><strong>${expedition.completedExpeditions}</strong></div><div><small>Your activity</small><strong>${DEFINITIONS.activities[player.activity]?.name || 'Activity'}</strong></div></div><h3>Party contribution</h3><ul class="summary-party">${contributions.map(member => { const total = member.total ?? memberContribution(member); return `<li><strong>${member.name}</strong> · ${member.activity ? DEFINITIONS.activities[member.activity]?.name || 'Activity' : 'Activity'} · ${Math.floor(total)} contribution</li>`; }).join('')}</ul>${rewardHtml}<h3>Notable events</h3><ul class="summary-events">${eventHtml}</ul>`;
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

  function verificationSnapshot(revision, options = {}) {
    const pending = options.pending ? { id:'forest-expedition-1', expedition:1, pineLogs:20, cookedFish:3 } : null;
    const claimed = options.claimed ? [{ id:'forest-expedition-1', expedition:1, pineLogs:20, cookedFish:3 }] : [];
    return {
      revision,
      connection:{ status:CONNECTION_STATES.CONNECTED, lastConfirmedAt:revision },
      party:{ id:'local-party', members:[{ id:'player', name:'You', type:'human', affinity:'balanced', activity:'forest_patrol', lastActivityTick:0, totals:{ threat:revision, timber:0, supplies:0 } }] },
      expedition:{ status:'active', completedExpeditions:options.claimed ? 1 : 0, lanes:{ threat:revision, timber:0, supplies:0 }, contributions:{ player:{ threat:revision, timber:0, supplies:0 } }, lastContributions:null, pendingRewards:pending, claimedRewards:claimed },
      recentEvents:[{ text:`revision ${revision}`, tick:revision, at:revision }],
      elapsedTicks:revision,
      lastResolvedAt:revision
    };
  }

  function createVerificationTransport() {
    const snapshots = new Set();
    const connections = new Set();
    const results = new Set();
    let status = CONNECTION_STATES.CONNECTED;
    return {
      connect(){ status = CONNECTION_STATES.CONNECTED; connections.forEach(listener => listener(status)); return true; },
      disconnect(){ status = CONNECTION_STATES.DISCONNECTED; connections.forEach(listener => listener(status)); return true; },
      getConnectionState:() => status,
      requestSnapshot:() => verificationSnapshot(0),
      submitCommand:command => { results.forEach(listener => listener({ commandId:command.commandId, status:'confirmed', snapshot:verificationSnapshot(1) })); return true; },
      subscribeToSnapshots(listener){ snapshots.add(listener); return () => snapshots.delete(listener); },
      subscribeToConnection(listener){ connections.add(listener); return () => connections.delete(listener); },
      subscribeToCommandResults(listener){ results.add(listener); return () => results.delete(listener); },
      destroy(){}
    };
  }

  function runSnapshotVerification() {
    const failures = [];
    const checks = [];
    const check = (name, condition) => { checks.push({ name, passed:Boolean(condition) }); if (!condition) failures.push(name); };

    const ordering = createPartySnapshotStore(verificationSnapshot(0), CONNECTION_STATES.CONNECTED);
    check('revision 10 is accepted', ordering.acceptSnapshot(verificationSnapshot(10)).accepted);
    check('revision 9 is ignored', !ordering.acceptSnapshot(verificationSnapshot(9)).accepted && ordering.getAcceptedRevision() === 10);
    ordering.acceptSnapshot(verificationSnapshot(20));
    ordering.acceptSnapshot(verificationSnapshot(22));
    check('out-of-order revision 21 is ignored after revision 22', !ordering.acceptSnapshot(verificationSnapshot(21)).accepted && ordering.getAcceptedRevision() === 22);

    const duplicates = createPartySnapshotStore(verificationSnapshot(0), CONNECTION_STATES.CONNECTED);
    let duplicateNotifications = 0;
    duplicates.subscribe((_, reason) => { if (reason === 'snapshot') duplicateNotifications += 1; });
    duplicates.acceptSnapshot(verificationSnapshot(10, { pending:true }));
    duplicates.acceptSnapshot(verificationSnapshot(10, { pending:true }));
    check('duplicate snapshots notify only once', duplicateNotifications === 1);
    check('duplicate snapshots do not duplicate rewards or contributions', duplicates.getSnapshot().expedition.pendingRewards?.id === 'forest-expedition-1' && Object.keys(duplicates.getSnapshot().expedition.contributions).length === 1);

    const commandStore = createPartySnapshotStore(verificationSnapshot(0), CONNECTION_STATES.CONNECTED);
    const commandA = createCommandEnvelope(COMMAND_TYPES.SET_ACTIVITY, { activityId:'rest' }, 0);
    const commandB = createCommandEnvelope(COMMAND_TYPES.CLAIM_REWARD, { rewardId:'forest-expedition-1' }, 0);
    commandStore.beginCommand(commandA);
    commandStore.beginCommand(commandB);
    const resultB = commandStore.applyCommandResult({ commandId:commandB.commandId, status:'confirmed', snapshot:verificationSnapshot(22, { claimed:true }) });
    const resultA = commandStore.applyCommandResult({ commandId:commandA.commandId, status:'confirmed', snapshot:verificationSnapshot(21) });
    check('command results correlate independently', resultB.matched && resultA.matched && commandStore.getState().pendingCommands.length === 0);
    check('command result snapshots still follow revision order', commandStore.getAcceptedRevision() === 22);
    const unknownResult = commandStore.applyCommandResult({ commandId:'cmd_unknown', status:'confirmed', snapshot:verificationSnapshot(23) });
    check('unknown command result does not clear valid commands', !unknownResult.matched && commandStore.getState().pendingCommands.length === 0 && commandStore.getAcceptedRevision() === 23);
    const duplicateResult = commandStore.applyCommandResult({ commandId:commandA.commandId, status:'confirmed', snapshot:verificationSnapshot(21) });
    check('duplicate command result is ignored safely', !duplicateResult.matched && commandStore.getAcceptedRevision() === 23);

    const staleConfirmationStore = createPartySnapshotStore(verificationSnapshot(0), CONNECTION_STATES.CONNECTED);
    const staleCommand = createCommandEnvelope(COMMAND_TYPES.SET_ACTIVITY, { activityId:'rest' }, 0);
    staleConfirmationStore.beginCommand(staleCommand);
    staleConfirmationStore.acceptSnapshot(verificationSnapshot(30));
    const staleCommandResult = staleConfirmationStore.applyCommandResult({ commandId:staleCommand.commandId, status:'confirmed', snapshot:verificationSnapshot(29) });
    check('command confirms even when its snapshot is stale', staleCommandResult.matched && staleConfirmationStore.getCommandState(COMMAND_TYPES.SET_ACTIVITY).status === 'confirmed' && staleConfirmationStore.getAcceptedRevision() === 30);

    const rejectionStore = createPartySnapshotStore(verificationSnapshot(0), CONNECTION_STATES.CONNECTED);
    const activityCommand = createCommandEnvelope(COMMAND_TYPES.SET_ACTIVITY, { activityId:'rest' }, 0);
    const rewardCommand = createCommandEnvelope(COMMAND_TYPES.CLAIM_REWARD, { rewardId:'forest-expedition-1' }, 0);
    rejectionStore.beginCommand(activityCommand);
    rejectionStore.beginCommand(rewardCommand);
    rejectionStore.applyCommandResult({ commandId:activityCommand.commandId, status:'rejected', error:{ code:'TEST_REJECTION', message:'Rejected for verification.' } });
    check('rejection correlation preserves unrelated pending command', rejectionStore.getCommandState(COMMAND_TYPES.SET_ACTIVITY).status === 'rejected' && rejectionStore.getCommandState(COMMAND_TYPES.CLAIM_REWARD).status === 'pending');
    check('rejected command can be retried', Boolean(rejectionStore.beginCommand(createCommandEnvelope(COMMAND_TYPES.SET_ACTIVITY, { activityId:'rest' }, 0))));

    const disconnectStore = createPartySnapshotStore(verificationSnapshot(20), CONNECTION_STATES.CONNECTED);
    const disconnectCommand = createCommandEnvelope(COMMAND_TYPES.SET_ACTIVITY, { activityId:'rest' }, 20);
    disconnectStore.beginCommand(disconnectCommand);
    disconnectStore.setConnection(CONNECTION_STATES.DISCONNECTED);
    disconnectStore.rejectPendingCommands('TRANSPORT_DISCONNECTED', 'Changes were not saved because the party connection was lost.');
    check('disconnect preserves confirmed snapshot and rejects pending command', disconnectStore.getSnapshot().revision === 20 && disconnectStore.getCommandState(COMMAND_TYPES.SET_ACTIVITY).status === 'rejected' && disconnectStore.getState().pendingCommands.length === 0);

    const reconnectStore = createPartySnapshotStore(verificationSnapshot(40), CONNECTION_STATES.DISCONNECTED);
    reconnectStore.setConnection(CONNECTION_STATES.RECONNECTING);
    reconnectStore.acceptSnapshot(verificationSnapshot(47, { pending:true }));
    reconnectStore.setConnection(CONNECTION_STATES.CONNECTED);
    check('newer reconnect snapshot replaces preserved state', reconnectStore.getAcceptedRevision() === 47 && reconnectStore.getSnapshot().expedition.pendingRewards?.id === 'forest-expedition-1');
    check('reconnect does not duplicate contributions', Object.keys(reconnectStore.getSnapshot().expedition.contributions).length === 1);

    const rewardStore = createPartySnapshotStore(verificationSnapshot(19), CONNECTION_STATES.CONNECTED);
    rewardStore.acceptSnapshot(verificationSnapshot(20, { pending:true }));
    rewardStore.acceptSnapshot(verificationSnapshot(21, { claimed:true }));
    rewardStore.acceptSnapshot(verificationSnapshot(20, { pending:true }));
    check('older unclaimed reward cannot resurrect claimed reward', rewardStore.getSnapshot().revision === 21 && !rewardStore.getSnapshot().expedition.pendingRewards && rewardStore.getSnapshot().expedition.claimedRewards[0]?.id === 'forest-expedition-1');

    const checkedTransport = createVerificationTransport();
    check('transport exposes the required boundary', assertTransport(checkedTransport) === checkedTransport);
    check('transport command envelope has correlation fields', (() => { const envelope = createCommandEnvelope(COMMAND_TYPES.SET_ACTIVITY, { activityId:'rest' }, 7); return typeof envelope.commandId === 'string' && envelope.type === COMMAND_TYPES.SET_ACTIVITY && envelope.clientRevision === 7 && typeof envelope.createdAt === 'number'; })());
    const transportStore = createPartySnapshotStore(verificationSnapshot(0), CONNECTION_STATES.CONNECTED);
    const transportController = createPartyCommandController(transportStore, checkedTransport);
    checkedTransport.subscribeToCommandResults(result => transportStore.applyCommandResult(result));
    check('commands cross the transport boundary', transportController.submit(COMMAND_TYPES.SET_ACTIVITY, { activityId:'rest' }) && transportStore.getCommandState(COMMAND_TYPES.SET_ACTIVITY).status === 'confirmed' && transportStore.getAcceptedRevision() === 1);

    const storedCompact = (() => { try { return localStorage.getItem(COMPACT_STORAGE_KEY); } catch { return null; } })();
    const compactBefore = presentation.compact;
    try {
      setCompact(true);
      check('compact mode remains independent of transport state', document.body.classList.contains('taskbar-compact-mode'));
      setCompact(false);
      check('compact mode remains usable after a disconnected state', !document.body.classList.contains('taskbar-compact-mode'));
    } finally {
      setCompact(compactBefore);
      try { if (storedCompact === null) localStorage.removeItem(COMPACT_STORAGE_KEY); else localStorage.setItem(COMPACT_STORAGE_KEY, storedCompact); } catch {}
    }

    const result = { passed:failures.length === 0, checks, failures, acceptedRevision:partyStore.getAcceptedRevision(), transport:transport.getConnectionState() };
    console.info('[MomentumPartySync] transport verification', result);
    return result;
  }

  function initializeTransport() {
    transport = assertTransport(window.LocalMomentumPartyTransport());
    const initialSnapshot = transport.requestSnapshot();
    partyStore = createPartySnapshotStore(initialSnapshot, transport.getConnectionState());
    commandController = createPartyCommandController(partyStore, transport);
    transport.subscribeToSnapshots(snapshot => {
      const accepted = partyStore.acceptSnapshot(snapshot);
      if (accepted.accepted && previousTickForSummary !== null) {
        const previousTick = previousTickForSummary;
        previousTickForSummary = null;
        if (previousTick > 0) showReturnSummary(previousTick);
      }
    });
    transport.subscribeToConnection(status => {
      partyStore.setConnection(status);
      if (status === CONNECTION_STATES.DISCONNECTED) partyStore.rejectPendingCommands('TRANSPORT_DISCONNECTED', 'Changes were not saved because the party connection was lost.');
    });
    transport.subscribeToCommandResults(result => {
      responseLog.unshift({ ...result, receivedAt:Date.now() });
      responseLog.splice(20);
      partyStore.applyCommandResult(result);
    });
  }

  partyStore = null;
  initializeTransport();
  partyStore.subscribe(() => render(true));

  document.getElementById('partyExpeditionToggle').onclick = toggleExpedition;
  document.getElementById('partyReconnectBtn').onclick = simulateReconnect;
  document.getElementById('collapseTaskbarBtn').onclick = () => setCompact(true);
  document.getElementById('expandTaskbarBtn').onclick = () => setCompact(false);
  document.getElementById('closeTaskbarSummary').onclick = () => { elements.summary.style.display = 'none'; render(true); };

  function init() {
    previousTickForSummary = currentSnapshot().elapsedTicks;
    render(true);
    let compact = false;
    try { compact = localStorage.getItem(COMPACT_STORAGE_KEY) === '1'; } catch {}
    setCompact(compact);
    transport.connect();
  }

  window.MomentumPartySync = Object.freeze({
    getSnapshot:() => partyStore.getSnapshot(),
    getStoreState:() => partyStore.getState(),
    getCommandState:type => partyStore.getCommandState(transportApi.normalizeCommandType(type) || type),
    getTransportState:() => ({ status:transport.getConnectionState(), recentResults:clone(responseLog.slice(0,10)) }),
    requestSnapshot,
    setActivity,
    startExpedition,
    pauseExpedition,
    resumeExpedition,
    toggleExpedition,
    claimReward,
    resolveElapsed,
    simulateReconnect,
    getConnectionState:() => transport.getConnectionState(),
    runSnapshotVerification
  });
  window.MomentumTaskbar = Object.freeze({
    getState:() => partyStore.getSnapshot(),
    simulateTick,
    setCompact,
    render,
    startExpedition,
    pauseExpedition,
    resumeExpedition,
    claimReward
  });
  init();
})();
