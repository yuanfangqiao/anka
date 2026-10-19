export function setup(uiCtx) {
  const { vue, registerApp } = uiCtx;
  const { ref, computed, onMounted, onUnmounted, h } = vue;

  /* ================= 常量 ================= */
  const COLS = 10;
  const ROWS = 20;
  const MONO = "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace";

  const COLORS = {
    I: "#3fe0ff", J: "#4d7cff", L: "#ff9f43", O: "#ffd93d",
    S: "#3ddc84", T: "#b46cff", Z: "#ff5c6c"
  };

  const SHAPES = {
    I: [[0, 0, 0, 0], [1, 1, 1, 1], [0, 0, 0, 0], [0, 0, 0, 0]],
    J: [[1, 0, 0], [1, 1, 1], [0, 0, 0]],
    L: [[0, 0, 1], [1, 1, 1], [0, 0, 0]],
    O: [[1, 1], [1, 1]],
    S: [[0, 1, 1], [1, 1, 0], [0, 0, 0]],
    T: [[0, 1, 0], [1, 1, 1], [0, 0, 0]],
    Z: [[1, 1, 0], [0, 1, 1], [0, 0, 0]]
  };

  const emptyGrid = () => Array.from({ length: ROWS }, () => new Array(COLS).fill(""));
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const px = (n) => Math.round(n) + "px";

  /* 触屏设备判定（决定按键尺寸 / 提示文案 / 是否启用手势） */
  const isTouch = (() => {
    try {
      if (typeof window === "undefined") return false;
      const coarse = window.matchMedia && window.matchMedia("(pointer: coarse)").matches;
      const noHover = window.matchMedia && window.matchMedia("(hover: none)").matches;
      return !!(coarse || noHover || (navigator.maxTouchPoints || 0) > 0);
    } catch (e) {
      return false;
    }
  })();

  /* ================= 布局 =================
     竖排结构（与界面一致）：
       ① 状态条：SCORE · LINES · LV  ……  NEXT（在棋盘正上方，与棋盘同宽）
       ② 棋盘（canvas）
       ③ 按键行：十字方向键（左） + A/B 圆键（右），整行宽度 = 棋盘宽度
       ④ 功能键：RESET · PAUSE/START · ON/OFF                                */
  function calcLayout(w, h, touch) {
    const pad = touch ? 8 : 10;
    const hudH = touch ? 24 : 24;    // ① 状态条
    const gap = touch ? 9 : 8;       // 通用竖向间距
    const rowGap = touch ? 16 : 14;  // 棋盘 → 按键行（留出明显空隙，避免与按键行贴住）
    const pillsH = touch ? 32 : 30;  // ④ 功能键行

    const contentW = Math.min(w - pad * 2, touch ? 460 : 420);

    /* 单格边长：宽度受屏宽约束；高度不再预设 56% 上限，
       交由下方适配循环按「剩余高度 = h - 固定区 - 按键行」收紧 */
    let cell = Math.floor((contentW - 2) / COLS);
    cell = clamp(cell, 8, touch ? 38 : 32);

    /* 单格 → 十字键 / 圆键尺寸（保证一行不超出棋盘宽，且两者之间留出空隙） */
    const geom = (c) => {
      const boardW = c * COLS;
      const circle = clamp(Math.round(boardW * 0.2), touch ? 46 : 34, 58);
      const abGap = touch ? 16 : 12;
      const abW = circle * 2 + abGap;
      const minGap = 14;
      /* 十字键 + 间隙 + A/B 必须 ≤ 棋盘宽度（否则窄屏会挤出边界/压到圆键） */
      const allowed = Math.max(44, boardW - minGap - abW);
      let dpad = clamp(Math.round(boardW * 0.36), touch ? 84 : 56, touch ? 116 : 100);
      dpad = Math.max(44, Math.min(dpad, allowed));
      return { boardW, dpad, circle, abW, abGap, minGap, rowH: Math.max(dpad, circle) };
    };

    const fixedH = pad * 2 + hudH + 4 + gap + rowGap + gap + pillsH + 2;

    let g = geom(cell);
    for (let i = 0; i < 40; i++) {
      if (fixedH + cell * ROWS + g.rowH <= h) break;
      if (cell <= 8) break;
      cell -= 1;
      g = geom(cell);
    }

    return {
      touch, w, h, pad, hudH, gap, rowGap, pillsH,
      cell, boardW: g.boardW, dpad: g.dpad, circle: g.circle, rowH: g.rowH,
      abGap: g.abGap, minGap: g.minGap,
      contentW: Math.min(contentW, g.boardW + 2),
      /* 按键行 / 功能键行 宽度 = 棋盘宽度 */
      rowW: g.boardW
    };
  }

  /* ================= 组件 ================= */
  const App = {
    name: "TetrisApp",
    setup() {
      /* ---------- 状态 ---------- */
      const grid = ref(emptyGrid());
      const piece = ref(null);
      const nextType = ref("I");
      const score = ref(0);
      const lines = ref(0);
      const level = ref(1);
      const running = ref(false);
      const over = ref(false);
      const soundOn = ref(true);
      const pressed = ref({});
      const avail = ref({ w: 0, h: 0 });

      const rootEl = ref(null);
      const canvasEl = ref(null);
      const boardEl = ref(null);
      const flashEl = ref(null);

      /* ---------- 运行时 ---------- */
      let bag = [];
      let dropAcc = 0;
      let last = 0;
      let raf = 0;
      let alive = true;
      let shake = 0;
      let flash = 0;
      let hiddenPaused = false;
      let ro = null;
      let ac = null;

      /* ================= 尺寸自适应 ================= */
      function hostFor(el) {
        let n = el ? el.parentElement : null;
        let i = 0;
        while (n && i++ < 8) {
          const cs = window.getComputedStyle(n);
          if (n.clientHeight >= 220 && cs.height !== "auto") return n;
          n = n.parentElement;
        }
        n = el ? el.parentElement : null;
        i = 0;
        while (n && i++ < 8) {
          if (n.clientHeight >= 220) return n;
          n = n.parentElement;
        }
        return null;
      }

      function pickAvail() {
        const el = rootEl.value;
        const winW = window.innerWidth || 360;
        const winH = window.innerHeight || 640;
        const host = hostFor(el);

        let w = host ? host.clientWidth : (el && el.parentElement ? el.parentElement.clientWidth : winW);
        let h = host ? host.clientHeight : 0;

        if (host) {
          const r = host.getBoundingClientRect();
          if (r.top > 0) h = Math.min(h, winH - r.top - 6);
          if (r.left > 0 && w > winW - r.left) w = winW - r.left;
        }
        if (!w || w < 140) w = winW;
        if (!h || h < 220) h = Math.max(280, winH - 84);

        avail.value = {
          w: clamp(Math.round(w), 220, winW),
          h: clamp(Math.round(h), 240, winH)
        };
      }

      const L = computed(() => calcLayout(avail.value.w || 360, avail.value.h || 640, isTouch));

      /* ================= 声音 / 触感 ================= */
      function beep(freq, dur, type, vol) {
        if (!soundOn.value) return;
        try {
          if (!ac) {
            const Ctx = window.AudioContext || window.webkitAudioContext;
            if (!Ctx) return;
            ac = new Ctx();
          }
          if (ac.state === "suspended" && ac.resume) ac.resume();
          const o = ac.createOscillator();
          const gg = ac.createGain();
          o.type = type || "square";
          o.frequency.value = freq;
          const t = ac.currentTime;
          gg.gain.setValueAtTime(vol == null ? 0.05 : vol, t);
          gg.gain.exponentialRampToValueAtTime(0.0001, t + dur);
          o.connect(gg);
          gg.connect(ac.destination);
          o.start(t);
          o.stop(t + dur + 0.02);
        } catch (e) { /* 静默 */ }
      }

      function buzz(ms) {
        try { if (navigator.vibrate) navigator.vibrate(ms); } catch (e) { /* ignore */ }
      }

      /* ================= 按钮按压工具 =================
         ⚠️ 长按连发的定时器存在「组件级注册表」里（按 key 索引），
         不能放在每次渲染新建的闭包里：落格会触发重渲染，Vue 会把 pointerup
         换成新函数，旧闭包里的 setInterval 就再也停不掉，表现为
         「按一下方向键 / 下键就疯狂连发」。                              */
      const holdTimers = new Map();   // key -> { t1, t2 }

      function setPressed(k, v) {
        const cur = pressed.value;
        if (!!cur[k] === !!v) return;
        const nxt = Object.assign({}, cur);
        if (v) nxt[k] = true; else delete nxt[k];
        pressed.value = nxt;
      }

      function stopHold(key) {
        const t = holdTimers.get(key);
        if (!t) return;
        if (t.t1) { clearTimeout(t.t1); t.t1 = 0; }
        if (t.t2) { clearInterval(t.t2); t.t2 = 0; }
        holdTimers.delete(key);
      }

      function startHold(key, fn, o) {
        stopHold(key);
        setPressed(key, true);
        fn();
        if (o.repeat === false) return;
        const entry = { t1: 0, t2: 0 };
        entry.t1 = setTimeout(() => {
          entry.t1 = 0;
          entry.t2 = setInterval(fn, o.rate || 60);
        }, o.delay == null ? 165 : o.delay);
        holdTimers.set(key, entry);
      }

      function endHold(key) {
        stopHold(key);
        setPressed(key, false);
      }

      /* 兜底：手指/鼠标在任何地方抬起、或窗口失焦，释放所有被按住的键 */
      function releaseAll() {
        if (!holdTimers.size && !Object.keys(pressed.value).length) return;
        holdTimers.forEach((t) => {
          if (t.t1) clearTimeout(t.t1);
          if (t.t2) clearInterval(t.t2);
        });
        holdTimers.clear();
        pressed.value = {};
      }

      function hold(fn, o) {
        o = o || {};
        const key = o.key;
        const start = (e) => {
          if (e) {
            if (e.preventDefault) e.preventDefault();
            if (e.stopPropagation) e.stopPropagation();
          }
          if (key) startHold(key, fn, o);
          else fn();
        };
        const end = () => { if (key) endHold(key); };
        return {
          onPointerdown: start,
          onPointerup: end,
          onPointerleave: end,
          onPointercancel: end,
          onContextmenu: (e) => e.preventDefault()
        };
      }

      /* ================= 游戏逻辑 ================= */
      function nextFromBag() {
        if (!bag.length) {
          bag = "IJLOSTZ".split("");
          for (let i = bag.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            const t = bag[i]; bag[i] = bag[j]; bag[j] = t;
          }
        }
        return bag.pop();
      }

      function rotateCW(m) {
        const n = m.length;
        const r = Array.from({ length: n }, () => new Array(n).fill(0));
        for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) r[x][n - 1 - y] = m[y][x];
        return r;
      }

      function collide(p, x, y, m) {
        x = x === undefined ? p.x : x;
        y = y === undefined ? p.y : y;
        m = m || p.m;
        for (let j = 0; j < m.length; j++) {
          for (let i = 0; i < m[j].length; i++) {
            if (!m[j][i]) continue;
            const bx = x + i, by = y + j;
            if (bx < 0 || bx >= COLS || by >= ROWS) return true;
            if (by >= 0 && grid.value[by][bx]) return true;
          }
        }
        return false;
      }

      function spawn() {
        const type = nextType.value || nextFromBag();
        nextType.value = nextFromBag();
        const m = SHAPES[type].map((r) => r.slice());
        const p = { type, m, x: Math.floor((COLS - m.length) / 2), y: type === "I" ? -1 : 0 };
        if (collide(p)) {
          piece.value = p;
          over.value = true;
          running.value = false;
          dropAcc = 0;
          releaseAll();
          beep(180, 0.16, "sawtooth", 0.06);
          setTimeout(() => beep(120, 0.28, "sawtooth", 0.06), 150);
          buzz(120);
          return;
        }
        piece.value = p;
      }

      function lock() {
        const p = piece.value;
        if (!p) return;
        p.m.forEach((row, j) => row.forEach((v, i) => {
          if (!v) return;
          const y = p.y + j, x = p.x + i;
          if (y >= 0 && y < ROWS && x >= 0 && x < COLS) grid.value[y][x] = p.type;
        }));

        let cleared = 0;
        for (let y = ROWS - 1; y >= 0; y--) {
          if (grid.value[y].every((c) => c)) {
            grid.value.splice(y, 1);
            grid.value.unshift(new Array(COLS).fill(""));
            cleared++;
            y++;
          }
        }

        if (cleared) {
          lines.value += cleared;
          score.value += [0, 100, 300, 500, 800][cleared] * level.value;
          level.value = Math.floor(lines.value / 10) + 1;
          flash = 1;
          shake = cleared >= 4 ? 7 : 4;
          beep(880, 0.07, "square", 0.05);
          setTimeout(() => beep(1180, 0.09, "square", 0.05), 70);
          if (cleared >= 4) setTimeout(() => beep(1480, 0.14, "square", 0.055), 150);
          buzz(cleared >= 4 ? [0, 40, 40, 90] : 35);
        } else {
          shake = 2;
          beep(150, 0.05, "triangle", 0.045);
        }
        spawn();
      }

      function move(dx) {
        const p = piece.value;
        if (!p || !running.value || over.value) return;
        if (!collide(p, p.x + dx, p.y)) {
          p.x += dx;
          beep(300, 0.02, "square", 0.025);
        }
      }

      function step() {
        const p = piece.value;
        if (!p || !running.value || over.value) return;
        if (!collide(p, p.x, p.y + 1)) { p.y++; score.value += 1; }
        else lock();
      }

      /* 软降一格：清掉重力累计，避免与自动下落叠加 */
      function softDrop() {
        if (!running.value || over.value) return;
        dropAcc = 0;
        step();
      }

      function hardDrop() {
        const p = piece.value;
        if (!p || !running.value || over.value) return;
        let d = 0;
        while (!collide(p, p.x, p.y + 1)) { p.y++; d++; }
        score.value += d * 2;
        dropAcc = 0;
        beep(520, 0.05, "sawtooth", 0.04);
        lock();
      }

      function rotate() {
        const p = piece.value;
        if (!p || !running.value || over.value) return;
        const m = rotateCW(p.m);
        for (const k of [0, -1, 1, -2, 2]) {
          if (!collide(p, p.x + k, p.y, m)) {
            p.m = m;
            p.x += k;
            beep(660, 0.035, "square", 0.04);
            return;
          }
        }
      }

      function reset() {
        releaseAll();
        grid.value = emptyGrid();
        score.value = 0;
        lines.value = 0;
        level.value = 1;
        over.value = false;
        piece.value = null;
        bag = [];
        dropAcc = 0;
        last = 0;
        shake = 0;
        flash = 0;
        nextType.value = nextFromBag();
        spawn();
      }

      function toggle() {
        if (over.value) { reset(); running.value = true; last = 0; beep(700, 0.06, "square", 0.05); return; }
        releaseAll();
        running.value = !running.value;
        dropAcc = 0;
        last = 0;
        beep(running.value ? 700 : 380, 0.06, "square", 0.05);
        buzz(20);
      }

      function restart() {
        reset();
        running.value = true;
        last = 0;
        beep(700, 0.06, "square", 0.05);
        buzz(25);
      }

      /* 键盘：空格 = 旋转；Enter = 直落 */
      function onKey(e) {
        const t = e.target;
        if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable)) return;
        const k = e.key;
        let handled = true;
        if (k === " " || k === "Spacebar" || k === "ArrowUp" || k === "w" || k === "W" || k === "x" || k === "X") rotate();
        else if (k === "ArrowLeft" || k === "a" || k === "A") move(-1);
        else if (k === "ArrowRight" || k === "d" || k === "D") move(1);
        else if (k === "ArrowDown" || k === "s" || k === "S") softDrop();
        else if (k === "Enter") hardDrop();
        else if (k === "p" || k === "P") toggle();
        else if (k === "r" || k === "R") restart();
        else handled = false;
        if (handled) e.preventDefault();
      }

      function onVisibility() {
        if (document.hidden) {
          if (running.value && !over.value) { running.value = false; hiddenPaused = true; }
          releaseAll();
        } else if (hiddenPaused) {
          hiddenPaused = false;
          running.value = true;
          last = 0;
          dropAcc = 0;
        }
      }

      /* ================= 触屏手势（棋盘区域） ================= */
      let ges = null;
      function gestureStart(e) {
        if (!e.touches || e.touches.length !== 1) { ges = null; return; }
        const t = e.touches[0];
        ges = { x: t.clientX, y: t.clientY, lx: t.clientX, ly: t.clientY, t: Date.now(), moved: false };
      }
      function gestureMove(e) {
        if (!ges || !e.touches || e.touches.length !== 1 || !running.value || over.value) return;
        const t = e.touches[0];
        const cell = L.value.cell;
        const stepH = Math.max(18, cell * 1.5);
        const dxAll = t.clientX - ges.x, dyAll = t.clientY - ges.y;
        if (Math.abs(dxAll) > 10 || Math.abs(dyAll) > 10) ges.moved = true;
        let dx = t.clientX - ges.lx;
        while (Math.abs(dx) >= stepH) {
          const s = dx > 0 ? 1 : -1;
          move(s);
          ges.lx += s * stepH;
          dx = t.clientX - ges.lx;
        }
        const stepV = Math.max(26, cell * 2);
        let dy = t.clientY - ges.ly;
        if (Math.abs(dy) >= stepV) {
          if (dy > 0) softDrop();
          ges.ly += (dy > 0 ? 1 : -1) * stepV;
        }
        if (e.cancelable) e.preventDefault();
      }
      function gestureEnd(e) {
        if (!ges) return;
        const dur = Date.now() - ges.t;
        const t = (e.changedTouches && e.changedTouches[0]) || null;
        if (t) {
          const dy = t.clientY - ges.y, dx = t.clientX - ges.x;
          if (dy > 64 && dur < 400) hardDrop();
          else if (!ges.moved && dur < 300 && Math.abs(dx) < 12 && Math.abs(dy) < 12) rotate();
        }
        ges = null;
      }
      function gestureCancel() { ges = null; }

      /* ================= 画布绘制 ================= */
      function roundRect(ctx, x, y, w, hh, r) {
        const rr = Math.max(0, Math.min(r, w / 2, hh / 2));
        ctx.beginPath();
        ctx.moveTo(x + rr, y);
        ctx.arcTo(x + w, y, x + w, y + hh, rr);
        ctx.arcTo(x + w, y + hh, x, y + hh, rr);
        ctx.arcTo(x, y + hh, x, y, rr);
        ctx.arcTo(x, y, x + w, y, rr);
        ctx.closePath();
      }

      function draw() {
        const cvs = canvasEl.value;
        if (!cvs) return;
        const cs = L.value.cell;
        const W = cs * COLS, H = cs * ROWS;
        const dpr = Math.min(3, window.devicePixelRatio || 1);
        const pw = Math.round(W * dpr), ph = Math.round(H * dpr);
        if (cvs.width !== pw || cvs.height !== ph) { cvs.width = pw; cvs.height = ph; }
        const ctx = cvs.getContext("2d");
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        ctx.clearRect(0, 0, W, H);
        ctx.fillStyle = "#050810";
        ctx.fillRect(0, 0, W, H);

        ctx.strokeStyle = "rgba(120,200,255,0.07)";
        ctx.lineWidth = 1;
        for (let x = 1; x < COLS; x++) {
          ctx.beginPath(); ctx.moveTo(x * cs + 0.5, 0); ctx.lineTo(x * cs + 0.5, H); ctx.stroke();
        }
        for (let y = 1; y < ROWS; y++) {
          ctx.beginPath(); ctx.moveTo(0, y * cs + 0.5); ctx.lineTo(W, y * cs + 0.5); ctx.stroke();
        }

        const gap = Math.max(1, cs * 0.08 + 0.6);
        const rad = Math.max(2, cs * 0.2);

        function paint(x, y, type) {
          const bx = x * cs + gap / 2, by = y * cs + gap / 2, sz = cs - gap;
          roundRect(ctx, bx, by, sz, sz, rad);
          ctx.fillStyle = COLORS[type] || "#8aa";
          ctx.fill();
          const gg = ctx.createLinearGradient(bx, by, bx, by + sz);
          gg.addColorStop(0, "rgba(255,255,255,0.38)");
          gg.addColorStop(0.5, "rgba(255,255,255,0.06)");
          gg.addColorStop(1, "rgba(0,0,0,0.32)");
          roundRect(ctx, bx, by, sz, sz, rad);
          ctx.fillStyle = gg;
          ctx.fill();
          ctx.strokeStyle = "rgba(0,0,0,0.45)";
          ctx.lineWidth = 1;
          roundRect(ctx, bx + 0.5, by + 0.5, sz - 1, sz - 1, rad);
          ctx.stroke();
        }

        const p = piece.value;
        if (p && running.value && !over.value) {
          let gy = p.y;
          while (!collide(p, p.x, gy + 1)) gy++;
          ctx.save();
          ctx.globalAlpha = 0.22;
          p.m.forEach((row, j) => row.forEach((v, i) => {
            if (!v) return;
            const y = gy + j, x = p.x + i;
            if (y < 0 || y >= ROWS || x < 0 || x >= COLS) return;
            roundRect(ctx, x * cs + gap / 2, y * cs + gap / 2, cs - gap, cs - gap, rad);
            ctx.fillStyle = COLORS[p.type];
            ctx.fill();
          }));
          ctx.restore();
        }

        for (let y = 0; y < ROWS; y++) {
          for (let x = 0; x < COLS; x++) {
            const t = grid.value[y][x];
            if (t) paint(x, y, t);
          }
        }

        if (p) {
          p.m.forEach((row, j) => row.forEach((v, i) => {
            if (!v) return;
            const y = p.y + j, x = p.x + i;
            if (y < 0 || y >= ROWS || x < 0 || x >= COLS) return;
            paint(x, y, p.type);
          }));
        }
      }

      /* ================= 主循环 ================= */
      function frame(t) {
        if (!alive) return;
        raf = requestAnimationFrame(frame);
        if (!last) last = t;
        const dt = Math.min(100, Math.max(0, t - last));
        last = t;

        if (flash > 0) {
          flash = Math.max(0, flash - dt / 240);
          if (flashEl.value) flashEl.value.style.opacity = String(flash * 0.45);
        }
        if (shake > 0) shake = Math.max(0, shake - dt * 0.05);
        const bd = boardEl.value;
        if (bd) {
          if (shake > 0.3) {
            bd.style.transform = "translate(" + ((Math.random() - 0.5) * shake).toFixed(2) + "px," +
              ((Math.random() - 0.5) * shake).toFixed(2) + "px)";
          } else if (bd.style.transform) {
            bd.style.transform = "translate(0,0)";
          }
        }

        if (document.hidden) { dropAcc = 0; draw(); return; }
        if (running.value && !over.value) {
          /* 每帧最多自动下落一格；软降会自行清零 dropAcc，两者不叠加 */
          const speed = Math.max(90, 820 - (level.value - 1) * 68);
          dropAcc = Math.min(dropAcc + dt, speed);
          if (dropAcc >= speed) { dropAcc = 0; step(); }
        }
        draw();
      }

      /* ================= 控件 ================= */
      function keyBtn(label, action, opts) {
        opts = opts || {};
        const k = opts.key || String(label);
        const on = !!pressed.value[k];
        const style = Object.assign({
          display: "flex", alignItems: "center", justifyContent: "center",
          padding: "0", margin: "0",
          border: "1px solid rgba(255,255,255,0.14)",
          borderRadius: "12px",
          background: "linear-gradient(180deg, #3d4a60, #1d2534)",
          color: "#e9f2ff",
          fontFamily: MONO, fontWeight: "700", fontSize: "14px",
          cursor: "pointer", touchAction: "none",
          userSelect: "none", WebkitUserSelect: "none",
          WebkitTapHighlightColor: "transparent", outline: "none",
          transition: "transform 80ms ease, filter 80ms ease, box-shadow 80ms ease",
          transform: on ? "scale(0.94)" : "scale(1)",
          filter: on ? "brightness(0.88)" : "none",
          boxShadow: on
            ? "inset 0 3px 10px rgba(0,0,0,0.65)"
            : "0 4px 10px rgba(0,0,0,0.42), inset 0 1px 0 rgba(255,255,255,0.16)"
        }, opts.style || {});
        const handlers = hold(action, { key: k, delay: opts.delay, rate: opts.rate, repeat: opts.repeat });
        return h("button", Object.assign({ type: "button", tabIndex: -1, style: style }, handlers), [
          h("span", { style: { pointerEvents: "none", textShadow: "0 1px 0 rgba(0,0,0,0.5)" } }, label)
        ]);
      }

      /* 十字键的单个方向块：半透明键帽，由底层十字形状承托 */
      function padBtn(label, action, area, o, size) {
        o = o || {};
        const k = o.key || label;
        const on = !!pressed.value[k];
        const handlers = hold(action, { key: k, delay: o.delay, rate: o.rate, repeat: o.repeat });
        return h("button", Object.assign({
          type: "button", tabIndex: -1,
          "aria-label": label,
          style: {
            gridArea: area, width: "100%", height: "100%",
            display: "flex", alignItems: "center", justifyContent: "center",
            padding: "0", margin: "0",
            border: "1px solid rgba(255,255,255,0.10)",
            borderRadius: "12px",
            background: on ? "rgba(120,215,255,0.32)" : "rgba(255,255,255,0.05)",
            color: on ? "#eaffff" : "#dbe7f7",
            fontFamily: MONO, fontWeight: "700",
            fontSize: Math.max(8, Math.round(size * 0.2)) + "px",
            cursor: "pointer", touchAction: "none",
            userSelect: "none", WebkitUserSelect: "none",
            WebkitTapHighlightColor: "transparent", outline: "none",
            transition: "background 70ms ease, transform 70ms ease, box-shadow 70ms ease",
            transform: on ? "scale(0.93)" : "scale(1)",
            textShadow: on ? "0 0 10px rgba(140,230,255,0.9)" : "0 1px 0 rgba(0,0,0,0.5)",
            boxShadow: on
              ? "inset 0 3px 10px rgba(0,0,0,0.6)"
              : "0 2px 6px rgba(0,0,0,0.35), inset 0 1px 0 rgba(255,255,255,0.12)"
          }
        }, handlers), [h("span", { style: { pointerEvents: "none" } }, label)]);
      }

      /* A / B 小圆键 */
      function circleBtn(letter, sub, action, key, c1, c2, size) {
        return keyBtn(
          h("span", {
            style: { display: "flex", flexDirection: "column", alignItems: "center", lineHeight: "1" }
          }, [
            h("span", { style: { fontSize: Math.round(size * 0.3) + "px", fontWeight: "700" } }, letter),
            h("span", {
              style: {
                fontSize: Math.max(7, Math.round(size * 0.145)) + "px",
                opacity: "0.85", marginTop: "2px", letterSpacing: "0.5px"
              }
            }, sub)
          ]),
          action,
          {
            key: key,
            style: {
              width: size + "px", height: size + "px", flex: "0 0 auto",
              borderRadius: "50%",
              background: "radial-gradient(circle at 34% 28%, " + c1 + ", " + c2 + ")",
              border: "1px solid rgba(255,255,255,0.28)",
              color: "#12161f"
            }
          }
        );
      }

      function pill(label, action, key, o) {
        o = o || {};
        return keyBtn(label, action, {
          key: key, repeat: false,
          style: Object.assign({
            flex: "1 1 0", minWidth: "0",
            height: "100%", boxSizing: "border-box", borderRadius: "17px",
            fontSize: isTouch ? "11px" : "10px", letterSpacing: "0.6px", whiteSpace: "nowrap",
            background: "linear-gradient(180deg,#2f3a4d,#1b222e)",
            color: "#cfdcf0"
          }, o.style || {})
        });
      }

      function statBox(label, value, color, sizes) {
        return h("div", { style: { minWidth: "30px", display: "flex", flexDirection: "column", gap: "1px" } }, [
          h("div", {
            style: { fontSize: sizes.label + "px", color: "#6d7d93", letterSpacing: "1px", whiteSpace: "nowrap" }
          }, label),
          h("div", {
            style: {
              fontSize: sizes.value + "px", fontWeight: "700", lineHeight: "1.15",
              color: color || "#7fe3ff",
              textShadow: "0 0 8px rgba(63,224,255,0.4)",
              overflow: "hidden", textOverflow: "ellipsis"
            }
          }, String(value))
        ]);
      }

      function previewBox(cellSize) {
        const type = nextType.value;
        const m = SHAPES[type] || SHAPES.I;
        const n = m.length;
        const pc = clamp(Math.round(cellSize), 4, 12);
        const cells = [];
        for (let y = 0; y < n; y++) {
          for (let x = 0; x < n; x++) {
            const on = m[y] && m[y][x];
            cells.push(h("div", {
              key: "p" + y + "-" + x,
              style: {
                width: pc + "px", height: pc + "px", borderRadius: "2px",
                background: on ? COLORS[type] : "rgba(255,255,255,0.055)",
                boxShadow: on ? "inset 0 0 0 1px rgba(0,0,0,0.3)" : "none"
              }
            }));
          }
        }
        return h("div", {
          style: {
            padding: "3px", borderRadius: "6px",
            background: "rgba(10,18,30,0.92)",
            border: "1px solid rgba(120,190,255,0.14)",
            display: "grid",
            gridTemplateColumns: "repeat(" + n + ", " + pc + "px)",
            gap: "2px"
          }
        }, cells);
      }

      /* ================= 生命周期 ================= */
      onMounted(() => {
        alive = true;
        pickAvail();
        window.addEventListener("keydown", onKey, { passive: false });
        window.addEventListener("resize", pickAvail);
        window.addEventListener("orientationchange", pickAvail);
        document.addEventListener("visibilitychange", onVisibility);
        window.addEventListener("pointerup", releaseAll);
        window.addEventListener("pointercancel", releaseAll);
        window.addEventListener("blur", releaseAll);

        const host = rootEl.value && rootEl.value.parentElement;
        if (typeof ResizeObserver !== "undefined" && host) {
          ro = new ResizeObserver(() => pickAvail());
          ro.observe(host);
        }

        reset();
        running.value = true;
        last = 0;
        raf = requestAnimationFrame(frame);
        setTimeout(() => { pickAvail(); draw(); }, 80);
      });

      onUnmounted(() => {
        alive = false;
        if (raf) cancelAnimationFrame(raf);
        raf = 0;
        releaseAll();
        window.removeEventListener("keydown", onKey);
        window.removeEventListener("resize", pickAvail);
        window.removeEventListener("orientationchange", pickAvail);
        document.removeEventListener("visibilitychange", onVisibility);
        window.removeEventListener("pointerup", releaseAll);
        window.removeEventListener("pointercancel", releaseAll);
        window.removeEventListener("blur", releaseAll);
        if (ro) { ro.disconnect(); ro = null; }
        if (ac && ac.close) { try { ac.close(); } catch (e) { /* ignore */ } ac = null; }
      });

      /* ================= 视图片段 ================= */
      /* ① 状态条：SCORE · LINES · LV …… NEXT */
      function hudView() {
        const s = L.value;
        const label = clamp(Math.round(s.cell * 0.55), 7, 9);
        const value = clamp(Math.round(s.cell * 0.85), 10, 14);

        return h("div", {
          style: {
            width: px(s.boardW), height: px(s.hudH), flex: "0 0 auto", boxSizing: "border-box",
            display: "flex", alignItems: "center", justifyContent: "space-between",
            gap: "8px", padding: "0 4px", fontFamily: MONO
          }
        }, [
          h("div", { style: { display: "flex", alignItems: "center", gap: "8px", minWidth: "0" } }, [
            h("span", {
              style: {
                width: "6px", height: "6px", borderRadius: "50%", flex: "0 0 auto",
                background: over.value ? "#ff5c6c" : (running.value ? "#48f08a" : "#8a94a6"),
                boxShadow: (running.value && !over.value) ? "0 0 8px #48f08a" : "none"
              }
            }),
            statBox("SCORE", score.value, "#7fe3ff", { label, value }),
            statBox("LINES", lines.value, "#ffd93d", { label, value }),
            statBox("LV", level.value, "#3ddc84", { label, value })
          ]),
          h("div", { style: { display: "flex", alignItems: "center", gap: "4px", flex: "0 0 auto" } }, [
            h("span", { style: { fontSize: label + "px", color: "#6d7d93", letterSpacing: "1px" } }, "NEXT"),
            previewBox(clamp(Math.round(s.cell * 0.46), 4, 9))
          ])
        ]);
      }

      /* ② 棋盘 */
      function boardView() {
        const s = L.value;
        const bw = s.cell * COLS, bh = s.cell * ROWS;

        const canvas = h("canvas", {
          ref: canvasEl,
          style: { display: "block", width: px(bw), height: px(bh), borderRadius: "8px" }
        });

        const fx = (z, style) => h("div", {
          style: Object.assign({
            position: "absolute", inset: "0", zIndex: String(z), pointerEvents: "none", borderRadius: "8px"
          }, style)
        });
        const scanlines = fx(2, {
          backgroundImage: "repeating-linear-gradient(to bottom, rgba(255,255,255,0.05) 0px, rgba(255,255,255,0.05) 1px, transparent 1px, transparent 3px)"
        });
        const vignette = fx(3, {
          background: "radial-gradient(120% 90% at 50% 50%, transparent 58%, rgba(0,0,0,0.38) 100%)"
        });
        const flashLayer = h("div", {
          ref: flashEl,
          style: {
            position: "absolute", inset: "0", zIndex: "4", pointerEvents: "none",
            borderRadius: "8px", background: "#dff6ff", opacity: "0"
          }
        });

        const overlayText = over.value ? "GAME OVER" : (running.value ? "" : "PAUSED");
        const overlay = overlayText ? h("div", {
          onPointerdown: (e) => { e.preventDefault(); e.stopPropagation(); toggle(); },
          style: {
            position: "absolute", inset: "0", zIndex: "5", borderRadius: "8px",
            display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center",
            gap: "6px", cursor: "pointer", background: "rgba(4,9,16,0.76)",
            fontFamily: MONO, touchAction: "none", userSelect: "none", WebkitUserSelect: "none"
          }
        }, [
          h("div", {
            style: {
              fontSize: "14px", fontWeight: "700", letterSpacing: "3px",
              color: over.value ? "#ff8a95" : "#7fe3ff",
              textShadow: over.value ? "0 0 14px rgba(255,92,108,0.6)" : "0 0 14px rgba(63,224,255,0.6)"
            }
          }, overlayText),
          h("div", { style: { fontSize: "9px", color: "#9fb2c8", letterSpacing: "1px" } },
            over.value ? ("SCORE " + score.value + " · 点击重开") : "点击继续")
        ]) : null;

        const gestureProps = isTouch ? {
          onTouchstart: gestureStart,
          onTouchmove: gestureMove,
          onTouchend: gestureEnd,
          onTouchcancel: gestureCancel
        } : {};

        return h("div", Object.assign({
          ref: boardEl,
          style: {
            position: "relative", flex: "0 0 auto", lineHeight: "0",
            willChange: "transform", transform: "translate(0,0)", borderRadius: "8px",
            touchAction: "none",
            boxShadow: "0 0 20px rgba(63,224,255,0.13), 0 0 0 1px rgba(120,190,255,0.16)"
          }
        }, gestureProps), [canvas, scanlines, vignette, flashLayer, overlay]);
      }

      /* ③ 十字方向键 */
      function dpadView() {
        const s = L.value;
        const arm = Math.max(4, Math.round(s.dpad * 0.33));

        const barStyle = {
          position: "absolute", left: "50%", top: "50%",
          transform: "translate(-50%,-50%)",
          background: "rgba(110,175,255,0.08)",
          borderRadius: px(arm / 2)
        };

        const crossBg = h("div", {
          style: {
            position: "absolute", inset: "0", pointerEvents: "none",
            borderRadius: "18px",
            background: "linear-gradient(180deg, rgba(255,255,255,0.05), rgba(0,0,0,0.26))",
            boxShadow: "inset 0 1px 0 rgba(255,255,255,0.08)"
          }
        }, [
          h("span", { style: Object.assign({ width: px(arm), height: "74%" }, barStyle) }),
          h("span", { style: Object.assign({ width: "74%", height: px(arm) }, barStyle) })
        ]);

        const centerDot = h("div", {
          style: {
            gridArea: "2 / 2 / 3 / 3", borderRadius: "50%",
            background: "rgba(0,0,0,0.28)",
            boxShadow: "inset 0 1px 3px rgba(0,0,0,0.65)"
          }
        });

        return h("div", {
          style: {
            position: "relative", flex: "0 0 auto",
            display: "grid",
            /* minmax(0,1fr)：1fr 实为 minmax(auto,1fr)，auto 最小值会被按钮
               内容（字号）撑高 → ▼ 溢出 dpad 盒压到功能键行。锁死 0 下限 */
            gridTemplateColumns: "repeat(3, minmax(0, 1fr))",
            gridTemplateRows: "repeat(3, minmax(0, 1fr))",
            gap: Math.max(4, Math.round(s.dpad * 0.04)) + "px",
            width: px(s.dpad), height: px(s.dpad),
            padding: "7px", boxSizing: "border-box"
          }
        }, [
          crossBg,
          padBtn("▲", () => rotate(), "1 / 2 / 2 / 3", { key: "up", repeat: false }, s.dpad),
          padBtn("◀", () => move(-1), "2 / 1 / 3 / 2", { key: "left", delay: 170, rate: 90 }, s.dpad),
          padBtn("▶", () => move(1), "2 / 3 / 3 / 4", { key: "right", delay: 170, rate: 90 }, s.dpad),
          padBtn("▼", () => softDrop(), "3 / 2 / 4 / 3", { key: "down", delay: 150, rate: 80 }, s.dpad),
          centerDot
        ]);
      }

      /* ③ A / B 圆键（B 直落 在左，A 旋转 在右） */
      function actionsView() {
        const s = L.value;
        return h("div", {
          style: {
            display: "flex", alignItems: "center", justifyContent: "flex-end",
            gap: px(s.abGap), flex: "0 0 auto"
          }
        }, [
          circleBtn("B", "直落", () => hardDrop(), "btnB", "#8fd8ff", "#2f8fd6", s.circle),
          circleBtn("A", "旋转", () => rotate(), "btnA", "#ffd07a", "#e0703a", s.circle)
        ]);
      }

      /* ④ 功能键 */
      function pillsView() {
        const s = L.value;
        return h("div", {
          style: {
            display: "flex", alignItems: "stretch", gap: "8px",
            flex: "0 0 auto", flexShrink: 0,
            width: px(s.rowW), maxWidth: "100%",
            height: px(s.pillsH), minHeight: px(s.pillsH),
            boxSizing: "border-box"
          }
        }, [
          pill("↺ RESET", () => restart(), "btnReset"),
          pill(running.value ? "⏸ PAUSE" : "▶ START", () => toggle(), "btnToggle", {
            style: running.value
              ? { background: "linear-gradient(180deg,#4a3a2a,#2a2118)", color: "#ffcf90" }
              : { background: "linear-gradient(180deg,#1f4a3a,#132a22)", color: "#a8f0c8" }
          }),
          pill(soundOn.value ? "🔊 ON" : "🔇 OFF", () => {
            soundOn.value = !soundOn.value;
            if (soundOn.value) beep(760, 0.06, "square", 0.05);
          }, "btnSound")
        ]);
      }

      /* ================= 渲染 ================= */
      return () => {
        const s = L.value;

        const screen = h("div", {
          style: { flex: "0 0 auto", display: "flex", flexDirection: "column", alignItems: "center", gap: "4px" }
        }, [hudView(), boardView()]);

        const controls = h("div", {
          style: {
            flex: "0 0 auto", width: px(s.rowW), maxWidth: "100%",
            height: px(s.rowH), minHeight: px(s.rowH), flexShrink: 0,
            display: "flex", alignItems: "center", justifyContent: "space-between",
            gap: px(s.minGap), boxSizing: "border-box",
            marginTop: px(s.rowGap - s.gap)
          }
        }, [dpadView(), actionsView()]);

        const column = h("div", {
          style: {
            display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center",
            gap: px(s.gap), width: "100%", height: "100%", minHeight: "0", boxSizing: "border-box"
          }
        }, [screen, controls, pillsView()]);

        return h("div", Object.assign({
          ref: rootEl,
          onContextmenu: (e) => e.preventDefault(),
          style: {
            height: px(s.h), maxHeight: px(s.h), width: "100%",
            boxSizing: "border-box", overflow: "hidden",
            display: "flex", alignItems: "center", justifyContent: "center",
            padding: px(s.pad),
            background: "radial-gradient(900px 520px at 50% 0%, rgba(56,189,248,0.10), transparent 65%), linear-gradient(180deg, #080c14 0%, #04060b 100%)",
            fontFamily: "system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif",
            userSelect: "none", WebkitUserSelect: "none",
            WebkitTapHighlightColor: "transparent",
            overscrollBehavior: "contain",
            touchAction: "manipulation"
          }
        }), [column]);
      };
    }
  };

  registerApp({
    id: "tetris",
    title: "俄罗斯方块",
    icon: "gamepad-2",
    route: "/tetris",
    order: 60,
    component: App
  });
}
