# Automaton

This repository contains the Automaton product and its native GPUIX staff
surface. The staff surface is not Marionette, ToyVendor, or a second
orchestrator.

## Native staff

Named mouths (Staff, Kernel, Research) have their own threads. Agents speak,
then dispatch. Puppetmaster is the only job runtime. Workers never appear as
chat.

The native face is React authored and rendered through Zed GPUI using
`@gpuix/react`. The domain in `src/domain.ts` and `src/session.ts` is pure.
Jobs live in `src/runtime/pm.ts` and `src/runtime/jobs.ts`; implement workers
use a sandbox cwd and never the live checkout. Tokens live in `src/tokens.ts`.

Run the native staff surface with:

```sh
bun install
bun test
bun --hot src/main.tsx
```

`bun scripts/probe-kernel.ts` exercises a read-only PM analyze launch.
`bun scripts/probe-mouth.ts` exercises the bounded OpenRouter mouth and its
zero-call query path.

Native invariants:

- Running a job is not mouth busy. Composer stays Send.
- Fan-out to 3+ agents needs confirmation. Dismiss means no send.
- Completion wakes the owning mouth. It is unread when the user is on another
  thread.
- No job ids in spoken lines unless the user asked.
- Do not commit, push, or rename GitHub remotes unless the owner asked.

## Existing org-box host

The Python org-box host remains under `face/`, `harness/`, and `provision/`.
It is a separate product surface in this repository and should not be
conflated with the native `src/` runtime.

Its first tenant is Soldiers' Angels. The operator talks to a chief of staff;
the host stamps isolated boxes onto the client's Render. It is not a
multi-tenant claim.

Host gates:

- Clients pay their own tokens, Render, and git costs. Never bundle Cary's
  keys or sell inference.
- Secrets stay in the box vault, never in the wiki or git.
- Environment variables do not grant FormAssembly, SharePoint, or Salesforce
  access.
- Product memory lives in the org-box catalog, not Portable LLM Wiki.
- Do not ship or claim hundreds of clients without the corresponding proof.

Host layout:

- `face/` — chief-of-staff UI.
- `harness/` — gates, vault, jobs, vision, factory, and steer.
- `provision/` — host that stamps isolated boxes onto Render.
- `tenant/soldiers-angels/` — the first isolated org box.

## Shared safety

- The conserved ToyVendor operator box at `~/Projects/ToyVendor` is separate;
  leave it alone.
- Do not put secrets in git, the wiki, or public write-ups.
