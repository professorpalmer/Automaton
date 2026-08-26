# Automaton

Automaton contains a native durable staff surface and the existing Python
org-box host. They share the product name but have separate runtimes and
boundaries.

## Native GPUIX staff

The native face is React authored and
[GPUI](https://github.com/zed-industries/zed/tree/main/crates/gpui) rendered
through [GPUIX](https://github.com/remorses/gpuix). There is no Electron or
webview. Staff, Kernel, and Research speak through a bounded OpenRouter mouth;
Puppetmaster runs jobs and workers stay out of chat.

### Run

```
bun install
bun test
bun --hot src/main.tsx
```

`bun run doctor` checks that Puppetmaster is available. The read-only
`bun scripts/probe-kernel.ts` launches an analyze job. Never run an implement
worker against this checkout; implement work uses a sandbox. The
`bun scripts/probe-mouth.ts` probe demonstrates a zero-call stored-result hit
before a live mouth inference.

The native stack is:

- `@gpuix/react` and `@gpuix/native` on Zed GPUI
- Pure domain and session logic in `src/domain.ts` and `src/session.ts`
- Durable SQLite state in `src/runtime/store.ts`
- Bounded mouth logic in `src/runtime/mouth.ts`
- Puppetmaster dispatch in `src/runtime/pm.ts` and `src/runtime/jobs.ts`
- Shared visual tokens in `src/tokens.ts`

## Python org-box host

The Python host is under `face/`, `harness/`, and `provision/`. It stamps an
isolated Automaton box onto a client's Render account. The first tenant is
Soldiers' Angels. It is not a multi-tenant service.

```sh
python3 -m venv .venv
.venv/bin/python -m pip install -e ".[dev]"
.venv/bin/python -m pytest tests -q
.venv/bin/automaton
```

Open http://127.0.0.1:8765. Host keys are tenant-scoped; the host does not use
Cary's personal keys. Secrets stay in the tenant vault and never enter git or
the wiki.

## Durable-state direction

Both surfaces treat durable state as the backend and model context as a
bounded working set. Query stored claims and verified artifacts before paying
for inference. Keep workers ephemeral, retain provenance, and measure avoided
calls rather than treating unknown cost as zero.
