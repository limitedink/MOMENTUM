import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
// jsdom is bundled for Vitest DOM contracts but this repo intentionally does
// not carry the optional @types/jsdom package.
// @ts-expect-error JS-only dependency
import { JSDOM } from 'jsdom';
import { describe, expect, it } from 'vitest';

const root = process.cwd();
const html = readFileSync(resolve(root, 'index.html'), 'utf8');
const script = readFileSync(resolve(root, 'script.js'), 'utf8');
const arena = readFileSync(resolve(root, 'arena.js'), 'utf8');
const styles = readFileSync(resolve(root, 'styles.scss'), 'utf8');

describe('Wayfinder Arsenal automated UI contract', () => {
  it('declares one canonical inventory surface with all controls and exactly 35 rendered positions', () => {
    const dom = new JSDOM(html);
    const document = dom.window.document;
    expect(document.querySelectorAll('#soloCacheList')).toHaveLength(1);
    expect(document.querySelector('#lootInventoryList')).toBeNull();
    expect(document.querySelector('#soloCacheRarityFilter')).toBeTruthy();
    expect(document.querySelector('#soloCacheSlotFilter')).toBeTruthy();
    expect(document.querySelector('#soloCacheSort')).toBeTruthy();
    expect(document.querySelector('#soloCacheFavouritesOnly')).toBeTruthy();
    expect(document.querySelector('#soloCachePageControls')).toBeTruthy();
    expect(script).toContain('Array.from({ length:35 }');
    expect(script).toContain('const pageOffset = soloDeskCachePage * 35');
    expect(script).toContain("['ArrowLeft','ArrowRight','ArrowUp','ArrowDown']");
    expect(script).not.toContain('let lootInventory');
    expect(script).not.toContain('const weaponRefinements');
  });

  it('locks the responsive grid to 7x5 desktop and 5x7 mobile without hiding empty cells', () => {
    expect(styles).toMatch(/\.solo-cache-list\s*\{[^}]*grid-template-columns:repeat\(7,minmax\(0,1fr\)\)/s);
    expect(styles).toMatch(/@media\(max-width:520px\)[\s\S]*?\.solo-cache-list\s*\{[^}]*grid-template-columns:repeat\(5,minmax\(0,1fr\)\)/);
    expect(script).toContain('class="solo-cache-cell is-empty"');
    expect(styles).toContain('.solo-cache-cell { min-width:0;');
  });

  it('uses the shared rarity-owned item visual on inventory, paper doll, loot reveal, inspector, and store', () => {
    expect(script).toContain('function itemVisualMarkup(instance, cache');
    for (const surface of ['cache-item-visual', 'paper-doll-item', 'loot-reveal-icon', 'inspector-item-visual', 'daily-offer-icon', 'loadout-item-visual', 'workshop-item-visual', 'debrief-item-visual']) {
      expect(script).toContain(surface);
    }
    expect(styles).toMatch(/\.item-visual\s*\{[^}]*border:2px solid var\(--rarity-color/s);
    expect(styles).toMatch(/\.paper-doll-slot\.is-active-weapon\s*\{[^}]*box-shadow:inset/s);
    expect(styles).not.toMatch(/\.paper-doll-slot\.is-active-weapon\s*\{[^}]*border(?:-color)?:/s);
  });

  it('keeps the spatial 4/6/7 desktop paper-doll grouping and exact-slot filtering', () => {
    expect(script).toContain("['arsenal', ['melee','gun','ranged','magic']]");
    expect(script).toContain("['armour', ['helm','chest','gloves','pants','boots','cloak']]");
    expect(script).toContain("['accessories', ['amulet','belt','ring1','ring2','trinket1','trinket2','food']]");
    expect(script).toContain("LOOT_FRAMEWORK.validateEquipItem(instance, soloDeskCacheSlot).accepted");
    expect(script).toContain("soloDeskCacheSlot = slot === 'food' ? 'all' : slot");
  });

  it('previews tree allocation, requires explicit confirmation, and exposes the Survival Report', () => {
    const dom = new JSDOM(html);
    const document = dom.window.document;
    expect(document.querySelector('#soloSurvivalReport')).toBeTruthy();
    expect(document.querySelector('#soloSurvivalReportBody')).toBeTruthy();
    expect(document.querySelector('#soloThreatIntel')).toBeTruthy();
    expect(script).toContain('LIVE BUILD PROFILE');
    expect(script).toContain('renderSoloThreatIntel');
    expect(script).toContain('armourPieceCounts');
    expect(script).toContain('data-defense-tree');
    expect(script).toContain('paper-doll-armour-summary');
    expect(script).toContain('id="allocateCombatTreeNode"');
    expect(script).toContain('selectedCombatTreeNodeId = button.dataset.combatTreeNode');
    expect(script).toContain("['Support Magic','Reflexes','Healing','Vitality']");
    expect(styles).toContain('.survival-report-grid { display:grid;');
    expect(styles).toContain('.combat-tree-node.is-selected');
  });

  it('reuses representable Sustain modifiers in Arena without adding tree-generated skill events', () => {
    expect(arena).toContain('window.MomentumCombatDevelopment?.resolveSustainProfile');
    expect(arena).toContain('profile.mendTriggerHealthPercent');
    expect(arena).toContain('profile.mendCooldownMultiplier');
    expect(arena).toContain('profile.regenerationPctPerSecond');
    expect(arena).toContain('fatalGuard.fatalGuardPct');
    expect(arena).toContain('resolveArenaDefenseProfile');
    expect(arena).toContain('profile.barrierStrengthMultiplier');
    expect(arena).not.toMatch(/Indomitable[\s\S]{0,220}emitCombatSkillUse/);
  });
});
