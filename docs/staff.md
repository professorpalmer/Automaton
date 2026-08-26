# Staff surface

Native staff is a GPUI window authored in React (`src/app.tsx`). There is no
Electron shell and no webview. The product name is **Automaton**. The
titlebar shows that mark and word, then the focused mouth (Chief of Staff
until you switch). The window is opaque (`windowBackground: 'opaque'`) so
clicks land on the rail and composer.

Chief of Staff (`staff`) is the only seeded automaton. Other automata are
created from chat or the factory (`New automaton`). Each named automaton has
its own thread. The rail shows last spoken line, not a job-id chip.

On macOS, launch `macos/Automaton.app` (`bun run app`) so the menu bar is
Automaton. A `bun src/main.tsx` spawn from Cursor keeps Cursor as the
frontmost Mac app, which is why Cmd+Plus / Cmd+Minus zoom the editor
instead of this window.

The brand mark is the white control-bar marionette (`brand/mark.svg`). Rail
blobs are baked poses (`src/marks/`). Mouth busy thinks with wandering
eyes on an eyeless body; a flying job does not. Idle stays the rest PNG.

## Composer

Send stays Send while a job is running. Mouth busy is only a
live speak turn (`must_first` / `answer`). Fan-out to three or more named
automata needs a confirm card; dismiss means no send. Opening a login URL
puts a one-line auth card on the dock; Take control latches the stage.

Paste: screenshot flavors become attachments. Plain text (including copies
that also carry a TIFF preview) lands in the draft.

## Head seat

From Chief of Staff, a named ask dispatches at send time. Staff acks
(`Asking Kernel.`) without an OpenRouter turn. The sister thinks on its own
thread. When that sister finishes, Staff speaks an assessment; it does not
paint the sister's words as its own bubble.

GitHub URLs bind a product home onto the named automata. Bound code work
seeds from that checkout, never this Automaton tree.

## Inspector

Cmd+Shift+I opens the inspector: computer status, screen thumbnail, and
Take control. Settings holds OpenRouter and the model plane.

## Related

- [Computer](computer.md)
- [Jobs](jobs.md)
- [Durable state](durability.md)
