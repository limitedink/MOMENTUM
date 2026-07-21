import '../styles.scss';
import './game/combat-progression';
import './game/skills';
import './game/loot';
import './game/world';
import './game/solo-frontier';
import './game/expeditions';
import './party/party-transport';
import './party/party-store';
import './party/party-controller';
import { createPartyRuntime, resolvePartyRuntimeMode } from './party/party-runtime';

const partyClient = createPartyRuntime({ mode: resolvePartyRuntimeMode() });
window.MomentumPartyRuntime = partyClient;
window.MomentumPartySync = partyClient;
import audioUrl from '../audio.js?url';
import arenaUrl from '../arena.js?url';
import gameUrl from '../script.js?url';
import taskbarUrl from '../taskbar.js?url';

// The legacy RPG still uses shared globals, so these files remain classic
// scripts. Typed party modules are imported above before taskbar.js runs.
const confettiUrl = 'https://cdn.jsdelivr.net/npm/canvas-confetti@1.9.2/dist/confetti.browser.min.js';
const legacyScriptUrls = [audioUrl, arenaUrl, gameUrl, taskbarUrl];

function loadLegacyScript(url: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = url;
    script.async = false;
    script.onload = () => resolve();
    script.onerror = () => reject(new Error(`Momentum failed to load legacy runtime asset: ${url}`));
    document.head.appendChild(script);
  });
}

async function loadLegacyRuntime(): Promise<void> {
  try {
    await loadLegacyScript(confettiUrl);
  } catch (error) {
    console.warn('Momentum confetti enhancement unavailable; continuing without it.', error);
  }
  for (const url of legacyScriptUrls) await loadLegacyScript(url);
}

function startLegacyRuntime(): void {
  loadLegacyRuntime().catch(error => {
    console.error(error);
    document.documentElement.dataset.momentumBootError = 'true';
  });
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', startLegacyRuntime, { once: true });
} else {
  startLegacyRuntime();
}
