#!/usr/bin/env sh
set -eu

mkdir -p "${DATA_DIR:-/app/data}"

node server.js &
API_PID="$!"

nginx -g 'daemon off;' &
NGINX_PID="$!"

term_handler() {
  kill "$API_PID" "$NGINX_PID" 2>/dev/null || true
  wait "$API_PID" "$NGINX_PID" 2>/dev/null || true
}
trap term_handler INT TERM

wait -n "$API_PID" "$NGINX_PID"
term_handler
