(() => {
  'use strict';

  let context = null;
  let master = null;
  let muted = false;
  let volume = 0.6;

  function ensureContext() {
    if (context) {
      if (context.state === 'suspended') context.resume();
      return context;
    }
    const AudioContext = window.AudioContext || window.webkitAudioContext;
    if (!AudioContext) return null;
    context = new AudioContext();
    master = context.createGain();
    master.connect(context.destination);
    updateGain();
    return context;
  }

  function updateGain() {
    if (master) master.gain.setValueAtTime(muted ? 0 : volume, context.currentTime);
  }

  function tone(frequency, duration, options = {}) {
    const audio = ensureContext();
    if (!audio || muted) return;
    const oscillator = audio.createOscillator();
    const gain = audio.createGain();
    oscillator.type = options.type || 'sine';
    oscillator.frequency.setValueAtTime(frequency, audio.currentTime);
    if (options.endFrequency) oscillator.frequency.exponentialRampToValueAtTime(options.endFrequency, audio.currentTime + duration);
    gain.gain.setValueAtTime(options.gain || 0.12, audio.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, audio.currentTime + duration);
    oscillator.connect(gain);
    gain.connect(master);
    oscillator.start();
    oscillator.stop(audio.currentTime + duration);
  }

  function emit(type, payload = {}) {
    if (type === 'attack') tone(payload.styleId === 'melee' ? 150 : 430, payload.styleId === 'melee' ? 0.12 : 0.05, { type:payload.styleId === 'melee' ? 'sawtooth' : 'square', endFrequency:payload.styleId === 'melee' ? 85 : 300, gain:0.08 });
    if (type === 'bossHit') tone(payload.heavy ? 110 : 180, payload.heavy ? 0.16 : 0.08, { type:'square', endFrequency:70, gain:0.1 });
    if (type === 'playerHit') tone(95, 0.2, { type:'sawtooth', endFrequency:48, gain:0.13 });
    if (type === 'dash') tone(240, 0.1, { type:'sine', endFrequency:650, gain:0.09 });
    if (type === 'telegraph') tone(payload.kind === 'wave' ? 120 : 260, 0.25, { type:'triangle', endFrequency:payload.kind === 'wave' ? 190 : 330, gain:0.08 });
    if (type === 'wave') tone(80, 0.3, { type:'sawtooth', endFrequency:45, gain:0.12 });
    if (type === 'talent') {
      tone(520, 0.12, { type:'triangle', endFrequency:780, gain:0.09 });
      setTimeout(() => tone(780, 0.16, { type:'triangle', endFrequency:1040, gain:0.08 }), 70);
    }
    if (type === 'food') tone(360, 0.18, { type:'sine', endFrequency:720, gain:0.1 });
    if (type === 'victory') {
      [440, 554, 659].forEach((note, index) => setTimeout(() => tone(note, 0.35, { type:'triangle', gain:0.1 }), index * 110));
    }
    if (type === 'defeat') tone(180, 0.55, { type:'sawtooth', endFrequency:60, gain:0.1 });
    if (type === 'catch') tone(620, 0.18, { type:'triangle', endFrequency:900, gain:0.08 });
    if (type === 'lineBreak') tone(260, 0.25, { type:'square', endFrequency:80, gain:0.08 });
  }

  window.addEventListener('pointerdown', ensureContext, { once:true });
  window.addEventListener('keydown', ensureContext, { once:true });

  window.MomentumAudio = Object.freeze({
    emit,
    setMuted(value) { muted = Boolean(value); updateGain(); },
    setVolume(value) { volume = Math.max(0, Math.min(1, Number(value))); updateGain(); },
    configure(settings = {}) {
      muted = Boolean(settings.muted);
      volume = Number.isFinite(Number(settings.volume)) ? Math.max(0, Math.min(1, Number(settings.volume))) : 0.6;
      updateGain();
    }
  });
})();
