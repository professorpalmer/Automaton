# Automaton

Named automata have their own threads. Chief of Staff is the only seeded
automaton; others are created by the user or by Staff. Automata speak, then
dispatch. The mouths are a harness for this Mac, not a chatbot about this
checkout. Puppetmaster runs analyze and implement against the named
product tree. Box-shell is `docker exec` on the shared computer, not a chat
PTY. Land and ship are host git/gh jobs, not mouths. Workers never appear as
chat.

The native face is React authored and rendered through Zed GPUI using
`@gpuix/react`. Domain logic in `src/domain.ts` and `src/session.ts` is pure.
Jobs live in `src/runtime/pm.ts` and `src/runtime/jobs.ts`. Implement workers
use a sandbox cwd and never this checkout. Visual tokens live in
`src/tokens.ts`.

```sh
bun install
bun test
bun run app
```

CI is `bun test`. There is no Python host, pytest job, or `tenant/` tree.

`bun src/main.tsx` is the raw GPUI process. On macOS, `bun run app` opens
`macos/Automaton.app` so the Dock icon and the menu bar belong to Automaton
instead of a bun terminal tile. `bun --hot src/main.tsx` remounts can leave a
zombie window. Prefer `bun run app`. `bun scripts/probe-kernel.ts` is a
read-only analyze launch. `bun scripts/probe-mouth.ts` exercises the bounded
OpenRouter mouth and its zero-call query path. `bun scripts/replay-tough-eval.ts` measures recall safety on a seeded mixed workload; it is not the 95% repeated-work replay. `bun scripts/replay-workday-eval.ts` streams a seeded workday from an empty store (persist job-sourced Kernel claims after first-look misses; 5/10/20% novel) and writes the saturation ledger.

The computer is one local Docker Linux. Every automaton shares that machine.
An automaton is a cheap screen (X display plus a Chrome profile), not another
hypervisor. Chrome runs on the box. This Mac must not keep a headless Google
Chrome. Chrome is lazy; disk stays when idle. Do not vendor exec-daemon
or noVNC. Do not bill a hosted computer-use vendor.

Invariants:

- Running a job is not mouth busy. Composer stays Send. A live mouth does not lock Send; mid-turn words wait on a steer queue.
- Fan-out to 3+ automata needs confirmation. Dismiss means no send.
- Completion continues leftover steps from the original ask. Staff owns
  that GoalRun; workers do not schedule leftover.
- A GitHub issue or pull URL is work. A pull plus validate starts
  analyze; absorb-only stays implement-first. Explicit merge/release
  wording compiles the GoalRun. Do not run git/gh until the native
  widget is answered; cancel settles the goal. Binding a home is not
  the job.
- The rail has no unread badges. Staff is the head seat; sisters are workers.
- No job ids in spoken lines unless the user asked.
- Staff does not pixel-click. The operator takes control of the screen.

## Safety

Do not put secrets in git or public write-ups.
