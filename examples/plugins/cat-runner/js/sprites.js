import { CAT_3D_RUN, CAT_3D_PALETTE, CAT_3D_FOOT_PAD } from './catFrames.js';

/* =========================================================
 * sprites.js — 全部像素贴图：字符画 + 程序化像素图，启动时烘焙
 * ========================================================= */

const CAT_PAL = {
  K: '#93a1b1',
  W: '#ffffff',
  P: '#ffb3c6',
  E: '#38c98c',
  N: '#ff8fa5'
};

const CAT_RUN = [
  [
    '..............K.....K...',
    '.............KPK...KPK..',
    '............KWWK.KWWK...',
    '...........KWWWWWWWWK...',
    '..........KWWWWWWWWWWWK.',
    '.........KWWWWWWWWWWWWEK',
    '........KWWWWWWWWWWWWEK.',
    '.........KWWWWWWWWWWWNK.',
    '....KKKKKWWWWWWWWWWWWK..',
    '...KWWWWWWWWWWWWWWWWK...',
    '..KWWWWWWWWWWWWWWWWWK...',
    '..KWWWWWWWWWWWWWWWWK....',
    '..KWWKKWWWWKKWWWWWK.....',
    '..KWWK....KWWK...KWWK...',
    '..KKK.....KKKK....KKK...'
  ],
  [
    '..............K.....K...',
    '.............KPK...KPK..',
    '............KWWK.KWWK...',
    '...........KWWWWWWWWK...',
    '..........KWWWWWWWWWWK..',
    '.........KWWWWWWWWWWWEK.',
    '........KWWWWWWWWWWWWEK.',
    '.......KWWWWWWWWWWWWNK..',
    '....KKKKWWWWWWWWWWWWWK..',
    '...KWWWWWWWWWWWWWWWWK...',
    '..KWWWWWWWWWWWWWWWWK....',
    '..KWWKKWWWWWWWWKKWWK....',
    '..KWWK..KWWK..KWWK......',
    '..KKK...KKKK..KKKK......',
    '........................'
  ],
  [
    '...........K.....K......',
    '..........KPK...KPK.....',
    '.........KWWK.KWWK......',
    '........KWWWWWWWWK......',
    '.......KWWWWWWWWWWWK....',
    '......KWWWWWWWWWWWWEK...',
    '.....KWWWWWWWWWWWWEK....',
    '......KWWWWWWWWWWWNK....',
    '...KKKKWWWWWWWWWWWWWK...',
    '..KWWWWWWWWWWWWWWWWWK...',
    '.KWWWWWWWWWWWWWWWWWWK...',
    '.KWWWWWWWWWWWWWWWWWK....',
    '.KWWKKWWWWKKWWWWWWK.....',
    '.KWWK...KWWK...KWWK.....',
    '.KKK....KKKK...KKKK.....'
  ]
];

const CAT_JUMP = [
  '..............K.....K...',
  '.............KPK...KPK..',
  '............KWWK.KWWK...',
  '...........KWWWWWWWWK...',
  '..........KWWWWWWWWWWK..',
  '.........KWWWWWWWWWWWEK.',
  '........KWWWWWWWWWWWWEK.',
  '.......KWWWWWWWWWWWWNK..',
  '....KKKKWWWWWWWWWWWWWK..',
  '...KWWWWWWWWWWWWWWWWK...',
  '..KWWWWWWWWWWWWWWWWK....',
  '..KWWK...KWWK....KWWK...',
  '.KWWK.....KWWK....KWWK..',
  'KWWK.......KKK.....KWWK.',
  'KKK.................KKK.'
];

const CAT_SLIDE = [
  '........................',
  '..............K.....K...',
  '.............KPK...KPK..',
  '............KWWK.KWWK...',
  '...........KWWWWWWWWK...',
  '.KKKK.....KWWWWWWWWWWEK.',
  'KWWWWKKKKKWWWWWWWWWWWWNK',
  '.KWWWWWWWWWWWWWWWWWWWWK.',
  '..KKKKKKKKKKKKKKKKKKKKK.'
];

const CAT_TAIL = [
  [[5, 9], [3, 8], [1.5, 6], [1, 4], [2, 2.6], [3.6, 2]],
  [[5, 9], [3, 8], [1.5, 7], [1, 5.5], [1.6, 4], [3, 3.6]],
  [[5, 9], [3, 9], [1.4, 8.4], [0.8, 7], [1, 5.4], [2.2, 5]]
];

function cv(w, h) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const g = c.getContext('2d');
  g.imageSmoothingEnabled = false;
  return { c, g };
}

function upscale(src, scale) {
  const { c, g } = cv(src.width * scale, src.height * scale);
  g.imageSmoothingEnabled = false;
  g.drawImage(src, 0, 0, c.width, c.height);
  return c;
}

function artCanvas(rows, pal) {
  const w = Math.max(...rows.map(r => r.length));
  const h = rows.length;
  const { c, g } = cv(w, h);
  rows.forEach((row, y) => {
    for (let x = 0; x < row.length; x++) {
      const ch = row[x];
      if (ch === '.' || ch === ' ') continue;
      g.fillStyle = pal[ch] || '#ff00ff';
      g.fillRect(x, y, 1, 1);
    }
  });
  return c;
}

function drawTail(g, pts) {
  const dots = [];
  for (let i = 0; i < pts.length - 1; i++) {
    const [x0, y0] = pts[i];
    const [x1, y1] = pts[i + 1];
    const n = Math.max(1, Math.ceil(Math.hypot(x1 - x0, y1 - y0) * 2));
    for (let j = 0; j <= n; j++) {
      const t = j / n;
      dots.push([x0 + (x1 - x0) * t, y0 + (y1 - y0) * t]);
    }
  }
  g.fillStyle = CAT_PAL.K;
  dots.forEach(([x, y]) => g.fillRect(Math.round(x - 1), Math.round(y - 1), 4, 4));
  g.fillStyle = CAT_PAL.W;
  dots.forEach(([x, y]) => g.fillRect(Math.round(x - 0.5), Math.round(y - 0.5), 2, 2));
}

function bakeCat(rows, tailPts, px) {
  const w = 24;
  const h = rows.length;
  const { c, g } = cv(w, h);
  drawTail(g, tailPts);
  g.drawImage(artCanvas(rows, CAT_PAL), 0, 0);
  return upscale(c, px);
}

/* ---------- 白猫：像素椭圆/线条程序化烘焙，轮廓更清晰 ---------- */
function pixEllipse(g, cx, cy, rx, ry, color) {
  g.fillStyle = color;
  for (let y = -ry; y <= ry; y++) {
    const w = Math.round(rx * Math.sqrt(Math.max(0, 1 - (y * y) / (ry * ry))));
    g.fillRect(Math.round(cx) - w, Math.round(cy) + y, w * 2 + 1, 1);
  }
}

function pixLine(g, pts, width, color) {
  g.fillStyle = color;
  const off = Math.floor(width / 2);
  for (let i = 0; i < pts.length - 1; i++) {
    const [x0, y0] = pts[i];
    const [x1, y1] = pts[i + 1];
    const n = Math.max(1, Math.ceil(Math.hypot(x1 - x0, y1 - y0) * 2));
    for (let j = 0; j <= n; j++) {
      const t = j / n;
      g.fillRect(Math.round(x0 + (x1 - x0) * t) - off, Math.round(y0 + (y1 - y0) * t) - off, width, width);
    }
  }
}

function pixTri(g, a, b, c, color) {
  g.fillStyle = color;
  const minX = Math.floor(Math.min(a[0], b[0], c[0]));
  const maxX = Math.ceil(Math.max(a[0], b[0], c[0]));
  const minY = Math.floor(Math.min(a[1], b[1], c[1]));
  const maxY = Math.ceil(Math.max(a[1], b[1], c[1]));
  const sign = (p, q, r) => (p[0] - r[0]) * (q[1] - r[1]) - (q[0] - r[0]) * (p[1] - r[1]);
  for (let y = minY; y <= maxY; y++) {
    for (let x = minX; x <= maxX; x++) {
      const p = [x + 0.5, y + 0.5];
      const d1 = sign(p, a, b);
      const d2 = sign(p, b, c);
      const d3 = sign(p, c, a);
      const neg = d1 < 0 || d2 < 0 || d3 < 0;
      const pos = d1 > 0 || d2 > 0 || d3 > 0;
      if (!(neg && pos)) g.fillRect(x, y, 1, 1);
    }
  }
}

const OUTLINE = '#93a1b1';
const WHITE = '#ffffff';
const SHADE = '#e6edf5';
const PINK = '#ffb3c6';
const GREEN = '#38c98c';
const EYE_DARK = '#1a5f47';
const FAR_OUTLINE = '#a9b6c6';
const FAR_FILL = '#dbe4f0';

// Catmull-Rom 重采样，让尾巴走真正的 S 曲线而不是折线
function curvePts(pts, seg = 6) {
  const p = [pts[0], ...pts, pts[pts.length - 1]];
  const out = [];
  for (let i = 1; i < p.length - 2; i++) {
    const a = p[i - 1], b = p[i], c = p[i + 1], d = p[i + 2];
    for (let j = 0; j < seg; j++) {
      const t = j / seg, t2 = t * t, t3 = t2 * t;
      const f = (k) => 0.5 * (2 * b[k] + (-a[k] + c[k]) * t +
        (2 * a[k] - 5 * b[k] + 4 * c[k] - d[k]) * t2 +
        (-a[k] + 3 * b[k] - 3 * c[k] + d[k]) * t3);
      out.push([f(0), f(1)]);
    }
  }
  out.push(pts[pts.length - 1]);
  return out;
}

function drawCatPose(g, pose) {
  const { bx, by, brx, bry, hx, hy, hr, legsNear, legsFar, tail, earsBack } = pose;

  // 尾巴（先画，压在身体后）：根部粗、尖端细，S 曲线更清楚
  const tailPath = curvePts(tail, 7);
  pixLine(g, tailPath, 4, OUTLINE);
  pixLine(g, tailPath, 2, WHITE);

  // 远侧两条腿：颜色压暗，制造前后错位
  for (const leg of legsFar) {
    pixLine(g, [leg.slice(0, 2), leg.slice(2, 4)], 4, FAR_OUTLINE);
    pixLine(g, [leg.slice(0, 2), leg.slice(2, 4)], 2, FAR_FILL);
  }

  // 近侧两条腿
  for (const leg of legsNear) {
    pixLine(g, [leg.slice(0, 2), leg.slice(2, 4)], 4, OUTLINE);
    pixLine(g, [leg.slice(0, 2), leg.slice(2, 4)], 2, WHITE);
  }

  // 身体
  pixEllipse(g, bx, by, brx + 1, bry + 1, OUTLINE);
  pixEllipse(g, bx, by, brx, bry, WHITE);
  pixEllipse(g, bx, by + 2, brx - 3, Math.max(1, bry - 3), SHADE);

  // 耳朵（在头后面）
  if (earsBack) {
    pixTri(g, [hx - 8, hy + 4], [hx - 2, hy + 2], [hx - 5, hy - 3], OUTLINE);
    pixTri(g, [hx + 1, hy - 2], [hx + 7, hy + 2], [hx + 3, hy + 4], OUTLINE);
    pixTri(g, [hx - 6, hy + 3], [hx - 3, hy + 2], [hx - 5, hy - 1], PINK);
    pixTri(g, [hx + 2, hy - 1], [hx + 5, hy + 2], [hx + 3, hy + 3], PINK);
  } else {
    pixTri(g, [hx - 8, hy - 2], [hx - 1, hy - 4], [hx - 5, hy - 11], OUTLINE);
    pixTri(g, [hx + 1, hy - 5], [hx + 8, hy - 2], [hx + 4, hy - 11], OUTLINE);
    pixTri(g, [hx - 6, hy - 3], [hx - 2, hy - 4], [hx - 5, hy - 8], PINK);
    pixTri(g, [hx + 2, hy - 4], [hx + 6, hy - 3], [hx + 4, hy - 8], PINK);
  }

  // 头
  pixEllipse(g, hx, hy, hr + 1, hr + 1, OUTLINE);
  pixEllipse(g, hx, hy, hr, hr, WHITE);
  pixEllipse(g, hx - 2, hy - 2, hr - 3, hr - 4, WHITE);

  // 眼睛
  g.fillStyle = GREEN;
  g.fillRect(hx + 3, hy - 2, 3, 3);
  g.fillStyle = EYE_DARK;
  g.fillRect(hx + 4, hy - 1, 2, 2);
  g.fillStyle = '#c9ffe6';
  g.fillRect(hx + 3, hy - 2, 1, 1);

  // 鼻子 / 嘴 / 胡须
  g.fillStyle = PINK;
  g.fillRect(hx + hr - 1, hy + 2, 2, 2);
  g.fillStyle = OUTLINE;
  g.fillRect(hx + hr - 1, hy + 4, 3, 1);
  g.fillRect(hx + 3, hy + 4, 2, 1);
  g.fillStyle = '#b9c4cf';
  g.fillRect(hx + hr - 2, hy + 4, 5, 1);
  g.fillRect(hx + hr - 4, hy + 6, 6, 1);
}

const CAT_POSES = {
  run: [
    {
      bx: 21, by: 16, brx: 13, bry: 6, hx: 36, hy: 10, hr: 7,
      legsNear: [[34, 19, 41, 28], [13, 19, 6, 27]],
      legsFar: [[30, 20, 30, 27], [16, 20, 18, 28]],
      tail: [[10, 18], [6, 19], [3, 15], [2, 10], [4, 5], [7, 2]]
    },
    {
      bx: 22, by: 17, brx: 10, bry: 6, hx: 36, hy: 10, hr: 7,
      legsNear: [[33, 21, 33, 27], [17, 21, 22, 28]],
      legsFar: [[31, 21, 38, 26], [14, 21, 8, 26]],
      tail: [[11, 18], [7, 20], [4, 16], [3, 11], [5, 6], [8, 3]]
    },
    {
      bx: 22, by: 15, brx: 12, bry: 6, hx: 37, hy: 10, hr: 7,
      legsNear: [[34, 18, 42, 27], [13, 18, 5, 26]],
      legsFar: [[30, 19, 31, 26], [17, 19, 19, 28]],
      tail: [[10, 17], [6, 18], [3, 14], [2, 9], [4, 4], [7, 1]]
    }
  ],
  jump: {
    bx: 21, by: 15, brx: 13, bry: 5, hx: 36, hy: 9, hr: 7,
    legsNear: [[34, 19, 43, 20], [13, 18, 3, 24]],
    legsFar: [[32, 18, 40, 13], [15, 17, 7, 22]],
    tail: [[11, 16], [7, 17], [4, 13], [3, 8], [5, 3], [8, 1]]
  },
  slide: {
    bx: 20, by: 24, brx: 14, bry: 4, hx: 37, hy: 23, hr: 6,
    legsNear: [[33, 26, 40, 28], [15, 26, 7, 28]],
    legsFar: [[34, 26, 42, 27], [13, 26, 5, 27]],
    tail: [[9, 24], [5, 26], [2, 22], [1, 18], [3, 15], [6, 13]],
    earsBack: true
  }
};

function bakeCatPose(pose) {
  const { c, g } = cv(56, 34);
  g.translate(4, 4);
  drawCatPose(g, pose);
  return upscale(c, 2);
}

/* 逐帧眼睛：一个像素黑点的位置，以及需要抹平的自动烘焙碎点/孔洞区域 [x0,y0,x1,y1] */
const CAT_EYE = [
  { eye: [69, 10], face: [67, 9, 70, 14] },
  { eye: [68, 13], face: [66, 12, 69, 17] },
  { eye: [68, 15], face: [66, 14, 70, 19] },
  { eye: [68, 10], face: [66, 9, 69, 12] },
  { eye: [68, 8], face: [66, 7, 69, 12] },
  { eye: [69, 9], face: [67, 7, 70, 12] },
  { eye: [69, 7], face: [67, 6, 70, 10] },
  { eye: [69, 9], face: [67, 8, 70, 13] }
];
const CAT_EYE_COLOR = '#101010';

function bakeCatFrame(index, px = 2) {
  // catFrames.js 是 CRLF，行尾的 \r 会被当成未知字符画成洋红像素，先剔除
  const rows = CAT_3D_RUN[index].map(r => r.replace(/\r/g, ''));
  const { eye, face } = CAT_EYE[index];
  const { c, g } = cv(rows[0].length, rows.length);
  rows.forEach((row, y) => {
    for (let x = 0; x < row.length; x++) {
      const ch = row[x];
      if (ch === '.') continue;
      g.fillStyle = CAT_3D_PALETTE[ch] || '#ff00ff';
      g.fillRect(x, y, 1, 1);
    }
  });
  // 抹平自动烘焙留在脸上的碎点和孔洞
  g.fillStyle = CAT_3D_PALETTE.W;
  g.fillRect(face[0], face[1], face[2] - face[0] + 1, face[3] - face[1] + 1);
  // 只留一个像素黑点当眼睛
  g.fillStyle = CAT_EYE_COLOR;
  g.fillRect(eye[0], eye[1], 1, 1);
  return upscale(c, px);
}

function bakeSprite(w, h, scale, paint) {
  const { c, g } = cv(w, h);
  paint(g, w, h);
  return upscale(c, scale);
}

/* ---------- 障碍与道具 ---------- */
function paintCrate(g) {
  g.fillStyle = '#5d3a1e';
  g.fillRect(0, 0, 24, 24);
  g.fillStyle = '#c98543';
  g.fillRect(2, 2, 20, 20);
  g.fillStyle = '#b06f2f';
  [7, 14].forEach(y => g.fillRect(2, y, 20, 2));
  g.strokeStyle = '#8a5222';
  g.lineWidth = 3;
  g.beginPath();
  g.moveTo(5, 20);
  g.lineTo(19, 5);
  g.stroke();
  g.fillStyle = '#e2ab6b';
  g.fillRect(2, 2, 20, 1);
  g.fillRect(2, 2, 1, 20);
  g.fillStyle = '#5a636e';
  [[2, 2], [18, 2], [2, 18], [18, 18]].forEach(([x, y]) => g.fillRect(x, y, 4, 4));
  g.fillStyle = '#8b96a3';
  [[2, 2], [18, 2], [2, 18], [18, 18]].forEach(([x, y]) => g.fillRect(x + 1, y + 1, 2, 2));
}

function paintTrash(g, green) {
  const body = green ? '#3f9c62' : '#77818c';
  const dark = green ? '#2c7047' : '#525c67';
  const light = green ? '#6cc386' : '#9da8b4';
  g.fillStyle = '#2a333d';
  g.beginPath();
  g.ellipse(10, 27, 8, 2.4, 0, 0, Math.PI * 2);
  g.fill();
  g.fillStyle = dark;
  g.fillRect(4, 6, 12, 20);
  g.fillStyle = body;
  g.fillRect(5, 6, 10, 19);
  g.fillStyle = light;
  g.fillRect(5, 7, 2, 17);
  g.fillStyle = dark;
  [10, 15, 20].forEach(y => g.fillRect(5, y, 10, 1));
  g.fillStyle = dark;
  g.fillRect(3, 3, 14, 3);
  g.fillStyle = light;
  g.fillRect(4, 2, 12, 2);
  g.fillStyle = '#2a333d';
  g.fillRect(7, 1, 6, 1);
  g.fillRect(8, 0, 4, 1);
  g.fillStyle = dark;
  g.fillRect(3, 3, 1, 4);
  g.fillStyle = '#a4b0bd';
  g.fillRect(15, 3, 1, 3);
}

function paintCans(g) {
  const cols = [
    ['#b8403a', '#e2685f', '#7e2824'],
    ['#3c6f9e', '#66a3d2', '#254a6c'],
    ['#7c858f', '#a9b3bd', '#525b64']
  ];
  cols.forEach(([base, light, dark], i) => {
    const x = i * 11 + 1;
    g.fillStyle = '#27313a';
    g.fillRect(x, 2, 8, 10);
    g.fillStyle = base;
    g.fillRect(x + 1, 2, 6, 10);
    g.fillStyle = light;
    g.fillRect(x + 1, 2, 2, 9);
    g.fillStyle = dark;
    g.fillRect(x + 1, 9, 6, 2);
    g.fillRect(x + 1, 2, 6, 1);
    g.fillStyle = '#dfe7ee';
    g.fillRect(x + 2, 4, 2, 1);
  });
}

function paintManhole(g) {
  g.fillStyle = '#141a20';
  g.beginPath();
  g.ellipse(17, 8, 15, 5.4, 0, 0, Math.PI * 2);
  g.fill();
  g.strokeStyle = '#6d7782';
  g.lineWidth = 2.4;
  g.beginPath();
  g.ellipse(17, 8, 15, 5.4, 0, 0, Math.PI * 2);
  g.stroke();
  g.strokeStyle = '#434c56';
  g.lineWidth = 1;
  g.beginPath();
  g.ellipse(17, 8, 11, 3.4, 0, 0, Math.PI * 2);
  g.stroke();
  g.fillStyle = '#3a444e';
  for (let i = -2; i <= 2; i++) g.fillRect(17 + i * 4, 7, 2, 3);
  // 斜立井盖
  g.save();
  g.translate(29, 7.5);
  g.rotate(-1.05);
  g.fillStyle = '#59636e';
  g.fillRect(-5, -1.6, 10, 3.4);
  g.fillStyle = '#7e8996';
  g.fillRect(-4, -1, 8, 1);
  g.fillStyle = '#39424b';
  g.fillRect(-3, 0.6, 6, 1);
  g.restore();
}

function paintWall(g, w, h) {
  g.fillStyle = '#4a2a22';
  g.fillRect(0, 0, w, h);
  g.fillStyle = '#b5523a';
  g.fillRect(1, 1, w - 2, h - 2);
  g.fillStyle = '#c9664c';
  for (let y = 3; y < h - 2; y += 6) {
    for (let x = 2; x < w - 2; x += 8) {
      const off = (Math.floor(y / 6) % 2) * 4;
      g.fillRect(x + off, y, 6, 4);
    }
  }
  g.fillStyle = '#8f3d2b';
  for (let y = 2; y < h; y += 6) g.fillRect(1, y, w - 2, 1);
  g.fillStyle = '#e08a6d';
  g.fillRect(1, 1, w - 2, 1);
  g.fillRect(1, 1, 1, h - 2);
  g.fillStyle = '#6d7580';
  g.fillRect(0, h - 4, w, 4);
}

function paintBird(g, up) {
  g.fillStyle = '#2f3b49';
  g.fillRect(5, 5, 6, 4);
  g.fillStyle = '#8fa2b6';
  g.fillRect(5, 7, 5, 2);
  g.fillStyle = '#2f3b49';
  g.fillRect(10, 4, 2, 2);
  g.fillStyle = '#ffb648';
  g.fillRect(11, 5, 2, 1);
  g.fillStyle = '#fff';
  g.fillRect(9, 5, 1, 1);
  g.fillStyle = '#22303c';
  if (up) {
    g.fillRect(4, 2, 2, 4);
    g.fillRect(2, 0, 3, 3);
    g.fillRect(8, 3, 3, 2);
  } else {
    g.fillRect(4, 8, 2, 4);
    g.fillRect(2, 11, 3, 3);
    g.fillRect(8, 9, 3, 2);
  }
}

const COIN_ART = [
  '..OOOO..',
  '.OYYYYO.',
  'OYYCCYYO',
  'OYCCCCYO',
  'OYCCCCYO',
  'OYYCCYYO',
  '.OYYYYO.',
  '..OOOO..'
];
const COIN_PAL = { O: '#b8791a', Y: '#ffe483', C: '#ffb52e' };

function paintStar(g) {
  const path = [
    [9, 1], [11, 6], [17, 6], [12, 10], [14, 16],
    [9, 12], [4, 16], [6, 10], [1, 6], [7, 6]
  ];
  g.fillStyle = '#145f63';
  g.beginPath();
  path.forEach(([x, y], i) => (i ? g.lineTo(x + 1, y + 1) : g.moveTo(x + 1, y + 1)));
  g.closePath();
  g.fill();
  g.fillStyle = '#5ff0e3';
  g.beginPath();
  path.forEach(([x, y], i) => (i ? g.lineTo(x, y) : g.moveTo(x, y)));
  g.closePath();
  g.fill();
  g.fillStyle = '#d4fffb';
  g.fillRect(7, 4, 2, 2);
  g.fillRect(5, 8, 2, 2);
}

function paintMagnet(g) {
  g.fillStyle = '#5c1f22';
  g.fillRect(2, 1, 12, 4);
  g.fillRect(2, 1, 4, 14);
  g.fillRect(10, 1, 4, 14);
  g.fillStyle = '#e35252';
  g.fillRect(3, 2, 10, 2);
  g.fillRect(3, 2, 2, 12);
  g.fillRect(11, 2, 2, 12);
  g.fillStyle = '#ff8d84';
  g.fillRect(3, 2, 10, 1);
  g.fillStyle = '#e9eef4';
  g.fillRect(3, 13, 2, 3);
  g.fillRect(11, 13, 2, 3);
}

function paintPipe(g) {
  g.fillStyle = '#2b3741';
  g.fillRect(0, 1, 32, 10);
  g.fillStyle = '#7f929f';
  g.fillRect(1, 2, 30, 8);
  g.fillStyle = '#b8c9d3';
  g.fillRect(1, 2, 30, 3);
  g.fillStyle = '#596a76';
  g.fillRect(1, 8, 30, 2);
  g.fillStyle = '#3b4b57';
  g.fillRect(3, 1, 3, 10);
  g.fillRect(26, 1, 3, 10);
  g.fillStyle = '#d3e1e8';
  g.fillRect(4, 2, 1, 8);
  g.fillStyle = '#8e2f27';
  g.fillRect(17, 1, 5, 10);
  g.fillStyle = '#e35d4d';
  g.fillRect(18, 2, 3, 8);
  g.fillStyle = '#ff9a86';
  g.fillRect(18, 2, 1, 6);
  g.fillStyle = '#3b2622';
  g.beginPath();
  g.arc(31, 6, 4, 0, Math.PI * 2);
  g.fill();
  g.fillStyle = '#c9d6de';
  g.beginPath();
  g.arc(31, 6, 2.6, 0, Math.PI * 2);
  g.fill();
  g.fillStyle = '#6b7d89';
  g.fillRect(30, 5, 2, 2);
  g.fillStyle = '#e8f1f5';
  g.fillRect(30, 5, 1, 1);
  g.fillStyle = '#26323b';
  g.fillRect(5, 10, 2, 2);
  g.fillRect(25, 10, 2, 2);
}

function paintMouse(g) {
  g.fillStyle = '#4b3325';
  g.beginPath();
  g.ellipse(9, 10, 7, 4.4, 0, 0, Math.PI * 2);
  g.fill();
  g.beginPath();
  g.ellipse(15, 7, 5, 4, 0, 0, Math.PI * 2);
  g.fill();
  g.fillStyle = '#c9964a';
  g.beginPath();
  g.ellipse(9, 10, 6, 3.4, 0, 0, Math.PI * 2);
  g.fill();
  g.beginPath();
  g.ellipse(15, 7, 4, 3, 0, 0, Math.PI * 2);
  g.fill();
  g.fillStyle = '#f3dfbd';
  g.beginPath();
  g.ellipse(9, 11, 4, 1.8, 0, 0, Math.PI * 2);
  g.fill();
  g.fillStyle = '#f2b3c0';
  g.beginPath();
  g.arc(12, 4, 3, 0, Math.PI * 2);
  g.fill();
  g.beginPath();
  g.arc(18, 4, 2.8, 0, Math.PI * 2);
  g.fill();
  g.fillStyle = '#c9964a';
  g.beginPath();
  g.arc(12, 4, 1.6, 0, Math.PI * 2);
  g.fill();
  g.beginPath();
  g.arc(18, 4, 1.6, 0, Math.PI * 2);
  g.fill();
  g.fillStyle = '#22303c';
  g.fillRect(16, 6, 2, 2);
  g.fillStyle = '#ffffff';
  g.fillRect(16, 6, 1, 1);
  g.fillStyle = '#e88a9b';
  g.fillRect(20, 8, 2, 2);
  g.fillStyle = '#c9964a';
  g.fillRect(1, 11, 3, 1);
  g.fillRect(0, 13, 2, 1);
}

function paintFish(g) {
  g.fillStyle = '#3a4a5c';
  g.beginPath();
  g.ellipse(8, 8, 6, 3.6, 0, 0, Math.PI * 2);
  g.fill();
  g.beginPath();
  g.moveTo(2, 8);
  g.lineTo(5, 4);
  g.lineTo(5, 12);
  g.closePath();
  g.fill();
  g.fillStyle = '#7fd8e6';
  g.beginPath();
  g.ellipse(8, 8, 4.6, 2.6, 0, 0, Math.PI * 2);
  g.fill();
  g.fillStyle = '#e4fbff';
  g.fillRect(9, 6, 2, 2);
  g.fillStyle = '#1e3a44';
  g.fillRect(10, 7, 1, 1);
}

/* ---------- 烘焙全部角色/道具 ---------- */
export function buildSprites(px = 4) {
  return {
    catRun: CAT_3D_RUN.map((_, i) => bakeCatFrame(i, 2)),
    catRunFootPad: CAT_3D_FOOT_PAD * 2,
    pipe: bakeSprite(32, 12, 3, paintPipe),
    mouse: bakeSprite(22, 15, 3, paintMouse),
    catJump: [0, 3, 5, 7].map(i => bakeCatFrame(i, 2)),
    crate: bakeSprite(24, 24, 3, paintCrate),
    trashG: bakeSprite(20, 28, 3, g => paintTrash(g, true)),
    trashGray: bakeSprite(20, 28, 3, g => paintTrash(g, false)),
    cans: bakeSprite(34, 13, 3, paintCans),
    manhole: bakeSprite(34, 15, 3, paintManhole),
    wall: bakeSprite(30, 46, 3, paintWall),
    bird: [
      bakeSprite(14, 14, 3, g => paintBird(g, true)),
      bakeSprite(14, 14, 3, g => paintBird(g, false))
    ],
    coin: upscale(artCanvas(COIN_ART, COIN_PAL), 3),
    shield: bakeSprite(18, 18, 3, paintStar),
    magnet: bakeSprite(16, 16, 3, paintMagnet),
    fish: bakeSprite(16, 16, 3, paintFish),
    px
  };
}

/* ---------- 城市背景：白天 / 夜晚两套烘焙 ---------- */
function roundRect(g, x, y, w, h, r) {
  g.beginPath();
  g.moveTo(x + r, y);
  g.arcTo(x + w, y, x + w, y + h, r);
  g.arcTo(x + w, y + h, x, y + h, r);
  g.arcTo(x, y + h, x, y, r);
  g.arcTo(x, y, x + w, y, r);
  g.closePath();
}

function buildSky(night) {
  const { c, g } = cv(960, 540);
  const grad = g.createLinearGradient(0, 0, 0, 540);
  if (night) {
    grad.addColorStop(0, '#101a3c');
    grad.addColorStop(0.5, '#28325c');
    grad.addColorStop(0.82, '#5d5476');
    grad.addColorStop(1, '#8a6f6a');
  } else {
    grad.addColorStop(0, '#5fc5ea');
    grad.addColorStop(0.52, '#a5e4f0');
    grad.addColorStop(0.85, '#e6f6e4');
    grad.addColorStop(1, '#f7ecc9');
  }
  g.fillStyle = grad;
  g.fillRect(0, 0, 960, 540);

  // 太阳 / 月亮
  const sx = 760;
  const sy = night ? 96 : 104;
  const glow = g.createRadialGradient(sx, sy, 6, sx, sy, night ? 90 : 120);
  glow.addColorStop(0, night ? 'rgba(220,232,255,.55)' : 'rgba(255,240,170,.75)');
  glow.addColorStop(1, 'rgba(255,240,170,0)');
  g.fillStyle = glow;
  g.fillRect(sx - 130, sy - 130, 260, 260);
  g.fillStyle = night ? '#eef3ff' : '#fff3ae';
  g.fillRect(sx - 24, sy - 24, 48, 48);
  g.fillRect(sx - 32, sy - 16, 64, 32);
  if (night) {
    g.fillStyle = '#cfd8ee';
    g.fillRect(sx - 14, sy - 12, 10, 10);
    g.fillRect(sx + 6, sy + 4, 8, 8);
  } else {
    g.fillStyle = '#ffe27c';
    g.fillRect(sx - 18, sy - 18, 36, 36);
  }

  // 像素云
  const clouds = [
    [80, 92, 1.2], [270, 62, 0.8], [470, 120, 1], [620, 52, 0.65], [860, 160, 0.85]
  ];
  clouds.forEach(([x, y, s], i) => {
    g.fillStyle = night ? 'rgba(66,78,124,.75)' : 'rgba(255,255,255,.92)';
    const w = 70 * s;
    g.fillRect(x, y + 14 * s, w, 14 * s);
    g.fillRect(x + 12 * s, y + 4 * s, w * 0.62, 14 * s);
    g.fillRect(x + 26 * s, y, w * 0.36, 12 * s);
    if (!night) {
      g.fillStyle = 'rgba(206,238,246,.9)';
      g.fillRect(x, y + 24 * s, w, 4 * s);
    }
    if (i % 2 === 0) {
      // 像素飞鸟
      g.fillStyle = night ? '#141d33' : '#4a7d8c';
      const bx = x + w + 18;
      const by = y + 2;
      g.fillRect(bx, by, 6, 2);
      g.fillRect(bx + 6, by - 2, 6, 2);
      g.fillRect(bx + 12, by, 6, 2);
    }
  });
  return c;
}

function buildFar(night) {
  const { c, g } = cv(1440, 540);
  g.clearRect(0, 0, 1440, 540);
  let x = -30;
  let seed = 7;
  const rnd = () => {
    seed = (seed * 9301 + 49297) % 233280;
    return seed / 233280;
  };
  while (x < 1460) {
    const w = 56 + Math.floor(rnd() * 76);
    const h = 70 + Math.floor(rnd() * 150);
    const y = 432 - h;
    g.fillStyle = night ? (rnd() > 0.5 ? '#2a3552' : '#32405d') : (rnd() > 0.5 ? '#96d6dc' : '#84cbd4');
    g.fillRect(x, y, w, h);
    g.fillStyle = night ? '#212b45' : '#7cc2cb';
    g.fillRect(x, y, w, 6);
    if (rnd() > 0.55) {
      g.fillStyle = night ? '#3b4a6c' : '#a9e2e4';
      g.fillRect(x + w * 0.3, y - 22, 5, 22);
      g.fillRect(x + w * 0.3 - 4, y - 22, 13, 4);
    }
    if (rnd() > 0.6) {
      g.fillStyle = night ? '#3b4a6c' : '#a9e2e4';
      g.fillRect(x + 10, y + 16, w - 20, 3);
      g.fillRect(x + 10, y + 30, w - 20, 3);
    }
    x += w + 6 + Math.floor(rnd() * 16);
  }
  return c;
}

function windowGrid(g, x, y, w, h, night, seed) {
  let s = seed;
  const rnd = () => {
    s = (s * 9301 + 49297) % 233280;
    return s / 233280;
  };
  const cols = Math.max(2, Math.floor(w / 24));
  const rows = Math.max(2, Math.floor(h / 30));
  for (let r = 0; r < rows; r++) {
    for (let col = 0; col < cols; col++) {
      const wx = x + 10 + col * ((w - 16) / cols);
      const wy = y + 14 + r * ((h - 22) / rows);
      const lit = night && rnd() > 0.45;
      g.fillStyle = lit ? (rnd() > 0.5 ? '#ffd27a' : '#ffb95e') : (night ? '#2b3550' : '#5c7f96');
      g.fillRect(Math.round(wx), Math.round(wy), 9, 12);
      g.fillStyle = night ? '#1d2740' : '#7fa5b8';
      g.fillRect(Math.round(wx) + 4, Math.round(wy), 1, 12);
      if (!night) {
        g.fillStyle = 'rgba(255,255,255,.45)';
        g.fillRect(Math.round(wx), Math.round(wy), 9, 2);
      }
    }
  }
}

function buildMid(night) {
  const { c, g } = cv(1440, 540);
  let x = 0;
  let seed = 31;
  const rnd = () => {
    seed = (seed * 9301 + 49297) % 233280;
    return seed / 233280;
  };
  const dayCols = ['#e7a05a', '#efb568', '#d98b4b', '#f2c47e'];
  const nightCols = ['#6c4a40', '#7b5445', '#5d4038', '#82604b'];
  while (x < 1440) {
    const w = 110 + Math.floor(rnd() * 110);
    const h = 150 + Math.floor(rnd() * 150);
    const y = 432 - h;
    g.fillStyle = 'rgba(40,30,35,.18)';
    g.fillRect(x + 6, y + 8, w, h);
    g.fillStyle = night ? nightCols[Math.floor(rnd() * 4)] : dayCols[Math.floor(rnd() * 4)];
    g.fillRect(x, y, w, h);
    g.fillStyle = night ? '#4a342e' : '#b96f3d';
    g.fillRect(x, y, w, 7);
    g.fillRect(x, y, 6, h);
    g.fillStyle = night ? '#5b4138' : '#f0c184';
    g.fillRect(x + 6, y + 7, w - 6, 3);
    // 屋顶小构件
    if (rnd() > 0.5) {
      g.fillStyle = night ? '#3f2c27' : '#b96f3d';
      g.fillRect(x + 14, y - 16, 26, 16);
      g.fillRect(x + 18, y - 22, 18, 6);
    }
    windowGrid(g, x, y + 8, w, h - 12, night, Math.floor(rnd() * 9999) + 3);
    // 空调箱 / 管道
    if (rnd() > 0.45) {
      const ax = x + w - 30;
      const ay = y + 40;
      g.fillStyle = night ? '#3a465c' : '#cfd5d8';
      g.fillRect(ax, ay, 22, 14);
      g.fillStyle = night ? '#2b3446' : '#aab3ba';
      g.fillRect(ax + 2, ay + 2, 18, 10);
      g.fillStyle = night ? '#1f2836' : '#7c8892';
      g.fillRect(ax + 5, ay + 5, 12, 4);
    }
    if (rnd() > 0.6) {
      g.fillStyle = night ? '#2f3a4c' : '#8d9aa4';
      g.fillRect(x + w - 12, y + 12, 5, h - 24);
      g.fillRect(x + w - 16, y + 50, 9, 4);
    }
    // 店铺雨棚
    if (h > 210 && rnd() > 0.55) {
      const aw = 40;
      const ax = x + 12;
      const ay = 432 - 34;
      for (let i = 0; i < 4; i++) {
        g.fillStyle = i % 2 ? (night ? '#8a4b48' : '#e46f66') : (night ? '#c9c3b8' : '#f6efe2');
        g.fillRect(ax + i * (aw / 4), ay, aw / 4, 12);
      }
    }
    x += w + 10 + Math.floor(rnd() * 30);
  }
  // 路灯
  for (let lx = 90; lx < 1440; lx += 340) {
    g.fillStyle = night ? '#1c2536' : '#4c5864';
    g.fillRect(lx, 300, 5, 132);
    g.fillRect(lx, 300, 26, 4);
    g.fillStyle = night ? '#ffe3a1' : '#c9d3d9';
    g.fillRect(lx + 20, 304, 12, 9);
    if (night) {
      const gl = g.createRadialGradient(lx + 26, 310, 2, lx + 26, 310, 90);
      gl.addColorStop(0, 'rgba(255,220,140,.5)');
      gl.addColorStop(1, 'rgba(255,220,140,0)');
      g.fillStyle = gl;
      g.fillRect(lx - 64, 220, 180, 180);
    }
  }
  return c;
}

function buildGround(night) {
  const { c, g } = cv(480, 120);
  const top = 18;
  g.fillStyle = night ? '#4a3a3a' : '#8a5c44';
  g.fillRect(0, 0, 480, 120);
  // 人行道暖色砖
  g.fillStyle = night ? '#6d5a52' : '#d8a66b';
  g.fillRect(0, 0, 480, 42);
  g.fillStyle = night ? '#7d675c' : '#e6b87c';
  for (let y = 0; y < 42; y += 14) {
    for (let x = (y / 14) % 2 ? -12 : 0; x < 480; x += 48) {
      g.fillRect(x + 2, y + 2, 44, 10);
    }
  }
  g.fillStyle = night ? '#3d3232' : '#9b6c45';
  for (let y = 0; y < 42; y += 14) g.fillRect(0, y, 480, 2);
  g.fillStyle = night ? '#584a44' : '#b98254';
  g.fillRect(0, 0, 480, 3);
  g.fillStyle = night ? '#8a7466' : '#f0cf9a';
  g.fillRect(0, 0, 480, 1);
  // 路缘
  g.fillStyle = night ? '#3b3130' : '#a06f49';
  g.fillRect(0, 42, 480, 12);
  g.fillStyle = night ? '#5a4c46' : '#c08a5b';
  g.fillRect(0, 42, 480, 3);
  // 地下土层
  g.fillStyle = night ? '#2a2426' : '#5f4034';
  g.fillRect(0, 54, 480, 66);
  const rnd = (seed => () => {
    seed = (seed * 9301 + 49297) % 233280;
    return seed / 233280;
  })(13);
  for (let i = 0; i < 70; i++) {
    const x = Math.floor(rnd() * 480);
    const y = 58 + Math.floor(rnd() * 58);
    const s = 2 + Math.floor(rnd() * 4);
    g.fillStyle = rnd() > 0.5
      ? (night ? '#3c3234' : '#78513f')
      : (night ? '#201c1e' : '#4a322b');
    g.fillRect(x, y, s, s);
  }
  g.fillStyle = night ? '#1d191b' : '#4a322b';
  g.fillRect(0, 118, 480, 2);
  return { c, top };
}

export function buildWorlds() {
  return {
    day: { sky: buildSky(false), far: buildFar(false), mid: buildMid(false), ground: buildGround(false) },
    night: { sky: buildSky(true), far: buildFar(true), mid: buildMid(true), ground: buildGround(true) }
  };
}

export const PIXEL_SCALE = 4;