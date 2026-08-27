# Automaton

A GPUI window of named automata. They speak, then dispatch. Puppetmaster
runs jobs. Workers stay out of chat. One local Docker Linux is the shared
computer; each automaton is a screen on that box, not a VM.

## Docs

- [Staff surface](docs/staff.md) — rail, composer, factory, inspector
- [Computer](docs/computer.md) — Docker Linux box, screens, Take control
- [Jobs](docs/jobs.md) — analyze, implement, box-shell, land, and ship
- [Durable state](docs/durability.md) — store, claims, keys
- [Contributor contract](AGENTS.md) — invariants for agents and humans

## Run

Needs [Bun](https://bun.sh), Docker, and a Puppetmaster CLI on `PATH`.
OpenRouter is configured in Settings (or `~/.automaton/keys.json`).

```sh
bun install
bun test
bun run app
```

On macOS, `bun run app` opens `macos/Automaton.app` so the Dock and the
menu bar say Automaton. That wrapper is a Mach-O stub plus bun copied into
the bundle; Homebrew bun in the Dock is a terminal tile. `bun src/main.tsx`
still works, but a bun process spawned from Cursor stays under Cursor's
menu (Cmd+Plus / Cmd+Minus go to the editor). The in-window titlebar paints
**Automaton** next to the focused mouth.

`--hot` remounts can leave a zombie window. If clicks miss, quit leftover
Automaton windows and run `bun run app` (or `bun src/main.tsx`).

`bun test` is the suite. CI runs that job on macOS. `bun run doctor` checks
Puppetmaster. `bun scripts/probe-kernel.ts` launches a read-only analyze
job. Never run an implement worker against this checkout; implement work
uses a sandbox.

Layout:

- `@gpuix/react` on Zed GPUI (`src/main.tsx`)
- Domain and session: `src/domain.ts`, `src/session.ts`
- Durable SQLite: `src/runtime/store.ts`
- Mouth: `src/runtime/mouth.ts`
- Jobs: `src/runtime/pm.ts`, `src/runtime/jobs.ts`
- Tokens: `src/tokens.ts`
- Mark: `brand/mark.svg` (control-bar marionette)
- Box image: `box/Dockerfile`

## License

MIT. See [LICENSE](LICENSE).
