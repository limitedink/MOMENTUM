import { describe, expect, it } from 'vitest';
import { normalizeSoloCombatControls } from '../src/game/solo-frontier';

describe('Solo Frontier combat-control persistence', () => {
  it('rehydrates saved controls exactly and keeps the visible configuration stable after reload', () => {
    const saved = {
      stance: 'Guarded',
      technique: 'Arc Bolt',
      defensive: 'Arcane Barrier',
      aura: 'Battle Focus'
    };
    const loaded = normalizeSoloCombatControls(saved, 'magic');
    const reloaded = normalizeSoloCombatControls(JSON.parse(JSON.stringify(loaded)), 'magic');
    expect(loaded).toEqual(saved);
    expect(reloaded).toEqual(saved);
  });

  it('rehydrates a stale saved technique to the active weapon style instead of Basic Attack', () => {
    expect(normalizeSoloCombatControls({ stance: 'Aggressive', technique: 'Arc Bolt', defensive: 'Mend', aura: 'none' }, 'gun')).toEqual({
      stance: 'Aggressive', technique: 'Burst Fire', defensive: 'Mend', aura: 'none'
    });
  });
});
