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

The image is `box/Dockerfile`. It ships `automaton-screen` (Xvfb, fluxbox,
root color) and headed Chromium. Rebuild after Dockerfile changes:

```sh
docker build -t automaton-computer:local box
```

Boot calls `ensureBox` then `ensureScreen` for the focused automaton. The
named container is recreated when the image id drifted or
`automaton-screen` is missing.

## Take control

The inspector thumbnail is a capture of that X display. Take control opens
a large stage. Mouse down, drag, wheel, and keys hit the filled
`desk-stage-view` pane, then xdotool. The PNG is paint only: GPUIX `img`
has no hit bounds. Release is `onMouseDown` on the header button so a
click on the blit cannot dismiss the stage.

Capture polling is async (`captureDeskAsync`). Clicks are fire-and-forget
(`boxSpawn`). Neither may stall the GPUI tick. Polling pauses while the
pointer is down.

Staff does not pixel-click as a mouth. The operator drives the screen.
Named sites (Google) and https links are runtime URL opens
(`openDeskUrl`). Staff acks `Opening {host} on this screen. Take control
to sign in.` It does not type passwords and does not lecture about the
display.

Do not vendor exec-daemon, noVNC, or a hosted computer-use vendor. Host
Chrome is a fallback when the box is down, not a second computer. Do not
stdio a PTY into the VM for computer-use; tools talk to docker exec.

Live capture proof (needs Docker):

```sh
bun scripts/prove-box-screen.ts
```

Writes `artifacts/box-screen.png`. That file is gitignored.
