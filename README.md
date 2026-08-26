# Automaton

Durable staff over Puppetmaster. Mouths speak. Workers stay mute. Jobs are handles.

The face is React authored and [GPUI](https://github.com/zed-industries/zed/tree/main/crates/gpui) rendered through [GPUIX](https://github.com/remorses/gpuix). No Electron. No webview. This is the vs-React experiment against Marionette.

ToyVendor (Soldiers' Angels operator box) is a different product. Do not merge them.

## Run

```
bun install
bun test
bun --hot src/main.tsx
```

`bun run doctor` checks that `puppetmaster` is on PATH (`~/.local/bin` on this Mac). Kernel speaks, then `puppetmaster run --config` (Cursor grok-4.6 analysis, MCP twin) runs against this checkout. Never `--implement` on this checkout. `bun scripts/probe-kernel.ts` prints a real `job_id`.

Send stays Send while a job flies. Click Kernel, ask it to fix something long enough to look like a job, switch back to Staff, keep talking.

## Stack

- `@gpuix/react` / `@gpuix/native` (GPUIX 0.4) on Zed GPUI
- Domain in `src/domain.ts` + `src/session.ts` (pure; tested without a window)
- Tokens in `src/tokens.ts` only

Puppetmaster dispatch is next. Wave 1 uses an in-process job handle so the mouth/job split is real before the subprocess exists.
