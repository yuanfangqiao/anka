/* 纸飞机 · Paper Flight ------------------------------------------------
 * 一个自包含的 Canvas 竖版射击小游戏。
 * 移动：鼠标 / 触摸拖动 / 方向键   射击：自动
 * 视觉：奶油白纸张 + 墨点 + 折纸元素
 */
(() => {
  'use strict';

  const STORAGE_KEY = 'anka.paper-plane.v1';
  const TAU = Math.PI * 2;

  const canvas = document.getElementById('stage');
  const ctx = canvas.getContext('2d');
  const app = document.getElementById('app');

  const els = {
    startLayer: document.getElementById('startLayer'),
    pauseLayer: document.getElementById('pauseLayer'),
    overLayer: document.getElementById('overLayer'),
    startBtn: document.getElementById('startBtn'),
    againBtn: document.getElementById('againBtn'),
    homeBtn: document.getElementById('homeBtn'),
    resumeBtn: document.getElementById('resumeBtn'),
    restartBtn: document.getElementById('restartBtn'),
    pauseHomeBtn: document.getElementById('pauseHomeBtn'),
    pauseBtn: document.getElementById('pauseBtn'),
    soundBtn: document.getElementById('soundBtn'),
    score: document.getElementById('score'),
    bestHud: document.getElementById('bestHud'),
    bestStart: document.getElementById('bestStart'),
    combo: document.getElementById('combo'),
    comboCount: document.getElementById('comboCount'),
    comboMult: document.getElementById('comboMult'),
    powerChip: document.getElementById('powerChip'),
    powerSec: document.getElementById('powerSec'),
    waveLabel: document.getElementById('waveLabel'),
    lives: document.getElementById('lives'),
    toast: document.getElementById('toast'),
    tip: document.getElementById('tip'),
    finalScore: document.getElementById('finalScore'),
    finalBest: document.getElementById('finalBest'),
    finalKills: document.getElementById('finalKills'),
    finalWave: document.getElementById('finalWave'),
    newRecord: document.getElementById('newRecord'),
  };

  const clamp = (v, min, max) => (v < min ? min : v > max ? max : v);
  const rand = (min, max) => min + Math.random() * (max - min);
  const hash = (n) => {
    const v = Math.sin(n * 127.1 + 311.7) * 43758.5453;
    return v - Math.floor(v);
  };

  const world = { w: 1, h: 1, s: 1, v: 1, dpr: 1 };

  /* ── 偏好设置 ─────────────────────────────────────────────────── */

  const prefs = (() => {
    const fallback = { best: 0, muted: false };
    try {
      const raw = JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}');
      if (!raw || typeof raw !== 'object') return fallback;
      return {
        best: Number.isFinite(Number(raw.best)) ? Math.max(0, Math.floor(Number(raw.best))) : 0,
        muted: raw.muted === true,
      };
    } catch (_) {
      return fallback;
    }
  })();

  function savePrefs() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(prefs));
    } catch (_) {
      /* 隐私模式下忽略 */
    }
  }

  /* ── 声音（纯 WebAudio，无外部资源） ───────────────────────────── */

  const audio = {
    ac: null,
    master: null,
    noiseBuf: null,
    muted: prefs.muted,

    init() {
      if (this.ac) {
        this.resume();
        return;
      }
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return;
      try {
        this.ac = new AC();
        this.master = this.ac.createGain();
        this.master.gain.value = 0.55;
        this.master.connect(this.ac.destination);

        const len = Math.floor(this.ac.sampleRate * 0.6);
        const buf = this.ac.createBuffer(1, len, this.ac.sampleRate);
        const data = buf.getChannelData(0);
        for (let i = 0; i < len; i += 1) data[i] = Math.random() * 2 - 1;
        this.noiseBuf = buf;
      } catch (_) {
        this.ac = null;
      }
    },

    resume() {
      if (this.ac && this.ac.state === 'suspended') this.ac.resume().catch(() => {});
    },

    suspend() {
      if (this.ac && this.ac.state === 'running') this.ac.suspend().catch(() => {});
    },

    tone(freq, dur, opts = {}) {
      if (this.muted || !this.ac) return;
      const type = opts.type || 'sine';
      const vol = opts.vol == null ? 0.03 : opts.vol;
      const delay = opts.delay || 0;
      const slide = opts.slide || 0;
      const t0 = this.ac.currentTime + delay;
      const osc = this.ac.createOscillator();
      const gain = this.ac.createGain();
      osc.type = type;
      osc.frequency.setValueAtTime(freq, t0);
      if (slide) osc.frequency.exponentialRampToValueAtTime(Math.max(30, slide), t0 + dur);
      gain.gain.setValueAtTime(0.0001, t0);
      gain.gain.linearRampToValueAtTime(vol, t0 + 0.008);
      gain.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
      osc.connect(gain);
      gain.connect(this.master);
      osc.start(t0);
      osc.stop(t0 + dur + 0.03);
    },

    noise(dur, opts = {}) {
      if (this.muted || !this.ac || !this.noiseBuf) return;
      const vol = opts.vol == null ? 0.025 : opts.vol;
      const delay = opts.delay || 0;
      const freq = opts.freq || 1200;
      const t0 = this.ac.currentTime + delay;
      const src = this.ac.createBufferSource();
      src.buffer = this.noiseBuf;
      const filter = this.ac.createBiquadFilter();
      filter.type = 'lowpass';
      filter.frequency.value = freq;
      const gain = this.ac.createGain();
      gain.gain.setValueAtTime(0.0001, t0);
      gain.gain.linearRampToValueAtTime(vol, t0 + 0.006);
      gain.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
      src.connect(filter);
      filter.connect(gain);
      gain.connect(this.master);
      src.start(t0, rand(0, 0.3));
      src.stop(t0 + dur + 0.03);
    },

    shoot() {
      this.tone(rand(620, 730), 0.045, { type: 'triangle', vol: 0.011, slide: 420 });
    },
    pop() {
      this.tone(rand(190, 240), 0.09, { type: 'sine', vol: 0.028, slide: 120 });
      this.noise(0.05, { vol: 0.016, freq: 1800 });
    },
    ink() {
      this.tone(118, 0.1, { type: 'sine', vol: 0.009, slide: 82 });
    },
    hurt() {
      this.tone(190, 0.28, { type: 'sawtooth', vol: 0.035, slide: 58 });
      this.noise(0.2, { vol: 0.03, freq: 460 });
    },
    power() {
      [523, 659, 784].forEach((f, i) => {
        this.tone(f, 0.16, { type: 'sine', vol: 0.026, delay: i * 0.065 });
      });
    },
    wave() {
      this.tone(392, 0.15, { type: 'sine', vol: 0.022 });
      this.tone(523, 0.24, { type: 'sine', vol: 0.022, delay: 0.09 });
    },
    over() {
      [330, 262, 196].forEach((f, i) => {
        this.tone(f, 0.3, { type: 'sine', vol: 0.03, delay: i * 0.12 });
      });
    },
    select() {
      this.tone(540, 0.05, { type: 'sine', vol: 0.015, slide: 620 });
    },
  };

  /* ── 游戏状态 ─────────────────────────────────────────────────── */

  let mode = 'menu';
  let paused = false;
  let idleT = 0;
  let lastTs = 0;
  let tipTimer = 0;
  let toastTimer = 0;
  let runId = 0;

  const player = {
    x: 0,
    y: 0,
    tx: 0,
    ty: 0,
    vx: 0,
    r: 12,
    size: 22,
    lives: 3,
    inv: 0,
    power: 0,
    fireCd: 0,
    trail: [],
    bank: 0,
  };

  const state = {
    score: 0,
    displayScore: 0,
    best: prefs.best,
    kills: 0,
    combo: 0,
    comboTimer: 0,
    wave: 1,
    time: 0,
    spawnTimer: 0.45,
    shake: 0,
    hitFlash: 0,
  };

  let enemies = [];
  let bullets = [];
  let eBullets = [];
  let pickups = [];
  let particles = [];
  let pops = [];

  const keys = new Set();

  const ambient = { t: 0, scraps: [], dust: [], routes: [] };

  /* ── 画布尺寸与氛围元素 ───────────────────────────────────────── */

  function resize() {
    const rect = canvas.getBoundingClientRect();
    const w = Math.max(1, rect.width);
    const h = Math.max(1, rect.height);
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const pw = Math.round(w * dpr);
    const ph = Math.round(h * dpr);

    if (canvas.width !== pw || canvas.height !== ph) {
      canvas.width = pw;
      canvas.height = ph;
    }

    world.w = w;
    world.h = h;
    world.dpr = dpr;
    world.s = clamp(Math.min(w / 440, h / 720), 0.78, 1.5);
    world.v = clamp(h / 820, 0.82, 1.35);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    player.size = 24 * world.s;
    player.r = 11.5 * world.s;

    if (!player.x) {
      player.x = player.tx = w / 2;
      player.y = player.ty = h * 0.8;
    } else {
      player.tx = clamp(player.tx, 14 * world.s, w - 14 * world.s);
      player.ty = clamp(player.ty, h * 0.46, h - 28 * world.s);
      player.x = clamp(player.x, 14 * world.s, w - 14 * world.s);
      player.y = clamp(player.y, h * 0.46, h - 28 * world.s);
    }
    player.trail.length = 0;

    buildAmbient();
  }

  function buildAmbient() {
    const w = world.w;
    const h = world.h;
    const scrapCount = Math.round(clamp(w / 190, 4, 10));

    ambient.scraps = Array.from({ length: scrapCount }, (_, i) => ({
      x: rand(0, w),
      y: rand(0, h),
      size: rand(6, 17) * world.s,
      rot: rand(0, TAU),
      vr: rand(-0.35, 0.35),
      vy: rand(7, 17),
      sway: rand(2, 8),
      phase: rand(0, TAU),
      alpha: rand(0.1, 0.28),
    }));

    ambient.dust = Array.from({ length: 26 }, () => ({
      x: rand(0, w),
      y: rand(0, h),
      r: rand(0.5, 1.4),
      vy: rand(3, 8),
      phase: rand(0, TAU),
      alpha: rand(0.08, 0.2),
    }));

    ambient.routes = [
      { y: 0.22, c1x: 0.16, c1y: 0.16, c2x: 0.54, c2y: 0.3, drift: 0.7 },
      { y: 0.45, c1x: 0.18, c1y: 0.36, c2x: 0.66, c2y: 0.52, drift: 1.2 },
      { y: 0.68, c1x: 0.12, c1y: 0.6, c2x: 0.72, c2y: 0.76, drift: 0.5 },
    ];
  }

  function updateAmbient(dt) {
    const w = world.w;
    const h = world.h;
    ambient.t += dt;

    for (const s of ambient.scraps) {
      s.y += s.vy * dt;
      s.x += Math.sin(ambient.t * 0.55 + s.phase) * s.sway * dt;
      s.rot += s.vr * dt;
      if (s.y > h + 30) {
        s.y = -30;
        s.x = rand(0, w);
      }
      if (s.x < -30) s.x = w + 25;
      if (s.x > w + 30) s.x = -25;
    }

    for (const d of ambient.dust) {
      d.y += d.vy * dt;
      d.x += Math.sin(ambient.t * 0.4 + d.phase) * 2 * dt;
      if (d.y > h + 8) {
        d.y = -8;
        d.x = rand(0, w);
      }
    }
  }

  /* ── 工具：圆角矩形 / 纸飞机 ───────────────────────────────────── */

  function roundRectPath(x, y, w, h, r) {
    const rr = Math.min(r, w / 2, h / 2);
    ctx.beginPath();
    ctx.moveTo(x + rr, y);
    ctx.arcTo(x + w, y, x + w, y + h, rr);
    ctx.arcTo(x + w, y + h, x, y + h, rr);
    ctx.arcTo(x, y + h, x, y, rr);
    ctx.arcTo(x, y, x + w, y, rr);
    ctx.closePath();
  }

  function drawPaperPlane(x, y, bank, size, shadow = true) {
    const s = size;
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(bank);

    if (shadow) {
      ctx.shadowColor = 'rgba(63, 48, 27, 0.26)';
      ctx.shadowBlur = 14 * world.s;
      ctx.shadowOffsetY = 7 * world.s;
    }

    const grad = ctx.createLinearGradient(-s, -s, s * 0.7, s * 0.7);
    grad.addColorStop(0, '#fffdf7');
    grad.addColorStop(0.48, '#faf4e7');
    grad.addColorStop(1, '#e8dac1');

    ctx.beginPath();
    ctx.moveTo(0, -s);
    ctx.lineTo(s * 0.94, s * 0.58);
    ctx.lineTo(s * 0.13, s * 0.33);
    ctx.lineTo(0, s * 0.62);
    ctx.lineTo(-s * 0.13, s * 0.33);
    ctx.lineTo(-s * 0.94, s * 0.58);
    ctx.closePath();
    ctx.fillStyle = grad;
    ctx.fill();

    ctx.shadowColor = 'transparent';
    ctx.lineWidth = Math.max(1, 1.45 * world.s);
    ctx.strokeStyle = '#4a4237';
    ctx.lineJoin = 'round';
    ctx.stroke();

    // 右翼的淡阴影
    ctx.beginPath();
    ctx.moveTo(0, -s);
    ctx.lineTo(s * 0.94, s * 0.58);
    ctx.lineTo(s * 0.13, s * 0.33);
    ctx.closePath();
    ctx.fillStyle = 'rgba(106, 84, 48, 0.075)';
    ctx.fill();

    // 折痕
    ctx.strokeStyle = 'rgba(74, 66, 55, 0.38)';
    ctx.lineWidth = Math.max(0.7, 0.9 * world.s);
    ctx.beginPath();
    ctx.moveTo(0, -s);
    ctx.lineTo(s * 0.13, s * 0.33);
    ctx.lineTo(0, s * 0.62);
    ctx.lineTo(-s * 0.13, s * 0.33);
    ctx.closePath();
    ctx.stroke();

    // 机头中心线
    ctx.beginPath();
    ctx.moveTo(0, -s);
    ctx.lineTo(0, s * 0.62);
    ctx.strokeStyle = 'rgba(74, 66, 55, 0.22)';
    ctx.stroke();

    // 一枚小小的红色印记
    ctx.beginPath();
    ctx.arc(s * 0.46, s * 0.35, Math.max(1.2, s * 0.055), 0, TAU);
    ctx.fillStyle = 'rgba(189, 91, 60, 0.88)';
    ctx.fill();

    ctx.restore();
  }

  /* ── 启动 / 暂停 / 结束 ────────────────────────────────────────── */

  function resetGame() {
    enemies = [];
    bullets = [];
    eBullets = [];
    pickups = [];
    particles = [];
    pops = [];

    state.score = 0;
    state.displayScore = 0;
    state.kills = 0;
    state.combo = 0;
    state.comboTimer = 0;
    state.wave = 1;
    state.time = 0;
    state.spawnTimer = 0.45;
    state.shake = 0;
    state.hitFlash = 0;

    player.lives = 3;
    player.inv = 0;
    player.power = 0;
    player.fireCd = 0.24;
    player.bank = 0;
    player.vx = 0;
    player.size = 24 * world.s;
    player.r = 11.5 * world.s;
    player.x = player.tx = world.w / 2;
    player.y = player.ty = world.h * 0.8;
    player.trail.length = 0;

    els.score.textContent = '0';
    els.bestHud.textContent = String(state.best);
    els.bestStart.textContent = String(state.best);
    els.waveLabel.textContent = '第 1 波';
    els.combo.classList.remove('show');
    els.powerChip.hidden = true;
    updateLives();
  }

  function startGame() {
    runId += 1;
    resetGame();
    mode = 'playing';
    paused = false;
    pointerActive = false;
    app.dataset.mode = 'playing';
    els.startLayer.classList.add('hidden');
    els.pauseLayer.classList.add('hidden');
    els.overLayer.classList.add('hidden');
    if (document.activeElement && document.activeElement.blur) {
      document.activeElement.blur();
    }

    audio.init();
    audio.resume();
    audio.select();

    showToast(`起飞 · 第 1 波`);
    els.tip.classList.remove('show');
    void els.tip.offsetWidth;
    els.tip.classList.add('show');
    clearTimeout(tipTimer);
    tipTimer = setTimeout(() => els.tip.classList.remove('show'), 5200);

    lastTs = 0;
    updateHud(true);
  }

  function pauseGame() {
    if (mode !== 'playing' || paused) return;
    paused = true;
    app.dataset.mode = 'paused';
    keys.clear();
    pointerActive = false;
    els.pauseLayer.classList.remove('hidden');
    els.tip.classList.remove('show');
    audio.suspend();
  }

  function resumeGame() {
    if (mode !== 'playing' || !paused) return;
    paused = false;
    app.dataset.mode = 'playing';
    els.pauseLayer.classList.add('hidden');
    audio.resume();
    lastTs = 0;
  }

  function togglePause() {
    if (mode !== 'playing') return;
    if (paused) resumeGame();
    else pauseGame();
  }

  function endGame() {
    if (mode !== 'playing') return;
    mode = 'over';
    paused = false;
    app.dataset.mode = 'over';
    keys.clear();
    pointerActive = false;
    els.tip.classList.remove('show');

    const isRecord = state.score > state.best;
    if (isRecord) {
      state.best = state.score;
      prefs.best = state.best;
      savePrefs();
    }

    els.finalScore.textContent = String(state.score);
    els.finalBest.textContent = String(state.best);
    els.finalKills.textContent = String(state.kills);
    els.finalWave.textContent = String(state.wave);
    els.newRecord.hidden = !isRecord;
    els.bestHud.textContent = String(state.best);
    els.bestStart.textContent = String(state.best);

    state.shake = 16;
    audio.over();

    const myRun = runId;
    setTimeout(() => {
      if (myRun === runId && mode === 'over') els.overLayer.classList.remove('hidden');
    }, 620);
  }

  function toMenu() {
    runId += 1;
    mode = 'menu';
    paused = false;
    app.dataset.mode = 'menu';
    els.pauseLayer.classList.add('hidden');
    els.overLayer.classList.add('hidden');
    els.startLayer.classList.remove('hidden');
    els.tip.classList.remove('show');
    els.toast.classList.remove('show');
    resetGame();
  }

  /* ── HUD ───────────────────────────────────────────────────────── */

  function comboMultiplier() {
    return 1 + Math.min(4, Math.floor(Math.max(0, state.combo) / 5));
  }

  function updateLives() {
    const total = Math.max(3, Math.min(5, player.lives));
    let html = '';
    for (let i = 0; i < total; i += 1) {
      html += `<svg viewBox="0 0 24 24" aria-hidden="true" class="${i < player.lives ? '' : 'is-lost'}"><path d="M12 20.1C10.4 19 5.1 15.2 5.1 10.7c0-2.4 1.8-4.4 4.1-4.4 1.2 0 2.2.5 2.8 1.4.6-.9 1.6-1.4 2.8-1.4 2.3 0 4.1 2 4.1 4.4 0 4.5-5.3 8.3-6.9 9.4Z"/></svg>`;
    }
    els.lives.innerHTML = html;
    els.lives.setAttribute('aria-label', `剩余 ${Math.max(0, player.lives)} 点生命`);
  }

  function updateHud(force = false) {
    const display = Math.round(state.displayScore);
    if (els.score.textContent !== String(display)) els.score.textContent = String(display);

    if (force) {
      els.bestHud.textContent = String(state.best);
      els.bestStart.textContent = String(state.best);
      els.waveLabel.textContent = `第 ${state.wave} 波`;
    }

    const showCombo = state.combo >= 2;
    els.combo.classList.toggle('show', showCombo);
    if (showCombo) {
      els.comboCount.textContent = String(state.combo);
      els.comboMult.textContent = `×${comboMultiplier()}`;
    }

    if (player.power > 0) {
      els.powerChip.hidden = false;
      els.powerSec.textContent = String(Math.max(1, Math.ceil(player.power)));
    } else {
      els.powerChip.hidden = true;
    }
  }

  function showToast(text) {
    els.toast.textContent = text;
    els.toast.classList.remove('show');
    void els.toast.offsetWidth;
    els.toast.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => els.toast.classList.remove('show'), 1350);
  }

  function setMuted(muted, userAction = false) {
    audio.muted = muted;
    prefs.muted = muted;
    savePrefs();
    els.soundBtn.classList.toggle('is-muted', muted);
    els.soundBtn.setAttribute('aria-pressed', String(muted));
    els.soundBtn.setAttribute('aria-label', muted ? '开启声音' : '静音');
    if (!userAction) return;
    if (!muted) {
      audio.init();
      audio.resume();
      audio.select();
    } else {
      audio.suspend();
    }
  }

  function toggleSound() {
    setMuted(!audio.muted, true);
  }

  /* ── 输入 ─────────────────────────────────────────────────────── */

  let pointerActive = false;

  function pointerTarget(e) {
    const rect = canvas.getBoundingClientRect();
    const px = e.clientX - rect.left;
    let py = e.clientY - rect.top;
    if (e.pointerType !== 'mouse') py -= Math.min(54, world.h * 0.075);
    player.tx = clamp(px, 15 * world.s, world.w - 15 * world.s);
    player.ty = clamp(py, world.h * 0.46, world.h - 28 * world.s);
  }

  canvas.addEventListener('pointerdown', (e) => {
    if (mode !== 'playing' || paused) return;
    pointerActive = true;
    pointerTarget(e);
    if (canvas.setPointerCapture) {
      try {
        canvas.setPointerCapture(e.pointerId);
      } catch (_) {
        /* 忽略 */
      }
    }
    e.preventDefault();
  }, { passive: false });

  canvas.addEventListener('pointermove', (e) => {
    if (mode !== 'playing' || paused) return;
    if (e.pointerType === 'mouse' || pointerActive) pointerTarget(e);
  }, { passive: true });

  const endPointer = () => {
    pointerActive = false;
  };
  canvas.addEventListener('pointerup', endPointer);
  canvas.addEventListener('pointercancel', endPointer);
  canvas.addEventListener('pointerleave', (e) => {
    if (e.pointerType === 'mouse') pointerActive = false;
  });
  canvas.addEventListener('contextmenu', (e) => e.preventDefault());

  function onKeyDown(e) {
    const key = e.key.toLowerCase();
    const arrow = key === 'arrowleft' || key === 'arrowright' || key === 'arrowup' || key === 'arrowdown';
    if (arrow) keys.add(key);
    if (arrow && mode === 'playing') e.preventDefault();

    if (key === ' ' || key === 'enter') {
      const tag = e.target && e.target.tagName;
      if (tag === 'BUTTON' || tag === 'A' || tag === 'INPUT') return;
      if (mode === 'menu' || mode === 'over') {
        e.preventDefault();
        startGame();
      }
      return;
    }

    if (key === 'p') {
      if (mode === 'playing') {
        e.preventDefault();
        togglePause();
      }
    } else if (key === 'm') {
      e.preventDefault();
      toggleSound();
    } else if (key === 'r') {
      if (mode === 'over' || (mode === 'playing' && paused)) {
        e.preventDefault();
        startGame();
      }
    }
  }

  window.addEventListener('keydown', onKeyDown);
  window.addEventListener('keyup', (e) => keys.delete(e.key.toLowerCase()));
  window.addEventListener('blur', () => keys.clear());

  document.addEventListener('visibilitychange', () => {
    if (document.hidden) {
      if (mode === 'playing' && !paused) pauseGame();
      audio.suspend();
    } else if (!audio.muted) {
      audio.resume();
    }
  });

  /* ── 战斗逻辑 ─────────────────────────────────────────────────── */

  function updateGame(dt) {
    state.time += dt;
    state.comboTimer -= dt;
    if (state.comboTimer <= 0) {
      state.combo = 0;
      state.comboTimer = 0;
    }

    player.inv = Math.max(0, player.inv - dt);
    player.power = Math.max(0, player.power - dt);

    checkWave();
    updatePlayer(dt);
    updateSpawner(dt);
    updateEnemies(dt);

    if (mode === 'playing') {
      updateBullets(dt);
      if (mode === 'playing') updateEnemyBullets(dt);
      if (mode === 'playing') updatePickups(dt);
    }

    updateEffects(dt);

    state.displayScore += (state.score - state.displayScore) * Math.min(1, dt * 13);
    if (Math.abs(state.score - state.displayScore) < 0.5) state.displayScore = state.score;
    updateHud();
  }

  function checkWave() {
    const next = 1 + Math.floor(state.time / 18);
    if (next > state.wave) {
      state.wave = next;
      els.waveLabel.textContent = `第 ${state.wave} 波`;
      showToast(`第 ${state.wave} 波`);
      audio.wave();
    }
  }

  function updatePlayer(dt) {
    let kx = 0;
    let ky = 0;
    if (keys.has('arrowleft') || keys.has('a')) kx -= 1;
    if (keys.has('arrowright') || keys.has('d')) kx += 1;
    if (keys.has('arrowup') || keys.has('w')) ky -= 1;
    if (keys.has('arrowdown') || keys.has('s')) ky += 1;

    if (kx || ky) {
      const speed = 430 * world.v;
      player.tx = clamp(player.tx + kx * speed * dt, 15 * world.s, world.w - 15 * world.s);
      player.ty = clamp(player.ty + ky * speed * 0.86 * dt, world.h * 0.46, world.h - 28 * world.s);
    }

    const prevX = player.x;
    const follow = 1 - Math.exp(-dt * 16);
    player.x += (player.tx - player.x) * follow;
    player.y += (player.ty - player.y) * follow;
    player.vx = dt > 0 ? (player.x - prevX) / dt : 0;
    player.bank = clamp(player.vx * 0.00075, -0.26, 0.26);

    player.trail.push({ x: player.x, y: player.y + player.size * 0.55 });
    if (player.trail.length > 16) player.trail.shift();

    player.fireCd -= dt;
    if (player.fireCd <= 0) {
      fire();
      player.fireCd = player.power > 0 ? 0.105 : 0.15;
    }
  }

  function fire() {
    const noseY = player.y - player.size * 0.92;
    const angles = player.power > 0 ? [-0.17, 0, 0.17] : [0];
    for (const a of angles) {
      bullets.push({
        x: player.x + Math.sin(a) * player.size * 0.3,
        y: noseY,
        vx: Math.sin(a) * 80 * world.s,
        vy: -790 * world.v,
        r: 3.4 * world.s,
        life: 1.5,
        dead: false,
      });
    }
    if (Math.random() < 0.55) audio.shoot();
    burst(player.x, noseY + 4, {
      count: 2,
      colors: ['#fdfaf2', '#e7d8bd'],
      speed: 40,
      size: 2.2 * world.s,
      gravity: 30,
      life: 0.3,
    });
  }

  function updateSpawner(dt) {
    state.spawnTimer -= dt;
    if (state.spawnTimer > 0) return;

    const t = state.time;
    const roll = Math.random();
    let type;
    if (t < 15) {
      type = roll < 0.8 ? 'ball' : 'dart';
    } else if (t < 38) {
      type = roll < 0.52 ? 'ball' : roll < 0.8 ? 'dart' : roll < 0.93 ? 'envelope' : 'blot';
    } else {
      type = roll < 0.38 ? 'ball' : roll < 0.68 ? 'dart' : roll < 0.85 ? 'envelope' : 'blot';
    }

    spawnEnemy(type);
    if (t > 42 && Math.random() < 0.2) spawnEnemy(Math.random() < 0.62 ? 'ball' : 'dart');
    if (t > 74 && Math.random() < 0.12) spawnEnemy('dart');

    const diff = Math.min(1, t / 110);
    state.spawnTimer = Math.max(0.3, (0.86 - diff * 0.48) * rand(0.74, 1.24));
  }

  function spawnEnemy(type) {
    const s = world.s;
    const v = world.v;
    const margin = 34 * s;
    const baseX = rand(margin, world.w - margin);
    const speedK = 1 + Math.min(0.55, state.time * 0.0046);
    const common = {
      type,
      x: baseX,
      baseX,
      y: -40 * s,
      t: 0,
      rot: rand(0, TAU),
      vr: rand(-0.45, 0.45),
      phase: rand(0, TAU),
      flash: 0,
      dead: false,
      seed: rand(0, 99),
    };

    if (type === 'ball') {
      enemies.push({
        ...common,
        r: rand(14, 19) * s,
        hp: 1,
        score: 10,
        speed: rand(64, 90) * v * speedK,
        amp: rand(8, 38) * s,
      });
    } else if (type === 'dart') {
      const dir = Math.random() < 0.5 ? -1 : 1;
      const dartX = dir < 0
        ? rand(40 * s, world.w * 0.58)
        : rand(world.w * 0.42, world.w - 40 * s);
      enemies.push({
        ...common,
        baseX: dartX,
        x: dartX,
        dir,
        r: 11.5 * s,
        hp: 1,
        score: 15,
        speed: rand(96, 126) * v * speedK,
        amp: 0,
      });
    } else if (type === 'envelope') {
      enemies.push({
        ...common,
        r: 23 * s,
        hp: 3,
        score: 36,
        speed: rand(38, 52) * v * speedK,
        amp: 0,
      });
    } else {
      enemies.push({
        ...common,
        r: 19 * s,
        hp: 2,
        score: 24,
        speed: rand(34, 46) * v * speedK,
        amp: 0,
        fireCd: rand(1.4, 2.6),
      });
    }
  }

  function updateEnemies(dt) {
    const s = world.s;
    for (const e of enemies) {
      if (e.dead) continue;
      e.t += dt;
      e.flash = Math.max(0, e.flash - dt);
      e.rot += e.vr * dt;
      e.y += e.speed * dt;

      if (e.type === 'ball') {
        e.x = e.baseX + Math.sin(e.t * 1.3 + e.phase) * e.amp;
      } else if (e.type === 'dart') {
        e.x += e.dir * e.speed * 0.46 * dt;
        if (e.x < 24 * s) {
          e.x = 24 * s;
          e.dir = 1;
        } else if (e.x > world.w - 24 * s) {
          e.x = world.w - 24 * s;
          e.dir = -1;
        }
        if (Math.abs(e.x - e.baseX) > world.w * 0.36) e.dir *= -1;
      } else if (e.type === 'envelope') {
        e.x = e.baseX + Math.sin(e.t * 0.7 + e.phase) * 14 * s;
      } else if (e.type === 'blot') {
        e.x = e.baseX + Math.sin(e.t * 0.9 + e.phase) * 18 * s;
        if (e.y > 36 && e.y < world.h * 0.58) {
          e.fireCd -= dt;
          if (e.fireCd <= 0) {
            fireInk(e);
            e.fireCd = rand(1.9, 3.0);
          }
        }
      }

      if (e.y > world.h + 70 * s) e.dead = true;

      if (!e.dead && mode === 'playing' && player.inv <= 0) {
        const dx = player.x - e.x;
        const dy = player.y - e.y;
        const rr = player.r + e.r * 0.72;
        if (dx * dx + dy * dy < rr * rr) {
          e.dead = true;
          burst(e.x, e.y, {
            count: 12,
            colors: e.type === 'blot' || e.type === 'dart' ? ['#3f3931', '#6c6355'] : ['#fdfaf2', '#e9dcc3', '#bd5b3c'],
            speed: 150,
            size: 3 * s,
            gravity: 140,
            shape: e.type === 'blot' || e.type === 'dart' ? 'ink' : 'paper',
          });
          hurt();
        }
      }
    }
    enemies = enemies.filter((e) => !e.dead);
  }

  function fireInk(e) {
    const dx = player.x - e.x;
    const dy = player.y - e.y;
    const d = Math.hypot(dx, dy) || 1;
    const speed = 158 * world.v;
    eBullets.push({
      x: e.x,
      y: e.y + e.r * 0.4,
      vx: (dx / d) * speed,
      vy: (dy / d) * speed,
      r: 5 * world.s,
      t: 0,
      dead: false,
    });
    if (eBullets.length > 60) eBullets.shift();
    audio.ink();
  }

  function updateBullets(dt) {
    for (const b of bullets) {
      if (b.dead) continue;
      b.x += b.vx * dt;
      b.y += b.vy * dt;
      b.life -= dt;
      if (b.life <= 0 || b.y < -30) {
        b.dead = true;
        continue;
      }
      for (const e of enemies) {
        if (e.dead) continue;
        const dx = b.x - e.x;
        const dy = b.y - e.y;
        const rr = e.r * 0.9 + b.r;
        if (dx * dx + dy * dy < rr * rr) {
          b.dead = true;
          e.hp -= 1;
          e.flash = 0.12;
          burst(b.x, b.y, {
            count: 3,
            colors: ['#fdfaf2', '#e3d3b6'],
            speed: 70,
            size: 2.2 * world.s,
            gravity: 120,
            life: 0.35,
          });
          if (e.hp <= 0) killEnemy(e);
          break;
        }
      }
    }
    bullets = bullets.filter((b) => !b.dead);
  }

  function killEnemy(e) {
    e.dead = true;
    state.combo += 1;
    state.comboTimer = 1.8;
    const gain = Math.round(e.score * comboMultiplier());
    state.score += gain;
    state.kills += 1;
    state.shake = Math.max(state.shake, e.type === 'envelope' ? 7 : e.type === 'blot' ? 5 : 3);

    pops.push({
      x: e.x,
      y: e.y - 4,
      text: `+${gain}`,
      life: 0.85,
      max: 0.85,
      color: e.type === 'envelope' ? '#a94f36' : '#7a5f45',
      size: 13 * world.s,
    });

    const isDark = e.type === 'blot' || e.type === 'dart';
    burst(e.x, e.y, {
      count: e.type === 'envelope' ? 20 : e.type === 'blot' ? 15 : 10,
      colors: isDark
        ? ['#3a342d', '#5e564a', '#8a7f6d']
        : ['#fdfaf2', '#efe3cc', '#bd5b3c', '#c7b28d'],
      speed: e.type === 'envelope' ? 190 : 150,
      size: e.type === 'envelope' ? 4.5 * world.s : 3.2 * world.s,
      gravity: 170,
      shape: isDark ? 'ink' : 'paper',
      life: 0.9,
    });

    let chance = 0.06;
    if (e.type === 'envelope') chance = 0.42;
    else if (e.type === 'blot') chance = 0.26;
    if (Math.random() < chance) {
      const type = player.lives < 5 && Math.random() < 0.42 ? 'heart' : 'star';
      pickups.push({
        x: e.x,
        y: e.y,
        r: 12 * world.s,
        type,
        t: 0,
        vy: 66 * world.v,
        rot: rand(0, TAU),
      });
    }

    audio.pop();
  }

  function updateEnemyBullets(dt) {
    for (const b of eBullets) {
      if (b.dead) continue;
      b.x += b.vx * dt;
      b.y += b.vy * dt;
      b.t += dt;
      if (b.x < -30 || b.x > world.w + 30 || b.y < -30 || b.y > world.h + 30) {
        b.dead = true;
        continue;
      }
      if (mode === 'playing' && player.inv <= 0) {
        const dx = player.x - b.x;
        const dy = player.y - b.y;
        const rr = player.r * 0.88 + b.r;
        if (dx * dx + dy * dy < rr * rr) {
          b.dead = true;
          burst(b.x, b.y, {
            count: 9,
            colors: ['#3a342d', '#62594b'],
            speed: 130,
            size: 3 * world.s,
            gravity: 90,
            shape: 'ink',
            life: 0.6,
          });
          hurt();
        }
      }
    }
    eBullets = eBullets.filter((b) => !b.dead);
  }

  function updatePickups(dt) {
    for (const p of pickups) {
      p.t += dt;
      p.y += p.vy * dt;
      p.x += Math.sin(p.t * 1.8) * 16 * dt;
      p.rot += dt * 1.4;
      if (p.y > world.h + 40) {
        p.dead = true;
        continue;
      }
      const dx = player.x - p.x;
      const dy = player.y - p.y;
      const rr = player.r + p.r + 4;
      if (dx * dx + dy * dy < rr * rr) {
        p.dead = true;
        if (p.type === 'star') {
          const extended = player.power > 0;
          player.power = Math.min(14, player.power + 9);
          showToast(extended ? '三连射延长' : '三连射 · 9 秒');
        } else {
          player.lives = Math.min(5, player.lives + 1);
          updateLives();
          showToast('生命 +1');
        }
        audio.power();
        burst(p.x, p.y, {
          count: 14,
          colors: ['#e8c47a', '#fdfaf2', '#bd5b3c'],
          speed: 130,
          size: 2.8 * world.s,
          gravity: -20,
          shape: 'spark',
          life: 0.8,
        });
      }
    }
    pickups = pickups.filter((p) => !p.dead);
  }

  function hurt() {
    if (player.inv > 0 || mode !== 'playing') return;
    player.lives -= 1;
    player.inv = 2.15;
    state.combo = 0;
    state.comboTimer = 0;
    state.shake = 18;
    state.hitFlash = 0.55;
    updateLives();
    audio.hurt();

    burst(player.x, player.y, {
      count: 22,
      colors: ['#3a342d', '#62594b', '#bd5b3c', '#efe3cc'],
      speed: 210,
      size: 3.6 * world.s,
      gravity: 150,
      shape: 'ink',
      life: 0.9,
    });

    if (player.lives <= 0) {
      endGame();
    } else {
      showToast('小心墨点');
    }
  }

  function updateEffects(dt) {
    state.shake = Math.max(0, state.shake - dt * 40);
    state.hitFlash = Math.max(0, state.hitFlash - dt * 2.6);

    for (const p of particles) {
      p.life -= dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.vy += p.gravity * dt;
      p.vx *= 1 - Math.min(0.9, dt * 1.2);
      p.rot += p.vr * dt;
    }
    particles = particles.filter((p) => p.life > 0);

    for (const p of pops) {
      p.life -= dt;
      p.y -= 26 * dt;
    }
    pops = pops.filter((p) => p.life > 0);
  }

  function burst(x, y, opts = {}) {
    const count = opts.count || 8;
    const colors = opts.colors || ['#fdfaf2', '#e8dcc4', '#bd5b3c'];
    const speed = opts.speed || 140;
    const size = opts.size || 3 * world.s;
    const gravity = opts.gravity == null ? 160 : opts.gravity;
    const shape = opts.shape || 'paper';
    const life = opts.life || 0.75;

    for (let i = 0; i < count; i += 1) {
      const angle = rand(0, TAU);
      const sp = rand(speed * 0.25, speed);
      particles.push({
        x,
        y,
        vx: Math.cos(angle) * sp,
        vy: Math.sin(angle) * sp - rand(0, 30),
        gravity,
        rot: rand(0, TAU),
        vr: rand(-8, 8),
        size: size * rand(0.55, 1.25),
        color: colors[(Math.random() * colors.length) | 0],
        shape,
        life: life * rand(0.65, 1.2),
        max: life,
      });
    }
    if (particles.length > 280) particles.splice(0, particles.length - 280);
  }

  /* ── 渲染 ─────────────────────────────────────────────────────── */

  function drawAmbient() {
    const w = world.w;
    const h = world.h;

    // 奶油色纸太阳
    const sx = w * 0.8;
    const sy = h * 0.16;
    const sr = Math.min(w, h) * 0.19;
    const sun = ctx.createRadialGradient(sx, sy, sr * 0.08, sx, sy, sr);
    sun.addColorStop(0, 'rgba(255, 253, 246, 0.62)');
    sun.addColorStop(0.68, 'rgba(255, 252, 243, 0.26)');
    sun.addColorStop(1, 'rgba(255, 252, 243, 0)');
    ctx.fillStyle = sun;
    ctx.beginPath();
    ctx.arc(sx, sy, sr, 0, TAU);
    ctx.fill();
    ctx.strokeStyle = 'rgba(59, 52, 43, 0.045)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.arc(sx, sy, sr * 0.72, 0, TAU);
    ctx.stroke();

    // 淡淡的飞行航线
    ctx.save();
    ctx.setLineDash([2, 8]);
    ctx.lineWidth = 0.9;
    ctx.lineDashOffset = -ambient.t * 4;
    for (const r of ambient.routes) {
      ctx.strokeStyle = `rgba(59, 52, 43, ${0.07 + r.drift * 0.025})`;
      ctx.beginPath();
      ctx.moveTo(-30, r.y * h);
      ctx.bezierCurveTo(
        (r.c1x + Math.sin(ambient.t * 0.06) * 0.02) * w,
        r.c1y * h,
        (r.c2x + Math.cos(ambient.t * 0.05) * 0.02) * w,
        r.c2y * h,
        w + 30,
        (r.y + 0.04) * h,
      );
      ctx.stroke();
    }
    ctx.restore();

    // 飘落的纸屑
    for (const s of ambient.scraps) {
      ctx.save();
      ctx.translate(s.x, s.y);
      ctx.rotate(s.rot);
      ctx.globalAlpha = s.alpha;
      ctx.fillStyle = '#fffdf7';
      ctx.strokeStyle = 'rgba(59, 52, 43, 0.24)';
      ctx.lineWidth = 0.7;
      ctx.beginPath();
      ctx.rect(-s.size * 0.5, -s.size * 0.28, s.size, s.size * 0.56);
      ctx.fill();
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(-s.size * 0.5, 0);
      ctx.lineTo(s.size * 0.5, 0);
      ctx.strokeStyle = 'rgba(59, 52, 43, 0.13)';
      ctx.stroke();
      ctx.restore();
    }

    // 纸尘
    for (const d of ambient.dust) {
      ctx.globalAlpha = d.alpha;
      ctx.fillStyle = '#4a4237';
      ctx.beginPath();
      ctx.arc(d.x, d.y, d.r, 0, TAU);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
  }

  function drawIdlePlane() {
    const h = world.h;
    if (h < 540) return;
    const amp = Math.min(world.w * 0.08, 54);
    const x = world.w * 0.5 + Math.sin(idleT * 0.45) * amp;
    const y = h * 0.83 + Math.sin(idleT * 1.05) * 4;

    ctx.save();
    ctx.strokeStyle = 'rgba(59, 52, 43, 0.13)';
    ctx.lineWidth = 1;
    ctx.setLineDash([2, 7]);
    ctx.beginPath();
    ctx.moveTo(x - 56, y + 42);
    ctx.bezierCurveTo(x - 118, y + 5, x - 36, y - 38, x - 8, y + 2);
    ctx.stroke();
    ctx.restore();

    // 小小的金色星屑
    for (let i = 0; i < 3; i += 1) {
      const t = idleT * 0.7 + i * 2.1;
      const px = x - 26 + Math.cos(t) * 20;
      const py = y + 12 + Math.sin(t * 1.3) * 10;
      ctx.globalAlpha = 0.32 + Math.sin(t) * 0.18;
      ctx.fillStyle = '#bd9148';
      ctx.beginPath();
      ctx.arc(px, py, 1.4 * world.s, 0, TAU);
      ctx.fill();
    }
    ctx.globalAlpha = 1;

    drawPaperPlane(x, y, Math.sin(idleT * 0.45 + 1.2) * 0.12, 25 * world.s);
  }

  function drawPlayer() {
    if (player.trail.length > 1) {
      ctx.save();
      ctx.strokeStyle = 'rgba(59, 52, 43, 0.16)';
      ctx.lineWidth = Math.max(0.8, 1.1 * world.s);
      ctx.setLineDash([1, 7]);
      ctx.beginPath();
      ctx.moveTo(player.trail[0].x, player.trail[0].y);
      for (let i = 1; i < player.trail.length; i += 1) {
        ctx.lineTo(player.trail[i].x, player.trail[i].y);
      }
      ctx.stroke();
      ctx.restore();
    }

    drawPaperPlane(player.x, player.y, player.bank, player.size);

    if (player.power > 0) {
      ctx.save();
      ctx.translate(player.x, player.y);
      ctx.rotate(-idleT * 0.6);
      ctx.strokeStyle = 'rgba(189, 145, 72, 0.4)';
      ctx.lineWidth = 1;
      ctx.setLineDash([2, 5]);
      ctx.beginPath();
      ctx.arc(0, 0, player.size * 1.35, 0, TAU);
      ctx.stroke();
      ctx.restore();
    }

    if (player.inv > 0) {
      const alpha = 0.3 + 0.24 * Math.sin(performance.now() * 0.014);
      ctx.save();
      ctx.translate(player.x, player.y);
      ctx.rotate(player.bank);
      ctx.strokeStyle = `rgba(189, 91, 60, ${alpha})`;
      ctx.lineWidth = 1.2;
      ctx.setLineDash([3, 6]);
      ctx.lineDashOffset = -performance.now() * 0.02;
      ctx.beginPath();
      ctx.arc(0, 0, player.size * 1.5, 0, TAU);
      ctx.stroke();
      ctx.restore();
    }
  }

  function drawEnemies() {
    for (const e of enemies) {
      if (e.dead) continue;
      ctx.save();
      ctx.translate(e.x, e.y);
      if (e.type === 'ball') {
        drawPaperBall(e);
      } else if (e.type === 'dart') {
        drawDart(e);
      } else if (e.type === 'envelope') {
        drawEnvelope(e);
      } else {
        drawBlot(e);
      }
      if (e.flash > 0) {
        ctx.globalAlpha = Math.min(0.55, e.flash * 5);
        ctx.strokeStyle = '#bd5b3c';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(0, 0, e.r + 2, 0, TAU);
        ctx.stroke();
      }
      ctx.restore();
    }
    ctx.globalAlpha = 1;
  }

  function drawPaperBall(e) {
    ctx.rotate(e.rot + e.t * 0.5);
    const r = e.r;
    const pts = [];
    for (let i = 0; i < 9; i += 1) {
      const a = (i / 9) * TAU;
      const rr = r * (0.8 + hash(e.seed + i * 3.7) * 0.22);
      pts.push({ x: Math.cos(a) * rr, y: Math.sin(a) * rr });
    }

    ctx.shadowColor = 'rgba(63, 48, 27, 0.2)';
    ctx.shadowBlur = 10;
    ctx.shadowOffsetY = 4;
    ctx.beginPath();
    ctx.moveTo(pts[0].x, pts[0].y);
    for (let i = 1; i < pts.length; i += 1) ctx.lineTo(pts[i].x, pts[i].y);
    ctx.closePath();
    const paper = ctx.createRadialGradient(-r * 0.32, -r * 0.36, r * 0.08, 0, 0, r * 1.12);
    paper.addColorStop(0, '#fffdf8');
    paper.addColorStop(0.62, '#f4ead7');
    paper.addColorStop(1, '#e4d4b8');
    ctx.fillStyle = paper;
    ctx.fill();
    ctx.shadowColor = 'transparent';
    ctx.strokeStyle = '#403a32';
    ctx.lineWidth = Math.max(1, 1.55 * world.s);
    ctx.lineJoin = 'round';
    ctx.stroke();

    ctx.strokeStyle = 'rgba(64, 58, 50, 0.2)';
    ctx.lineWidth = 0.9;
    for (let i = 0; i < pts.length; i += 2) {
      ctx.beginPath();
      ctx.moveTo(0, 0);
      ctx.lineTo(pts[i].x * 0.9, pts[i].y * 0.9);
      ctx.stroke();
    }
    ctx.beginPath();
    ctx.moveTo(-r * 0.36, -r * 0.14);
    ctx.lineTo(-r * 0.04, r * 0.22);
    ctx.lineTo(r * 0.26, -r * 0.18);
    ctx.strokeStyle = 'rgba(64, 58, 50, 0.52)';
    ctx.lineWidth = 1.05;
    ctx.lineCap = 'round';
    ctx.stroke();
  }

  function drawDart(e) {
    ctx.rotate(e.rot + Math.PI);
    const r = e.r;
    ctx.shadowColor = 'rgba(63, 48, 27, 0.2)';
    ctx.shadowBlur = 8;
    ctx.shadowOffsetY = 4;
    ctx.beginPath();
    ctx.moveTo(0, r * 1.08);
    ctx.lineTo(-r * 0.86, -r * 0.62);
    ctx.lineTo(0, -r * 0.18);
    ctx.lineTo(r * 0.86, -r * 0.62);
    ctx.closePath();
    ctx.fillStyle = '#403a32';
    ctx.fill();
    ctx.shadowColor = 'transparent';
    ctx.strokeStyle = '#2f2b25';
    ctx.lineWidth = Math.max(0.8, 1.2 * world.s);
    ctx.lineJoin = 'round';
    ctx.stroke();

    ctx.beginPath();
    ctx.moveTo(0, r * 1.08);
    ctx.lineTo(0, -r * 0.18);
    ctx.strokeStyle = 'rgba(253, 250, 242, 0.42)';
    ctx.lineWidth = 0.9;
    ctx.stroke();

    ctx.beginPath();
    ctx.moveTo(-r * 0.34, -r * 0.35);
    ctx.lineTo(0, -r * 0.18);
    ctx.lineTo(r * 0.34, -r * 0.35);
    ctx.strokeStyle = 'rgba(253, 250, 242, 0.28)';
    ctx.stroke();
  }

  function drawEnvelope(e) {
    const r = e.r;
    const w = r * 1.78;
    const h = r * 1.26;
    ctx.rotate(Math.sin(e.t * 0.9 + e.phase) * 0.12 + e.vr * 0.3);
    ctx.shadowColor = 'rgba(63, 48, 27, 0.18)';
    ctx.shadowBlur = 10;
    ctx.shadowOffsetY = 5;

    roundRectPath(-w / 2, -h / 2, w, h, 3.5 * world.s);
    ctx.fillStyle = '#fdf9ef';
    ctx.fill();
    ctx.shadowColor = 'transparent';
    ctx.strokeStyle = '#4c4438';
    ctx.lineWidth = Math.max(0.9, 1.25 * world.s);
    ctx.stroke();

    // 信封折口
    ctx.beginPath();
    ctx.moveTo(-w / 2 + 1, -h / 2 + 1);
    ctx.lineTo(0, h * 0.08);
    ctx.lineTo(w / 2 - 1, -h / 2 + 1);
    ctx.strokeStyle = 'rgba(76, 68, 56, 0.38)';
    ctx.lineWidth = 1;
    ctx.lineJoin = 'round';
    ctx.stroke();

    // 邮票
    const stamp = Math.max(5, r * 0.3);
    ctx.fillStyle = 'rgba(189, 91, 60, 0.82)';
    ctx.fillRect(w / 2 - stamp - r * 0.16, -h / 2 + r * 0.16, stamp, stamp * 1.12);
    ctx.strokeStyle = 'rgba(255, 250, 240, 0.55)';
    ctx.lineWidth = 0.7;
    ctx.beginPath();
    ctx.moveTo(w / 2 - stamp - r * 0.16 + stamp * 0.24, -h / 2 + r * 0.16 + stamp * 0.3);
    ctx.lineTo(w / 2 - r * 0.16 - stamp * 0.24, -h / 2 + r * 0.16 + stamp * 0.3);
    ctx.stroke();

    // 地址线
    ctx.strokeStyle = 'rgba(76, 68, 56, 0.26)';
    ctx.lineWidth = 0.9;
    ctx.beginPath();
    ctx.moveTo(-w * 0.32, h * 0.18);
    ctx.lineTo(w * 0.16, h * 0.18);
    ctx.moveTo(-w * 0.32, h * 0.29);
    ctx.lineTo(w * 0.02, h * 0.29);
    ctx.stroke();
  }

  function drawBlot(e) {
    ctx.rotate(e.rot + e.t * 0.22);
    const r = e.r;
    const pts = [];
    for (let i = 0; i < 12; i += 1) {
      const a = (i / 12) * TAU;
      const rr = r * (0.72 + hash(e.seed + i * 5.3) * 0.36);
      pts.push({ x: Math.cos(a) * rr, y: Math.sin(a) * rr });
    }

    ctx.shadowColor = 'rgba(30, 26, 21, 0.28)';
    ctx.shadowBlur = 12;
    ctx.shadowOffsetY = 5;
    ctx.beginPath();
    ctx.moveTo(pts[0].x, pts[0].y);
    for (let i = 1; i < pts.length; i += 1) {
      const p = pts[i];
      const prev = pts[i - 1];
      ctx.quadraticCurveTo(prev.x, prev.y, (prev.x + p.x) / 2, (prev.y + p.y) / 2);
    }
    ctx.closePath();
    ctx.fillStyle = '#38332c';
    ctx.fill();
    ctx.shadowColor = 'transparent';
    ctx.strokeStyle = '#2c2823';
    ctx.lineWidth = Math.max(0.8, 1.2 * world.s);
    ctx.stroke();

    // 墨面高光
    ctx.beginPath();
    ctx.arc(-r * 0.22, -r * 0.28, r * 0.3, 0.4, 2.2);
    ctx.strokeStyle = 'rgba(255, 252, 242, 0.16)';
    ctx.lineWidth = 1.4;
    ctx.stroke();

    // 飞溅的小墨滴
    for (let i = 0; i < 3; i += 1) {
      const a = e.phase + i * 2.4;
      const d = r * (1.1 + hash(e.seed + i) * 0.28);
      ctx.beginPath();
      ctx.arc(Math.cos(a) * d, Math.sin(a) * d, r * 0.09 + 0.6, 0, TAU);
      ctx.fillStyle = 'rgba(56, 51, 44, 0.72)';
      ctx.fill();
    }
  }

  function drawBullets() {
    for (const b of bullets) {
      const angle = Math.atan2(b.vy, b.vx) + Math.PI / 2;
      ctx.save();
      ctx.translate(b.x, b.y);
      ctx.rotate(angle);
      const s = world.s;

      ctx.strokeStyle = 'rgba(189, 91, 60, 0.25)';
      ctx.lineWidth = 1.2 * s;
      ctx.beginPath();
      ctx.moveTo(0, 5 * s);
      ctx.lineTo(0, 16 * s);
      ctx.stroke();

      ctx.beginPath();
      ctx.moveTo(0, -9.5 * s);
      ctx.lineTo(2.7 * s, 4.2 * s);
      ctx.lineTo(0, 1.4 * s);
      ctx.lineTo(-2.7 * s, 4.2 * s);
      ctx.closePath();
      ctx.fillStyle = '#bd5b3c';
      ctx.fill();
      ctx.strokeStyle = 'rgba(72, 44, 34, 0.52)';
      ctx.lineWidth = 0.7 * s;
      ctx.stroke();
      ctx.restore();
    }
  }

  function drawEnemyBullets() {
    for (const b of eBullets) {
      ctx.save();
      ctx.translate(b.x, b.y);

      const len = Math.hypot(b.vx, b.vy) || 1;
      ctx.strokeStyle = 'rgba(56, 51, 44, 0.16)';
      ctx.lineWidth = b.r * 1.1;
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(0, 0);
      ctx.lineTo((-b.vx / len) * b.r * 3.4, (-b.vy / len) * b.r * 3.4);
      ctx.stroke();

      ctx.beginPath();
      ctx.arc(0, 0, b.r, 0, TAU);
      ctx.fillStyle = '#38332c';
      ctx.fill();
      ctx.strokeStyle = 'rgba(56, 51, 44, 0.25)';
      ctx.lineWidth = 1.2;
      ctx.beginPath();
      ctx.arc(0, 0, b.r + 2.2, 0, TAU);
      ctx.stroke();

      ctx.beginPath();
      ctx.arc(-b.r * 0.28, -b.r * 0.3, b.r * 0.24, 0, TAU);
      ctx.fillStyle = 'rgba(255, 252, 242, 0.25)';
      ctx.fill();
      ctx.restore();
    }
  }

  function drawPickups() {
    for (const p of pickups) {
      ctx.save();
      ctx.translate(p.x, p.y);

      const pulse = 0.5 + Math.sin(p.t * 4) * 0.12;
      ctx.strokeStyle = p.type === 'star' ? `rgba(189, 145, 72, ${0.3 + pulse * 0.2})` : `rgba(189, 91, 60, ${0.24 + pulse * 0.18})`;
      ctx.lineWidth = 1;
      ctx.setLineDash([2, 5]);
      ctx.beginPath();
      ctx.arc(0, 0, p.r * 1.75, 0, TAU);
      ctx.stroke();

      ctx.rotate(p.rot);
      if (p.type === 'star') {
        drawStar(p.r);
      } else {
        drawHeart(p.r);
      }
      ctx.restore();
    }
  }

  function drawStar(r) {
    ctx.shadowColor = 'rgba(126, 90, 34, 0.28)';
    ctx.shadowBlur = 10;
    ctx.shadowOffsetY = 3;
    ctx.beginPath();
    for (let i = 0; i < 10; i += 1) {
      const a = -Math.PI / 2 + (i / 10) * TAU;
      const rr = i % 2 === 0 ? r : r * 0.45;
      const x = Math.cos(a) * rr;
      const y = Math.sin(a) * rr;
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.closePath();
    ctx.fillStyle = '#e8c47a';
    ctx.fill();
    ctx.shadowColor = 'transparent';
    ctx.strokeStyle = '#8f6a2e';
    ctx.lineWidth = Math.max(0.8, 1.1 * world.s);
    ctx.lineJoin = 'round';
    ctx.stroke();

    ctx.beginPath();
    ctx.moveTo(0, -r);
    ctx.lineTo(0, 0);
    ctx.lineTo(r * 0.86, r * 0.31);
    ctx.strokeStyle = 'rgba(120, 85, 28, 0.32)';
    ctx.lineWidth = 0.8;
    ctx.stroke();
  }

  function drawHeart(r) {
    ctx.shadowColor = 'rgba(126, 60, 40, 0.24)';
    ctx.shadowBlur = 10;
    ctx.shadowOffsetY = 3;
    ctx.beginPath();
    ctx.moveTo(0, r * 0.62);
    ctx.bezierCurveTo(-r * 1.22, -r * 0.08, -r * 0.68, -r * 0.98, 0, -r * 0.34);
    ctx.bezierCurveTo(r * 0.68, -r * 0.98, r * 1.22, -r * 0.08, 0, r * 0.62);
    ctx.closePath();
    ctx.fillStyle = '#fdf9ef';
    ctx.fill();
    ctx.shadowColor = 'transparent';
    ctx.strokeStyle = '#a94f36';
    ctx.lineWidth = Math.max(0.9, 1.2 * world.s);
    ctx.stroke();

    ctx.beginPath();
    ctx.moveTo(0, r * 0.42);
    ctx.lineTo(0, -r * 0.2);
    ctx.strokeStyle = 'rgba(169, 79, 54, 0.3)';
    ctx.lineWidth = 0.8;
    ctx.stroke();
  }

  function drawParticles() {
    for (const p of particles) {
      const alpha = Math.max(0, Math.min(1, p.life / p.max));
      ctx.globalAlpha = alpha;
      ctx.save();
      ctx.translate(p.x, p.y);
      ctx.rotate(p.rot);
      if (p.shape === 'paper') {
        ctx.fillStyle = p.color;
        ctx.fillRect(-p.size * 0.5, -p.size * 0.3, p.size, p.size * 0.6);
        ctx.strokeStyle = 'rgba(59, 52, 43, 0.16)';
        ctx.lineWidth = 0.5;
        ctx.strokeRect(-p.size * 0.5, -p.size * 0.3, p.size, p.size * 0.6);
      } else if (p.shape === 'ink') {
        ctx.fillStyle = p.color;
        ctx.beginPath();
        ctx.arc(0, 0, p.size * 0.55, 0, TAU);
        ctx.fill();
      } else {
        ctx.fillStyle = p.color;
        ctx.beginPath();
        ctx.arc(0, 0, p.size * 0.4, 0, TAU);
        ctx.fill();
      }
      ctx.restore();
    }
    ctx.globalAlpha = 1;
  }

  function drawPops() {
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    for (const p of pops) {
      const alpha = Math.max(0, Math.min(1, p.life / p.max));
      ctx.globalAlpha = alpha;
      ctx.fillStyle = p.color;
      ctx.font = `650 ${Math.round(p.size)}px ui-rounded, "PingFang SC", system-ui, sans-serif`;
      ctx.fillText(p.text, p.x, p.y);
    }
    ctx.globalAlpha = 1;
  }

  function render() {
    ctx.clearRect(0, 0, world.w, world.h);
    drawAmbient();

    if (mode === 'menu') {
      drawIdlePlane();
      return;
    }

    ctx.save();
    if (state.shake > 0 && !paused) {
      ctx.translate(rand(-state.shake, state.shake), rand(-state.shake, state.shake));
    }
    drawPickups();
    drawEnemies();
    drawEnemyBullets();
    drawBullets();
    drawPlayer();
    drawParticles();
    drawPops();
    ctx.restore();

    if (state.hitFlash > 0) {
      const g = ctx.createRadialGradient(
        world.w / 2,
        world.h / 2,
        Math.min(world.w, world.h) * 0.2,
        world.w / 2,
        world.h / 2,
        Math.max(world.w, world.h) * 0.72,
      );
      g.addColorStop(0, 'rgba(189, 91, 60, 0)');
      g.addColorStop(1, `rgba(189, 91, 60, ${state.hitFlash * 0.34})`);
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, world.w, world.h);
    }
  }

  /* ── 主循环 ───────────────────────────────────────────────────── */

  function frame(ts) {
    const dt = lastTs ? Math.min(0.033, (ts - lastTs) / 1000) : 0.016;
    lastTs = ts;

    updateAmbient(dt);

    if (mode === 'menu') {
      idleT += dt;
    } else if (mode === 'playing' && !paused) {
      updateGame(dt);
    } else if (mode === 'over') {
      updateEffects(dt);
    }

    render();
    requestAnimationFrame(frame);
  }

  /* ── 事件绑定与启动 ───────────────────────────────────────────── */

  els.startBtn.addEventListener('click', startGame);
  els.againBtn.addEventListener('click', startGame);
  els.restartBtn.addEventListener('click', startGame);
  els.resumeBtn.addEventListener('click', () => {
    audio.resume();
    audio.select();
    resumeGame();
  });
  els.pauseBtn.addEventListener('click', () => {
    audio.select();
    togglePause();
  });
  els.soundBtn.addEventListener('click', toggleSound);
  els.homeBtn.addEventListener('click', toMenu);
  els.pauseHomeBtn.addEventListener('click', toMenu);

  setMuted(prefs.muted);

  const ro = new ResizeObserver(() => resize());
  ro.observe(canvas);
  window.addEventListener('resize', resize);
  window.addEventListener('orientationchange', () => setTimeout(resize, 160));

  resize();
  resetGame();
  requestAnimationFrame(frame);
})();
