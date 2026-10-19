/* 贪吃蛇（极致版）：自适应棋盘 · 难度递增 · 最高分 · 触屏滑动/十字键/键盘 · 暂停/重置/音效 */
(() => {
  const cvs = document.getElementById('game');
  const ctx = cvs.getContext('2d');
  const $ = (id) => document.getElementById(id);
  const board = $('board'), overlay = $('overlay');
  const ovTitle = $('ovTitle'), ovSub = $('ovSub');
  const scoreEl = $('score'), bestEl = $('best'), levelEl = $('level');
  const btnToggle = $('btnToggle'), btnReset = $('btnReset'), btnSound = $('btnSound');

  const N = 20;                       // 20×20 格
  const BEST_KEY = 'snake.best';
  const BASE_MS = 150, MIN_MS = 70;   // 每级提速 ~7ms

  let S = 24;                         // 单格边长（CSS px）
  let snake, dir, queue, food, score, best, level;
  let state = 'ready';                // ready | running | paused | over
  let lastTick = 0, rafId = 0, alive = true;
  let soundOn = true, ac = null;

  best = Number(localStorage.getItem(BEST_KEY) || 0);
  bestEl.textContent = best;

  /* ---------- 音效（首次手势后启用） ---------- */
  function beep(freq, dur, type = 'square', vol = 0.05) {
    if (!soundOn) return;
    try {
      ac = ac || new (window.AudioContext || window.webkitAudioContext)();
      if (ac.state === 'suspended') ac.resume();
      const t = ac.currentTime;
      const osc = ac.createOscillator(), gain = ac.createGain();
      osc.type = type; osc.frequency.setValueAtTime(freq, t);
      gain.gain.setValueAtTime(vol, t);
      gain.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      osc.connect(gain); gain.connect(ac.destination);
      osc.start(t); osc.stop(t + dur);
    } catch (e) { /* 静默 */ }
  }
  const sfxEat = () => beep(880, 0.07, 'square', 0.045);
  const sfxOver = () => { beep(220, 0.25, 'sawtooth', 0.06); setTimeout(() => beep(140, 0.35, 'sawtooth', 0.05), 120); };

  /* ---------- 尺寸自适应 ---------- */
  function fit() {
    const w = window.innerWidth, h = window.innerHeight;
    const dpad = Math.min(Math.max(Math.round(w * 0.34), 108), 152);
    const controlsH = Math.max(dpad, 3 * 34 + 16);  // dpad 或三枚功能键
    const fixed = 24 + 44 + 12 + controlsH + 12 + 12; // pad+hud+gap+controls+gap+pad
    const size = Math.max(200, Math.min(w - 24, h - fixed, 520));
    S = Math.floor(size / N);
    const px = S * N;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    cvs.style.width = px + 'px'; cvs.style.height = px + 'px';
    cvs.width = px * dpr; cvs.height = px * dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const d = $('dpad');
    d.style.width = dpad + 'px'; d.style.height = dpad + 'px';
    draw();
  }

  /* ---------- 游戏逻辑 ---------- */
  function reset() {
    snake = [{ x: 10, y: 10 }, { x: 9, y: 10 }, { x: 8, y: 10 }];
    dir = { x: 1, y: 0 };
    queue = [];
    score = 0; level = 1;
    scoreEl.textContent = '0'; levelEl.textContent = '1';
    food = spawn();
    setState('ready');
  }

  function spawn() {
    while (true) {
      const p = { x: (Math.random() * N) | 0, y: (Math.random() * N) | 0 };
      if (!snake.some(s => s.x === p.x && s.y === p.y)) return p;
    }
  }

  const interval = () => Math.max(MIN_MS, BASE_MS - (level - 1) * 7);

  function tick(ts) {
    if (!alive) return;
    rafId = requestAnimationFrame(tick);
    if (state !== 'running') { lastTick = ts; return; }
    if (ts - lastTick < interval()) return;
    lastTick = ts;
    step();
  }

  function step() {
    while (queue.length) {
      const d = queue.shift();
      // 只允许相对「当前已生效方向」的非反向转向
      if (d.x !== -dir.x || d.y !== -dir.y) { dir = d; break; }
    }
    const head = { x: snake[0].x + dir.x, y: snake[0].y + dir.y };
    if (head.x < 0 || head.y < 0 || head.x >= N || head.y >= N ||
        snake.some(s => s.x === head.x && s.y === head.y)) {
      setState('over'); sfxOver();
      if (score > best) { best = score; localStorage.setItem(BEST_KEY, best); bestEl.textContent = best; }
      return;
    }
    snake.unshift(head);
    if (head.x === food.x && head.y === food.y) {
      score++; scoreEl.textContent = score;
      const lv = 1 + Math.floor(score / 5);
      if (lv !== level) { level = lv; levelEl.textContent = lv; }
      food = spawn(); sfxEat();
    } else {
      snake.pop();
    }
    draw();
  }

  /* 方向入队：快速连按不会一帧内 180° 掉头 */
  function steer(d) {
    const last = queue[queue.length - 1] || dir;
    if (d.x === last.x && d.y === last.y) return;           // 同向忽略
    if (d.x === -last.x && d.y === -last.y) return;         // 反向忽略
    if (queue.length < 2) queue.push(d);
    if (state === 'ready') startRun();
  }

  function startRun() {
    if (state === 'running') return;
    setState('running');
  }

  function toggle() {
    if (state === 'running') setState('paused');
    else if (state === 'paused' || state === 'ready') setState('running');
    else if (state === 'over') { reset(); setState('running'); }
  }

  function setState(s) {
    state = s;
    const show = s !== 'running';
    overlay.classList.toggle('hidden', !show);
    overlay.classList.toggle('over', s === 'over');
    if (s === 'ready') { ovTitle.textContent = '贪吃蛇'; ovSub.textContent = '轻触棋盘或按方向键开始'; }
    else if (s === 'paused') { ovTitle.textContent = '已暂停'; ovSub.textContent = '点击继续'; }
    else if (s === 'over') { ovTitle.textContent = '游戏结束'; ovSub.textContent = `得分 ${score} · 点击重来`; }
    btnToggle.textContent = s === 'running' ? '⏸ 暂停' : '▶ 开始';
    btnToggle.classList.toggle('paused', s !== 'running');
    draw();
  }

  /* ---------- 渲染 ---------- */
  function draw() {
    const px = S * N;
    // 背景 + 网格
    ctx.fillStyle = '#0b0f17'; ctx.fillRect(0, 0, px, px);
    ctx.strokeStyle = 'rgba(255,255,255,0.03)'; ctx.lineWidth = 1;
    ctx.beginPath();
    for (let i = 1; i < N; i++) {
      ctx.moveTo(i * S + 0.5, 0); ctx.lineTo(i * S + 0.5, px);
      ctx.moveTo(0, i * S + 0.5); ctx.lineTo(px, i * S + 0.5);
    }
    ctx.stroke();

    // 食物（径向光晕）
    const fx = (food.x + 0.5) * S, fy = (food.y + 0.5) * S;
    const g = ctx.createRadialGradient(fx, fy, 1, fx, fy, S * 0.9);
    g.addColorStop(0, 'rgba(255,91,119,0.55)'); g.addColorStop(1, 'rgba(255,91,119,0)');
    ctx.fillStyle = g;
    ctx.beginPath(); ctx.arc(fx, fy, S * 0.9, 0, 7); ctx.fill();
    ctx.fillStyle = '#ff5b77';
    ctx.beginPath(); ctx.arc(fx, fy, S * 0.3, 0, 7); ctx.fill();
    ctx.fillStyle = 'rgba(255,255,255,0.75)';
    ctx.beginPath(); ctx.arc(fx - S * 0.09, fy - S * 0.09, S * 0.08, 0, 7); ctx.fill();

    // 蛇身（头亮尾暗渐变，圆角）
    snake.forEach((s, i) => {
      const t = snake.length > 1 ? i / (snake.length - 1) : 0;
      const headGlow = i === 0 ? 1 : 0;
      ctx.fillStyle = headGlow
        ? '#7ff5ef'
        : `rgb(${61 - t * 38}, ${218 - t * 60}, ${215 + t * 26})`;
      const pad = 1 + t * 0.5, r = S * 0.28;
      const x = s.x * S + pad, y = s.y * S + pad, w = S - pad * 2;
      ctx.beginPath(); ctx.roundRect(x, y, w, w, r); ctx.fill();
    });

    // 蛇头眼睛（按朝向偏移）
    if (snake.length) {
      const hd = snake[0], hx = (hd.x + 0.5) * S, hy = (hd.y + 0.5) * S;
      const ex = dir.y !== 0 ? S * 0.18 : dir.x * S * 0.14;
      const ey = dir.x !== 0 ? S * 0.18 : dir.y * S * 0.14;
      const ox = dir.y !== 0 ? 0 : dir.x * S * 0.12;
      const oy = dir.x !== 0 ? 0 : dir.y * S * 0.12;
      ctx.fillStyle = '#06222b';
      ctx.beginPath(); ctx.arc(hx - ex + ox, hy - ey + oy, S * 0.075, 0, 7); ctx.fill();
      ctx.beginPath(); ctx.arc(hx + ex + ox, hy + ey + oy, S * 0.075, 0, 7); ctx.fill();
    }
  }

  /* ---------- 输入 ---------- */
  const DIRS = {
    up: { x: 0, y: -1 }, down: { x: 0, y: 1 },
    left: { x: -1, y: 0 }, right: { x: 1, y: 0 },
  };

  addEventListener('keydown', (e) => {
    const m = { ArrowUp: 'up', ArrowDown: 'down', ArrowLeft: 'left', ArrowRight: 'right',
                w: 'up', s: 'down', a: 'left', d: 'right' }[e.key];
    if (m) { steer(DIRS[m]); e.preventDefault(); return; }
    if (e.key === ' ') { toggle(); e.preventDefault(); }
    if (e.key === 'Enter' && state === 'over') { reset(); setState('running'); }
  });

  // 十字键
  document.querySelectorAll('.pad').forEach((btn) => {
    btn.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      steer(DIRS[btn.dataset.dir]);
    });
  });

  // 棋盘滑动
  let ts = null;
  cvs.addEventListener('touchstart', (e) => {
    ts = [e.touches[0].clientX, e.touches[0].clientY];
  }, { passive: true });
  cvs.addEventListener('touchmove', (e) => {
    if (!ts) return;
    const dx = e.touches[0].clientX - ts[0], dy = e.touches[0].clientY - ts[1];
    if (Math.abs(dx) < 16 && Math.abs(dy) < 16) return;
    steer(Math.abs(dx) > Math.abs(dy)
      ? (dx > 0 ? DIRS.right : DIRS.left)
      : (dy > 0 ? DIRS.down : DIRS.up));
    ts = null; e.preventDefault();
  }, { passive: false });
  cvs.addEventListener('pointerdown', () => {
    if (state === 'paused' || state === 'ready') toggle();
    else if (state === 'over') { reset(); setState('running'); }
  });
  overlay.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    if (state === 'over') { reset(); }
    toggle();
  });

  btnToggle.addEventListener('click', toggle);
  btnReset.addEventListener('click', () => { reset(); setState('running'); });
  btnSound.addEventListener('click', () => {
    soundOn = !soundOn;
    btnSound.textContent = soundOn ? '🔊' : '🔇';
    if (soundOn) beep(760, 0.06);
  });

  // 切后台自动暂停
  document.addEventListener('visibilitychange', () => {
    if (document.hidden && state === 'running') setState('paused');
  });
  addEventListener('resize', fit);
  addEventListener('beforeunload', () => { alive = false; cancelAnimationFrame(rafId); });

  reset();
  fit();
  rafId = requestAnimationFrame(tick);
})();
