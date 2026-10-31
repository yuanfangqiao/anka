#!/usr/bin/env bash
# 一键启动：后端 FastAPI(8000) + 前端 Vite(5173)
# 用法：./start_all.sh          （后端带 --reload）
#       ./start_all.sh --prod   （后端关 reload，配合 web/dist 验证生产形态）
set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$ROOT"
STARTUP_STARTED=$SECONDS
source "$ROOT/scripts/startup-common.sh"

LOG_DIR="$ROOT/logs"
RUN_DIR="$ROOT/run"
mkdir -p "$LOG_DIR" "$RUN_DIR"
# 同时保留终端与脚本阶段日志；子进程继续分别写 server.log / web.log。
exec > >(tee "$LOG_DIR/startup.log") 2>&1
SERVER_PID="$RUN_DIR/server.pid"
WEB_PID="$RUN_DIR/web.pid"

GREEN='\033[32m'; YELLOW='\033[33m'; RED='\033[31m'; RESET='\033[0m'
say() { startup_log "$(printf '%b' "$1")"; }

# 端口已占用则先停掉旧进程，避免端口冲突
say "检查端口 8000 / 5173…"
for port in 8000 5173; do
  existing=$(lsof -tiTCP:"$port" -sTCP:LISTEN 2>/dev/null || true)
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
  "$ROOT/.venv/bin/pip" install -q -r "$ROOT/server/requirements.txt" || {
    say "${RED}✗${RESET} 后端依赖安装失败"; exit 1; }
fi
say "后端依赖检查完成"

say "▶ 启动后端（FastAPI, 端口 8000）…"
cd "$ROOT/server"
nohup "$ROOT/.venv/bin/python" -u run_dev.py "$@" > "$LOG_DIR/server.log" 2>&1 &
backend_pid=$!
echo "$backend_pid" > "$SERVER_PID"
say "后端进程已创建 PID=${backend_pid}，日志：$LOG_DIR/server.log"
cd "$ROOT"

# ── 前端 ────────────────────────────────────────────
if [ ! -d "$ROOT/web/node_modules" ]; then
  say "${YELLOW}!${RESET} 未发现 node_modules，正在安装前端依赖…"
  (cd "$ROOT/web" && npm install --no-audit --no-fund) || {
    say "${RED}✗${RESET} npm install 失败"; exit 1; }
fi
say "前端依赖检查完成"

say "▶ 启动前端（Vite dev, 端口 5173）…"
cd "$ROOT/web"
nohup npm run dev > "$LOG_DIR/web.log" 2>&1 &
frontend_pid=$!
echo "$frontend_pid" > "$WEB_PID"
say "前端进程已创建 PID=${frontend_pid}，日志：$LOG_DIR/web.log"
cd "$ROOT"

# ── 健康检查 ────────────────────────────────────────
wait_service "后端" "http://127.0.0.1:8000/api/health" "$backend_pid" "$LOG_DIR/server.log" &
backend_check=$!
wait_service "前端" "http://127.0.0.1:5173/" "$frontend_pid" "$LOG_DIR/web.log" &
frontend_check=$!
startup_failed=0
wait "$backend_check" || startup_failed=1
wait "$frontend_check" || startup_failed=1
if [ "$startup_failed" -ne 0 ]; then
  say "${RED}启动失败，请检查以上日志；脚本耗时 $((SECONDS - STARTUP_STARTED))s${RESET}"
  exit 1
fi

say ""
say "${GREEN}Anka 已启动，总耗时 $((SECONDS - STARTUP_STARTED))s${RESET}"
say "  前端 http://localhost:5173 （/api 已代理到后端）"
say "  后端 http://localhost:8000/api/health · /api/apps · /api/plugins"
say "  日志 $LOG_DIR/startup.log · server.log · web.log"
say "  停止 ./stop_all.sh"
