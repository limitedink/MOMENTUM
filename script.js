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
]

let unlockedNormalSlots = 4;
let hone = null;
let honingMult = 1.8;
let keys = 0;
let rareGems = 0;
let scrap = 0;
let basicBait = 0;
let uncommonFish = 0;
let fishingBuffSecs = 0;
const SMELT_ORE_COST = 1;
const SMELT_FAIL_CHANCE = 0.10;
const SCRAP_RECYCLE_COST = 5;
let globalBuff = { mult: 1.0, secs: 0 };
let warmup = { t: 0, targetA: 0, currentA: 0 };







let BULLET_DAMAGE = 10;
let baseMult = 1.0;     // multiplies all perSec
let keyRateMult = 1.0;  // multiplies boss keys



const ARENA_TIERS = [
  { id:1, name:'Initiate', keyCost:3, bossHp:30, bossSpeed:40, contactDps:15, waveDamage:28, waveCooldown:4.0, projectileCount:0, projectileCooldown:0, projectileSpeed:0, projectileDamage:0, projectileSpread:0, attackLabel:'Shockwave', oreGain:600, gemChance:0.25 },
  { id:2, name:'Vanguard', keyCost:5, bossHp:70, bossSpeed:55, contactDps:20, waveDamage:36, waveCooldown:3.4, projectileCount:1, projectileCooldown:2.8, projectileSpeed:180, projectileDamage:16, projectileSpread:0, attackLabel:'Aimed shot', oreGain:1000, gemChance:0.50 },
  { id:3, name:'Apex', keyCost:8, bossHp:120, bossSpeed:70, contactDps:25, waveDamage:44, waveCooldown:2.8, projectileCount:3, projectileCooldown:2.2, projectileSpeed:220, projectileDamage:18, projectileSpread:0.18, attackLabel:'Spread volley', oreGain:1600, gemChance:1.00 }
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
const arenaTierSelect = document.getElementById('arenaTierSelect');
const arenaTierDetails = document.getElementById('arenaTierDetails');
const buffLabel = document.getElementById('buffLabel');
const statusEl = document.getElementById('status');
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
const baseUpList  = document.getElementById('baseUpList');
const skillUpList = document.getElementById('skillUpList');

const resultModal = document.getElementById('resultModal');
const resultMsg   = document.getElementById('resultMsg');
const resultOk    = document.getElementById('resultOk');

const modal = document.getElementById('arenaModal');
const cv = document.getElementById('cv');
const ctx = cv.getContext('2d');
const hpYouEl = document.getElementById('hpYou');
const hpBossEl = document.getElementById('hpBoss');
const arenaTip = document.getElementById('arenaTip');

// Attach confetti to our overlay canvas
const confettiCanvas = document.getElementById('confettiCanvas');

function sizeConfettiCanvas() {
  confettiCanvas.width  = window.innerWidth;   // drawing buffer
  confettiCanvas.height = window.innerHeight;
}
sizeConfettiCanvas();
window.addEventListener('resize', sizeConfettiCanvas);
const confettiOverlay = confetti.create(confettiCanvas, { resize: true, useWorker: true });


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

function circle(ctx,x,y,r){ ctx.beginPath(); ctx.arc(x,y,r,0,Math.PI*2); ctx.fill(); }
function circleHit(x1,y1,r1,x2,y2,r2){ return Math.hypot(x1-x2,y1-y2) < r1+r2; }
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




// Handles level ups and clamps to MAX_SKILL_LEVEL
function tryLevelUp(s) {
  while (s.lvl < MAX_SKILL_LEVEL && s.xp >= s.next) {
    s.xp  -= s.next;
    s.lvl += 1;
    s.next = xpToNext(s.lvl);
    showToast(`${s.id} reached level ${s.lvl}`);
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
  { id:'workshop', name:'Workshop Efficiency', desc:'+10% all idle rates', cost:{ ore:150 }, apply(){ baseMult *= 1.10; } },
  { id:'keysmith', name:'Keysmith', desc:'+25% Boss Key generation', cost:{ bars:80 }, apply(){ keyRateMult *= 1.25; } },
];
const ownedBaseUps = new Set();

const SKILL_UPS = {
  Mining: [
    { id:'pick1', name:'Pick Quality I', desc:'+10 percent speed', cost:{ ore:120 }, apply(){ const s=skills.find(x=>x.id==='Mining'); s.basePerSec = clampPerSec(s.basePerSec * 1.10); } },
{ id:'pick2', name:'Pick Quality II', desc:'+12 percent speed', cost:{ ore:240 }, apply(){ const s=skills.find(x=>x.id==='Mining'); s.basePerSec = clampPerSec(s.basePerSec * 1.12); } },
  ],
  Smithing: [
   { id:'forge1', name:'Forge Bellows', desc:'+8 percent speed', cost:{ bars:90 }, apply(){ const s=skills.find(x=>x.id==='Smithing'); s.basePerSec = clampPerSec(s.basePerSec * 1.08); } },
  ],
  Combat: [
    { id:'ammo1', name:'Hardened Rounds', desc:'+3 bullet damage', cost:{ bars:120 }, apply(){ BULLET_DAMAGE += 3; } },
  ],
};
const ownedSkillUps = new Set();
const GEAR = [
  { id:'reinforcedPick', name:'Reinforced Pick', desc:'+25% Mining rate while equipped', cost:30, slot:'tool' },
  { id:'forgeGauntlet', name:'Forge Gauntlet', desc:'+25% Smithing rate while equipped', cost:30, slot:'tool' },
  { id:'platedVest', name:'Plated Vest', desc:'+25 maximum arena health', cost:40, slot:'armor' }
];
const ownedGear = new Set();
let equippedTool = null;
function gearRateMult(skillId) {
  if (skillId === 'Mining' && equippedTool === 'reinforcedPick') return 1.25;
  if (skillId === 'Smithing' && equippedTool === 'forgeGauntlet') return 1.25;
  return 1;
}
function playerMaxHp() { return ownedGear.has('platedVest') ? 125 : 100; }

/* =====================================
   SAVE / LOAD
===================================== */
const SAVE_KEY = 'momentum-save';
const SAVE_VERSION = 5;
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
    equippedTool,
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
    if (![1, 2, 3, 4, SAVE_VERSION].includes(save.version)) return false;

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
    equippedTool = save.version >= 3 && ownedGear.has(save.equippedTool) ? save.equippedTool : null;
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
function canAfford(cost) {
  const ore = skills.find(s=>s.id==='Mining')?.qty ?? 0;
  const bars = skills.find(s=>s.id==='Smithing')?.qty ?? 0;
  if (cost.ore && ore < cost.ore) return false;
  if (cost.bars && bars < cost.bars) return false;
  return true;
}
function payCost(cost) {
  if (cost.ore)  { const m = skills.find(s=>s.id==='Mining');   m.qty  -= cost.ore; }
  if (cost.bars) { const s = skills.find(s=>s.id==='Smithing'); s.qty  -= cost.bars; }
}

function renderBaseUps() {
  baseUpList.innerHTML = '';
  BASE_UPS.forEach(up=>{
    const owned = ownedBaseUps.has(up.id);
    const costTxt = `Cost: ${up.cost.ore? up.cost.ore+' Ore' : ''}${up.cost.ore && up.cost.bars ? ', ' : ''}${up.cost.bars? up.cost.bars+' Bars':''}`;
    const row = document.createElement('div');
    row.style.margin = '8px 0';
    row.innerHTML = `
      <div style="font-weight:600">${up.name}</div>
      <div style="opacity:.9; margin:2px 0 6px">${up.desc}</div>
      <div class="flex">
        <span>${costTxt}</span>
        <button class="btn" ${owned? 'disabled':''}>${owned? 'Owned':'Buy'}</button>
      </div>
    `;
    const btn = row.querySelector('button');
    btn.onclick = ()=>{
      if (ownedBaseUps.has(up.id)) return;
      if (!canAfford(up.cost)) { showToast('Not enough resources'); return; }
      payCost(up.cost);
      up.apply();
      ownedBaseUps.add(up.id);
      showToast(`Purchased ${up.name}`);
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
    const costTxt = `Cost: ${up.cost.ore? up.cost.ore+' Ore' : ''}${up.cost.ore && up.cost.bars ? ', ' : ''}${up.cost.bars? up.cost.bars+' Bars':''}`;
    const row = document.createElement('div');
    row.style.margin = '8px 0';
    row.innerHTML = `
      <div style="font-weight:600">${up.name}</div>
      <div style="opacity:.9; margin:2px 0 6px">${up.desc}</div>
      <div class="flex">
        <span>${costTxt}</span>
        <button class="btn" ${owned? 'disabled':''}>${owned? 'Owned':'Buy'}</button>
      </div>
    `;
    const btn = row.querySelector('button');
    btn.onclick = ()=>{
      if (ownedSkillUps.has(up.id)) return;
      if (!canAfford(up.cost)) { showToast('Not enough resources'); return; }
      payCost(up.cost);
      up.apply();
      ownedSkillUps.add(up.id);
      showToast(`Purchased ${up.name}`);
      renderSkillUps(skillName);
    };
    skillUpList.appendChild(row);
  });
}

// Per skill tuning. All equal by default.
const SKILL_CFG = {
  Mining: { xpPerAction: 20, onAction(s){ s.qty += 1; } },
  Smithing: {
    xpPerAction: 20,
    canAct(){ return skills.find(s=>s.id==='Mining').qty >= SMELT_ORE_COST; },
    onAction(s){
      const mining = skills.find(x=>x.id==='Mining');
      mining.qty -= SMELT_ORE_COST;
      if (Math.random() < SMELT_FAIL_CHANCE) {
        scrap += 1;
        showToast('Smelt failed: +1 Scrap', 1200);
      } else {
        s.qty += 1;
      }
    }
  },
  Fishing: { xpPerAction: 20, onAction(s){ s.qty += 1; } },
  Combat:   { xpPerAction: 20, onAction(s, m){
    const keysPerAction = 0.10 * m * keyRateMult;
    keys += keysPerAction;
    // no s.qty for Combat right now
  } }
};
// Safe getter if you add new skills later
function getSkillCfg(id){
  return SKILL_CFG[id] || { xpPerAction: 10, onAction(s){ /* no op */ } };
}



function fishingRateMult(skillId) { return skillId === 'Fishing' && fishingBuffSecs > 0 ? 1.5 : 1; }

function currentArenaTier() { return ARENA_TIERS[selectedArenaTier - 1]; }
function renderArenaTierOptions() {
  arenaTierSelect.innerHTML = ARENA_TIERS.map(tier => `<option value="${tier.id}" ${tier.id > arenaTierUnlocked ? 'disabled' : ''}>${tier.name}${tier.id > arenaTierUnlocked ? ' — Locked' : ''}</option>`).join('');
  arenaTierSelect.value = selectedArenaTier;
  updateArenaTierUI();
}
function updateArenaTierUI() {
  const tier = currentArenaTier();
  arenaTierDetails.textContent = `${tier.bossHp} Boss HP · ${tier.attackLabel} · ${tier.oreGain} Ore · ${Math.round(tier.gemChance * 100)}% Gem · Wins ${arenaWins[tier.id - 1]}`;
  fightBtn.textContent = `Enter ${tier.name} Arena (${tier.keyCost} Keys)`;
  fightBtn.disabled = Math.floor(keys) < tier.keyCost;
}

function renderGear() {
  gearList.innerHTML = '';
  const bars = skills.find(s=>s.id==='Smithing').qty;
  GEAR.forEach(item => {
    const owned = ownedGear.has(item.id);
    const equipped = item.slot === 'armor' ? owned : equippedTool === item.id;
    const row = document.createElement('div');
    row.style.margin = '10px 0';
    row.innerHTML = `<div style="font-weight:600">${item.name}</div><div style="opacity:.9; margin:2px 0 6px">${item.desc}</div><div class="flex"><span>${owned ? 'Crafted' : `Cost: ${item.cost} Bars`}</span><button class="btn" ${equipped ? 'disabled' : ''}>${equipped ? 'Equipped' : owned ? 'Equip' : 'Craft'}</button></div>`;
    row.querySelector('button').onclick = () => {
      if (!ownedGear.has(item.id)) {
        const smithing = skills.find(s=>s.id==='Smithing');
        if (smithing.qty < item.cost) { showToast('Not enough Bars'); return; }
        smithing.qty -= item.cost;
        ownedGear.add(item.id);
        showToast(`Crafted ${item.name}`);
      }
      if (item.slot === 'tool') equippedTool = item.id;
      renderGear();
    };
    gearList.appendChild(row);
  });
  const equipped = GEAR.find(item=>item.id===equippedTool)?.name || 'None';
  gearList.insertAdjacentHTML('afterbegin', `<div style="margin-bottom:10px">Bars available: ${bars.toFixed(1)} · Tool equipped: ${equipped}</div>`);
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

    card.appendChild(chk);
    card.appendChild(lbl);
    card.appendChild(tickMeter);
    card.appendChild(xpMeter);                      // NEW
    card.appendChild(row);
    skillsDiv.appendChild(card);

    s._els = { card, tickFill, xpFill, rateEl, qtyEl, label: lbl };
  });

  honeSelect.innerHTML = '<option value="">None</option>' + skills.map(s=> `<option value="${s.id}">${s.id}</option>`).join('');
}


const loadedSave = loadGame();
renderSkills();
renderArenaTierOptions();
honeSelect.value = hone || '';
honedLabel.textContent = hone || 'None';
startWarmup();
if (loadedSave) showToast('Save loaded');

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
  warmup.targetA = skills.filter(s=>s.active).length;
  if (warmup.currentA === 0) warmup.currentA = warmup.targetA;
  warmup.t = 3.0;
}

let last = performance.now();
function tick(now) {
  const dt = Math.min(0.25, (now - last)/1000);
  last = now;

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

  

  activeCountTag.textContent = 'active: ' + skills.filter(s=>s.active).length;

  if (globalBuff.secs>0) {
    globalBuff.secs -= dt;
    if (globalBuff.secs<0) globalBuff.secs = 0;
  }
  if (fishingBuffSecs > 0) fishingBuffSecs = Math.max(0, fishingBuffSecs - dt);
  buffLabel.textContent = globalBuff.secs>0 ? `1.5x ${Math.ceil(globalBuff.secs)}s` : 'none';

 
// tick based production
const actives = skills.filter(s => s.active);
actives.forEach(s => {
  const cfg = getSkillCfg(s.id);
  if (cfg.canAct && !cfg.canAct()) return;
  const H = hone === s.id ? honingMult : 1.0;
  const perSec = clampPerSec(s.basePerSec * m * H * baseMult * gearRateMult(s.id) * fishingRateMult(s.id));

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
  const perSec = s.active && !waiting ? clampPerSec(s.basePerSec * m * H * baseMult * gearRateMult(s.id) * fishingRateMult(s.id)) : 0;
  s._els.card.classList.toggle('is-active', s.active);
  s._els.card.classList.toggle('is-honed', hone === s.id);
  s._els.card.classList.toggle('is-waiting', waiting);

  const tickPct = Math.min(100, s.progress * 100);
  s._els.tickFill.style.width = tickPct.toFixed(1) + '%';

  const xpPct = Math.min(100, (s.xp / s.next) * 100);
  s._els.xpFill.style.width = xpPct.toFixed(1) + '%';

  // Lvl / XP / Rate / Total Labels
  s._els.rateEl.textContent =
    `Lvl: ${s.lvl}/${MAX_SKILL_LEVEL}  XP: ${Math.floor(s.xp)}/${s.next}  Rate: ${perSec.toFixed(2)}/s` + (H>1 ? ' honed' : '') + (waiting ? ' — waiting for Ore' : '');
  s._els.qtyEl.textContent = `Total: ${s.qty.toFixed(1)}`;
  s._els.label.style.color = H>1 ? '#b9ffcd' : '#e6e6f0';
});



  keysLabel.textContent = Math.floor(keys);
  updateArenaTierUI();

  const ore = skills.find(s=>s.id==='Mining')?.qty ?? 0;
  const bars = skills.find(s=>s.id==='Smithing')?.qty ?? 0;
  const combatXP = skills.find(s=>s.id==='Combat')?.xp ?? 0;
  totalsDiv.innerHTML = `
    <div class="grid">
      <div><div>Ore</div><div class="yellow">${ore.toFixed(1)}</div></div>
      <div><div>Bars</div><div class="yellow">${bars.toFixed(1)}</div></div>
      <div><div>Combat XP</div><div class="yellow">${combatXP.toFixed(1)}</div></div>
    </div>
    <div style="margin-top:8px">Rare Gems: <span class="yellow" id="gemLbl">${rareGems}</span></div>
    <div>Scrap: <span class="yellow">${scrap}</span></div>
    <div>Raw Fish: <span class="yellow">${skills.find(s=>s.id==='Fishing').qty.toFixed(1)}</span></div>
    <div>Basic Bait: <span class="yellow">${basicBait}</span> · Uncommon Fish: <span class="yellow">${uncommonFish}</span></div>
    <div>Fishing Boost: <span class="${fishingBuffSecs > 0 ? 'green' : ''}">${fishingBuffSecs > 0 ? `1.5x ${Math.ceil(fishingBuffSecs)}s` : 'None'}</span></div>
  `;
  recycleScrapBtn.disabled = scrap < SCRAP_RECYCLE_COST;
  recycleStatus.textContent = `${scrap}/${SCRAP_RECYCLE_COST} Scrap — recycle 5 Scrap into 1 Ore.`;

 const buffText = globalBuff.secs > 0 
  ? `Active (${Math.ceil(globalBuff.secs/60)}m left)` 
  : 'None';

statusEl.innerHTML = `
  <span class="statLabel">Active Skills:</span> 
  <span class="statValue">${skills.filter(s=>s.active).length}</span>
  <span class="statLabel">Efficiency:</span> 
  <span class="statValue">${m.toFixed(2)}x</span>
  <span class="statLabel">Global Buff:</span> 
  <span class="statValue ${globalBuff.secs>0 ? 'green' : ''}">${buffText}</span>
`;
  requestAnimationFrame(tick);
}
requestAnimationFrame(tick);

let fishingGame = null;
let fishingHolding = false;
let fishingRaf = null;

function updateFishingBaitUI() {
  fishingBaitCount.textContent = `Basic Bait: ${basicBait}`;
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
  if (fishing.qty < 3) { showToast('Need 3 Raw Fish'); return; }
  fishing.qty -= 3;
  basicBait += 1;
  updateFishingBaitUI();
  showToast('Prepared 1 Basic Bait');
}
function startFishingCast() {
  if (fishingGame) return;
  let usedBait = fishingBaitSelect.value;
  if (usedBait === 'basic' && basicBait < 1) {
    usedBait = 'none';
    fishingBaitSelect.value = 'none';
    fishingStatus.textContent = 'Out of Basic Bait — casting without bait.';
  }
  if (usedBait === 'basic') basicBait -= 1;
  updateFishingBaitUI();
  fishingGame = { fishY:60 + Math.random()*160, fishV:90, steer:0.7, zoneY:190, catchProgress:0, tension:0, timeLeft:45, usedBait, last:performance.now() };
  fishingStatus.textContent = usedBait === 'basic' ? 'Basic Bait used. Keep the fish in the catch zone.' : 'Keep the fish in the catch zone.';
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
  g.tension = Math.max(0, Math.min(100, g.tension + (fishingHolding ? 45 : -55) * dt));
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
      const fishQty = g.usedBait === 'basic' ? 10 : 8;
      const xp = g.usedBait === 'basic' ? 100 : 80;
      fishing.qty += fishQty; fishing.xp += xp; rewards.push({itemId:'rawFish', quantity:fishQty}, {itemId:'fishingXp', quantity:xp});
      fishingBuffSecs = Math.max(fishingBuffSecs, 300);
      if (g.usedBait === 'basic' && Math.random() < 0.15) { uncommonFish += 1; rewards.push({itemId:'uncommonFish', quantity:1}); }
    } else { fishing.xp += 10; rewards.push({itemId:'fishingXp', quantity:10}); }
    tryLevelUp(fishing);
  }
  const result = { activity:'fishing', spot:'shallows', success, score:Math.round(g.catchProgress), rewards, usedBait:g.usedBait, timestamp:Date.now() };
  fishingStatus.textContent = `${message}. ${success ? 'Cast again for another catch.' : 'You can cast again immediately.'}`;
  return result;
}

/* =====================================
   ARENA: STATE AND LOOP
===================================== */
let arena = null;
const keysDown = {};

function openArena() {
  const tier = currentArenaTier();
  modal.style.display = 'flex';
  arena = {
    tier,
    you:  { x:120, y:210, r:14, vx:0, vy:0, hp:playerMaxHp(), dash:0 },
    boss: { x:560, y:210, r:28, hp:tier.bossHp, cd:2.0, shotCd:tier.projectileCooldown, tele:0, phase:0 },
    shots: [],
    enemyShots: [],
    t: performance.now(),
    stopped: false
  };
  arena.wave = null;
  arenaTip.textContent = tier.projectileCount ? 'Dash through shockwaves and incoming volleys' : 'Dash through the red shockwave';

  window.addEventListener('keydown', onKey, false);
  window.addEventListener('keyup', onKeyUp, false);
  cv.addEventListener('mousedown', onClick, false);
  requestAnimationFrame(arenaLoop);
}

function closeArena() {
  modal.style.display = 'none';
  window.removeEventListener('keydown', onKey);
  window.removeEventListener('keyup', onKeyUp);
  cv.removeEventListener('mousedown', onClick);
}

function showResult(win) {
  if (!arena) return;
  arena.stopped = true;

  if (win) {
    const tier = arena.tier;
    const gotGem = Math.random() < tier.gemChance;
    const buffSecs = 20 * 60;
    lastFightResult = { win:true, tierId:tier.id, tierName:tier.name, oreGain:tier.oreGain, gotGem, buffSecs };
    resultMsg.textContent =
      `${tier.name} Victory. +${tier.oreGain} Ore${gotGem ? ', +1 Rare Gem' : ''}. Global 1.5x for ${Math.floor(buffSecs/60)}m.`;
  } else {
    lastFightResult = { win:false, tierName:arena.tier.name };
    resultMsg.textContent = `${arena.tier.name} defeat. Better luck next time.`;
  }

  closeArena();
  resultModal.style.display = 'flex';
}

function applyWinRewards() {
  const r = lastFightResult;
  if (!r?.win) return;
  const mining = skills.find(s=>s.id==='Mining');
  if (mining) mining.qty += r.oreGain;
  if (r.gotGem) {
    rareGems += 1;
    const g = document.getElementById('gemLbl');
    if (g) g.textContent = rareGems;
  }
  globalBuff.secs = Math.max(globalBuff.secs, r.buffSecs);
  arenaWins[r.tierId - 1] += 1;
  if (r.tierId === arenaTierUnlocked && arenaTierUnlocked < ARENA_TIERS.length) {
    arenaTierUnlocked += 1;
    selectedArenaTier = arenaTierUnlocked;
    showToast(`${ARENA_TIERS[selectedArenaTier - 1].name} Arena unlocked`);
  }
  renderArenaTierOptions();
}

function fireBossVolley() {
  const { boss, you, tier } = arena;
  const aim = Math.atan2(you.y - boss.y, you.x - boss.x);
  const middle = (tier.projectileCount - 1) / 2;
  for (let i = 0; i < tier.projectileCount; i++) {
    const angle = aim + (i - middle) * tier.projectileSpread;
    arena.enemyShots.push({ x:boss.x, y:boss.y, r:6, vx:Math.cos(angle)*tier.projectileSpeed, vy:Math.sin(angle)*tier.projectileSpeed, damage:tier.projectileDamage, t:0, color:tier.id===2 ? '#ffad42' : '#ff5b3d' });
  }
}

function arenaLoop(now) {
  if (!arena || arena.stopped) return;
  const dt = Math.min(0.033, (now - arena.t)/1000); arena.t = now;
  const { you, boss } = arena;

  // contact damage
  if (circleHit(you.x, you.y, you.r, boss.x, boss.y, boss.r)) {
    you.hp -= arena.tier.contactDps * dt;
  }

  // move
  let ax=0, ay=0, speed = 150;
  if (keysDown['KeyW']) ay -= 1;
  if (keysDown['KeyS']) ay += 1;
  if (keysDown['KeyA']) ax -= 1;
  if (keysDown['KeyD']) ax += 1;
  if (you.dash>0){ speed = 520; you.dash -= dt; }
  const mlen = Math.hypot(ax,ay) || 1;
  you.vx = (ax/mlen)*speed;
  you.vy = (ay/mlen)*speed;
  you.x = clamp(you.x + you.vx*dt, 20, cv.width-20);
  you.y = clamp(you.y + you.vy*dt, 20, cv.height-20);

  // boss chase and ability
  const dx = you.x - boss.x, dy = you.y - boss.y, bl = Math.hypot(dx,dy) || 1;
  boss.x += dx/bl * arena.tier.bossSpeed * dt;
  boss.y += dy/bl * arena.tier.bossSpeed * dt;

  boss.cd -= dt;
  if (boss.cd <= 0 && boss.tele <= 0) {
    boss.tele  = 1.2;
    boss.cd    = arena.tier.waveCooldown;
    boss.phase = 0;
  }
  if (boss.tele > 0) {
    boss.tele -= dt;
    if (boss.tele <= 0 && !arena.wave) {
      arena.wave = { r: 28, speed: 140, max: 260, hit: false };
    }
  }
  if (arena.tier.projectileCount > 0) {
    boss.shotCd -= dt;
    if (boss.shotCd <= 0) {
      fireBossVolley();
      boss.shotCd = arena.tier.projectileCooldown;
    }
  }

  const dist = Math.hypot(you.x - boss.x, you.y - boss.y);
  if (arena.wave) {
    if (!arena.wave.hit && Math.abs(dist - arena.wave.r) < 12 && you.dash <= 0) {
      you.hp -= arena.tier.waveDamage;
      arena.wave.hit = true;
    }
    arena.wave.r += arena.wave.speed * dt;
    if (arena.wave.r > arena.wave.max) arena.wave = null;
  }

  // draw fx
  ctx.clearRect(0,0,cv.width,cv.height);
  if (arena.wave) {
    ctx.strokeStyle = 'rgba(255,80,80,0.8)'; ctx.lineWidth = 3;
    ctx.beginPath(); ctx.arc(boss.x, boss.y, arena.wave.r, 0, Math.PI*2); ctx.stroke();
  } else if (boss.tele > 0) {
    const r = 26;
    ctx.strokeStyle = 'rgba(255,80,80,0.35)'; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.arc(boss.x, boss.y, r, 0, Math.PI*2); ctx.stroke();
  }

  // boss projectiles
  for (const shot of arena.enemyShots) {
    shot.x += shot.vx * dt; shot.y += shot.vy * dt; shot.t += dt;
    if (circleHit(shot.x, shot.y, shot.r, you.x, you.y, you.r) && you.dash <= 0) {
      you.hp -= shot.damage;
      shot.t = 99;
    }
  }
  arena.enemyShots = arena.enemyShots.filter(shot => shot.x>-20 && shot.x<cv.width+20 && shot.y>-20 && shot.y<cv.height+20 && shot.t<5);

  // player shots
  for (const s of arena.shots) { s.x += s.vx*dt; s.y += s.vy*dt; s.t += dt; }
  arena.shots = arena.shots.filter(s=> s.x>-20 && s.x<cv.width+20 && s.y>-20 && s.y<cv.height+20 && s.t<3 );
  for (const s of arena.shots) {
    if (circleHit(s.x,s.y,2, boss.x,boss.y,boss.r)) { boss.hp -= BULLET_DAMAGE; s.t = 99; }
  }

  // draw actors
  arena.enemyShots.forEach(shot => { ctx.fillStyle = shot.color; circle(ctx,shot.x,shot.y,shot.r); });
  ctx.fillStyle = '#ff5b5b'; circle(ctx,boss.x,boss.y,boss.r);
  ctx.fillStyle = '#6df2a7'; circle(ctx,you.x,you.y,you.r);
  ctx.fillStyle = '#c7d2ff'; arena.shots.forEach(s=> circle(ctx,s.x,s.y,2));

  hpYouEl.textContent = Math.max(0, you.hp|0);
  hpBossEl.textContent = Math.max(0, boss.hp|0);

  if (you.hp <= 0) { showResult(false); return; }
  if (boss.hp <= 0) { showResult(true);  return; }

  requestAnimationFrame(arenaLoop);
}

/* =====================================
   EVENTS
===================================== */
document.getElementById('openBaseUpBtn').onclick = ()=>{ renderBaseUps(); baseUpModal.style.display='flex'; };
document.getElementById('openGearBtn').onclick = ()=>{ renderGear(); gearModal.style.display='flex'; };
document.getElementById('closeGear').onclick = ()=> gearModal.style.display='none';
document.getElementById('closeBaseUp').onclick   = ()=> baseUpModal.style.display='none';

document.getElementById('openSkillUpBtn').onclick= ()=>{ renderSkillUps('Mining'); skillUpModal.style.display='flex'; };
document.getElementById('closeSkillUp').onclick  = ()=> skillUpModal.style.display='none';
document.querySelectorAll('#skillUpModal [data-tab]').forEach(btn=>{
  btn.onclick = ()=> renderSkillUps(btn.getAttribute('data-tab'));
});

document.getElementById('closeArena').onclick  = ()=> closeArena();
document.getElementById('openFishingBtn').onclick = openFishing;
document.getElementById('closeFishing').onclick = closeFishing;
document.getElementById('startFishingCast').onclick = startFishingCast;
document.getElementById('prepareBaitBtn').onclick = prepareBasicBait;
fishingPlayfield.addEventListener('pointerdown', e => { e.preventDefault(); fishingHolding = true; });
window.addEventListener('pointerup', () => fishingHolding = false);
window.addEventListener('keydown', e => { if (e.code === 'Space' && fishingModal.style.display === 'flex') { e.preventDefault(); fishingHolding = true; } });
window.addEventListener('keyup', e => { if (e.code === 'Space') fishingHolding = false; });
saveBtn.onclick = () => saveGame(true);
resetSaveBtn.onclick = resetSave;
recycleScrapBtn.onclick = () => {
  if (scrap < SCRAP_RECYCLE_COST) return;
  scrap -= SCRAP_RECYCLE_COST;
  skills.find(s=>s.id==='Mining').qty += 1;
  showToast('Recycled 5 Scrap into 1 Ore');
};

arenaTierSelect.onchange = () => {
  const requested = Number(arenaTierSelect.value);
  selectedArenaTier = requested <= arenaTierUnlocked ? requested : arenaTierUnlocked;
  updateArenaTierUI();
};
fightBtn.onclick = ()=>{
  const tier = currentArenaTier();
  if (Math.floor(keys) >= tier.keyCost) {
    keys -= tier.keyCost;
    openArena();
  }
};

function onKey(e){
  keysDown[e.code]=true;
  if(e.code==='Space' && arena) arena.you.dash=0.18;
}
function onKeyUp(e){ delete keysDown[e.code]; }
function onClick(e){
  if (!arena) return;
  const rect = cv.getBoundingClientRect();
  const mx = (e.clientX - rect.left) * cv.width / rect.width;
  const my = (e.clientY - rect.top) * cv.height / rect.height;
  const dx = mx - arena.you.x, dy = my - arena.you.y;
  const len = Math.hypot(dx,dy) || 1;
  arena.shots.push({ x: arena.you.x, y: arena.you.y, vx: dx/len*400, vy: dy/len*400, t:0 });
}

resultOk.onclick = () => {
  if (lastFightResult?.win) {
    const parts = [`+${lastFightResult.oreGain} Ore`];
    if (lastFightResult.gotGem) parts.push(`+1 Rare Gem`);
    parts.push(`1.5x for ${Math.floor(lastFightResult.buffSecs/60)}m`);
    showToast(`Victory rewards: ${parts.join('  ')}`);
    applyWinRewards();
  } else {
    showToast('Defeat recorded');
  }
  resultModal.style.display = 'none';
  lastFightResult = null;
};

