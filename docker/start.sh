#!/usr/bin/env sh
set -eu

mkdir -p "${DATA_DIR:-/app/data}"

node server.js &
API_PID="$!"

nginx -g 'daemon off;' &
NGINX_PID="$!"

term_handler() {
  kill "$API_PID" "$NGINX_PID" 2>/dev/null || true
  wait "$API_PID" 2>/dev/null || true
  wait "$NGINX_PID" 2>/dev/null || true
}

trap term_handler INT TERM

while true; do
  if ! kill -0 "$API_PID" 2>/dev/null; then
    term_handler
    exit 1
  fi

  if ! kill -0 "$NGINX_PID" 2>/dev/null; then
    term_handler
    exit 1
  fi

  sleep 2
done
