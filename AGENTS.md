# Automaton

This repository is two product surfaces that share a name. Native staff is not
a second orchestrator. Do not start the Python org-box host to run native
staff, and do not start native staff to run a tenant box.

## Native staff

Named automata have their own threads. Chief of Staff is the only seeded
automaton; others are created by the user or by Staff. Automata speak, then
dispatch. Puppetmaster is the only job runtime. Workers never appear as chat.

The native face is React authored and rendered through Zed GPUI using
`@gpuix/react`. Domain logic in `src/domain.ts` and `src/session.ts` is pure.
Jobs live in `src/runtime/pm.ts` and `src/runtime/jobs.ts`. Implement workers
use a sandbox cwd and never this checkout. Visual tokens live in
`src/tokens.ts`.

```sh
bun install
bun test
bun src/main.tsx
```

`bun --hot src/main.tsx` remounts can leave a zombie window. Prefer
`bun src/main.tsx`. `bun scripts/probe-kernel.ts` is a read-only analyze
launch. `bun scripts/probe-mouth.ts` exercises the bounded OpenRouter mouth
and its zero-call query path.

The computer is one local Docker Linux. Every automaton shares that machine.
An automaton is a cheap screen (X display plus a Chrome profile), not another
hypervisor. Chrome is lazy; disk stays when idle. Do not vendor exec-daemon
or noVNC. Do not bill a hosted computer-use vendor.

Native invariants:

- Running a job is not mouth busy. Composer stays Send.
- Fan-out to 3+ automata needs confirmation. Dismiss means no send.
- Completion wakes the owning automaton. It is unread when the user is on
  another thread.
- No job ids in spoken lines unless the user asked.
- Staff does not pixel-click. The operator takes control of the screen.

## Org-box host

The Python host is under `face/`, `harness/`, and `provision/`. It is a
separate product surface. The operator talks to a chief of staff; the host
stamps isolated boxes onto the tenant's Render account. It is not a
multi-tenant service.

Host gates:

- Tenants pay their own tokens, Render, and git costs. Never bundle host
  operator keys or sell inference.
- Secrets stay in the box vault, never in the wiki or git.
- Environment variables do not grant FormAssembly, SharePoint, or Salesforce
  access.
- Product memory lives in the org-box catalog, not an external wiki.
- Do not ship or claim hundreds of tenants without the corresponding proof.

Layout:

- `face/` — chief-of-staff UI.
- `harness/` — gates, vault, jobs, vision, factory, and steer.
- `provision/` — host that stamps isolated boxes onto Render.
- `tenant/` — isolated org boxes.

## Safety

Do not put secrets in git or public write-ups.
