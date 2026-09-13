# Automaton

Named automata have their own threads. Chief of Staff is the only seeded
automaton; others are created by the user or by Staff. Automata speak, then
dispatch. The mouths are a harness for this Mac, not a chatbot about this
checkout. Puppetmaster runs analyze and implement against the named
product tree. Box-shell is `docker exec` on the shared computer, not a chat
PTY. Land and ship are host git/gh jobs, not mouths. Workers never appear as
chat.

The native face is React authored and rendered through Zed GPUI using
`@gpuix/react`, pinned to `file:vendor/gpuix-react-0.6.1.tgz` (spring lease
parking). Automaton consumes that package; it does not publish the `@gpuix`
npm scope. Domain logic in `src/domain.ts` and `src/session.ts` is pure.
Jobs live in `src/runtime/pm.ts` and `src/runtime/jobs.ts`. Implement workers
use a sandbox cwd and never this checkout. Visual tokens live in
`src/tokens.ts`.

```sh
bun install
bun test
bun run app          # cold default; reclaim zombies
# bun run dev        # opt-in --hot only
```

CI is `bun test`. There is no Python host, pytest job, or `tenant/` tree.

`bun src/main.tsx` is the raw GPUI process. On macOS, `bun run app` is the
cold default: it opens `macos/Automaton.app` so the Dock icon and the menu bar
belong to Automaton instead of a bun terminal tile, and it reclaims prior
windows/pids for this install before focus/open (no default `open -n` stack).
`bun run dev` / `bun --hot src/main.tsx` is **dev-only / opt-in** — remounts can
leave a zombie window; prefer `bun run app`. Doctor WARNs on leftovers with a
path to kick cold. `bun scripts/probe-kernel.ts` is a
read-only analyze launch. `bun scripts/probe-mouth.ts` exercises the bounded
OpenRouter mouth and its zero-call query path. `bun scripts/replay-repeated-work.ts` is a measured synthetic bench (19/20 under a seeded claim), not a live 95% product claim. `bun scripts/replay-tough-eval.ts` measures recall safety on a seeded mixed workload. `bun scripts/replay-workday-eval.ts` streams a seeded workday from an empty store (persist job-sourced Kernel claims after first-look misses; 5/10/20% novel) and writes the saturation ledger.

The computer is one local Docker Linux. Every automaton shares that machine.
An automaton is a cheap screen (X display plus a Chrome profile), not another
hypervisor. Chrome runs on the box. This Mac must not keep a headless Google
Chrome. Chrome is lazy; disk stays when idle. Do not vendor exec-daemon
or noVNC. Do not bill a hosted computer-use vendor.

Invariants:

- Idle GPUI sleeps: no idle `MotionDiv` / spring ticks on sisters
  (`src/resting-motion.ts`). Feed grow ticks coalesce and pin the tail
  (`src/runtime/feed-pin.ts`); row fingerprints avoid wholesale rebuilds
  (`src/runtime/feed-row.ts`). Re-verify with `docs/idle-cpu.md` /
  `bun run sample:idle-cpu` (CI soft-skips GUI metrics).
- PM watch/attach uses async status/refs (`WATCH_POLL_MS` 2500). Already-
  terminal jobs settle on hydrate via `attachExisting`. Tooling words
  (`puppetmaster`, `codegraph`, …) must not steal land/promote cwd from
  `matchMachineProject`.
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
- Provider maps are verified-or-none; no capture, no map.
- Live world-state books analyze; claims are recall-only.
- Product routines (`docs/routines.md`) wake mouths on schedule/event with kickoff `routine`; they are not Grok Bot agent crons. MVP schedule ticks need the Staff app open.
- External channels (`docs/channels.md`) — Slack MVP: connect in Settings (never paste bot tokens in chat); inbound via `~/.automaton/inbox/slack` or future socket; `kickoff=channel` wakes Staff; outbound fail-closed as the user. Channel traffic is mouth/staff; Jobs still own coding.
- Multi-agent rooms (`docs/rooms.md`) — local SendToAgent-class + named rooms; sisters keep separate threads; mouth only (not Slack); `needsFanoutConfirm` for 3+; package 0.3.0.
- MCP catalog (`docs/mcp.md`) — Settings curated plugins; install registry under `~/.automaton/mcp`; auth via secret-request / Connect (never chat-paste); schema hints only until live MCP client; package 0.3.0.
- Secrets (`docs/secrets.md`) — in-app secret-request card with masked entry; vault via `writeConnectorSecret`; never persist secret values in session JSON / feed / Jobs / Slack / speech; package 0.3.0.
- Version / releases (`docs/version.md`) — Settings About + optional titlebar chip from `package.json` / Info.plist; GitHub Latest notify-only (never auto-upgrade); git tip/dirty modal stays; doctor WARNs on package≠plist; package 0.3.0.
- Skills library (`docs/skills.md`) — Settings list/author local skills; imported read-only body; pin via agent skillIds; offer-once widget on composer match; mouths stay Send; package 0.3.0.
- Idle CPU (`docs/idle-cpu.md`) — park inventory + Mac idle proof; doctor notes checklist (optional `AUTOMATON_IDLE_CPU=1` live sample); package 0.3.0.
- Living marks (`docs/marks.md`) — selected glance / soft melt / lid springs; sister-freeze parks idle rail; honesty on stubby life; package 0.3.0.

## Safety

Do not put secrets in git or public write-ups.
