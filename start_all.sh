#!/usr/bin/env bash
# 一键启动：后端 FastAPI(8000) + 前端 Vite(5173)
# 用法：./start_all.sh          （后端带 --reload）
#       ./start_all.sh --prod   （后端关 reload，配合 web/dist 验证生产形态）
set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$ROOT"

LOG_DIR="$ROOT/logs"
mkdir -p "$LOG_DIR"
SERVER_PID="$LOG_DIR/server.pid"
WEB_PID="$LOG_DIR/web.pid"

GREEN='\033[32m'; YELLOW='\033[33m'; RED='\033[31m'; RESET='\033[0m'
say() { printf "%b\n" "$1"; }

wait_port() { # wait_port <port> <name>
  local port="$1" name="$2" i
  for i in {1..60}; do
    if curl -sf -o /dev/null "http://localhost:${port}/"; then
      say "${GREEN}✓${RESET} ${name} 就绪 (http://localhost:${port})"
      return 0
    fi
    sleep 1
  done
  say "${RED}✗${RESET} ${name} 启动超时，请看日志：$2.log"
  return 1
}

# 端口已占用则先停掉旧进程，避免端口冲突
for port in 8000 5173; do
  existing=$(lsof -ti:"$port" 2>/dev/null || true)
  if [ -n "$existing" ]; then
    say "${YELLOW}!${RESET} 端口 ${port} 已被占用，正在停止旧进程…"
    kill $existing 2>/dev/null || true
    sleep 1
  fi
done

# ── 后端 ────────────────────────────────────────────
if [ ! -x "$ROOT/.venv/bin/python" ]; then
  say "${YELLOW}!${RESET} 未发现 .venv，正在创建并安装后端依赖…"
  PY="${PYTHON_BIN:-$(command -v python3.11 || command -v python3)}"
  "$PY" -m venv "$ROOT/.venv" || { say "${RED}✗${RESET} 创建 venv 失败"; exit 1; }
  "$ROOT/.venv/bin/pip" install -q -r "$ROOT/server/requirements.txt"
fi

say "▶ 启动后端（FastAPI, 端口 8000）…"
cd "$ROOT/server"
nohup "$ROOT/.venv/bin/python" run_dev.py "$@" > "$LOG_DIR/server.log" 2>&1 &
echo $! > "$SERVER_PID"
cd "$ROOT"

# ── 前端 ────────────────────────────────────────────
if [ ! -d "$ROOT/web/node_modules" ]; then
  say "${YELLOW}!${RESET} 未发现 node_modules，正在安装前端依赖…"
  (cd "$ROOT/web" && npm install --no-audit --no-fund) || {
    say "${RED}✗${RESET} npm install 失败"; exit 1; }
fi

say "▶ 启动前端（Vite dev, 端口 5173）…"
cd "$ROOT/web"
nohup npm run dev > "$LOG_DIR/web.log" 2>&1 &
echo $! > "$WEB_PID"
cd "$ROOT"

# ── 健康检查 ────────────────────────────────────────
wait_port 8000 "后端"
wait_port 5173 "前端"

say ""
say "${GREEN}AgentOS 已启动${RESET}"
say "  前端 http://localhost:5173 （/api 已代理到后端）"
say "  后端 http://localhost:8000/api/health · /api/apps · /api/plugins"
say "  日志 $LOG_DIR/server.log · $LOG_DIR/web.log"
say "  停止 ./stop_all.sh"
