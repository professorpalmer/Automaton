import { boxExec, ensureBox, type BoxSeams } from './box'
import { BOX_DISPLAY_H, BOX_DISPLAY_W, boxProfileDir, mouthScreen } from './computer'
import { ensureDesktop } from './desktop'
import { automatonHome } from './keys'

export function screenBootArgv(display: number): string[] {
  return ['automaton-screen', String(display)]
}

function fallbackBoot(display: number): string {
  const n = String(display)
  const geom = `${BOX_DISPLAY_W}x${BOX_DISPLAY_H}x24`
  return [
    `export DISPLAY=:${n}`,
    `xdpyinfo >/dev/null 2>&1 || Xvfb :${n} -screen 0 ${geom} -ac >/tmp/xvfb-${n}.log 2>&1 &`,
    `i=0; while [ $i -lt 50 ]; do xdpyinfo >/dev/null 2>&1 && break; i=$((i+1)); sleep 0.1; done`,
    `if [ -f /tmp/fluxbox-${n}.pid ]; then kill $(cat /tmp/fluxbox-${n}.pid) 2>/dev/null || true; rm -f /tmp/fluxbox-${n}.pid; fi`,
    `pkill -x fluxbox >/dev/null 2>&1 || true`,
    `command -v xsetroot >/dev/null && xsetroot -solid '#222222' || true`,
    `xdpyinfo >/dev/null 2>&1`,
  ].join('; ')
}

export function ensureScreen(
  agentId: string,
  home = automatonHome(),
  seams: BoxSeams = {},
): boolean {
  if (!ensureBox(home, seams).running) return false
  ensureDesktop(agentId, home)
  const display = mouthScreen(agentId, home).display
  const script = boxExec(screenBootArgv(display), {}, seams)
  if (script.status === 0) return true
  return boxExec(['sh', '-c', fallbackBoot(display)], {}, seams).status === 0
}

export function boxChromeAlive(
  agentId: string,
  home = automatonHome(),
  seams: BoxSeams = {},
): boolean {
  const needle = `user-data-dir=${boxProfileDir(agentId)}`
  return (
    boxExec(
      [
        'sh',
        '-c',
        [
          'ps -eo pid=,state=,args=',
          '| awk -v needle="$NEEDLE" -v bin="$CHROME_BIN"',
          '\'$2 !~ /^Z/ && $0 !~ /awk/ && index($0, needle) && index($0, bin) { found=1 } END { exit !found }\'',
        ].join(' '),
      ],
      { NEEDLE: needle, CHROME_BIN: '/usr/lib/chromium/chromium' },
      seams,
    ).status === 0
  )
}

export function boxChromeWindowReady(
  agentId: string,
  home = automatonHome(),
  seams: BoxSeams = {},
): boolean {
  const display = mouthScreen(agentId, home).display
  return (
    boxExec(
      [
        'sh',
        '-c',
        [
          'for id in $(xdotool search --onlyvisible --class chromium 2>/dev/null); do',
          '  eval $(xdotool getwindowgeometry --shell "$id")',
          '  if [ "${WIDTH:-0}" -gt 200 ]; then exit 0; fi',
          'done',
          'exit 1',
        ].join('\n'),
      ],
      { DISPLAY: `:${display}` },
      seams,
    ).status === 0
  )
}

export function fitBoxChrome(
  agentId: string,
  home = automatonHome(),
  seams: BoxSeams = {},
): void {
  const display = mouthScreen(agentId, home).display
  boxExec(
    [
      'sh',
      '-c',
      [
        'best=; bw=0',
        'for id in $(xdotool search --onlyvisible --class chromium); do',
        '  eval $(xdotool getwindowgeometry --shell "$id")',
        '  if [ "${WIDTH:-0}" -gt "$bw" ]; then best=$id; bw=$WIDTH; fi',
        'done',
        `if [ -n "$best" ]; then xdotool windowmove "$best" 0 0 windowsize "$best" ${BOX_DISPLAY_W} ${BOX_DISPLAY_H} windowactivate --sync "$best"; fi`,
      ].join('\n'),
    ],
    { DISPLAY: `:${display}` },
    seams,
  )
}

export function stopBoxChrome(
  agentId: string,
  home = automatonHome(),
  seams: BoxSeams = {},
): void {
  boxExec(['pkill', '-f', '--', `user-data-dir=${boxProfileDir(agentId)}`], {}, seams)
}
