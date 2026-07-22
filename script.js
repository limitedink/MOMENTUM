/* =====================================
   GLOBALS
===================================== */
const BALANCE = {
  maxEffAtOne: 2, // efficiency when only 1 track is active
  minEffAtFull: 1.00, // efficiency when all slots are active
  defaultTickSec: 2,   // slow baseline so upgrades matter
  minTickSec: 0.25       // late game ceiling ≈ 4 actions per second
};
const RATE_BASE = 1 / BALANCE.defaultTickSec;    // baseline actions per second
const MAX_PER_SEC = 1 / BALANCE.minTickSec;      // ceiling actions per second
// ===== XP curve tuning =====
const XP_BAL = {
  base: 100,        // XP needed at L1->L2
  lin: 0.03,        // gentle linear growth per level (~3%)
  ramp: 2.0,        // added difficulty from the late-game ramp (multiplier amount)
  pivot: 75,        // where the curve bends upward hardest
  width: 12,        // softness of that bend (bigger = smoother)
  cap: 100          // max level
};

const COMBAT_PROGRESSION_FRAMEWORK = window.MomentumCombatProgression;
const SKILL_FRAMEWORK = window.MomentumSkillFramework;
const SKILL_REGISTRY = SKILL_FRAMEWORK?.registry;
const COMBAT_SKILL_TREE = SKILL_FRAMEWORK?.combatTree;
const SKILL_TREE_RULES = SKILL_FRAMEWORK?.skillTree;
const LOOT_FRAMEWORK = window.MomentumLootFramework;
const ICON_MANIFEST = window.MomentumIconManifest;
const COMBAT_DEVELOPMENT_FRAMEWORK = window.MomentumCombatDevelopment;
const FRONTIER_EXCHANGE_FRAMEWORK = window.MomentumFrontierExchange;
const WORLD_FRAMEWORK = window.MomentumWorldFramework;
const WORLD_REGION = WORLD_FRAMEWORK?.frontier;
const SOLO_FRONTIER_FRAMEWORK = window.MomentumSoloFrontier;
const SOLO_BATTLE_DESK_RENDERER = window.MomentumSoloFrontierBattleDeskRenderer;

const MAX_SKILL_LEVEL = 100;   // set to 99, 100, 120, 500, 1000... your call
const skills = [
  { id:'Mining',   basePerSec: RATE_BASE, active:false, qty:0, lvl:1, xp:0, next: xpToNext(1), progress:0 },
  { id:'Smithing', basePerSec: RATE_BASE, active:false, qty:0, lvl:1, xp:0, next: xpToNext(1), progress:0 },
  { id:'Crafting', basePerSec: 0.35, active:false, qty:0, lvl:1, xp:0, next: xpToNext(1), progress:0 },
  { id:'Fishing',  basePerSec: RATE_BASE, active:false, qty:0, lvl:1, xp:0, next: xpToNext(1), progress:0 },
  { id:'Cooking',  basePerSec: 1 / 2.5, active:false, qty:0, lvl:1, xp:0, next: xpToNext(1), progress:0 },
  { id:'Woodcutting', basePerSec: RATE_BASE, active:false, qty:0, lvl:1, xp:0, next: xpToNext(1), progress:0 },
];
let combatProgression = COMBAT_PROGRESSION_FRAMEWORK.progression.createInitialCombatProgression();
let legacyCombatAudit = null;

// Generic Combat is no longer a trainable skill. Arena-facing gates retain a
// compatibility aggregate derived from the 17 split combat skills instead.
function combatLevelForUI() {
  return Math.max(1, COMBAT_PROGRESSION_FRAMEWORK.compatibility.genericLevel(combatProgression));
}

const UI_ICONS = {
  skill: {
    Mining:[0,0], Smithing:[50,0], Combat:[100,0], Crafting:[50,100], Music:[100,100],
    Fishing:[0,100], Cooking:[50,100], Woodcutting:[100,100]
  },
  resource: {
    Ore:[0,0], Bars:[33.333,0], Scrap:[66.667,0], 'Raw Fish':[100,0],
    'Cooked Fish':[0,33.333], 'Burnt Fish':[33.333,33.333], 'Pine Logs':[66.667,33.333], 'Oak Logs':[100,33.333],
    'Yew Logs':[0,66.667], 'Ancient Logs':[33.333,66.667], 'Basic Bait':[66.667,66.667], 'Uncommon Fish':[100,66.667],
    'Rare Gems':[0,100], Gold:[33.333,100], 'Smoked Rations':[33.333,100], 'Surgefin Rations':[66.667,100]
  },
  loadout: {
    melee:[0,0], ranged:[33.333,0], gun:[66.667,0], magic:[100,0],
    armor:[0,100], tool:[33.333,100], food:[66.667,100], empty:[100,100]
  }
};
function iconMarkup(sheet, key, extraClass = '') {
  const position = UI_ICONS[sheet]?.[key];
  if (!position) return '';
  return `<span class="game-icon icon-${sheet} ${extraClass}" style="--icon-x:${position[0]}%;--icon-y:${position[1]}%" aria-hidden="true"></span>`;
}
function iconRefMarkup(ref, extraClass = '') {
  if (!ref) return '<span class="asset-icon-fallback" aria-hidden="true">◆</span>';
  if (ref.kind === 'asset') return `<img class="asset-icon ${extraClass}" src="${ref.src}" alt="${ref.alt || ''}">`;
  return iconMarkup(ref.sheet, ref.key, extraClass) || `<span class="asset-icon-fallback" aria-hidden="true">◆</span>`;
}
function itemVisualMarkup(instance, cache, extraClass = '', options = {}) {
  const visual = instance ? LOOT_FRAMEWORK?.describeItemVisual?.(instance, cache, options) : null;
  if (!visual) return '';
  const badges = [
    visual.active && '<span class="item-visual-badge is-active">ACTIVE</span>',
    visual.equipped && '<span class="item-visual-badge is-equipped">E</span>',
    visual.favorite && '<span class="item-visual-badge is-favourite">★</span>',
    visual.isNew && '<span class="item-visual-badge is-new">NEW</span>'
  ].filter(Boolean).join('');
  return `<span class="item-visual rarity-${instance.rarity} glow-${visual.rarityGlow} ${extraClass}" style="--rarity-color:${visual.rarityColor}">${iconRefMarkup(visual.icon,'item-visual-icon')}<span class="item-level-badge">${visual.itemLevel}</span>${badges}</span>`;
}
function resourceIconMarkup(key, extraClass = 'resource-icon') {
  const customIcons = {
    'Boss Keys':'./assets/ui-icons/boss-key.png',
    Salvage:'./assets/ui-icons/salvage.png',
    'Crafted Components':'./assets/ui-icons/crafted-parts.png',
    'Crafted Parts':'./assets/ui-icons/crafted-parts.png'
  };
  return customIcons[key]
    ? `<img class="${extraClass} resource-image-icon" src="${customIcons[key]}" alt="">`
    : iconMarkup('resource', key, extraClass);
}
function resourceChipMarkup(label, value, iconKey = label) {
  const icon = resourceIconMarkup(iconKey) || '<span class="resource-fallback" aria-hidden="true">◆</span>';
  return `<div class="resource-chip">${icon}<span>${label}</span><strong>${value}</strong></div>`;
}

let unlockedNormalSlots = 6;
let hone = null;
let honingMult = 1.8;
let keys = 0;
let rareGems = 0;
let gold = 0;
let scrap = 0;
let basicBait = 0;
let uncommonFish = 0;
let fishingBuffSecs = 0;
let burntFish = 0;
let huntingXp = 0;
let trappedGame = 0;
const woodInventory = { pine:0, oak:0, yew:0, ancient:0 };
let selectedTree = 'pine';
let craftingSelectedRecipe = 'ironBlade';
let craftingActiveBonus = { multiplier:1, expiresAt:0 };
let craftingAssembly = null;
let skillToolInventory = [];
let salvageMaterials = 0;
let collectionProgress = {};
let latestLootReward = null;
const TREE_TYPES = [
  { id:'pine', name:'Pine', level:1, seconds:2.5, perSec:1 / 2.5 },
  { id:'oak', name:'Oak', level:30, seconds:4, perSec:1 / 4 },
  { id:'yew', name:'Yew', level:75, seconds:6, perSec:1 / 6 },
  { id:'ancient', name:'Ancient', level:90, seconds:8, perSec:1 / 8 }
];
const SMELT_ORE_COST = 1;
const SMELT_FAIL_CHANCE = 0.10;
const SCRAP_RECYCLE_COST = 5;
const OFFLINE_MAX_SECONDS = 8 * 60 * 60;
function offlineMaxSeconds() { return ownedBaseUps.has('offlineCache') ? 12 * 60 * 60 : OFFLINE_MAX_SECONDS; }
function scrapRecycleCost() { return ownedBaseUps.has('recyclerGrid') ? 4 : SCRAP_RECYCLE_COST; }
const OFFLINE_MIN_SECONDS = 30;
let globalBuff = { mult: 1.0, secs: 0 };
let warmup = { t: 0, targetA: 0, currentA: 0 };







let BULLET_DAMAGE = 10;
let baseMult = 1.0;     // multiplies all perSec



const ARENA_TIERS = [
  { id:1, name:'Initiate', requiredSoloStage:10, requirements:[{type:'soloStage',stage:10},{type:'resource',resource:'Boss Keys',value:3}], keyCost:3, bossHp:30, bossSpeed:40, contactDps:15, waveDamage:28, waveCooldown:4.0, projectileCount:0, projectileCooldown:0, projectileSpeed:0, projectileDamage:0, projectileSpread:0, attackLabel:'Shockwave', oreGain:600, gemChance:0.25 },
  { id:2, name:'Vanguard', requiredSoloStage:20, requirements:[{type:'soloStage',stage:20},{type:'resource',resource:'Boss Keys',value:5}], keyCost:5, bossHp:70, bossSpeed:55, contactDps:20, waveDamage:36, waveCooldown:3.4, projectileCount:1, projectileCooldown:2.8, projectileSpeed:180, projectileDamage:16, projectileSpread:0, attackLabel:'Aimed shot', oreGain:1000, gemChance:0.50 },
  { id:3, name:'Apex', requiredSoloStage:30, requirements:[{type:'soloStage',stage:30},{type:'resource',resource:'Boss Keys',value:8}], keyCost:8, bossHp:120, bossSpeed:70, contactDps:25, waveDamage:44, waveCooldown:2.8, projectileCount:3, projectileCooldown:2.2, projectileSpeed:220, projectileDamage:18, projectileSpread:0.18, attackLabel:'Spread volley', oreGain:1600, gemChance:1.00 }
];
let arenaTierUnlocked = 0;
let selectedArenaTier = 1;
let arenaWins = [0, 0, 0];

function getSkillToolDefinition(toolId) {
  return LOOT_FRAMEWORK?.getSkillToolDefinition(toolId) || null;
}

function skillToolsFor(skillId) {
  return skillToolInventory
    .map(instance => getSkillToolDefinition(instance.toolId))
    .filter(tool => tool && tool.skillId === skillId);
}

function selectedSkillTool(skillId) {
  const skill = skills.find(candidate => candidate.id === skillId);
  const available = skillToolsFor(skillId);
  if (!skill || !available.length) return null;
  const selected = available.find(tool => tool.id === skill.selectedToolId);
  if (selected) return selected;
  const fallback = [...available].sort((a, b) => b.tier - a.tier)[0];
  skill.selectedToolId = fallback.id;
  return fallback;
}

function hasSkillTool(skillId) {
  return Boolean(selectedSkillTool(skillId));
}

function ensureSkillState(skillId) {
  const existing = skills.find(skill => skill.id === skillId);
  if (existing) return existing;
  const definition = SKILL_REGISTRY?.get(skillId);
  const created = {
    id: skillId,
    basePerSec: definition?.baseActionsPerSecond || RATE_BASE,
    active: false,
    qty: 0,
    lvl: 1,
    xp: 0,
    next: xpToNext(1),
    progress: 0,
    selectedToolId: null
  };
  skills.push(created);
  return created;
}

function ensureMusicSkill() {
  return hasSkillTool('Music') ? ensureSkillState('Music') : skills.find(skill => skill.id === 'Music') || null;
}

function addSkillTool(toolId, acquiredAt = Date.now()) {
  const definition = getSkillToolDefinition(toolId);
  if (!definition || skillToolInventory.some(instance => instance.toolId === toolId)) return false;
  skillToolInventory.push({ instanceId: `skill-tool:${toolId}:${acquiredAt}`, toolId, acquiredAt });
  const skill = ensureSkillState(definition.skillId);
  if (!skill.selectedToolId) skill.selectedToolId = toolId;
  ensureMusicSkill();
  return true;
}

function removeSkillTool(instanceId) {
  const index = skillToolInventory.findIndex(instance => instance.instanceId === instanceId);
  if (index < 0) return false;
  const [removed] = skillToolInventory.splice(index, 1);
  const definition = getSkillToolDefinition(removed.toolId);
  const skill = skills.find(candidate => candidate.id === definition?.skillId);
  if (skill && !skillToolsFor(skill.id).some(tool => tool.id === skill.selectedToolId)) skill.selectedToolId = skillToolsFor(skill.id)[0]?.id || null;
  if (skill && !skillToolsFor(skill.id).length) skill.active = false;
  return true;
}



let lastFightResult = null;   // stores result after arena closes

/* =====================================
   DOM HOOKS
===================================== */
const skillsDiv = document.getElementById('skills');
const honeSelect = document.getElementById('honeSelect');
const effReadout = document.getElementById('effReadout');
const activeCountTag = document.getElementById('activeCountTag');
const totalsDiv = document.getElementById('totals');
const keysLabel = document.getElementById('keysLabel');
const fightBtn = document.getElementById('fightBtn');
const arenaPrepModal = document.getElementById('arenaPrepModal');
const arenaPrepTierSummary = document.getElementById('arenaPrepTierSummary');
const arenaStyleCards = document.getElementById('arenaStyleCards');
const arenaWeaponPreview = document.getElementById('arenaWeaponPreview');
const arenaPrepStatus = document.getElementById('arenaPrepStatus');
const confirmArenaRun = document.getElementById('confirmArenaRun');
const arenaTierSelect = document.getElementById('arenaTierSelect');
const arenaTierDetails = document.getElementById('arenaTierDetails');
const buffLabel = document.getElementById('buffLabel');
const statusEl = document.getElementById('status');
const objectiveTitle = document.getElementById('objectiveTitle');
const objectiveDetail = document.getElementById('objectiveDetail');
const objectiveProgressFill = document.getElementById('objectiveProgressFill');
const objectiveActionBtn = document.getElementById('objectiveActionBtn');
const adventureRunStatus = document.getElementById('adventureRunStatus');
const adventureProgress = document.getElementById('adventureProgress');
const adventureRoutes = document.getElementById('adventureRoutes');
const adventureEncounter = document.getElementById('adventureEncounter');
const adventureReward = document.getElementById('adventureReward');
const adventureLog = document.getElementById('adventureLog');
const operationsBoard = document.getElementById('operationsBoard');
const operationsToggle = document.getElementById('operationsToggle');
const operationsList = document.getElementById('operationsList');
const operationsCount = document.getElementById('operationsCount');
const saveStatus = document.getElementById('saveStatus');
const saveBtn = document.getElementById('saveBtn');
const resetSaveBtn = document.getElementById('resetSaveBtn');
const recycleScrapBtn = document.getElementById('recycleScrapBtn');
const recycleStatus = document.getElementById('recycleStatus');
const fishingModal = document.getElementById('fishingModal');
const fishingBaitSelect = document.getElementById('fishingBaitSelect');
const fishingBaitCount = document.getElementById('fishingBaitCount');
const fishingStatus = document.getElementById('fishingStatus');
const fishingPlayfield = document.getElementById('fishingPlayfield');
const fishingFish = document.getElementById('fishingFish');
const fishingCatchZone = document.getElementById('fishingCatchZone');
const fishingCatchFill = document.getElementById('fishingCatchFill');
const fishingTensionFill = document.getElementById('fishingTensionFill');
const fishingTime = document.getElementById('fishingTime');
const startFishingCastBtn = document.getElementById('startFishingCast');
const prepareBaitBtn = document.getElementById('prepareBaitBtn');
const closeFishingBtn = document.getElementById('closeFishing');
const craftingModal = document.getElementById('craftingModal');
const craftingActivityStatus = document.getElementById('craftingActivityStatus');
const craftingAssemblyBar = document.getElementById('craftingAssemblyBar');
const craftingAssemblyMarker = document.getElementById('craftingAssemblyMarker');
const craftingAssemblyTarget = document.getElementById('craftingAssemblyTarget');
const startCraftingAssemblyBtn = document.getElementById('startCraftingAssembly');
const hitCraftingAssemblyBtn = document.getElementById('hitCraftingAssembly');
const closeCraftingBtn = document.getElementById('closeCrafting');

const baseUpModal = document.getElementById('baseUpModal');
const skillUpModal = document.getElementById('skillUpModal');
const gearModal = document.getElementById('gearModal');
const gearList = document.getElementById('gearList');
const loadoutModal = document.getElementById('loadoutModal');
const loadoutBuildSummary = document.getElementById('loadoutBuildSummary');
const loadoutSlots = document.getElementById('loadoutSlots');
const inventoryList = document.getElementById('inventoryList');
const baseUpList  = document.getElementById('baseUpList');
const skillUpList = document.getElementById('skillUpList');
const talentModal = document.getElementById('talentModal');
const talentPointSummary = document.getElementById('talentPointSummary');
const talentBranches = document.getElementById('talentBranches');
const refundTalentsBtn = document.getElementById('refundTalentsBtn');
const activityLedgerEl = document.getElementById('activityLedger');
const frontierSummary = document.getElementById('frontierSummary');
const frontierModal = document.getElementById('frontierModal');
const masteryProgress = document.getElementById('masteryProgress');
const directiveList = document.getElementById('directiveList');
const presetList = document.getElementById('presetList');
const kitchenList = document.getElementById('kitchenList');
const startGauntletBtn = document.getElementById('startGauntletBtn');
const arenaDirectiveBanner = document.getElementById('arenaDirectiveBanner');
const specModal = document.getElementById('specModal');
const specList = document.getElementById('specList');
const muteAudio = document.getElementById('muteAudio');
const audioVolume = document.getElementById('audioVolume');
const reduceMotion = document.getElementById('reduceMotion');
const settingsModal = document.getElementById('settingsModal');

const resultModal = document.getElementById('resultModal');
const resultMsg   = document.getElementById('resultMsg');
const resultOk    = document.getElementById('resultOk');

const modal = document.getElementById('arenaModal');
const cv = document.getElementById('cv');
const hpYouEl = document.getElementById('hpYou');
const hpBossEl = document.getElementById('hpBoss');
const hpYouFill = document.getElementById('hpYouFill');
const hpBossFill = document.getElementById('hpBossFill');
const dashStatus = document.getElementById('dashStatus');
const arenaFoodStatus = document.getElementById('arenaFoodStatus');
const arenaTalentStatus = document.getElementById('arenaTalentStatus');
const arenaControls = document.getElementById('arenaControls');
const arenaTip = document.getElementById('arenaTip');
const closeArenaBtn = document.getElementById('closeArena');
const offlineModal = document.getElementById('offlineModal');
const offlineSummary = document.getElementById('offlineSummary');
const offlineOk = document.getElementById('offlineOk');

// Solo Frontier Battle Desk DOM surface. The Canvas renderer receives only
// snapshots; all controls remain ordinary DOM inputs for keyboard and touch.
const soloFrontierShell = document.getElementById('soloFrontierShell');
const soloBattleCanvas = document.getElementById('soloBattleCanvas');
const soloStageLabel = document.getElementById('soloStageLabel');
const soloEnemyLabel = document.getElementById('soloEnemyLabel');
const soloBattleStatus = document.getElementById('soloBattleStatus');
const soloBattleEvent = document.getElementById('soloBattleEvent');
const soloFrontierMode = document.getElementById('soloFrontierMode');
const soloOrderBadge = document.getElementById('soloOrderBadge');
const soloCurrentStage = document.getElementById('soloCurrentStage');
const soloClearedStage = document.getElementById('soloClearedStage');
const soloStageProgress = document.getElementById('soloStageProgress');
const soloFarmStageSelect = document.getElementById('soloFarmStageSelect');
const soloFallbackStageSelect = document.getElementById('soloFallbackStageSelect');
const soloWallDiagnosis = document.getElementById('soloWallDiagnosis');
const soloDropFocus = document.getElementById('soloDropFocus');
const soloActiveWeapon = document.getElementById('soloActiveWeapon');
const soloActiveWeaponStyle = document.getElementById('soloActiveWeaponStyle');
const soloStanceSelect = document.getElementById('soloStanceSelect');
const soloTechniqueSelect = document.getElementById('soloTechniqueSelect');
const soloDefensiveSelect = document.getElementById('soloDefensiveSelect');
const soloAuraSelect = document.getElementById('soloAuraSelect');
const soloCombatSkills = document.getElementById('soloCombatSkills');
const soloRecentXpSummary = document.getElementById('soloRecentXpSummary');
const soloCacheDetails = document.getElementById('soloCacheDetails');
const soloCacheCount = document.getElementById('soloCacheCount');
const soloCacheSummary = document.getElementById('soloCacheSummary');
const soloCacheRarityFilter = document.getElementById('soloCacheRarityFilter');
const soloCacheSlotFilter = document.getElementById('soloCacheSlotFilter');
const soloCacheSort = document.getElementById('soloCacheSort');
const soloCacheFavouritesOnly = document.getElementById('soloCacheFavouritesOnly');
const soloCachePageControls = document.getElementById('soloCachePageControls');
const soloCachePrevPage = document.getElementById('soloCachePrevPage');
const soloCacheNextPage = document.getElementById('soloCacheNextPage');
const soloCachePageLabel = document.getElementById('soloCachePageLabel');
const soloCacheList = document.getElementById('soloCacheList');
const soloCacheInspector = document.getElementById('soloCacheInspector');
const soloPaperDollDetails = document.getElementById('soloPaperDollDetails');
const soloPaperDoll = document.getElementById('soloPaperDoll');
const productionSkillMatrix = document.getElementById('productionSkillMatrix');
const combatSkillMatrix = document.getElementById('combatSkillMatrix');
const combatTreeModal = document.getElementById('combatTreeModal');
const combatTreeTitle = document.getElementById('combatTreeTitle');
const combatTreeSummary = document.getElementById('combatTreeSummary');
const combatTreeContent = document.getElementById('combatTreeContent');
const respecCombatTree = document.getElementById('respecCombatTree');
const frontierExchange = document.getElementById('frontierExchange');
const frontierExchangeSummary = document.getElementById('frontierExchangeSummary');
const soloDebriefPanel = document.getElementById('soloDebriefPanel');
const soloDebriefOutcome = document.getElementById('soloDebriefOutcome');
const soloDebriefSummary = document.getElementById('soloDebriefSummary');
const soloQaToolbar = document.getElementById('soloQaToolbar');
const soloQaSeedStage = document.getElementById('soloQaSeedStage');
const soloQaForceDefeat = document.getElementById('soloQaForceDefeat');
const soloQaFillCache = document.getElementById('soloQaFillCache');
const soloQaClearCache = document.getElementById('soloQaClearCache');
let selectedCombatTreeSkill = null;
let selectedExchangeCategory = 'gun';

// Attach confetti to our overlay canvas
const confettiCanvas = document.getElementById('confettiCanvas');

function sizeConfettiCanvas() {
  confettiCanvas.width  = window.innerWidth;   // drawing buffer
  confettiCanvas.height = window.innerHeight;
}
sizeConfettiCanvas();
window.addEventListener('resize', sizeConfettiCanvas);
const confettiOverlay = typeof window.confetti === 'function'
  ? window.confetti.create(confettiCanvas, { resize: true, useWorker: true })
  : null;


/* =====================================
   HELPERS
===================================== */

// Show a big level up notice at the top center of the screen
function showLevelNotice(text, opts = {}) {
  const { ms = 3200, delay = 0, kind = "" } = opts; // kind: 'mining' | 'smithing' | 'combat'
  const host = document.getElementById('levelHost');
  const el = document.createElement('div');
  el.className = 'levelNotice' + (kind ? ' ' + kind : '');
  el.textContent = text;

  // cap stack size to avoid flooding
  host.appendChild(el);
  const MAX_STACK = 4;
  while (host.children.length > MAX_STACK) host.firstChild.remove();

  // staggered entrance
  setTimeout(() => el.classList.add('show'), delay);

  // timed exit (includes entrance delay)
  setTimeout(() => {
    el.classList.remove('show');
    setTimeout(() => el.remove(), 260);
  }, delay + ms);
}







// Fire a nice confetti burst. Safe if the lib hasn't loaded.
// Confetti burst when leveling up
// Full-screen "rain/shower" from the top edge
// ===== Confetti helpers (customizable) =====
const CONFETTI = {
  rain: {
    durationMs: 5000,          // total time the shower runs
    streamsPerFrame: 1,        // lower = more gaps, higher = denser
    particlesPerStream: 4,     // lower = more gaps, higher = denser
    startVelocity: 18,
    spread: 120,
    gravity: 1.0,
    ticks: 220
  },
  fireworks: {
    bursts: 10,                 // number of explosions
    intervalMs: 120,           // time between bursts
    particlesPerBurst: 150,     // pieces per explosion
    startVelocity: 50,
    spread: 360,               // 360 = full firework circle
    gravity: 0.9,
    ticks: 300,
   
  }
};

// Full-screen rain from the top edge
function celebrateRain(opts = {}) {
  if (typeof confettiOverlay !== 'function') return;
  const c = { ...CONFETTI.rain, ...opts };

  const end = Date.now() + c.durationMs;
  (function frame() {
    for (let i = 0; i < c.streamsPerFrame; i++) {
      confettiOverlay({
        particleCount: c.particlesPerStream,
        startVelocity: c.startVelocity,
        spread: c.spread,
        ticks: c.ticks,
        gravity: c.gravity,
        origin: { x: Math.random(), y: 0 } // random top edge
      });
    }
    if (Date.now() < end) requestAnimationFrame(frame);
  })();
}

// Fireworks at random screen positions
function celebrateFireworks(opts = {}) {
  if (typeof confettiOverlay !== 'function') return;
  const c = { ...CONFETTI.fireworks, ...opts };

  for (let i = 0; i < c.bursts; i++) {
    setTimeout(() => {
      confettiOverlay({
        particleCount: c.particlesPerBurst,
        spread: c.spread,
        startVelocity: c.startVelocity,
        gravity: c.gravity,
        ticks: c.ticks,
        colors: c.colors,
        origin: {
          x: Math.random() * 0.8 + 0.1, // avoid extreme edges
          y: Math.random() * 0.5 + 0.15 // upper half
        }
      });
    }, i * c.intervalMs);
  }
}

// Default combo for level ups
function celebrateLevelUp() {
  if (document.body.classList.contains('reduce-motion') || window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return;
  celebrateRain({
    streamsPerFrame: 1,
    particlesPerStream: 2,
    durationMs: 650
  });
  celebrateFireworks({
    bursts: 3,
    particlesPerBurst: 65
  });
}










const activeToasts = new Map();
function dismissToast(text, el) {
  if (!el?.isConnected) return;
  clearTimeout(el._dismissTimer);
  el.classList.remove('show');
  activeToasts.delete(text);
  setTimeout(()=> el.remove(), 220);
}
function showToast(text, ms=2000) {
  const host = document.getElementById('toastHost');
  const existing = activeToasts.get(text);
  if (existing?.isConnected) {
    existing._count = (existing._count || 1) + 1;
    existing.textContent = `${text} ×${existing._count}`;
    clearTimeout(existing._dismissTimer);
    existing._dismissTimer = setTimeout(() => dismissToast(text, existing), ms);
    return;
  }
  const el = document.createElement('div');
  el.className = 'toast';
  el.textContent = text;
  el._count = 1;
  host.appendChild(el);
  activeToasts.set(text, el);
  while (host.children.length > 4) {
    const oldest = host.firstElementChild;
    const oldestKey = [...activeToasts.entries()].find(([,candidate]) => candidate === oldest)?.[0];
    if (oldestKey) dismissToast(oldestKey, oldest); else oldest.remove();
  }
  requestAnimationFrame(()=> el.classList.add('show'));
  el._dismissTimer = setTimeout(() => dismissToast(text, el), ms);
}

function clamp(v,a,b){ return Math.max(a, Math.min(b, v)); }






/* Efficiency curve m(a, T) */
// Exact mapping for T=3: a=1→1.25, a=2→0.75, a=3→0.50
// Smooth, T-aware curve: m(a,T) in [floor..ceil], with m(1)=ceil, m(T)=floor.
// Shape exponent p(T) is interpolated to match your T=3 (mid = 0.75)
// and T=5 (mid = 0.95) anchors, then generalized for any T.
// Smooth, T-aware curve: m(a,T) in [floor..ceil], with m(1)=ceil, m(T)=floor.
// Shape exponent p(T) is interpolated to match your T=3 (mid = 0.75)
// and T=5 (mid = 0.95) anchors, then generalized for any T.
// m(a) with T aware normalization
// linear efficiency from 1 track to T tracks
function mOfA(a) {
  if (a <= 0) return 0;
  const T = Math.max(1, unlockedNormalSlots|0);
  const A = Math.min(Math.max(1, a|0), T);
  if (T === 1) return BALANCE.maxEffAtOne;
  const slope = (BALANCE.minEffAtFull - BALANCE.maxEffAtOne) / (T - 1);
  return BALANCE.maxEffAtOne + slope * (A - 1);
}
function clampPerSec(x){ return Math.min(x, MAX_PER_SEC); }








// XP needed for next level. Tuned to feel quick early, steady mid, and not insane late.
function xpToNext(lvl) {
  // safety clamps
  if (lvl >= XP_BAL.cap) return Number.POSITIVE_INFINITY;

  // logistic ramp centered at pivot
  const s = 1 / (1 + Math.exp(-(lvl - XP_BAL.pivot) / XP_BAL.width));

  // base * gentle linear * late-game ramp
  const xp = XP_BAL.base
           * (1 + XP_BAL.lin * (lvl - 1))
           * (1 + XP_BAL.ramp * s);

  return Math.floor(xp);
}

const SKILL_MILESTONES = {
  Mining: [
    { level:5, label:'Reinforced Pick recipe' },
    { level:10, label:'Pick Quality II upgrade' },
    { level:15, label:'Mining specialization' }
  ],
  Smithing: [
    { level:5, label:'Iron Blade recipe' },
    { level:8, label:'Forge Gauntlet recipe' },
    { level:10, label:'Plated Vest recipe' },
    { level:15, label:'Smithing specialization' }
  ],
  Crafting: [
    { level:1, label:'Assembly target selection' },
    { level:4, label:'Forge Gauntlet recipe' },
    { level:6, label:'Plated Vest recipe' },
    { level:15, label:'Crafting specialization' }
  ],
  Music: [
    { level:5, label:'Drums instrument' },
    { level:12, label:'Piano instrument' },
    { level:20, label:'Harp instrument' }
  ],
  Fishing: [
    { level:5, label:'Basic Bait preparation' },
    { level:10, label:'Prime Bait mastery' },
    { level:15, label:'Fishing specialization' }
  ],
  Cooking: [
    { level:5, label:'Improved cooking reliability' },
    { level:15, label:'Cooking specializations' },
    { level:30, label:'Experienced cook' }
  ],
  Woodcutting: [
    { level:15, label:'Woodcutting specializations' },
    { level:30, label:'Oak trees' },
    { level:75, label:'Yew trees' },
    { level:90, label:'Ancient trees' }
  ]
};

const COMBAT_TALENT_LEVELS = [5, 10, 15, 20, 25, 30];
// The typed skill framework is the authoritative source. IDs remain the
// legacy Combat Discipline IDs consumed by arena.js and persisted saves.
const COMBAT_TALENTS = COMBAT_SKILL_TREE?.nodes || [];
const ownedCombatTalents = new Set();
let combatSkillTreeView = SKILL_TREE_RULES?.defaultView() || { zoom:1, panX:0, panY:0, focusNodeId:null, activeBranch:null };
let arenaRecords = {};
let activityLedger = [];
let worldRuntime = null;
let worldState = null;
let worldRenderSignature = '';
let worldActiveActivity = null;
let soloFrontierState = SOLO_FRONTIER_FRAMEWORK.createInitialSoloFrontierState();
let soloFrontierRuntime = null;
let soloFrontierLastDebrief = null;
let soloFrontierLastEarnedGold = 0;
let soloDeskRenderer = null;
let soloDeskSelectedItemId = null;
let soloDeskStance = 'Balanced';
let soloDeskTechnique = 'Burst Fire';
let soloDeskDefensiveAbility = 'Mend';
let soloDeskAura = 'Battle Focus';
let soloDeskRecentXp = {};
let soloDeskLastEvent = null;
let soloDeskLastOutcome = null;
let soloDeskOutcomeAt = 0;
let soloDeskDebriefSnapshot = null;
let soloDeskForceDefeat = false;
let soloDeskCacheRarity = 'common';
let soloDeskCacheSlot = 'all';
let soloDeskCacheSort = 'power';
let soloDeskCacheFavouritesOnly = false;
let soloDeskCachePage = 0;
if (soloBattleCanvas && SOLO_BATTLE_DESK_RENDERER) soloDeskRenderer = SOLO_BATTLE_DESK_RENDERER.create(soloBattleCanvas);

const SOLO_TECHNIQUE_BY_WEAPON_STYLE = Object.freeze({
  'light-melee':'Power Strike', 'medium-melee':'Power Strike', 'heavy-melee':'Power Strike',
  gun:'Burst Fire', ranged:'Piercing Shot', magic:'Arc Bolt'
});

function soloDeskCompatibleTechnique(style) {
  return SOLO_TECHNIQUE_BY_WEAPON_STYLE[style] || 'Power Strike';
}

function soloDeskUnequippedCount(cache) {
  return Number(LOOT_FRAMEWORK?.countUnequippedItems?.(cache) || 0);
}

function syncSoloDeskCombatControls(style) {
  const controls = SOLO_FRONTIER_FRAMEWORK.normalizeSoloCombatControls({
    stance: soloDeskStance,
    technique: soloDeskTechnique,
    defensive: soloDeskDefensiveAbility,
    aura: soloDeskAura
  }, style);
  soloDeskStance = controls.stance;
  soloDeskTechnique = controls.technique;
  soloDeskDefensiveAbility = controls.defensive;
  soloDeskAura = controls.aura;
  const compatibleTechnique = controls.technique;
  if (soloStanceSelect) soloStanceSelect.value = controls.stance;
  if (soloTechniqueSelect) {
    soloTechniqueSelect.querySelectorAll('option').forEach(option => {
      option.disabled = option.value !== compatibleTechnique;
    });
    soloTechniqueSelect.value = compatibleTechnique;
  }
  if (soloDefensiveSelect) soloDefensiveSelect.value = controls.defensive;
  if (soloAuraSelect) soloAuraSelect.value = controls.aura;
  return compatibleTechnique;
}

const FRONTIER_DIRECTIVES = [
  { id:'echoProtocol', tierId:1, name:'Echo Protocol', description:'Every shockwave is followed by a delayed echo.' },
  { id:'seismicPursuit', tierId:1, name:'Seismic Pursuit', description:'After each shockwave, the Initiate telegraphs a locked charge.' },
  { id:'crossfire', tierId:2, name:'Crossfire', description:'A second aimed shot enters from the opposite arena edge.' },
  { id:'ricochetProtocol', tierId:2, name:'Ricochet Protocol', description:'Aimed shots bounce once; their reflected path is telegraphed.' },
  { id:'encroachment', tierId:3, name:'Encroachment', description:'Apex danger zones expand while active.' },
  { id:'chainReaction', tierId:3, name:'Chain Reaction', description:'Expired danger zones release four cardinal projectiles.' }
];
const completedDirectives = new Set();
let selectedDirective = null;
let directiveRecords = {};
let combatPresets = [null, null];
let smokedRations = 0;
let surgefinRations = 0;
let activeGauntlet = null;
let gauntletRecord = { attempts:0, clears:0, bestTime:null };
const skillSpecializations = { Mining:null, Smithing:null, Fishing:null, Cooking:null, Woodcutting:null, Crafting:null };
const specializationProgress = { Mining:0, Fishing:0, Cooking:0, Woodcutting:0, Crafting:0, WoodUpgrade:0 };
let gameSettings = { muted:false, volume:0.6, reduceMotion:false };
let currentGameView = 'hub';
const claimedOperations = new Set();
let operationsRenderSignature = '';


const OPERATIONS = [
  { id:'powerOnline', name:'Power Online', detail:'Run two productive skills at once.', progress(){ return [Math.min(2, productiveSkills().length), 2]; }, reward:'25 Ore', claim(){ skills.find(skill=>skill.id==='Mining').qty += 25; } },
  { id:'foundation', name:'Foundation', detail:'Reach Mining 5 and Smithing 5.', progress(){ const mining=skills.find(skill=>skill.id==='Mining').lvl, smithing=skills.find(skill=>skill.id==='Smithing').lvl; return [Math.min(5,mining)+Math.min(5,smithing),10]; }, reward:'15 Bars', claim(){ skills.find(skill=>skill.id==='Smithing').qty += 15; } },
  { id:'fieldMeal', name:'Field Meal', detail:'Hold five Cooked Fish at once.', progress(){ return [Math.min(5,skills.find(skill=>skill.id==='Cooking').qty),5]; }, reward:'30 Pine Logs', claim(){ woodInventory.pine += 30; } },
  { id:'firstLoadout', name:'Armed and Ready', detail:'Craft your first equipment item.', progress(){ return [Math.min(1,ownedGear.size),1]; }, reward:'50 Ore', claim(){ skills.find(skill=>skill.id==='Mining').qty += 50; } },
  { id:'initiateClear', name:'Break the Gate', detail:'Defeat the Initiate.', progress(){ return [Math.min(1,arenaWins[0]),1]; }, reward:'30 Bars', claim(){ skills.find(skill=>skill.id==='Smithing').qty += 30; } },
  { id:'masteryStart', name:'Mastery Begins', detail:'Complete two Frontier Directives.', progress(){ return [Math.min(2,masteryStars()),2]; }, reward:'1 Rare Gem', claim(){ rareGems += 1; } },
  { id:'gauntletClear', name:'Unbroken Momentum', detail:'Clear the Frontier Gauntlet.', progress(){ return [Math.min(1,gauntletRecord.clears),1]; }, reward:'2 Rare Gems', claim(){ rareGems += 2; } }
];

function renderOperations(force = false) {
  const states = OPERATIONS.map(operation => {
    const [value,target] = operation.progress();
    return { operation, value, target, complete:value >= target, claimed:claimedOperations.has(operation.id) };
  });
  const visible = states.filter(state => !state.claimed).slice(0,3);
  const signature = JSON.stringify(visible.map(state => [state.operation.id,state.value,state.complete])) + claimedOperations.size;
  if (!force && signature === operationsRenderSignature) return;
  operationsRenderSignature = signature;
  operationsCount.textContent = `${claimedOperations.size}/${OPERATIONS.length} claimed`;
  operationsList.innerHTML = visible.length ? visible.map(state => {
    const percent = Math.min(100,state.value/state.target*100);
    return `<article class="operation${state.complete ? ' is-complete' : ''}"><div><strong>${state.operation.name}</strong><p>${state.operation.detail}</p><span class="operation-reward">Reward: ${state.operation.reward}</span></div><div class="operation-state"><span>${state.value}/${state.target}</span><div class="operation-meter" role="progressbar" aria-label="${state.operation.name} progress" aria-valuemin="0" aria-valuemax="${state.target}" aria-valuenow="${state.value}"><i style="width:${percent}%"></i></div><button class="btn" data-claim-operation="${state.operation.id}" ${state.complete ? '' : 'disabled'}>${state.complete ? `Claim ${state.operation.reward}` : 'In progress'}</button></div></article>`;
  }).join('') : '<div class="operations-complete"><strong>All current Operations complete.</strong><span>Push records, Mastery, and specializations while the next frontier is prepared.</span></div>';
  operationsList.querySelectorAll('[data-claim-operation]').forEach(button => button.onclick = () => {
    const operation = OPERATIONS.find(candidate => candidate.id === button.dataset.claimOperation);
    if (!operation || claimedOperations.has(operation.id)) return;
    const [value,target] = operation.progress(); if (value < target) return;
    operation.claim(); claimedOperations.add(operation.id);
    showToast(`Operation complete: ${operation.name} · ${operation.reward}`, 3200);
    logActivity(`Operation claimed: ${operation.name} · ${operation.reward}`, 'operation');
    renderOperations(true); saveGame();
  });
}

function masteryStars() { return completedDirectives.size; }
function frontierUnlocked() { return (Number(soloFrontierState?.highestClearedStage) || 0) >= 30 || arenaWins[2] > 0; }

function soloStageForArenaTier(tierId) {
  return ARENA_TIERS[tierId - 1]?.requiredSoloStage || tierId * 10;
}

function reconcileArenaTierUnlocks(legacyUnlock = 0) {
  const highestStage = Number(soloFrontierState?.highestClearedStage) || 0;
  const stageUnlock = SOLO_FRONTIER_FRAMEWORK?.arenaTierUnlockForSoloStage?.(highestStage)
    ?? (highestStage >= 30 ? 3 : highestStage >= 20 ? 2 : highestStage >= 10 ? 1 : 0);
  const legacyWinUnlock = arenaWins.reduce((highest, wins, index) => Number(wins) > 0 ? Math.max(highest, index + 1) : highest, 0);
  arenaTierUnlocked = Math.max(stageUnlock, legacyWinUnlock, Math.min(3, Math.max(0, Number(legacyUnlock) || 0)));
  selectedArenaTier = Math.min(Math.max(1, selectedArenaTier), Math.max(1, arenaTierUnlocked));
}

function frontierEntryCost(tierId) { return ARENA_TIERS[tierId - 1]?.keyCost || 0; }

function frontierKeyStatus(cost) {
  const available = Math.floor(keys);
  return available >= cost ? `${cost} Boss Keys ready` : `Need ${cost} Boss Keys · ${cost - available} more required`;
}

function earnedCombatTalentPoints() {
  const legacyEntitlement = COMBAT_TALENT_LEVELS.filter(level => combatLevelForUI() >= level).length;
  return Math.max(legacyEntitlement, soloFrontierState?.combatDiscipline?.earnedPoints || 0);
}

function availableCombatTalentPoints() {
  return earnedCombatTalentPoints() - ownedCombatTalents.size;
}

function evaluateRequirements(requirements = []) {
  const missing = [];
  for (const requirement of requirements) {
    if (requirement.type === 'soloStage') {
      const highestStage = Number(soloFrontierState?.highestClearedStage) || 0;
      if (highestStage < requirement.stage && !arenaWins[ Math.max(0, Math.floor(requirement.stage / 10) - 1) ]) missing.push(`Solo Stage ${String(requirement.stage).padStart(2, '0')}`);
    }
    if (requirement.type === 'skillLevel') {
      const level = requirement.skill === 'Combat' ? combatLevelForUI() : skills.find(skill => skill.id === requirement.skill)?.lvl || 0;
      if (level < requirement.value) missing.push(`${requirement.skill} ${requirement.value}`);
    }
    if (requirement.type === 'resource') {
      const amount = requirement.resource === 'Ore' ? skills.find(skill => skill.id === 'Mining').qty
        : requirement.resource === 'Bars' ? skills.find(skill => skill.id === 'Smithing').qty
        : requirement.resource === 'Pine Logs' ? woodInventory.pine
        : requirement.resource === 'Crafted Components' ? skills.find(skill => skill.id === 'Crafting').qty
        : requirement.resource === 'Boss Keys' ? Math.floor(keys)
        : requirement.resource === 'Rare Gems' ? rareGems
        : requirement.resource === 'Raw Fish' ? skills.find(skill => skill.id === 'Fishing').qty
        : requirement.resource === 'Cooked Fish' ? skills.find(skill => skill.id === 'Cooking').qty
        : requirement.resource === 'Uncommon Fish' ? uncommonFish
        : requirement.resource === 'Scrap' ? scrap : 0;
      if (amount < requirement.value) missing.push(`${requirement.value} ${requirement.resource}`);
    }
    if (requirement.type === 'arenaTier' && arenaTierUnlocked < requirement.value) {
      missing.push(`Defeat ${ARENA_TIERS[requirement.value - 2]?.name || 'previous Arena tier'}`);
    }
  }
  return { met: missing.length === 0, missing };
}

function worldResourceAmount(resourceId) {
  return resourceId === 'Ore' ? skills.find(skill => skill.id === 'Mining')?.qty || 0
    : resourceId === 'Bars' ? skills.find(skill => skill.id === 'Smithing')?.qty || 0
    : resourceId === 'Pine Logs' ? woodInventory.pine
    : resourceId === 'Crafted Components' ? skills.find(skill => skill.id === 'Crafting')?.qty || 0
    : resourceId === 'Boss Keys' ? Math.floor(keys)
    : resourceId === 'Rare Gems' ? rareGems
    : resourceId === 'Raw Fish' ? skills.find(skill => skill.id === 'Fishing')?.qty || 0
    : resourceId === 'Cooked Fish' ? skills.find(skill => skill.id === 'Cooking')?.qty || 0
    : resourceId === 'Uncommon Fish' ? uncommonFish
    : resourceId === 'Scrap' ? scrap
    : 0;
}

function evaluateWorldRequirements(requirements = [], state = worldState) {
  const missing = [];
  for (const requirement of requirements) {
    if (requirement.type === 'soloStage') {
      const highestStage = Number(soloFrontierState?.highestClearedStage) || 0;
      const legacyTier = Math.max(0, Math.ceil(Number(requirement.stage || 0) / 10) - 1);
      const legacyClear = legacyTier > 0 && (arenaWins[legacyTier - 1] || 0) > 0;
      if (highestStage < requirement.stage && !legacyClear) missing.push(`Solo Stage ${String(requirement.stage).padStart(2, '0')}`);
    }
    if (requirement.type === 'skillLevel') {
      const level = skills.find(skill => skill.id === requirement.skillId)?.lvl || 0;
      if (level < requirement.level) missing.push(`${requirement.skillId} ${requirement.level}`);
    }
    if (requirement.type === 'resource') {
      const amount = worldResourceAmount(requirement.resourceId);
      if (amount < requirement.amount) missing.push(`${requirement.amount} ${requirement.resourceId}`);
    }
    if (requirement.type === 'equipment') {
      const cache = canonicalLootCache();
      const equipped = requirement.slot === 'combat'
        ? ['gun', 'melee', 'ranged', 'magic'].some(slot => Boolean(cache.equipment[slot]))
        : requirement.slot === 'tool'
          ? Boolean(equipment.tool)
          : Boolean(cache.equipment[requirement.slot === 'armor' ? 'chest' : requirement.slot]);
      if (!equipped) missing.push(`equip ${requirement.slot}`);
    }
    if (requirement.type === 'arenaTier' && arenaTierUnlocked < requirement.tierId) missing.push(`Clear Solo Stage ${soloStageForArenaTier(requirement.tierId)}`);
    if (requirement.type === 'completedNode' && !state?.completedNodeIds?.includes(requirement.nodeId)) {
      missing.push(`complete ${requirement.nodeId}`);
    }
  }
  return { met: missing.length === 0, missing };
}

function ensureWorldRuntime(savedState = null, saveVersion = SAVE_VERSION) {
  if (!WORLD_FRAMEWORK || !WORLD_REGION) return null;
  const initial = WORLD_FRAMEWORK.migrateWorldState(WORLD_REGION, saveVersion, savedState);
  worldRuntime = WORLD_FRAMEWORK.createWorldRuntime(WORLD_REGION, initial, {
    evaluateRequirements: (requirements, state) => evaluateWorldRequirements(requirements, state),
    createRunId: () => `frontier-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
  });
  worldState = worldRuntime.getState();
  return worldRuntime;
}

function worldNode() {
  return WORLD_REGION?.nodes.find(node => node.id === worldState?.currentNodeId) || null;
}

function worldEncounter() {
  return WORLD_REGION?.encounters.find(encounter => encounter.id === worldState?.activeEncounterId) || null;
}

function worldRouteIcon(routeId) {
  const iconKey = routeId === 'timberline' ? 'Woodcutting' : routeId === 'ironworks' ? 'Smithing' : 'Combat';
  return iconMarkup('skill', iconKey, 'adventure-route-icon') || '<span class="adventure-route-icon-fallback" aria-hidden="true">◆</span>';
}

function worldText(value) {
  return String(value).replace(/[&<>"']/g, character => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[character]));
}

function worldRequirementText(requirements = []) {
  return requirements.map(requirement => {
    if (requirement.type === 'soloStage') return `Solo Stage ${String(requirement.stage).padStart(2, '0')}`;
    if (requirement.type === 'skillLevel') return `${requirement.skillId} ${requirement.level}`;
    if (requirement.type === 'resource') return `${requirement.amount} ${requirement.resourceId}`;
    if (requirement.type === 'equipment') return `Combat loadout`;
    if (requirement.type === 'arenaTier') return `Solo Stage ${String(soloStageForArenaTier(requirement.tierId)).padStart(2, '0')} cleared`;
    return `Previous node`;
  }).join(' · ');
}

function worldRewardText(reward = {}) {
  const items = [];
  Object.entries(reward.resources || {}).forEach(([resource, amount]) => items.push(`+${amount} ${resource}`));
  Object.entries(reward.skillXp || {}).forEach(([skill, amount]) => items.push(`+${amount} ${skill} XP`));
  if (reward.mastery) items.push(`+${reward.mastery} Mastery`);
  return items.length ? items.join(' · ') : 'A route record and new position';
}

function worldPayRequirements(encounter) {
  const requirements = encounter?.requirements || [];
  if (!evaluateWorldRequirements(requirements, worldState).met) return false;
  requirements.forEach(requirement => {
    if (requirement.type !== 'resource') return;
    const amount = requirement.amount;
    if (requirement.resourceId === 'Ore') skills.find(skill => skill.id === 'Mining').qty -= amount;
    if (requirement.resourceId === 'Bars') skills.find(skill => skill.id === 'Smithing').qty -= amount;
    if (requirement.resourceId === 'Pine Logs') { woodInventory.pine -= amount; skills.find(skill => skill.id === 'Woodcutting').qty = Math.max(0, skills.find(skill => skill.id === 'Woodcutting').qty - amount); }
    if (requirement.resourceId === 'Crafted Components') skills.find(skill => skill.id === 'Crafting').qty -= amount;
    if (requirement.resourceId === 'Boss Keys') keys -= amount;
    if (requirement.resourceId === 'Rare Gems') rareGems -= amount;
    if (requirement.resourceId === 'Raw Fish') skills.find(skill => skill.id === 'Fishing').qty -= amount;
    if (requirement.resourceId === 'Cooked Fish') skills.find(skill => skill.id === 'Cooking').qty -= amount;
    if (requirement.resourceId === 'Uncommon Fish') uncommonFish -= amount;
    if (requirement.resourceId === 'Scrap') scrap -= amount;
  });
  return true;
}

function worldApplyReward(reward = {}) {
  Object.entries(reward.resources || {}).forEach(([resource, amount]) => {
    if (resource === 'Ore') skills.find(skill => skill.id === 'Mining').qty += amount;
    if (resource === 'Bars') skills.find(skill => skill.id === 'Smithing').qty += amount;
    if (resource === 'Pine Logs') { woodInventory.pine += amount; skills.find(skill => skill.id === 'Woodcutting').qty += amount; }
    if (resource === 'Crafted Components') skills.find(skill => skill.id === 'Crafting').qty += amount;
    if (resource === 'Boss Keys') keys += amount;
    if (resource === 'Rare Gems') rareGems += amount;
    if (resource === 'Raw Fish') skills.find(skill => skill.id === 'Fishing').qty += amount;
    if (resource === 'Cooked Fish') skills.find(skill => skill.id === 'Cooking').qty += amount;
    if (resource === 'Uncommon Fish') uncommonFish += amount;
    if (resource === 'Scrap') scrap += amount;
  });
  Object.entries(reward.skillXp || {}).forEach(([skillId, amount]) => {
    if (COMBAT_PROGRESSION_FRAMEWORK?.skillIds?.includes(skillId)
      && COMBAT_PROGRESSION_FRAMEWORK.progression?.applyCombatSkillXp) {
      combatProgression = {
        ...combatProgression,
        [skillId]: COMBAT_PROGRESSION_FRAMEWORK.progression.applyCombatSkillXp(
          combatProgression[skillId],
          amount
        )
      };
      soloDeskRecentXp = { ...soloDeskRecentXp, [skillId]: Number(amount) || 0 };
      return;
    }
    const skill = skills.find(candidate => candidate.id === skillId);
    if (!skill) return;
    skill.xp += amount;
    tryLevelUp(skill);
  });
  if (soloFrontierRuntime) {
    soloFrontierRuntime.hydrate({ ...soloFrontierRuntime.getState(), combatProgression });
    syncSoloFrontierProjection();
  }
  if (reward.lootSource && LOOT_FRAMEWORK) {
    const loot = LOOT_FRAMEWORK.rollLoot({
      sourceType: reward.lootSource.sourceType,
      sourceId: reward.lootSource.sourceId,
      sourceTier: reward.lootSource.sourceTier,
      playerLevel: combatLevelForUI(),
      runId: worldState?.runId || `frontier-loot-${Date.now()}`
    }, Math.random);
    const item = awardLootResolution(loot);
    if (item) logActivity(`Frontier loot: ${lootLabel(item)}`, 'loot');
  }
}

function worldCommitLog(message, kind = 'adventure') {
  logActivity(message, kind);
  worldState = worldRuntime?.getState() || worldState;
  renderWorld(true);
  saveGame();
}

function worldCancelEncounter() {
  if (!worldRuntime || worldState?.status !== 'in_encounter') return;
  worldRuntime.cancelEncounter();
  worldActiveActivity = null;
  worldState = worldRuntime.getState();
  renderWorld(true);
  saveGame();
}

function resolveWorldEncounter(success, payInputs = false) {
  if (!worldRuntime || !worldState?.runId || !worldState.activeEncounterId) return false;
  const encounter = worldEncounter();
  if (!encounter) return false;
  if (payInputs && !worldPayRequirements(encounter)) {
    showToast(`Requires ${worldRequirementText(encounter.requirements)}`, 3600);
    return false;
  }
  const result = worldRuntime.resolveEncounter({ runId:worldState.runId, encounterId:encounter.id, success });
  if (!result.accepted) { showToast(result.reason || 'The frontier encounter could not be resolved.', 3600); return false; }
  worldActiveActivity = null;
  worldState = result.state;
  renderWorld(true);
  saveGame();
  return true;
}

function claimWorldReward() {
  if (!worldRuntime || !worldState?.pendingReward) return;
  const pending = worldState.pendingReward;
  const result = worldRuntime.claimReward(pending.id);
  if (!result.accepted) { showToast(result.reason || 'Frontier reward unavailable.', 3600); return; }
  worldApplyReward(pending.reward);
  worldState = result.state;
  logActivity(`Frontier reward claimed: ${worldRewardText(pending.reward)}`, 'adventure');
  showToast(`Frontier reward claimed · ${worldRewardText(pending.reward)}`, 4200);
  renderWorld(true);
  saveGame();
}

function beginWorldEncounter() {
  if (!worldRuntime) return;
  const result = worldRuntime.beginEncounter();
  if (!result.accepted) { showToast(result.reason || 'The route is not ready.', 3600); return; }
  worldState = result.state;
  const encounter = result.encounter;
  if (encounter?.arenaTierId) {
    worldActiveActivity = { kind:'arena', encounterId:encounter.id, runId:worldState.runId };
    selectedArenaTier = encounter.arenaTierId;
    openArenaPreparation();
  } else {
    renderWorld(true);
    saveGame();
  }
}

function startWorldActiveActivity() {
  const encounter = worldEncounter();
  if (!encounter?.activeActivity || !worldState?.runId) return;
  worldActiveActivity = { kind:encounter.activeActivity, encounterId:encounter.id, runId:worldState.runId };
  if (encounter.activeActivity === 'fishing') openFishing(worldActiveActivity);
  if (encounter.activeActivity === 'crafting') openCraftingAssembly(worldActiveActivity);
}

function renderWorld(force = false) {
  if (!adventureRoutes || !WORLD_REGION) return;
  if (!worldRuntime) ensureWorldRuntime();
  if (!worldRuntime) return;
  worldState = worldRuntime.getState();
  const node = worldNode();
  const encounter = worldEncounter();
  const route = WORLD_REGION.routes.find(candidate => candidate.id === worldState.selectedRouteId);
  const signature = JSON.stringify([
    worldState.status,
    worldState.currentNodeId,
    worldState.selectedRouteId,
    worldState.activeEncounterId,
    worldState.pendingReward?.id || null,
    worldState.completedEncounterIds,
    worldState.mastery,
    ...skills.filter(skill => ['Woodcutting', 'Smithing', 'Crafting'].includes(skill.id)).map(skill => `${skill.id}:${skill.lvl}:${Math.floor(skill.qty)}`),
    Math.floor(keys),
    rareGems,
    uncommonFish,
    Math.floor(woodInventory.pine)
  ]);
  if (!force && signature === worldRenderSignature) return;
  worldRenderSignature = signature;
  const statusLabels = { outpost:'Outpost', ready:'Route ready', in_encounter:'Encounter active', reward:'Reward waiting', complete:'Region secured', failed:'Run ended' };
  adventureRunStatus.textContent = statusLabels[worldState.status] || 'Outpost';
    const masteryComplete = Object.values(worldState.mastery || {}).filter(value => value > 0).length;
    const routeMasteryIds = ['route-timberline', 'route-ironworks', 'route-watch'];
    const routeRecords = routeMasteryIds.filter(id => (worldState.mastery?.[id] || 0) > 0).length;
    adventureProgress.innerHTML = `<span>${routeRecords}/${WORLD_REGION.routes.length} route records</span><span class="adventure-progress-track"><i style="width:${masteryComplete / WORLD_REGION.mastery.length * 100}%"></i></span><span>${worldText(node?.name || WORLD_REGION.name)}</span>`;
  adventureRoutes.innerHTML = WORLD_REGION.routes.map(candidate => {
    const selected = candidate.id === worldState.selectedRouteId;
    const completed = worldState.mastery[`route-${candidate.id === 'broken-watch' ? 'watch' : candidate.id}`] > 0;
    const disabled = !['outpost', 'ready', 'complete', 'failed'].includes(worldState.status) || worldState.currentNodeId !== WORLD_REGION.outpostNodeId;
    return `<button type="button" class="adventure-route${selected ? ' is-selected' : ''}${completed ? ' is-complete' : ''}" data-world-route="${candidate.id}" ${disabled ? 'disabled' : ''} style="--route-accent:${candidate.accent}"><span class="adventure-route-icon-wrap">${worldRouteIcon(candidate.id)}</span><span class="adventure-route-copy"><strong>${worldText(candidate.name)}</strong><small>${worldText(candidate.summary)}</small></span><span class="adventure-route-mark" aria-hidden="true">${completed ? '★' : selected ? '◆' : '›'}</span></button>`;
  }).join('');
  adventureRoutes.querySelectorAll('[data-world-route]').forEach(button => button.onclick = () => {
    if (worldState.status === 'complete' || worldState.status === 'failed' || worldState.status === 'outpost') worldRuntime.startRun();
    const result = worldRuntime.selectRoute(button.dataset.worldRoute);
    if (!result.accepted) { showToast(result.reason || 'Route unavailable.', 3600); return; }
    worldState = result.state;
    logActivity(`Route selected: ${result.encounter?.name || button.dataset.worldRoute}`, 'adventure');
    renderWorld(true); saveGame();
  });
  const currentNodeEncounter = node?.encounterId ? WORLD_REGION.encounters.find(candidate => candidate.id === node.encounterId) : null;
  const selectedEncounter = worldState.currentNodeId !== WORLD_REGION.outpostNodeId
    ? currentNodeEncounter
    : route ? WORLD_REGION.encounters.find(candidate => candidate.id === route.encounterId) : encounter;
  let encounterMarkup = '';
  if (worldState.status === 'outpost') encounterMarkup = `<div class="adventure-empty"><strong>Start the line.</strong><span>Train in the background, then choose the route that matches your stockpile.</span><button class="btn btn-primary" data-world-start>Start frontier run</button></div>`;
  else if (worldState.status === 'complete') encounterMarkup = `<div class="adventure-empty is-complete"><strong>Region secured.</strong><span>Run another route to build mastery and discover the alternate rewards.</span><button class="btn" data-world-start>Run the line again</button></div>`;
  else if (worldState.status === 'failed') encounterMarkup = `<div class="adventure-empty is-failed"><strong>Back at the outpost.</strong><span>Your personal progression is intact. Rebuild the route and try again.</span><button class="btn" data-world-start>Restart frontier run</button></div>`;
  else if (worldState.status === 'reward' && worldState.pendingReward) encounterMarkup = `<div class="adventure-encounter is-reward"><div class="eyebrow">REWARD CACHE</div><strong>Route secured</strong><p>${worldText(worldRewardText(worldState.pendingReward.reward))}</p><button class="btn btn-primary" data-world-claim>Claim frontier reward</button></div>`;
  else if (worldState.status === 'in_encounter' && encounter) {
    const active = encounter.activeActivity ? `<button class="btn" data-world-activity>Play ${encounter.activeActivity === 'crafting' ? 'Assembly' : 'Fishing'} activity</button>` : '';
    const resolve = encounter.kind === 'boss' ? '' : `<button class="btn btn-primary" data-world-resolve>Resolve with supplies</button>`;
    encounterMarkup = `<div class="adventure-encounter"><div class="eyebrow">${worldText(encounter.kind.toUpperCase())}</div><strong>${worldText(encounter.name)}</strong><p>${worldText(encounter.summary)}</p><div class="small adventure-requirement">${worldText(worldRequirementText(encounter.requirements))}</div><div class="adventure-actions">${active}${resolve}<button class="btn btn-quiet" data-world-cancel>Cancel encounter</button></div></div>`;
  } else if (worldState.currentNodeId === WORLD_REGION.outpostNodeId && !route) encounterMarkup = `<div class="adventure-empty"><strong>Choose a route.</strong><span>Each route is a different preparation test before Vanguard.</span></div>`;
  else if (selectedEncounter) encounterMarkup = `<div class="adventure-encounter"><div class="eyebrow">NEXT ENCOUNTER</div><strong>${worldText(selectedEncounter.name)}</strong><p>${worldText(selectedEncounter.summary)}</p><div class="small adventure-requirement">${worldText(worldRequirementText(selectedEncounter.requirements))}</div><button class="btn btn-primary" data-world-begin>Begin encounter</button></div>`;
  adventureEncounter.innerHTML = encounterMarkup;
  adventureEncounter.querySelector('[data-world-start]')?.addEventListener('click', () => { const result = worldRuntime.startRun(); if (result.accepted) { worldState = result.state; logActivity('Frontier run started', 'adventure'); renderWorld(true); saveGame(); } });
  adventureEncounter.querySelector('[data-world-begin]')?.addEventListener('click', beginWorldEncounter);
  adventureEncounter.querySelector('[data-world-resolve]')?.addEventListener('click', () => resolveWorldEncounter(true, true));
  adventureEncounter.querySelector('[data-world-activity]')?.addEventListener('click', startWorldActiveActivity);
  adventureEncounter.querySelector('[data-world-claim]')?.addEventListener('click', claimWorldReward);
  adventureEncounter.querySelector('[data-world-cancel]')?.addEventListener('click', worldCancelEncounter);
  adventureReward.textContent = worldState.pendingReward
    ? `Cache ready · ${worldRewardText(worldState.pendingReward.reward)}`
    : node?.description || 'No pending reward';
  adventureLog.textContent = node?.name || WORLD_REGION.name;
}

window.MomentumAdventure = Object.freeze({
  getState() { return worldRuntime?.getState() || null; },
  open() {
    setGameView('adventure');
    renderWorld(true);
  }
});

function logActivity(message, kind = 'system') {
  activityLedger.unshift({ message, kind, timestamp:Date.now() });
  activityLedger = activityLedger.slice(0, 20);
  renderActivityLedger();
}

function renderActivityLedger() {
  if (!activityLedgerEl) return;
  activityLedgerEl.innerHTML = activityLedger.length
    ? activityLedger.map(entry => `<div class="ledger-entry ledger-${entry.kind}"><span>${entry.message}</span><time>${new Date(entry.timestamp).toLocaleTimeString([], { hour:'2-digit', minute:'2-digit' })}</time></div>`).join('')
    : '<div class="small">Meaningful events will appear here.</div>';
}

function nextSkillMilestone(skill) {
  return SKILL_MILESTONES[skill.id]?.find(milestone => milestone.level > skill.lvl) || null;
}

function milestoneAtLevel(skillId, level) {
  return SKILL_MILESTONES[skillId]?.find(milestone => milestone.level === level) || null;
}

function addXpSilently(skill, amount) {
  skill.xp += amount;
  while (skill.lvl < MAX_SKILL_LEVEL && skill.xp >= skill.next) {
    skill.xp -= skill.next;
    skill.lvl += 1;
    skill.next = xpToNext(skill.lvl);
  }
  if (skill.lvl >= MAX_SKILL_LEVEL) {
    skill.lvl = MAX_SKILL_LEVEL;
    skill.xp = skill.next;
  }
}

window.MomentumGameRewards = Object.freeze({
  claimPartyReward(reward) {
    if (!reward || typeof reward !== 'object') return false;
    const activityToSkill = { pine_chopping:'Woodcutting', pine_cutting:'Woodcutting', camp_cooking:'Cooking' };
    const addPartyXp = (activityId, amount) => {
      const xp = Math.max(0, Number(amount) || 0);
      if (!xp) return;
      const skillId = activityToSkill[activityId];
      if (skillId) {
        const skill = skills.find(candidate => candidate.id === skillId);
        if (skill) { skill.xp += xp; tryLevelUp(skill); }
      } else if (activityId === 'rest') {
        huntingXp += xp;
      }
    };
    Object.entries(reward.partyXp || {}).forEach(([activityId, xp]) => addPartyXp(activityId, xp));
    addPartyXp(reward.primaryActivity, reward.primaryXp);
    const itemRewards = reward.rewards || {};
    const bossKeys = Math.max(0, Number(itemRewards.bossKeys) || 0);
    const pineLogs = Math.max(0, Number(itemRewards.pineLogs) || 0);
    const cookedFish = Math.max(0, Number(itemRewards.cookedFish) || 0);
    const game = Math.max(0, Number(itemRewards.game) || 0);
    keys += bossKeys;
    woodInventory.pine += pineLogs;
    const woodcutting = skills.find(skill => skill.id === 'Woodcutting') || skills.find(skill => skill.id === 'Woodchopping');
    if (woodcutting) woodcutting.qty += pineLogs;
    skills.find(skill => skill.id === 'Cooking').qty += cookedFish;
    trappedGame += game;
    const summary = [
      bossKeys && `+${bossKeys} Boss Keys`, pineLogs && `+${pineLogs} Pine Logs`,
      cookedFish && `+${cookedFish} Cooked Fish`, game && `+${game} Game`
    ].filter(Boolean).join(' · ');
    const applyExpeditionResource = (resource, amount) => {
      const value = Math.max(0, Number(amount) || 0);
      if (!value) return;
      if (resource === 'Gold') gold += value;
      if (resource === 'Boss Keys') keys += value;
      if (resource === 'Scrap') scrap += value;
      if (resource === 'Raw Fish') skills.find(skill => skill.id === 'Fishing').qty += value;
      if (resource === 'Cooked Fish') skills.find(skill => skill.id === 'Cooking').qty += value;
      if (resource === 'Pine Logs') { woodInventory.pine += value; if (woodcutting) woodcutting.qty += value; }
    };
    const modernLedger = reward.expeditionLedger;
    if (modernLedger) {
      Object.entries(modernLedger.farmingRewards || {}).forEach(([resource, amount]) => applyExpeditionResource(resource, amount));
      Object.entries(modernLedger.completionRewards || {}).forEach(([resource, amount]) => applyExpeditionResource(resource, amount));
      if (modernLedger.outcome === 'failed') showToast('Combat completion failed · farming rewards preserved', 4200);
    }
    const modernSummary = modernLedger ? [...Object.entries(modernLedger.farmingRewards || {}), ...Object.entries(modernLedger.completionRewards || {})].filter(([, amount]) => Number(amount) > 0).map(([resource, amount]) => `+${amount} ${resource}`).join(' · ') : '';
    showToast(`Party reward claimed${summary || modernSummary ? ` · ${[summary, modernSummary].filter(Boolean).join(' · ')}` : ''}`, 4200);
    logActivity(`Party reward claimed: ${summary || modernSummary || 'activity experience'}`, 'party');
    saveGame();
    return true;
  }
});


// Handles level ups and clamps to MAX_SKILL_LEVEL
function tryLevelUp(s) {
  while (s.lvl < MAX_SKILL_LEVEL && s.xp >= s.next) {
    s.xp  -= s.next;
    s.lvl += 1;
    s.next = xpToNext(s.lvl);
    const milestone = milestoneAtLevel(s.id, s.lvl);
    const levelMessage = milestone ? `${s.id} ${s.lvl}: ${milestone.label} unlocked` : `${s.id} reached level ${s.lvl}`;
    showToast(levelMessage, milestone ? 3200 : 2000);
    logActivity(levelMessage, 'level');
    celebrateLevelUp(); // 🎉 rain + fireworks
    
    // Stagger based on current stack so multiple level-ups cascade nicely
const currentStack = (document.getElementById('levelHost')?.children.length) || 0;
showLevelNotice(`${s.id} level ${s.lvl}`, {
  kind: s.id.toLowerCase(),                 // mining | smithing | combat
  delay: currentStack * 120,                // small cascade
  ms: 3200                                  // stays up a tad longer
});

  }

  // If capped, keep bar visually full
  if (s.lvl >= MAX_SKILL_LEVEL) {
    s.lvl = MAX_SKILL_LEVEL;
    s.xp  = s.next;
  }
}





/* =====================================
   DATA TABLES
===================================== */
const BASE_UPS = [
  { id:'workshop', name:'Workshop Efficiency I', desc:'+10% all idle rates', cost:{ ore:150 }, apply(){ baseMult *= 1.10; } },
  { id:'workshop2', name:'Workshop Efficiency II', desc:'+15% all idle rates', requirements:[{type:'skillLevel',skill:'Smithing',value:20}], cost:{ ore:300, bars:100 }, apply(){ baseMult *= 1.15; } },
  { id:'honingArray', name:'Honing Array', desc:'Increase Honing from 1.8x to 2.0x', cost:{ ore:220, bars:80 }, apply(){ honingMult = Math.max(honingMult, 2); } },
  { id:'recyclerGrid', name:'Recycler Grid', desc:'Recycle 4 Scrap into Ore instead of 5', cost:{ ore:200, bars:60 }, apply(){} },
  { id:'offlineCache', name:'Expanded Offline Cache', desc:'Increase the offline progress cap from 8h to 12h', cost:{ ore:250, bars:100 }, apply(){} }
];
const ownedBaseUps = new Set();

const SKILL_UPS = {
  Mining: [
    { id:'pick1', name:'Pick Quality I', desc:'+10 percent speed', cost:{ ore:120 }, apply(){ const s=skills.find(x=>x.id==='Mining'); s.basePerSec = clampPerSec(s.basePerSec * 1.10); } },
    { id:'pick2', name:'Pick Quality II', desc:'+12 percent speed', requirements:[{type:'skillLevel',skill:'Mining',value:10}], cost:{ ore:240 }, apply(){ const s=skills.find(x=>x.id==='Mining'); s.basePerSec = clampPerSec(s.basePerSec * 1.12); } },
  ],
  Smithing: [
   { id:'forge1', name:'Forge Bellows', desc:'+8 percent speed', cost:{ bars:90 }, apply(){ const s=skills.find(x=>x.id==='Smithing'); s.basePerSec = clampPerSec(s.basePerSec * 1.08); } },
  ],
  Crafting: [
    { id:'assemblyJig', name:'Assembly Jig', desc:'Crafting actions run 10% faster.', cost:{ bars:90 }, apply(){ const s=skills.find(x=>x.id==='Crafting'); s.basePerSec = clampPerSec(s.basePerSec * 1.10); } },
  ],
  Cooking: [
    { id:'heatControl1', name:'Heat Control I', desc:'+10 percentage points cooking success', cost:{ ore:100 }, apply(){} },
    { id:'heatControl2', name:'Heat Control II', desc:'Failed cooks have a 25% chance to preserve the Raw Fish', requirements:[{type:'skillLevel',skill:'Cooking',value:20}], cost:{ ore:220, bars:40 }, apply(){} },
    { id:'stove1', name:'Efficient Stove', desc:'10% faster Cooking attempts', cost:{ ore:160, bars:30 }, apply(){ const skill=skills.find(candidate=>candidate.id==='Cooking'); skill.basePerSec=clampPerSec(skill.basePerSec*1.10); } }
  ],
  Woodcutting: [
    { id:'axe1', name:'Sharpened Axe', desc:'10% faster Woodcutting', cost:{ ore:120, bars:30 }, apply(){} },
    { id:'logSplitter', name:'Log Splitter', desc:'Every eighth chop produces one bonus log', requirements:[{type:'skillLevel',skill:'Woodcutting',value:20}], cost:{ ore:240, bars:70 }, apply(){} },
    { id:'axe2', name:'Tempered Axe', desc:'A further 12% faster Woodcutting', requirements:[{type:'skillLevel',skill:'Woodcutting',value:40}], cost:{ ore:400, bars:140 }, apply(){} }
  ]
};
const ownedSkillUps = new Set();
const GEAR = [
  { id:'ironBlade', name:'Iron Blade', desc:'Directional melee weapon for close-range arena combat', cost:30, slot:'melee', requirements:[{type:'skillLevel',skill:'Smithing',value:5}] },
  { id:'reinforcedPick', name:'Reinforced Pick', desc:'+25% Mining rate while equipped', cost:30, slot:'tool', requirements:[{type:'skillLevel',skill:'Mining',value:5}] },
  { id:'forgeGauntlet', name:'Forge Gauntlet', desc:'+25% Smithing rate while equipped', cost:30, slot:'tool', requirements:[{type:'skillLevel',skill:'Smithing',value:8}] },
  { id:'platedVest', name:'Plated Vest', desc:'+25 maximum arena health', cost:40, slot:'armor', requirements:[{type:'skillLevel',skill:'Smithing',value:10}] }
];
const ITEMS = {
  pulseSidearm:{ id:'pulseSidearm', name:'Pulse Sidearm', slot:'gun', damage:10, attackInterval:.25, accuracy:5, maxHit:4, projectileSpeed:400, lifetime:3, trait:'Disruptor Pulse: every fifth shot clears nearby hostile projectiles.' },
  ironBlade:{ id:'ironBlade', name:'Iron Blade', slot:'melee', damage:14, attackInterval:.55, accuracy:3, maxHit:6, range:64, swingArcDeg:100, trait:'Guard Arc: swings destroy hostile projectiles inside the weapon arc.' },
  frontierBow:{ id:'frontierBow', name:'Frontier Bow', slot:'ranged', damage:12, attackInterval:.55, accuracy:5, maxHit:5, projectileSpeed:360, lifetime:3, trait:'Basic physical shots for the Ranged path.' },
  emberFocus:{ id:'emberFocus', name:'Ember Focus', slot:'magic', damage:13, attackInterval:.65, accuracy:5, maxHit:6, projectileSpeed:300, lifetime:3, trait:'Basic magical bolts for the Magic path.' },
  reinforcedPick:{ id:'reinforcedPick', name:'Reinforced Pick', slot:'tool', detail:'+25% Mining rate' },
  forgeGauntlet:{ id:'forgeGauntlet', name:'Forge Gauntlet', slot:'tool', detail:'+25% Smithing rate' },
  platedVest:{ id:'platedVest', name:'Plated Vest', slot:'armor', hp:25 },
  rawFish:{ id:'rawFish', name:'Raw Fish', slot:'material', detail:'Cook this before eating it.' },
  cookedFish:{ id:'cookedFish', name:'Cooked Fish', slot:'food', detail:'Instantly restores 40 HP' },
  smokedRation:{ id:'smokedRation', name:'Smoked Ration', slot:'food', detail:'Restore 15 HP, then 20 HP over 5 seconds' },
  surgefinRation:{ id:'surgefinRation', name:'Surgefin Ration', slot:'food', detail:'Restore 15 HP and reset Dash cooldown' }
};
function foodCount(id) {
  if (id === 'cookedFish') return skills.find(skill => skill.id === 'Cooking').qty;
  if (id === 'smokedRation') return smokedRations;
  if (id === 'surgefinRation') return surgefinRations;
  return 0;
}
function arenaFoodDefinition(id) {
  if (id === 'cookedFish') return { id, name:'Cooked Fish', instantHeal:40, regenHeal:0, regenDuration:0, resetDash:false };
  if (id === 'smokedRation') return { id, name:'Smoked Ration', instantHeal:15, regenHeal:20, regenDuration:5, resetDash:false };
  if (id === 'surgefinRation') return { id, name:'Surgefin Ration', instantHeal:15, regenHeal:0, regenDuration:0, resetDash:true };
  return null;
}
function consumeFoodItem(id) {
  if (foodCount(id) < 1) return false;
  if (id === 'cookedFish') skills.find(skill => skill.id === 'Cooking').qty -= 1;
  if (id === 'smokedRation') smokedRations -= 1;
  if (id === 'surgefinRation') surgefinRations -= 1;
  return true;
}

const LOADOUT_SLOTS = ['melee','ranged','gun','magic','chest','tool','food'];
const ownedGear = new Set();
const ownedItems = new Set();
let equippedTool = null;
let equipment = { tool:null };
const MAX_WEAPON_REFINEMENT = 5;
const LEGACY_COMBAT_DEFINITION_IDS = Object.freeze({
  pulseSidearm:'pulse-sidearm', ironBlade:'iron-blade', frontierBow:'frontier-bow', emberFocus:'ember-focus', platedVest:'plated-vest'
});

// Fresh saves pass through the same canonicalizer as historical saves. That
// keeps starter gear, crafted gear, Arena and Solo on one item-instance model.
if (!soloFrontierState.lootCache.items.length) {
  soloFrontierState = SOLO_FRONTIER_FRAMEWORK.migrateV20SaveToV21({
    version:20,
    skills:[],
    savedAt:Date.now(),
    equipment:{ gun:'pulseSidearm', ranged:'frontierBow', magic:'emberFocus', melee:null, armor:null, food:null, tool:null },
    weaponRefinements:{ pulseSidearm:0, ironBlade:0 },
    soloFrontier:{ ...soloFrontierState, version:20 }
  }).soloFrontier;
}

function canonicalLootCache() {
  return soloFrontierRuntime?.getState()?.lootCache || soloFrontierState.lootCache;
}

function setCanonicalLootCache(cache) {
  if (soloFrontierRuntime) {
    const state = soloFrontierRuntime.getState();
    soloFrontierRuntime.hydrate({ ...state, lootCache:cache });
  } else {
    soloFrontierState = { ...soloFrontierState, lootCache:cache };
  }
  rehydrateLootInventory();
  return cache;
}

function canonicalEquippedInstance(slot) {
  const cache = canonicalLootCache();
  const instanceId = cache.equipment[slot];
  return instanceId ? cache.items.find(instance => instance.instanceId === instanceId) || null : null;
}

function canonicalFoodId() {
  return canonicalLootCache().foodId || null;
}

function setCanonicalFoodId(foodId) {
  const cache = canonicalLootCache();
  setCanonicalLootCache({ ...cache, foodId:foodId || null });
}

function ensureCanonicalCombatItem(legacyId, sourceId = 'workshop') {
  const definitionId = LEGACY_COMBAT_DEFINITION_IDS[legacyId] || legacyId;
  const cache = canonicalLootCache();
  const existing = cache.items.find(instance => instance.definitionId === definitionId && ['legacy-equipment', 'workshop'].includes(instance.sourceId));
  if (existing) return existing;
  const definition = LOOT_FRAMEWORK.getItemDefinition(definitionId);
  if (!definition) return null;
  const instance = {
    instanceId:`${sourceId}:${definitionId}`,
    definitionId,
    rarity:'common',
    itemLevel:1,
    affixes:[],
    signatureId:definition.signatureId,
    sourceId,
    acquiredAt:Date.now(),
    rerolls:0,
    enhancementRank:Math.max(0, Number(weaponRefinements[legacyId]) || 0)
  };
  const uniqueId = cache.items.some(item => item.instanceId === instance.instanceId) ? `${instance.instanceId}:${Date.now()}` : instance.instanceId;
  const created = { ...instance, instanceId:uniqueId };
  setCanonicalLootCache({ ...cache, items:[...cache.items, created] });
  return created;
}

function equipCanonicalCombatItem(instance, requestedSlot) {
  if (!instance) return false;
  const cache = canonicalLootCache();
  const result = LOOT_FRAMEWORK.equipItem(cache.equipment, instance, requestedSlot);
  if (!result.accepted) { showToast(result.reason); return false; }
  setCanonicalLootCache({ ...cache, equipment:result.loadout });
  return true;
}

function unequipCanonicalSlot(slot) {
  const cache = canonicalLootCache();
  const next = { ...cache.equipment, [slot]:null };
  if (next.activeWeaponSlot === slot) next.activeWeaponSlot = ['melee','gun','ranged','magic'].find(candidate => next[candidate]) || null;
  setCanonicalLootCache({ ...cache, equipment:next });
}

function lootDefinitionFor(instance) {
  return LOOT_FRAMEWORK?.getItemDefinition(instance?.definitionId) || null;
}

function lootRarityFor(instance) {
  return LOOT_FRAMEWORK?.getRarity(instance?.rarity) || { id:'common', name:'Common', color:'#9aa4b2', glow:'none', affixCount:0, statMultiplier:1 };
}

function materializeLootItem(instance) {
  const definition = lootDefinitionFor(instance);
  if (!definition) return null;
  const stats = LOOT_FRAMEWORK.calculateItemStats(definition, instance);
  const rarity = lootRarityFor(instance);
  const item = {
    id: instance.instanceId,
    name: `${definition.name} · ${rarity.name}`,
    slot: definition.slot,
    damage: stats.damage || 0,
    attackInterval: Math.max(0.12, stats.attackInterval || (definition.slot === 'gun' ? 0.25 : 0.55)),
    accuracy: stats.accuracy || 0,
    maxHit: stats.maxHit || 0,
    range: stats.range || (definition.slot === 'gun' ? 0 : 64),
    swingArcDeg: definition.slot === 'melee' ? 100 : undefined,
    projectileSpeed: definition.slot === 'gun' ? 400 : undefined,
    lifetime: definition.slot === 'gun' ? 3 : undefined,
    hp: stats.hp || 0,
    bossDamage: stats.bossDamage || 0,
    critChance: stats.critChance || 0,
    playstyle: definition.description,
    trait: `${definition.signatureName}: ${definition.signatureDescription}`,
    detail: `${definition.signatureName}: ${definition.signatureDescription}`,
    rarityId: instance.rarity,
    lootInstanceId: instance.instanceId,
    weight: definition.weight,
    dynamicLoot: true
  };
  ITEMS[instance.instanceId] = item;
  return item;
}

function rehydrateLootInventory() {
  canonicalLootCache().items.forEach(instance => materializeLootItem(instance));
}

function equippedLootIds() {
  return LOOT_FRAMEWORK?.equippedItemIds?.(canonicalLootCache().equipment) || [];
}

function inspectLoot(instanceId) {
  const instance = canonicalLootCache().items.find(candidate => candidate.instanceId === instanceId);
  return instance ? LOOT_FRAMEWORK?.inspectItem(instance) : null;
}

function awardLootResolution(resolution) {
  if (!resolution) return null;
  salvageMaterials += resolution.salvage;
  collectionProgress = LOOT_FRAMEWORK?.updateCollectionProgress(collectionProgress, resolution) || collectionProgress;
  let retainedItem = resolution.item;
  if (resolution.item && soloFrontierRuntime && LOOT_FRAMEWORK?.insertLoot) {
    const state = soloFrontierRuntime.getState();
    const mutation = LOOT_FRAMEWORK.insertLoot(state.lootCache, resolution.item);
    const nextCollectionProgress = LOOT_FRAMEWORK.updateCollectionProgress(state.collectionProgress, resolution);
    if (mutation.accepted) {
      soloFrontierRuntime.hydrate({
        ...state,
        lootCache: mutation.cache,
        collectionProgress: nextCollectionProgress
      });
    } else {
      soloFrontierRuntime.hydrate({ ...state, collectionProgress: nextCollectionProgress });
      retainedItem = null;
      salvageMaterials += mutation.salvage;
    }
  }
  if (retainedItem) {
    materializeLootItem(retainedItem);
    latestLootReward = retainedItem;
  }
  return retainedItem;
}

function lootLabel(instance) {
  const definition = lootDefinitionFor(instance);
  const rarity = lootRarityFor(instance);
  return `${rarity.name} ${definition?.name || 'Unknown item'}`;
}

function lootResultMarkup(resolution) {
  if (!resolution) return '';
  const item = resolution.item;
  const collection = `${resolution.collectionProgress} collection progress · ${resolution.salvage} Salvage`;
  if (!item) return `<div class="loot-reward-summary"><strong>Combat cache secured</strong><span>${collection}</span></div>`;
  const inspection = inspectLoot(item.instanceId);
  const rarity = lootRarityFor(item);
  return `<article class="loot-reveal rarity-${item.rarity}" style="--loot-color:${rarity.color}">${itemVisualMarkup(item,canonicalLootCache(),'loot-reveal-icon',{ isNew:true })}<div><div class="eyebrow">LOOT DROP</div><strong>${lootLabel(item)}</strong><span>${inspection?.signature || ''}</span><small>${item.affixes.length} affixes · ${collection}</small></div></article>`;
}

function salvageLootItem(instanceId) {
  const result = LOOT_FRAMEWORK?.salvageCachedItem(canonicalLootCache(), instanceId);
  if (!result?.accepted) {
    if (result?.reason) showToast(result.reason);
    return false;
  }
  setCanonicalLootCache(result.cache);
  delete ITEMS[instanceId];
  salvageMaterials += result.salvage;
  showToast(`Salvaged ${result.salvage} materials`);
  logActivity(`Salvaged ${lootLabel(result.item)} · +${result.salvage} Salvage`, 'loot');
  renderLoadout();
  saveGame();
  return true;
}
function weaponDamage(item) {
  return Number(item?.damage || 0);
}
function gearRateMult(skillId) {
  if (skillId === 'Mining' && equipment.tool === 'reinforcedPick') return 1.25;
  if (skillId === 'Smithing' && equipment.tool === 'forgeGauntlet') return 1.25;
  return 1;
}
function playerMaxHp() {
  const cache = canonicalLootCache();
  const snapshot = LOOT_FRAMEWORK?.calculateEquippedStats?.(cache.equipment, cache.items) || { stats:{} };
  return 100 + Number(snapshot.stats?.hp || 0);
}
function equippedGun() {
  const instance = canonicalEquippedInstance('gun');
  return instance ? materializeLootItem(instance) : null;
}

function soloFrontierCombatInput(stage, seed, runtimeState = null) {
  const slots = ['melee', 'gun', 'ranged', 'magic'];
  const frontierSnapshot = runtimeState || soloFrontierRuntime?.getState() || soloFrontierState;
  const cache = frontierSnapshot.lootCache;
  const activeSlot = cache?.equipment?.activeWeaponSlot || slots.find(slot => cache?.equipment?.[slot]) || 'gun';
  const cachedInstance = cache?.items?.find(instance => instance.instanceId === cache?.equipment?.[activeSlot]);
  const inspection = cachedInstance ? LOOT_FRAMEWORK?.inspectItem(cachedInstance) : null;
  const definition = inspection?.definition;
  const itemStats = inspection?.stats || {};
  const style = activeSlot === 'melee'
    ? definition?.weight === 'light' ? 'light-melee' : definition?.weight === 'heavy' ? 'heavy-melee' : 'medium-melee'
    : activeSlot;
  const technique = soloDeskCompatibleTechnique(style);
  const equippedSnapshot = LOOT_FRAMEWORK?.calculateEquippedStats?.(cache?.equipment, cache?.items || []) || { stats:{}, armourPieces:[] };
  const activeCached = equippedSnapshot.activeWeaponSlot && cache?.equipment?.[equippedSnapshot.activeWeaponSlot]
    ? cache.items?.find(instance => instance.instanceId === cache.equipment[equippedSnapshot.activeWeaponSlot])
    : null;
  const activeCachedStats = activeCached ? LOOT_FRAMEWORK?.inspectItem(activeCached)?.stats || {} : {};
  const equippedStats = Object.fromEntries(Object.entries(equippedSnapshot.stats || {}).map(([key, value]) => [key, Math.max(0, Number(value || 0) - Number(activeCachedStats[key] || 0))]));
  const isForcedDefeat = soloDeskForceDefeat;
  return {
    combatSkills: COMBAT_PROGRESSION_FRAMEWORK.compatibility.progressionLevelMap(frontierSnapshot.combatProgression || combatProgression),
    equippedStats: {
      hitPoints: isForcedDefeat ? -99 : Number(equippedStats.hp || 0),
      damage: Number(equippedStats.damage || 0),
      accuracy: Number(equippedStats.accuracy || 0),
      evasion: Number(equippedStats.evasion || 0),
      ward: Number(equippedStats.ward || 0),
      armourPieces: equippedSnapshot.armourPieces || [],
      criticalChanceBonus: Number(equippedStats.critChance || 0) / 100,
      criticalMultiplierBonus: 0
    },
    activeWeapon: {
      id: cachedInstance?.instanceId || 'unarmed',
      name: definition?.name || 'Unarmed Wayfinder',
      style,
      damage: isForcedDefeat ? 0 : Number(itemStats.damage || 1),
      accuracy: Number(itemStats.accuracy || 0),
      attackInterval: Math.max(.2, Number(itemStats.attackInterval || 1)),
      damageType: style === 'magic' ? 'magical' : 'physical'
    },
    stance: soloDeskStance,
    technique,
    defensiveAbility: isForcedDefeat ? 'none' : soloDeskDefensiveAbility,
    aura: isForcedDefeat ? 'none' : soloDeskAura,
    enemy: SOLO_FRONTIER_FRAMEWORK.stage(stage).enemy,
    stage,
    seed
  };
}

function soloDeskState() {
  return soloFrontierRuntime?.getState() || soloFrontierState;
}

function soloDeskRarityIndex(rarity) {
  return LOOT_FRAMEWORK?.rarities?.findIndex(candidate => candidate.id === rarity) ?? 0;
}

function soloDeskInspection(instance) {
  return instance ? LOOT_FRAMEWORK?.inspectItem(instance) : null;
}

function soloDeskSlotCategory(definition) {
  if (!definition) return 'other';
  if (definition.kind === 'weapon' || ['melee', 'gun', 'ranged', 'magic'].includes(definition.slot)) return 'weapon';
  if (definition.kind === 'armour' || ['helm', 'chest', 'gloves', 'pants', 'boots', 'cloak', 'armor'].includes(definition.slot)) return 'armour';
  if (definition.slot === 'ring') return 'ring';
  if (definition.slot === 'trinket') return 'trinket';
  if (definition.kind === 'accessory' || ['belt', 'amulet'].includes(definition.slot)) return 'accessory';
  return 'other';
}

function soloDeskSlotLabel(slot) {
  return ({
    melee:'Melee weapon', gun:'Gun', ranged:'Ranged weapon', magic:'Magic focus', helm:'Helm', chest:'Chest',
    gloves:'Gloves', pants:'Pants', boots:'Boots', belt:'Belt', cloak:'Cloak', amulet:'Amulet', ring:'Ring', ring1:'Ring I',
    ring2:'Ring II', trinket:'Trinket', trinket1:'Trinket I', trinket2:'Trinket II', food:'Food'
  })[slot] || slot;
}

function soloDeskEquippedIds(cache) {
  return Object.values(cache?.equipment || {}).filter(Boolean);
}

function soloDeskItemPower(instance) {
  const inspection = soloDeskInspection(instance);
  if (!inspection) return 0;
  const stats = inspection.stats || {};
  return Number(stats.damage || 0) * 4
    + Number(stats.maxHit || 0) * 2
    + Number(stats.hp || 0)
    + Number(stats.accuracy || 0) * 1.5
    + Number(stats.range || 0) * .25
    + Number(stats.bossDamage || 0) * 3;
}

function soloDeskCurrentStage(state = soloDeskState()) {
  if (state.currentStage) return state.currentStage;
  if (state.wall?.stage) return state.wall.stage;
  if (state.order === 'push' && state.highestClearedStage < 30) return state.highestClearedStage + 1;
  return state.farmStage || state.highestClearedStage || 1;
}

function soloDeskCacheMutation(nextCache) {
  if (!soloFrontierRuntime) return;
  soloFrontierRuntime.hydrate({ ...soloFrontierRuntime.getState(), lootCache: nextCache });
  syncSoloFrontierProjection();
  renderSoloFrontierDesk();
  saveGame();
}

function soloDeskRenderSelectors(state) {
  if (!soloFarmStageSelect || !soloFallbackStageSelect) return;
  const selectedFarm = state.farmStage || state.highestClearedStage || '';
  const selectedFallback = state.configuredFallbackStage || '';
  soloFarmStageSelect.innerHTML = state.highestClearedStage
    ? Array.from({ length: state.highestClearedStage }, (_, index) => index + 1).map(stage => `<option value="${stage}">Stage ${String(stage).padStart(2, '0')} · ${SOLO_FRONTIER_FRAMEWORK.stage(stage).enemy.name}</option>`).join('')
    : '<option value="">Clear a stage first</option>';
  soloFallbackStageSelect.innerHTML = `<option value="">Highest cleared</option>${state.highestClearedStage ? Array.from({ length: state.highestClearedStage }, (_, index) => index + 1).map(stage => `<option value="${stage}">Stage ${String(stage).padStart(2, '0')}</option>`).join('') : ''}`;
  soloFarmStageSelect.value = selectedFarm ? String(selectedFarm) : '';
  soloFallbackStageSelect.value = selectedFallback ? String(selectedFallback) : '';
  soloFarmStageSelect.disabled = state.highestClearedStage < 1;
  soloFallbackStageSelect.disabled = state.highestClearedStage < 1;
}

function soloDeskCombatSkillGroups() {
  return [
    ['OFFENSE', ['Strength', 'Melee Accuracy', 'Light Melee Weapon Proficiency', 'Medium Melee Weapon Proficiency', 'Heavy Melee Weapon Proficiency', 'Marksmanship', 'Ranged', 'Offensive Magic']],
    ['SUSTAIN', ['Support Magic', 'Reflexes', 'Healing', 'Vitality']],
    ['DEFENSE', ['Light Armour Proficiency', 'Medium Armour Proficiency', 'Heavy Armour Proficiency', 'Evasion', 'Warding']]
  ];
}

function renderSoloCombatSkills(state) {
  if (!soloCombatSkills) return;
  soloCombatSkills.innerHTML = soloDeskCombatSkillGroups().map(([group, ids]) => `<section class="combat-skill-group"><h4>${group}</h4>${ids.map(skillId => {
    const progress = state.combatProgression[skillId] || { level:1, xp:0 };
    const next = COMBAT_PROGRESSION_FRAMEWORK.progression.xpToNextCombatLevel(progress.level);
    const percent = Number.isFinite(next) ? Math.min(100, progress.xp / Math.max(1, next) * 100) : 100;
    const recent = Number(soloDeskRecentXp[skillId] || 0);
    const treeEntry = COMBAT_DEVELOPMENT_FRAMEWORK.trees[skillId];
    const earned = COMBAT_DEVELOPMENT_FRAMEWORK.earnedPoints(progress.level);
    const spent = state.combatDevelopment.trees[skillId].ownedNodeIds.length;
    const drilling = state.combatDevelopment.drill.skillId === skillId;
    const icon = ICON_MANIFEST.iconForCombatSkill(skillId);
    return `<article class="combat-skill-card${drilling ? ' is-drilling' : ''}">
      ${iconRefMarkup(icon,'combat-skill-icon')}
      <div class="combat-skill-card-copy"><div class="combat-skill-heading"><strong title="${skillId}">${skillId}</strong><em>Lv ${progress.level}</em></div><small>${Math.floor(progress.xp)}/${Number.isFinite(next) ? next : 'MAX'} XP${recent > 0 ? ` · +${Math.round(recent)} recent` : ''}</small><div class="combat-skill-meter"><i style="width:${percent}%"></i></div><span>${spent}/${earned} points spent · ${treeEntry.status === 'authored' ? 'Tree available' : `Authored in ${treeEntry.release}`}</span></div>
      <div class="combat-skill-actions"><button type="button" class="btn btn-small${drilling ? ' btn-primary' : ''}" data-combat-drill="${skillId}" ${progress.level >= 100 ? 'disabled' : ''}>${drilling ? 'Drilling · 0.1 XP/s' : 'Start Drill'}</button><button type="button" class="btn btn-small btn-quiet" data-combat-tree="${skillId}">Open Tree</button></div>
    </article>`;
  }).join('')}</section>`).join('');
  soloCombatSkills.querySelectorAll('[data-combat-drill]').forEach(button => button.addEventListener('click', () => {
    const current = soloDeskState();
    const skillId = button.dataset.combatDrill;
    const selected = current.combatDevelopment.drill.skillId === skillId ? null : skillId;
    const result = COMBAT_DEVELOPMENT_FRAMEWORK.selectDrill(current.combatDevelopment, current.combatProgression, selected);
    if (!result.accepted) { showToast(result.reason); return; }
    soloFrontierRuntime.hydrate({ ...current, combatDevelopment:result.state });
    syncSoloFrontierProjection();
    saveGame();
    renderSoloCombatSkills(soloDeskState());
  }));
  soloCombatSkills.querySelectorAll('[data-combat-tree]').forEach(button => button.addEventListener('click', () => openCombatSkillTree(button.dataset.combatTree)));
  const recentTotal = Object.values(soloDeskRecentXp).reduce((sum, amount) => sum + Number(amount || 0), 0);
  soloRecentXpSummary.textContent = recentTotal > 0 ? `Recent XP · +${Math.round(recentTotal)}` : 'Recent XP · none';
}

function frontierWallet() {
  return {
    gold,
    bars:Number(skills.find(skill => skill.id === 'Smithing')?.qty || 0),
    craftedComponents:Number(skills.find(skill => skill.id === 'Crafting')?.qty || 0),
    rareGems,
    food:{ cookedFish:Number(skills.find(skill => skill.id === 'Cooking')?.qty || 0), smokedRation:smokedRations, surgefinRation:surgefinRations }
  };
}

function applyFrontierWallet(wallet) {
  gold = wallet.gold;
  const smithing = skills.find(skill => skill.id === 'Smithing');
  const crafting = skills.find(skill => skill.id === 'Crafting');
  const cooking = skills.find(skill => skill.id === 'Cooking');
  if (smithing) smithing.qty = wallet.bars;
  if (crafting) crafting.qty = wallet.craftedComponents;
  if (cooking) cooking.qty = wallet.food.cookedFish;
  rareGems = wallet.rareGems;
  smokedRations = wallet.food.smokedRation;
  surgefinRations = wallet.food.surgefinRation;
}

function applyFrontierTransaction(result) {
  if (!result.accepted) { showToast(result.reason); return false; }
  applyFrontierWallet(result.wallet);
  const state = soloDeskState();
  soloFrontierRuntime.hydrate({
    ...state,
    lootCache:result.cache,
    frontierExchange:result.exchange,
    combatDevelopment:result.development || state.combatDevelopment
  });
  syncSoloFrontierProjection();
  showToast(result.reason);
  saveGame();
  renderSoloFrontierDesk();
  renderSoloCombatSkills(soloDeskState());
  renderCombatSkillTree();
  return true;
}

function openCombatSkillTree(skillId) {
  selectedCombatTreeSkill = skillId;
  renderCombatSkillTree();
  combatTreeModal.style.display = 'flex';
}

function renderCombatSkillTree() {
  if (!combatTreeContent || !selectedCombatTreeSkill) return;
  const state = soloDeskState();
  const skillId = selectedCombatTreeSkill;
  const entry = COMBAT_DEVELOPMENT_FRAMEWORK.trees[skillId];
  const progress = state.combatProgression[skillId];
  const treeState = state.combatDevelopment.trees[skillId];
  const earned = COMBAT_DEVELOPMENT_FRAMEWORK.earnedPoints(progress.level);
  const spent = treeState.ownedNodeIds.length;
  const available = Math.max(0, earned - spent);
  combatTreeTitle.textContent = `${skillId} Tree`;
  combatTreeSummary.innerHTML = `<span>Level ${progress.level}</span><strong>${available} available</strong><span>${spent}/${earned} spent</span><span>Respec ${COMBAT_DEVELOPMENT_FRAMEWORK.respecCost(spent)} Gold</span>`;
  respecCombatTree.disabled = spent === 0;
  respecCombatTree.textContent = spent ? `Respec · ${COMBAT_DEVELOPMENT_FRAMEWORK.respecCost(spent)} Gold` : 'No points allocated';
  if (!entry.tree) {
    combatTreeContent.innerHTML = `<section class="combat-tree-roadmap"><div>${iconRefMarkup(ICON_MANIFEST.iconForCombatSkill(skillId),'combat-tree-roadmap-icon')}</div><h3>${skillId}</h3><p>Your ${earned} earned points already exist and will remain unspent.</p><strong>${entry.release === 'v21.1' ? 'Sustain tree authored in v21.1' : 'Defense tree authored in v21.2'}</strong></section>`;
    return;
  }
  combatTreeContent.innerHTML = entry.tree.branches.map(branch => {
    const nodes = entry.tree.nodes.filter(node => node.branch === branch.id);
    return `<section class="combat-tree-branch" style="--branch-color:${branch.color}"><header><span>${branch.name}</span><small>${branch.description}</small></header>${nodes.map(node => {
      const status = SKILL_TREE_RULES.nodeState(entry.tree, treeState, node.id);
      const allocation = SKILL_TREE_RULES.canAllocate(entry.tree, treeState, node.id, available);
      return `<button type="button" class="combat-tree-node is-${status}${node.capstone ? ' is-capstone' : ''}" data-combat-tree-node="${node.id}" ${status === 'available' && allocation.allowed ? '' : 'disabled'}><span class="combat-tree-node-icon">${node.capstone ? '★' : '◆'}</span><span><strong>${node.name}</strong><small>${node.description}</small><em>${status === 'owned' ? 'OWNED' : allocation.reason}</em></span></button>`;
    }).join('')}</section>`;
  }).join('');
  combatTreeContent.querySelectorAll('[data-combat-tree-node]').forEach(button => button.addEventListener('click', () => {
    const current = soloDeskState();
    const result = COMBAT_DEVELOPMENT_FRAMEWORK.allocateNode(current.combatDevelopment, current.combatProgression, skillId, button.dataset.combatTreeNode);
    if (!result.accepted) { showToast(result.reason); return; }
    soloFrontierRuntime.hydrate({ ...current, combatDevelopment:result.state });
    syncSoloFrontierProjection();
    saveGame();
    renderCombatSkillTree();
    renderSoloCombatSkills(soloDeskState());
  }));
}

function dailyOfferLabel(offer) {
  if (offer.kind === 'resource') return `${offer.quantity} ${offer.resource}`;
  if (offer.kind === 'food') return `${offer.quantity} ${ITEMS[offer.foodId]?.name || offer.foodId}`;
  const inspection = soloDeskInspection(offer.item);
  return `${inspection?.rarity.name || offer.item.rarity} ${inspection?.definition.name || offer.category}`;
}

function renderFrontierExchange(state) {
  if (!frontierExchange) return;
  let exchange = FRONTIER_EXCHANGE_FRAMEWORK.refreshDailyStock(state.frontierExchange, state.seed, state.highestClearedStage, Date.now());
  if (exchange.storeDay !== state.frontierExchange.storeDay || exchange.dailyOffers[0]?.id !== state.frontierExchange.dailyOffers[0]?.id) {
    soloFrontierRuntime.hydrate({ ...state, frontierExchange:exchange });
    state = soloFrontierRuntime.getState();
  }
  const categories = FRONTIER_EXCHANGE_FRAMEWORK.COMBAT_GEAR_CATEGORIES;
  const requisitionCost = FRONTIER_EXCHANGE_FRAMEWORK.requisitionPrice(state.highestClearedStage);
  const contractCost = FRONTIER_EXCHANGE_FRAMEWORK.targetContractPrice(state.highestClearedStage);
  const contract = exchange.activeContract;
  const contractPercent = contract ? Math.min(100, contract.successfulMs / contract.requiredMs * 100) : 0;
  frontierExchangeSummary.textContent = `${Math.floor(gold)} Gold · earned ${exchange.ledger.earned} · spent ${exchange.ledger.spent}`;
  frontierExchange.innerHTML = `<div class="exchange-wallet"><span>AVAILABLE GOLD</span><strong>${Math.floor(gold)}</strong><small>Earned ${exchange.ledger.earned} · spent ${exchange.ledger.spent}</small></div>
    <section class="exchange-services"><h4>Permanent services</h4><label><span>Exact gear category</span><select class="btn" id="exchangeCategory">${categories.map(category => `<option value="${category}" ${category === selectedExchangeCategory ? 'selected' : ''}>${soloDeskSlotLabel(category)}</option>`).join('')}</select></label><div class="exchange-service-actions"><button class="btn" data-exchange-action="requisition">Requisition · ${requisitionCost} Gold</button><button class="btn" data-exchange-action="contract" ${contract || exchange.pendingContractReward ? 'disabled' : ''}>Target contract · ${contractCost} Gold</button></div>${contract ? `<div class="exchange-contract"><strong>${soloDeskSlotLabel(contract.category)} contract</strong><span>${(contract.successfulMs / 3_600_000).toFixed(2)} / 8 successful hours</span><div class="combat-skill-meter"><i style="width:${contractPercent}%"></i></div><button class="btn btn-quiet" data-exchange-action="cancel-contract">Cancel · no refund</button></div>` : ''}${exchange.pendingContractReward ? `<div class="exchange-contract is-complete">${itemVisualMarkup(exchange.pendingContractReward,state.lootCache,'exchange-reward')}<strong>Rare+ contract reward held</strong><button class="btn btn-primary" data-exchange-action="claim-contract">Claim reward</button></div>` : ''}</section>
    <section class="daily-stock"><h4>Daily stock · ${exchange.storeDay}</h4><div>${exchange.dailyOffers.map(offer => {
      const purchased = exchange.purchasedOfferIds.includes(offer.id);
      return `<article class="daily-offer">${offer.kind === 'item' ? itemVisualMarkup(offer.item,state.lootCache,'daily-offer-icon') : resourceIconMarkup(offer.kind === 'food' ? (ITEMS[offer.foodId]?.name === 'Cooked Fish' ? 'Cooked Fish' : `${ITEMS[offer.foodId]?.name}s`) : offer.resource,'daily-offer-icon')}<span><strong>${dailyOfferLabel(offer)}</strong><small>${offer.price} Gold · one purchase</small></span><button class="btn btn-small" data-daily-offer="${offer.id}" ${purchased ? 'disabled' : ''}>${purchased ? 'Purchased' : 'Buy'}</button></article>`;
    }).join('')}</div></section>`;
  frontierExchange.querySelector('#exchangeCategory')?.addEventListener('change', event => { selectedExchangeCategory = event.target.value; });
  frontierExchange.querySelector('[data-exchange-action="requisition"]')?.addEventListener('click', () => applyFrontierTransaction(FRONTIER_EXCHANGE_FRAMEWORK.purchaseRequisition(exchange, frontierWallet(), state.lootCache, selectedExchangeCategory, state.highestClearedStage, `${state.seed}:requisition:${Date.now()}`, Date.now())));
  frontierExchange.querySelector('[data-exchange-action="contract"]')?.addEventListener('click', () => applyFrontierTransaction(FRONTIER_EXCHANGE_FRAMEWORK.startTargetContract(exchange, frontierWallet(), state.lootCache, selectedExchangeCategory, state.highestClearedStage, Date.now())));
  frontierExchange.querySelector('[data-exchange-action="cancel-contract"]')?.addEventListener('click', () => {
    soloFrontierRuntime.hydrate({ ...state, frontierExchange:FRONTIER_EXCHANGE_FRAMEWORK.cancelTargetContract(exchange) });
    syncSoloFrontierProjection(); saveGame(); renderSoloFrontierDesk();
  });
  frontierExchange.querySelector('[data-exchange-action="claim-contract"]')?.addEventListener('click', () => applyFrontierTransaction(FRONTIER_EXCHANGE_FRAMEWORK.claimTargetContractReward(exchange, frontierWallet(), state.lootCache)));
  frontierExchange.querySelectorAll('[data-daily-offer]').forEach(button => button.addEventListener('click', () => applyFrontierTransaction(FRONTIER_EXCHANGE_FRAMEWORK.purchaseDailyStock(exchange, frontierWallet(), state.lootCache, button.dataset.dailyOffer))));
}

function soloDeskCacheVisibleItems(state) {
  const minimum = soloDeskRarityIndex(soloDeskCacheRarity);
  const equippedIds = new Set(soloDeskEquippedIds(state.lootCache));
  const items = state.lootCache.items.filter(instance => {
    const inspection = soloDeskInspection(instance);
    if (equippedIds.has(instance.instanceId)) return false;
    if (!inspection || soloDeskRarityIndex(instance.rarity) < minimum) return false;
    if (soloDeskCacheFavouritesOnly && !state.lootCache.favoriteIds.includes(instance.instanceId)) return false;
    if (soloDeskCacheSlot !== 'all') {
      const broadFilters = new Set(['weapon','armour','ring','trinket','accessory']);
      if (broadFilters.has(soloDeskCacheSlot)) {
        if (soloDeskSlotCategory(inspection.definition) !== soloDeskCacheSlot) return false;
      } else if (!LOOT_FRAMEWORK.validateEquipItem(instance, soloDeskCacheSlot).accepted) return false;
    }
    return true;
  });
  return items.sort((left, right) => {
    if (soloDeskCacheSort === 'rarity') return soloDeskRarityIndex(right.rarity) - soloDeskRarityIndex(left.rarity) || right.itemLevel - left.itemLevel;
    if (soloDeskCacheSort === 'newest') return right.acquiredAt - left.acquiredAt;
    if (soloDeskCacheSort === 'slot') return String(left.definitionId).localeCompare(String(right.definitionId));
    return soloDeskItemPower(right) - soloDeskItemPower(left) || right.itemLevel - left.itemLevel;
  });
}

function soloDeskCompareMarkup(instance, cache) {
  const inspection = soloDeskInspection(instance);
  if (!inspection) return '';
  const definitionSlot = inspection.definition.slot;
  const candidateSlots = definitionSlot === 'ring' ? ['ring1', 'ring2'] : definitionSlot === 'trinket' ? ['trinket1', 'trinket2'] : [definitionSlot];
  const equippedId = candidateSlots.map(slot => cache.equipment[slot]).find(Boolean);
  const equipped = equippedId ? cache.items.find(item => item.instanceId === equippedId) : null;
  const equippedInspection = soloDeskInspection(equipped);
  const statLines = stats => ['damage', 'attackInterval', 'accuracy', 'hp', 'maxHit', 'bossDamage'].filter(stat => stats?.[stat] !== undefined).map(stat => `${stat}: ${stats[stat]}`).join(' · ') || 'No combat stats';
  return `<div class="cache-compare"><div><strong>SELECTED</strong><span>${statLines(inspection.stats)}</span></div><div><strong>${equippedInspection ? 'EQUIPPED' : 'EMPTY SLOT'}</strong><span>${equippedInspection ? statLines(equippedInspection.stats) : 'No comparison item'}</span></div></div>`;
}

function renderSoloCacheInspector(state) {
  if (!soloCacheInspector) return;
  const instance = state.lootCache.items.find(candidate => candidate.instanceId === soloDeskSelectedItemId);
  const inspection = soloDeskInspection(instance);
  if (!instance || !inspection) {
    soloCacheInspector.innerHTML = 'Select a cached item to compare, equip, salvage, or reforge.';
    return;
  }
  const equipped = soloDeskEquippedIds(state.lootCache).includes(instance.instanceId);
  const favourite = state.lootCache.favoriteIds.includes(instance.instanceId);
  const cost = LOOT_FRAMEWORK.calculateReforgeCost(instance);
  soloCacheInspector.innerHTML = `<div class="cache-inspector-heading">${itemVisualMarkup(instance,state.lootCache,'inspector-item-visual')}<div><h4 style="color:${inspection.rarity.color}">${inspection.rarity.name} ${inspection.definition.name}</h4><div class="cache-inspector-meta">${soloDeskSlotLabel(inspection.definition.slot)} · item level ${instance.itemLevel} · power ${Math.round(soloDeskItemPower(instance))} · ${favourite ? 'favourited' : 'not favourited'}</div></div></div><p class="small">${inspection.signature}</p><div class="loot-affixes">${instance.affixes.length ? instance.affixes.map(affix => `<span>${affix.name} +${affix.value}${affix.unit === '%' ? '%' : ''}</span>`).join('') : '<span>No rolled affixes</span>'}</div><div class="cache-inspector-actions"><button class="btn btn-primary" data-solo-cache-action="equip" data-solo-cache-id="${instance.instanceId}" ${equipped ? 'disabled' : ''}>${equipped ? 'Equipped' : 'Equip + compare'}</button><button class="btn btn-quiet" data-solo-cache-action="favorite" data-solo-cache-id="${instance.instanceId}">${favourite ? 'Unfavourite' : 'Favourite'}</button><button class="btn btn-quiet" data-solo-cache-action="salvage" data-solo-cache-id="${instance.instanceId}" ${equipped || favourite ? 'disabled' : ''}>Manual salvage</button></div>${soloDeskCompareMarkup(instance, state.lootCache)}<div class="cache-reforge"><span class="small">Reforge one affix · ${cost.salvage} Salvage${cost.bars ? ` · ${cost.bars} Bars` : ''}${cost.craftedComponents ? ` · ${cost.craftedComponents} Components` : ''}</span>${instance.affixes.map(affix => `<button type="button" data-solo-cache-action="reforge" data-solo-cache-id="${instance.instanceId}" data-solo-cache-affix="${affix.id}"><span>${affix.name} · ${affix.value}</span><strong>Reforge</strong></button>`).join('') || '<span class="small">Common items have no affixes to reforge.</span>'}</div>`;
  soloCacheInspector.querySelectorAll('[data-solo-cache-action]').forEach(button => button.addEventListener('click', () => soloDeskCacheAction(button.dataset.soloCacheAction, button.dataset.soloCacheId, button.dataset.soloCacheAffix)));
}

function renderSoloCache(state) {
  if (!soloCacheList) return;
  const count = soloDeskUnequippedCount(state.lootCache);
  const capacity = Number(state.lootCache.capacity) || 35;
  soloCacheCount.textContent = String(count);
  soloCacheSummary.textContent = state.lootCache.grandfatheredOverflow
    ? 'Grandfathered overflow · salvage to clear'
    : count >= capacity ? 'FULL · new drops become Salvage' : `${count} retained · ${Math.max(0, capacity - count)} open slots`;
  soloCacheRarityFilter.value = soloDeskCacheRarity;
  soloCacheSlotFilter.value = soloDeskCacheSlot;
  soloCacheSort.value = soloDeskCacheSort;
  soloCacheFavouritesOnly.checked = soloDeskCacheFavouritesOnly;
  const visible = soloDeskCacheVisibleItems(state);
  const pageCount = Math.max(1, Math.ceil(visible.length / 35));
  soloDeskCachePage = Math.min(soloDeskCachePage, pageCount - 1);
  if (soloCachePageControls) soloCachePageControls.hidden = pageCount <= 1;
  if (soloCachePageLabel) soloCachePageLabel.textContent = `Page ${soloDeskCachePage + 1} / ${pageCount}`;
  if (soloCachePrevPage) soloCachePrevPage.disabled = soloDeskCachePage === 0;
  if (soloCacheNextPage) soloCacheNextPage.disabled = soloDeskCachePage >= pageCount - 1;
  const newIds = new Set([latestLootReward?.instanceId, ...(state.debrief?.keptDrops || []).map(item => item.instanceId)].filter(Boolean));
  const pageOffset = soloDeskCachePage * 35;
  const cells = Array.from({ length:35 }, (_, index) => visible[pageOffset + index] || null);
  soloCacheList.innerHTML = cells.map((instance, index) => {
    const position = pageOffset + index + 1;
    if (!instance) return `<button type="button" class="solo-cache-cell is-empty" data-cache-grid-index="${index}" aria-label="Empty cache position ${position}"><span>${String(position).padStart(2,'0')}</span></button>`;
    const inspection = soloDeskInspection(instance);
    const favourite = state.lootCache.favoriteIds.includes(instance.instanceId);
    return `<button type="button" class="solo-cache-cell${soloDeskSelectedItemId === instance.instanceId ? ' is-selected' : ''}" data-cache-grid-index="${index}" data-solo-cache-item="${instance.instanceId}" aria-label="${inspection.rarity.name} ${inspection.definition.name}, item level ${instance.itemLevel}">${itemVisualMarkup(instance,state.lootCache,'cache-item-visual',{ isNew:newIds.has(instance.instanceId) })}${favourite ? '<span class="sr-only">Favourite</span>' : ''}</button>`;
  }).join('');
  soloCacheList.querySelectorAll('[data-solo-cache-item]').forEach(card => card.addEventListener('click', () => {
    soloDeskSelectedItemId = card.dataset.soloCacheItem;
    if (latestLootReward?.instanceId === soloDeskSelectedItemId) latestLootReward = null;
    renderSoloCache(soloDeskState());
    renderSoloCacheInspector(soloDeskState());
  }));
  soloCacheList.querySelectorAll('[data-cache-grid-index]').forEach(cell => cell.addEventListener('keydown', event => {
    if (!['ArrowLeft','ArrowRight','ArrowUp','ArrowDown'].includes(event.key)) return;
    event.preventDefault();
    const columns = window.matchMedia('(max-width: 520px)').matches ? 5 : 7;
    const index = Number(cell.dataset.cacheGridIndex);
    const delta = event.key === 'ArrowLeft' ? -1 : event.key === 'ArrowRight' ? 1 : event.key === 'ArrowUp' ? -columns : columns;
    const next = Math.max(0, Math.min(34, index + delta));
    soloCacheList.querySelector(`[data-cache-grid-index="${next}"]`)?.focus();
  }));
  renderSoloCacheInspector(state);
}

function renderSoloPaperDoll(state) {
  if (!soloPaperDoll) return;
  const groups = [
    ['arsenal', ['melee','gun','ranged','magic']],
    ['armour', ['helm','chest','gloves','pants','boots','cloak']],
    ['accessories', ['amulet','belt','ring1','ring2','trinket1','trinket2','food']]
  ];
  const slotMarkup = slot => {
    const instanceId = slot === 'food' ? null : state.lootCache.equipment[slot];
    const instance = instanceId ? state.lootCache.items.find(candidate => candidate.instanceId === instanceId) : null;
    const inspection = soloDeskInspection(instance);
    const food = slot === 'food' ? ITEMS[state.lootCache.foodId] : null;
    const emptyIcon = ICON_MANIFEST.iconForPaperDollSlot(slot);
    return `<button type="button" class="paper-doll-slot${inspection || food ? ' is-filled' : ''}${inspection && state.lootCache.equipment.activeWeaponSlot === slot ? ' is-active-weapon' : ''}" data-paper-slot="${slot}" ${instance ? `data-paper-item="${instance.instanceId}"` : ''} aria-label="${soloDeskSlotLabel(slot)}: ${inspection?.definition.name || food?.name || 'empty'}"><small>${soloDeskSlotLabel(slot)}</small>${instance ? itemVisualMarkup(instance,state.lootCache,'paper-doll-item') : food ? `<span class="paper-doll-food">${resourceIconMarkup(food.name === 'Cooked Fish' ? 'Cooked Fish' : `${food.name}s`,'paper-doll-food-icon')}<em>${food.name}</em></span>` : `<span class="empty-slot-visual">${iconRefMarkup(emptyIcon,'empty-slot-icon')}<em>Empty</em></span>`}</button>`;
  };
  soloPaperDoll.innerHTML = groups.map(([group,slots]) => `<section class="paper-doll-group is-${group}"><h4>${group}</h4><div>${slots.map(slotMarkup).join('')}</div></section>`).join('');
  soloPaperDoll.querySelectorAll('[data-paper-slot]').forEach(button => button.addEventListener('click', () => {
    if (button.dataset.paperItem) {
      soloDeskSelectedItemId = button.dataset.paperItem;
      soloCacheDetails.open = true;
      renderSoloCacheInspector(soloDeskState());
      return;
    }
    const slot = button.dataset.paperSlot;
    soloDeskCacheSlot = slot === 'food' ? 'all' : slot;
    soloDeskCachePage = 0;
    soloCacheDetails.open = true;
    renderSoloCache(soloDeskState());
    soloCacheDetails.scrollIntoView({ block:'center', behavior:reduceMotionEnabled() ? 'auto' : 'smooth' });
  }));
}

function renderSoloDebrief(debrief) {
  if (!soloDebriefPanel || !debrief) return;
  const stateWall = soloDeskState().wall;
  const wall = debrief.wall || stateWall;
  const reportedDeaths = Math.max(Number(debrief.deaths || 0), wall ? 1 : 0);
  const outcome = wall ? 'DEFEAT // FARM FALLBACK' : 'VICTORY // REPORT READY';
  soloDebriefPanel.hidden = false;
  soloDebriefOutcome.textContent = outcome;
  const best = debrief.strongestKeptDrops?.[0];
  if (best) soloDeskSelectedItemId = best.instanceId;
  const bestInstance = best ? soloDeskState().lootCache.items.find(item => item.instanceId === best.instanceId) : null;
  const bestVisual = bestInstance ? itemVisualMarkup(bestInstance, soloDeskState().lootCache, 'debrief-item-visual') : '';
  const xpTotal = Object.values(debrief.skillXp || {}).reduce((sum, amount) => sum + Number(amount || 0), 0);
  soloDebriefSummary.innerHTML = `${bestVisual}<div class="debrief-stat is-good"><small>Victories</small><strong>${debrief.victories}</strong></div><div class="debrief-stat is-danger"><small>Deaths</small><strong>${reportedDeaths}</strong></div><div class="debrief-stat"><small>Combat XP</small><strong>+${Math.round(xpTotal)}</strong></div><div class="debrief-stat"><small>Gold</small><strong>+${Math.floor(debrief.gold || 0)}</strong></div><div class="debrief-stat"><small>Contract</small><strong>+${((debrief.contractProgressMs || 0) / 3_600_000).toFixed(2)}h</strong></div><div class="debrief-stat"><small>Kept drops</small><strong>${debrief.keptDropCount}</strong></div><div class="debrief-stat"><small>Salvage</small><strong>${debrief.filterSalvage + debrief.fullCacheSalvage}</strong></div><div class="debrief-stat"><small>Next order</small><strong>${wall?.fallbackStage ? `Farm ${wall.fallbackStage}` : debrief.finalOrder.toUpperCase()}</strong></div>${wall ? `<div class="debrief-stat"><small>Wall diagnosis</small><strong>${wall.termination === 'timeout' ? 'Timeout' : wall.reason}</strong></div>` : ''}${best ? `<div class="debrief-stat"><small>Best drop</small><strong>${soloDeskInspection(bestInstance)?.definition.name || 'Cached drop'}</strong></div>` : ''}`;
  renderSoloCacheInspector(soloDeskState());
}

function soloDeskCacheAction(action, instanceId, affixId) {
  const state = soloDeskState();
  const instance = state.lootCache.items.find(candidate => candidate.instanceId === instanceId);
  if (!instance) return;
  if (action === 'favorite') {
    soloDeskCacheMutation(LOOT_FRAMEWORK.setLootFavorite(state.lootCache, instanceId, !state.lootCache.favoriteIds.includes(instanceId)));
    return;
  }
  if (action === 'salvage') {
    const result = LOOT_FRAMEWORK.salvageCachedItem(state.lootCache, instanceId);
    if (!result.accepted) { showToast(result.reason); return; }
    salvageMaterials += result.value;
    soloDeskSelectedItemId = null;
    logActivity(`Manual salvage: ${soloDeskInspection(result.item)?.definition.name || 'drop'} · +${result.value} Salvage`, 'loot');
    showToast(`Manual salvage · +${result.value} Salvage`);
    soloDeskCacheMutation(result.cache);
    return;
  }
  if (action === 'equip') {
    const inspection = soloDeskInspection(instance);
    const requestedSlot = inspection?.definition.slot === 'ring' ? undefined : inspection?.definition.slot === 'trinket' ? undefined : inspection?.definition.slot;
    const result = LOOT_FRAMEWORK.equipItem(state.lootCache.equipment, instance, requestedSlot);
    if (!result.accepted) { showToast(result.reason); return; }
    let nextLoadout = result.loadout;
    if (inspection?.definition.kind === 'weapon') nextLoadout = LOOT_FRAMEWORK.setActiveWeaponSlot(nextLoadout, result.slot);
    soloDeskCacheMutation({ ...state.lootCache, equipment:nextLoadout });
    soloDeskSelectedItemId = instanceId;
    showToast(`${inspection.definition.name} equipped for Solo Frontier`);
    return;
  }
  if (action === 'reforge' && affixId) {
    const smithing = skills.find(skill => skill.id === 'Smithing');
    const crafting = skills.find(skill => skill.id === 'Crafting');
    const result = LOOT_FRAMEWORK.reforgeItem(instance, affixId, { salvage:salvageMaterials, bars:smithing?.qty || 0, craftedComponents:crafting?.qty || 0 });
    if (!result.accepted || !result.item) { showToast(result.reason); return; }
    salvageMaterials = Number(result.resources.salvage || salvageMaterials);
    if (smithing) smithing.qty = Number(result.resources.bars ?? smithing.qty);
    if (crafting) crafting.qty = Number(result.resources.craftedComponents ?? crafting.qty);
    const items = state.lootCache.items.map(candidate => candidate.instanceId === instanceId ? result.item : candidate);
    logActivity(`Reforged ${soloDeskInspection(result.item)?.definition.name || 'drop'} · ${affixId}`, 'loot');
    showToast('Affix reforged');
    soloDeskCacheMutation({ ...state.lootCache, items });
  }
}

function renderSoloFrontierDesk() {
  if (!soloFrontierShell || !SOLO_BATTLE_DESK_RENDERER) return;
  const state = soloDeskState();
  const activeStage = Math.max(1, Math.min(30, soloDeskCurrentStage(state)));
  const stageDefinition = SOLO_FRONTIER_FRAMEWORK.stage(activeStage);
  const activeInput = soloFrontierCombatInput(activeStage, `${state.seed}:encounter:${state.encounterSequence}:stage:${activeStage}:victory:${state.currentStageVictories}`);
  syncSoloDeskCombatControls(activeInput.activeWeapon.style);
  const preview = SOLO_FRONTIER_FRAMEWORK.simulateSoloCombat(activeInput);
  const elapsed = state.encounterElapsedMs;
  let currentEvent = null;
  let playerHitPoints = preview.derivedStats.maxHitPoints;
  let enemyHitPoints = stageDefinition.enemy.hitPoints;
  for (const event of preview.events) {
    if (event.atMs > elapsed) break;
    currentEvent = event;
    if (event.type === 'encounter-started') { playerHitPoints = event.playerHitPoints; enemyHitPoints = event.enemyHitPoints; }
    if (event.type === 'attack') {
      if (event.actor === 'player') enemyHitPoints = event.targetHitPoints;
      else playerHitPoints = event.targetHitPoints;
    }
    if (event.type === 'healing') playerHitPoints = event.playerHitPoints;
  }
  if (!currentEvent) currentEvent = preview.events.find(event => event.type === 'encounter-started') || null;
  const outcomeActive = soloDeskLastOutcome && performance.now() - soloDeskOutcomeAt < 4_200;
  const deskActive = state.order !== 'paused' || outcomeActive;
  const shownStage = outcomeActive ? soloDeskLastOutcome.stage : activeStage;
  const shownEnemy = SOLO_FRONTIER_FRAMEWORK.stage(shownStage).enemy;
  const lastAction = currentEvent?.type === 'attack'
    ? `${currentEvent.actor === 'player' ? activeInput.activeWeapon.name : shownEnemy.name} ${currentEvent.hit ? 'HIT' : 'MISS'}${currentEvent.hit ? ` · ${Math.round(currentEvent.damage)} damage` : ''}`
    : currentEvent?.type === 'healing' ? `MEND · +${currentEvent.amount} HP`
      : currentEvent?.type === 'barrier' ? `ARCANE BARRIER · ${currentEvent.granted} WARD`
        : currentEvent?.type === 'aura-activated' ? 'BATTLE FOCUS · AURA ACTIVE'
          : currentEvent?.type === 'encounter-started' ? 'CONTACT ACQUIRED'
            : '';
  const effects = [];
  if (currentEvent?.type === 'aura-activated') effects.push('aura');
  if (currentEvent?.type === 'barrier') effects.push('barrier');
  if (currentEvent?.type === 'healing') effects.push('heal');
  if (currentEvent?.type === 'attack' && currentEvent.hit) effects.push(currentEvent.actor === 'player' ? 'hit' : 'defeat');
  if (outcomeActive) effects.push(soloDeskLastOutcome.outcome === 'victory' ? 'victory' : 'defeat');
  const stageVictories = Number(state.stageVictories[String(activeStage)] || 0);
  soloStageLabel.textContent = `Stage ${String(shownStage).padStart(2, '0')}`;
  soloEnemyLabel.textContent = `${shownEnemy.kind === 'boss' ? 'BOSS' : 'CONTACT'} · ${shownEnemy.name}`;
  soloBattleStatus.textContent = state.order === 'paused' ? 'Desk idle · choose Push or Farm' : `${state.order.toUpperCase()} online · ${stageVictories}/${stageDefinition.victoriesToClear} victories`;
  soloBattleEvent.textContent = outcomeActive
    ? soloDeskLastOutcome.outcome === 'victory' ? `Stage ${shownStage} cleared · the next order is ${state.order.toUpperCase()}.` : `Wall at Stage ${shownStage} · farming ${state.farmStage || state.highestClearedStage || 'the outpost'}.`
    : lastAction || 'Contact acquired · awaiting the first exchange.';
  soloFrontierMode.textContent = state.order === 'paused' ? 'READY' : state.order.toUpperCase();
  soloOrderBadge.textContent = state.order.toUpperCase();
  soloCurrentStage.textContent = state.currentStage ? `Stage ${String(state.currentStage).padStart(2, '0')}` : state.highestClearedStage ? `Stage ${state.highestClearedStage} cleared` : 'Outpost';
  soloClearedStage.textContent = `${state.highestClearedStage} / 30`;
  soloStageProgress.textContent = `${stageVictories}/${stageDefinition.victoriesToClear} victories`;
  const activeWeaponName = activeInput.activeWeapon.name;
  soloActiveWeapon.textContent = activeWeaponName;
  soloActiveWeaponStyle.textContent = `${activeInput.activeWeapon.style} · ${soloDeskStance.toLowerCase()}`;
  soloWallDiagnosis.textContent = state.wall ? `Wall at Stage ${state.wall.stage} · ${state.wall.termination === 'timeout' ? 'timeout' : state.wall.reason}. Fallback: ${state.wall.fallbackStage ? `Stage ${state.wall.fallbackStage}` : 'highest cleared'}.` : 'No wall diagnosis yet. A defeat returns to the configured fallback.';
  soloDropFocus.innerHTML = `<span>DROP-TABLE FOCUS</span><strong>${stageDefinition.targetSlots.map(slot => soloDeskSlotLabel(slot)).join(' · ')}</strong>`;
  soloDeskRenderSelectors(state);
  renderSoloCombatSkills(state);
  renderSoloCache(state);
  renderSoloPaperDoll(state);
  renderFrontierExchange(state);
  if (soloDeskDebriefSnapshot) renderSoloDebrief(soloDeskDebriefSnapshot);
  soloDeskRenderer?.render({
    stage: deskActive ? shownStage : null,
    victories: stageVictories,
    victoriesToClear: stageDefinition.victoriesToClear,
    enemy: deskActive ? shownEnemy : null,
    playerName: 'Wayfinder',
    activeWeapon: activeWeaponName,
    weaponStyle: activeInput.activeWeapon.style,
    playerHitPoints,
    playerMaxHitPoints: preview.derivedStats.maxHitPoints,
    enemyHitPoints,
    enemyMaxHitPoints: shownEnemy.hitPoints,
    lastEvent: currentEvent,
    lastAction,
    outcome: outcomeActive ? soloDeskLastOutcome.outcome : null,
    outcomeLabel: outcomeActive ? (soloDeskLastOutcome.outcome === 'victory' ? `Stage ${shownStage} clear · ${state.order.toUpperCase()} continues` : `Returned to ${state.farmStage ? `Stage ${state.farmStage}` : 'highest cleared'}`) : '',
    effects,
    reducedMotion: reduceMotionEnabled()
  });
}

function handleSoloFrontierAdvance(result) {
  if (!result) return;
  Object.entries(result.debrief?.skillXp || {}).forEach(([skillId, amount]) => {
    if (Number(amount) > 0) soloDeskRecentXp[skillId] = Number(soloDeskRecentXp[skillId] || 0) + Number(amount);
  });
  if (!result.events?.length) return;
  const event = result.events[result.events.length - 1];
  soloDeskLastEvent = event;
  soloDeskLastOutcome = { outcome:event.outcome, stage:event.stage };
  soloDeskOutcomeAt = performance.now();
  soloDeskDebriefSnapshot = result.debrief;
  if (soloDeskForceDefeat) soloDeskForceDefeat = false;
  renderSoloDebrief(result.debrief);
}

function soloDeskDebriefAction(action) {
  const debrief = soloDeskDebriefSnapshot;
  if (!debrief) return;
  if (action === 'equip' || action === 'compare') {
    const best = debrief.strongestKeptDrops?.[0];
    if (!best) { showToast('No retained drop is available for that action.'); return; }
    soloDeskSelectedItemId = best.instanceId;
    soloCacheDetails.open = true;
    if (action === 'equip') soloDeskCacheAction('equip', best.instanceId);
    else { soloCacheDetails.scrollIntoView({ block:'center', behavior:reduceMotionEnabled() ? 'auto' : 'smooth' }); renderSoloFrontierDesk(); }
    return;
  }
  if (action === 'salvage') {
    const target = soloDeskSelectedItemId || debrief.strongestKeptDrops?.[0]?.instanceId;
    if (target) soloDeskCacheAction('salvage', target);
    else showToast('Select a cached item before salvaging.');
    return;
  }
  if (action === 'farm') {
    soloFarmStageSelect?.focus({ preventScroll:true });
    soloFarmStageSelect?.scrollIntoView({ block:'center', behavior:reduceMotionEnabled() ? 'auto' : 'smooth' });
    return;
  }
  if (action === 'filter') {
    soloCacheDetails.open = true;
    soloCacheRarityFilter?.focus({ preventScroll:true });
    soloCacheDetails.scrollIntoView({ block:'center', behavior:reduceMotionEnabled() ? 'auto' : 'smooth' });
    return;
  }
  if (action === 'push') {
    window.MomentumSoloFrontierRuntime.push();
    soloDeskDebriefSnapshot = null;
    soloDebriefPanel.hidden = true;
    renderSoloFrontierDesk();
  }
}

const ARENA_STYLES = [
  { id:'melee', name:'Melee', slot:'melee', implemented:true, playstyle:'Close the distance, aim with the pointer, and commit to directional swings.' },
  { id:'ranged', name:'Ranged', slot:'ranged', implemented:true, playstyle:'Keep distance and pressure targets with deliberate physical shots.' },
  { id:'gun', name:'Gun', slot:'gun', implemented:true, playstyle:'Stay mobile, aim with the pointer, and left click to fire accurate shots.' },
  { id:'magic', name:'Magic', slot:'magic', implemented:true, playstyle:'Control space with basic magical bolts while staying mobile.' }
];
let selectedArenaStyle = null;

/* =====================================
   SAVE / LOAD
===================================== */
const SAVE_KEY = 'momentum-save';
const SAVE_VERSION = 21;
const AUTO_SAVE_MS = 10_000;
let resetInProgress = false;

function createSaveData() {
  return {
    version: SAVE_VERSION,
    savedAt: Date.now(),
    skills: skills.map(({ id, basePerSec, active, qty, lvl, xp, progress, selectedToolId }) => ({
      id, basePerSec, active, qty, lvl, xp, progress, selectedToolId
    })),
    unlockedNormalSlots,
    hone,
    honingMult,
    keys,
    rareGems,
    gold,
    scrap,
    basicBait,
    uncommonFish,
    fishingBuffSecs,
    partyRewards:{ huntingXp, trappedGame },
    globalBuff: { ...globalBuff },
    baseMult,
    bulletDamage: BULLET_DAMAGE,
    ownedBaseUps: [...ownedBaseUps],
    ownedSkillUps: [...ownedSkillUps],
    ownedGear: [...ownedGear],
    equippedTool: equipment.tool,
    ownedItems: [...ownedItems],
    equipment: { tool:equipment.tool || null },
    combatTalents: [...ownedCombatTalents],
    combatSkillTreeView: { ...combatSkillTreeView },
    arenaRecords: { ...arenaRecords },
    activityLedger: [...activityLedger],
    frontier: {
      completedDirectives:[...completedDirectives], selectedDirective,
      directiveRecords:{ ...directiveRecords }, combatPresets:combatPresets.map(preset => preset ? { ...preset, talents:[...preset.talents] } : null),
      gauntletRecord:{ ...gauntletRecord }
    },
    foodInventory:{ smokedRations, surgefinRations, burntFish },
    woodcutting:{ selectedTree, inventory:{ ...woodInventory } },
    skillSpecializations:{ ...skillSpecializations },
    specializationProgress:{ ...specializationProgress },
    settings:{ ...gameSettings },
    soloDesk:{ stance:soloDeskStance, technique:soloDeskTechnique, defensive:soloDeskDefensiveAbility, aura:soloDeskAura, cacheRarity:soloDeskCacheRarity, cacheSlot:soloDeskCacheSlot, cacheSort:soloDeskCacheSort, favouritesOnly:soloDeskCacheFavouritesOnly },
    claimedOperations:[...claimedOperations],
    crafting:{ selectedRecipe:craftingSelectedRecipe },
    salvageMaterials,
    collectionProgress:{ ...collectionProgress },
    skillTools: skillToolInventory.map(instance => ({ ...instance })),
    arenaTierUnlocked,
    selectedArenaTier,
    arenaWins: [...arenaWins],
    world: worldRuntime?.getState() || null,
    soloFrontier: soloFrontierRuntime?.getState() || soloFrontierState
  };
}

function updateSaveStatus(savedAt) {
  saveStatus.textContent = `Saved ${new Date(savedAt).toLocaleTimeString()}. Autosaves every 10 seconds.`;
}

function saveGame(showConfirmation = false) {
  if (resetInProgress) return;
  const save = createSaveData();
  localStorage.setItem(SAVE_KEY, JSON.stringify(save));
  updateSaveStatus(save.savedAt);
  if (showConfirmation) showToast('Game saved');
}

function loadGame() {
  const raw = localStorage.getItem(SAVE_KEY);
  if (!raw) return false;

  try {
    let save = JSON.parse(raw);
    if (!Number.isInteger(save.version) || save.version < 1 || save.version > SAVE_VERSION) return false;
    save = SOLO_FRONTIER_FRAMEWORK.migrateMomentumSaveToV21(save);

    save.skills.forEach(savedSkill => {
      const skill = skills.find(s => s.id === savedSkill.id) || (savedSkill.id === 'Music' ? ensureSkillState('Music') : null);
      if (!skill) return;
      skill.basePerSec = savedSkill.basePerSec;
      skill.active = savedSkill.active;
      skill.qty = savedSkill.qty;
      skill.lvl = savedSkill.lvl;
      skill.xp = savedSkill.xp;
      skill.next = xpToNext(skill.lvl);
      skill.progress = savedSkill.progress;
      skill.selectedToolId = savedSkill.selectedToolId || null;
    });

    unlockedNormalSlots = Math.max(save.unlockedNormalSlots, skills.length);
    hone = skills.some(s => s.id === save.hone) ? save.hone : null;
    honingMult = save.honingMult;
    keys = save.keys;
    rareGems = save.rareGems;
    gold = save.version >= 16 ? Math.max(0, Number(save.gold) || 0) : 0;
    scrap = save.version >= 2 ? save.scrap ?? 0 : 0;
    basicBait = save.version >= 5 ? save.basicBait ?? 0 : 0;
    uncommonFish = save.version >= 5 ? save.uncommonFish ?? 0 : 0;
    fishingBuffSecs = save.version >= 5 ? save.fishingBuffSecs ?? 0 : 0;
    huntingXp = save.version >= 13 ? Math.max(0, Number(save.partyRewards?.huntingXp) || 0) : 0;
    trappedGame = save.version >= 13 ? Math.max(0, Number(save.partyRewards?.trappedGame) || 0) : 0;
    globalBuff = { ...save.globalBuff };
    baseMult = save.baseMult;
    BULLET_DAMAGE = save.bulletDamage;

    ownedBaseUps.clear();
    save.ownedBaseUps.forEach(id => ownedBaseUps.add(id));
    ownedSkillUps.clear();
    save.ownedSkillUps.forEach(id => ownedSkillUps.add(id));
    ownedGear.clear();
    if (save.version >= 3) save.ownedGear.forEach(id => ownedGear.add(id));
    ownedItems.clear();
    ownedGear.forEach(id => { if (ITEMS[id]?.slot === 'tool') ownedItems.add(id); });
    if (save.version >= 6) save.ownedItems.forEach(id => { if (ITEMS[id]?.slot === 'tool') ownedItems.add(id); });
    salvageMaterials = save.version >= 14 ? Math.max(0, Number(save.salvageMaterials) || 0) : 0;
    collectionProgress = save.version >= 14 && save.collectionProgress && typeof save.collectionProgress === 'object' ? Object.fromEntries(Object.entries(save.collectionProgress).map(([id, value]) => [id, Math.max(0, Number(value) || 0)])) : {};
    skillToolInventory = save.version >= 14 && Array.isArray(save.skillTools) ? save.skillTools.filter(instance => getSkillToolDefinition(instance.toolId)).map(instance => ({ instanceId:String(instance.instanceId), toolId:String(instance.toolId), acquiredAt:Number(instance.acquiredAt) || Date.now() })) : [];
    rehydrateLootInventory();
    skillToolInventory.forEach(instance => ensureSkillState(getSkillToolDefinition(instance.toolId).skillId));
    const legacyTool = save.version >= 3 && ownedGear.has(save.equippedTool) ? save.equippedTool : null;
    equipment = { tool:typeof save.equipment?.tool === 'string' ? save.equipment.tool : legacyTool };
    equippedTool = equipment.tool;
    ownedCombatTalents.clear();
    if (save.version >= 8) validateLoadedTalents(save.combatTalents || []).forEach(id => ownedCombatTalents.add(id));
    combatSkillTreeView = SKILL_TREE_RULES.createState(COMBAT_SKILL_TREE, [], save.version >= 14 ? save.combatSkillTreeView || {} : {}).view;
    arenaRecords = save.version >= 8 && save.arenaRecords ? { ...save.arenaRecords } : {};
    activityLedger = save.version >= 8 && Array.isArray(save.activityLedger) ? save.activityLedger.slice(0, 20) : [];
    if (save.version >= 9) {
      const knownDirectives = new Set(FRONTIER_DIRECTIVES.map(directive => directive.id));
      completedDirectives.clear();
      (save.frontier?.completedDirectives || []).forEach(id => { if (knownDirectives.has(id)) completedDirectives.add(id); });
      selectedDirective = knownDirectives.has(save.frontier?.selectedDirective) ? save.frontier.selectedDirective : null;
      directiveRecords = save.frontier?.directiveRecords ? { ...save.frontier.directiveRecords } : {};
      combatPresets = Array.isArray(save.frontier?.combatPresets) ? [save.frontier.combatPresets[0] || null, save.frontier.combatPresets[1] || null] : [null, null];
      gauntletRecord = { ...gauntletRecord, ...(save.frontier?.gauntletRecord || {}) };
      smokedRations = Math.max(0, Number(save.foodInventory?.smokedRations) || 0);
      surgefinRations = Math.max(0, Number(save.foodInventory?.surgefinRations) || 0);
      Object.keys(skillSpecializations).forEach(skillId => { if ([null, ...Object.keys(SPECIALIZATIONS[skillId])].includes(save.skillSpecializations?.[skillId] ?? null)) skillSpecializations[skillId] = save.skillSpecializations?.[skillId] ?? null; });
      Object.keys(specializationProgress).forEach(id => { specializationProgress[id] = Number(save.specializationProgress?.[id]) || 0; });
      gameSettings = { ...gameSettings, ...(save.settings || {}) };
      const savedDesk = save.soloDesk || {};
      if (['Aggressive', 'Balanced', 'Guarded'].includes(savedDesk.stance)) soloDeskStance = savedDesk.stance;
      if (['Power Strike', 'Burst Fire', 'Piercing Shot', 'Arc Bolt'].includes(savedDesk.technique)) soloDeskTechnique = savedDesk.technique;
      if (['none', 'Mend', 'Arcane Barrier'].includes(savedDesk.defensive)) soloDeskDefensiveAbility = savedDesk.defensive;
      if (['none', 'Battle Focus'].includes(savedDesk.aura)) soloDeskAura = savedDesk.aura;
      if (LOOT_FRAMEWORK?.rarities?.some(rarity => rarity.id === savedDesk.cacheRarity)) soloDeskCacheRarity = savedDesk.cacheRarity;
      if (['all', 'weapon', 'armour', 'ring', 'trinket', 'accessory', 'melee', 'gun', 'ranged', 'magic', 'helm', 'chest', 'gloves', 'pants', 'boots', 'cloak', 'belt', 'amulet', 'ring1', 'ring2', 'trinket1', 'trinket2'].includes(savedDesk.cacheSlot)) soloDeskCacheSlot = savedDesk.cacheSlot;
      if (['power', 'rarity', 'newest', 'slot'].includes(savedDesk.cacheSort)) soloDeskCacheSort = savedDesk.cacheSort;
      soloDeskCacheFavouritesOnly = Boolean(savedDesk.favouritesOnly);
      claimedOperations.clear();
      if (save.version >= 12) (save.claimedOperations || []).forEach(id => { if (OPERATIONS.some(operation => operation.id === id)) claimedOperations.add(id); });
    }
    if (save.version >= 10) {
      burntFish = Math.max(0, Number(save.foodInventory?.burntFish) || 0);
      Object.keys(woodInventory).forEach(id => { woodInventory[id] = Math.max(0, Number(save.woodcutting?.inventory?.[id]) || 0); });
      const woodLevel = skills.find(skill => skill.id === 'Woodcutting').lvl;
      selectedTree = TREE_TYPES.some(tree => tree.id === save.woodcutting?.selectedTree && woodLevel >= tree.level) ? save.woodcutting.selectedTree : 'pine';
    }
    const knownCraftingRecipeIds = new Set((SKILL_FRAMEWORK?.craftingRecipes || []).map(recipe => recipe.id));
    craftingSelectedRecipe = knownCraftingRecipeIds.has(save.crafting?.selectedRecipe) ? save.crafting.selectedRecipe : 'ironBlade';
    arenaTierUnlocked = save.version >= 4 ? Math.max(0, Math.min(3, Number(save.arenaTierUnlocked) || 0)) : 1;
    selectedArenaTier = save.version >= 4 ? Math.max(1, Number(save.selectedArenaTier) || 1) : 1;
    arenaWins = save.version >= 4 && Array.isArray(save.arenaWins) ? [0, 1, 2].map(index => Math.max(0, Number(save.arenaWins[index]) || 0)) : [0, 0, 0];
    legacyCombatAudit = null;
    combatProgression = COMBAT_PROGRESSION_FRAMEWORK.progression.normalizeCombatProgression(save.soloFrontier?.combatProgression);
    soloFrontierState = save.version >= 21
      ? SOLO_FRONTIER_FRAMEWORK.normalizeSoloFrontierState(save.soloFrontier)
      : SOLO_FRONTIER_FRAMEWORK.createInitialSoloFrontierState();
    soloFrontierRuntime = SOLO_FRONTIER_FRAMEWORK.createSoloFrontierRuntime(soloFrontierState);
    reconcileArenaTierUnlocks(arenaTierUnlocked);
    ensureWorldRuntime(save.version >= 15 ? save.world || null : null, save.version);

    updateSaveStatus(save.savedAt);
    return true;
  } catch (error) {
    console.error('Could not load Momentum save:', error);
    saveStatus.textContent = 'Save could not be loaded. Starting a new game.';
    return false;
  }
}

function resetSave() {
  if (!confirm('Reset all Momentum progress? This cannot be undone.')) return;
  resetInProgress = true;
  localStorage.removeItem(SAVE_KEY);
  location.reload();
}

/* =====================================
   SHOP LOGIC
===================================== */
function costRequirements(cost) {
  return [
    cost.ore && { type:'resource', resource:'Ore', value:cost.ore },
    cost.bars && { type:'resource', resource:'Bars', value:cost.bars }
  ].filter(Boolean);
}
function canAfford(cost) {
  return evaluateRequirements(costRequirements(cost)).met;
}
function payCost(cost) {
  if (cost.ore)  { const m = skills.find(s=>s.id==='Mining');   m.qty  -= cost.ore; }
  if (cost.bars) { const s = skills.find(s=>s.id==='Smithing'); s.qty  -= cost.bars; }
}

function renderBaseUps() {
  baseUpList.innerHTML = '';
  BASE_UPS.forEach(up=>{
    const owned = ownedBaseUps.has(up.id);
    const requirementState = evaluateRequirements(up.requirements);
    const unlocked = requirementState.met;
    const costTxt = unlocked ? `Cost: ${up.cost.ore? up.cost.ore+' Ore' : ''}${up.cost.ore && up.cost.bars ? ', ' : ''}${up.cost.bars? up.cost.bars+' Bars':''}` : `Requires: ${requirementState.missing.join(' · ')}`;
    const row = document.createElement('div');
    row.style.margin = '8px 0';
    row.innerHTML = `
      <div style="font-weight:600">${up.name}</div>
      <div style="opacity:.9; margin:2px 0 6px">${up.desc}</div>
      <div class="flex">
        <span>${costTxt}</span>
        <button class="btn" ${owned || !unlocked ? 'disabled':''}>${owned ? 'Owned' : unlocked ? 'Buy' : 'Locked'}</button>
      </div>
    `;
    const btn = row.querySelector('button');
    btn.onclick = ()=>{
      if (ownedBaseUps.has(up.id) || !unlocked) return;
      if (!canAfford(up.cost)) { showToast('Not enough resources'); return; }
      payCost(up.cost);
      up.apply();
      ownedBaseUps.add(up.id);
      showToast(`Purchased ${up.name}`);
      logActivity(`Purchased ${up.name}`, 'upgrade');
      renderBaseUps();
    };
    baseUpList.appendChild(row);
  });
}

function renderSkillUps(skillName) {
  const list = SKILL_UPS[skillName] || [];
  skillUpList.innerHTML = `<div style="margin-bottom:6px; font-weight:600">${skillName} Upgrades</div>`;
  list.forEach(up=>{
    const owned = ownedSkillUps.has(up.id);
    const requirementState = evaluateRequirements(up.requirements);
    const unlocked = requirementState.met;
    const costTxt = unlocked
      ? `Cost: ${up.cost.ore? up.cost.ore+' Ore' : ''}${up.cost.ore && up.cost.bars ? ', ' : ''}${up.cost.bars? up.cost.bars+' Bars':''}`
      : `Requires: ${requirementState.missing.join(' · ')}`;
    const row = document.createElement('div');
    row.style.margin = '8px 0';
    row.innerHTML = `
      <div style="font-weight:600">${up.name}</div>
      <div style="opacity:.9; margin:2px 0 6px">${up.desc}</div>
      <div class="flex">
        <span>${costTxt}</span>
        <button class="btn" ${owned || !unlocked ? 'disabled':''}>${owned ? 'Owned' : unlocked ? 'Buy' : 'Locked'}</button>
      </div>
    `;
    const btn = row.querySelector('button');
    btn.onclick = ()=>{
      if (ownedSkillUps.has(up.id) || !unlocked) return;
      if (!canAfford(up.cost)) { showToast('Not enough resources'); return; }
      payCost(up.cost);
      up.apply();
      ownedSkillUps.add(up.id);
      showToast(`Purchased ${up.name}`);
      logActivity(`Purchased ${up.name}`, 'upgrade');
      renderSkillUps(skillName);
    };
    skillUpList.appendChild(row);
  });
}

const SPECIALIZATIONS = {
  Mining: {
    steady:{ name:'Steady Extraction', description:'Each Mining action pays Ore immediately.' },
    vein:{ name:'Vein Mining', description:'Mining stores four actions, then the fifth action releases a seven-Ore vein.' }
  },
  Smithing: {
    precision:{ name:'Precision Forging', description:'Smelting cannot fail, but produces no Scrap.' },
    reclamation:{ name:'Reclamation', description:'Failed smelts create 2 Scrap and automatically recycle each full stack of 5.' }
  },
  Fishing: {
    harvesting:{ name:'Harvesting', description:'Every idle Fishing action produces Raw Fish.' },
    baitcraft:{ name:'Baitcraft', description:'Every fifth idle Fishing action produces Basic Bait instead of Raw Fish.' }
  },
  Cooking: {
    careful:{ name:'Careful Cooking', description:'Cook 25% slower but gain 20 percentage points of success chance.' },
    batch:{ name:'Batch Cooking', description:'Attempt up to two Raw Fish each action at the normal success chance.' },
    flamekeeper:{ name:'Flamekeeper', description:'Each burn adds 15 percentage points to the next attempt; success resets the bonus.' }
  },
  Woodcutting: {
    forester:{ name:'Forester', description:'Every fifth successful chop produces one bonus log.' },
    arborist:{ name:'Arborist', description:'Earn 50% more Woodcutting XP without changing log output.' },
    trailblazer:{ name:'Trailblazer', description:'Chop 25% faster, but 20% of actions produce no log; ideal for leveling quickly.' }
  },
  Crafting: {
    precision:{ name:'Precision Assembly', description:'Crafting actions never consume an extra component on a failed active assembly.' },
    improvisation:{ name:'Improvisation', description:'Active assembly bonuses last 25% longer.' }
  }
};

// Per skill tuning. All equal by default.
const SKILL_CFG = {
  Mining: { xpPerAction: 20, onAction(s, options){
    if (skillSpecializations.Mining === 'vein') {
      specializationProgress.Mining += 1;
      if (specializationProgress.Mining >= 5) { specializationProgress.Mining = 0; s.qty += 7; if (!options.silent) logActivity('Vein Mining released +7 Ore', 'specialization'); }
    } else s.qty += 1;
  } },
  Smithing: {
    xpPerAction: 20,
    waitingLabel:'waiting for Ore',
    canAct(){ return skills.find(s=>s.id==='Mining').qty >= SMELT_ORE_COST; },
    onAction(s, options){
      const mining = skills.find(x=>x.id==='Mining');
      mining.qty -= SMELT_ORE_COST;
      const failed = skillSpecializations.Smithing !== 'precision' && Math.random() < SMELT_FAIL_CHANCE;
      if (failed) {
        scrap += skillSpecializations.Smithing === 'reclamation' ? 2 : 1;
        if (skillSpecializations.Smithing === 'reclamation') {
          while (scrap >= scrapRecycleCost()) { scrap -= scrapRecycleCost(); mining.qty += 1; }
        }
      if (!options.silent) showToast(`Smelt failed: Scrap recovered`, 1200);
      } else s.qty += 1;
    }
  },
  Fishing: { xpPerAction: 20, onAction(s, options){
    if (skillSpecializations.Fishing === 'baitcraft') {
      specializationProgress.Fishing += 1;
      if (specializationProgress.Fishing >= 5) { specializationProgress.Fishing = 0; basicBait += 1; if (!options.silent) logActivity('Baitcraft produced +1 Basic Bait', 'specialization'); }
      else s.qty += 1;
    } else s.qty += 1;
  } },
  Cooking: {
    xpPerAction:20,
    waitingLabel:'waiting for Raw Fish',
    canAct(){ return skills.find(skill => skill.id === 'Fishing').qty >= 1; },
    onAction(s){
      const rawFish = skills.find(skill => skill.id === 'Fishing');
      const attempts = skillSpecializations.Cooking === 'batch' ? Math.min(2, Math.floor(rawFish.qty)) : 1;
      let successes = 0, failures = 0, preserved = 0;
      for (let attempt = 0; attempt < attempts; attempt += 1) {
        rawFish.qty -= 1;
        if (Math.random() < cookingSuccessChance(s.lvl)) {
          successes += 1;
          s.qty += 1;
          if (skillSpecializations.Cooking === 'flamekeeper') specializationProgress.Cooking = 0;
        } else {
          failures += 1;
          burntFish += 1;
          if (skillSpecializations.Cooking === 'flamekeeper') specializationProgress.Cooking += 1;
          if (ownedSkillUps.has('heatControl2') && Math.random() < 0.25) { rawFish.qty += 1; preserved += 1; }
        }
      }
      const details = [`${successes} cooked`, `${failures} burned`];
      if (preserved) details.push(`${preserved} fish preserved`);
      s.lastOutcome = { text:`Last attempt: ${details.join(' · ')}`, kind:failures ? successes ? 'mixed' : 'failure' : 'success', at:Date.now() };
    }
  },
  Woodcutting: {
    xpPerAction:20,
    onAction(s){
      specializationProgress.Woodcutting += 1;
      specializationProgress.WoodUpgrade += 1;
      const missed = skillSpecializations.Woodcutting === 'trailblazer' && Math.random() < 0.20;
      let logs = missed ? 0 : 1;
      if (skillSpecializations.Woodcutting === 'forester' && specializationProgress.Woodcutting % 5 === 0) logs += 1;
      if (ownedSkillUps.has('logSplitter') && specializationProgress.WoodUpgrade % 8 === 0) logs += 1;
      if (skillSpecializations.Woodcutting === 'arborist') s.xp += 10;
      woodInventory[selectedTree] += logs;
      s.qty += logs;
    }
  },
  Crafting: {
    xpPerAction: 20,
    waitingLabel:'waiting for Bars and Pine Logs',
    canAct(){
      const bars = skills.find(skill => skill.id === 'Smithing')?.qty || 0;
      const logs = woodInventory.pine || 0;
      return bars >= 1 && logs >= 1;
    },
    onAction(s){
      const resources = { Bars:skills.find(skill => skill.id === 'Smithing')?.qty || 0, 'Pine Logs':woodInventory.pine || 0 };
      const definition = SKILL_REGISTRY?.get('Crafting');
      if (!definition) return;
      const activeMultiplier = craftingActiveBonus.expiresAt > performance.now() ? craftingActiveBonus.multiplier : 1;
      const result = SKILL_FRAMEWORK.resolveSkillAction(definition, {
        skill:{ id:'Crafting', level:s.lvl, xp:s.xp, nextXp:s.next, active:s.active, progress:s.progress, quantity:s.qty, specializationId:skillSpecializations.Crafting },
        resources,
        mode:activeMultiplier > 1 ? 'active' : 'idle',
        activeMultiplier,
        random:Math.random
      });
      if (!result.accepted) return;
      skills.find(skill => skill.id === 'Smithing').qty -= result.consumed.Bars || 0;
      woodInventory.pine -= result.consumed['Pine Logs'] || 0;
      s.qty += result.produced['Crafted Components'] || 0;
      if (result.produced['Crafted Components']) s.lastOutcome = { text:`Assembled +${result.produced['Crafted Components']} component`, kind:'success', at:Date.now() };
    }
  },
  Music: {
    xpPerAction: 20,
    waitingLabel:'waiting for a valid instrument',
    canAct(){ return hasSkillTool('Music'); },
    onAction(s){ s.qty += 1; }
  }
};
// Safe getter if you add new skills later
function getSkillCfg(id){
  return SKILL_CFG[id] || { xpPerAction: 10, onAction(s){ /* no op */ } };
}

function craftingRecipeFor(itemId) {
  return SKILL_FRAMEWORK?.craftingRecipes?.find(recipe => recipe.equipmentId === itemId) || null;
}

function skillToolRecipeFor(toolId) {
  return SKILL_FRAMEWORK?.craftingRecipes?.find(recipe => recipe.skillToolId === toolId) || null;
}

function recipeRequirements(recipe) {
  if (!recipe) return [];
  return [
    { type:'skillLevel', skill:'Crafting', value:recipe.requiredLevel },
    ...Object.entries(recipe.inputs).map(([resource, value]) => ({ type:'resource', resource, value }))
  ];
}

function recipeInputLabel(recipe) {
  return recipe ? Object.entries(recipe.inputs).map(([resource, amount]) => `${amount} ${resource}`).join(' · ') : 'Legacy recipe';
}

function payCraftingRecipe(recipe) {
  if (!recipe) return false;
  const requirementState = evaluateRequirements(recipeRequirements(recipe));
  if (!requirementState.met) return false;
  const smithing = skills.find(skill => skill.id === 'Smithing');
  const crafting = skills.find(skill => skill.id === 'Crafting');
  Object.entries(recipe.inputs).forEach(([resource, amount]) => {
    if (resource === 'Bars') smithing.qty -= amount;
    if (resource === 'Crafted Components') crafting.qty -= amount;
    if (resource === 'Pine Logs') woodInventory.pine -= amount;
  });
  return true;
}

function processSkillAction(skill, options = {}) {
  const cfg = getSkillCfg(skill.id);
  if (cfg.canAct && !cfg.canAct()) return false;
  cfg.onAction(skill, options);
  skill.xp += cfg.xpPerAction;
  if (!options.silent) queueSkillXpDrop(skill, cfg.xpPerAction);
  if (!options.silent) tryLevelUp(skill);
  return true;
}

function cookingSuccessChance(level) {
  const upgrade = ownedSkillUps.has('heatControl1') ? 0.10 : 0;
  const spec = skillSpecializations.Cooking === 'careful' ? 0.20 : 0;
  const streak = skillSpecializations.Cooking === 'flamekeeper' ? Math.min(0.45, specializationProgress.Cooking * 0.15) : 0;
  return Math.min(0.99, 0.30 + Math.max(0, level - 1) * 0.007 + upgrade + spec + streak);
}
function skillActionRate(skill) {
  if (skill.id === 'Woodcutting') {
    let rate = TREE_TYPES.find(tree => tree.id === selectedTree)?.perSec || 1 / 2.5;
    if (ownedSkillUps.has('axe1')) rate *= 1.10;
    if (ownedSkillUps.has('axe2')) rate *= 1.12;
    if (skillSpecializations.Woodcutting === 'trailblazer') rate *= 1.40;
    return rate;
  }
  if (skill.id === 'Cooking' && skillSpecializations.Cooking === 'careful') return skill.basePerSec * 0.75;
  if (skill.id === 'Music') return skill.basePerSec * (selectedSkillTool('Music')?.xpMultiplier || 1);
  return skill.basePerSec;
}
function effectiveProductionRate(skill, efficiency, honing, buff = 1) {
  const sharedEfficiency = skill.id === 'Cooking' || skill.id === 'Woodcutting' ? 1 : efficiency;
  const activeBonus = skill.id === 'Crafting' && craftingActiveBonus.expiresAt > performance.now() ? craftingActiveBonus.multiplier : 1;
  return clampPerSec(skillActionRate(skill) * sharedEfficiency * honing * baseMult * buff * activeBonus * gearRateMult(skill.id) * fishingRateMult(skill.id));
}

function productiveSkills() {
  return skills.filter(skill => {
    if (!skill.active) return false;
    const cfg = getSkillCfg(skill.id);
    return !cfg.canAct || cfg.canAct();
  });
}

let pendingOfflineSummary = null;
async function applyOfflineProgress(savedAt) {
  const elapsed = Math.min(offlineMaxSeconds(), Math.max(0, (Date.now() - Number(savedAt || Date.now())) / 1000));
  if (elapsed < OFFLINE_MIN_SECONDS) return;

  const before = {
    ore: skills.find(skill => skill.id === 'Mining').qty,
    bars: skills.find(skill => skill.id === 'Smithing').qty,
    fish: skills.find(skill => skill.id === 'Fishing').qty,
    cookedFish: skills.find(skill => skill.id === 'Cooking').qty,
    craftedComponents: skills.find(skill => skill.id === 'Crafting').qty,
    logs: skills.find(skill => skill.id === 'Woodcutting').qty,
    burntFish,
    keys,
    scrap
  };
  let remaining = elapsed;
  while (remaining > 0) {
    const dt = Math.min(10, remaining);
    const productive = productiveSkills();
    const efficiency = mOfA(Math.max(1, productive.length));
    const buff = globalBuff.secs > 0 ? 1.5 : 1;
    const fishingBoost = fishingBuffSecs > 0 ? 1.5 : 1;

    for (const skill of productive) {
      if (!skill.active) continue;
      const honing = hone === skill.id ? honingMult : 1;
      const rate = effectiveProductionRate(skill, efficiency, honing, buff);
      skill.progress += rate * dt;
      let actions = Math.floor(skill.progress);
      if (actions <= 0) continue;
      skill.progress -= actions;

      let processed = 0;
      while (processed < actions) {
        if (!processSkillAction(skill, { silent:true, offline:true })) {
          skill.progress = 0;
          break;
        }
        processed += 1;
      }
      addXpSilently(skill, 0);
    }

    globalBuff.secs = Math.max(0, globalBuff.secs - dt);
    fishingBuffSecs = Math.max(0, fishingBuffSecs - dt);
    remaining -= dt;
    await Promise.resolve();
  }

  let soloDebrief = null;
  if (soloFrontierRuntime?.getState().order !== 'paused') {
    const result = await soloFrontierRuntime.catchUp(elapsed, {
      offlineCapSeconds: offlineMaxSeconds(),
      batchEncounters: 24
    });
    syncSoloFrontierProjection();
    soloDebrief = result.debrief;
  }

  pendingOfflineSummary = {
    seconds: elapsed,
    capped: elapsed >= offlineMaxSeconds(),
    ore: skills.find(skill => skill.id === 'Mining').qty - before.ore,
    bars: skills.find(skill => skill.id === 'Smithing').qty - before.bars,
    fish: skills.find(skill => skill.id === 'Fishing').qty - before.fish,
    cookedFish: skills.find(skill => skill.id === 'Cooking').qty - before.cookedFish,
    craftedComponents: skills.find(skill => skill.id === 'Crafting').qty - before.craftedComponents,
    logs: skills.find(skill => skill.id === 'Woodcutting').qty - before.logs,
    burntFish: burntFish - before.burntFish,
    keys: keys - before.keys,
    scrap: scrap - before.scrap,
    soloDebrief
  };
  saveGame();
}

function showOfflineSummary() {
  if (!pendingOfflineSummary) return;
  const summary = pendingOfflineSummary;
  const hours = Math.floor(summary.seconds / 3600);
  const minutes = Math.floor((summary.seconds % 3600) / 60);
  const rows = [
    ['Ore', summary.ore], ['Bars', summary.bars], ['Raw Fish', summary.fish], ['Cooked Fish', summary.cookedFish], ['Crafted Components', summary.craftedComponents], ['Burnt Fish', summary.burntFish], ['Logs', summary.logs],
    ['Boss Keys', summary.keys], ['Scrap', summary.scrap],
    summary.soloDebrief && ['Solo victories', summary.soloDebrief.victories],
    summary.soloDebrief && ['Solo deaths', summary.soloDebrief.deaths]
  ].filter(row => row && row[1] > 0.001);
  offlineSummary.innerHTML = `<p>Away for ${hours ? `${hours}h ` : ''}${minutes}m${summary.capped ? ` (${offlineMaxSeconds() / 3600}h cap reached)` : ''}.</p>${rows.length ? rows.map(([name, amount]) => `<div><span>${name}</span><strong>+${Number(amount).toFixed(1)}</strong></div>`).join('') : '<p>No active skills produced resources.</p>'}${summary.soloDebrief ? `<p class="small">Solo debrief saved · ${summary.soloDebrief.keptDropCount} kept drops · ${summary.soloDebrief.filterSalvage + summary.soloDebrief.fullCacheSalvage} Salvage.</p>` : ''}`;
  offlineModal.style.display = 'flex';
  logActivity(`Offline progress: ${hours ? `${hours}h ` : ''}${minutes}m processed`, 'offline');
}

function fishingRateMult(skillId) { return skillId === 'Fishing' && fishingBuffSecs > 0 ? 1.5 : 1; }

function validateLoadedTalents(ids) {
  return SKILL_TREE_RULES.normalizeNodeIds(COMBAT_SKILL_TREE, ids, earnedCombatTalentPoints());
}

function canSelectTalent(talent) {
  return SKILL_TREE_RULES.canAllocate(
    COMBAT_SKILL_TREE,
    SKILL_TREE_RULES.createState(COMBAT_SKILL_TREE, [...ownedCombatTalents], combatSkillTreeView),
    talent.id,
    availableCombatTalentPoints()
  );
}

function renderTalents() {
  const state = SKILL_TREE_RULES.createState(COMBAT_SKILL_TREE, [...ownedCombatTalents], combatSkillTreeView);
  const earned = earnedCombatTalentPoints();
  const combatLevel = combatLevelForUI();
  const respecCost = COMBAT_DEVELOPMENT_FRAMEWORK.respecCost(ownedCombatTalents.size);
  talentPointSummary.innerHTML = `<span>Arena Discipline · Combat ${combatLevel}</span><strong>${availableCombatTalentPoints()} available</strong><span>${ownedCombatTalents.size}/${earned} spent</span><span>Build: ${combatBuildLabel()}</span><span>Respec: ${respecCost} Gold</span>`;
  const branchById = new Map(COMBAT_SKILL_TREE.branches.map(branch => [branch.id, branch]));
  const selectedNode = COMBAT_TALENTS.find(node => node.id === combatSkillTreeView.focusNodeId) || COMBAT_TALENTS.find(node => node.id === COMBAT_SKILL_TREE.rootNodeIds[0]);
  const selectedStatus = selectedNode ? canSelectTalent(selectedNode) : { allowed:false, reason:'Select a node' };
  const selectedOwned = selectedNode ? ownedCombatTalents.has(selectedNode.id) : false;
  const selectedBranch = selectedNode ? branchById.get(selectedNode.branch) : null;
  const nodeMarkup = node => {
    const branch = branchById.get(node.branch);
    const owned = ownedCombatTalents.has(node.id);
    const allocation = canSelectTalent(node);
    const status = owned ? 'owned' : allocation.allowed ? 'available' : 'locked';
    const dimmed = combatSkillTreeView.activeBranch && combatSkillTreeView.activeBranch !== node.branch;
    const icon = node.icon ? iconMarkup(node.icon.sheet, node.icon.key, 'skill-tree-node-icon') || `<span class="skill-tree-node-icon-fallback" aria-hidden="true">${node.icon.fallback}</span>` : '';
    return `<button type="button" class="skill-tree-node is-${status}${node.capstone ? ' is-capstone' : ''}${dimmed ? ' is-dimmed' : ''}" data-tree-node="${node.id}" aria-pressed="${owned}" aria-label="${node.name}, ${owned ? 'owned' : allocation.reason}" style="--node-x:${node.position.x / COMBAT_SKILL_TREE.viewBox.width * 100}%;--node-y:${node.position.y / COMBAT_SKILL_TREE.viewBox.height * 100}%;--branch-color:${branch.color}"><span class="skill-tree-node-icon-wrap">${icon}</span><span class="skill-tree-node-tier">${node.capstone ? 'CAPSTONE' : `TIER ${node.tier}`}</span><strong>${node.name}</strong><em>${owned ? 'Owned' : allocation.reason}</em></button>`;
  };
  const edgeMarkup = COMBAT_SKILL_TREE.edges.map(connection => {
    const from = COMBAT_TALENTS.find(node => node.id === connection.from);
    const to = COMBAT_TALENTS.find(node => node.id === connection.to);
    if (!from || !to) return '';
    const fromOwned = ownedCombatTalents.has(from.id);
    const toOwned = ownedCombatTalents.has(to.id);
    const toAvailable = canSelectTalent(to).allowed;
    const status = fromOwned && toOwned ? 'owned' : toAvailable || fromOwned ? 'available' : 'locked';
    const dimmed = combatSkillTreeView.activeBranch && combatSkillTreeView.activeBranch !== to.branch;
    return `<line class="skill-tree-edge is-${status}${dimmed ? ' is-dimmed' : ''}" data-edge="${connection.id}" x1="${from.position.x}" y1="${from.position.y}" x2="${to.position.x}" y2="${to.position.y}" />`;
  }).join('');
  talentBranches.innerHTML = `<div class="skill-tree-layout">
    <aside class="skill-tree-branch-rail" aria-label="Combat branches">
      <div class="eyebrow">BRANCH FOCUS</div>
      <button type="button" class="skill-tree-branch-filter${combatSkillTreeView.activeBranch ? '' : ' is-active'}" data-tree-branch="all"><span>All branches</span><em>${COMBAT_TALENTS.length} nodes</em></button>
      ${COMBAT_SKILL_TREE.branches.map(branch => `<button type="button" class="skill-tree-branch-filter${combatSkillTreeView.activeBranch === branch.id ? ' is-active' : ''}" data-tree-branch="${branch.id}" style="--branch-color:${branch.color}"><span>${branch.name}</span><em>${SKILL_TREE_RULES.branchProgress(COMBAT_SKILL_TREE, state, branch.id).owned}/${SKILL_TREE_RULES.branchProgress(COMBAT_SKILL_TREE, state, branch.id).total} owned</em></button>`).join('')}
      <p class="skill-tree-branch-note">Choose a root, then commit to one technique fork per branch. Only one capstone can be active overall.</p>
    </aside>
    <section class="skill-tree-graph-column">
      <div class="skill-tree-toolbar" role="toolbar" aria-label="Skill tree view controls">
        <button type="button" class="btn btn-small" data-tree-control="zoom-out" aria-label="Zoom out">−</button>
        <span class="skill-tree-zoom-label" data-tree-zoom>${Math.round(combatSkillTreeView.zoom * 100)}%</span>
        <button type="button" class="btn btn-small" data-tree-control="zoom-in" aria-label="Zoom in">+</button>
        <button type="button" class="btn btn-small btn-quiet" data-tree-control="fit">Fit to view</button>
        <button type="button" class="btn btn-small btn-quiet" data-tree-control="reset-view">Reset view</button>
      </div>
      <div id="talentTreeViewport" class="skill-tree-viewport" tabindex="0" aria-label="Combat skill tree graph. Drag to pan and use the wheel to zoom.">
        <div id="talentTreeStage" class="skill-tree-stage" style="width:${COMBAT_SKILL_TREE.viewBox.width}px;height:${COMBAT_SKILL_TREE.viewBox.height}px;transform:translate(${combatSkillTreeView.panX}px,${combatSkillTreeView.panY}px) scale(${combatSkillTreeView.zoom})">
          <svg class="skill-tree-edges" viewBox="0 0 ${COMBAT_SKILL_TREE.viewBox.width} ${COMBAT_SKILL_TREE.viewBox.height}" aria-hidden="true">${edgeMarkup}</svg>
          <div class="skill-tree-nodes">${COMBAT_TALENTS.map(nodeMarkup).join('')}</div>
        </div>
      </div>
      <p class="skill-tree-graph-hint">Gold paths are owned progress. Cyan paths are reachable. Drag the graph or use the controls to survey the tree.</p>
    </section>
    <aside class="skill-tree-details" id="talentNodeDetails" aria-live="polite">
      <div class="eyebrow">NODE DETAIL</div>
      ${selectedNode ? `<div class="skill-tree-detail-icon" style="--branch-color:${selectedBranch.color}">${selectedNode.icon?.fallback || '◆'}</div><span class="skill-tree-detail-branch" style="color:${selectedBranch.color}">${selectedBranch.name} · ${selectedNode.capstone ? 'CAPSTONE' : `TIER ${selectedNode.tier}`}</span><h3>${selectedNode.name}</h3><p>${selectedNode.description}</p><div class="skill-tree-detail-rule">${selectedNode.requires.length ? `Requires: ${selectedNode.requires.map(id => COMBAT_TALENTS.find(node => node.id === id)?.name || id).join(' · ')}` : 'Root node · no prerequisite'}</div><button type="button" class="btn skill-tree-acquire" data-tree-acquire="${selectedNode.id}" ${selectedOwned || !selectedStatus.allowed ? 'disabled' : ''}>${selectedOwned ? 'Owned' : selectedStatus.allowed ? 'Spend 1 Combat Point' : selectedStatus.reason}</button>` : '<p>Select a node to inspect it.</p>'}
    </aside>
  </div>`;

  const viewport = talentBranches.querySelector('#talentTreeViewport');
  const stage = talentBranches.querySelector('#talentTreeStage');
  const applyTransform = () => { stage.style.transform = `translate(${combatSkillTreeView.panX}px,${combatSkillTreeView.panY}px) scale(${combatSkillTreeView.zoom})`; };
  const setView = patch => { combatSkillTreeView = { ...combatSkillTreeView, ...patch }; applyTransform(); };
  talentBranches.querySelectorAll('[data-tree-node]').forEach(button => button.addEventListener('click', () => {
    combatSkillTreeView = { ...combatSkillTreeView, focusNodeId: button.dataset.treeNode };
    saveGame();
    renderTalents();
  }));
  talentBranches.querySelector('[data-tree-acquire]')?.addEventListener('click', event => {
    if (window.MomentumArena.isRunning()) return;
    const node = COMBAT_TALENTS.find(candidate => candidate.id === event.currentTarget.dataset.treeAcquire);
    if (!node) return;
    const allocation = SKILL_TREE_RULES.allocate(COMBAT_SKILL_TREE, state, node.id, availableCombatTalentPoints());
    if (!allocation.accepted) return;
    ownedCombatTalents.add(node.id);
    combatSkillTreeView = allocation.state.view;
    logActivity(`Selected talent: ${node.name}`, 'talent');
    saveGame();
    renderTalents();
  });
  talentBranches.querySelectorAll('[data-tree-branch]').forEach(button => button.addEventListener('click', () => {
    const branch = button.dataset.treeBranch === 'all' ? null : button.dataset.treeBranch;
    combatSkillTreeView = { ...combatSkillTreeView, activeBranch: branch };
    saveGame();
    renderTalents();
    const target = branch ? COMBAT_TALENTS.find(node => node.branch === branch) : null;
    if (target && viewport) {
      const nextScrollLeft = Math.max(0, target.position.x * combatSkillTreeView.zoom - viewport.clientWidth / 2);
      viewport.scrollLeft = nextScrollLeft;
    }
  }));
  talentBranches.querySelectorAll('[data-tree-control]').forEach(button => button.addEventListener('click', () => {
    const control = button.dataset.treeControl;
    if (control === 'zoom-in') setView({ zoom: Math.min(1.45, combatSkillTreeView.zoom + 0.1) });
    if (control === 'zoom-out') setView({ zoom: Math.max(0.55, combatSkillTreeView.zoom - 0.1) });
    if (control === 'fit') {
      const fitWidth = Math.max(0.55, Math.min(1.45, (viewport.clientWidth - 24) / COMBAT_SKILL_TREE.viewBox.width));
      const fitHeight = Math.max(0.55, Math.min(1.45, (viewport.clientHeight - 24) / COMBAT_SKILL_TREE.viewBox.height));
      combatSkillTreeView = { ...combatSkillTreeView, zoom:Math.min(fitWidth, fitHeight), panX:0, panY:0 };
      renderTalents();
    }
    if (control === 'reset-view') { combatSkillTreeView = { ...combatSkillTreeView, zoom:1, panX:0, panY:0, activeBranch:null }; renderTalents(); }
    saveGame();
  }));
  let drag = null;
  viewport?.addEventListener('pointerdown', event => {
    if (event.target.closest('button')) return;
    drag = { x:event.clientX, y:event.clientY, panX:combatSkillTreeView.panX, panY:combatSkillTreeView.panY };
    viewport.setPointerCapture(event.pointerId);
  });
  viewport?.addEventListener('pointermove', event => {
    if (!drag) return;
    setView({ panX:drag.panX + event.clientX - drag.x, panY:drag.panY + event.clientY - drag.y });
  });
  viewport?.addEventListener('pointerup', () => { if (drag) saveGame(); drag = null; });
  viewport?.addEventListener('pointercancel', () => { drag = null; });
  viewport?.addEventListener('wheel', event => {
    event.preventDefault();
    setView({ zoom: Math.max(0.55, Math.min(1.45, combatSkillTreeView.zoom + (event.deltaY < 0 ? 0.08 : -0.08))) });
  }, { passive:false });
  refundTalentsBtn.disabled = ownedCombatTalents.size === 0 || window.MomentumArena.isRunning();
  refundTalentsBtn.textContent = ownedCombatTalents.size ? `Respec · ${COMBAT_DEVELOPMENT_FRAMEWORK.respecCost(ownedCombatTalents.size)} Gold` : 'No points allocated';
}

function renderFrontier() {
  const unlocked = frontierUnlocked();
  const stars = masteryStars();
  frontierSummary.textContent = unlocked ? `${stars}/6 Mastery Stars · Boss Keys ${Math.floor(keys)} · ${stars >= 6 ? 'Gauntlet unlocked' : 'Complete Directives to advance'}` : 'Defeat Apex to unlock authored combat Directives.';
  document.getElementById('openFrontierBtn').disabled = !unlocked;
  document.getElementById('openFrontierBtn').textContent = unlocked ? `Open Frontier (${stars}/6 Stars)` : 'Frontier Locked';
  if (!unlocked) return;

  masteryProgress.innerHTML = `<strong>${stars}/6 Mastery Stars</strong><span class="mastery-track"><i style="width:${stars / 6 * 100}%"></i></span><span>2★ Presets · 4★ Field Kitchen · 6★ Gauntlet</span>`;
  directiveList.innerHTML = FRONTIER_DIRECTIVES.map(directive => {
    const complete = completedDirectives.has(directive.id);
    const record = directiveRecords[directive.id];
    const keyCost = frontierEntryCost(directive.tierId);
    const keyStatus = frontierKeyStatus(keyCost);
    const canAfford = Math.floor(keys) >= keyCost;
    return `<article class="directive-card${complete ? ' is-complete' : ''}${canAfford ? '' : ' is-key-locked'}"><div class="directive-tier">${ARENA_TIERS[directive.tierId - 1].name}</div><h3>${directive.name}</h3><p>${directive.description}</p><div class="directive-cost"><strong>Entry</strong><span>${keyCost} Boss Keys</span></div><div class="small">${complete ? '★ Complete' : '☆ Mastery Star available'} · ${keyStatus}${record?.bestTime ? ` · Best ${formatRunTime(record.bestTime)}` : ''}</div><button class="btn" data-directive="${directive.id}">${canAfford ? 'Prepare Directive' : `Need ${keyCost} Keys`}</button></article>`;
  }).join('');
  directiveList.querySelectorAll('[data-directive]').forEach(button => button.onclick = () => {
    const directive = FRONTIER_DIRECTIVES.find(candidate => candidate.id === button.dataset.directive);
    if (!directive) return;
    const keyCost = frontierEntryCost(directive.tierId);
    if (Math.floor(keys) < keyCost) {
      showToast(`Not enough Boss Keys for ${directive.name}: ${keyCost} required, ${Math.floor(keys)} available. You need ${keyCost - Math.floor(keys)} more.`, 4200);
      return;
    }
    selectedDirective = directive.id;
    selectedArenaTier = directive.tierId;
    renderArenaTierOptions();
    frontierModal.style.display = 'none';
    openArenaPreparation();
  });

  const cache = canonicalLootCache();
  presetList.innerHTML = combatPresets.map((preset, index) => `<div class="preset-card"><div><strong>Preset ${index + 1}</strong><div class="small">${preset ? `${preset.styleId} · ${preset.talents.length} talents · ${ITEMS[preset.foodId]?.name || 'No Food'}` : 'Empty slot'}</div></div><select class="btn" data-preset-style="${index}"><option value="gun" ${cache.equipment.gun ? '' : 'disabled'}>Gun</option><option value="melee" ${cache.equipment.melee ? '' : 'disabled'}>Melee</option><option value="ranged" ${cache.equipment.ranged ? '' : 'disabled'}>Ranged</option><option value="magic" ${cache.equipment.magic ? '' : 'disabled'}>Magic</option></select><button class="btn" data-save-preset="${index}">Save Current</button><button class="btn" data-apply-preset="${index}" ${preset ? '' : 'disabled'}>Apply</button></div>`).join('');
  presetList.querySelectorAll('[data-save-preset]').forEach(button => button.onclick = () => {
    const index = Number(button.dataset.savePreset);
    const styleId = presetList.querySelector(`[data-preset-style="${index}"]`).value;
    const itemId = cache.equipment[styleId];
    if (!itemId) { showToast(`No ${styleId} weapon equipped`); return; }
    combatPresets[index] = { styleId, itemId, armorId:cache.equipment.chest, foodId:cache.foodId, talents:[...ownedCombatTalents] };
    logActivity(`Saved Combat Preset ${index + 1}`, 'frontier');
    renderFrontier();
  });
  presetList.querySelectorAll('[data-apply-preset]').forEach(button => button.onclick = () => applyCombatPreset(Number(button.dataset.applyPreset)));
  presetList.classList.toggle('is-locked', stars < 2);
  presetList.querySelectorAll('button,select').forEach(control => { if (stars < 2) control.disabled = true; });

  kitchenList.innerHTML = `<article><strong>Smoked Ration</strong><span>3 Cooked Fish · ${smokedRations} owned</span><span>15 HP now, then 20 over 5s</span><button class="btn" data-cook="smokedRation">Craft</button></article><article><strong>Surgefin Ration</strong><span>1 Uncommon Fish + 2 Bars · ${surgefinRations} owned</span><span>15 HP and reset Dash</span><button class="btn" data-cook="surgefinRation">Craft</button></article>`;
  kitchenList.querySelectorAll('[data-cook]').forEach(button => button.onclick = () => craftFood(button.dataset.cook));
  kitchenList.classList.toggle('is-locked', stars < 4);
  kitchenList.querySelectorAll('button').forEach(button => { if (stars < 4) button.disabled = true; });

  const gauntletCost = ARENA_TIERS.reduce((sum, tier) => sum + tier.keyCost, 0);
  const enoughGauntletKeys = Math.floor(keys) >= gauntletCost;
  startGauntletBtn.disabled = stars < 6 || !enoughGauntletKeys;
  startGauntletBtn.textContent = stars < 6 ? 'Locked — 6 Stars' : enoughGauntletKeys ? `Prepare Gauntlet (${gauntletCost} Keys)` : `Need ${gauntletCost} Keys · ${gauntletCost - Math.floor(keys)} more`;
}

function applyCombatPreset(index) {
  if (masteryStars() < 2 || window.MomentumArena.isRunning()) return;
  const preset = combatPresets[index];
  if (!preset) return;
  const cache = canonicalLootCache();
  if (!cache.items.some(item => item.instanceId === preset.itemId)) { showToast('Preset weapon is no longer available'); return; }
  if (preset.armorId && !cache.items.some(item => item.instanceId === preset.armorId)) { showToast('Preset armor is no longer available'); return; }
  if (preset.foodId && foodCount(preset.foodId) < 1) { showToast(`No ${ITEMS[preset.foodId]?.name || 'preset Food'} available`); return; }
  const validTalents = validateLoadedTalents(preset.talents);
  ownedCombatTalents.clear(); validTalents.forEach(id => ownedCombatTalents.add(id));
  setCanonicalLootCache({
    ...cache,
    foodId:preset.foodId || null,
    equipment:{ ...cache.equipment, [preset.styleId]:preset.itemId, chest:preset.armorId || null, activeWeaponSlot:preset.styleId }
  });
  selectedArenaStyle = preset.styleId;
  renderLoadout();
  logActivity(`Applied Combat Preset ${index + 1}`, 'frontier');
  showToast(`Preset ${index + 1} applied`);
}

function craftFood(id) {
  if (masteryStars() < 4) return;
  const fishing = skills.find(skill => skill.id === 'Fishing');
  const smithing = skills.find(skill => skill.id === 'Smithing');
  if (id === 'smokedRation') {
    if (!{ met:skills.find(skill => skill.id === 'Cooking').qty >= 3 }.met) { showToast('Requires 3 Cooked Fish'); return; }
    skills.find(skill => skill.id === 'Cooking').qty -= 3; smokedRations += 1;
  } else {
    const requirements = evaluateRequirements([{type:'resource',resource:'Uncommon Fish',value:1},{type:'resource',resource:'Bars',value:2}]);
    if (!requirements.met) { showToast(`Requires ${requirements.missing.join(' · ')}`); return; }
    uncommonFish -= 1; smithing.qty -= 2; surgefinRations += 1;
  }
  logActivity(`Crafted ${ITEMS[id].name}`, 'craft');
  renderFrontier();
}

function renderSpecializations() {
  specList.innerHTML = Object.entries(SPECIALIZATIONS).map(([skillId, choices]) => {
    const skill = skills.find(candidate => candidate.id === skillId);
    const locked = skill.lvl < 15;
    return `<section class="spec-skill"><h3>${skillId} <span>Level ${skill.lvl}</span></h3>${Object.entries(choices).map(([id, choice]) => `<button class="spec-choice${skillSpecializations[skillId] === id ? ' is-selected' : ''}" data-spec-skill="${skillId}" data-spec="${id}" ${locked ? 'disabled' : ''}><strong>${choice.name}</strong><span>${choice.description}</span><em>${locked ? `Unlocks at ${skillId} 15` : skillSpecializations[skillId] === id ? 'Selected' : 'Select'}</em></button>`).join('')}</section>`;
  }).join('');
  specList.querySelectorAll('[data-spec]').forEach(button => button.onclick = () => {
    const skillId = button.dataset.specSkill;
    skillSpecializations[skillId] = button.dataset.spec;
    logActivity(`${skillId} specialized into ${SPECIALIZATIONS[skillId][button.dataset.spec].name}`, 'specialization');
    renderSpecializations();
  });
}

function reduceMotionEnabled() {
  return gameSettings.reduceMotion || Boolean(window.matchMedia?.('(prefers-reduced-motion: reduce)').matches);
}

function applySettings() {
  muteAudio.checked = gameSettings.muted;
  audioVolume.value = gameSettings.volume;
  reduceMotion.checked = gameSettings.reduceMotion;
  document.body.classList.toggle('reduce-motion', reduceMotionEnabled());
  window.MomentumAudio.configure(gameSettings);
}

function currentArenaTier() { return ARENA_TIERS[selectedArenaTier - 1]; }
function arenaTierAvailable(tier, includeCost = false) {
  const requirements = includeCost ? tier.requirements : tier.requirements.filter(requirement => requirement.type !== 'resource');
  return evaluateRequirements(requirements).met;
}
function renderArenaTierOptions() {
  arenaTierSelect.innerHTML = ARENA_TIERS.map(tier => {
    const requirementState = evaluateRequirements(tier.requirements.filter(requirement => requirement.type !== 'resource'));
    return `<option value="${tier.id}" ${requirementState.met ? '' : 'disabled'}>${tier.name}${requirementState.met ? '' : ` — ${requirementState.missing.join(' · ')}`}</option>`;
  }).join('');
  if (!arenaTierAvailable(currentArenaTier())) selectedArenaTier = ARENA_TIERS.find(tier => arenaTierAvailable(tier))?.id || 1;
  arenaTierSelect.value = selectedArenaTier;
  updateArenaTierUI();
}
function updateArenaTierUI() {
  const tier = currentArenaTier();
  const requirementState = evaluateRequirements(tier.requirements);
  arenaTierDetails.textContent = `${tier.bossHp} Boss HP · Solo Stage ${tier.requiredSoloStage} · ${tier.attackLabel} · ${tier.oreGain} Ore · ${Math.round(tier.gemChance * 100)}% Gem · Wins ${arenaWins[tier.id - 1]}`;
  fightBtn.textContent = requirementState.met ? `Prepare Arena Run (${tier.keyCost} Keys)` : `Requires ${requirementState.missing.join(' · ')}`;
  fightBtn.disabled = !requirementState.met;
}

let preparedArenaTier = null;

function arenaStyleState(style) {
  const cache = soloDeskState()?.lootCache;
  const cachedInstanceId = cache?.equipment?.[style.slot];
  const cachedInstance = cache?.items?.find(instance => instance.instanceId === cachedInstanceId);
  const cachedInspection = cachedInstance ? LOOT_FRAMEWORK?.inspectItem(cachedInstance) : null;
  const itemId = cachedInspection ? cachedInstance.instanceId : null;
  const weapon = cachedInspection ? materializeLootItem(cachedInstance) : null;
  if (!weapon) return { style, weapon:null, available:false, status:'Empty slot' };
  if (weapon.unavailable) return { style, weapon, available:false, status:'Unavailable' };
  if (!style.implemented) return { style, weapon, available:false, status:'Combat support coming next' };
  return { style, weapon, available:true, status:'Available' };
}

function arenaEnemyForTier(tier) {
  return {
    id: `arena:tier-${tier.id}`,
    name: tier.name,
    kind: 'boss',
    hitPoints: tier.bossHp,
    damage: tier.contactDps,
    armour: 8 + tier.id * 8,
    ward: 6 + tier.id * 7,
    evasion: 5 + tier.id * 3,
    accuracy: 10 + tier.id * 6,
    attackInterval: Math.max(0.9, tier.waveCooldown / 2),
    damageType: 'physical'
  };
}

function arenaCombatStyle(styleId, weapon) {
  if (styleId === 'melee') {
    return weapon.weight === 'light' ? 'light-melee' : weapon.weight === 'heavy' ? 'heavy-melee' : 'medium-melee';
  }
  return styleId;
}

function arenaEquippedStats() {
  const cache = soloDeskState()?.lootCache;
  const snapshot = cache && LOOT_FRAMEWORK?.calculateEquippedStats?.(cache.equipment, cache.items || []);
  const activeInstance = snapshot?.activeWeaponSlot && cache?.equipment?.[snapshot.activeWeaponSlot]
    ? cache.items?.find(instance => instance.instanceId === cache.equipment[snapshot.activeWeaponSlot])
    : null;
  const activeStats = activeInstance ? LOOT_FRAMEWORK?.inspectItem(activeInstance)?.stats || {} : {};
  const stats = Object.fromEntries(Object.entries(snapshot?.stats || {}).map(([key, value]) => [key, Math.max(0, Number(value || 0) - Number(activeStats[key] || 0))]));
  const armourPieces = [...(snapshot?.armourPieces || [])];
  return {
    hitPoints: Number(stats.hp || 0),
    accuracy: Number(stats.accuracy || 0),
    evasion: Number(stats.evasion || 0),
    ward: Number(stats.ward || 0),
    armourPieces,
    criticalChanceBonus: Number(stats.critChance || 0) / 100,
    criticalMultiplierBonus: 0
  };
}

function captureArenaWeapon(state) {
  const { style, weapon } = state;
  const damage = weaponDamage(weapon);
  return Object.freeze({
    styleId: style.id,
    itemId: weapon.id,
    name: weapon.name,
    style: arenaCombatStyle(style.id, weapon),
    damage,
    accuracy: weapon.accuracy || 0,
    damageType: style.id === 'magic' ? 'magical' : 'physical',
    attackInterval: weapon.attackInterval,
    playstyle: style.playstyle,
    projectileSpeed: weapon.projectileSpeed,
    lifetime: weapon.lifetime,
    range: weapon.range,
    swingArcDeg: weapon.swingArcDeg,
    trait: weapon.trait,
    bossDamage: weapon.bossDamage || 0,
    critChance: weapon.critChance || 0
  });
}

function buildArenaCombatBuild(tier, runLoadout) {
  const enemy = arenaEnemyForTier(tier);
  const technique = runLoadout.style === 'magic' ? 'Arc Bolt' : runLoadout.style === 'gun' ? 'Burst Fire' : runLoadout.style === 'ranged' ? 'Piercing Shot' : 'Power Strike';
  const development = soloDeskState().combatDevelopment;
  return {
    combatSkills: COMBAT_PROGRESSION_FRAMEWORK.compatibility.progressionLevelMap(combatProgression),
    equippedStats: arenaEquippedStats(),
    activeWeapon: {
      id: runLoadout.itemId,
      name: runLoadout.name,
      style: runLoadout.style,
      damage: runLoadout.damage,
      accuracy: runLoadout.accuracy,
      attackInterval: runLoadout.attackInterval,
      damageType: runLoadout.damageType
    },
    stance: soloDeskStance,
    technique,
    defensiveAbility: soloDeskDefensiveAbility,
    aura: soloDeskAura,
    enemy,
    stage: tier.id * 10,
    seed: `arena:${tier.id}:${Date.now()}`,
    combatModifiers:COMBAT_DEVELOPMENT_FRAMEWORK.resolveModifiers(development, combatProgression, {
      style:runLoadout.style,
      technique,
      stance:soloDeskStance,
      boss:true,
      enemyWarded:enemy.ward > 0,
      playerHealthRatio:1,
      enemyHealthRatio:1,
      baseInterval:runLoadout.attackInterval
    })
  };
}

function renderArenaPreparation() {
  const tier = preparedArenaTier;
  if (!tier) return;
  const states = ARENA_STYLES.map(arenaStyleState);
  const selectedState = states.find(state => state.style.id === selectedArenaStyle && state.available);
  if (!selectedState) selectedArenaStyle = null;

  const directive = FRONTIER_DIRECTIVES.find(candidate => candidate.id === selectedDirective && candidate.tierId === tier.id);
  arenaPrepTierSummary.innerHTML = `<strong>${activeGauntlet ? 'Frontier Gauntlet' : `${tier.name} Arena`}</strong><span>${activeGauntlet ? ARENA_TIERS.reduce((sum, item) => sum + item.keyCost, 0) : tier.keyCost} Boss Keys</span><span>${activeGauntlet ? '3 bosses' : `${tier.bossHp} Boss HP`}</span>`;
  arenaDirectiveBanner.textContent = worldActiveActivity?.kind === 'arena'
    ? 'Frontier finale: this Arena run advances the active adventure route.'
    : activeGauntlet
      ? 'Gauntlet: HP, Food, and once-per-run talents persist across all three bosses.'
      : directive ? `Directive: ${directive.name} — ${directive.description}` : 'Standard run · no Directive';
  arenaStyleCards.innerHTML = states.map(state => {
    const selected = state.style.id === selectedArenaStyle;
    return `<button class="arena-style-card${selected ? ' is-selected' : ''}" data-arena-style="${state.style.id}" aria-pressed="${selected}" ${state.available ? '' : 'disabled'}><span class="arena-style-name">${state.style.name}</span><strong>${state.weapon?.name || 'Empty'}</strong><span class="small">${state.status}</span></button>`;
  }).join('');

  arenaStyleCards.querySelectorAll('[data-arena-style]').forEach(card => {
    card.onclick = () => {
      selectedArenaStyle = card.dataset.arenaStyle;
      renderArenaPreparation();
    };
  });

  if (selectedState) {
    const weapon = captureArenaWeapon(selectedState);
    const rangeStat = weapon.styleId === 'melee' ? `<span><small>Reach</small><strong>${weapon.range}px</strong></span>` : '';
    arenaWeaponPreview.innerHTML = `<div class="eyebrow">SELECTED WEAPON</div><h3>${weapon.name}</h3><div class="arena-weapon-stats"><span><small>Damage</small><strong>${weapon.damage}</strong></span><span><small>Interval</small><strong>${weapon.attackInterval}s</strong></span><span><small>Style</small><strong>${selectedState.style.name}</strong></span>${rangeStat}</div><p class="small">${weapon.playstyle}</p><p class="weapon-trait">${ITEMS[weapon.itemId].trait || ''}</p>`;
  } else {
    arenaWeaponPreview.innerHTML = '<div class="small">Select an available combat style to review its weapon.</div>';
  }

  const canAffordRun = Math.floor(keys) >= tier.keyCost;
  confirmArenaRun.disabled = !selectedState || !canAffordRun;
  arenaPrepStatus.textContent = canAffordRun
    ? 'Boss Keys are spent only when you confirm the run.'
    : `Need ${tier.keyCost} Boss Keys to start this run.`;
}

function openArenaPreparation() {
  const tier = currentArenaTier();
  if (!arenaTierAvailable(tier)) {
    showToast(`Requirements not met: ${evaluateRequirements(tier.requirements.filter(requirement => requirement.type !== 'resource')).missing.join(' · ')}`, 4200);
    return;
  }
  if (Math.floor(keys) < tier.keyCost) {
    showToast(`Not enough Boss Keys for ${tier.name}: ${tier.keyCost} required, ${Math.floor(keys)} available. You need ${tier.keyCost - Math.floor(keys)} more.`, 4200);
    return;
  }
  preparedArenaTier = tier;
  if (!ARENA_STYLES.map(arenaStyleState).some(state => state.style.id === selectedArenaStyle && state.available)) selectedArenaStyle = null;
  renderArenaPreparation();
  arenaPrepModal.style.display = 'flex';
}

function closeArenaPreparation() {
  arenaPrepModal.style.display = 'none';
  preparedArenaTier = null;
  selectedArenaStyle = null;
  if (!window.MomentumArena.isRunning()) activeGauntlet = null;
  selectedDirective = null;
  if (worldActiveActivity?.kind === 'arena') worldCancelEncounter();
}

function startPreparedArenaRun() {
  const tier = preparedArenaTier;
  const state = ARENA_STYLES.map(arenaStyleState).find(candidate => candidate.style.id === selectedArenaStyle && candidate.available);
  if (!tier || !state) return;
  const gauntlet = Boolean(activeGauntlet?.preparing);
  const cost = gauntlet ? ARENA_TIERS.reduce((sum, item) => sum + item.keyCost, 0) : tier.keyCost;
  if (Math.floor(keys) < cost) { renderArenaPreparation(); return; }

  const runLoadout = captureArenaWeapon(state);
  const combatBuild = buildArenaCombatBuild(tier, runLoadout);
  keys -= cost;
  arenaPrepModal.style.display = 'none';
  preparedArenaTier = null;
  selectedArenaStyle = null;
  updateArenaTierUI();

  if (gauntlet) {
    activeGauntlet = {
      bossIndex:0, loadout:runLoadout, carryState:null, phaseResults:[], skillEvents:[], bankedRewards:[],
      startedAt:performance.now(), awaitingNext:false
    };
    selectedDirective = null;
    openArena(ARENA_TIERS[0], runLoadout, { mode:'gauntlet', combatBuild:buildArenaCombatBuild(ARENA_TIERS[0], runLoadout) });
  } else {
    const directive = FRONTIER_DIRECTIVES.find(candidate => candidate.id === selectedDirective && candidate.tierId === tier.id);
    openArena(tier, runLoadout, { mode:directive ? 'directive' : 'standard', directiveId:directive?.id || null, worldEncounterId:worldActiveActivity?.encounterId || null, combatBuild });
  }
}
function renderGear() {
  gearList.innerHTML = '';
  const smithing = skills.find(s => s.id === 'Smithing');
  const crafting = skills.find(s => s.id === 'Crafting');
  GEAR.forEach(item => {
    const owned = ownedGear.has(item.id);
    const combatInstance = LEGACY_COMBAT_DEFINITION_IDS[item.id]
      ? canonicalLootCache().items.find(instance => instance.definitionId === LEGACY_COMBAT_DEFINITION_IDS[item.id] && ['legacy-equipment','workshop'].includes(instance.sourceId))
      : null;
    const canonicalSlot = item.slot === 'armor' ? 'chest' : item.slot;
    const equipped = item.slot === 'tool'
      ? equipment.tool === item.id
      : Boolean(combatInstance && canonicalLootCache().equipment[canonicalSlot] === combatInstance.instanceId);
    const recipe = craftingRecipeFor(item.id);
    const requirementState = evaluateRequirements([...(item.requirements || []), ...recipeRequirements(recipe)]);
    const unlocked = requirementState.met;
    const row = document.createElement('div');
    row.className = 'workshop-row';
    const craftedVisual = combatInstance ? itemVisualMarkup(combatInstance, canonicalLootCache(), 'workshop-item-visual') : '';
    row.innerHTML = `<div class="workshop-item-heading">${craftedVisual}<div><strong>${item.name}</strong><div style="opacity:.9; margin:2px 0 6px">${item.desc}</div></div></div><div class="small recipe-preview">${recipe ? `${recipeInputLabel(recipe)} · Crafting ${recipe.requiredLevel}` : `Legacy cost: ${item.cost} Bars`}</div><div class="flex"><span>${owned ? 'Crafted' : unlocked ? 'Ready to assemble' : `Requires: ${requirementState.missing.join(' · ')}`}</span><button class="btn" ${equipped || (!owned && !unlocked) ? 'disabled' : ''}>${equipped ? 'Equipped' : owned ? 'Equip' : unlocked ? 'Assemble' : 'Locked'}</button></div>`;
    row.querySelector('button').onclick = () => {
      if (!ownedGear.has(item.id)) {
        const required = [...(item.requirements || []), ...recipeRequirements(recipe)];
        const state = evaluateRequirements(required);
        if (!state.met) { showToast(`Requires ${state.missing.join(' · ')}`); return; }
        if (recipe) payCraftingRecipe(recipe);
        else smithing.qty -= item.cost;
        ownedGear.add(item.id);
        if (item.slot === 'tool') ownedItems.add(item.id);
        showToast(`Crafted ${item.name}`);
        logActivity(`Crafted ${item.name}`, 'craft');
      }
      if (item.slot === 'tool') {
        equipment.tool = item.id;
        equippedTool = item.id;
      } else {
        const instance = ensureCanonicalCombatItem(item.id);
        equipCanonicalCombatItem(instance, canonicalSlot);
      }
      renderGear();
      renderLoadout();
    };
    gearList.appendChild(row);
  });

  const skillToolRecipes = (SKILL_FRAMEWORK?.craftingRecipes || []).filter(recipe => recipe.skillToolId);
  if (skillToolRecipes.length) gearList.insertAdjacentHTML('beforeend', '<h3>Skill Instruments</h3><div class="small workshop-note">Craft instruments to unlock new skills. Owned instruments stay in the skill-tool inventory and are selected from their skill card.</div>');
  skillToolRecipes.forEach(recipe => {
    const tool = getSkillToolDefinition(recipe.skillToolId);
    if (!tool) return;
    const owned = skillToolInventory.some(instance => instance.toolId === tool.id);
    const requirementState = evaluateRequirements(recipeRequirements(recipe));
    const unlocked = requirementState.met;
    const row = document.createElement('div');
    row.className = 'workshop-row skill-tool-row';
    row.innerHTML = `<div style="font-weight:600">${tool.name}</div><div style="opacity:.9; margin:2px 0 6px">${tool.description}</div><div class="small recipe-preview">${recipeInputLabel(recipe)} · Music ${tool.xpMultiplier.toFixed(1)}× XP</div><div class="flex"><span>${owned ? 'Owned' : unlocked ? 'Ready to craft' : `Requires: ${requirementState.missing.join(' · ')}`}</span><button class="btn" ${owned || !unlocked ? 'disabled' : ''}>${owned ? 'Owned' : unlocked ? 'Craft' : 'Locked'}</button></div>`;
    row.querySelector('button').onclick = () => {
      if (owned) return;
      if (!payCraftingRecipe(recipe)) { showToast(`Requires ${requirementState.missing.join(' · ')}`); return; }
      addSkillTool(tool.id);
      showToast(`${tool.name} crafted · Music unlocked`);
      logActivity(`Crafted ${tool.name} · Music tool`, 'craft');
      renderSkills();
      renderGear();
      renderLoadout();
      saveGame();
    };
    gearList.appendChild(row);
  });

  const refinable = ['pulseSidearm', 'ironBlade'].filter(id => canonicalLootCache().items.some(instance => instance.definitionId === LEGACY_COMBAT_DEFINITION_IDS[id]));
  if (refinable.length) gearList.insertAdjacentHTML('beforeend', '<h3>Weapon Refinement</h3><div class="small">Spend existing Bars and Rare Gems for permanent +2 damage, up to +5.</div>');
  refinable.forEach(id => {
    const item = ITEMS[id];
    const definitionId = LEGACY_COMBAT_DEFINITION_IDS[id];
    const instance = canonicalLootCache().items.find(candidate => candidate.definitionId === definitionId && ['legacy-equipment','workshop'].includes(candidate.sourceId))
      || canonicalLootCache().items.find(candidate => candidate.definitionId === definitionId);
    const level = Math.max(0, Number(instance?.enhancementRank) || 0);
    const maxed = level >= MAX_WEAPON_REFINEMENT;
    const barCost = 25 * (level + 1);
    const row = document.createElement('div');
    row.className = 'workshop-row';
    row.innerHTML = `<div style="font-weight:600">${item.name} +${level}</div><div class="small">${Number(item.damage || 0) + level * 2} damage</div><div class="flex"><span>${maxed ? 'Maximum refinement' : `Cost: ${barCost} Bars, 1 Rare Gem`}</span><button class="btn" ${maxed ? 'disabled' : ''}>${maxed ? 'Maxed' : 'Refine'}</button></div>`;
    row.querySelector('button').onclick = () => {
      if (maxed) return;
      const refinementRequirements = evaluateRequirements([{type:'resource',resource:'Bars',value:barCost},{type:'resource',resource:'Rare Gems',value:1}]);
      if (!refinementRequirements.met) { showToast(`Requires ${refinementRequirements.missing.join(' · ')}`); return; }
      smithing.qty -= barCost;
      rareGems -= 1;
      const cache = canonicalLootCache();
      const nextRank = Math.min(MAX_WEAPON_REFINEMENT, level + 1);
      setCanonicalLootCache({ ...cache, items:cache.items.map(candidate => candidate.instanceId === instance.instanceId ? { ...candidate, enhancementRank:nextRank } : candidate) });
      showToast(`${item.name} refined to +${nextRank}`);
      logActivity(`${item.name} refined to +${nextRank}`, 'craft');
      renderGear();
      renderLoadout();
    };
    gearList.appendChild(row);
  });

  gearList.insertAdjacentHTML('afterbegin', `<div style="margin-bottom:10px">Bars: ${smithing.qty.toFixed(0)} · Components: ${crafting.qty.toFixed(0)} · Rare Gems: ${rareGems} · Tool: ${ITEMS[equipment.tool]?.name || 'None'}</div><div class="small workshop-note">Crafting assembles equipment from idle components. Select Crafting in the Skill Matrix to keep the workshop supplied.</div>`);
}

function itemStats(item) {
  if (!item) return 'No item equipped';
  if (item.slot === 'gun') return `${weaponDamage(item)} damage · ${item.attackInterval}s interval · ${(1 / item.attackInterval).toFixed(1)} shots/s · ${item.trait}`;
  if (item.slot === 'melee') return `${weaponDamage(item)} damage · ${item.attackInterval}s interval · ${item.range}px reach · ${item.swingArcDeg}° arc · ${item.trait}`;
  if (item.slot === 'armor') return `+${item.hp} maximum HP`;
  return item.detail || '';
}
function equipItem(itemId) {
  const item = ITEMS[itemId];
  if (!item || item.unavailable) return;
  if (item.slot === 'food' && foodCount(itemId) <= 0) return;
  if (item.slot === 'food') setCanonicalFoodId(itemId);
  else if (item.slot === 'tool') {
    if (!ownedItems.has(itemId)) return;
    equipment.tool = itemId;
    equippedTool = itemId;
  } else if (item.dynamicLoot) {
    const instance = canonicalLootCache().items.find(candidate => candidate.instanceId === itemId);
    if (!instance || !equipCanonicalCombatItem(instance)) return;
  } else {
    if (!ownedItems.has(itemId)) return;
    const instance = ensureCanonicalCombatItem(itemId);
    if (!equipCanonicalCombatItem(instance, item.slot === 'armor' ? 'chest' : item.slot)) return;
  }
  renderLoadout();
}

function renderLoadout() {
  if (!loadoutSlots) return;
  const cache = canonicalLootCache();
  if (loadoutBuildSummary) {
    loadoutBuildSummary.innerHTML = `<span class="eyebrow">ACTIVE BUILD</span><strong>${combatBuildLabel()}</strong><span class="small">Combat talents and equipped gear shape your expedition role.</span>`;
  }
  loadoutSlots.innerHTML = LOADOUT_SLOTS.map(slot => {
    const canonicalSlot = slot === 'chest' ? 'chest' : slot;
    const instance = ['tool','food'].includes(slot) ? null : canonicalEquippedInstance(canonicalSlot);
    const item = slot === 'tool'
      ? ITEMS[equipment.tool]
      : slot === 'food'
        ? ITEMS[canonicalFoodId()]
        : instance ? materializeLootItem(instance) : null;
    const visual = instance ? itemVisualMarkup(instance, cache, 'loadout-item-visual') : iconMarkup('loadout',slot,'slot-icon');
    return `<div class="loadout-slot ${item ? 'is-equipped' : 'is-empty'}">${visual}<div class="slot-copy"><div class="slot-name">${slot === 'magic' ? 'Magic Spell' : slot}</div><strong>${item?.name || 'Empty'}</strong><div class="small">${itemStats(item)}</div>${item ? `<button class="btn" data-unequip="${slot}">Unequip</button>` : ''}</div></div>`;
  }).join('');
  loadoutSlots.querySelectorAll('[data-unequip]').forEach(btn => btn.onclick = () => {
    const slot=btn.dataset.unequip;
    if (slot === 'tool') { equipment.tool=null; equippedTool=null; }
    else if (slot === 'food') setCanonicalFoodId(null);
    else unequipCanonicalSlot(slot);
    renderLoadout();
  });
  const fishing = skills.find(s=>s.id==='Fishing');
  const materials = [['Ore',skills[0].qty],['Bars',skills[1].qty],['Scrap',scrap],['Raw Fish',fishing.qty],['Cooked Fish',skills.find(skill=>skill.id==='Cooking').qty],['Burnt Fish',burntFish],['Pine Logs',woodInventory.pine],['Oak Logs',woodInventory.oak],['Yew Logs',woodInventory.yew],['Ancient Logs',woodInventory.ancient],['Basic Bait',basicBait],['Uncommon Fish',uncommonFish],['Rare Gems',rareGems]];
  const owned = [...ownedItems].map(id => ITEMS[id]).filter(Boolean);
  const foods = ['cookedFish','smokedRation','surgefinRation'].map(id => ITEMS[id]);
  inventoryList.innerHTML = `<div class="inventory-materials">${materials.map(([n,q])=>`<div>${resourceIconMarkup(n,'material-icon')}<span>${n}</span><strong>${Number(q).toFixed(0)}</strong></div>`).join('')}<div>${resourceIconMarkup('Smoked Rations','material-icon')}<span>Smoked Rations</span><strong>${smokedRations}</strong></div><div>${resourceIconMarkup('Surgefin Rations','material-icon')}<span>Surgefin Rations</span><strong>${surgefinRations}</strong></div><div class="inventory-salvage">${resourceIconMarkup('Salvage','material-icon')}<span>Salvage</span><strong>${salvageMaterials}</strong></div></div><h3>Non-combat Tools</h3>${owned.filter(item=>item.slot==='tool').map(item=>`<div class="inventory-item"><div class="inventory-item-copy">${iconMarkup('loadout',item.slot,'item-icon')}<div><strong>${item.name}</strong><div class="small">${itemStats(item)}</div></div></div><button class="btn" data-equip="${item.id}">Equip</button></div>`).join('')}<h3>Skill Instruments</h3>${skillToolInventory.map(instance=>{ const tool=getSkillToolDefinition(instance.toolId); return `<div class="inventory-item skill-tool-inventory"><div class="inventory-item-copy"><span class="skill-icon-fallback">♫</span><div><strong>${tool?.name || instance.toolId}</strong><div class="small">${tool?.description || 'Skill training tool'}</div></div></div><button class="btn btn-quiet" data-discard-tool="${instance.instanceId}">Salvage</button></div>`; }).join('')}<h3>Food</h3>${foods.map(item=>`<div class="inventory-item"><div class="inventory-item-copy">${resourceIconMarkup(item.name === 'Cooked Fish' ? 'Cooked Fish' : `${item.name}s`,'item-icon')}<div><strong>${item.name} ×${Math.floor(foodCount(item.id))}</strong><div class="small">${item.detail}</div></div></div><button class="btn" data-equip="${item.id}" ${foodCount(item.id)<1?'disabled':''}>Equip</button></div>`).join('')}`;
  inventoryList.querySelectorAll('[data-equip]').forEach(btn => btn.onclick = () => equipItem(btn.dataset.equip));
  inventoryList.querySelectorAll('[data-discard-tool]').forEach(btn => btn.onclick = () => {
    const tool = skillToolInventory.find(instance => instance.instanceId === btn.dataset.discardTool);
    if (!tool || !removeSkillTool(tool.instanceId)) return;
    showToast('Skill instrument salvaged');
    logActivity(`Salvaged ${getSkillToolDefinition(tool.toolId)?.name || 'skill instrument'}`, 'craft');
    renderSkills();
    renderLoadout();
    saveGame();
  });
}

/* =====================================
   UI RENDERERS
===================================== */
function restoreViewportAfterSkillToggle(scrollPosition) {
  if (!scrollPosition) return;
  const restore = () => window.scrollTo({ left:scrollPosition.left, top:scrollPosition.top, behavior:'auto' });
  requestAnimationFrame(restore);
  setTimeout(restore, 0);
}

function renderSkills() {
  skillsDiv.innerHTML = '';
  skills.filter(skill => skill.id !== 'Music' || hasSkillTool('Music')).forEach(s=>{
    const card = document.createElement('article');
    card.className = `skill-card skill-${s.id.toLowerCase()}`;
    card.setAttribute('aria-label', `${s.id} skill controls`);

    const chk = document.createElement('input');
    chk.type = 'checkbox';
    chk.id = `skill-toggle-${s.id.toLowerCase()}`;
    chk.checked = s.active;
    let skillToggleScroll = null;
    const rememberSkillScroll = () => { skillToggleScroll = { left:window.scrollX, top:window.scrollY }; };
    chk.addEventListener('pointerdown', rememberSkillScroll, { passive:true });
    chk.addEventListener('keydown', event => { if (event.key === ' ' || event.key === 'Enter') rememberSkillScroll(); });
    chk.onchange = ()=> {
      s.active = chk.checked;
      startWarmup();
      restoreViewportAfterSkillToggle(skillToggleScroll || { left:window.scrollX, top:window.scrollY });
    };

    const lbl = document.createElement('label');
    lbl.htmlFor = chk.id;
    lbl.textContent = s.id;

    const icon = document.createElement('span');
    const iconPosition = UI_ICONS.skill[s.id];
    const isMusic = s.id === 'Music';
    icon.className = isMusic ? 'game-icon icon-music skill-icon' : iconPosition ? 'game-icon icon-skill skill-icon' : 'skill-icon-fallback';
    if (isMusic) {
      icon.setAttribute('aria-label', 'Music');
    } else if (iconPosition) {
      icon.style.setProperty('--icon-x', `${iconPosition[0]}%`);
      icon.style.setProperty('--icon-y', `${iconPosition[1]}%`);
    } else icon.textContent = '◆';
    icon.setAttribute('aria-hidden', 'true');

    // Tick progress meter (pays out when full)
    const tickMeter = document.createElement('div');
    tickMeter.className = 'meter is-action';
    tickMeter.setAttribute('role', 'progressbar');
    tickMeter.setAttribute('aria-label', `${s.id} action progress`);
    tickMeter.setAttribute('aria-valuemin', '0');
    tickMeter.setAttribute('aria-valuemax', '100');
    tickMeter.setAttribute('aria-valuenow', '0');
    const tickFill = document.createElement('i');
    tickFill.style.width = '0%';
    tickMeter.appendChild(tickFill);

    // NEW: XP meter
    const xpMeter = document.createElement('div');   // NEW
    xpMeter.className = 'meter is-xp';               // NEW
    xpMeter.setAttribute('role', 'progressbar');
    xpMeter.setAttribute('aria-label', `${s.id} level progress`);
    xpMeter.setAttribute('aria-valuemin', '0');
    xpMeter.setAttribute('aria-valuemax', '100');
    xpMeter.setAttribute('aria-valuenow', '0');
    const xpFill = document.createElement('i');      // NEW
    xpFill.style.width = '0%';                       // NEW
    xpFill.style.background = '#68e0ff';             // NEW a different blue for XP
    xpMeter.appendChild(xpFill);                     // NEW

    const row = document.createElement('div');
    row.className = 'skill-stats';

    const rateEl = document.createElement('span'); // per sec
    rateEl.className = 'small';

    const qtyEl = document.createElement('span');  // total
    qtyEl.className = 'small skill-total';

    row.appendChild(rateEl);
    row.appendChild(qtyEl);
    const unlockEl = document.createElement('div');
    unlockEl.className = 'small next-unlock';

    const stateEl = document.createElement('span');
    stateEl.className = 'skill-state is-paused';
    stateEl.textContent = 'Paused';
    const header = document.createElement('div');
    header.className = 'skill-card-header';
    const identity = document.createElement('div');
    identity.className = 'skill-identity';
    identity.append(chk, icon, lbl);
    header.append(identity, stateEl);
    card.appendChild(header);
    card.appendChild(tickMeter);
    card.appendChild(xpMeter);                      // NEW
    card.appendChild(row);
    if (s.id === 'Crafting') {
      const recipeLabel = document.createElement('label');
      recipeLabel.className = 'field-label';
      recipeLabel.htmlFor = 'crafting-recipe-select';
      recipeLabel.textContent = 'Assembly target';
      const recipeSelect = document.createElement('select');
      recipeSelect.id = recipeLabel.htmlFor;
      recipeSelect.className = 'btn skill-action-select';
      recipeSelect.innerHTML = (SKILL_FRAMEWORK?.craftingRecipes || []).map(recipe => `<option value="${recipe.id}">${recipe.name} · Lv ${recipe.requiredLevel}</option>`).join('');
      recipeSelect.value = craftingSelectedRecipe;
      recipeSelect.onchange = () => { craftingSelectedRecipe = recipeSelect.value; saveGame(); renderGear(); };
      card.appendChild(recipeLabel);
      card.appendChild(recipeSelect);
      const assemblyButton = document.createElement('button');
      assemblyButton.type = 'button';
      assemblyButton.className = 'btn crafting-activity-button';
      assemblyButton.textContent = 'Play Assembly Run';
      assemblyButton.onclick = () => openCraftingAssembly();
      card.appendChild(assemblyButton);
      s._craftingRecipeSelect = recipeSelect;
      s._craftingActivityButton = assemblyButton;
    }
    if (s.id === 'Cooking') {
      const outcomeEl = document.createElement('div');
      outcomeEl.className = 'cooking-outcome small';
      outcomeEl.textContent = 'Waiting for first cooking attempt.';
      card.appendChild(outcomeEl);
      s._outcomeEl = outcomeEl;
    }
    if (s.id === 'Woodcutting') {
      const treeLabel = document.createElement('label');
      treeLabel.className = 'field-label';
      treeLabel.htmlFor = `skill-tree-${s.id.toLowerCase()}`;
      treeLabel.textContent = 'Tree target';
      const treeSelect = document.createElement('select');
      treeSelect.id = treeLabel.htmlFor;
      treeSelect.className = 'btn skill-action-select';
      treeSelect.innerHTML = TREE_TYPES.map(tree => `<option value="${tree.id}" ${s.lvl < tree.level ? 'disabled' : ''}>${tree.name} — level ${tree.level} · ${tree.seconds}s/action</option>`).join('');
      treeSelect.value = selectedTree;
      treeSelect.onchange = () => { selectedTree = treeSelect.value; startWarmup(); };
      card.appendChild(treeLabel);
      card.appendChild(treeSelect);
      s._treeSelect = treeSelect;
    }
    if (s.id === 'Music') {
      const toolLabel = document.createElement('label');
      toolLabel.className = 'field-label';
      toolLabel.htmlFor = 'music-tool-select';
      toolLabel.textContent = 'Instrument target';
      const toolSelect = document.createElement('select');
      toolSelect.id = toolLabel.htmlFor;
      toolSelect.className = 'btn skill-action-select';
      toolSelect.innerHTML = skillToolsFor('Music').map(tool => `<option value="${tool.id}">${tool.name} · ${tool.xpMultiplier.toFixed(1)}× XP</option>`).join('');
      toolSelect.value = selectedSkillTool('Music')?.id || '';
      toolSelect.onchange = () => { s.selectedToolId = toolSelect.value; saveGame(); startWarmup(); };
      card.appendChild(toolLabel);
      card.appendChild(toolSelect);
      s._musicSelect = toolSelect;
    }
    card.appendChild(unlockEl);
    const xpDropHost = document.createElement('div');
    xpDropHost.className = 'xp-drop-host';
    xpDropHost.setAttribute('aria-hidden', 'true');
    card.appendChild(xpDropHost);
    card.addEventListener('click', event => {
      if (event.target.closest('input, select, button, a, label')) return;
      chk.checked = !chk.checked;
      chk.dispatchEvent(new Event('change', { bubbles:true }));
      chk.focus({ preventScroll:true });
    });
    skillsDiv.appendChild(card);

    s._els = { card, tickMeter, xpMeter, tickFill, xpFill, rateEl, qtyEl, unlockEl, stateEl, label: lbl, xpDropHost };
  });

  honeSelect.innerHTML = '<option value="">None</option>' + skills.filter(skill => skill.id !== 'Music' || hasSkillTool('Music')).map(s=> `<option value="${s.id}">${s.id}</option>`).join('');
}

function queueSkillXpDrop(skill, amount) {
  if (!skill?._els?.xpDropHost || amount <= 0 || document.visibilityState !== 'visible') return;
  skill._pendingXpDrop = (skill._pendingXpDrop || 0) + amount;
  if (skill._xpDropTimer) return;
  skill._xpDropTimer = setTimeout(() => {
    const gained = skill._pendingXpDrop || 0;
    skill._pendingXpDrop = 0;
    skill._xpDropTimer = null;
    if (!gained || !skill._els?.xpDropHost) return;
    const drop = document.createElement('span');
    drop.className = 'xp-drop';
    drop.textContent = `+${Math.round(gained)} XP`;
    drop.style.top = `${Math.min(2,skill._els.xpDropHost.childElementCount) * 10}px`;
    drop.style.right = `${skill._els.xpDropHost.childElementCount % 2 ? 5 : 0}px`;
    skill._els.xpDropHost.appendChild(drop);
    skill._els.card.classList.remove('xp-pulse');
    void skill._els.card.offsetWidth;
    skill._els.card.classList.add('xp-pulse');
    while (skill._els.xpDropHost.children.length > 3) skill._els.xpDropHost.firstElementChild.remove();
    setTimeout(() => drop.remove(), 1050);
    setTimeout(() => skill._els?.card.classList.remove('xp-pulse'), 500);
  }, 240);
}


const loadedSave = loadGame();
function localCombatProfileGear() {
  const cache = soloDeskState()?.lootCache;
  if (!cache || !LOOT_FRAMEWORK) return { gear:[], equippedGearIds:[], loadout:{} };
  const equippedIds = LOOT_FRAMEWORK.equippedItemIds?.(cache.equipment) || [];
  const gear = cache.items.filter(instance => equippedIds.includes(instance.instanceId)).map(instance => {
    const inspection = LOOT_FRAMEWORK.inspectItem(instance);
    const stats = inspection?.stats || {};
    const definition = inspection?.definition;
    return {
      id: instance.instanceId,
      name: definition?.name,
      slot: ['melee', 'gun', 'ranged', 'magic'].includes(definition?.slot) ? 'weapon' : definition?.kind === 'accessory' ? 'accessory' : 'armor',
      power: Number(instance.itemLevel || 0) + Number(stats.damage || 0) + Number(stats.accuracy || 0),
      defense: Number(stats.armour || 0) + Number(stats.ward || 0),
      tags: [definition?.weight, definition?.slot, definition?.kind].filter(Boolean),
      affixes: instance.affixes.map(affix => ({ id:affix.id, stat:affix.stat, value:affix.value }))
    };
  });
  const activeSlot = cache.equipment.activeWeaponSlot || 'gun';
  const activeInstance = cache.items.find(instance => instance.instanceId === cache.equipment[activeSlot]);
  const activeDefinition = activeInstance ? LOOT_FRAMEWORK.inspectItem(activeInstance)?.definition : null;
  const armourWeights = gear.map(item => item.tags?.find(tag => ['light', 'medium', 'heavy'].includes(tag))).filter(Boolean);
  return {
    gear,
    equippedGearIds: equippedIds,
    loadout: {
      weaponStyle: activeSlot,
      weaponWeight: activeDefinition?.weight,
      armourWeight: armourWeights.includes('heavy') ? 'heavy' : armourWeights.includes('medium') ? 'medium' : armourWeights.length ? 'light' : undefined,
      gearIds: equippedIds
    }
  };
}
window.MomentumCombatProfile = Object.freeze({
  getSnapshot() {
    const profile = localCombatProfileGear();
    return {
      playerId:'local-player',
      combatSkills:COMBAT_PROGRESSION_FRAMEWORK.compatibility.progressionLevelMap(combatProgression),
      talents:[...ownedCombatTalents],
      gold,
      legacyCombatLevel:combatLevelForUI(),
      ...profile
    };
  }
});
function syncSoloFrontierProjection() {
  if (!soloFrontierRuntime) return;
  soloFrontierState = soloFrontierRuntime.getState();
  combatProgression = soloFrontierState.combatProgression;
  keys = soloFrontierState.keys;
  collectionProgress = { ...soloFrontierState.collectionProgress };
  reconcileArenaTierUnlocks(arenaTierUnlocked);
  const earnedGold = Number(soloFrontierState.frontierExchange?.ledger?.earned || 0);
  if (earnedGold > soloFrontierLastEarnedGold) gold += earnedGold - soloFrontierLastEarnedGold;
  soloFrontierLastEarnedGold = earnedGold;
  if (soloFrontierState.debrief && soloFrontierState.debrief !== soloFrontierLastDebrief) {
    salvageMaterials += soloFrontierState.debrief.filterSalvage + soloFrontierState.debrief.fullCacheSalvage;
    soloFrontierLastDebrief = soloFrontierState.debrief;
  }
  rehydrateLootInventory();
}
soloFrontierRuntime = SOLO_FRONTIER_FRAMEWORK.createSoloFrontierRuntime(soloFrontierState, {
  combatInput: soloFrontierCombatInput,
  useConfiguredEnemy: false,
  seed: soloFrontierState.seed
});
soloFrontierLastDebrief = soloFrontierState.debrief;
soloFrontierLastEarnedGold = Number(soloFrontierState.frontierExchange?.ledger?.earned || 0);
soloDeskDebriefSnapshot = soloFrontierState.debrief;
syncSoloFrontierProjection();
window.MomentumSoloFrontierRuntime = Object.freeze({
  getState() { return soloFrontierRuntime.getState(); },
  pause() { const next = soloFrontierRuntime.setOrder('paused'); syncSoloFrontierProjection(); saveGame(); renderSoloFrontierDesk(); return next; },
  push() { const next = soloFrontierRuntime.setOrder('push'); soloDeskDebriefSnapshot = null; soloDebriefPanel.hidden = true; syncSoloFrontierProjection(); saveGame(); renderSoloFrontierDesk(); return next; },
  farm(stage) { const next = soloFrontierRuntime.setOrder('farm', stage); soloDeskDebriefSnapshot = null; soloDebriefPanel.hidden = true; syncSoloFrontierProjection(); saveGame(); renderSoloFrontierDesk(); return next; },
  setFallback(stage) { const next = soloFrontierRuntime.setFallbackStage(stage); syncSoloFrontierProjection(); saveGame(); renderSoloFrontierDesk(); return next; },
  setFarmStage(stage) { const next = soloFrontierRuntime.setFarmStage(stage); syncSoloFrontierProjection(); saveGame(); renderSoloFrontierDesk(); return next; },
  advance(elapsedMs, options) { const result = soloFrontierRuntime.advance(elapsedMs, options); handleSoloFrontierAdvance(result); syncSoloFrontierProjection(); saveGame(); renderSoloFrontierDesk(); return result; },
  catchUp(seconds, options) { return soloFrontierRuntime.catchUp(seconds, options).then(result => { handleSoloFrontierAdvance(result); syncSoloFrontierProjection(); saveGame(); renderSoloFrontierDesk(); return result; }) }
});
function soloDeskDebugFillCache(count = 35) {
  let cache = soloDeskState().lootCache;
  const target = Math.max(0, Math.min(35, Math.floor(Number(count) || 35)));
  let index = 0;
  let attempts = 0;
  while (soloDeskUnequippedCount(cache) < target && attempts < target + 100) {
    const instanceSeed = `${Date.now()}-${index}`;
    const resolution = LOOT_FRAMEWORK.rollLoot({ sourceType:'soloFrontier', sourceId:'solo-frontier', sourceTier:1, playerLevel:1, runId:`debug-cache-${instanceSeed}`, itemChance:1, minimumRarity:'rare', now:Date.now() + index }, () => .15 + (index % 5) * .1);
    if (resolution.item) cache = LOOT_FRAMEWORK.insertLoot(cache, resolution.item).cache;
    index += 1;
    attempts += 1;
  }
  soloDeskCacheMutation(cache);
  // QA-only seeding keeps the cache route self-contained so reforge can be
  // exercised without changing the normal economy or player progression.
  salvageMaterials = Math.max(salvageMaterials, 100);
  const smithing = skills.find(skill => skill.id === 'Smithing');
  const crafting = skills.find(skill => skill.id === 'Crafting');
  if (smithing) smithing.qty = Math.max(smithing.qty, 10);
  if (crafting) crafting.qty = Math.max(crafting.qty, 10);
  return soloDeskUnequippedCount(cache);
}
function soloDeskDebugSeedProgress(stage = 2) {
  if (!soloFrontierRuntime) return false;
  const cappedStage = Math.max(1, Math.min(29, Math.floor(Number(stage) || 2)));
  const current = soloFrontierRuntime.getState();
  const clearedStages = Array.from({ length:cappedStage }, (_, index) => index + 1);
  soloFrontierRuntime.hydrate({
    ...current,
    order:'paused',
    currentStage:null,
    farmStage:cappedStage,
    highestClearedStage:cappedStage,
    clearedStages,
    firstClearStages:clearedStages,
    stageVictories:{},
    wall:null,
    encounterElapsedMs:0,
    encounterSequence:0,
    debrief:null
  });
  soloDeskLastOutcome = null;
  soloDeskDebriefSnapshot = null;
  soloDeskForceDefeat = false;
  soloDebriefPanel.hidden = true;
  syncSoloFrontierProjection();
  renderSoloFrontierDesk();
  saveGame();
  return cappedStage;
}
window.MomentumSoloFrontierDebug = Object.freeze({
  forceDefeat() {
    soloDeskForceDefeat = true;
    if (soloDeskState().order !== 'push') window.MomentumSoloFrontierRuntime.push();
    // The debug route should expose the fallback/debrief path immediately. The
    // combat engine still owns the outcome; this only supplies enough elapsed
    // time for its deterministic timeout when the test flag removes player DPS.
    const result = soloFrontierRuntime.advance(61_000, { maxEncounters: 1 });
    handleSoloFrontierAdvance(result);
    syncSoloFrontierProjection();
    saveGame();
    renderSoloFrontierDesk();
    return result.events?.at(-1)?.outcome === 'defeat';
  },
  fillCache(count = 35) { return soloDeskDebugFillCache(count); },
  seedProgress(stage = 2) { return soloDeskDebugSeedProgress(stage); },
  clearCache() { const next = LOOT_FRAMEWORK.createLootCache(); soloDeskCacheMutation(next); return true; },
  clearDebrief() { soloDeskDebriefSnapshot = null; soloDebriefPanel.hidden = true; renderSoloFrontierDesk(); }
});
if (soloQaToolbar && new URLSearchParams(window.location.search).has('qa')) soloQaToolbar.hidden = false;
if (!worldRuntime) ensureWorldRuntime();
if (loadedSave) void applyOfflineProgress(JSON.parse(localStorage.getItem(SAVE_KEY)).savedAt).then(showOfflineSummary);
renderSkills();
renderArenaTierOptions();
renderActivityLedger();
renderFrontier();
renderOperations(true);
renderWorld(true);
applySettings();
setGameView('field');
honeSelect.value = hone || '';
startWarmup();
renderSoloFrontierDesk();
if (loadedSave) {
  showToast('Save loaded');
}

setInterval(() => saveGame(), AUTO_SAVE_MS);
window.addEventListener('beforeunload', () => saveGame());
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'hidden') saveGame();
});

/* =====================================
   MAIN LOOP AND IDLE PRODUCTION
===================================== */
honeSelect.onchange = ()=>{ hone = honeSelect.value || null; };

function startWarmup() {
  warmup.targetA = productiveSkills().length;
  if (warmup.currentA === 0) warmup.currentA = warmup.targetA;
  warmup.t = 3.0;
}

function combatBuildLabel() {
  const capstone = COMBAT_TALENTS.find(talent => talent.capstone && ownedCombatTalents.has(talent.id));
  if (capstone) return capstone.name;
  const roots = COMBAT_TALENTS.filter(talent => talent.tier === 1 && ownedCombatTalents.has(talent.id));
  return roots.length ? roots.map(talent => talent.branch[0].toUpperCase() + talent.branch.slice(1)).join(' / ') : 'Unassigned';
}

let operationsExpanded = false;
function setOperationsExpanded(expanded) {
  operationsExpanded = Boolean(expanded);
  operationsBoard?.classList.toggle('is-collapsed', !operationsExpanded);
  if (operationsToggle) {
    operationsToggle.setAttribute('aria-expanded', String(operationsExpanded));
    operationsToggle.textContent = operationsExpanded ? 'Hide contracts' : 'Show contracts';
  }
}

function setGameView(view) {
  const nextView = ['field', 'adventure'].includes(view) ? view : 'hub';
  const changed = currentGameView !== nextView;
  currentGameView = nextView;
  document.body.dataset.gameView = currentGameView;
  document.querySelectorAll('[data-game-view]').forEach(button => {
    const active=button.dataset.gameView === currentGameView;
    button.classList.toggle('is-active',active);
    button.setAttribute('aria-pressed',String(active));
    if (active) button.setAttribute('aria-current','page'); else button.removeAttribute('aria-current');
  });
  document.querySelectorAll('[data-quick-view]').forEach(button => {
    const active=button.dataset.quickView === currentGameView;
    button.classList.toggle('is-active',active);
    if (active) button.setAttribute('aria-current','page'); else button.removeAttribute('aria-current');
  });
  const field = ['.card-arena','.card-frontier','.card-fishing'];
  const hub = ['.card-skills','.card-honing','.card-upgrades','.card-workshop','.card-save','.card-inventory','.card-ledger'];
  const adventure = ['.card-adventure'];
  field.forEach(selector => document.querySelector(selector)?.classList.add('view-field'));
  hub.forEach(selector => document.querySelector(selector)?.classList.add('view-hub'));
  adventure.forEach(selector => document.querySelector(selector)?.classList.add('view-adventure'));
  document.querySelector('.operations-board')?.classList.toggle('view-field-emphasis', currentGameView === 'field');
  if (changed) requestAnimationFrame(() => {
    document.getElementById('gameViewRoot')?.scrollIntoView({ block:'start', behavior:reduceMotionEnabled() ? 'auto' : 'smooth' });
  });
}

let objectiveRenderSignature = '';
function updateObjective() {
  const mining = skills.find(skill => skill.id === 'Mining');
  const smithing = skills.find(skill => skill.id === 'Smithing');
  const crafting = skills.find(skill => skill.id === 'Crafting');
  const combat = { lvl: combatLevelForUI() };
  const hasAccountProgress = skills.some(skill => skill.lvl > 1 || skill.qty > 0);
  let title = 'Push the frontier';
  let detail = 'Refine weapons, improve your times, and prepare for higher arena tiers.';
  let objectiveProgress = 100;
  let action = 'review-skills';
  let actionLabel = 'Review skills';
  if (!skills.some(skill => skill.active) && !hasAccountProgress) {
    title = 'Start your first skill'; detail = 'Activate Mining to begin producing Ore.'; objectiveProgress = 0;
    action = 'start-mining'; actionLabel = 'Activate Mining';
  } else if (mining.lvl < 5 || smithing.lvl < 5) {
    const miningProgress = Math.min(5,mining.lvl);
    const smithingProgress = Math.min(5,smithing.lvl);
    title = 'Reach your first recipe milestones'; objectiveProgress = (miningProgress + smithingProgress) / 10 * 100; detail = `Mining ${miningProgress}/5 · Smithing ${smithingProgress}/5. Smithing needs Ore but does not reduce efficiency while blocked.`;
    action = 'review-skills'; actionLabel = 'Review skills';
  } else if (crafting.qty < 1) {
    title = 'Supply the Workshop'; objectiveProgress = 20; detail = 'Activate Woodcutting, Smithing, and Crafting to assemble your first workshop component.';
    action = 'review-skills'; actionLabel = 'Start Crafting';
  } else if (!ownedGear.size) {
    title = 'Craft your first equipment'; objectiveProgress = 35; detail = 'Use Bars and Crafted Components in the Workshop to assemble a field-ready item.';
    action = 'craft-gear'; actionLabel = 'Open Workshop';
  } else if (worldState && worldState.status === 'outpost') {
    title = 'Choose a frontier route'; objectiveProgress = 55; detail = 'The Frontier Line is ready. Choose Timberline, Ironworks, or the Broken Watch based on your current build.';
    action = 'open-adventure'; actionLabel = 'Open Adventure';
  } else if (worldState && worldState.status === 'ready' && worldState.currentNodeId === WORLD_REGION?.outpostNodeId) {
    title = 'Select your next route'; objectiveProgress = 65; detail = 'Pick the route that best matches your current stockpile, then begin the encounter.';
    action = 'open-adventure'; actionLabel = 'Choose Route';
  } else if (worldState && worldState.status === 'reward') {
    title = 'Claim the frontier cache'; objectiveProgress = 90; detail = 'A route reward is waiting. Claim it to continue toward Vanguard Gate.';
    action = 'open-adventure'; actionLabel = 'Claim Reward';
  } else if (combat.lvl < 5 || Math.floor(keys) < ARENA_TIERS[0].keyCost) {
    title = 'Prepare for the Initiate'; objectiveProgress = Math.min(100,((combat.lvl/5)+(Math.floor(keys)/ARENA_TIERS[0].keyCost))/2*100); detail = `Combat ${combat.lvl}/5 · Boss Keys ${Math.floor(keys)}/${ARENA_TIERS[0].keyCost}.`;
    action = 'open-field'; actionLabel = 'Open the Field';
  } else if (arenaWins[0] === 0) {
    title = 'Defeat the Initiate'; objectiveProgress = 75; detail = 'Choose Gun or equip an Iron Blade, then prepare an Arena run.';
    action = 'open-field'; actionLabel = 'Enter the Field';
  } else if (arenaWins[1] === 0) {
    title = 'Reach and defeat Vanguard'; objectiveProgress = Math.min(90,combat.lvl/10*75); detail = `Reach Combat 10, then beat Vanguard. Current Combat: ${combat.lvl}.`;
    action = 'open-field'; actionLabel = 'Enter the Field';
  } else if (arenaWins[2] === 0) {
    title = 'Conquer Apex'; objectiveProgress = Math.min(90,combat.lvl/15*75); detail = `Reach Combat 15 and complete the current frontier. Current Combat: ${combat.lvl}.`;
    action = 'open-field'; actionLabel = 'Enter the Field';
  } else if (masteryStars() < 6) {
    const next = FRONTIER_DIRECTIVES.find(directive => !completedDirectives.has(directive.id));
    title = 'Master the Frontier'; objectiveProgress = masteryStars()/6*100; detail = next ? `Complete ${next.name} for your next Mastery Star. ${masteryStars()}/6 earned.` : `${masteryStars()}/6 Mastery Stars earned.`;
    action = 'open-frontier'; actionLabel = 'Open Mastery';
  } else if (gauntletRecord.clears === 0) {
    title = 'Clear the Frontier Gauntlet'; objectiveProgress = 50; detail = 'Lock one build and defeat Initiate, Vanguard, and Apex in sequence.';
    action = 'open-frontier'; actionLabel = 'Open Mastery';
  }
  const signature = JSON.stringify([title,detail,Math.round(objectiveProgress),action,actionLabel]);
  if (signature === objectiveRenderSignature) return;
  objectiveRenderSignature = signature;
  objectiveTitle.textContent = title;
  objectiveDetail.textContent = detail;
  objectiveProgressFill.style.width = `${Math.max(0,Math.min(100,objectiveProgress))}%`;
  objectiveProgressFill.parentElement?.setAttribute('aria-valuenow', String(Math.round(objectiveProgress)));
  if (objectiveActionBtn) {
    objectiveActionBtn.dataset.objectiveAction = action;
    objectiveActionBtn.textContent = actionLabel;
  }
}

let last = performance.now();
let lastUiRefresh = 0;
let statusRenderSignature = '';
let totalsRenderSignature = '';
function tick(now) {
  const dt = Math.min(0.25, (now - last)/1000);
  last = now;

  warmup.targetA = productiveSkills().length;
  if (warmup.t > 0) {
    const step = Math.min(warmup.t, dt);
    warmup.t -= step;
    const lerp = 1 - warmup.t/3.0;
    warmup.currentA = warmup.currentA + (warmup.targetA - warmup.currentA)*lerp;
  } else {
    warmup.currentA = warmup.targetA;
  }

  const a = Math.max(1, Math.round(warmup.currentA));
  const m = mOfA(a) * (globalBuff.secs > 0 ? 1.5 : 1.0);

  if (globalBuff.secs>0) {
    globalBuff.secs -= dt;
    if (globalBuff.secs<0) globalBuff.secs = 0;
  }
  if (fishingBuffSecs > 0) fishingBuffSecs = Math.max(0, fishingBuffSecs - dt);

  // Solo combat is an independent order, so it advances in the same frame as
  // the normal skill tracks instead of occupying a normal skill slot.
  if (soloFrontierRuntime?.getState().order !== 'paused') {
    const soloAdvanceResult = soloFrontierRuntime.advance(dt * 1_000);
    handleSoloFrontierAdvance(soloAdvanceResult);
    syncSoloFrontierProjection();
  }

 
// tick based production
const actives = productiveSkills();
actives.forEach(s => {
  const cfg = getSkillCfg(s.id);
  const H = hone === s.id ? honingMult : 1.0;
  const perSec = effectiveProductionRate(s, m, H);

  s.progress += perSec * dt;

  while (s.progress >= 1) {
    s.progress -= 1;
    processSkillAction(s);
  }
});

  // Action meters are direct gameplay feedback and stay on the animation frame;
  // text-heavy account UI is refreshed less often below.
  skills.filter(skill => skill._els?.card?.isConnected).forEach(skill => {
    const tickPct = Math.min(100, skill.progress * 100);
    skill._els.tickFill.style.width = `${tickPct.toFixed(1)}%`;
  });

  if (now - lastUiRefresh < 100) {
    requestAnimationFrame(tick);
    return;
  }
  lastUiRefresh = now;
  effReadout.textContent = `${m.toFixed(2)}× · ${hone ? `${hone} focused` : 'No focus'} · ${unlockedNormalSlots} slots`;
  activeCountTag.textContent = `${skills.filter(s=>s.active).length} active · ${productiveSkills().length} productive`;
  buffLabel.textContent = globalBuff.secs>0 ? `1.5× · ${Math.ceil(globalBuff.secs)}s` : 'None';



skills.filter(s => s._els?.card?.isConnected).forEach(s=>{
  const H = hone === s.id ? honingMult : 1.0;
  const cfg = getSkillCfg(s.id);
  const waiting = Boolean(s.active && cfg.canAct && !cfg.canAct());
  const perSec = s.active && !waiting ? effectiveProductionRate(s, m, H) : 0;
  s._els.card.classList.toggle('is-active', s.active);
  s._els.card.classList.toggle('is-honed', hone === s.id);
  s._els.card.classList.toggle('is-waiting', waiting);
  s._els.stateEl.textContent = waiting ? 'Blocked' : s.active ? 'Running' : 'Paused';
  s._els.stateEl.className = `skill-state ${waiting ? 'is-blocked' : s.active ? 'is-running' : 'is-paused'}`;

  const tickPct = Math.min(100, s.progress * 100);
  s._els.tickFill.style.width = tickPct.toFixed(1) + '%';
  s._els.tickMeter.setAttribute('aria-valuenow', String(Math.round(tickPct)));

  const xpPct = Math.min(100, (s.xp / s.next) * 100);
  s._els.xpFill.style.width = xpPct.toFixed(1) + '%';
  s._els.xpMeter.setAttribute('aria-valuenow', String(Math.round(xpPct)));

  // Lvl / XP / Rate / Total Labels
  s._els.rateEl.textContent =
    `Lv ${s.lvl} · ${Math.floor(s.xp)}/${s.next} XP · ${perSec.toFixed(2)}/s` + (waiting ? ` · ${cfg.waitingLabel || 'blocked'}` : '') + (s.id === 'Cooking' ? ` · ${(cookingSuccessChance(s.lvl) * 100).toFixed(0)}% success` : '') + (s.id === 'Woodcutting' ? ` · ${TREE_TYPES.find(tree => tree.id === selectedTree).name}` : '');
  s._els.qtyEl.textContent = `${s.qty.toFixed(1)} total`;
  const milestone = nextSkillMilestone(s);
  if (s.id === 'Woodcutting' && s._treeSelect) {
    Array.from(s._treeSelect.options).forEach((option, index) => option.disabled = s.lvl < TREE_TYPES[index].level);
  }
  if (s.id === 'Cooking' && s._outcomeEl && s.lastOutcome) {
    s._outcomeEl.textContent = s.lastOutcome.text;
    s._outcomeEl.className = `cooking-outcome small is-${s.lastOutcome.kind}`;
  }
  if (s.id === 'Crafting') {
    if (s._craftingRecipeSelect) s._craftingRecipeSelect.value = craftingSelectedRecipe;
    if (s._craftingActivityButton) {
      const remaining = Math.max(0, craftingActiveBonus.expiresAt - performance.now());
      s._craftingActivityButton.textContent = remaining > 0 ? `Assembly Boost · ${Math.ceil(remaining / 1000)}s` : 'Play Assembly Run';
      s._craftingActivityButton.classList.toggle('is-active', remaining > 0);
    }
  }
  s._els.unlockEl.textContent = milestone ? `Next unlock: ${milestone.label} at level ${milestone.level}` : 'All current milestones unlocked';
  s._els.label.style.color = '';
});



  keysLabel.textContent = Math.floor(keys);
  updateArenaTierUI();

  const ore = skills.find(s=>s.id==='Mining')?.qty ?? 0;
  const bars = skills.find(s=>s.id==='Smithing')?.qty ?? 0;
  const totalsSignature = JSON.stringify([ore.toFixed(1),bars.toFixed(1),skills.find(s=>s.id==='Crafting').qty.toFixed(1),scrap.toFixed(1),skills.find(s=>s.id==='Fishing').qty.toFixed(1),skills.find(s=>s.id==='Cooking').qty.toFixed(1),basicBait,uncommonFish,woodInventory.pine.toFixed(0),woodInventory.oak.toFixed(0),woodInventory.yew.toFixed(0),woodInventory.ancient.toFixed(0),Math.floor(keys),rareGems,Math.floor(gold),Math.ceil(fishingBuffSecs),burntFish.toFixed(1),Math.floor(huntingXp),trappedGame]);
  if (totalsSignature !== totalsRenderSignature) {
    totalsRenderSignature = totalsSignature;
    totalsDiv.innerHTML = `
      <div class="resource-groups">
        <section><h3>Forging</h3>${resourceChipMarkup('Ore',ore.toFixed(1))}${resourceChipMarkup('Bars',bars.toFixed(1))}${resourceChipMarkup('Crafted Parts',skills.find(s=>s.id==='Crafting').qty.toFixed(1),'Crafted Components')}${resourceChipMarkup('Scrap',scrap.toFixed(1))}</section>
        <section><h3>Provisions</h3>${resourceChipMarkup('Raw Fish',skills.find(s=>s.id==='Fishing').qty.toFixed(1))}${resourceChipMarkup('Cooked Fish',skills.find(s=>s.id==='Cooking').qty.toFixed(1))}${resourceChipMarkup('Basic Bait',basicBait)}${resourceChipMarkup('Uncommon Fish',uncommonFish)}</section>
        <section><h3>Timber</h3>${resourceChipMarkup('Pine',woodInventory.pine.toFixed(0),'Pine Logs')}${resourceChipMarkup('Oak',woodInventory.oak.toFixed(0),'Oak Logs')}${resourceChipMarkup('Yew',woodInventory.yew.toFixed(0),'Yew Logs')}${resourceChipMarkup('Ancient',woodInventory.ancient.toFixed(0),'Ancient Logs')}</section>
        <section><h3>Frontier</h3>${resourceChipMarkup('Boss Keys',Math.floor(keys))}${resourceChipMarkup('Rare Gems',rareGems)}${resourceChipMarkup('Fishing Boost',fishingBuffSecs > 0 ? `${Math.ceil(fishingBuffSecs)}s` : 'None','Raw Fish')}${resourceChipMarkup('Burnt Fish',burntFish.toFixed(1))}</section>
      </div>
    `;
  }
  recycleScrapBtn.disabled = scrap < scrapRecycleCost();
  recycleStatus.textContent = `${scrap.toFixed(1)}/${scrapRecycleCost()} Scrap — recycle ${scrapRecycleCost()} Scrap into 1 Ore.`;

 const buffText = globalBuff.secs > 0 
  ? `Active (${Math.ceil(globalBuff.secs/60)}m left)` 
  : 'None';

updateObjective();
renderWorld();
renderOperations();
renderSoloFrontierDesk();
const statusSignature = JSON.stringify([Math.floor(gold)]);
if (statusSignature !== statusRenderSignature) {
  statusRenderSignature = statusSignature;
  statusEl.innerHTML = `
    <span class="gold-status" aria-label="Gold ${Math.floor(gold)}"><img class="gold-status-icon" src="./assets/ui-icons/gold-coin.png" alt=""><span class="gold-status-copy"><small>GOLD</small><strong>${Math.floor(gold)}</strong></span></span>
  `;
}
  requestAnimationFrame(tick);
}
requestAnimationFrame(tick);

let fishingGame = null;
let fishingHolding = false;
let fishingRaf = null;

function updateFishingBaitUI() {
  fishingBaitCount.textContent = `Basic Bait: ${basicBait} · Uncommon Fish: ${uncommonFish}`;
}
function openFishing(context = null) {
  if (context) worldActiveActivity = context;
  fishingModal.style.display = 'flex';
  updateFishingBaitUI();
  fishingStatus.textContent = 'Choose bait, then cast.';
  startFishingCastBtn.disabled = false;
  startFishingCastBtn.textContent = 'Cast';
  closeFishingBtn.textContent = 'Exit';
}
function closeFishing() {
  if (fishingGame) finishFishingCast(false, 'Cast cancelled', false);
  else if (worldActiveActivity?.kind === 'fishing') worldCancelEncounter();
  fishingModal.style.display = 'none';
}
function prepareBasicBait() {
  const fishing = skills.find(s=>s.id==='Fishing');
  const requirementState = evaluateRequirements([{type:'skillLevel',skill:'Fishing',value:5},{type:'resource',resource:'Raw Fish',value:3}]);
  if (!requirementState.met) { showToast(`Requires ${requirementState.missing.join(' · ')}`); return; }
  fishing.qty -= 3;
  basicBait += 1;
  updateFishingBaitUI();
  showToast('Prepared 1 Basic Bait');
}
function startFishingCast() {
  if (fishingGame) return;
  let usedBait = fishingBaitSelect.value;
  const fishing = skills.find(skill => skill.id === 'Fishing');
  if (usedBait === 'basic' && basicBait < 1) {
    usedBait = 'none';
    fishingBaitSelect.value = 'none';
    fishingStatus.textContent = 'Out of Basic Bait — casting without bait.';
  }
  if (usedBait === 'prime') {
    const primeRequirements = evaluateRequirements([{type:'skillLevel',skill:'Fishing',value:10},{type:'resource',resource:'Uncommon Fish',value:1}]);
    if (!primeRequirements.met) {
      usedBait = 'none';
      fishingBaitSelect.value = 'none';
      fishingStatus.textContent = `Prime Bait requires ${primeRequirements.missing.join(' · ')}.`;
    }
  }
  if (usedBait === 'basic') basicBait -= 1;
  if (usedBait === 'prime') uncommonFish -= 1;
  updateFishingBaitUI();
  fishingGame = { fishY:60 + Math.random()*160, fishV:90, steer:0.7, zoneY:190, catchProgress:0, tension:0, timeLeft:45, usedBait, last:performance.now() };
  fishingStatus.textContent = usedBait === 'prime' ? 'Prime Bait used. Land this fish for enhanced rewards.' : usedBait === 'basic' ? 'Basic Bait used. Keep the fish in the catch zone.' : 'Keep the fish in the catch zone.';
  startFishingCastBtn.disabled = true;
  startFishingCastBtn.textContent = 'Cast in progress';
  prepareBaitBtn.disabled = true;
  fishingBaitSelect.disabled = true;
  closeFishingBtn.textContent = 'Cancel cast';
  fishingRaf = requestAnimationFrame(updateFishingCast);
}
function updateFishingCast(now) {
  if (!fishingGame) return;
  const g = fishingGame;
  const dt = Math.min(0.05, (now - g.last) / 1000); g.last = now;
  g.timeLeft -= dt; g.steer -= dt;
  if (g.steer <= 0) { g.fishV = (50 + Math.random()*100) * (Math.random()<0.5 ? -1 : 1); g.steer = 0.45 + Math.random()*0.8; }
  g.fishY += g.fishV * dt;
  if (g.fishY < 0 || g.fishY > 280) { g.fishY = Math.max(0, Math.min(280, g.fishY)); g.fishV *= -1; }
  g.zoneY += (fishingHolding ? -150 : 105) * dt;
  g.zoneY = Math.max(0, Math.min(240, g.zoneY));
  const overlapping = g.fishY + 20 >= g.zoneY && g.fishY <= g.zoneY + 60;
  g.catchProgress = Math.max(0, Math.min(100, g.catchProgress + (overlapping ? 28 : -14) * dt));
  g.tension = Math.max(0, Math.min(100, g.tension + (overlapping ? -55 : 45) * dt));
  fishingFish.style.top = `${g.fishY}px`; fishingCatchZone.style.top = `${g.zoneY}px`;
  fishingCatchFill.style.width = `${g.catchProgress}%`; fishingTensionFill.style.width = `${g.tension}%`; fishingTime.textContent = `${Math.ceil(g.timeLeft)}s`;
  fishingCatchFill.parentElement?.setAttribute('aria-valuenow', String(Math.round(g.catchProgress)));
  fishingTensionFill.parentElement?.setAttribute('aria-valuenow', String(Math.round(g.tension)));
  if (g.catchProgress >= 100) return finishFishingCast(true, 'Fish caught');
  if (g.tension >= 100) return finishFishingCast(false, 'The line broke');
  if (g.timeLeft <= 0) return finishFishingCast(false, 'The fish escaped');
  fishingRaf = requestAnimationFrame(updateFishingCast);
}
function finishFishingCast(success, message, applyRewards = true) {
  if (!fishingGame) return null;
  const worldContext = worldActiveActivity?.kind === 'fishing' ? { ...worldActiveActivity } : null;
  const g = fishingGame; fishingGame = null;
  if (fishingRaf) cancelAnimationFrame(fishingRaf);
  const fishing = skills.find(s=>s.id==='Fishing');
  const rewards = [];
  if (applyRewards) {
    if (success) {
      const fishQty = g.usedBait === 'prime' ? 14 : g.usedBait === 'basic' ? 10 : 8;
      const xp = g.usedBait === 'prime' ? 150 : g.usedBait === 'basic' ? 100 : 80;
      fishing.qty += fishQty; fishing.xp += xp; rewards.push({itemId:'rawFish', quantity:fishQty}, {itemId:'fishingXp', quantity:xp});
      queueSkillXpDrop(fishing, xp);
      fishingBuffSecs = Math.max(fishingBuffSecs, g.usedBait === 'prime' ? 600 : 300);
      if (g.usedBait === 'basic' && Math.random() < 0.15) { uncommonFish += 1; rewards.push({itemId:'uncommonFish', quantity:1}); }
    } else { fishing.xp += 10; queueSkillXpDrop(fishing, 10); rewards.push({itemId:'fishingXp', quantity:10}); }
    tryLevelUp(fishing);
  } else {
    if (g.usedBait === 'basic') basicBait += 1;
    if (g.usedBait === 'prime') uncommonFish += 1;
    updateFishingBaitUI();
  }
  const result = { activity:'fishing', spot:'shallows', success, score:Math.round(g.catchProgress), rewards, usedBait:g.usedBait, timestamp:Date.now() };
  fishingStatus.textContent = `${message}. ${success ? 'Cast again for another catch.' : 'You can cast again immediately.'}`;
  startFishingCastBtn.disabled = false;
  startFishingCastBtn.textContent = 'Cast again';
  prepareBaitBtn.disabled = false;
  fishingBaitSelect.disabled = false;
  closeFishingBtn.textContent = 'Exit';
  fishingHolding = false;
  if (success) window.MomentumAudio.emit('catch'); else window.MomentumAudio.emit('lineBreak');
  if (success) logActivity(`Shallows catch: +${rewards.find(reward => reward.itemId === 'rawFish')?.quantity || 0} Raw Fish`, 'fishing');
  if (worldContext) {
    if (applyRewards) resolveWorldEncounter(success, false);
    else worldCancelEncounter();
  }
  return result;
}

/* =====================================
   ARENA ADAPTER AND RESULTS
===================================== */
let gauntletIntermissionTimer = null;

function openArena(tier, runLoadout, options = {}) {
  const food = arenaFoodDefinition(canonicalFoodId());
  clearTimeout(closeArenaBtn._confirmTimer);
  closeArenaBtn.dataset.confirmGiveUp = 'false';
  closeArenaBtn.textContent = 'Give up';
  window.MomentumArena.start({
    canvas:cv, tier, weapon:runLoadout,
    mode:options.mode || 'standard', directiveId:options.directiveId || null,
    maxHp:playerMaxHp(), carryState:options.carryState || null,
    combatBuild:options.combatBuild || buildArenaCombatBuild(tier, runLoadout),
    defensiveAbility:soloDeskDefensiveAbility,
    aura:soloDeskAura,
    food:food && foodCount(food.id) >= 1 ? food : null,
    talents:[...ownedCombatTalents],
    consumeFood:consumeFoodItem,
    reduceMotion:reduceMotionEnabled(),
    onEvent:(type, payload) => window.MomentumAudio.emit(type, payload),
    onFinish:handleArenaFinish,
    elements:{ modal, controls:arenaControls, tip:arenaTip, foodStatus:arenaFoodStatus, talentStatus:arenaTalentStatus, hpYou:hpYouEl, hpBoss:hpBossEl, hpYouFill, hpBossFill, dashStatus }
  });
}

function recordArenaResult(result) {
  const store = result.directiveId ? directiveRecords : arenaRecords;
  const key = result.directiveId || `${result.tierId}:${result.weaponId}`;
  const previous = store[key] || { attempts:0, wins:0, bestTime:null };
  previous.attempts += 1;
  if (result.win) {
    previous.wins += 1;
    previous.bestTime = previous.bestTime === null ? result.duration : Math.min(previous.bestTime, result.duration);
  }
  store[key] = previous;
  return previous;
}

function formatRunTime(seconds) {
  const minutes = Math.floor(seconds / 60);
  const remainder = (seconds % 60).toFixed(1).padStart(4, '0');
  return minutes ? `${minutes}:${remainder}` : `${remainder}s`;
}

function grantBossReward(tier, grantBuff = true) {
  const gotGem = Math.random() < tier.gemChance;
  skills.find(skill => skill.id === 'Mining').qty += tier.oreGain;
  if (gotGem) rareGems += 1;
  if (grantBuff) globalBuff.secs = Math.max(globalBuff.secs, 20 * 60);
  arenaWins[tier.id - 1] += 1;
  const loot = LOOT_FRAMEWORK?.rollLoot({
    sourceType:'arenaBoss',
    sourceId:`arena:${tier.id}`,
    sourceTier:tier.id,
    playerLevel:combatLevelForUI(),
    runId:`${tier.id}-${arenaWins[tier.id - 1]}-${Date.now()}`,
    itemChance: Math.min(1, 0.35 + tier.id * 0.10),
    minimumRarity:'uncommon'
  }, Math.random);
  const item = awardLootResolution(loot);
  if (item) logActivity(`Loot drop: ${lootLabel(item)} · ${item.affixes.length} affixes`, 'loot');
  logActivity(`Combat cache secured · +${loot?.salvage || 0} Salvage`, 'loot');
  return { ore:tier.oreGain, gem:gotGem, loot, item };
}

function applyArenaSkillProgression(result) {
  const tier = ARENA_TIERS[(Number(result.tierId) || 1) - 1];
  if (!tier || !COMBAT_PROGRESSION_FRAMEWORK?.progression) return null;
  const stage = tier.id * 10;
  const progression = COMBAT_PROGRESSION_FRAMEWORK.progression.applyCombatEncounterProgression(
    combatProgression,
    Array.isArray(result.skillEvents) ? result.skillEvents : [],
    result.win
      ? { outcome:'victory', stage }
      : { outcome:'defeat', stage, enemyHealthRemovedPercent:Number(result.enemyHealthRemovedPercent) || 0 }
  );
  combatProgression = progression.progression;
  soloDeskRecentXp = { ...progression.xpBySkill };
  if (soloFrontierRuntime) {
    soloFrontierRuntime.hydrate({ ...soloFrontierRuntime.getState(), combatProgression });
    syncSoloFrontierProjection();
  }
  return progression;
}

function resultStatsHtml(result, record = null) {
  return `<div class="result-grid"><span><small>Time</small><strong>${formatRunTime(result.duration)}</strong></span>${record ? `<span><small>Best</small><strong>${record.bestTime === null ? '—' : formatRunTime(record.bestTime)}</strong></span><span><small>Record</small><strong>${record.wins}/${record.attempts}</strong></span>` : ''}<span><small>Damage dealt</small><strong>${Math.round(result.damageDealt)}</strong></span><span><small>Damage taken</small><strong>${Math.round(result.damageTaken)}</strong></span><span><small>Dashes</small><strong>${result.dashesUsed}</strong></span><span><small>Shockwaves evaded</small><strong>${result.shockwavesEvaded}</strong></span><span><small>Highest Pressure</small><strong>${result.highestPressure}</strong></span><span><small>Food used</small><strong>${result.foodConsumed}</strong></span></div>`;
}

function handleArenaFinish(result) {
  if (activeGauntlet && !activeGauntlet.preparing) return handleGauntletPhase(result);
  const worldContext = worldActiveActivity?.kind === 'arena' ? { ...worldActiveActivity } : null;
  const tier = ARENA_TIERS[result.tierId - 1];
  const progression = applyArenaSkillProgression(result);
  const record = recordArenaResult(result);
  const rewards = result.win ? grantBossReward(tier) : null;
  const directive = FRONTIER_DIRECTIVES.find(candidate => candidate.id === result.directiveId);
  let starAwarded = false;
  if (result.win && directive && !completedDirectives.has(directive.id)) {
    completedDirectives.add(directive.id);
    starAwarded = true;
    logActivity(`Mastery Star earned: ${directive.name}`, 'frontier');
  }
  if (worldContext) resolveWorldEncounter(result.win, false);
  selectedDirective = null;
  const adventureText = worldContext ? (result.win ? ' · Adventure cache waiting' : ' · Returned to the outpost') : '';
  const xpText = progression ? ` · ${Math.round(progression.budget)} combat XP budget` : '';
  const rewardText = rewards ? `+${rewards.ore} Ore${rewards.gem ? ' · +1 Rare Gem' : ''} · Global 1.5x for 20m${xpText}${adventureText}` : result.reason === 'gaveUp' ? `Run abandoned · no rewards${adventureText}` : `No rewards${adventureText}`;
  resultMsg.innerHTML = `<div class="result-outcome ${result.win ? 'victory' : 'defeat'}">${directive ? directive.name : tier.name} ${result.win ? 'Complete' : result.reason === 'gaveUp' ? 'Abandoned' : 'Failed'}</div><div class="result-loadout">${result.weaponName} · ${result.styleId}${directive ? ` · ${tier.name} Directive` : ''}</div>${resultStatsHtml(result, record)}<div class="result-rewards">${rewardText}</div>${rewards ? lootResultMarkup(rewards.loot) : ''}${starAwarded ? `<div class="result-unlocks">★ Mastery Star earned · ${masteryStars()}/6</div>` : ''}`;
  resultModal.style.display = 'flex';
  renderArenaTierOptions(); renderFrontier();
  logActivity(`${directive?.name || tier.name} ${result.win ? 'completed' : 'failed'} with ${result.weaponName}`, result.win ? 'victory' : 'arena');
  saveGame();
}

function handleGauntletPhase(result) {
  const tier = ARENA_TIERS[activeGauntlet.bossIndex];
  activeGauntlet.phaseResults.push(result);
  activeGauntlet.skillEvents.push(...(Array.isArray(result.skillEvents) ? result.skillEvents : []));
  if (!result.win) return finishGauntlet(result.reason);

  const reward = grantBossReward(tier, false);
  activeGauntlet.bankedRewards.push({ tierId:tier.id, ...reward });
  activeGauntlet.carryState = result.carryState;
  if (activeGauntlet.bossIndex >= ARENA_TIERS.length - 1) return finishGauntlet('cleared');

  activeGauntlet.bossIndex += 1;
  activeGauntlet.awaitingNext = true;
  let seconds = 8;
  resultMsg.innerHTML = `<div class="result-outcome victory">${tier.name} Defeated</div><div class="result-loadout">Gauntlet ${activeGauntlet.bossIndex}/3 complete · rewards banked</div>${resultStatsHtml(result)}<div class="result-rewards">+${reward.ore} Ore${reward.gem ? ' · +1 Rare Gem' : ''}</div>${lootResultMarkup(reward.loot)}`;
  resultOk.disabled = true;
  resultOk.textContent = `Continue in ${seconds}s`;
  resultModal.style.display = 'flex';
  clearInterval(gauntletIntermissionTimer);
  gauntletIntermissionTimer = setInterval(() => {
    seconds -= 1;
    resultOk.textContent = seconds > 0 ? `Continue in ${seconds}s` : 'Continue Gauntlet';
    if (seconds <= 0) { clearInterval(gauntletIntermissionTimer); resultOk.disabled = false; }
  }, 1000);
  saveGame();
}

function continueGauntlet() {
  if (!activeGauntlet?.awaitingNext || resultOk.disabled) return;
  resultModal.style.display = 'none';
  activeGauntlet.awaitingNext = false;
  const tier = ARENA_TIERS[activeGauntlet.bossIndex];
  openArena(tier, activeGauntlet.loadout, { mode:'gauntlet', carryState:activeGauntlet.carryState, combatBuild:buildArenaCombatBuild(tier, activeGauntlet.loadout) });
}

function finishGauntlet(reason) {
  const cleared = reason === 'cleared';
  const progressionTier = activeGauntlet.phaseResults.reduce((highest, phase) => Math.max(highest, Number(phase.tierId) || 1), 1);
  const progression = applyArenaSkillProgression({
    tierId: progressionTier,
    win: cleared,
    enemyHealthRemovedPercent: cleared ? 100 : Number(activeGauntlet.phaseResults.at(-1)?.enemyHealthRemovedPercent) || 0,
    skillEvents: activeGauntlet.skillEvents
  });
  gauntletRecord.attempts += 1;
  const duration = (performance.now() - activeGauntlet.startedAt) / 1000;
  if (cleared) {
    gauntletRecord.clears += 1;
    gauntletRecord.bestTime = gauntletRecord.bestTime === null ? duration : Math.min(gauntletRecord.bestTime, duration);
    rareGems += 1;
    globalBuff.secs = Math.max(globalBuff.secs, 40 * 60);
  }
  const reached = activeGauntlet.bossIndex + 1;
  const rewards = activeGauntlet.bankedRewards;
  resultMsg.innerHTML = `<div class="result-outcome ${cleared ? 'victory' : 'defeat'}">Gauntlet ${cleared ? 'Cleared' : reason === 'gaveUp' ? 'Abandoned' : 'Failed'}</div><div class="result-loadout">Bosses defeated ${rewards.length}/3 · reached ${ARENA_TIERS[Math.min(reached - 1, 2)].name}</div><div class="result-grid"><span><small>Total time</small><strong>${formatRunTime(duration)}</strong></span><span><small>Best clear</small><strong>${gauntletRecord.bestTime === null ? '—' : formatRunTime(gauntletRecord.bestTime)}</strong></span><span><small>Banked Ore</small><strong>${rewards.reduce((sum, reward) => sum + reward.ore, 0)}</strong></span><span><small>Banked Gems</small><strong>${rewards.filter(reward => reward.gem).length}</strong></span></div><div class="result-rewards">${cleared ? 'Full clear: +1 Rare Gem · Global 1.5x for 40m' : 'Rewards from defeated bosses remain banked.'}${progression ? ` · ${Math.round(progression.budget)} combat XP budget` : ''}</div>`;
  resultOk.disabled = false; resultOk.textContent = 'Continue'; resultModal.style.display = 'flex';
  logActivity(`Frontier Gauntlet ${cleared ? 'cleared' : 'ended'} at ${ARENA_TIERS[Math.min(reached - 1, 2)].name}`, cleared ? 'victory' : 'arena');
  activeGauntlet = null;
  renderFrontier(); saveGame();
}

function prepareGauntlet() {
  if (masteryStars() < 6) return;
  const cost = ARENA_TIERS.reduce((sum, tier) => sum + tier.keyCost, 0);
  if (Math.floor(keys) < cost) { showToast(`Not enough Boss Keys for the Frontier Gauntlet: ${cost} required, ${Math.floor(keys)} available. You need ${cost - Math.floor(keys)} more.`, 4200); return; }
  selectedDirective = null;
  selectedArenaTier = 1;
  activeGauntlet = { preparing:true };
  preparedArenaTier = ARENA_TIERS[0];
  selectedArenaStyle = null;
  renderArenaPreparation();
  frontierModal.style.display = 'none';
  arenaPrepModal.style.display = 'flex';
}

function resetCraftingAssemblyUi() {
  craftingAssembly?.rafId && cancelAnimationFrame(craftingAssembly.rafId);
  craftingAssembly = null;
  if (craftingAssemblyMarker) craftingAssemblyMarker.style.left = '0%';
  if (craftingAssemblyTarget) craftingAssemblyTarget.style.left = '44%';
  if (craftingAssemblyBar) craftingAssemblyBar.setAttribute('aria-valuenow', '0');
  if (startCraftingAssemblyBtn) startCraftingAssemblyBtn.disabled = false;
  if (hitCraftingAssemblyBtn) hitCraftingAssemblyBtn.disabled = true;
}

function finishCraftingAssembly() {
  if (!craftingAssembly) return;
  const worldContext = worldActiveActivity?.kind === 'crafting' ? { ...worldActiveActivity } : null;
  const activity = SKILL_FRAMEWORK?.craftingActivity;
  const score = craftingAssembly.score / Math.max(1, craftingAssembly.attempts);
  const multiplier = activity ? SKILL_FRAMEWORK.resolveActiveSkillBonus(activity, score) : 1;
  const duration = activity?.durationMs || 7000;
  const durationMultiplier = skillSpecializations.Crafting === 'improvisation' ? 1.25 : 1;
  craftingActiveBonus = { multiplier, expiresAt:performance.now() + duration * durationMultiplier };
  const quality = multiplier >= 1.45 ? 'excellent' : multiplier >= 1.25 ? 'clean' : 'rough';
  craftingActivityStatus.textContent = `Assembly ${quality}: ${multiplier.toFixed(2)}× Crafting for ${Math.round(duration * durationMultiplier / 1000)}s.`;
  showToast(`Crafting assembly ${quality} · ${multiplier.toFixed(2)}×`, 2800);
  logActivity(`Crafting assembly ${quality} · ${multiplier.toFixed(2)}×`, 'craft');
  resetCraftingAssemblyUi();
  if (worldContext && !resolveWorldEncounter(true, true)) worldCancelEncounter();
  saveGame();
}

function updateCraftingAssembly(now) {
  if (!craftingAssembly) return;
  const activity = SKILL_FRAMEWORK?.craftingActivity;
  const elapsed = now - craftingAssembly.startedAt;
  const duration = activity?.durationMs || 7000;
  if (elapsed >= duration || craftingAssembly.attempts >= 3) {
    finishCraftingAssembly();
    return;
  }
  const phase = (elapsed % 1200) / 1200;
  const position = phase <= 0.5 ? phase * 2 : (1 - phase) * 2;
  craftingAssembly.position = position;
  craftingAssemblyMarker.style.left = `${position * 100}%`;
  craftingAssembly.rafId = requestAnimationFrame(updateCraftingAssembly);
}

function openCraftingAssembly(context = null) {
  if (!craftingModal) return;
  if (context) worldActiveActivity = context;
  if (!SKILL_CFG.Crafting.canAct()) {
    showToast('Crafting needs at least 1 Bar and 1 Pine Log.');
    if (context) worldCancelEncounter();
    return;
  }
  resetCraftingAssemblyUi();
  craftingActivityStatus.textContent = 'Start a run, then lock three timing pulses inside the target zone.';
  craftingModal.style.display = 'flex';
}

function startCraftingAssembly() {
  if (!SKILL_CFG.Crafting.canAct() || craftingAssembly) return;
  craftingAssembly = { startedAt:performance.now(), position:0, score:0, attempts:0, rafId:null };
  startCraftingAssemblyBtn.disabled = true;
  hitCraftingAssemblyBtn.disabled = false;
  craftingActivityStatus.textContent = 'Lock the marker inside the target zone.';
  craftingAssembly.rafId = requestAnimationFrame(updateCraftingAssembly);
}

function hitCraftingAssembly() {
  if (!craftingAssembly) return;
  const position = craftingAssembly.position;
  const success = position >= 0.40 && position <= 0.60;
  craftingAssembly.attempts += 1;
  if (success) craftingAssembly.score += 1;
  craftingActivityStatus.textContent = success ? 'Timing locked.' : 'Missed the target. Recalibrating…';
  if (craftingAssembly.attempts >= 3) finishCraftingAssembly();
}

function closeCraftingAssembly() {
  resetCraftingAssemblyUi();
  craftingModal.style.display = 'none';
  if (worldActiveActivity?.kind === 'crafting') worldCancelEncounter();
}

/* =====================================
   MODAL UX
===================================== */
const uiModalIds = [
  'settingsModal','frontierModal','specModal','talentModal','combatTreeModal','loadoutModal','gearModal','baseUpModal','skillUpModal',
  'offlineModal','resultModal','arenaPrepModal','fishingModal','craftingModal','arenaModal','taskbarSummaryModal'
];
const uiModals = uiModalIds.map(id => document.getElementById(id)).filter(Boolean);
const modalReturnFocus = new WeakMap();

function visibleUiModals() {
  return uiModals.filter(overlay => getComputedStyle(overlay).display !== 'none');
}

function modalFocusableElements(overlay) {
  return [...overlay.querySelectorAll('button:not(:disabled),select:not(:disabled),input:not(:disabled),[href],[tabindex]:not([tabindex="-1"])')]
    .filter(element => !element.hidden && getComputedStyle(element).visibility !== 'hidden');
}

function syncModalEnvironment(openedOverlay = null) {
  const visible = visibleUiModals();
  const top = visible[visible.length - 1] || null;
  document.body.classList.toggle('modal-open', Boolean(top));
  [...document.body.children].forEach(child => {
    const keepInteractive = !top || child === top || child === document.getElementById('toastHost') || child === document.getElementById('levelHost') || child === confettiCanvas;
    if (!keepInteractive && !child.inert) {
      child.inert = true;
      child.dataset.modalInert = 'true';
    } else if (keepInteractive && child.dataset.modalInert === 'true') {
      child.inert = false;
      delete child.dataset.modalInert;
    }
  });
  uiModals.forEach(overlay => overlay.setAttribute('aria-hidden', String(overlay !== top)));
  if (openedOverlay && openedOverlay === top) {
    const active = document.activeElement;
    if (active && !openedOverlay.contains(active)) modalReturnFocus.set(openedOverlay, active);
    requestAnimationFrame(() => {
      const initial = openedOverlay.id === 'arenaModal' ? cv : modalFocusableElements(openedOverlay)[0];
      initial?.focus({ preventScroll:true });
    });
  }
}

uiModals.forEach(overlay => {
  overlay.setAttribute('aria-hidden', 'true');
  new MutationObserver(() => {
    const opened = getComputedStyle(overlay).display !== 'none';
    if (opened) syncModalEnvironment(overlay);
    else {
      const returnTarget = modalReturnFocus.get(overlay);
      modalReturnFocus.delete(overlay);
      syncModalEnvironment();
      if (!visibleUiModals().length && returnTarget?.isConnected) requestAnimationFrame(() => returnTarget.focus({ preventScroll:true }));
    }
  }).observe(overlay, { attributes:true, attributeFilter:['style','class'] });
});

document.addEventListener('keydown', event => {
  if (event.key !== 'Tab') return;
  const visible = visibleUiModals();
  const top = visible[visible.length - 1];
  if (!top) return;
  const focusable = modalFocusableElements(top);
  if (!focusable.length) { event.preventDefault(); top.focus?.(); return; }
  const first = focusable[0];
  const last = focusable[focusable.length - 1];
  if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
  else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
}, true);

const dismissibleModals = [
  ['settingsModal','closeSettingsBtn'], ['frontierModal','closeFrontier'], ['specModal','closeSpecs'],
  ['talentModal','closeTalents'], ['combatTreeModal','closeCombatTree'], ['loadoutModal','closeLoadout'], ['gearModal','closeGear'],
  ['baseUpModal','closeBaseUp'], ['skillUpModal','closeSkillUp'], ['craftingModal','closeCrafting']
];
function topVisibleDismissibleModal() {
  return dismissibleModals.map(([modalId,closeId]) => ({ modal:document.getElementById(modalId), close:document.getElementById(closeId) })).reverse().find(entry => entry.modal?.style.display === 'flex');
}
document.addEventListener('keydown', event => {
  if (event.key !== 'Escape' || window.MomentumArena.isRunning() || activeGauntlet?.awaitingNext) return;
  if (arenaPrepModal.style.display === 'flex') { closeArenaPreparation(); return; }
  if (fishingModal.style.display === 'flex') { closeFishing(); return; }
  if (craftingModal.style.display === 'flex') { closeCraftingAssembly(); return; }
  const entry = topVisibleDismissibleModal();
  if (entry) entry.close.click();
});
dismissibleModals.forEach(([modalId,closeId]) => {
  const overlay = document.getElementById(modalId);
  overlay?.addEventListener('mousedown', event => { if (event.target === overlay) document.getElementById(closeId).click(); });
});

/* =====================================
   EVENTS
===================================== */
function soloDeskSetOrder(order, farmStage = null) {
  if (!window.MomentumSoloFrontierRuntime) return;
  if (order === 'push') window.MomentumSoloFrontierRuntime.push();
  else if (order === 'farm') window.MomentumSoloFrontierRuntime.farm(Number(farmStage || soloFarmStageSelect?.value || soloDeskState().highestClearedStage || 1));
  else window.MomentumSoloFrontierRuntime.pause();
  soloDeskLastOutcome = null;
  soloDeskOutcomeAt = 0;
  renderSoloFrontierDesk();
}

document.getElementById('soloPushBtn')?.addEventListener('click', () => soloDeskSetOrder('push'));
document.getElementById('soloPushTopBtn')?.addEventListener('click', () => soloDeskSetOrder('push'));
document.getElementById('soloFarmBtn')?.addEventListener('click', () => soloDeskSetOrder('farm'));
document.getElementById('soloPauseBtn')?.addEventListener('click', () => soloDeskSetOrder('paused'));
soloFarmStageSelect?.addEventListener('change', () => {
  const stage = Number(soloFarmStageSelect.value);
  if (stage > 0) {
    window.MomentumSoloFrontierRuntime.setFarmStage(stage);
    soloDeskSetOrder('farm', stage);
  }
});
soloFallbackStageSelect?.addEventListener('change', () => {
  const value = soloFallbackStageSelect.value ? Number(soloFallbackStageSelect.value) : null;
  window.MomentumSoloFrontierRuntime.setFallback(value);
});
soloStanceSelect?.addEventListener('change', () => { soloDeskStance = soloStanceSelect.value; renderSoloFrontierDesk(); saveGame(); });
soloTechniqueSelect?.addEventListener('change', () => { soloDeskTechnique = soloTechniqueSelect.value; renderSoloFrontierDesk(); saveGame(); });
soloDefensiveSelect?.addEventListener('change', () => { soloDeskDefensiveAbility = soloDefensiveSelect.value; renderSoloFrontierDesk(); saveGame(); });
soloAuraSelect?.addEventListener('change', () => { soloDeskAura = soloAuraSelect.value; renderSoloFrontierDesk(); saveGame(); });
document.getElementById('soloOpenPaperDollBtn')?.addEventListener('click', () => {
  soloPaperDollDetails.open = true;
  soloPaperDollDetails.scrollIntoView({ block:'center', behavior:reduceMotionEnabled() ? 'auto' : 'smooth' });
});
soloCacheRarityFilter?.addEventListener('change', () => {
  soloDeskCacheRarity = soloCacheRarityFilter.value;
  soloDeskCachePage = 0;
  const cache = LOOT_FRAMEWORK.setLootFilters(soloDeskState().lootCache, { globalMinimumRarity:soloDeskCacheRarity });
  soloDeskCacheMutation(cache);
});
soloCacheSlotFilter?.addEventListener('change', () => { soloDeskCacheSlot = soloCacheSlotFilter.value; soloDeskCachePage = 0; renderSoloFrontierDesk(); });
soloCacheSort?.addEventListener('change', () => { soloDeskCacheSort = soloCacheSort.value; soloDeskCachePage = 0; renderSoloFrontierDesk(); });
soloCacheFavouritesOnly?.addEventListener('change', () => { soloDeskCacheFavouritesOnly = soloCacheFavouritesOnly.checked; soloDeskCachePage = 0; renderSoloFrontierDesk(); });
soloCachePrevPage?.addEventListener('click', () => { soloDeskCachePage = Math.max(0, soloDeskCachePage - 1); renderSoloCache(soloDeskState()); });
soloCacheNextPage?.addEventListener('click', () => { soloDeskCachePage += 1; renderSoloCache(soloDeskState()); });
document.querySelectorAll('[data-solo-debrief-action]').forEach(button => button.addEventListener('click', () => soloDeskDebriefAction(button.dataset.soloDebriefAction)));
soloQaSeedStage?.addEventListener('click', () => window.MomentumSoloFrontierDebug?.seedProgress(2));
soloQaForceDefeat?.addEventListener('click', () => window.MomentumSoloFrontierDebug?.forceDefeat());
soloQaFillCache?.addEventListener('click', () => window.MomentumSoloFrontierDebug?.fillCache(35));
soloQaClearCache?.addEventListener('click', () => window.MomentumSoloFrontierDebug?.clearCache());
document.querySelectorAll('[data-skill-matrix-view]').forEach(button => button.addEventListener('click', () => {
  const combat = button.dataset.skillMatrixView === 'combat';
  productionSkillMatrix.hidden = combat;
  combatSkillMatrix.hidden = !combat;
  document.querySelectorAll('[data-skill-matrix-view]').forEach(candidate => {
    const active = candidate === button;
    candidate.classList.toggle('is-active', active);
    candidate.setAttribute('aria-selected', String(active));
  });
  if (combat) renderSoloCombatSkills(soloDeskState());
}));
window.addEventListener('resize', () => renderSoloFrontierDesk());

operationsToggle?.addEventListener('click', () => setOperationsExpanded(!operationsExpanded));
objectiveActionBtn?.addEventListener('click', () => {
  const action = objectiveActionBtn.dataset.objectiveAction;
  if (action === 'start-mining') {
    const mining = skills.find(skill => skill.id === 'Mining');
    if (mining && !mining.active) {
      mining.active = true;
      const toggle = document.getElementById('skill-toggle-mining');
      if (toggle) toggle.checked = true;
      startWarmup();
      showToast('Mining online · Ore production started');
    }
    document.querySelector('.skill-mining')?.scrollIntoView({ block:'center', behavior:reduceMotionEnabled() ? 'auto' : 'smooth' });
    document.getElementById('skill-toggle-mining')?.focus({ preventScroll:true });
    return;
  }
  if (action === 'craft-gear') { renderGear(); gearModal.style.display='flex'; return; }
  if (action === 'open-field') {
    setGameView('field');
    requestAnimationFrame(() => document.querySelector('.card-arena')?.scrollIntoView({ block:'center', behavior:reduceMotionEnabled() ? 'auto' : 'smooth' }));
    return;
  }
  if (action === 'open-adventure') {
    setGameView('adventure');
    renderWorld(true);
    requestAnimationFrame(() => document.querySelector('.card-adventure')?.scrollIntoView({ block:'start', behavior:reduceMotionEnabled() ? 'auto' : 'smooth' }));
    return;
  }
  if (action === 'open-frontier') { renderFrontier(); frontierModal.style.display='flex'; return; }
  setGameView('hub');
  requestAnimationFrame(() => document.querySelector('.card-skills')?.scrollIntoView({ block:'start', behavior:reduceMotionEnabled() ? 'auto' : 'smooth' }));
});

document.getElementById('openBaseUpBtn').onclick = ()=>{ renderBaseUps(); baseUpModal.style.display='flex'; };
document.getElementById('openGearBtn').onclick = ()=>{ renderGear(); gearModal.style.display='flex'; };
document.getElementById('openLoadoutBtn').onclick = ()=>{ renderLoadout(); loadoutModal.style.display='flex'; };
document.getElementById('closeLoadout').onclick = ()=> loadoutModal.style.display='none';
document.getElementById('closeGear').onclick = ()=> gearModal.style.display='none';
document.getElementById('closeBaseUp').onclick   = ()=> baseUpModal.style.display='none';

document.getElementById('openTalentsBtn').onclick = () => { renderTalents(); talentModal.style.display='flex'; };
document.getElementById('closeTalents').onclick = () => talentModal.style.display='none';
document.getElementById('closeCombatTree').onclick = () => combatTreeModal.style.display='none';
respecCombatTree.onclick = () => {
  if (!selectedCombatTreeSkill) return;
  const state = soloDeskState();
  const result = FRONTIER_EXCHANGE_FRAMEWORK.purchaseTreeRespec(state.frontierExchange, frontierWallet(), state.lootCache, state.combatDevelopment, selectedCombatTreeSkill);
  applyFrontierTransaction(result);
};
refundTalentsBtn.onclick = () => {
  if (window.MomentumArena.isRunning() || ownedCombatTalents.size === 0) return;
  const state = soloDeskState();
  const cost = COMBAT_DEVELOPMENT_FRAMEWORK.respecCost(ownedCombatTalents.size);
  if (!confirm(`Respec Arena Discipline for ${cost} Gold? All spent points will return.`)) return;
  const transaction = FRONTIER_EXCHANGE_FRAMEWORK.purchaseArenaDisciplineRespec(state.frontierExchange, frontierWallet(), state.lootCache, ownedCombatTalents.size, window.MomentumArena.isRunning());
  if (!applyFrontierTransaction(transaction)) return;
  ownedCombatTalents.clear();
  combatSkillTreeView = { ...combatSkillTreeView, focusNodeId:null };
  logActivity(`Arena Discipline reset · ${cost} Gold`, 'talent');
  saveGame();
  renderTalents();
};
document.getElementById('clearLedgerBtn').onclick = () => { activityLedger = []; renderActivityLedger(); };
document.getElementById('openFrontierBtn').onclick = () => { renderFrontier(); frontierModal.style.display='flex'; };
document.getElementById('closeFrontier').onclick = () => frontierModal.style.display='none';
startGauntletBtn.onclick = prepareGauntlet;
document.getElementById('openSpecsBtn').onclick = () => { renderSpecializations(); specModal.style.display='flex'; };
document.getElementById('closeSpecs').onclick = () => specModal.style.display='none';
muteAudio.onchange = () => { gameSettings.muted = muteAudio.checked; window.MomentumAudio.setMuted(gameSettings.muted); };
audioVolume.oninput = () => { gameSettings.volume = Number(audioVolume.value); window.MomentumAudio.setVolume(gameSettings.volume); };
reduceMotion.onchange = () => { gameSettings.reduceMotion = reduceMotion.checked; applySettings(); };
window.matchMedia?.('(prefers-reduced-motion: reduce)').addEventListener?.('change', applySettings);
document.getElementById('openSettingsBtn').onclick = () => { applySettings(); settingsModal.style.display='flex'; };
document.getElementById('closeSettingsBtn').onclick = () => settingsModal.style.display='none';
document.querySelectorAll('[data-game-view]').forEach(button => button.onclick = () => setGameView(button.dataset.gameView));
document.getElementById('viewCharacterBtn').onclick = () => { renderLoadout(); loadoutModal.style.display='flex'; };
document.querySelectorAll('[data-quick-view]').forEach(button => button.onclick = () => setGameView(button.dataset.quickView));
document.getElementById('quickInventory').onclick = () => { renderLoadout(); loadoutModal.style.display='flex'; };
document.getElementById('quickSettings')?.addEventListener('click', () => { applySettings(); settingsModal.style.display='flex'; });

document.getElementById('openSkillUpBtn').onclick= ()=>{ renderSkillUps('Mining'); skillUpModal.style.display='flex'; };
document.getElementById('closeSkillUp').onclick  = ()=> skillUpModal.style.display='none';
document.querySelectorAll('#skillUpModal [data-tab]').forEach(btn=>{
  btn.onclick = ()=> renderSkillUps(btn.getAttribute('data-tab'));
});

closeArenaBtn.onclick = () => {
  if (closeArenaBtn.dataset.confirmGiveUp !== 'true') {
    closeArenaBtn.dataset.confirmGiveUp = 'true';
    closeArenaBtn.textContent = 'Confirm give up';
    closeArenaBtn._confirmTimer = setTimeout(() => {
      closeArenaBtn.dataset.confirmGiveUp = 'false';
      closeArenaBtn.textContent = 'Give up';
    }, 3000);
    return;
  }
  clearTimeout(closeArenaBtn._confirmTimer);
  window.MomentumArena.giveUp();
};
document.getElementById('openFishingBtn').onclick = openFishing;
document.getElementById('closeFishing').onclick = closeFishing;
startCraftingAssemblyBtn.onclick = startCraftingAssembly;
hitCraftingAssemblyBtn.onclick = hitCraftingAssembly;
closeCraftingBtn.onclick = closeCraftingAssembly;
document.getElementById('startFishingCast').onclick = startFishingCast;
document.getElementById('prepareBaitBtn').onclick = prepareBasicBait;
function clearFishingInput() { fishingHolding = false; }
function isUiControlTarget(target) { return target instanceof Element && Boolean(target.closest('button,input,select,textarea,a[href],[contenteditable="true"]')); }
fishingPlayfield.addEventListener('pointerdown', e => {
  e.preventDefault();
  fishingHolding = true;
  try { fishingPlayfield.setPointerCapture(e.pointerId); } catch {}
});
fishingPlayfield.addEventListener('pointerup', clearFishingInput);
fishingPlayfield.addEventListener('pointercancel', clearFishingInput);
fishingPlayfield.addEventListener('lostpointercapture', clearFishingInput);
window.addEventListener('pointerup', clearFishingInput);
window.addEventListener('blur', clearFishingInput);
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') clearFishingInput(); });
window.addEventListener('keydown', e => {
  if (e.code === 'Space' && fishingModal.style.display === 'flex' && !isUiControlTarget(e.target)) {
    e.preventDefault();
    fishingHolding = true;
  }
});
window.addEventListener('keyup', e => { if (e.code === 'Space') clearFishingInput(); });
offlineOk.onclick = () => { offlineModal.style.display = 'none'; pendingOfflineSummary = null; };
saveBtn.onclick = () => saveGame(true);
resetSaveBtn.onclick = resetSave;
recycleScrapBtn.onclick = () => {
  if (!evaluateRequirements([{type:'resource',resource:'Scrap',value:scrapRecycleCost()}]).met) return;
  scrap -= scrapRecycleCost();
  skills.find(s=>s.id==='Mining').qty += 1;
  showToast(`Recycled ${scrapRecycleCost()} Scrap into 1 Ore`);
};

arenaTierSelect.onchange = () => {
  const requested = Number(arenaTierSelect.value);
  selectedArenaTier = requested <= arenaTierUnlocked ? requested : arenaTierUnlocked;
  if (!FRONTIER_DIRECTIVES.some(directive => directive.id === selectedDirective && directive.tierId === selectedArenaTier)) selectedDirective = null;
  updateArenaTierUI();
};
fightBtn.onclick = openArenaPreparation;
document.getElementById('cancelArenaPrep').onclick = closeArenaPreparation;
confirmArenaRun.onclick = startPreparedArenaRun;

resultOk.onclick = () => {
  if (activeGauntlet?.awaitingNext) { continueGauntlet(); return; }
  resultModal.style.display = 'none';
  lastFightResult = null;
};
