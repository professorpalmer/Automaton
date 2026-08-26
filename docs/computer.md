# Computer

One local Docker Linux (`automaton-computer`). Automata are screens on that
box, not hypervisors.

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
a large stage; clicks and keys hit the filled stage pane, then xdotool.
The PNG is paint only. Release closes the stage. Staff does not pixel-click
as a mouth. The operator drives the screen. Named sites (Google) and
https links are runtime URL opens; Staff does not lecture about the
display.

Do not vendor exec-daemon, noVNC, or a hosted computer-use vendor. Host
Chrome is a fallback when the box is down, not a second computer.

Live capture proof (needs Docker):

```sh
bun scripts/prove-box-screen.ts
```

Writes `artifacts/box-screen.png`. That file is gitignored.
