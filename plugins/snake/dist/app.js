// 极简贪吃蛇：方向键 + 触屏滑动，撞墙/咬身结束，空格重开
const cvs = document.getElementById('game')
const ctx = cvs.getContext('2d')
const N = 16, S = cvs.width / N          // 16×16 格
let snake, dir, nextDir, food, score, dead, timer

function reset() {
  snake = [{ x: 8, y: 8 }, { x: 7, y: 8 }, { x: 6, y: 8 }]
  dir = nextDir = { x: 1, y: 0 }
  food = spawn()
  score = 0; dead = false
  document.getElementById('score').textContent = 0
  clearInterval(timer); timer = setInterval(step, 140)
}
function spawn() {
  while (true) {
    const p = { x: (Math.random() * N) | 0, y: (Math.random() * N) | 0 }
    if (!snake.some(s => s.x === p.x && s.y === p.y)) return p
  }
}
function step() {
  dir = nextDir
  const head = { x: snake[0].x + dir.x, y: snake[0].y + dir.y }
  if (head.x < 0 || head.y < 0 || head.x >= N || head.y >= N ||
      snake.some(s => s.x === head.x && s.y === head.y)) {
    dead = true; clearInterval(timer)
    draw(); return
  }
  snake.unshift(head)
  if (head.x === food.x && head.y === food.y) {
    score++; document.getElementById('score').textContent = score
    food = spawn()
  } else {
    snake.pop()
  }
  draw()
}
function draw() {
  ctx.fillStyle = '#10141d'
  ctx.fillRect(0, 0, cvs.width, cvs.height)
  ctx.fillStyle = '#ff5b77'                 // 食物
  ctx.beginPath()
  ctx.arc((food.x + 0.5) * S, (food.y + 0.5) * S, S * 0.32, 0, 7)
  ctx.fill()
  snake.forEach((s, i) => {                 // 蛇身渐变
    const t = i / snake.length
    ctx.fillStyle = `rgb(${91 + t * 120}, ${140 - t * 60}, ${255 - t * 100})`
    const r = 4
    const x = s.x * S + 1, y = s.y * S + 1, w = S - 2
    ctx.beginPath()
    ctx.roundRect(x, y, w, w, r); ctx.fill()
  })
  if (dead) {
    ctx.fillStyle = 'rgba(11,14,20,.72)'
    ctx.fillRect(0, 0, cvs.width, cvs.height)
    ctx.fillStyle = '#e6ebf5'
    ctx.font = 'bold 22px sans-serif'; ctx.textAlign = 'center'
    ctx.fillText('游戏结束 · 空格重来', cvs.width / 2, cvs.height / 2)
  }
}
addEventListener('keydown', (e) => {
  const m = { ArrowUp: [0, -1], ArrowDown: [0, 1], ArrowLeft: [-1, 0], ArrowRight: [1, 0] }[e.key]
  if (m && (m[0] !== -dir.x || m[1] !== -dir.y)) { nextDir = { x: m[0], y: m[1] }; e.preventDefault() }
  if (e.key === ' ' && dead) reset()
})
let ts = null
cvs.addEventListener('touchstart', (e) => { ts = [e.touches[0].clientX, e.touches[0].clientY] })
cvs.addEventListener('touchmove', (e) => {
  if (!ts) return
  const dx = e.touches[0].clientX - ts[0], dy = e.touches[0].clientY - ts[1]
  if (Math.abs(dx) < 18 && Math.abs(dy) < 18) return
  nextDir = Math.abs(dx) > Math.abs(dy)
    ? { x: Math.sign(dx), y: 0 } : { x: 0, y: Math.sign(dy) }
  ts = null; e.preventDefault()
})
reset(); draw()
