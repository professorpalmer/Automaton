# Automaton

Staff product. GPUIX face. Puppetmaster workers. Not Marionette. Not ToyVendor.

## Product

Off-Marionette durable staff. Named mouths (Staff, Kernel, Research) with their own threads. Agents speak, then dispatch. Puppetmaster is the only job runtime. Workers never appear as chat.

ToyVendor is the conserved SA operator box (`~/Projects/ToyVendor`). Leave it alone.

## Stack

- Face: React + `@gpuix/react` rendering through Zed GPUI. Not Electron. Not GPUI-component. Not a second orchestrator.
- Domain: `src/domain.ts`, `src/session.ts`. Pure. Tests do not need a window.
- Jobs: `src/runtime/pm.ts` + `src/runtime/jobs.ts`. Puppetmaster CLI sidecar. Sandbox cwd, never this checkout.
- Tokens: `src/tokens.ts` only. No one-off hex in components.
- Steal chrome habits from GPUIX `examples/chat.tsx` (titlebar, rail, composer, motion.div). Do not port Waku/GrokBot private kits.

## Run

```
bun install
bun test
bun --hot src/main.tsx
bun scripts/probe-kernel.ts
```

## Invariants

- Running a job is not mouth busy. Composer stays Send.
- Fan-out to 3+ agents needs confirm. Dismiss = no send.
- Completion wakes the owning mouth. Unread if the user is on another thread.
- No job ids in spoken lines unless the user asked.
- Do not commit, push, or rename GitHub remotes unless the owner asked.
