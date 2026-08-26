# Staff surface

Native staff is a GPUI window authored in React (`src/app.tsx`). There is no
Electron shell and no webview. The product name is **Automaton**. The
titlebar shows that mark and word, then the focused mouth (Chief of Staff
until you switch). The window is opaque (`windowBackground: 'opaque'`) so
clicks land on the rail and composer.

Chief of Staff (`staff`) is the only seeded automaton. Other automata are
created from chat or the factory (`New automaton`). Each named automaton has
its own thread. The rail shows last spoken line, not a job-id chip or an
unread count. Work goes through Chief of Staff; sisters are workers.

Staff is a harness for this Mac, like a general chat that can look at any
checkout under `~/Projects`. Automaton is the app, not the default subject.
Questions about Marionette or Puppetmaster book a look against those trees.

On macOS, launch `macos/Automaton.app` (`bun run app`) so the Dock icon and
the menu bar are Automaton. The window process is bun copied into that
bundle, not Homebrew bun (that tile is a terminal). A `bun src/main.tsx`
spawn from Cursor keeps Cursor as the frontmost Mac app, which is why
Cmd+Plus / Cmd+Minus zoom the editor instead of this window.

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

GPUI paints text without selection, so copy is per bubble: right-click any
chat bubble to put its text on the Mac pasteboard. A small Copied mark
flashes under the bubble.

## Head seat

From Chief of Staff, a named ask dispatches at send time. Staff acks
(`Asking Kernel.` / `Telling Marionette and Puppetmaster.`) without an
OpenRouter turn. The feed shows Sent to. `Check Marionette and Puppetmaster`
after check/ask/tell/have/ping/see-if is an order; a vocative name or a
question that only mentions a product is not. A product-stack question
(`What is Dugout's stack`) books a Staff look against that checkout at
send time; Staff does not offer to dispatch. `Ask Puppetmaster to look at
the repo` sends the remainder and books analyze on that mouth, using its
bound or named checkout, not Automaton. The sister thinks on its own
thread. When that sister's leftover steps finish, Staff speaks an
assessment; it does not paint the sister's words as its own bubble.

GitHub URLs bind a product home onto the named automata, and so does a
local repo mention (`the local dugout repo` binds `~/Projects/dugout`).
`create a new bot ... name the bot Dugout` registers Dugout on the roster
at send time; the runtime does the provisioning, not the mouth. Bound code
work seeds from that checkout, never this Automaton tree. A note that
names a concrete file (`surface its agents.md`) books an analyze look on
the sister's checkout instead of a bare mouth turn.

## Inspector

Cmd+Shift+I opens the inspector: computer status, screen thumbnail, and
Take control. Settings holds OpenRouter and the model plane.

## Related

- [Computer](computer.md)
- [Jobs](jobs.md)
- [Durable state](durability.md)
