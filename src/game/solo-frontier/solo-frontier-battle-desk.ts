import type { SoloCombatEvent, SoloEnemyDefinition, WeaponStyle } from './solo-frontier-types';

export interface SoloBattleDeskSnapshot {
  stage: number | null;
  victories: number;
  victoriesToClear: number;
  enemy: SoloEnemyDefinition | null;
  playerName: string;
  activeWeapon: string;
  weaponStyle: WeaponStyle | string;
  playerHitPoints: number;
  playerMaxHitPoints: number;
  enemyHitPoints: number;
  enemyMaxHitPoints: number;
  lastEvent: SoloCombatEvent | null;
  lastAction: string;
  outcome: 'victory' | 'defeat' | null;
  outcomeLabel: string;
  effects: readonly ('aura' | 'barrier' | 'hit' | 'heal' | 'victory' | 'defeat')[];
  reducedMotion: boolean;
}

export interface SoloBattleDeskRenderer {
  render(snapshot: SoloBattleDeskSnapshot): void;
  resize(): void;
}

const TAU = Math.PI * 2;

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.max(minimum, Math.min(maximum, value));
}

function ratio(value: number, maximum: number): number {
  return maximum > 0 ? clamp(value / maximum, 0, 1) : 0;
}

function drawText(
  context: CanvasRenderingContext2D,
  text: string,
  x: number,
  y: number,
  size: number,
  color: string,
  align: CanvasTextAlign = 'left',
  weight = 700
): void {
  context.font = `${weight} ${size}px ui-monospace, SFMono-Regular, Menlo, monospace`;
  context.textAlign = align;
  context.textBaseline = 'middle';
  context.fillStyle = color;
  context.fillText(text, x, y);
}

function drawBar(
  context: CanvasRenderingContext2D,
  x: number,
  y: number,
  width: number,
  value: number,
  maximum: number,
  fill: string,
  label: string,
  rightLabel: string
): void {
  context.fillStyle = 'rgba(4, 9, 19, .88)';
  context.fillRect(x, y, width, 22);
  context.strokeStyle = 'rgba(85, 217, 255, .28)';
  context.strokeRect(x + .5, y + .5, width - 1, 21);
  context.fillStyle = fill;
  context.fillRect(x + 2, y + 2, Math.max(0, (width - 4) * ratio(value, maximum)), 18);
  drawText(context, label, x + 10, y + 11, 10, '#f1f6ff', 'left', 800);
  drawText(context, rightLabel, x + width - 10, y + 11, 10, '#a3b1cf', 'right', 700);
}

function drawPlayerSilhouette(context: CanvasRenderingContext2D, x: number, y: number, scale: number, style: string, guarded: boolean): void {
  context.save();
  context.translate(x, y);
  context.scale(scale, scale);
  context.fillStyle = '#0b1325';
  context.strokeStyle = guarded ? '#66e6a9' : '#55d9ff';
  context.lineWidth = 2;
  context.shadowColor = guarded ? 'rgba(102,230,169,.58)' : 'rgba(85,217,255,.58)';
  context.shadowBlur = 18;
  context.beginPath();
  context.arc(0, -76, 22, 0, TAU);
  context.fill();
  context.stroke();
  context.beginPath();
  context.moveTo(-28, -50);
  context.lineTo(-36, 20);
  context.lineTo(-20, 54);
  context.lineTo(0, 62);
  context.lineTo(20, 54);
  context.lineTo(36, 20);
  context.lineTo(28, -50);
  context.closePath();
  context.fill();
  context.stroke();
  context.shadowBlur = 0;
  context.strokeStyle = '#ffc857';
  context.lineWidth = 5;
  context.lineCap = 'round';
  if (style.includes('melee')) {
    context.beginPath();
    context.moveTo(22, -12);
    context.lineTo(74, -38);
    context.stroke();
  } else if (style === 'magic') {
    context.beginPath();
    context.arc(41, -20, 15, 0, TAU);
    context.stroke();
  } else {
    context.beginPath();
    context.moveTo(23, -15);
    context.lineTo(71, -15);
    context.stroke();
  }
  context.restore();
}

function drawEnemySilhouette(context: CanvasRenderingContext2D, x: number, y: number, scale: number, boss: boolean, damaged: boolean): void {
  context.save();
  context.translate(x, y);
  context.scale(scale, scale);
  context.fillStyle = damaged ? '#241421' : '#160f20';
  context.strokeStyle = boss ? '#ff687f' : '#a68aff';
  context.lineWidth = boss ? 3 : 2;
  context.shadowColor = boss ? 'rgba(255,104,127,.55)' : 'rgba(166,138,255,.45)';
  context.shadowBlur = boss ? 24 : 16;
  context.beginPath();
  context.moveTo(0, -96);
  context.lineTo(31, -61);
  context.lineTo(43, -15);
  context.lineTo(31, 45);
  context.lineTo(0, 72);
  context.lineTo(-31, 45);
  context.lineTo(-43, -15);
  context.lineTo(-31, -61);
  context.closePath();
  context.fill();
  context.stroke();
  context.beginPath();
  context.moveTo(-42, -52);
  context.lineTo(-70, -94);
  context.lineTo(-24, -72);
  context.moveTo(42, -52);
  context.lineTo(70, -94);
  context.lineTo(24, -72);
  context.stroke();
  context.shadowBlur = 0;
  context.fillStyle = '#ff687f';
  context.beginPath();
  context.arc(-14, -21, 4, 0, TAU);
  context.arc(14, -21, 4, 0, TAU);
  context.fill();
  context.restore();
}

function drawAttackLine(context: CanvasRenderingContext2D, fromX: number, fromY: number, toX: number, toY: number, color: string, magical: boolean): void {
  context.save();
  context.strokeStyle = color;
  context.lineWidth = magical ? 5 : 3;
  context.globalAlpha = .9;
  context.shadowColor = color;
  context.shadowBlur = 16;
  context.setLineDash(magical ? [5, 7] : []);
  context.beginPath();
  context.moveTo(fromX, fromY);
  context.lineTo(toX, toY);
  context.stroke();
  context.restore();
}

function drawEffects(context: CanvasRenderingContext2D, x: number, y: number, effects: SoloBattleDeskSnapshot['effects']): void {
  if (effects.includes('barrier')) {
    context.save();
    context.strokeStyle = 'rgba(85, 217, 255, .92)';
    context.lineWidth = 3;
    context.shadowColor = '#55d9ff';
    context.shadowBlur = 18;
    context.beginPath();
    context.arc(x, y - 28, 75, Math.PI * .95, Math.PI * 2.05);
    context.stroke();
    context.restore();
  }
  if (effects.includes('aura')) {
    context.save();
    context.strokeStyle = 'rgba(255, 200, 87, .86)';
    context.lineWidth = 2;
    context.setLineDash([4, 8]);
    context.beginPath();
    context.arc(x, y - 28, 91, 0, TAU);
    context.stroke();
    context.restore();
  }
}

function createRenderer(canvas: HTMLCanvasElement): SoloBattleDeskRenderer {
  const context = canvas.getContext('2d');
  if (!context) {
    return { render: () => undefined, resize: () => undefined };
  }

  const render = (snapshot: SoloBattleDeskSnapshot): void => {
    const width = canvas.width;
    const height = canvas.height;
    context.clearRect(0, 0, width, height);

    const gradient = context.createLinearGradient(0, 0, 0, height);
    gradient.addColorStop(0, '#071225');
    gradient.addColorStop(.55, '#0d1428');
    gradient.addColorStop(1, '#060b18');
    context.fillStyle = gradient;
    context.fillRect(0, 0, width, height);

    context.strokeStyle = 'rgba(85, 217, 255, .06)';
    context.lineWidth = 1;
    for (let x = 0; x <= width; x += 42) {
      context.beginPath();
      context.moveTo(x, 0);
      context.lineTo(x, height);
      context.stroke();
    }
    for (let y = 0; y <= height; y += 42) {
      context.beginPath();
      context.moveTo(0, y);
      context.lineTo(width, y);
      context.stroke();
    }

    context.fillStyle = 'rgba(5, 9, 19, .66)';
    context.fillRect(0, height - 102, width, 102);
    context.strokeStyle = 'rgba(74, 103, 160, .34)';
    context.beginPath();
    context.moveTo(0, height - 102.5);
    context.lineTo(width, height - 102.5);
    context.stroke();

    const stageLabel = snapshot.stage ? `STAGE ${String(snapshot.stage).padStart(2, '0')}` : 'OUTPOST // READY';
    drawText(context, stageLabel, 24, 28, 13, '#55d9ff', 'left', 800);
    drawText(context, snapshot.enemy ? `${snapshot.enemy.kind === 'boss' ? 'BOSS' : 'CONTACT'} // ${snapshot.enemy.name.toUpperCase()}` : 'SELECT PUSH OR FARM TO OPEN THE LINE', width - 24, 28, 12, '#a3b1cf', 'right', 700);

    if (!snapshot.enemy || !snapshot.stage) {
      context.save();
      context.globalAlpha = .72;
      drawText(context, 'THE DESK IS QUIET', width / 2, height / 2 - 18, 25, '#f1f6ff', 'center', 900);
      drawText(context, 'Push the next cleared edge or select a farm stage.', width / 2, height / 2 + 20, 12, '#a3b1cf', 'center', 600);
      context.restore();
      return;
    }

    const playerX = width * .29;
    const enemyX = width * .71;
    const actorY = height * .53;
    const currentEvent = snapshot.lastEvent;
    const playerHit = currentEvent?.type === 'attack' && currentEvent.actor === 'player';
    const enemyHit = currentEvent?.type === 'attack' && currentEvent.actor === 'enemy';
    const magical = currentEvent?.type === 'attack' && currentEvent.damageType === 'magical';
    const effects = snapshot.effects;

    if (playerHit) drawAttackLine(context, playerX + 58, actorY - 35, enemyX - 62, actorY - 34, magical ? '#a68aff' : '#ffc857', magical);
    if (enemyHit) drawAttackLine(context, enemyX - 57, actorY - 35, playerX + 61, actorY - 34, '#ff687f', false);
    drawEffects(context, playerX, actorY, effects);
    drawPlayerSilhouette(context, playerX, actorY, snapshot.enemy.kind === 'boss' ? 1.06 : 1, String(snapshot.weaponStyle), effects.includes('barrier'));
    drawEnemySilhouette(context, enemyX, actorY, snapshot.enemy.kind === 'boss' ? 1.15 : .98, snapshot.enemy.kind === 'boss', effects.includes('hit'));

    drawText(context, snapshot.playerName, playerX, actorY + 86, 12, '#f1f6ff', 'center', 800);
    drawText(context, snapshot.activeWeapon.toUpperCase(), playerX, actorY + 106, 10, '#ffc857', 'center', 700);
    drawText(context, snapshot.enemy.name.toUpperCase(), enemyX, actorY + 86, 12, '#f1f6ff', 'center', 800);
    drawText(context, `${snapshot.enemy.kind === 'boss' ? 'ONE CLEAR' : `${snapshot.victories}/${snapshot.victoriesToClear} VICTORIES`}`, enemyX, actorY + 106, 10, '#ff9bb0', 'center', 700);

    drawBar(context, 26, height - 78, width * .36, snapshot.playerHitPoints, snapshot.playerMaxHitPoints, '#66e6a9', 'YOU', `${Math.max(0, Math.round(snapshot.playerHitPoints))}/${Math.round(snapshot.playerMaxHitPoints)}`);
    drawBar(context, width - 26 - width * .36, height - 78, width * .36, snapshot.enemyHitPoints, snapshot.enemyMaxHitPoints, '#ff687f', snapshot.enemy.kind === 'boss' ? 'BOSS' : 'ENEMY', `${Math.max(0, Math.round(snapshot.enemyHitPoints))}/${Math.round(snapshot.enemyMaxHitPoints)}`);

    if (snapshot.lastAction) {
      drawText(context, snapshot.lastAction, width / 2, height - 35, 11, snapshot.outcome ? (snapshot.outcome === 'victory' ? '#66e6a9' : '#ff687f') : '#ffc857', 'center', 800);
    }

    if (snapshot.outcome) {
      context.fillStyle = 'rgba(4, 8, 17, .65)';
      context.fillRect(width * .22, height * .19, width * .56, 76);
      context.strokeStyle = snapshot.outcome === 'victory' ? '#66e6a9' : '#ff687f';
      context.lineWidth = 2;
      context.strokeRect(width * .22 + .5, height * .19 + .5, width * .56 - 1, 75);
      drawText(context, snapshot.outcome === 'victory' ? 'FRONTIER CLEARED' : 'WALL DETECTED', width / 2, height * .19 + 27, 18, snapshot.outcome === 'victory' ? '#66e6a9' : '#ff687f', 'center', 900);
      drawText(context, snapshot.outcomeLabel, width / 2, height * .19 + 54, 11, '#f1f6ff', 'center', 700);
    }
  };

  return {
    render,
    resize: () => render({
      stage: null,
      victories: 0,
      victoriesToClear: 1,
      enemy: null,
      playerName: 'Wayfinder',
      activeWeapon: 'Frontier Sidearm',
      weaponStyle: 'gun',
      playerHitPoints: 1,
      playerMaxHitPoints: 1,
      enemyHitPoints: 1,
      enemyMaxHitPoints: 1,
      lastEvent: null,
      lastAction: '',
      outcome: null,
      outcomeLabel: '',
      effects: [],
      reducedMotion: true
    })
  };
}

declare global {
  interface Window {
    MomentumSoloFrontierBattleDeskRenderer?: {
      create(canvas: HTMLCanvasElement): SoloBattleDeskRenderer;
    };
  }
}

export const MomentumSoloFrontierBattleDeskRenderer = Object.freeze({ create: createRenderer });

if (typeof window !== 'undefined') window.MomentumSoloFrontierBattleDeskRenderer = MomentumSoloFrontierBattleDeskRenderer;

