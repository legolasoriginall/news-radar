#!/usr/bin/env bash
# سرور «رصد خبر» را پایدار نگه می‌دارد: اگر سرور خطا داد یا کرش کرد، خودش دوباره
# بالا می‌آید و پشت‌سرهم تلاش نمی‌کند (تأخیر پلکانی تا ۶۰ ثانیه).
#
# اجرا:
#   bash scripts/keep-alive.sh start   # اجرای پس‌زمینه و مستقل از ترمینال
#   bash scripts/keep-alive.sh status  # بررسی زنده‌بودن و پاسخ سرور
#   bash scripts/keep-alive.sh stop    # توقف ناظر و سرور
#
# متغیرها: PORT (پیش‌فرض ۳۰۰۱)، NEWSRADAR_LOG، NEWSRADAR_PIDFILE
set -u

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PORT="${PORT:-3001}"
LOG="${NEWSRADAR_LOG:-/tmp/newsradar-keepalive.log}"
PIDFILE="${NEWSRADAR_PIDFILE:-/tmp/newsradar-keepalive.pid}"
MIN_BACKOFF=2
MAX_BACKOFF=60
MAX_LOG_BYTES=5000000

running_pid() {
  [ -f "$PIDFILE" ] || return 1
  local pid
  pid="$(cat "$PIDFILE" 2>/dev/null || true)"
  [ -n "$pid" ] || return 1
  kill -0 "$pid" 2>/dev/null || return 1
  echo "$pid"
}

rotate_log() {
  [ -f "$LOG" ] || return 0
  local size
  size="$(stat -c%s "$LOG" 2>/dev/null || echo 0)"
  if [ "$size" -gt "$MAX_LOG_BYTES" ]; then
    tail -c 1000000 "$LOG" > "$LOG.tmp" 2>/dev/null && mv "$LOG.tmp" "$LOG"
  fi
}

run_loop() {
  echo $$ > "$PIDFILE"
  local child=""
  local backoff=$MIN_BACKOFF
  cleanup() {
    [ -n "$child" ] && kill "$child" 2>/dev/null
    rm -f "$PIDFILE"
    exit 0
  }
  trap cleanup INT TERM

  while :; do
    rotate_log
    echo "› [$(date -u +%FT%TZ)] شروع سرور روی پورت $PORT" >> "$LOG"
    ( cd "$ROOT" && PORT="$PORT" exec node server.mjs ) >> "$LOG" 2>&1 &
    child=$!
    local started=$SECONDS
    wait "$child"
    local code=$?
    local ran=$(( SECONDS - started ))
    child=""
    echo "› [$(date -u +%FT%TZ)] سرور با کد $code بسته شد (بعد از ${ran}s)" >> "$LOG"
    # اگر سرور مدت معقولی بالا بود، تأخیر به حداقل برمی‌گردد
    [ "$ran" -ge 120 ] && backoff=$MIN_BACKOFF
    sleep "$backoff"
    backoff=$(( backoff * 2 ))
    [ "$backoff" -gt "$MAX_BACKOFF" ] && backoff=$MAX_BACKOFF
  done
}

case "${1:-start}" in
  run)
    run_loop
    ;;
  start)
    rotate_log
    if pid="$(running_pid)"; then
      echo "ناظر از قبل روشن است (PID $pid) · لاگ: $LOG"
      exit 0
    fi
    setsid nohup bash "$0" run >> "$LOG" 2>&1 < /dev/null &
    for _ in $(seq 1 40); do
      if pid="$(running_pid)"; then
        echo "ناظر بالا آمد (PID $pid) · پورت $PORT · لاگ: $LOG"
        exit 0
      fi
      sleep 0.5
    done
    echo "ناظر بالا نیامد؛ لاگ را ببین: $LOG" >&2
    exit 1
    ;;
  status)
    if pid="$(running_pid)"; then
      code="$(curl -s -o /dev/null -w '%{http_code}' --max-time 3 "http://127.0.0.1:$PORT/api/status" 2>/dev/null || echo 000)"
      echo "ناظر روشن است (PID $pid) · /api/status → $code"
      [ "$code" = "200" ] || exit 1
    else
      echo "ناظر خاموش است"
      exit 1
    fi
    ;;
  stop)
    if pid="$(running_pid)"; then
      kill "$pid" 2>/dev/null || true
      for _ in $(seq 1 20); do
        kill -0 "$pid" 2>/dev/null || break
        sleep 0.5
      done
      kill -0 "$pid" 2>/dev/null && kill -9 "$pid" 2>/dev/null || true
      pkill -P "$pid" 2>/dev/null || true
      rm -f "$PIDFILE"
      echo "ناظر و سرورش متوقف شدند"
    else
      rm -f "$PIDFILE"
      echo "ناظری برای توقف نبود"
    fi
    ;;
  *)
    echo "استفاده: bash scripts/keep-alive.sh [start|stop|status]" >&2
    exit 2
    ;;
esac
