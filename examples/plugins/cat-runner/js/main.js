/* =========================================================
 * main.js — 循环 / 物理 / 生成器 / 渲染 / 输入
 * ========================================================= */
import { buildSprites, buildWorlds } from './sprites.js';
import { Sfx } from './audio.js';

const W = 960;
const H = 540;
const GROUND = 438;
const CAT_X = 210;
const GRAV = 2400;
const HOLD_GRAV = 900;
const JUMP_V = -620;
const MAX_HOLD = 0.34;
const COYOTE = 0.09;
const BUFFER = 0.12;

const $ = id => document.getElementById(id);
const canvas = $('game');
const ctx = canvas.getContext('2d');
const screenEl = $('screen');
const stageEl = $('stage');
const appEl = $('app');

const SPR = buildSprites(4);
const WORLDS = buildWorlds();
const sfx = new Sfx();

const dom = {
  score: $('hudScore'), best: $('hudBest'), coins: $('hudCoins'), dist: $('hudDist'),
  buffs: $('buffBar'), hint: $('hint'),
  pauseLayer: $('pauseLayer'), overLayer: $('overLayer'),
  btnPause: $('btnPause'), btnMute: $('btnMute'), touch: $('touch'),
  btnResume: $('btnResume'), btnRestart: $('btnRestart'), btnRestartPause: $('btnRestartPause'),
  overScore: $('overScore'), overDist: $('overDist'), overCoins: $('overCoins'),
  overBest: $('overBest'), overTitle: $('overTitle'), overBadge: $('overBadge'),
  record: $('newRecord')
};

const rand = (a, b) => a + Math.random() * (b - a);
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const lerp = (a, b, t) => a + (b - a) * t;

let bestScore = 0;
try { bestScore = Number(localStorage.getItem('catRunnerBest')) || 0; } catch (e) { /* ignore */ }

let jumpHeld = false;
let G = null;
let DPR = 1;
let lastTime = 0;
let buffSig = '';

// 手机竖屏时把整个界面旋转成横屏：#app 尺寸换成「高宽互换」再转 90°
// （Android/iOS 都能生效，系统允许锁横屏时会被 tryLockLandscape 取代）
function applyLandscapeLayout() {
  const phone = matchMedia('(pointer: coarse)').matches;
  const portrait = window.innerHeight > window.innerWidth;
  const force = phone && portrait;
  appEl.classList.toggle('force-landscape', force);
  if (force) {
    appEl.style.width = window.innerHeight + 'px';
    appEl.style.height = window.innerWidth + 'px';
  } else {
    appEl.style.width = '';
    appEl.style.height = '';
  }
}

// 系统级横屏：Android Chrome / 全屏下可以直接锁，失败就 CSS 兜底
let landscapeTried = false;
function tryLockLandscape() {
  if (landscapeTried) return;
  landscapeTried = true;
  if (!matchMedia('(pointer: coarse)').matches) return;
  const so = screen.orientation;
  if (!so || typeof so.lock !== 'function') return;
  Promise.resolve()
    .then(() => (!document.fullscreenElement && document.documentElement.requestFullscreen
      ? document.documentElement.requestFullscreen({ navigationUI: 'hide' })
      : null))
    .then(() => so.lock('landscape'))
    .then(resize)
    .catch(() => { /* 锁不了就用 CSS 旋转兜底 */ });
}

function resize() {
  applyLandscapeLayout();
  const aw = stageEl.clientWidth;
  const ah = stageEl.clientHeight;
  let w = aw;
  let h = w * 9 / 16;
  if (h > ah) {
    h = ah;
    w = h * 16 / 9;
  }
  screenEl.style.width = Math.max(1, Math.floor(w)) + 'px';
  screenEl.style.height = Math.max(1, Math.floor(h)) + 'px';
  DPR = clamp(window.devicePixelRatio || 1, 1, 2.5);
  canvas.width = Math.round(W * DPR);
  canvas.height = Math.round(H * DPR);
  ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
  ctx.imageSmoothingEnabled = false;
}
window.addEventListener('resize', resize);
window.addEventListener('orientationchange', resize);
document.addEventListener('fullscreenchange', resize);
if (window.visualViewport) window.visualViewport.addEventListener('resize', resize);
// 浏览器要求用户手势才允许锁屏幕方向 / 进全屏
window.addEventListener('pointerdown', tryLockLandscape, { passive: true });
window.addEventListener('keydown', tryLockLandscape);

function newGame() {
  G = {
    mode: 'run', t: 0, scroll: 0, speed: 340, dist: 0, score: 0, coins: 0,
    lastMilestone: 0, startBest: bestScore, recordShown: false,
    obstacles: [], coinList: [], powerups: [], particles: [], texts: [],
    spawnX: 1080, powerCd: 12,
    shake: 0, flash: 0, hitstop: 0, slowmo: 0, deathTimer: 0, deathReason: '',
    player: {
      y: GROUND, vy: 0, onGround: true, coyote: 0, buffer: 0, hold: 0,
      shield: 0, magnet: 0, dash: 0, invuln: 0,
      runPhase: 0, airTime: 0, jumpFrom: 0, landTimer: 0, airRot: 0, blink: 0, blinkTimer: rand(1.5, 3.5),
      sqx: 1, sqy: 1, dead: false, deathRot: 0
    }
  };
  buffSig = 'force';
  dom.overLayer.classList.add('hidden');
  dom.pauseLayer.classList.add('hidden');
  dom.record.classList.remove('show');
  dom.btnPause.classList.remove('playing');
  dom.hint.classList.remove('gone');
  syncTouch();
  updateHud();
}

/* ---------- 操作 ---------- */
function pressJump() {
  sfx.unlock();
  if (G.mode === 'over') { newGame(); return; }
  if (G.mode === 'paused') { resume(); return; }
  if (G.mode !== 'run') return;
  G.player.buffer = BUFFER;
}

function releaseJump() {
  jumpHeld = false;
  if (!G || G.mode !== 'run') return;
  const p = G.player;
  if (!p.onGround && p.vy < 0) p.vy *= 0.55;
}

// 拇指键只在真正跑动时露出，暂停/结算时收起来
function syncTouch() {
  dom.touch.classList.toggle('hidden', !G || (G.mode !== 'run' && G.mode !== 'dying'));
}

function togglePause() {
  if (!G) return;
  if (G.mode === 'run') {
    G.mode = 'paused';
    dom.pauseLayer.classList.remove('hidden');
    dom.btnPause.classList.add('playing');
    syncTouch();
    sfx.pause();
  } else if (G.mode === 'paused') {
    resume();
  }
}

function resume() {
  if (!G || G.mode !== 'paused') return;
  G.mode = 'run';
  dom.pauseLayer.classList.add('hidden');
  dom.btnPause.classList.remove('playing');
  syncTouch();
  lastTime = performance.now();
  sfx.unlock();
}

function toggleMute() {
  const muted = sfx.toggle();
  dom.btnMute.classList.toggle('muted', muted);
}

function updateHud() {
  if (!G) return;
  const s = Math.floor(G.score);
  dom.score.textContent = s;
  dom.best.textContent = Math.max(bestScore, s);
  dom.coins.textContent = G.coins;
  dom.dist.textContent = Math.floor(G.dist) + 'm';
}

function updateBuffBar() {
  if (!G) return;
  const p = G.player;
  const parts = [];
  if (p.shield > 0) parts.push(['shield', '护盾']);
  if (p.magnet > 0) parts.push(['magnet', '磁铁 ' + Math.ceil(p.magnet) + 's']);
  if (p.dash > 0) parts.push(['dash', '冲刺 ' + Math.ceil(p.dash) + 's']);
  const sig = parts.map(x => x.join(':')).join('|');
  if (sig === buffSig) return;
  buffSig = sig;
  dom.buffs.innerHTML = parts
    .map(([c, t]) => '<span class="buff ' + c + '">' + t + '</span>')
    .join('');
}

function showResult() {
  G.mode = 'over';
  syncTouch();
  dom.overLayer.classList.remove('hidden');
  dom.overScore.textContent = Math.floor(G.score);
  dom.overDist.textContent = Math.floor(G.dist) + 'm';
  dom.overCoins.textContent = G.coins;
  dom.overBest.textContent = Math.floor(bestScore);
  dom.overTitle.textContent = G.deathReason === 'hole' ? '掉进下水道了' : '被绊住了';
  const isRecord = G.score > G.startBest && G.score > 0;
  dom.overBadge.classList.toggle('hidden', !isRecord);
  if (G.score > bestScore) {
    bestScore = Math.floor(G.score);
    try { localStorage.setItem('catRunnerBest', String(bestScore)); } catch (e) { /* ignore */ }
  }
  dom.overBest.textContent = Math.floor(bestScore);
  dom.btnPause.classList.remove('playing');
}

/* ---------- 输入绑定 ---------- */
window.addEventListener('keydown', e => {
  const c = e.code;
  if (['Space', 'ArrowUp', 'KeyW', 'KeyP', 'Escape', 'KeyM', 'KeyR', 'Enter'].includes(c)) {
    e.preventDefault();
  }
  if (e.repeat) return;
  if (c === 'Space' || c === 'ArrowUp' || c === 'KeyW') {
    jumpHeld = true;
    pressJump();
  } else if (c === 'KeyP' || c === 'Escape') {
    togglePause();
  } else if (c === 'KeyM') {
    toggleMute();
  } else if (c === 'KeyR') {
    if (G) newGame();
  } else if (c === 'Enter') {
    if (G && (G.mode === 'over' || G.mode === 'paused')) {
      if (G.mode === 'paused') resume();
      else newGame();
    }
  }
});
window.addEventListener('keyup', e => {
  const c = e.code;
  if (c === 'Space' || c === 'ArrowUp' || c === 'KeyW') releaseJump();
});

canvas.addEventListener('pointerdown', e => {
  e.preventDefault();
  sfx.unlock();
  if (!G) return;
  if (G.mode === 'over') { newGame(); return; }
  if (G.mode === 'paused') { resume(); return; }
  jumpHeld = true;
  pressJump();
});
canvas.addEventListener('pointerup', releaseJump);
canvas.addEventListener('pointercancel', releaseJump);
canvas.addEventListener('contextmenu', e => e.preventDefault());

// 横屏双手拇指各一个跳跃键，功能相同
const jumpDown = new Set();

function bindJumpButton(btn) {
  btn.addEventListener('pointerdown', e => {
    e.preventDefault();
    btn.classList.add('pressed');
    jumpDown.add(btn);
    jumpHeld = true;
    pressJump();
  });
  const up = () => {
    btn.classList.remove('pressed');
    jumpDown.delete(btn);
    if (jumpDown.size === 0) releaseJump();
  };
  btn.addEventListener('pointerup', up);
  btn.addEventListener('pointercancel', up);
  btn.addEventListener('pointerleave', up);
}
[$('btnJumpL'), $('btnJumpR')].forEach(bindJumpButton);

// 结算面板会盖住拇指键，点面板空白处也能重开
dom.overLayer.addEventListener('pointerdown', e => {
  if (e.target.closest('.pill')) return;
  newGame();
});

dom.btnPause.addEventListener('click', e => { e.stopPropagation(); togglePause(); });
dom.btnMute.addEventListener('click', e => { e.stopPropagation(); toggleMute(); });
dom.btnResume.addEventListener('click', resume);
dom.btnRestart.addEventListener('click', () => newGame());
dom.btnRestartPause.addEventListener('click', () => newGame());

document.addEventListener('visibilitychange', () => {
  if (document.hidden && G && G.mode === 'run') togglePause();
});

/* ---------- 障碍 / 金币 / 道具生成 ---------- */
const OB_DEFS = {
  crate: { img: 'crate', w: 72, h: 72, hw: 56, hh: 64, ox: 8, oy: 6 },
  crate2: { img: 'crate', w: 72, h: 144, hw: 56, hh: 136, ox: 8, oy: 6 },
  trashG: { img: 'trashG', w: 60, h: 84, hw: 44, hh: 76, ox: 8, oy: 6 },
  trashGray: { img: 'trashGray', w: 60, h: 84, hw: 44, hh: 76, ox: 8, oy: 6 },
  cans: { img: 'cans', w: 102, h: 39, hw: 96, hh: 34, ox: 3, oy: 3 },
  pipe: { img: 'pipe', w: 96, h: 36, hw: 90, hh: 30, ox: 3, oy: 3 },
  manhole: { img: 'manhole', w: 102, h: 45, hw: 78, hh: 16, ox: 10, oy: 24, yOff: 21, hole: true },
  wall: { img: 'wall', w: 90, h: 138, hw: 84, hh: 132, ox: 3, oy: 3 },
  bird: { img: 'bird', w: 42, h: 42, hw: 34, hh: 24, ox: 4, oy: 8, fly: true }
};

function addObstacle(type, x) {
  const d = OB_DEFS[type];
  const o = {
    type, x, ...d,
    y: GROUND - d.h + (d.yOff || 0),
    phase: rand(0, 6.28),
    dead: false
  };
  G.obstacles.push(o);
  return o;
}

function addCoin(x, y) {
  G.coinList.push({ x, y, phase: rand(0, 6.28), taken: false });
}

function addCoinLine(x, y, n, step = 30) {
  for (let i = 0; i < n; i++) addCoin(x + i * step, y);
}

function addCoinArc(x, peak = 110, n = 5) {
  for (let i = 0; i < n; i++) {
    const t = i / (n - 1);
    addCoin(x - 46 + i * 23, GROUND - 42 - Math.sin(t * Math.PI) * peak);
  }
}

function spawnPattern() {
  const t = G.t;
  const pool = [['crate', 3]];
  if (t > 9) pool.push(['trashG', 2], ['cans', 2], ['trashGray', 1]);
  if (t > 13) pool.push(['pipe', 2.2]);
  if (t > 18) pool.push(['manhole', 2.2]);
  if (t > 28) pool.push(['wall', 2]);
  if (t > 24) pool.push(['crate2', 1]);
  if (t > 40) pool.push(['wall', 1.4]);
  if (t > 50) pool.push(['bird', 2.2]);

  let total = 0;
  pool.forEach(([, w]) => { total += w; });
  let r = Math.random() * total;
  let kind = pool[0][0];
  for (const [k, w] of pool) {
    r -= w;
    if (r <= 0) { kind = k; break; }
  }

  const o = addObstacle(kind, G.spawnX);
  if (kind === 'wall' || kind === 'crate2') {
    addCoinArc(o.x + o.w / 2, 155, 6);
  } else if (kind === 'bird') {
    addCoinLine(o.x - 40, GROUND - 34, 3, 28);
  } else {
    addCoinArc(o.x + o.w / 2, 112, 5);
  }
  if (Math.random() < 0.5) addCoinLine(o.x + o.w + 110, GROUND - 36, 4, 30);
  if (Math.random() < 0.38) addCoinLine(o.x + o.w + 210, GROUND - 168, 5, 30);

  const gap = 180 + G.speed * (0.62 + Math.random() * 0.5);
  G.spawnX = o.x + o.w + gap;
}

function spawnPowerup() {
  const types = ['shield', 'magnet', 'fish', 'mouse'];
  const type = types[Math.floor(Math.random() * types.length)];
  let x = G.scroll + 1120;
  for (const o of G.obstacles) {
    if (Math.abs(o.x + o.w / 2 - x) < 190) x = o.x + o.w + 220;
  }
  const y = type === 'mouse' ? GROUND - 26 : Math.random() < 0.6 ? GROUND - 122 : GROUND - 64;
  G.powerups.push({ type, x, y, phase: rand(0, 6.28), dead: false });
}

/* ---------- 粒子 / 弹字 ---------- */
function burst(x, y, colors, count, speed = 220, life = 0.6, size = 4, gravity = 1100) {
  for (let i = 0; i < count; i++) {
    const a = Math.random() * Math.PI * 2;
    const sp = speed * rand(0.35, 1);
    G.particles.push({
      x, y,
      vx: Math.cos(a) * sp,
      vy: Math.sin(a) * sp - speed * 0.25,
      life: life * rand(0.6, 1.2),
      max: life,
      color: colors[Math.floor(Math.random() * colors.length)],
      size: size * rand(0.6, 1.4),
      g: gravity
    });
  }
}

function floatText(x, y, txt, color = '#ffe07a') {
  G.texts.push({ x, y, txt, color, life: 0.9, max: 0.9 });
}

/* ---------- 物理与主更新 ---------- */
function doJump() {
  const p = G.player;
  p.vy = JUMP_V;
  p.onGround = false;
  p.coyote = 0;
  p.buffer = 0;
  p.hold = 0;
  p.airTime = 0;
  p.jumpFrom = Math.floor(p.runPhase) % SPR.catRun.length;
  p.sqx = 0.82;
  p.sqy = 1.2;
  sfx.jump();
}

function playerRect() {
  const p = G.player;
  const w = 46;
  const h = 58;
  return { x: CAT_X - w / 2, y: p.y - h, w, h };
}

function updateParticles(dt) {
  for (const pt of G.particles) {
    pt.life -= dt;
    pt.vy += pt.g * dt;
    pt.x += pt.vx * dt;
    pt.y += pt.vy * dt;
  }
  G.particles = G.particles.filter(pt => pt.life > 0);
  for (const t of G.texts) {
    t.life -= dt;
    t.y -= 46 * dt;
  }
  G.texts = G.texts.filter(t => t.life > 0);
}

function updateRun(dt) {
  const p = G.player;
  G.t += dt;
  G.speed = 340 + Math.min(520, G.t * 7);
  const spd = G.speed + (p.dash > 0 ? 190 : 0);
  G.scroll += spd * dt;
  G.dist = G.scroll / 20;

  p.magnet = Math.max(0, p.magnet - dt);
  p.dash = Math.max(0, p.dash - dt);
  p.invuln = Math.max(0, p.invuln - dt);
  p.blinkTimer -= dt;
  if (p.blinkTimer <= 0) {
    p.blink = 0.12;
    p.blinkTimer = rand(2, 4);
  }
  p.blink = Math.max(0, p.blink - dt);
  const ease = 1 - Math.exp(-dt * 14);
  p.sqx = lerp(p.sqx, 1, ease);
  p.sqy = lerp(p.sqy, 1, ease);
  p.buffer = Math.max(0, p.buffer - dt);
  p.landTimer = Math.max(0, p.landTimer - dt);
  const airTarget = p.onGround ? 0 : clamp(p.vy / 1400, -0.3, 0.34);
  p.airRot = lerp(p.airRot, airTarget, 1 - Math.exp(-dt * 12));

  if (p.onGround) {
    p.coyote = COYOTE;
    p.airTime = 0;
    p.runPhase += dt * (8 + spd / 120);
  } else {
    p.coyote = Math.max(0, p.coyote - dt);
    p.airTime += dt;
  }

  if (p.buffer > 0 && (p.onGround || p.coyote > 0)) doJump();

  let g = GRAV;
  if (!p.onGround && jumpHeld && p.vy < 0 && p.hold < MAX_HOLD) {
    p.hold += dt;
    g = HOLD_GRAV;
  } else if (!p.onGround) {
    p.hold = MAX_HOLD;
  }
  p.vy += g * dt;
  p.y += p.vy * dt;
  if (p.y >= GROUND) {
    if (!p.onGround) {
      p.y = GROUND;
      p.vy = 0;
      p.onGround = true;
      p.sqx = 1.2;
      p.sqy = 0.76;
      p.landTimer = 0.1;
      sfx.land();
    }
    p.y = GROUND;
    p.vy = 0;
    p.hold = 0;
  } else {
    p.onGround = false;
  }

  // 生成器
  if (!G.spawnStarted && G.t > 7) {
    G.spawnStarted = true;
    G.spawnX = G.scroll + 1080;
  }
  if (G.spawnStarted && G.spawnX - G.scroll < 1240) spawnPattern();

  G.powerCd -= dt;
  if (G.t > 12 && G.powerCd <= 0) {
    spawnPowerup();
    G.powerCd = rand(10, 16);
  }

  for (const o of G.obstacles) {
    if (o.fly) o.y = GROUND - 88 + Math.sin(G.t * 2.2 + o.phase) * 12;
  }
  G.obstacles = G.obstacles.filter(o => !o.dead && o.x - G.scroll > -280);

  updateCoins(dt);
  updatePowerups(dt);
  checkCollisions();
  updateParticles(dt);

  G.score = G.dist + G.coins * 10;
  const ms = Math.floor(G.dist / 100);
  if (ms > G.lastMilestone) {
    G.lastMilestone = ms;
    floatText(CAT_X + 40, 236, ms * 100 + 'm', '#a9f6ff');
    sfx.milestone();
  }
  if (!G.recordShown && G.score > G.startBest && G.score > 60) {
    G.recordShown = true;
    dom.record.classList.remove('show');
    void dom.record.offsetWidth;
    dom.record.classList.add('show');
    sfx.record();
    bestScore = Math.max(bestScore, Math.floor(G.score));
    try { localStorage.setItem('catRunnerBest', String(bestScore)); } catch (e) { /* ignore */ }
  }

  dom.hint.classList.toggle('gone', G.t > 6);
  updateBuffBar();
  updateHud();
}

function updateDying(rdt) {
  const p = G.player;
  G.deathTimer += rdt;
  G.slowmo = Math.max(0, G.slowmo - rdt);
  if (G.hitstop > 0) {
    G.hitstop -= rdt;
    return;
  }
  const dt = rdt * 0.25;
  p.vy += GRAV * 0.8 * dt;
  p.y += p.vy * dt;
  p.deathRot += dt * 2.4;
  G.scroll += G.speed * 0.35 * dt;
  updateParticles(dt);
  if (G.deathTimer > 0.98) showResult();
}

function update(rdt) {
  if (!G) return;
  G.flash = Math.max(0, G.flash - rdt * 2.6);
  G.shake *= Math.exp(-rdt * 5);
  if (G.mode === 'paused' || G.mode === 'over') return;
  if (G.mode === 'dying') {
    updateDying(rdt);
    return;
  }
  updateRun(rdt);
}

/* ---------- 拾取与碰撞 ---------- */
function updateCoins(dt) {
  const p = G.player;
  const cy = p.y - 30;
  for (const c of G.coinList) {
    if (c.taken) continue;
    const sx = c.x - G.scroll;
    if (sx < -80 || sx > W + 80) continue;
    const dx = sx - CAT_X;
    const dy = c.y - cy;
    const dist = Math.hypot(dx, dy);
    if (p.magnet > 0 && dist < 170) {
      const pull = Math.min(1, dt * 8);
      c.x -= dx * pull;
      c.y -= dy * pull;
    }
    if (dist < 34) {
      c.taken = true;
      G.coins++;
      sfx.coin();
      burst(sx, c.y, ['#ffe483', '#ffb52e', '#fff6c9'], 8, 150, 0.45, 3, 500);
      floatText(sx + 6, c.y - 8, '+10');
    }
  }
  G.coinList = G.coinList.filter(c => !c.taken && c.x - G.scroll > -120);
}

function updatePowerups(dt) {
  const p = G.player;
  const cy = p.y - 30;
  for (const it of G.powerups) {
    if (it.dead) continue;
    const sx = it.x - G.scroll;
    const dy = it.y - cy;
    if (Math.hypot(sx - CAT_X, dy) < 42) {
      it.dead = true;
      if (it.type === 'shield') {
        p.shield = 1;
        floatText(sx, it.y - 20, '护盾！', '#8ff5ef');
        burst(sx, it.y, ['#8ff5ef', '#d6fffd', '#37cfc0'], 16, 180, 0.7, 4, 300);
      } else if (it.type === 'magnet') {
        p.magnet = 7;
        floatText(sx, it.y - 20, '磁铁 7s', '#ffd76e');
        burst(sx, it.y, ['#ffd76e', '#fff0bd', '#ff9d3c'], 16, 180, 0.7, 4, 300);
      } else if (it.type === 'mouse') {
        G.coins += 5;
        floatText(sx, it.y - 20, '老鼠 +5', '#ffd76e');
        burst(sx, it.y, ['#c9964a', '#ffd76e', '#f3dfbd'], 14, 180, 0.7, 4, 300);
        sfx.coin();
      } else {
        p.dash = 3;
        p.invuln = Math.max(p.invuln, 3);
        floatText(sx, it.y - 20, '冲刺！', '#ffb2c4');
        burst(sx, it.y, ['#ffb2c4', '#ff8fa5', '#fff'], 18, 220, 0.7, 4, 300);
        sfx.dash();
      }
      if (it.type === 'shield' || it.type === 'magnet') sfx.power();
      G.shake = Math.max(G.shake, 4);
    }
  }
  G.powerups = G.powerups.filter(it => !it.dead && it.x - G.scroll > -120);
}

function breakObstacle(o) {
  o.dead = true;
  const sx = o.x - G.scroll + o.w / 2;
  const sy = o.y + o.h / 2;
  const colors = o.type === 'bird'
    ? ['#8fa2b6', '#fff', '#ffb648']
    : o.type === 'pipe'
      ? ['#7f929f', '#b8c9d3', '#e35d4d', '#3b4b57']
      : ['#c98543', '#8a5222', '#e2ab6b', '#5a636e'];
  burst(sx, sy, colors, 16, 300, 0.8, 5, 1000);
  G.shake = Math.max(G.shake, 9);
}

function hitObstacle(o) {
  const p = G.player;
  if (p.invuln > 0) return;
  if (p.dash > 0) {
    breakObstacle(o);
    sfx.shield();
    return;
  }
  if (p.shield > 0) {
    p.shield = 0;
    p.invuln = 1.2;
    breakObstacle(o);
    sfx.shield();
    G.flash = 0.22;
    G.shake = Math.max(G.shake, 13);
    floatText(CAT_X + 30, G.player.y - 70, '护盾破碎', '#8ff5ef');
    return;
  }
  die('hit');
}

function checkCollisions() {
  if (G.mode !== 'run') return;
  const p = G.player;
  const pr = playerRect();
  for (const o of G.obstacles) {
    if (o.dead) continue;
    const sx = o.x - G.scroll;
    if (sx > W + 80 || sx + o.w < -80) continue;

    if (o.hole) {
      const hitL = sx + 14;
      const hitR = sx + o.w - 14;
      if (pr.x + pr.w > hitL && pr.x < hitR && p.y >= GROUND - 4) {
        die('hole');
        return;
      }
      continue;
    }

    const or = { x: sx + o.ox, y: o.y + o.oy, w: o.hw, h: o.hh };
    const overlap = pr.x < or.x + or.w && pr.x + pr.w > or.x
      && pr.y < or.y + or.h && pr.y + pr.h > or.y;
    if (!overlap) continue;
    hitObstacle(o);
    if (G.mode !== 'run') return;
  }
}

function die(reason) {
  if (G.mode !== 'run') return;
  const p = G.player;
  G.mode = 'dying';
  G.deathReason = reason;
  G.hitstop = 0.09;
  G.slowmo = 0.55;
  G.deathTimer = 0;
  G.shake = 20;
  G.flash = 0.38;
  p.dead = true;
  if (reason === 'hole') {
    p.vy = 220;
    sfx.splash();
  } else {
    p.vy = -360;
    sfx.hit();
  }
  burst(CAT_X, p.y - 30, ['#ffffff', '#ffd36e', '#ff8a7a', '#9fdcff'], 28, 340, 0.95, 5, 1200);
}

/* ---------- 渲染 ---------- */
function nightAlpha(t) {
  const p = (t % 48) / 48;
  if (p < 0.34) return 0;
  if (p < 0.44) return (p - 0.34) / 0.1;
  if (p < 0.72) return 1;
  if (p < 0.88) return 1 - (p - 0.72) / 0.16;
  return 0;
}

function drawTiled(img, offset, y) {
  const iw = img.width;
  let x = -(((offset % iw) + iw) % iw);
  for (; x < W; x += iw) ctx.drawImage(img, x, y);
}

function drawWorld() {
  const t = G ? G.t : 0;
  const scroll = G ? G.scroll : 0;
  const na = nightAlpha(t);

  ctx.drawImage(WORLDS.day.sky, 0, 0);
  if (na > 0) {
    ctx.globalAlpha = na;
    ctx.drawImage(WORLDS.night.sky, 0, 0);
    ctx.globalAlpha = 1;
  }
  drawTiled(WORLDS.day.far, scroll * 0.12, 0);
  if (na > 0) {
    ctx.globalAlpha = na;
    drawTiled(WORLDS.night.far, scroll * 0.12, 0);
    ctx.globalAlpha = 1;
  }
  drawTiled(WORLDS.day.mid, scroll * 0.3, 0);
  if (na > 0) {
    ctx.globalAlpha = na;
    drawTiled(WORLDS.night.mid, scroll * 0.3, 0);
    ctx.globalAlpha = 1;
  }
  drawTiled(WORLDS.day.ground.c, scroll, 420);
  if (na > 0) {
    ctx.globalAlpha = na;
    drawTiled(WORLDS.night.ground.c, scroll, 420);
    ctx.globalAlpha = 1;
  }
}

function drawObstacles() {
  const scroll = G.scroll;
  for (const o of G.obstacles) {
    const sx = o.x - scroll;
    if (sx > W + 140 || sx + o.w < -140) continue;

    if (o.type !== 'manhole' && o.type !== 'bird') {
      ctx.fillStyle = 'rgba(30,25,30,.18)';
      ctx.beginPath();
      ctx.ellipse(sx + o.w / 2, GROUND + 3, o.w * 0.4, 6, 0, 0, Math.PI * 2);
      ctx.fill();
    }

    if (o.type === 'crate2') {
      ctx.drawImage(SPR.crate, sx, GROUND - 72);
      ctx.drawImage(SPR.crate, sx, GROUND - 144);
    } else if (o.type === 'bird') {
      const frame = SPR.bird[Math.floor(G.t * 9 + o.phase) % 2];
      ctx.save();
      ctx.translate(sx + o.w / 2, o.y + o.h / 2);
      ctx.scale(1, 0.94);
      ctx.drawImage(frame, -frame.width / 2, -frame.height / 2);
      ctx.restore();
      // 轻微速度线
      ctx.strokeStyle = 'rgba(255,255,255,.45)';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(sx - 14, o.y + 16);
      ctx.lineTo(sx - 34, o.y + 16);
      ctx.stroke();
    } else {
      ctx.drawImage(SPR[o.img], sx, o.y);
    }
  }
}

function drawCoins() {
  const t = G.t;
  for (const c of G.coinList) {
    const sx = c.x - G.scroll;
    if (sx < -60 || sx > W + 60) continue;
    const bob = Math.sin(t * 3 + c.phase) * 3;
    const sc = 0.35 + 0.65 * Math.abs(Math.cos(t * 3.4 + c.phase));
    ctx.save();
    ctx.translate(sx, c.y + bob);
    ctx.scale(sc, 1);
    ctx.drawImage(SPR.coin, -SPR.coin.width / 2, -SPR.coin.height / 2);
    ctx.restore();
    ctx.fillStyle = 'rgba(255,229,140,.16)';
    ctx.beginPath();
    ctx.arc(sx, c.y + bob, 16, 0, Math.PI * 2);
    ctx.fill();
  }
}

function drawPowerups() {
  const t = G.t;
  for (const it of G.powerups) {
    const sx = it.x - G.scroll;
    if (sx < -80 || sx > W + 80) continue;
    const y = it.y + Math.sin(t * 2 + it.phase) * 6;
    const pulse = 1 + Math.sin(t * 4 + it.phase) * 0.08;
    const glow = ctx.createRadialGradient(sx, y, 4, sx, y, 48 * pulse);
    const tint = it.type === 'shield' ? '143,245,239' : it.type === 'magnet' ? '255,215,110' : it.type === 'mouse' ? '255,209,102' : '255,178,196';
    glow.addColorStop(0, 'rgba(' + tint + ',.5)');
    glow.addColorStop(1, 'rgba(' + tint + ',0)');
    ctx.fillStyle = glow;
    ctx.fillRect(sx - 56, y - 56, 112, 112);
    const img = SPR[it.type];
    ctx.save();
    ctx.translate(sx, y);
    ctx.scale(pulse, pulse);
    ctx.drawImage(img, -img.width / 2, -img.height / 2);
    ctx.restore();
    ctx.strokeStyle = 'rgba(' + tint + ',.85)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(sx, y, 26 + Math.sin(t * 2.5 + it.phase) * 3, 0, Math.PI * 2);
    ctx.stroke();
  }
}

function drawSpeedLines() {
  if (!G || G.mode === 'over') return;
  const p = G.player;
  const spd = G.speed + (p.dash > 0 ? 190 : 0);
  if (spd < 520) return;
  const n = p.dash > 0 ? 5 : 3;
  const k = (spd - 520) / 400;
  ctx.strokeStyle = 'rgba(255,255,255,' + (0.12 + k * 0.2) + ')';
  ctx.lineWidth = 2;
  for (let i = 0; i < n; i++) {
    const y = GROUND - 26 - i * 15 + Math.sin(G.t * 18 + i * 2.1) * 5;
    const len = 30 + (i % 3) * 18 + k * 40;
    const x = CAT_X - 52 - (i % 2) * 14;
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x - len, y);
    ctx.stroke();
  }
}

function drawPlayer() {
  const p = G.player;
  let img;
  let footPad = SPR.catRunFootPad;
  if (p.dead) {
    img = SPR.catJump[3];
  } else if (!p.onGround) {
    if (p.airTime < 0.12) {
      img = SPR.catRun[p.jumpFrom % SPR.catRun.length];
    } else {
      let jumpIndex = 0;
      if (p.vy > -300) jumpIndex = 1;
      if (p.vy > 80) jumpIndex = 2;
      if (p.vy > 380) jumpIndex = 3;
      img = SPR.catJump[jumpIndex];
    }
  } else if (p.landTimer > 0) {
    img = SPR.catJump[3];
  } else {
    img = SPR.catRun[Math.floor(p.runPhase) % SPR.catRun.length];
  }

  if (p.y < GROUND + 60) {
    const hAbove = Math.max(0, GROUND - p.y);
    const k = clamp(1 - hAbove / 320, 0.32, 1);
    ctx.fillStyle = 'rgba(24,32,40,' + (0.24 * k) + ')';
    ctx.beginPath();
    ctx.ellipse(CAT_X, GROUND + 4, 44 * k, 8 * k, 0, 0, Math.PI * 2);
    ctx.fill();
  }

  ctx.save();
  ctx.translate(CAT_X, p.y);

  if (p.dash > 0) {
    ctx.globalAlpha = 0.16;
    ctx.drawImage(img, -img.width / 2 - 22, -img.height + footPad);
    ctx.drawImage(img, -img.width / 2 - 42, -img.height + footPad);
    ctx.globalAlpha = 1;
  }

  if (p.invuln > 0 && Math.floor(G.t * 22) % 2 === 0) ctx.globalAlpha = 0.42;
  if (p.dead) ctx.rotate(p.deathRot);
  else ctx.rotate(p.airRot);

  const sx = p.sqx;
  const sy = p.sqy;
  ctx.scale(sx, sy);
  ctx.drawImage(img, -img.width / 2, -img.height + footPad);
  ctx.globalAlpha = 1;
  ctx.restore();

  if (p.shield > 0) {
    const pulse = 1 + Math.sin(G.t * 5) * 0.05;
    ctx.save();
    ctx.translate(CAT_X, p.y - 26);
    ctx.strokeStyle = 'rgba(143,245,239,.9)';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.ellipse(0, 0, 38 * pulse, 34 * pulse, 0, 0, Math.PI * 2);
    ctx.stroke();
    ctx.strokeStyle = 'rgba(143,245,239,.28)';
    ctx.lineWidth = 8;
    ctx.stroke();
    for (let i = 0; i < 3; i++) {
      const a = G.t * 2.4 + i * 2.1;
      ctx.fillStyle = '#c9fffb';
      ctx.fillRect(Math.cos(a) * 38 - 2, Math.sin(a) * 32 - 2, 5, 5);
    }
    ctx.restore();
  }
  if (p.magnet > 0) {
    ctx.strokeStyle = 'rgba(255,215,110,.35)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(CAT_X, p.y - 28, 52 + Math.sin(G.t * 4) * 4, 0, Math.PI * 2);
    ctx.stroke();
  }
}

function drawParticles() {
  for (const pt of G.particles) {
    const a = clamp(pt.life / pt.max, 0, 1);
    ctx.globalAlpha = a;
    ctx.fillStyle = pt.color;
    ctx.fillRect(pt.x - pt.size / 2, pt.y - pt.size / 2, pt.size, pt.size);
  }
  ctx.globalAlpha = 1;
}

function drawTexts() {
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  for (const t of G.texts) {
    const a = clamp(t.life / t.max, 0, 1);
    ctx.globalAlpha = a;
    ctx.font = '900 20px "PingFang SC", "Microsoft YaHei", monospace';
    ctx.lineWidth = 5;
    ctx.strokeStyle = 'rgba(30,40,50,.75)';
    ctx.strokeText(t.txt, t.x, t.y);
    ctx.fillStyle = t.color;
    ctx.fillText(t.txt, t.x, t.y);
  }
  ctx.globalAlpha = 1;
}

function render() {
  ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
  ctx.clearRect(0, 0, W, H);
  ctx.imageSmoothingEnabled = false;
  const na = nightAlpha(G ? G.t : 0);
  ctx.fillStyle = na > 0.5 ? '#101a3c' : '#8fd8e8';
  ctx.fillRect(0, 0, W, H);

  ctx.save();
  if (G && G.shake > 0.3) {
    ctx.translate(rand(-1, 1) * G.shake * 0.55, rand(-1, 1) * G.shake * 0.55);
  }
  drawWorld();
  if (G) {
    drawObstacles();
    drawCoins();
    drawPowerups();
    drawSpeedLines();
    drawPlayer();
    drawParticles();
    drawTexts();
  }
  ctx.restore();

  if (G && G.flash > 0) {
    ctx.fillStyle = 'rgba(255,255,255,' + clamp(G.flash, 0, 0.78) + ')';
    ctx.fillRect(0, 0, W, H);
  }
}

/* ---------- 主循环 ---------- */
function frame(now) {
  const rdt = lastTime ? Math.min(0.05, (now - lastTime) / 1000) : 0.016;
  lastTime = now;
  update(rdt);
  render();
  requestAnimationFrame(frame);
}

resize();
newGame();
window.__catRunner = () => G;
dom.btnMute.classList.toggle('muted', sfx.muted);
if (window.ResizeObserver) new ResizeObserver(resize).observe(stageEl);
requestAnimationFrame(frame);