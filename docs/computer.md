# Computer

One local Docker Linux (`automaton-computer`). Automata are screens on that
box, not hypervisors. This repo is the native staff app. There is no org-box
host, Render stamp, or Python `face/` in this tree.

Three surfaces stay distinct:

| Surface | Role |
| --- | --- |
| This Mac | GPUI window. Chat, inspector, Take control blit. |
| Inference | OpenRouter mouth. Puppetmaster jobs against a git sandbox. |
| The computer | Persistent Docker Linux. Real X displays. Shared disk. |

The Mac is not the computer. Installing a CLI on the box does not `brew`
on the laptop. `~/.automaton` is bind-mounted into the box, so Chrome
profiles and captures survive sleep.

Staff uses display `:1`. Later automata get the next display. Each screen
is Xvfb plus a Chrome profile under `~/.automaton/desktops/<id>/`. Chrome is
lazy; disk stays when idle.

The image is `box/Dockerfile`. It ships `automaton-screen` (Xvfb,
root color) and headed Chromium. Rebuild after Dockerfile changes:

```sh
docker build -t automaton-computer:local box
```

Boot calls `ensureBox` then `ensureScreen` for the focused automaton. The
named container is recreated when the image id drifted,
`automaton-screen` is missing, Chromium debug ports are not published, or
the desktops bind is not this `AUTOMATON_HOME`. A leftover test home must
not keep capturing and clicking a different disk than the blit.

The test gate keys on `runningTests()` (`NODE_ENV=test` or `BUN_TEST`).
`bun test` sets `NODE_ENV=test` only; a gate that checks `BUN_TEST` alone
lets the suite recreate the live box bound to a temp home. Rebuild the
image after `box/screen.sh` changes too — recreate boots the baked copy,
not the checkout. Do not start a window manager: Fluxbox's frame eats
xdotool clicks. Chromium that only exists as a zombie, or a
`SingletonLock` from a previous container hostname, is not a live screen —
`ensureBrowser` relaunches.

## Take control

The inspector thumbnail is a capture of that X display. Take control opens
a large stage. The PNG is paint only: GPUIX `img` has empty hit bounds, and
`pointerEvents: none` does not pass the click through in the live renderer.
A filled glass (`desk-stage-view`, `T.desk.hit`) sits on top of the blit and
owns mouse, wheel, and keys. Mapping accepts window pixels or local pixels.
Then xdotool. Release is `onMouseDown` on the header button so a click on
the glass cannot dismiss the stage.

Capture polling is async (`captureDeskAsync`). Clicks are fire-and-forget
(`boxSpawn`). Neither may stall the GPUI tick. Recapture keeps the prior
decoded frame visible; each paint file is unique so GPUI does not cache a
stale PNG.

Staff does not pixel-click as a mouth. The operator drives the screen.
Named sites (Google) and https links are runtime URL opens
(`browse` → CDP `Page.navigate` on the box Chrome debug port, xdotool
omnibox as fallback). Staff acks `Opening {host}.` Auth is a dock card
with one instruction line; Take control latches the stage. Staff does not
type passwords (`keyDesk` is the operator on the blit only) and does not
lecture about the display.

The container publishes Chromium debug ports on loopback
(`127.0.0.1:9221` for display `:1`). Inside the box Chrome listens on
`0.0.0.0` so the published port works. That is not Marionette's Mac CDP
port 9333. Box Chrome is not launched with `--test-type` or
`--disable-infobars`; those flags mark a test browser and trip Google
captcha. Printable keys (including `.`) go through `xdotool type`. `xdotool
key .` is not an X keysym and is dropped.

PATH and apt asks are a `box-shell` job (`docker exec`), not implement on
this Mac. Do not stdio a PTY into the VM for computer-use.

Do not vendor exec-daemon, noVNC, or a hosted computer-use vendor. Host
Chrome is a fallback when the box is down, not a second computer.

Live capture proof (needs Docker):

```sh
bun scripts/prove-box-screen.ts
```

Writes `artifacts/box-screen.png`. That file is gitignored.
