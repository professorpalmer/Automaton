#!/bin/sh
# Idempotent X display for one automaton. DISPLAY number is $1.
# Do not start a window manager. Fluxbox wraps Chromium in an
# override-redirect frame that eats xdotool XTEST clicks.
set -eu
N="${1:?display}"
export DISPLAY=":${N}"
GEOM="${AUTOMATON_GEOM:-1280x800x24}"

if ! xdpyinfo >/dev/null 2>&1; then
  Xvfb ":${N}" -screen 0 "${GEOM}" -ac >/tmp/xvfb-"${N}".log 2>&1 &
  i=0
  while [ "${i}" -lt 50 ]; do
    if xdpyinfo >/dev/null 2>&1; then
      break
    fi
    i=$((i + 1))
    sleep 0.1
  done
fi

if ! xdpyinfo >/dev/null 2>&1; then
  echo "automaton-screen: Xvfb :${N} did not come up" >&2
  exit 1
fi

pidfile="/tmp/fluxbox-${N}.pid"
if [ -f "${pidfile}" ]; then
  pid=$(cat "${pidfile}")
  if [ -n "${pid}" ]; then
    kill "${pid}" 2>/dev/null || true
  fi
  rm -f "${pidfile}"
fi
pkill -x fluxbox >/dev/null 2>&1 || true
pkill -x xmessage >/dev/null 2>&1 || true

if command -v xsetroot >/dev/null 2>&1; then
  xsetroot -solid '#222222'
fi
exit 0
