/* =========================================================
 * audio.js — WebAudio 纯合成音效，零素材
 * ========================================================= */

export class Sfx {
  constructor() {
    this.ctx = null;
    this.master = null;
    this.noiseBuf = null;
    this.muted = false;
    try {
      this.muted = localStorage.getItem('catRunnerMuted') === '1';
    } catch (e) { /* ignore */ }
  }

  unlock() {
    if (!this.ctx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return;
      this.ctx = new AC();
      this.master = this.ctx.createGain();
      this.master.gain.value = this.muted ? 0 : 0.55;
      this.master.connect(this.ctx.destination);
      const len = Math.floor(this.ctx.sampleRate * 0.6);
      this.noiseBuf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
      const d = this.noiseBuf.getChannelData(0);
      for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    }
    if (this.ctx.state === 'suspended') this.ctx.resume();
  }

  setMuted(m) {
    this.muted = m;
    if (this.master) this.master.gain.value = m ? 0 : 0.55;
    try { localStorage.setItem('catRunnerMuted', m ? '1' : '0'); } catch (e) { /* ignore */ }
  }

  toggle() {
    this.setMuted(!this.muted);
    if (!this.muted) {
      this.unlock();
      this.tone(660, 0.08, 'sine', 0.25, 880);
    }
    return this.muted;
  }

  tone(freq, dur, type = 'sine', vol = 0.3, slideTo = null, delay = 0, attack = 0.006) {
    if (!this.ctx || this.muted) return;
    const t0 = this.ctx.currentTime + delay;
    const o = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    o.type = type;
    o.frequency.setValueAtTime(freq, t0);
    if (slideTo) o.frequency.exponentialRampToValueAtTime(Math.max(20, slideTo), t0 + dur);
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(vol, t0 + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    o.connect(g).connect(this.master);
    o.start(t0);
    o.stop(t0 + dur + 0.02);
  }

  noise(dur = 0.2, vol = 0.35, freq = 900, q = 0.8) {
    if (!this.ctx || this.muted) return;
    const t0 = this.ctx.currentTime;
    const src = this.ctx.createBufferSource();
    src.buffer = this.noiseBuf;
    const f = this.ctx.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.value = freq;
    f.Q.value = q;
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(vol, t0);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    src.connect(f).connect(g).connect(this.master);
    src.start(t0);
    src.stop(t0 + dur);
  }

  jump() {
    this.tone(320, 0.16, 'triangle', 0.22, 720);
    this.tone(640, 0.1, 'sine', 0.1, 980, 0.02);
  }

  land() {
    this.tone(150, 0.09, 'sine', 0.16, 90);
    this.noise(0.06, 0.05, 500);
  }


  coin() {
    this.tone(1046, 0.07, 'square', 0.1);
    this.tone(1568, 0.11, 'square', 0.08, null, 0.055);
  }

  power() {
    [523, 659, 784, 1046].forEach((f, i) => this.tone(f, 0.14, 'triangle', 0.16, null, i * 0.055));
  }

  shield() {
    this.tone(880, 0.1, 'sawtooth', 0.12, 440);
    this.noise(0.16, 0.12, 3200);
  }

  hit() {
    this.noise(0.34, 0.4, 700);
    this.tone(120, 0.3, 'sawtooth', 0.22, 45);
    this.tone(70, 0.4, 'sine', 0.2, 30, 0.03);
  }

  splash() {
    this.noise(0.4, 0.3, 1400);
    this.tone(180, 0.35, 'sine', 0.18, 50);
  }

  milestone() {
    [784, 1046].forEach((f, i) => this.tone(f, 0.18, 'triangle', 0.16, null, i * 0.09));
  }

  record() {
    [523, 659, 784, 1046, 1318].forEach((f, i) => this.tone(f, 0.22, 'square', 0.1, null, i * 0.075));
  }

  pause() {
    this.tone(520, 0.1, 'sine', 0.12, 380);
  }

  dash() {
    this.tone(300, 0.25, 'sawtooth', 0.14, 1200);
    this.noise(0.25, 0.12, 2400);
  }
}
