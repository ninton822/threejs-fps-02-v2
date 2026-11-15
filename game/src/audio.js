// Procedural sound: every effect is synthesized with WebAudio, so the game ships
// no audio files and makes no network request. The context is created on the first
// user gesture; calls before that are no-ops.
export function createAudio() {
  let ctx = null;
  let master = null;

  function ensure() {
    if (ctx) return true;
    try {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return false;
      ctx = new AC();
      master = ctx.createGain();
      master.gain.value = 0.5;
      master.connect(ctx.destination);
    } catch {
      return false;
    }
    return true;
  }

  function noiseBurst(duration, filterFreq, gain, when = 0) {
    if (!ctx) return;
    const t = ctx.currentTime + when;
    const length = Math.max(1, Math.floor(ctx.sampleRate * duration));
    const buffer = ctx.createBuffer(1, length, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < length; i += 1) data[i] = (Math.random() * 2 - 1) * (1 - i / length);
    const source = ctx.createBufferSource();
    source.buffer = buffer;
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = filterFreq;
    const g = ctx.createGain();
    g.gain.setValueAtTime(gain, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + duration);
    source.connect(filter);
    filter.connect(g);
    g.connect(master);
    source.start(t);
  }

  function tone(freq, duration, gain, type = 'sine', slideTo = 0) {
    if (!ctx) return;
    const t = ctx.currentTime;
    const osc = ctx.createOscillator();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t);
    if (slideTo) osc.frequency.exponentialRampToValueAtTime(slideTo, t + duration);
    const g = ctx.createGain();
    g.gain.setValueAtTime(gain, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + duration);
    osc.connect(g);
    g.connect(master);
    osc.start(t);
    osc.stop(t + duration + 0.02);
  }

  function unlock() {
    if (ensure() && ctx.state === 'suspended') ctx.resume();
  }

  return {
    unlock,
    shot(distant = false) {
      if (!ensure()) return;
      if (distant) {
        noiseBurst(0.09, 900, 0.12);
        tone(140, 0.08, 0.06, 'square', 70);
      } else {
        noiseBurst(0.11, 2400, 0.5);
        tone(180, 0.09, 0.22, 'square', 60);
      }
    },
    dryFire() {
      if (!ensure()) return;
      tone(900, 0.03, 0.08, 'square');
    },
    reload() {
      if (!ensure()) return;
      tone(500, 0.04, 0.1, 'square');
      setTimeout(() => tone(700, 0.04, 0.1, 'square'), 350);
    },
    hit(kill) {
      if (!ensure()) return;
      tone(kill ? 1400 : 1050, 0.05, 0.12, 'sine');
      if (kill) setTimeout(() => tone(1800, 0.07, 0.12, 'sine'), 70);
    },
    hurt() {
      if (!ensure()) return;
      tone(220, 0.14, 0.18, 'sawtooth', 110);
    },
    plantBeep(final = false) {
      if (!ensure()) return;
      tone(final ? 1600 : 1100, final ? 0.3 : 0.07, 0.14, 'sine');
    },
    explosion() {
      if (!ensure()) return;
      noiseBurst(0.9, 500, 0.9);
      tone(90, 0.8, 0.5, 'sine', 35);
    },
    roundWin() {
      if (!ensure()) return;
      tone(660, 0.12, 0.14, 'sine');
      setTimeout(() => tone(880, 0.18, 0.14, 'sine'), 120);
    },
    roundLose() {
      if (!ensure()) return;
      tone(330, 0.16, 0.14, 'sine');
      setTimeout(() => tone(220, 0.24, 0.14, 'sine'), 160);
    },
    buy() {
      if (!ensure()) return;
      tone(1200, 0.05, 0.1, 'sine');
    },
    click() {
      if (!ensure()) return;
      tone(800, 0.03, 0.07, 'square');
    },
  };
}
