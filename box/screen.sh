#!/bin/sh
# Idempotent X display for one automaton. DISPLAY number is $1.
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
mkdir -p "${HOME:-/home/box}/.fluxbox"
printf '%s\n' \
  'session.screen0.toolbar.visible: false' \
  'session.screen0.slit.visible: false' \
  'session.screen0.workspaces: 1' \
  "session.screen0.rootCommand: xsetroot -solid '#222222'" \
  > "${HOME:-/home/box}/.fluxbox/init"
if command -v fluxbox >/dev/null 2>&1; then
  alive=0
  if [ -f "${pidfile}" ]; then
    pid=$(cat "${pidfile}")
    if [ -n "${pid}" ] && kill -0 "${pid}" 2>/dev/null; then
      alive=1
    fi
  fi
  if [ "${alive}" -eq 0 ]; then
    fluxbox >/tmp/fluxbox-"${N}".log 2>&1 &
    echo $! > "${pidfile}"
    sleep 0.2
  fi
fi
pkill -x xmessage >/dev/null 2>&1 || true

if command -v xsetroot >/dev/null 2>&1; then
  xsetroot -solid '#222222'
fi
exit 0
