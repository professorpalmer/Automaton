# Automaton

Automaton is two products in one repository.

**Native staff** is a GPUI window: automata speak, then dispatch.
Puppetmaster runs jobs. Workers stay out of chat. One local Docker Linux is
the shared computer; each automaton is a screen on that box, not a VM.

**Org-box host** is the Python stack under `face/`, `harness/`, and
`provision/`. It stamps an isolated tenant box onto the tenant's Render
account. Different runtime. Do not start one to run the other.

## Docs

- [Staff surface](docs/staff.md) — rail, composer, factory, inspector
- [Computer](docs/computer.md) — Docker Linux box, screens, Take control
- [Jobs](docs/jobs.md) — Puppetmaster analyze and implement
- [Durable state](docs/durability.md) — store, claims, keys
- [Org-box host](docs/org-box.md) — tenant boxes, vault, provision
- [Contributor contract](AGENTS.md) — invariants for agents and humans

## Native staff

Needs [Bun](https://bun.sh), Docker, and a Puppetmaster CLI on `PATH`.
OpenRouter is configured in Settings (or `~/.automaton/keys.json`).

```sh
bun install
bun test
bun run app
```

On macOS, `bun run app` opens `macos/Automaton.app` so the Dock and the
menu bar say Automaton. `bun src/main.tsx` still works, but a bun process
spawned from Cursor stays under Cursor's menu (Cmd+Plus / Cmd+Minus go to
the editor). The in-window titlebar paints **Automaton** next to the
focused mouth.

`--hot` remounts can leave a zombie window. If clicks miss, quit leftover
Automaton windows and run `bun run app` (or `bun src/main.tsx`).

`bun run doctor` checks Puppetmaster. `bun scripts/probe-kernel.ts` launches
a read-only analyze job. Never run an implement worker against this
checkout; implement work uses a sandbox.

Layout:

- `@gpuix/react` on Zed GPUI (`src/main.tsx`)
- Domain and session: `src/domain.ts`, `src/session.ts`
- Durable SQLite: `src/runtime/store.ts`
- Mouth: `src/runtime/mouth.ts`
- Jobs: `src/runtime/pm.ts`, `src/runtime/jobs.ts`
- Tokens: `src/tokens.ts`
- Mark: `brand/mark.svg` (automata on one computer)
- Box image: `box/Dockerfile`

## Org-box host

```sh
python3 -m venv .venv
.venv/bin/python -m pip install -e ".[dev]"
.venv/bin/python -m pytest tests -q
.venv/bin/automaton
```

Open http://127.0.0.1:8765. Host keys are tenant-scoped. Secrets stay in
the tenant vault.

## License

MIT. See [LICENSE](LICENSE).
