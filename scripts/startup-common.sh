#!/usr/bin/env bash
# Shared by start_all.sh and its readiness regression tests (macOS Bash 3.2).

startup_log() {
  printf '[%s +%ss] %s\n' "$(date '+%H:%M:%S')" "$((SECONDS - STARTUP_STARTED))" "$*"
}

wait_service() { # <name> <url> <pid> <log file> [timeout seconds]
  local name="$1" url="$2" pid="$3" log_file="$4" timeout="${5:-60}"
  local started=$SECONDS next_report=$SECONDS last_probe='尚未响应' elapsed
  startup_log "等待 ${name}：${url}"
  while (( SECONDS - started < timeout )); do
    if ! kill -0 "$pid" 2>/dev/null; then
      startup_log "✗ ${name} 进程已退出；日志：${log_file}"
      tail -n 20 "$log_file" 2>/dev/null || true
      return 1
    fi
    # 本机探测必须绕过 HTTP(S)/ALL_PROXY；单次请求有界，避免假性卡住。
    if last_probe=$(curl --noproxy '*' --silent --show-error --fail \
        --connect-timeout 1 --max-time 2 --output /dev/null \
        --write-out 'HTTP %{http_code}' "$url" 2>&1); then
      startup_log "✓ ${name} 就绪，检查耗时 $((SECONDS - started))s（${url}）"
      return 0
    fi
    if (( SECONDS >= next_report )); then
      elapsed=$((SECONDS - started))
      startup_log "${name} 尚未就绪，已等待 ${elapsed}s；${last_probe}"
      next_report=$((SECONDS + 5))
    fi
    sleep 1
  done
  startup_log "✗ ${name} 启动超时（${timeout}s）；${last_probe}；日志：${log_file}"
  tail -n 20 "$log_file" 2>/dev/null || true
  return 1
}
