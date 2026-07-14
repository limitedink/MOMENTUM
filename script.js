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

const MAX_SKILL_LEVEL = 100;   // set to 99, 100, 120, 500, 1000... your call
const skills = [
  { id:'Mining',   basePerSec: RATE_BASE, active:false, qty:0, lvl:1, xp:0, next: xpToNext(1), progress:0 },
  { id:'Smithing', basePerSec: RATE_BASE, active:false, qty:0, lvl:1, xp:0, next: xpToNext(1), progress:0 },
  { id:'Combat',   basePerSec: RATE_BASE, active:false, qty:0, lvl:1, xp:0, next: xpToNext(1), progress:0 },
  { id:'Fishing',  basePerSec: RATE_BASE, active:false, qty:0, lvl:1, xp:0, next: xpToNext(1), progress:0 },
  { id:'Cooking',  basePerSec: 1 / 2.5, active:false, qty:0, lvl:1, xp:0, next: xpToNext(1), progress:0 },
  { id:'Woodchopping', basePerSec: RATE_BASE, active:false, qty:0, lvl:1, xp:0, next: xpToNext(1), progress:0 },
]

let unlockedNormalSlots = 6;
let hone = null;
let honingMult = 1.8;
let keys = 0;
let rareGems = 0;
let scrap = 0;
let basicBait = 0;
let uncommonFish = 0;
let fishingBuffSecs = 0;
let burntFish = 0;
const woodInventory = { pine:0, oak:0, yew:0, ancient:0 };
let selectedTree = 'pine';
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
let keyRateMult = 1.0;  // multiplies boss keys



const ARENA_TIERS = [
  { id:1, name:'Initiate', requiredCombatLevel:5, requirements:[{type:'skillLevel',skill:'Combat',value:5},{type:'resource',resource:'Boss Keys',value:3}], keyCost:3, bossHp:30, bossSpeed:40, contactDps:15, waveDamage:28, waveCooldown:4.0, projectileCount:0, projectileCooldown:0, projectileSpeed:0, projectileDamage:0, projectileSpread:0, attackLabel:'Shockwave', oreGain:600, gemChance:0.25 },
  { id:2, name:'Vanguard', requiredCombatLevel:10, requirements:[{type:'skillLevel',skill:'Combat',value:10},{type:'arenaTier',value:2},{type:'resource',resource:'Boss Keys',value:5}], keyCost:5, bossHp:70, bossSpeed:55, contactDps:20, waveDamage:36, waveCooldown:3.4, projectileCount:1, projectileCooldown:2.8, projectileSpeed:180, projectileDamage:16, projectileSpread:0, attackLabel:'Aimed shot', oreGain:1000, gemChance:0.50 },
  { id:3, name:'Apex', requiredCombatLevel:15, requirements:[{type:'skillLevel',skill:'Combat',value:15},{type:'arenaTier',value:3},{type:'resource',resource:'Boss Keys',value:8}], keyCost:8, bossHp:120, bossSpeed:70, contactDps:25, waveDamage:44, waveCooldown:2.8, projectileCount:3, projectileCooldown:2.2, projectileSpeed:220, projectileDamage:18, projectileSpread:0.18, attackLabel:'Spread volley', oreGain:1600, gemChance:1.00 }
];
let arenaTierUnlocked = 1;
let selectedArenaTier = 1;
let arenaWins = [0, 0, 0];



let lastFightResult = null;   // stores result after arena closes

/* =====================================
   DOM HOOKS
===================================== */
const skillsDiv = document.getElementById('skills');
const honeSelect = document.getElementById('honeSelect');
const honedLabel = document.getElementById('honedLabel');
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

const baseUpModal = document.getElementById('baseUpModal');
const skillUpModal = document.getElementById('skillUpModal');
const gearModal = document.getElementById('gearModal');
const gearList = document.getElementById('gearList');
const loadoutModal = document.getElementById('loadoutModal');
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
const offlineModal = document.getElementById('offlineModal');
const offlineSummary = document.getElementById('offlineSummary');
const offlineOk = document.getElementById('offlineOk');

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
  celebrateRain({
    streamsPerFrame: 1,     // ↓ these two = more gaps in the shower
    particlesPerStream: 4,
    durationMs: 1100
  });
  celebrateFireworks({
    bursts: 8,
    particlesPerBurst: 120  // ↑ this for denser fireworks
  });
}










function showToast(text, ms=2000) {
  const host = document.getElementById('toastHost');
  const el = document.createElement('div');
  el.className = 'toast';
  el.textContent = text;
  host.appendChild(el);
  requestAnimationFrame(()=> el.classList.add('show'));
  setTimeout(()=>{
    el.classList.remove('show');
    setTimeout(()=> el.remove(), 220);
  }, ms);
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
  Combat: [
    { level:5, label:'Initiate Arena + Talent Point' },
    { level:10, label:'Vanguard Arena + Talent Point' },
    { level:15, label:'Apex Arena + Talent Point' },
    { level:20, label:'Combat Discipline Talent Point' },
    { level:25, label:'Combat Discipline Talent Point' },
    { level:30, label:'Final Combat Discipline Talent Point' }
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
  Woodchopping: [
    { level:15, label:'Woodchopping specializations' },
    { level:30, label:'Oak trees' },
    { level:75, label:'Yew trees' },
    { level:90, label:'Ancient trees' }
  ]
};

const COMBAT_TALENT_LEVELS = [5, 10, 15, 20, 25, 30];
const COMBAT_TALENTS = [
  { id:'dashStrike', branch:'mobility', tier:1, name:'Dash Strike', description:'First attack within 0.75s after a Dash deals 50% additional damage.', requires:[] },
  { id:'flowRecovery', branch:'mobility', tier:2, fork:'mobilityTechnique', name:'Flow Recovery', description:'Evading a shockwave during Dash reduces Dash cooldown by 0.4s.', requires:['dashStrike'] },
  { id:'slipstream', branch:'mobility', tier:2, fork:'mobilityTechnique', name:'Slipstream', description:'After Dashing, move faster for one second.', requires:['dashStrike'] },
  { id:'longstride', branch:'mobility', tier:2, fork:'mobilityTechnique', name:'Longstride', description:'Dash lasts 40% longer, trading frequency for safer traversal.', requires:['dashStrike'] },
  { id:'afterimage', branch:'mobility', tier:3, capstone:true, name:'Afterimage', description:'Dashing creates a 1.5s projectile-decoy.', requires:['flowRecovery'] },
  { id:'phaseRush', branch:'mobility', tier:3, capstone:true, name:'Phase Rush', description:'Dashing through the boss staggers it once per Dash.', requires:['slipstream'] },
  { id:'ghostStep', branch:'mobility', tier:3, capstone:true, name:'Ghost Step', description:'Remain invulnerable for 0.35s after Dash ends.', requires:['longstride'] },
  { id:'openingAttack', branch:'assault', tier:1, name:'Opening Attack', description:'First successful hit of each run deals double damage.', requires:[] },
  { id:'pressure', branch:'assault', tier:2, fork:'assaultTechnique', name:'Pressure', description:'Consecutive hits build damage; missing or taking damage resets it.', requires:['openingAttack'] },
  { id:'counterforce', branch:'assault', tier:2, fork:'assaultTechnique', name:'Counterforce', description:'Taking damage arms the next attack for 50% additional damage.', requires:['openingAttack'] },
  { id:'cadence', branch:'assault', tier:2, fork:'assaultTechnique', name:'Cadence', description:'Every third consecutive hit deals 40% additional damage.', requires:['openingAttack'] },
  { id:'executioner', branch:'assault', tier:3, capstone:true, name:'Executioner', description:'Once per run, hitting below 25% HP deals 15% maximum HP bonus damage.', requires:['pressure'] },
  { id:'reprisal', branch:'assault', tier:3, capstone:true, name:'Reprisal', description:'Counterforce hits also restore 12 HP.', requires:['counterforce'] },
  { id:'overdrive', branch:'assault', tier:3, capstone:true, name:'Overdrive', description:'Cadence hits stagger the boss and immediately ready the next attack.', requires:['cadence'] },
  { id:'fieldRation', branch:'survival', tier:1, name:'Field Ration', description:'Automatically consumes equipped Food below 35% HP.', requires:[] },
  { id:'secondWind', branch:'survival', tier:2, fork:'survivalTechnique', name:'Second Wind', description:'Once per run, lethal damage leaves you at 1 HP.', requires:['fieldRation'] },
  { id:'guardedRecovery', branch:'survival', tier:2, fork:'survivalTechnique', name:'Guarded Recovery', description:'Successfully Dashing a shockwave restores 8 HP.', requires:['fieldRation'] },
  { id:'combatNutrition', branch:'survival', tier:2, fork:'survivalTechnique', name:'Combat Nutrition', description:'Consuming Food grants a barrier against the next damage instance.', requires:['fieldRation'] },
  { id:'fortifiedRecovery', branch:'survival', tier:3, capstone:true, name:'Fortified Recovery', description:'Once per run, recover 25 HP after avoiding damage for 6s.', requires:['secondWind'] },
  { id:'aegis', branch:'survival', tier:3, capstone:true, name:'Aegis', description:'A shockwave evade arms a barrier that prevents the next damage instance.', requires:['guardedRecovery'] },
  { id:'lastSupper', branch:'survival', tier:3, capstone:true, name:'Last Supper', description:'Combat Nutrition barriers absorb two damage instances instead of one.', requires:['combatNutrition'] }
]
const ownedCombatTalents = new Set();
let arenaRecords = {};
let activityLedger = [];

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
const skillSpecializations = { Mining:null, Smithing:null, Fishing:null, Cooking:null, Woodchopping:null };
const specializationProgress = { Mining:0, Fishing:0, Cooking:0, Woodchopping:0, WoodUpgrade:0 };
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
  operationsList.innerHTML = visible.length ? visible.map(state => `<article class="operation${state.complete ? ' is-complete' : ''}"><div><strong>${state.operation.name}</strong><p>${state.operation.detail}</p><span class="operation-reward">Reward: ${state.operation.reward}</span></div><div class="operation-state"><span>${state.value}/${state.target}</span><div class="operation-meter"><i style="width:${Math.min(100,state.value/state.target*100)}%"></i></div><button class="btn" data-claim-operation="${state.operation.id}" ${state.complete ? '' : 'disabled'}>${state.complete ? 'Claim' : 'In progress'}</button></div></article>`).join('') : '<div class="operations-complete"><strong>All current Operations complete.</strong><span>Push records, Mastery, and specializations while the next frontier is prepared.</span></div>';
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
function frontierUnlocked() { return arenaWins[2] > 0; }

function earnedCombatTalentPoints() {
  const combatLevel = skills.find(skill => skill.id === 'Combat').lvl;
  return COMBAT_TALENT_LEVELS.filter(level => combatLevel >= level).length;
}

function availableCombatTalentPoints() {
  return earnedCombatTalentPoints() - ownedCombatTalents.size;
}

function evaluateRequirements(requirements = []) {
  const missing = [];
  for (const requirement of requirements) {
    if (requirement.type === 'skillLevel') {
      const level = skills.find(skill => skill.id === requirement.skill)?.lvl || 0;
      if (level < requirement.value) missing.push(`${requirement.skill} ${requirement.value}`);
    }
    if (requirement.type === 'resource') {
      const amount = requirement.resource === 'Ore' ? skills.find(skill => skill.id === 'Mining').qty
        : requirement.resource === 'Bars' ? skills.find(skill => skill.id === 'Smithing').qty
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


// Handles level ups and clamps to MAX_SKILL_LEVEL
function tryLevelUp(s) {
  while (s.lvl < MAX_SKILL_LEVEL && s.xp >= s.next) {
    s.xp  -= s.next;
    s.lvl += 1;
    s.next = xpToNext(s.lvl);
    const milestone = milestoneAtLevel(s.id, s.lvl);
    if (s.id === 'Combat' && milestone) renderArenaTierOptions();
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
  { id:'keysmith', name:'Keysmith I', desc:'+25% Boss Key generation', cost:{ bars:80 }, apply(){ keyRateMult *= 1.25; } },
  { id:'keysmith2', name:'Keysmith II', desc:'+25% additional Boss Key generation', requirements:[{type:'skillLevel',skill:'Combat',value:20}], cost:{ bars:180 }, apply(){ keyRateMult *= 1.25; } },
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
  Combat: [
    { id:'ammo1', name:'Hardened Rounds', desc:'+3 bullet damage', cost:{ bars:120 }, apply(){ BULLET_DAMAGE += 3; } },
  ],
  Cooking: [
    { id:'heatControl1', name:'Heat Control I', desc:'+10 percentage points cooking success', cost:{ ore:100 }, apply(){} },
    { id:'heatControl2', name:'Heat Control II', desc:'Failed cooks have a 25% chance to preserve the Raw Fish', requirements:[{type:'skillLevel',skill:'Cooking',value:20}], cost:{ ore:220, bars:40 }, apply(){} },
    { id:'stove1', name:'Efficient Stove', desc:'10% faster Cooking attempts', cost:{ ore:160, bars:30 }, apply(){ const skill=skills.find(candidate=>candidate.id==='Cooking'); skill.basePerSec=clampPerSec(skill.basePerSec*1.10); } }
  ],
  Woodchopping: [
    { id:'axe1', name:'Sharpened Axe', desc:'10% faster Woodchopping', cost:{ ore:120, bars:30 }, apply(){} },
    { id:'logSplitter', name:'Log Splitter', desc:'Every eighth chop produces one bonus log', requirements:[{type:'skillLevel',skill:'Woodchopping',value:20}], cost:{ ore:240, bars:70 }, apply(){} },
    { id:'axe2', name:'Tempered Axe', desc:'A further 12% faster Woodchopping', requirements:[{type:'skillLevel',skill:'Woodchopping',value:40}], cost:{ ore:400, bars:140 }, apply(){} }
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

const LOADOUT_SLOTS = ['melee','ranged','gun','magic','armor','tool','food'];
const ownedGear = new Set();
const ownedItems = new Set(['pulseSidearm']);
let equippedTool = null;
let equipment = { melee:null, ranged:null, gun:'pulseSidearm', magic:null, armor:null, tool:null, food:null };
const weaponRefinements = { pulseSidearm:0, ironBlade:0 };
const MAX_WEAPON_REFINEMENT = 5;
function weaponDamage(item) {
  return item.damage + (weaponRefinements[item.id] || 0) * 2;
}
function gearRateMult(skillId) {
  if (skillId === 'Mining' && equipment.tool === 'reinforcedPick') return 1.25;
  if (skillId === 'Smithing' && equipment.tool === 'forgeGauntlet') return 1.25;
  return 1;
}
function playerMaxHp() { return equipment.armor === 'platedVest' ? 125 : 100; }
function equippedGun() { return ITEMS[equipment.gun] || ITEMS.pulseSidearm; }

const ARENA_STYLES = [
  { id:'melee', name:'Melee', slot:'melee', implemented:true, playstyle:'Close the distance, aim with the pointer, and commit to directional swings.' },
  { id:'ranged', name:'Ranged', slot:'ranged', implemented:false, playstyle:'Keep distance and pressure targets with deliberate physical shots.' },
  { id:'gun', name:'Gun', slot:'gun', implemented:true, playstyle:'Stay mobile, aim with the pointer, and left click to fire accurate shots.' },
  { id:'magic', name:'Magic', slot:'magic', implemented:false, playstyle:'Control space with spell casts and resource-driven burst damage.' }
];
let selectedArenaStyle = null;

/* =====================================
   SAVE / LOAD
===================================== */
const SAVE_KEY = 'momentum-save';
const SAVE_VERSION = 12;
const AUTO_SAVE_MS = 10_000;
let resetInProgress = false;

function createSaveData() {
  return {
    version: SAVE_VERSION,
    savedAt: Date.now(),
    skills: skills.map(({ id, basePerSec, active, qty, lvl, xp, progress }) => ({
      id, basePerSec, active, qty, lvl, xp, progress
    })),
    unlockedNormalSlots,
    hone,
    honingMult,
    keys,
    rareGems,
    scrap,
    basicBait,
    uncommonFish,
    fishingBuffSecs,
    globalBuff: { ...globalBuff },
    baseMult,
    keyRateMult,
    bulletDamage: BULLET_DAMAGE,
    ownedBaseUps: [...ownedBaseUps],
    ownedSkillUps: [...ownedSkillUps],
    ownedGear: [...ownedGear],
    equippedTool: equipment.tool,
    ownedItems: [...ownedItems],
    equipment: { ...equipment },
    weaponRefinements: { ...weaponRefinements },
    combatTalents: [...ownedCombatTalents],
    arenaRecords: { ...arenaRecords },
    activityLedger: [...activityLedger],
    frontier: {
      completedDirectives:[...completedDirectives], selectedDirective,
      directiveRecords:{ ...directiveRecords }, combatPresets:combatPresets.map(preset => preset ? { ...preset, talents:[...preset.talents] } : null),
      gauntletRecord:{ ...gauntletRecord }
    },
    foodInventory:{ smokedRations, surgefinRations, burntFish },
    woodchopping:{ selectedTree, inventory:{ ...woodInventory } },
    skillSpecializations:{ ...skillSpecializations },
    specializationProgress:{ ...specializationProgress },
    settings:{ ...gameSettings },
    claimedOperations:[...claimedOperations],
    arenaTierUnlocked,
    selectedArenaTier,
    arenaWins: [...arenaWins]
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
    const save = JSON.parse(raw);
    if (![1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, SAVE_VERSION].includes(save.version)) return false;

    save.skills.forEach(savedSkill => {
      const skill = skills.find(s => s.id === savedSkill.id);
      if (!skill) return;
      skill.basePerSec = savedSkill.basePerSec;
      skill.active = savedSkill.active;
      skill.qty = savedSkill.qty;
      skill.lvl = savedSkill.lvl;
      skill.xp = savedSkill.xp;
      skill.next = xpToNext(skill.lvl);
      skill.progress = savedSkill.progress;
    });

    unlockedNormalSlots = Math.max(save.unlockedNormalSlots, skills.length);
    hone = skills.some(s => s.id === save.hone) ? save.hone : null;
    honingMult = save.honingMult;
    keys = save.keys;
    rareGems = save.rareGems;
    scrap = save.version >= 2 ? save.scrap ?? 0 : 0;
    basicBait = save.version >= 5 ? save.basicBait ?? 0 : 0;
    uncommonFish = save.version >= 5 ? save.uncommonFish ?? 0 : 0;
    fishingBuffSecs = save.version >= 5 ? save.fishingBuffSecs ?? 0 : 0;
    globalBuff = { ...save.globalBuff };
    baseMult = save.baseMult;
    keyRateMult = save.keyRateMult;
    BULLET_DAMAGE = save.bulletDamage;

    ownedBaseUps.clear();
    save.ownedBaseUps.forEach(id => ownedBaseUps.add(id));
    ownedSkillUps.clear();
    save.ownedSkillUps.forEach(id => ownedSkillUps.add(id));
    ownedGear.clear();
    if (save.version >= 3) save.ownedGear.forEach(id => ownedGear.add(id));
    ownedItems.clear();
    ownedItems.add('pulseSidearm');
    ownedGear.forEach(id => ownedItems.add(id));
    if (save.version >= 6) save.ownedItems.forEach(id => { if (ITEMS[id]) ownedItems.add(id); });
    const legacyTool = save.version >= 3 && ownedGear.has(save.equippedTool) ? save.equippedTool : null;
    equipment = save.version >= 6 ? { ...equipment, ...save.equipment } : { melee:null, ranged:null, gun:'pulseSidearm', magic:null, armor:ownedGear.has('platedVest')?'platedVest':null, tool:legacyTool, food:null };
    LOADOUT_SLOTS.forEach(slot => { if (equipment[slot] && !ownedItems.has(equipment[slot]) && equipment[slot] !== 'rawFish') equipment[slot] = null; });
    if (!equipment.gun) equipment.gun = 'pulseSidearm';
    if (save.version >= 7) {
      Object.keys(weaponRefinements).forEach(id => {
        weaponRefinements[id] = clamp(Number(save.weaponRefinements?.[id]) || 0, 0, MAX_WEAPON_REFINEMENT);
      });
    }
    equippedTool = equipment.tool;
    ownedCombatTalents.clear();
    if (save.version >= 8) validateLoadedTalents(save.combatTalents || []).forEach(id => ownedCombatTalents.add(id));
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
      claimedOperations.clear();
      if (save.version >= 12) (save.claimedOperations || []).forEach(id => { if (OPERATIONS.some(operation => operation.id === id)) claimedOperations.add(id); });
    }
    if (save.version >= 10) {
      burntFish = Math.max(0, Number(save.foodInventory?.burntFish) || 0);
      Object.keys(woodInventory).forEach(id => { woodInventory[id] = Math.max(0, Number(save.woodchopping?.inventory?.[id]) || 0); });
      const woodLevel = skills.find(skill => skill.id === 'Woodchopping').lvl;
      selectedTree = TREE_TYPES.some(tree => tree.id === save.woodchopping?.selectedTree && woodLevel >= tree.level) ? save.woodchopping.selectedTree : 'pine';
    }
    if (equipment.food === 'rawFish') equipment.food = null;
    arenaTierUnlocked = save.version >= 4 ? save.arenaTierUnlocked : 1;
    selectedArenaTier = save.version >= 4 ? Math.min(save.selectedArenaTier, arenaTierUnlocked) : 1;
    arenaWins = save.version >= 4 ? [...save.arenaWins] : [0, 0, 0];

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
  Woodchopping: {
    forester:{ name:'Forester', description:'Every fifth successful chop produces one bonus log.' },
    arborist:{ name:'Arborist', description:'Earn 50% more Woodchopping XP without changing log output.' },
    trailblazer:{ name:'Trailblazer', description:'Chop 25% faster, but 20% of actions produce no log; ideal for leveling quickly.' }
  }
};

// Per skill tuning. All equal by default.
const SKILL_CFG = {
  Mining: { xpPerAction: 20, onAction(s){
    if (skillSpecializations.Mining === 'vein') {
      specializationProgress.Mining += 1;
      if (specializationProgress.Mining >= 5) { specializationProgress.Mining = 0; s.qty += 7; logActivity('Vein Mining released +7 Ore', 'specialization'); }
    } else s.qty += 1;
  } },
  Smithing: {
    xpPerAction: 20,
    waitingLabel:'waiting for Ore',
    canAct(){ return skills.find(s=>s.id==='Mining').qty >= SMELT_ORE_COST; },
    onAction(s){
      const mining = skills.find(x=>x.id==='Mining');
      mining.qty -= SMELT_ORE_COST;
      const failed = skillSpecializations.Smithing !== 'precision' && Math.random() < SMELT_FAIL_CHANCE;
      if (failed) {
        scrap += skillSpecializations.Smithing === 'reclamation' ? 2 : 1;
        if (skillSpecializations.Smithing === 'reclamation') {
          while (scrap >= scrapRecycleCost()) { scrap -= scrapRecycleCost(); mining.qty += 1; }
        }
        showToast(`Smelt failed: Scrap recovered`, 1200);
      } else s.qty += 1;
    }
  },
  Fishing: { xpPerAction: 20, onAction(s){
    if (skillSpecializations.Fishing === 'baitcraft') {
      specializationProgress.Fishing += 1;
      if (specializationProgress.Fishing >= 5) { specializationProgress.Fishing = 0; basicBait += 1; logActivity('Baitcraft produced +1 Basic Bait', 'specialization'); }
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
  Woodchopping: {
    xpPerAction:20,
    onAction(s){
      specializationProgress.Woodchopping += 1;
      specializationProgress.WoodUpgrade += 1;
      const missed = skillSpecializations.Woodchopping === 'trailblazer' && Math.random() < 0.20;
      let logs = missed ? 0 : 1;
      if (skillSpecializations.Woodchopping === 'forester' && specializationProgress.Woodchopping % 5 === 0) logs += 1;
      if (ownedSkillUps.has('logSplitter') && specializationProgress.WoodUpgrade % 8 === 0) logs += 1;
      if (skillSpecializations.Woodchopping === 'arborist') s.xp += 10;
      woodInventory[selectedTree] += logs;
      s.qty += logs;
    }
  },
  Combat:   { xpPerAction: 20, onAction(){
    const keysPerAction = 0.10 * keyRateMult;
    keys += keysPerAction;
    // no s.qty for Combat right now
  } }
};
// Safe getter if you add new skills later
function getSkillCfg(id){
  return SKILL_CFG[id] || { xpPerAction: 10, onAction(s){ /* no op */ } };
}
function cookingSuccessChance(level) {
  const upgrade = ownedSkillUps.has('heatControl1') ? 0.10 : 0;
  const spec = skillSpecializations.Cooking === 'careful' ? 0.20 : 0;
  const streak = skillSpecializations.Cooking === 'flamekeeper' ? Math.min(0.45, specializationProgress.Cooking * 0.15) : 0;
  return Math.min(0.99, 0.30 + Math.max(0, level - 1) * 0.007 + upgrade + spec + streak);
}
function skillActionRate(skill) {
  if (skill.id === 'Woodchopping') {
    let rate = TREE_TYPES.find(tree => tree.id === selectedTree)?.perSec || 1 / 2.5;
    if (ownedSkillUps.has('axe1')) rate *= 1.10;
    if (ownedSkillUps.has('axe2')) rate *= 1.12;
    if (skillSpecializations.Woodchopping === 'trailblazer') rate *= 1.40;
    return rate;
  }
  if (skill.id === 'Cooking' && skillSpecializations.Cooking === 'careful') return skill.basePerSec * 0.75;
  return skill.basePerSec;
}
function effectiveProductionRate(skill, efficiency, honing, buff = 1) {
  const sharedEfficiency = skill.id === 'Cooking' || skill.id === 'Woodchopping' ? 1 : efficiency;
  return clampPerSec(skillActionRate(skill) * sharedEfficiency * honing * baseMult * buff * gearRateMult(skill.id) * fishingRateMult(skill.id));
}

function productiveSkills() {
  return skills.filter(skill => {
    if (!skill.active) return false;
    const cfg = getSkillCfg(skill.id);
    return !cfg.canAct || cfg.canAct();
  });
}

let pendingOfflineSummary = null;
function applyOfflineProgress(savedAt) {
  const elapsed = Math.min(offlineMaxSeconds(), Math.max(0, (Date.now() - Number(savedAt || Date.now())) / 1000));
  if (elapsed < OFFLINE_MIN_SECONDS) return;

  const before = {
    ore: skills.find(skill => skill.id === 'Mining').qty,
    bars: skills.find(skill => skill.id === 'Smithing').qty,
    fish: skills.find(skill => skill.id === 'Fishing').qty,
    cookedFish: skills.find(skill => skill.id === 'Cooking').qty,
    logs: skills.find(skill => skill.id === 'Woodchopping').qty,
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

      if (skill.id === 'Mining') {
        if (skillSpecializations.Mining === 'vein') {
          const total = specializationProgress.Mining + actions;
          skill.qty += Math.floor(total / 5) * 7;
          specializationProgress.Mining = total % 5;
        } else skill.qty += actions;
      }
      if (skill.id === 'Smithing') {
        actions = Math.min(actions, Math.floor(skills.find(candidate => candidate.id === 'Mining').qty));
        const ore = skills.find(candidate => candidate.id === 'Mining');
        ore.qty -= actions;
        const failures = skillSpecializations.Smithing === 'precision' ? 0 : actions * SMELT_FAIL_CHANCE;
        scrap += failures * (skillSpecializations.Smithing === 'reclamation' ? 2 : 1);
        if (skillSpecializations.Smithing === 'reclamation') {
          const recycled = Math.floor(scrap / scrapRecycleCost());
          scrap -= recycled * scrapRecycleCost();
          ore.qty += recycled;
        }
        skill.qty += actions - failures;
      }
      if (skill.id === 'Fishing') {
        if (skillSpecializations.Fishing === 'baitcraft') {
          const total = specializationProgress.Fishing + actions;
          const baitActions = Math.floor(total / 5);
          basicBait += baitActions;
          skill.qty += actions - baitActions;
          specializationProgress.Fishing = total % 5;
        } else skill.qty += actions;
      }
      if (skill.id === 'Cooking') {
        const rawFish = skills.find(candidate => candidate.id === 'Fishing');
        const fishPerAction = skillSpecializations.Cooking === 'batch' ? 2 : 1;
        const fishAttempts = Math.min(actions * fishPerAction, Math.floor(rawFish.qty));
        rawFish.qty -= fishAttempts;
        const successes = fishAttempts * cookingSuccessChance(skill.lvl);
        const failures = fishAttempts - successes;
        skill.qty += successes;
        burntFish += failures;
        if (ownedSkillUps.has('heatControl2')) rawFish.qty += failures * 0.25;
      }
      if (skill.id === 'Woodchopping') {
        let logs = actions;
        if (skillSpecializations.Woodchopping === 'trailblazer') logs *= 0.8;
        if (skillSpecializations.Woodchopping === 'forester') logs += Math.floor((specializationProgress.Woodchopping + actions) / 5);
        if (ownedSkillUps.has('logSplitter')) logs += Math.floor((specializationProgress.WoodUpgrade + actions) / 8);
        specializationProgress.Woodchopping = (specializationProgress.Woodchopping + actions) % 5;
        specializationProgress.WoodUpgrade = (specializationProgress.WoodUpgrade + actions) % 8;
        if (skillSpecializations.Woodchopping === 'arborist') addXpSilently(skill, actions * 10);
        woodInventory[selectedTree] += logs; skill.qty += logs;
      }
      if (skill.id === 'Combat') keys += actions * 0.10 * keyRateMult;
      addXpSilently(skill, actions * getSkillCfg(skill.id).xpPerAction);
    }

    globalBuff.secs = Math.max(0, globalBuff.secs - dt);
    fishingBuffSecs = Math.max(0, fishingBuffSecs - dt);
    remaining -= dt;
  }

  pendingOfflineSummary = {
    seconds: elapsed,
    capped: elapsed >= offlineMaxSeconds(),
    ore: skills.find(skill => skill.id === 'Mining').qty - before.ore,
    bars: skills.find(skill => skill.id === 'Smithing').qty - before.bars,
    fish: skills.find(skill => skill.id === 'Fishing').qty - before.fish,
    cookedFish: skills.find(skill => skill.id === 'Cooking').qty - before.cookedFish,
    logs: skills.find(skill => skill.id === 'Woodchopping').qty - before.logs,
    burntFish: burntFish - before.burntFish,
    keys: keys - before.keys,
    scrap: scrap - before.scrap
  };
}

function showOfflineSummary() {
  if (!pendingOfflineSummary) return;
  const summary = pendingOfflineSummary;
  const hours = Math.floor(summary.seconds / 3600);
  const minutes = Math.floor((summary.seconds % 3600) / 60);
  const rows = [
    ['Ore', summary.ore], ['Bars', summary.bars], ['Raw Fish', summary.fish], ['Cooked Fish', summary.cookedFish], ['Burnt Fish', summary.burntFish], ['Logs', summary.logs],
    ['Boss Keys', summary.keys], ['Scrap', summary.scrap]
  ].filter(([, amount]) => amount > 0.001);
  offlineSummary.innerHTML = `<p>Away for ${hours ? `${hours}h ` : ''}${minutes}m${summary.capped ? ` (${offlineMaxSeconds() / 3600}h cap reached)` : ''}.</p>${rows.length ? rows.map(([name, amount]) => `<div><span>${name}</span><strong>+${amount.toFixed(1)}</strong></div>`).join('') : '<p>No active skills produced resources.</p>'}`;
  offlineModal.style.display = 'flex';
  logActivity(`Offline progress: ${hours ? `${hours}h ` : ''}${minutes}m processed`, 'offline');
}

function fishingRateMult(skillId) { return skillId === 'Fishing' && fishingBuffSecs > 0 ? 1.5 : 1; }

function validateLoadedTalents(ids) {
  const selected = new Set();
  let capstoneOwned = false;
  const selectedForks = new Set();
  const known = new Set(ids.filter(id => COMBAT_TALENTS.some(talent => talent.id === id)));
  for (const talent of COMBAT_TALENTS) {
    if (!known.has(talent.id) || selected.size >= earnedCombatTalentPoints()) continue;
    if (!talent.requires.every(id => selected.has(id))) continue;
    if (talent.fork && selectedForks.has(talent.fork)) continue;
    if (talent.capstone && capstoneOwned) continue;
    selected.add(talent.id);
    if (talent.fork) selectedForks.add(talent.fork);
    if (talent.capstone) capstoneOwned = true;
  }
  return [...selected];
}

function canSelectTalent(talent) {
  if (ownedCombatTalents.has(talent.id)) return { allowed:false, reason:'Selected' };
  if (availableCombatTalentPoints() <= 0) return { allowed:false, reason:'No points available' };
  const missing = talent.requires.filter(id => !ownedCombatTalents.has(id));
  if (missing.length) return { allowed:false, reason:'Requires previous talent' };
  if (talent.fork && COMBAT_TALENTS.some(candidate => candidate.id !== talent.id && candidate.fork === talent.fork && ownedCombatTalents.has(candidate.id))) return { allowed:false, reason:'Other fork selected' };
  if (talent.capstone && COMBAT_TALENTS.some(candidate => candidate.capstone && ownedCombatTalents.has(candidate.id))) {
    return { allowed:false, reason:'Another capstone selected' };
  }
  return { allowed:true, reason:'Available' };
}

function renderTalents() {
  const earned = earnedCombatTalentPoints();
  talentPointSummary.innerHTML = `<span>Combat ${skills.find(skill => skill.id === 'Combat').lvl}</span><strong>${availableCombatTalentPoints()} available</strong><span>${ownedCombatTalents.size}/${earned} spent</span><span>Build: ${combatBuildLabel()}</span><span>Next point: ${COMBAT_TALENT_LEVELS.find(level => level > skills.find(skill => skill.id === 'Combat').lvl) || 'all earned'}</span>`;
  const branchNames = { mobility:'Mobility', assault:'Assault', survival:'Survival' };
  talentBranches.innerHTML = Object.entries(branchNames).map(([branch, name]) => {
    const talents = COMBAT_TALENTS.filter(talent => talent.branch === branch);
    const renderNode = talent => {
      const selected = ownedCombatTalents.has(talent.id);
      const state = canSelectTalent(talent);
      return `<button class="talent-node${selected ? ' is-selected' : ''}${talent.capstone ? ' is-capstone' : ''}" data-talent="${talent.id}" ${selected || !state.allowed ? 'disabled' : ''}><span class="talent-tier">${talent.capstone ? 'CAPSTONE' : `TIER ${talent.tier}`}</span><strong>${talent.name}</strong><span>${talent.description}</span><em>${selected ? 'Selected' : state.reason}</em></button>`;
    };
    return `<section class="talent-branch branch-${branch}"><h3>${name}</h3>${renderNode(talents.find(talent => talent.tier === 1))}<div class="talent-split" aria-hidden="true"><i></i><i></i><i></i></div><div class="talent-fork-row">${talents.filter(talent => talent.tier === 2).map(renderNode).join('')}</div><div class="talent-path-lines" aria-hidden="true"><i></i><i></i><i></i></div><div class="talent-fork-row">${talents.filter(talent => talent.tier === 3).map(renderNode).join('')}</div></section>`;
  }).join('');
  talentBranches.querySelectorAll('[data-talent]').forEach(button => {
    button.onclick = () => {
      if (window.MomentumArena.isRunning()) return;
      const talent = COMBAT_TALENTS.find(candidate => candidate.id === button.dataset.talent);
      if (!canSelectTalent(talent).allowed) return;
      ownedCombatTalents.add(talent.id);
      logActivity(`Selected talent: ${talent.name}`, 'talent');
      renderTalents();
    };
  });
  refundTalentsBtn.disabled = ownedCombatTalents.size === 0 || window.MomentumArena.isRunning();
}

function renderFrontier() {
  const unlocked = frontierUnlocked();
  const stars = masteryStars();
  frontierSummary.textContent = unlocked ? `${stars}/6 Mastery Stars · ${stars >= 6 ? 'Gauntlet unlocked' : 'Complete Directives to advance'}` : 'Defeat Apex to unlock authored combat Directives.';
  document.getElementById('openFrontierBtn').disabled = !unlocked;
  document.getElementById('openFrontierBtn').textContent = unlocked ? `Open Frontier (${stars}/6 Stars)` : 'Frontier Locked';
  if (!unlocked) return;

  masteryProgress.innerHTML = `<strong>${stars}/6 Mastery Stars</strong><span class="mastery-track"><i style="width:${stars / 6 * 100}%"></i></span><span>2★ Presets · 4★ Field Kitchen · 6★ Gauntlet</span>`;
  directiveList.innerHTML = FRONTIER_DIRECTIVES.map(directive => {
    const complete = completedDirectives.has(directive.id);
    const record = directiveRecords[directive.id];
    return `<article class="directive-card${complete ? ' is-complete' : ''}"><div class="directive-tier">${ARENA_TIERS[directive.tierId - 1].name}</div><h3>${directive.name}</h3><p>${directive.description}</p><div class="small">${complete ? '★ Complete' : '☆ Mastery Star available'}${record?.bestTime ? ` · Best ${formatRunTime(record.bestTime)}` : ''}</div><button class="btn" data-directive="${directive.id}">Prepare Directive</button></article>`;
  }).join('');
  directiveList.querySelectorAll('[data-directive]').forEach(button => button.onclick = () => {
    const directive = FRONTIER_DIRECTIVES.find(candidate => candidate.id === button.dataset.directive);
    selectedDirective = directive.id;
    selectedArenaTier = directive.tierId;
    renderArenaTierOptions();
    frontierModal.style.display = 'none';
    openArenaPreparation();
  });

  presetList.innerHTML = combatPresets.map((preset, index) => `<div class="preset-card"><div><strong>Preset ${index + 1}</strong><div class="small">${preset ? `${preset.styleId} · ${preset.talents.length} talents · ${ITEMS[preset.foodId]?.name || 'No Food'}` : 'Empty slot'}</div></div><select class="btn" data-preset-style="${index}"><option value="gun">Gun</option><option value="melee" ${equipment.melee ? '' : 'disabled'}>Melee</option></select><button class="btn" data-save-preset="${index}">Save Current</button><button class="btn" data-apply-preset="${index}" ${preset ? '' : 'disabled'}>Apply</button></div>`).join('');
  presetList.querySelectorAll('[data-save-preset]').forEach(button => button.onclick = () => {
    const index = Number(button.dataset.savePreset);
    const styleId = presetList.querySelector(`[data-preset-style="${index}"]`).value;
    const itemId = equipment[styleId === 'melee' ? 'melee' : 'gun'];
    if (!itemId) { showToast(`No ${styleId} weapon equipped`); return; }
    combatPresets[index] = { styleId, itemId, armorId:equipment.armor, foodId:equipment.food, talents:[...ownedCombatTalents] };
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

  startGauntletBtn.disabled = stars < 6 || Math.floor(keys) < ARENA_TIERS.reduce((sum, tier) => sum + tier.keyCost, 0);
  startGauntletBtn.textContent = stars < 6 ? 'Locked — 6 Stars' : `Prepare Gauntlet (${ARENA_TIERS.reduce((sum, tier) => sum + tier.keyCost, 0)} Keys)`;
}

function applyCombatPreset(index) {
  if (masteryStars() < 2 || window.MomentumArena.isRunning()) return;
  const preset = combatPresets[index];
  if (!preset) return;
  if (!ownedItems.has(preset.itemId)) { showToast('Preset weapon is no longer available'); return; }
  if (preset.armorId && !ownedItems.has(preset.armorId)) { showToast('Preset armor is no longer available'); return; }
  if (preset.foodId && foodCount(preset.foodId) < 1) { showToast(`No ${ITEMS[preset.foodId]?.name || 'preset Food'} available`); return; }
  const validTalents = validateLoadedTalents(preset.talents);
  ownedCombatTalents.clear(); validTalents.forEach(id => ownedCombatTalents.add(id));
  equipment[preset.styleId === 'melee' ? 'melee' : 'gun'] = preset.itemId;
  equipment.armor = preset.armorId || null;
  equipment.food = preset.foodId || null;
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

function applySettings() {
  muteAudio.checked = gameSettings.muted;
  audioVolume.value = gameSettings.volume;
  reduceMotion.checked = gameSettings.reduceMotion;
  document.body.classList.toggle('reduce-motion', gameSettings.reduceMotion);
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
  arenaTierDetails.textContent = `${tier.bossHp} Boss HP · Combat ${tier.requiredCombatLevel} · ${tier.attackLabel} · ${tier.oreGain} Ore · ${Math.round(tier.gemChance * 100)}% Gem · Wins ${arenaWins[tier.id - 1]}`;
  fightBtn.textContent = requirementState.met ? `Prepare Arena Run (${tier.keyCost} Keys)` : `Requires ${requirementState.missing.join(' · ')}`;
  fightBtn.disabled = !requirementState.met;
}

let preparedArenaTier = null;

function arenaStyleState(style) {
  const itemId = equipment[style.slot];
  const weapon = ITEMS[itemId];
  if (!weapon) return { style, weapon:null, available:false, status:'Empty slot' };
  if (!ownedItems.has(itemId) || weapon.unavailable) return { style, weapon, available:false, status:'Unavailable' };
  if (!style.implemented) return { style, weapon, available:false, status:'Combat support coming next' };
  return { style, weapon, available:true, status:'Available' };
}

function captureArenaWeapon(state) {
  const { style, weapon } = state;
  const damage = style.id === 'gun'
    ? BULLET_DAMAGE + (weaponRefinements[weapon.id] || 0) * 2
    : weaponDamage(weapon);
  return Object.freeze({
    styleId: style.id,
    itemId: weapon.id,
    name: weapon.name,
    damage,
    attackInterval: weapon.attackInterval,
    playstyle: style.playstyle,
    projectileSpeed: weapon.projectileSpeed,
    lifetime: weapon.lifetime,
    range: weapon.range,
    swingArcDeg: weapon.swingArcDeg,
    trait: weapon.trait
  });
}

function renderArenaPreparation() {
  const tier = preparedArenaTier;
  if (!tier) return;
  const states = ARENA_STYLES.map(arenaStyleState);
  const selectedState = states.find(state => state.style.id === selectedArenaStyle && state.available);
  if (!selectedState) selectedArenaStyle = null;

  const directive = FRONTIER_DIRECTIVES.find(candidate => candidate.id === selectedDirective && candidate.tierId === tier.id);
  arenaPrepTierSummary.innerHTML = `<strong>${activeGauntlet ? 'Frontier Gauntlet' : `${tier.name} Arena`}</strong><span>${activeGauntlet ? ARENA_TIERS.reduce((sum, item) => sum + item.keyCost, 0) : tier.keyCost} Boss Keys</span><span>${activeGauntlet ? '3 bosses' : `${tier.bossHp} Boss HP`}</span>`;
  arenaDirectiveBanner.textContent = activeGauntlet ? 'Gauntlet: HP, Food, and once-per-run talents persist across all three bosses.' : directive ? `Directive: ${directive.name} — ${directive.description}` : 'Standard run · no Directive';
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
  if (!arenaTierAvailable(tier, true)) return;
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
}

function startPreparedArenaRun() {
  const tier = preparedArenaTier;
  const state = ARENA_STYLES.map(arenaStyleState).find(candidate => candidate.style.id === selectedArenaStyle && candidate.available);
  if (!tier || !state) return;
  const gauntlet = Boolean(activeGauntlet?.preparing);
  const cost = gauntlet ? ARENA_TIERS.reduce((sum, item) => sum + item.keyCost, 0) : tier.keyCost;
  if (Math.floor(keys) < cost) { renderArenaPreparation(); return; }

  const runLoadout = captureArenaWeapon(state);
  keys -= cost;
  arenaPrepModal.style.display = 'none';
  preparedArenaTier = null;
  selectedArenaStyle = null;
  updateArenaTierUI();

  if (gauntlet) {
    activeGauntlet = {
      bossIndex:0, loadout:runLoadout, carryState:null, phaseResults:[], bankedRewards:[],
      startedAt:performance.now(), awaitingNext:false
    };
    selectedDirective = null;
    openArena(ARENA_TIERS[0], runLoadout, { mode:'gauntlet' });
  } else {
    const directive = FRONTIER_DIRECTIVES.find(candidate => candidate.id === selectedDirective && candidate.tierId === tier.id);
    openArena(tier, runLoadout, { mode:directive ? 'directive' : 'standard', directiveId:directive?.id || null });
  }
}
function renderGear() {
  gearList.innerHTML = '';
  const smithing = skills.find(s => s.id === 'Smithing');
  GEAR.forEach(item => {
    const owned = ownedGear.has(item.id);
    const equipped = equipment[item.slot] === item.id;
    const requirementState = evaluateRequirements(item.requirements);
    const unlocked = requirementState.met;
    const row = document.createElement('div');
    row.className = 'workshop-row';
    row.innerHTML = `<div style="font-weight:600">${item.name}</div><div style="opacity:.9; margin:2px 0 6px">${item.desc}</div><div class="flex"><span>${owned ? 'Crafted' : unlocked ? `Cost: ${item.cost} Bars` : `Requires: ${requirementState.missing.join(' · ')}`}</span><button class="btn" ${equipped || !unlocked ? 'disabled' : ''}>${equipped ? 'Equipped' : owned ? 'Equip' : unlocked ? 'Craft' : 'Locked'}</button></div>`;
    row.querySelector('button').onclick = () => {
      if (!ownedGear.has(item.id)) {
        if (!evaluateRequirements([{type:'resource',resource:'Bars',value:item.cost}]).met) { showToast('Not enough Bars'); return; }
        smithing.qty -= item.cost;
        ownedGear.add(item.id);
        ownedItems.add(item.id);
        showToast(`Crafted ${item.name}`);
        logActivity(`Crafted ${item.name}`, 'craft');
      }
      equipment[item.slot] = item.id;
      if (item.slot === 'tool') equippedTool = item.id;
      renderGear();
      renderLoadout();
    };
    gearList.appendChild(row);
  });

  const refinable = ['pulseSidearm', 'ironBlade'].filter(id => ownedItems.has(id));
  if (refinable.length) gearList.insertAdjacentHTML('beforeend', '<h3>Weapon Refinement</h3><div class="small">Spend existing Bars and Rare Gems for permanent +2 damage, up to +5.</div>');
  refinable.forEach(id => {
    const item = ITEMS[id];
    const level = weaponRefinements[id];
    const maxed = level >= MAX_WEAPON_REFINEMENT;
    const barCost = 25 * (level + 1);
    const row = document.createElement('div');
    row.className = 'workshop-row';
    row.innerHTML = `<div style="font-weight:600">${item.name} +${level}</div><div class="small">${weaponDamage(item)} damage</div><div class="flex"><span>${maxed ? 'Maximum refinement' : `Cost: ${barCost} Bars, 1 Rare Gem`}</span><button class="btn" ${maxed ? 'disabled' : ''}>${maxed ? 'Maxed' : 'Refine'}</button></div>`;
    row.querySelector('button').onclick = () => {
      if (maxed) return;
      const refinementRequirements = evaluateRequirements([{type:'resource',resource:'Bars',value:barCost},{type:'resource',resource:'Rare Gems',value:1}]);
      if (!refinementRequirements.met) { showToast(`Requires ${refinementRequirements.missing.join(' · ')}`); return; }
      smithing.qty -= barCost;
      rareGems -= 1;
      weaponRefinements[id] += 1;
      showToast(`${item.name} refined to +${weaponRefinements[id]}`);
      logActivity(`${item.name} refined to +${weaponRefinements[id]}`, 'craft');
      renderGear();
      renderLoadout();
    };
    gearList.appendChild(row);
  });

  gearList.insertAdjacentHTML('afterbegin', `<div style="margin-bottom:10px">Bars: ${smithing.qty.toFixed(0)} · Rare Gems: ${rareGems} · Tool: ${ITEMS[equipment.tool]?.name || 'None'}</div>`);
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
  if (item.slot !== 'food' && !ownedItems.has(itemId)) return;
  equipment[item.slot] = itemId;
  if (item.slot === 'tool') equippedTool = itemId;
  renderLoadout();
}
function renderLoadout() {
  if (!loadoutSlots) return;
  loadoutSlots.innerHTML = LOADOUT_SLOTS.map(slot => {
    const item = ITEMS[equipment[slot]];
    return `<div class="loadout-slot"><div class="slot-name">${slot === 'magic' ? 'Magic Spell' : slot}</div><strong>${item?.name || 'Empty'}</strong><div class="small">${itemStats(item)}</div>${item ? `<button class="btn" data-unequip="${slot}">Unequip</button>` : ''}</div>`;
  }).join('');
  loadoutSlots.querySelectorAll('[data-unequip]').forEach(btn => btn.onclick = () => { const slot=btn.dataset.unequip; equipment[slot]=null; if(slot==='tool') equippedTool=null; renderLoadout(); });
  const fishing = skills.find(s=>s.id==='Fishing');
  const materials = [['Ore',skills[0].qty],['Bars',skills[1].qty],['Scrap',scrap],['Raw Fish',fishing.qty],['Cooked Fish',skills.find(skill=>skill.id==='Cooking').qty],['Burnt Fish',burntFish],['Pine Logs',woodInventory.pine],['Oak Logs',woodInventory.oak],['Yew Logs',woodInventory.yew],['Ancient Logs',woodInventory.ancient],['Basic Bait',basicBait],['Uncommon Fish',uncommonFish],['Rare Gems',rareGems]];
  const owned = [...ownedItems].map(id => ITEMS[id]).filter(Boolean);
  const foods = ['cookedFish','smokedRation','surgefinRation'].map(id => ITEMS[id]);
  inventoryList.innerHTML = `<div class="inventory-materials">${materials.map(([n,q])=>`<div><span>${n}</span><strong>${Number(q).toFixed(0)}</strong></div>`).join('')}<div><span>Smoked Rations</span><strong>${smokedRations}</strong></div><div><span>Surgefin Rations</span><strong>${surgefinRations}</strong></div></div><h3>Owned Equipment</h3>${owned.filter(item=>item.slot!=='food').map(item=>`<div class="inventory-item"><div><strong>${item.name}</strong><div class="small">${itemStats(item)}</div></div><button class="btn" data-equip="${item.id}">Equip</button></div>`).join('')}<h3>Food</h3>${foods.map(item=>`<div class="inventory-item"><div><strong>${item.name} ×${Math.floor(foodCount(item.id))}</strong><div class="small">${item.detail}</div></div><button class="btn" data-equip="${item.id}" ${foodCount(item.id)<1?'disabled':''}>Equip</button></div>`).join('')}`;
  inventoryList.querySelectorAll('[data-equip]').forEach(btn => btn.onclick = () => equipItem(btn.dataset.equip));
}

/* =====================================
   UI RENDERERS
===================================== */
function renderSkills() {
  skillsDiv.innerHTML = '';
  skills.forEach(s=>{
    const card = document.createElement('div');
    card.className = `skill-card skill-${s.id.toLowerCase()}`;
    card.style.marginBottom = '8px';

    const chk = document.createElement('input');
    chk.type = 'checkbox';
    chk.checked = s.active;
    chk.onchange = ()=> {
      s.active = chk.checked;
      startWarmup();
    };

    const lbl = document.createElement('label');
    lbl.style.marginLeft = '6px';
    lbl.textContent = s.id;

    // Tick progress meter (pays out when full)
    const tickMeter = document.createElement('div');
    tickMeter.className = 'meter';
    const tickFill = document.createElement('i');
    tickFill.style.width = '0%';
    tickMeter.appendChild(tickFill);

    // NEW: XP meter
    const xpMeter = document.createElement('div');   // NEW
    xpMeter.className = 'meter';                     // NEW
    xpMeter.style.marginTop = '4px';                 // NEW
    const xpFill = document.createElement('i');      // NEW
    xpFill.style.width = '0%';                       // NEW
    xpFill.style.background = '#68e0ff';             // NEW a different blue for XP
    xpMeter.appendChild(xpFill);                     // NEW

    const row = document.createElement('div');
    row.className = 'flex';
    row.style.marginTop = '6px';

    const rateEl = document.createElement('span'); // per sec
    rateEl.className = 'small';

    const qtyEl = document.createElement('span');  // total
    qtyEl.className = 'small';

    row.appendChild(rateEl);
    row.appendChild(qtyEl);
    const unlockEl = document.createElement('div');
    unlockEl.className = 'small next-unlock';

    const stateEl = document.createElement('span');
    stateEl.className = 'skill-state is-paused';
    stateEl.textContent = 'Paused';
    card.appendChild(chk);
    card.appendChild(lbl);
    card.appendChild(stateEl);
    card.appendChild(tickMeter);
    card.appendChild(xpMeter);                      // NEW
    card.appendChild(row);
    if (s.id === 'Cooking') {
      const outcomeEl = document.createElement('div');
      outcomeEl.className = 'cooking-outcome small';
      outcomeEl.textContent = 'Waiting for first cooking attempt.';
      card.appendChild(outcomeEl);
      s._outcomeEl = outcomeEl;
    }
    if (s.id === 'Woodchopping') {
      const treeSelect = document.createElement('select');
      treeSelect.className = 'btn skill-action-select';
      treeSelect.innerHTML = TREE_TYPES.map(tree => `<option value="${tree.id}" ${s.lvl < tree.level ? 'disabled' : ''}>${tree.name} — level ${tree.level} · ${tree.seconds}s/action</option>`).join('');
      treeSelect.value = selectedTree;
      treeSelect.onchange = () => { selectedTree = treeSelect.value; startWarmup(); };
      card.appendChild(treeSelect);
      s._treeSelect = treeSelect;
    }
    card.appendChild(unlockEl);
    skillsDiv.appendChild(card);

    s._els = { card, tickFill, xpFill, rateEl, qtyEl, unlockEl, stateEl, label: lbl };
  });

  honeSelect.innerHTML = '<option value="">None</option>' + skills.map(s=> `<option value="${s.id}">${s.id}</option>`).join('');
}


const loadedSave = loadGame();
if (loadedSave) applyOfflineProgress(JSON.parse(localStorage.getItem(SAVE_KEY)).savedAt);
renderSkills();
renderArenaTierOptions();
renderActivityLedger();
renderFrontier();
renderOperations(true);
applySettings();
setGameView('hub');
honeSelect.value = hone || '';
honedLabel.textContent = hone || 'None';
startWarmup();
if (loadedSave) {
  showToast('Save loaded');
  showOfflineSummary();
}

setInterval(() => saveGame(), AUTO_SAVE_MS);
window.addEventListener('beforeunload', () => saveGame());
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'hidden') saveGame();
});

/* =====================================
   MAIN LOOP AND IDLE PRODUCTION
===================================== */
honeSelect.onchange = ()=>{ hone = honeSelect.value || null; honedLabel.textContent = hone || 'None'; };

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

function setGameView(view) {
  currentGameView = view === 'field' ? 'field' : 'hub';
  document.body.dataset.gameView = currentGameView;
  document.querySelectorAll('[data-game-view]').forEach(button => { const active=button.dataset.gameView === currentGameView; button.classList.toggle('is-active',active); button.setAttribute('aria-pressed',String(active)); });
  const field = ['.card-arena','.card-frontier','.card-fishing'];
  const hub = ['.card-skills','.card-honing','.card-upgrades','.card-workshop','.card-save','.card-inventory','.card-ledger'];
  field.forEach(selector => document.querySelector(selector)?.classList.add('view-field'));
  hub.forEach(selector => document.querySelector(selector)?.classList.add('view-hub'));
  document.querySelector('.operations-board')?.classList.toggle('view-field-emphasis', currentGameView === 'field');
  window.scrollTo({ top:0, behavior:gameSettings.reduceMotion ? 'auto' : 'smooth' });
}

function updateObjective() {
  const mining = skills.find(skill => skill.id === 'Mining');
  const smithing = skills.find(skill => skill.id === 'Smithing');
  const combat = skills.find(skill => skill.id === 'Combat');
  let title = 'Push the frontier';
  let detail = 'Refine weapons, improve your times, and prepare for higher arena tiers.';
  let objectiveProgress = 100;
  if (!skills.some(skill => skill.active)) {
    title = 'Start your first skill'; detail = 'Activate Mining to begin producing Ore.'; objectiveProgress = 0;
  } else if (mining.lvl < 5 || smithing.lvl < 5) {
    title = 'Reach your first recipe milestones'; objectiveProgress = Math.min(100,(mining.lvl + smithing.lvl) / 10 * 100); detail = `Mining ${mining.lvl}/5 · Smithing ${smithing.lvl}/5. Smithing needs Ore but does not reduce efficiency while blocked.`;
  } else if (!ownedGear.size) {
    title = 'Craft your first equipment'; objectiveProgress = 25; detail = 'Open the Workshop and spend Bars on a weapon or specialized Tool.';
  } else if (combat.lvl < 5 || Math.floor(keys) < ARENA_TIERS[0].keyCost) {
    title = 'Prepare for the Initiate'; objectiveProgress = Math.min(100,((combat.lvl/5)+(Math.floor(keys)/ARENA_TIERS[0].keyCost))/2*100); detail = `Combat ${combat.lvl}/5 · Boss Keys ${Math.floor(keys)}/${ARENA_TIERS[0].keyCost}.`;
  } else if (arenaWins[0] === 0) {
    title = 'Defeat the Initiate'; objectiveProgress = 75; detail = 'Choose Gun or equip an Iron Blade, then prepare an Arena run.';
  } else if (arenaWins[1] === 0) {
    title = 'Reach and defeat Vanguard'; objectiveProgress = Math.min(90,combat.lvl/10*75); detail = `Reach Combat 10, then beat Vanguard. Current Combat: ${combat.lvl}.`;
  } else if (arenaWins[2] === 0) {
    title = 'Conquer Apex'; objectiveProgress = Math.min(90,combat.lvl/15*75); detail = `Reach Combat 15 and complete the current frontier. Current Combat: ${combat.lvl}.`;
  } else if (masteryStars() < 6) {
    const next = FRONTIER_DIRECTIVES.find(directive => !completedDirectives.has(directive.id));
    title = 'Master the Frontier'; objectiveProgress = masteryStars()/6*100; detail = next ? `Complete ${next.name} for your next Mastery Star. ${masteryStars()}/6 earned.` : `${masteryStars()}/6 Mastery Stars earned.`;
  } else if (gauntletRecord.clears === 0) {
    title = 'Clear the Frontier Gauntlet'; objectiveProgress = 50; detail = 'Lock one build and defeat Initiate, Vanguard, and Apex in sequence.';
  }
  objectiveTitle.textContent = title;
  objectiveDetail.textContent = detail;
  objectiveProgressFill.style.width = `${Math.max(0,Math.min(100,objectiveProgress))}%`;
}

let last = performance.now();
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
effReadout.textContent = `Efficiency m(a): ${m.toFixed(2)}x  Honed: ${hone || 'None'}  Slots: ${unlockedNormalSlots}`;

  

  activeCountTag.textContent = `active: ${skills.filter(s=>s.active).length} · productive: ${productiveSkills().length}`;

  if (globalBuff.secs>0) {
    globalBuff.secs -= dt;
    if (globalBuff.secs<0) globalBuff.secs = 0;
  }
  if (fishingBuffSecs > 0) fishingBuffSecs = Math.max(0, fishingBuffSecs - dt);
  buffLabel.textContent = globalBuff.secs>0 ? `1.5x ${Math.ceil(globalBuff.secs)}s` : 'none';

 
// tick based production
const actives = productiveSkills();
actives.forEach(s => {
  const cfg = getSkillCfg(s.id);
  if (cfg.canAct && !cfg.canAct()) return;
  const H = hone === s.id ? honingMult : 1.0;
  const perSec = effectiveProductionRate(s, m, H);

  s.progress += perSec * dt;

  while (s.progress >= 1) {
    s.progress -= 1;

    cfg.onAction(s, m);
    s.xp += cfg.xpPerAction;

    tryLevelUp(s);
  }
}); 



skills.forEach(s=>{
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

  const xpPct = Math.min(100, (s.xp / s.next) * 100);
  s._els.xpFill.style.width = xpPct.toFixed(1) + '%';

  // Lvl / XP / Rate / Total Labels
  s._els.rateEl.textContent =
    `Lvl: ${s.lvl}/${MAX_SKILL_LEVEL}  XP: ${Math.floor(s.xp)}/${s.next}  Rate: ${perSec.toFixed(2)}/s` + (H>1 ? ' honed' : '') + (waiting ? ` — ${cfg.waitingLabel || 'blocked'}` : '') + (s.id === 'Cooking' ? ` · success ${(cookingSuccessChance(s.lvl) * 100).toFixed(0)}%` : '') + (s.id === 'Woodchopping' ? ` · ${TREE_TYPES.find(tree => tree.id === selectedTree).name}` : '');
  s._els.qtyEl.textContent = `Total: ${s.qty.toFixed(1)}`;
  const milestone = nextSkillMilestone(s);
  if (s.id === 'Woodchopping' && s._treeSelect) {
    Array.from(s._treeSelect.options).forEach((option, index) => option.disabled = s.lvl < TREE_TYPES[index].level);
  }
  if (s.id === 'Cooking' && s._outcomeEl && s.lastOutcome) {
    s._outcomeEl.textContent = s.lastOutcome.text;
    s._outcomeEl.className = `cooking-outcome small is-${s.lastOutcome.kind}`;
  }
  s._els.unlockEl.textContent = milestone ? `Next unlock: ${milestone.label} at level ${milestone.level}` : 'All current milestones unlocked';
  s._els.label.style.color = H>1 ? '#b9ffcd' : '#e6e6f0';
});



  keysLabel.textContent = Math.floor(keys);
  updateArenaTierUI();

  const ore = skills.find(s=>s.id==='Mining')?.qty ?? 0;
  const bars = skills.find(s=>s.id==='Smithing')?.qty ?? 0;
  const combatXP = skills.find(s=>s.id==='Combat')?.xp ?? 0;
  totalsDiv.innerHTML = `
    <div class="resource-groups">
      <section><h3>Forging</h3><div class="resource-chip"><span>Ore</span><strong>${ore.toFixed(1)}</strong></div><div class="resource-chip"><span>Bars</span><strong>${bars.toFixed(1)}</strong></div><div class="resource-chip"><span>Scrap</span><strong>${scrap.toFixed(1)}</strong></div></section>
      <section><h3>Provisions</h3><div class="resource-chip"><span>Raw Fish</span><strong>${skills.find(s=>s.id==='Fishing').qty.toFixed(1)}</strong></div><div class="resource-chip"><span>Cooked Fish</span><strong>${skills.find(s=>s.id==='Cooking').qty.toFixed(1)}</strong></div><div class="resource-chip"><span>Basic Bait</span><strong>${basicBait}</strong></div><div class="resource-chip"><span>Uncommon Fish</span><strong>${uncommonFish}</strong></div></section>
      <section><h3>Timber</h3><div class="resource-chip"><span>Pine</span><strong>${woodInventory.pine.toFixed(0)}</strong></div><div class="resource-chip"><span>Oak</span><strong>${woodInventory.oak.toFixed(0)}</strong></div><div class="resource-chip"><span>Yew</span><strong>${woodInventory.yew.toFixed(0)}</strong></div><div class="resource-chip"><span>Ancient</span><strong>${woodInventory.ancient.toFixed(0)}</strong></div></section>
      <section><h3>Frontier</h3><div class="resource-chip"><span>Boss Keys</span><strong>${Math.floor(keys)}</strong></div><div class="resource-chip"><span>Rare Gems</span><strong>${rareGems}</strong></div><div class="resource-chip"><span>Fishing Boost</span><strong>${fishingBuffSecs > 0 ? `${Math.ceil(fishingBuffSecs)}s` : 'None'}</strong></div><div class="resource-chip"><span>Burnt Fish</span><strong>${burntFish.toFixed(1)}</strong></div></section>
    </div>
  `;
  recycleScrapBtn.disabled = scrap < scrapRecycleCost();
  recycleStatus.textContent = `${scrap.toFixed(1)}/${scrapRecycleCost()} Scrap — recycle ${scrapRecycleCost()} Scrap into 1 Ore.`;

 const buffText = globalBuff.secs > 0 
  ? `Active (${Math.ceil(globalBuff.secs/60)}m left)` 
  : 'None';

updateObjective();
renderOperations();
statusEl.innerHTML = `
  <span class="statLabel">Active Skills:</span> 
  <span class="statValue">${skills.filter(s=>s.active).length}</span>
  <span class="statLabel">Efficiency:</span> 
  <span class="statValue">${m.toFixed(2)}x</span>
  <span class="hud-resource">Keys <strong>${Math.floor(keys)}</strong></span><span class="hud-resource">Bars <strong>${skills.find(skill=>skill.id==='Smithing').qty.toFixed(0)}</strong></span><span class="hud-resource">Gems <strong>${rareGems}</strong></span><span class="hud-resource">Build <strong>${combatBuildLabel()}</strong></span><span class="statLabel">Global Buff:</span>
  <span class="statValue ${globalBuff.secs>0 ? 'green' : ''}">${buffText}</span>
`;
  requestAnimationFrame(tick);
}
requestAnimationFrame(tick);

let fishingGame = null;
let fishingHolding = false;
let fishingRaf = null;

function updateFishingBaitUI() {
  fishingBaitCount.textContent = `Basic Bait: ${basicBait} · Uncommon Fish: ${uncommonFish}`;
}
function openFishing() {
  fishingModal.style.display = 'flex';
  updateFishingBaitUI();
  fishingStatus.textContent = 'Choose bait, then cast.';
}
function closeFishing() {
  if (fishingGame) finishFishingCast(false, 'Cast cancelled', false);
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
  if (g.catchProgress >= 100) return finishFishingCast(true, 'Fish caught');
  if (g.tension >= 100) return finishFishingCast(false, 'The line broke');
  if (g.timeLeft <= 0) return finishFishingCast(false, 'The fish escaped');
  fishingRaf = requestAnimationFrame(updateFishingCast);
}
function finishFishingCast(success, message, applyRewards = true) {
  if (!fishingGame) return null;
  const g = fishingGame; fishingGame = null;
  if (fishingRaf) cancelAnimationFrame(fishingRaf);
  const fishing = skills.find(s=>s.id==='Fishing');
  const rewards = [];
  if (applyRewards) {
    if (success) {
      const fishQty = g.usedBait === 'prime' ? 14 : g.usedBait === 'basic' ? 10 : 8;
      const xp = g.usedBait === 'prime' ? 150 : g.usedBait === 'basic' ? 100 : 80;
      fishing.qty += fishQty; fishing.xp += xp; rewards.push({itemId:'rawFish', quantity:fishQty}, {itemId:'fishingXp', quantity:xp});
      fishingBuffSecs = Math.max(fishingBuffSecs, g.usedBait === 'prime' ? 600 : 300);
      if (g.usedBait === 'basic' && Math.random() < 0.15) { uncommonFish += 1; rewards.push({itemId:'uncommonFish', quantity:1}); }
    } else { fishing.xp += 10; rewards.push({itemId:'fishingXp', quantity:10}); }
    tryLevelUp(fishing);
  }
  const result = { activity:'fishing', spot:'shallows', success, score:Math.round(g.catchProgress), rewards, usedBait:g.usedBait, timestamp:Date.now() };
  fishingStatus.textContent = `${message}. ${success ? 'Cast again for another catch.' : 'You can cast again immediately.'}`;
  if (success) window.MomentumAudio.emit('catch'); else window.MomentumAudio.emit('lineBreak');
  if (success) logActivity(`Shallows catch: +${rewards.find(reward => reward.itemId === 'rawFish')?.quantity || 0} Raw Fish`, 'fishing');
  return result;
}

/* =====================================
   ARENA ADAPTER AND RESULTS
===================================== */
let gauntletIntermissionTimer = null;

function openArena(tier, runLoadout, options = {}) {
  const food = arenaFoodDefinition(equipment.food);
  window.MomentumArena.start({
    canvas:cv, tier, weapon:runLoadout,
    mode:options.mode || 'standard', directiveId:options.directiveId || null,
    maxHp:playerMaxHp(), carryState:options.carryState || null,
    food:food && foodCount(food.id) >= 1 ? food : null,
    talents:[...ownedCombatTalents],
    consumeFood:consumeFoodItem,
    reduceMotion:gameSettings.reduceMotion,
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
  if (tier.id === arenaTierUnlocked && arenaTierUnlocked < ARENA_TIERS.length) arenaTierUnlocked += 1;
  return { ore:tier.oreGain, gem:gotGem };
}

function resultStatsHtml(result, record = null) {
  return `<div class="result-grid"><span><small>Time</small><strong>${formatRunTime(result.duration)}</strong></span>${record ? `<span><small>Best</small><strong>${record.bestTime === null ? '—' : formatRunTime(record.bestTime)}</strong></span><span><small>Record</small><strong>${record.wins}/${record.attempts}</strong></span>` : ''}<span><small>Damage dealt</small><strong>${Math.round(result.damageDealt)}</strong></span><span><small>Damage taken</small><strong>${Math.round(result.damageTaken)}</strong></span><span><small>Dashes</small><strong>${result.dashesUsed}</strong></span><span><small>Shockwaves evaded</small><strong>${result.shockwavesEvaded}</strong></span><span><small>Highest Pressure</small><strong>${result.highestPressure}</strong></span><span><small>Food used</small><strong>${result.foodConsumed}</strong></span></div>`;
}

function handleArenaFinish(result) {
  if (activeGauntlet && !activeGauntlet.preparing) return handleGauntletPhase(result);
  const tier = ARENA_TIERS[result.tierId - 1];
  const record = recordArenaResult(result);
  const rewards = result.win ? grantBossReward(tier) : null;
  const directive = FRONTIER_DIRECTIVES.find(candidate => candidate.id === result.directiveId);
  let starAwarded = false;
  if (result.win && directive && !completedDirectives.has(directive.id)) {
    completedDirectives.add(directive.id);
    starAwarded = true;
    logActivity(`Mastery Star earned: ${directive.name}`, 'frontier');
  }
  selectedDirective = null;
  const rewardText = rewards ? `+${rewards.ore} Ore${rewards.gem ? ' · +1 Rare Gem' : ''} · Global 1.5x for 20m` : result.reason === 'gaveUp' ? 'Run abandoned · no rewards' : 'No rewards';
  resultMsg.innerHTML = `<div class="result-outcome ${result.win ? 'victory' : 'defeat'}">${directive ? directive.name : tier.name} ${result.win ? 'Complete' : result.reason === 'gaveUp' ? 'Abandoned' : 'Failed'}</div><div class="result-loadout">${result.weaponName} · ${result.styleId}${directive ? ` · ${tier.name} Directive` : ''}</div>${resultStatsHtml(result, record)}<div class="result-rewards">${rewardText}</div>${starAwarded ? `<div class="result-unlocks">★ Mastery Star earned · ${masteryStars()}/6</div>` : ''}`;
  resultModal.style.display = 'flex';
  renderArenaTierOptions(); renderFrontier();
  logActivity(`${directive?.name || tier.name} ${result.win ? 'completed' : 'failed'} with ${result.weaponName}`, result.win ? 'victory' : 'arena');
  saveGame();
}

function handleGauntletPhase(result) {
  const tier = ARENA_TIERS[activeGauntlet.bossIndex];
  activeGauntlet.phaseResults.push(result);
  if (!result.win) return finishGauntlet(result.reason);

  const reward = grantBossReward(tier, false);
  activeGauntlet.bankedRewards.push({ tierId:tier.id, ...reward });
  activeGauntlet.carryState = result.carryState;
  if (activeGauntlet.bossIndex >= ARENA_TIERS.length - 1) return finishGauntlet('cleared');

  activeGauntlet.bossIndex += 1;
  activeGauntlet.awaitingNext = true;
  let seconds = 8;
  resultMsg.innerHTML = `<div class="result-outcome victory">${tier.name} Defeated</div><div class="result-loadout">Gauntlet ${activeGauntlet.bossIndex}/3 complete · rewards banked</div>${resultStatsHtml(result)}<div class="result-rewards">+${reward.ore} Ore${reward.gem ? ' · +1 Rare Gem' : ''}</div>`;
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
  openArena(tier, activeGauntlet.loadout, { mode:'gauntlet', carryState:activeGauntlet.carryState });
}

function finishGauntlet(reason) {
  const cleared = reason === 'cleared';
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
  resultMsg.innerHTML = `<div class="result-outcome ${cleared ? 'victory' : 'defeat'}">Gauntlet ${cleared ? 'Cleared' : reason === 'gaveUp' ? 'Abandoned' : 'Failed'}</div><div class="result-loadout">Bosses defeated ${rewards.length}/3 · reached ${ARENA_TIERS[Math.min(reached - 1, 2)].name}</div><div class="result-grid"><span><small>Total time</small><strong>${formatRunTime(duration)}</strong></span><span><small>Best clear</small><strong>${gauntletRecord.bestTime === null ? '—' : formatRunTime(gauntletRecord.bestTime)}</strong></span><span><small>Banked Ore</small><strong>${rewards.reduce((sum, reward) => sum + reward.ore, 0)}</strong></span><span><small>Banked Gems</small><strong>${rewards.filter(reward => reward.gem).length}</strong></span></div><div class="result-rewards">${cleared ? 'Full clear: +1 Rare Gem · Global 1.5x for 40m' : 'Rewards from defeated bosses remain banked.'}</div>`;
  resultOk.disabled = false; resultOk.textContent = 'Continue'; resultModal.style.display = 'flex';
  logActivity(`Frontier Gauntlet ${cleared ? 'cleared' : 'ended'} at ${ARENA_TIERS[Math.min(reached - 1, 2)].name}`, cleared ? 'victory' : 'arena');
  activeGauntlet = null;
  renderFrontier(); saveGame();
}

function prepareGauntlet() {
  if (masteryStars() < 6) return;
  const cost = ARENA_TIERS.reduce((sum, tier) => sum + tier.keyCost, 0);
  if (Math.floor(keys) < cost) { showToast(`Requires ${cost} Boss Keys`); return; }
  selectedDirective = null;
  selectedArenaTier = 1;
  activeGauntlet = { preparing:true };
  preparedArenaTier = ARENA_TIERS[0];
  selectedArenaStyle = null;
  renderArenaPreparation();
  frontierModal.style.display = 'none';
  arenaPrepModal.style.display = 'flex';
}

/* =====================================
   MODAL UX
===================================== */
const dismissibleModals = [
  ['settingsModal','closeSettingsBtn'], ['frontierModal','closeFrontier'], ['specModal','closeSpecs'],
  ['talentModal','closeTalents'], ['loadoutModal','closeLoadout'], ['gearModal','closeGear'],
  ['baseUpModal','closeBaseUp'], ['skillUpModal','closeSkillUp']
];
function topVisibleDismissibleModal() {
  return dismissibleModals.map(([modalId,closeId]) => ({ modal:document.getElementById(modalId), close:document.getElementById(closeId) })).reverse().find(entry => entry.modal?.style.display === 'flex');
}
document.addEventListener('keydown', event => {
  if (event.key !== 'Escape' || window.MomentumArena.isRunning() || activeGauntlet?.awaitingNext) return;
  if (arenaPrepModal.style.display === 'flex') { closeArenaPreparation(); return; }
  if (fishingModal.style.display === 'flex') { closeFishing(); return; }
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
document.getElementById('openBaseUpBtn').onclick = ()=>{ renderBaseUps(); baseUpModal.style.display='flex'; };
document.getElementById('openGearBtn').onclick = ()=>{ renderGear(); gearModal.style.display='flex'; };
document.getElementById('openLoadoutBtn').onclick = ()=>{ renderLoadout(); loadoutModal.style.display='flex'; };
document.getElementById('closeLoadout').onclick = ()=> loadoutModal.style.display='none';
document.getElementById('closeGear').onclick = ()=> gearModal.style.display='none';
document.getElementById('closeBaseUp').onclick   = ()=> baseUpModal.style.display='none';

document.getElementById('openTalentsBtn').onclick = () => { renderTalents(); talentModal.style.display='flex'; };
document.getElementById('closeTalents').onclick = () => talentModal.style.display='none';
refundTalentsBtn.onclick = () => {
  if (window.MomentumArena.isRunning() || ownedCombatTalents.size === 0) return;
  ownedCombatTalents.clear();
  logActivity('Combat Discipline talents refunded', 'talent');
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
reduceMotion.onchange = () => { gameSettings.reduceMotion = reduceMotion.checked; document.body.classList.toggle('reduce-motion', gameSettings.reduceMotion); };
document.getElementById('openSettingsBtn').onclick = () => { applySettings(); settingsModal.style.display='flex'; };
document.getElementById('closeSettingsBtn').onclick = () => settingsModal.style.display='none';
document.querySelectorAll('[data-game-view]').forEach(button => button.onclick = () => setGameView(button.dataset.gameView));
document.getElementById('viewCharacterBtn').onclick = () => { renderLoadout(); loadoutModal.style.display='flex'; };
document.querySelectorAll('[data-quick-view]').forEach(button => button.onclick = () => setGameView(button.dataset.quickView));
document.getElementById('quickInventory').onclick = () => { renderLoadout(); loadoutModal.style.display='flex'; };
document.getElementById('quickSettings').onclick = () => { applySettings(); settingsModal.style.display='flex'; };

document.getElementById('openSkillUpBtn').onclick= ()=>{ renderSkillUps('Mining'); skillUpModal.style.display='flex'; };
document.getElementById('closeSkillUp').onclick  = ()=> skillUpModal.style.display='none';
document.querySelectorAll('#skillUpModal [data-tab]').forEach(btn=>{
  btn.onclick = ()=> renderSkillUps(btn.getAttribute('data-tab'));
});

document.getElementById('closeArena').onclick = () => window.MomentumArena.giveUp();
document.getElementById('openFishingBtn').onclick = openFishing;
document.getElementById('closeFishing').onclick = closeFishing;
document.getElementById('startFishingCast').onclick = startFishingCast;
document.getElementById('prepareBaitBtn').onclick = prepareBasicBait;
fishingPlayfield.addEventListener('pointerdown', e => { e.preventDefault(); fishingHolding = true; });
window.addEventListener('pointerup', () => fishingHolding = false);
window.addEventListener('keydown', e => { if (e.code === 'Space' && fishingModal.style.display === 'flex') { e.preventDefault(); fishingHolding = true; } });
window.addEventListener('keyup', e => { if (e.code === 'Space') fishingHolding = false; });
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

