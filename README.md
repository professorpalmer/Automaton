# Automaton

Native GPUI staff over Puppetmaster. Named automata speak, then dispatch.
Durable state is queried first. Jobs stay out of chat. One local Docker
Linux is the shared computer; automata are screens, not VMs.

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
bun run app          # cold default (Dock face; reclaim zombies)
# bun run dev        # opt-in --hot remounts only; can zombie — prefer app
```

On macOS, `bun run app` opens `macos/Automaton.app` so the Dock and the
menu bar say Automaton. That wrapper is a Mach-O stub plus bun copied into
the bundle; Homebrew bun in the Dock is a terminal tile. `bun src/main.tsx`
still works, but a bun process spawned from Cursor stays under Cursor's
menu (Cmd+Plus / Cmd+Minus go to the editor). The in-window titlebar paints
**Automaton** next to the focused mouth.

Cold launch is `bun run app` (default / Update relaunch). `bun run dev`
(`bun --hot src/main.tsx`) is **dev-only / opt-in** — remounts can leave a
zombie window. Cold open reclaims prior Automaton windows for this install
before focusing or opening the face (no default `open -n` stack). If clicks
miss or doctor WARNs on leftovers, quit them and kick cold with `bun run app`.

`bun test` is the suite. CI runs that job on macOS. `bun scripts/replay-repeated-work.ts` is a **bench** for synthetic repeated-domain recall (measured 19/20 under a seeded claim) — not a live product guarantee. `bun scripts/replay-tough-eval.ts` measures recall safety (avoidance, false-hit rate, stale-hit rate, cost) on a seeded mixed workload; it is separate from that bench. `bun run doctor` checks
Puppetmaster. `bun scripts/probe-kernel.ts` launches a read-only analyze
job. Never run an implement worker against this checkout; implement work
uses a sandbox.

Layout:

- `@gpuix/react` on Zed GPUI (`src/main.tsx`), pinned to
  `file:vendor/gpuix-react-0.6.1.tgz` (parked spring MotionDiv leases).
  Automaton consumes `@gpuix`; it does not publish that npm scope.
- Idle parks: `src/resting-motion.ts` (blob springs),
  `src/runtime/feed-pin.ts` / `feed-row.ts` (tail pin + row fingerprints)
- Domain and session: `src/domain.ts`, `src/session.ts`
- Durable SQLite: `src/runtime/store.ts`
- Mouth: `src/runtime/mouth.ts`
- Jobs: `src/runtime/pm.ts`, `src/runtime/jobs.ts`
- Tokens: `src/tokens.ts`
- Mark: `brand/mark.svg` (control-bar marionette)
- Box image: `box/Dockerfile`

## License

MIT. See [LICENSE](LICENSE).
