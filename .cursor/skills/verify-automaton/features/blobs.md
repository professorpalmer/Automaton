# Sister blobs

The rail mouths are baked 3D marks, not gray dots or fill chips. Shape and hue come from `{shape, tint}` frames. Idle is still. Selected lifts. Only the speaking mouth chews. GPUIX tweens `motion.div` opacity between five stills. Do not run a 16ms React clock. Do not scale the bitmap to fake squash.

## Sub-features

- Staff is `blob` (HEAD), Kernel is `hex`, Research is `tablet`
- Disk stills: `rest`, `breathe`, `selected`, `chew-a`, `chew-b`
- Live paint mounts those five `<img>`s once and crossfades opacity
- Selected lifts 2px and holds `selected`. Unread is a badge, not a glyph pulse
- Only the currently speaking mouth chews. A flying Puppetmaster job does not
- Titlebar and composer stay still. Feed rows do not take Motion layout props

## How to get to it (user POV)

Launch Automaton. The left rail shows Staff, Kernel, and Research as three different baked faces. Click one to select it — it lifts and holds. Send a message — that mouth chews while it speaks. A Kernel job in the strip is a handle, not a chew.

## Driving it with bun test / GPUIX TestRenderer

`tests/shell.test.tsx` locators: `blob-staff`, `blob-kernel`, `blob-research`. Seed frames must exist under `src/marks/<shape>/<tint>/`. `presentBlob` chew weights stay 0 when `mouthBusy` is false. `blobNeedsClock` is false unless the mouth is busy. Glyph size stays `T.blob.size` after enter. `src/blob.tsx` must not set `backgroundColor`.

## Gotchas

A running job is not mouth busy. Do not chew Kernel because a handle is flying. Do not bounce the titlebar. A tinted SVG or fill `motion.div` as the rail face fails this slice. Do not claim 95% cache from blob motion or ledger chrome. Do not sample a dense pose cycle at runtime. Absolutely positioned pose layers must set `pointerEvents: 'none'` — GPUIX blocks hits on unsized abs nodes even at opacity 0, which eats rail clicks.
