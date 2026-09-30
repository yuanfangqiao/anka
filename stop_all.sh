#!/usr/bin/env bash
# 停止前端与后端（按 PID 文件精确停止，回退到按端口清理）
set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
LOG_DIR="$ROOT/logs"
GREEN='\033[32m'; YELLOW='\033[33m'; RESET='\033[0m'
say() { printf "%b\n" "$1"; }

stop_pidfile() { # stop_pidfile <pidfile> <name>
  local pidfile="$1" name="$2"
  if [ -f "$pidfile" ]; then
    local pid
    pid=$(cat "$pidfile" 2>/dev/null || true)
    if [ -n "${pid}" ] && kill -0 "$pid" 2>/dev/null; then
      # 杀进程组，连 uvicorn --reload 的子进程 / vite 子进程一起收掉
      kill -TERM -"$(ps -o pgid= -p "$pid" | tr -d ' ')" 2>/dev/null || kill "$pid" 2>/dev/null || true
      sleep 1
      kill -9 "$pid" 2>/dev/null || true
      say "${GREEN}✓${RESET} ${name} 已停止 (pid ${pid})"
    fi
    rm -f "$pidfile"
  fi
}

# 1) 按 PID 文件停止
stop_pidfile "$LOG_DIR/server.pid" "后端"
stop_pidfile "$LOG_DIR/web.pid" "前端"

# 2) 兜底：按端口清理残留（uvicorn 8000 / vite 5173）
for port in 8000 5173; do
  pids=$(lsof -ti:"$port" 2>/dev/null || true)
  if [ -n "$pids" ]; then
    kill -9 $pids 2>/dev/null || true
    say "${YELLOW}!${RESET} 已清理端口 ${port} 的残留进程"
  fi
done

# 3) 兜底：按命令行特征清理本项目进程
pkill -f "$ROOT/server/run_dev.py" 2>/dev/null || true
pkill -f "$ROOT/web/node_modules/.bin/vite" 2>/dev/null || true

if [ -t 1 ]; then say "${GREEN}全部停止${RESET}（日志保留在 $LOG_DIR）"; fi
