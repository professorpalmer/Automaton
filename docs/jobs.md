# Jobs

Puppetmaster runs analyze and implement. Box-shell is `docker exec` on the
shared computer so PATH and apt do not pretend this Mac is the machine.
Land pushes dest and merges dest into main. Promote is done only when
current origin/dev and origin/main match; pending required checks wait
on the same job and are not a success or a Staff blocker. Failed
required checks hard-fail. After the first wait, retries reconcile the
open dest PR and remotes and do not push HEAD again. The job strip still
shows every running job; dispatch runs at most one promote/ship per
owner so concurrent GoalRuns cannot race origin/dev. Isolated
analyze/implement stay concurrent. Ship tags a version already on the
tree. Workers never appear as chat. Spoken lines must not include job
ids unless the user asked.

## Analyze vs implement vs shell vs land

Kit sets the default. Code mouths book implement on job-shaped asks.
Lookup mouths book analyze. Chief of Staff books analyze for explicit
lookup phrasing, and may book implement when the line is a job and no
sister is named. PATH, `which`, and apt-install-on-the-computer book
`box-shell` first. A numbered GitHub issue or pull URL is Staff-owned GoalRun work on the
bound product mouth. A pull plus validate/review starts `analyze`;
absorb-only stays `implement`. Explicit merge/release wording offers a native widget
(primary merge, danger cancel). Failed GATE still does not enqueue merge. A GitHub URL plus a
release ask never compiles absorb then ship without promote. Bare
`tag`/`tagged` or incidental `shipping` prose is not a release. Listing
"open issues" without a number stays analyze.

Analyze runs read-only against the named checkout on this Mac
(`~/Projects/Puppetmaster` when they asked about Puppetmaster). Bound
`homePath` is next. This Automaton tree is last for analyze and
implement, and only when nothing else matched. Implement copies the
chosen git tree into an isolated sandbox under
`~/.automaton/sandboxes/`. It never writes the live Automaton checkout.
Box-shell never calls Puppetmaster. Promote and ship run `git`/`gh` on
the same-goal implement sandbox, or a bound checkout: a named machine
project, an existing `homePath` git tree, or an owner-hint match. They
never inherit this Automaton tree. Unbound host land waits before any
`git`/`gh`. They never force-push. Ship does not bump a version; it
fails closed without one.

Bind a GitHub home from Staff (`Point Kernel at https://github.com/…`).
`homePath` is a local clone under `~/Projects/<repo>` when that checkout
exists. The runtime does not clone for you.

## Composer

A flying job is not mouth busy. Send stays Send. Staff owns the GoalRun.
A worker terminal reconciles that criterion; success books the next unmet
step on the same product mouth; a terminal fail does not book downstream
and Staff speaks one blocker. Missing product checkout, binding, or
OpenRouter key, and concrete GitHub or Puppetmaster auth denial
(`Unauthorized`, `authentication failed`, `HTTP 401`/`403`,
`gh auth login`), park the job as `waiting` and the GoalRun as
`waiting_user`. Generic `permission denied` stays failed. Those jobs
are not dispatchable. Retry settles the parked job, then books a fresh
id for the same criterion. Cancel settles the goal and the parked job
without dispatch. Pending
required checks stay `waiting_external` on the same running job. Generic
worker, test, or merge failures stay failed. Staff assesses a sister only
after every criterion is met. Concurrent GoalRuns persist on the session
snapshot. The blocker panel is Staff chrome, not a chat message.
While a job flies, the strip may show `Still running.` A status ask
restates that line and does not start a new mouth turn. Jobs do not
pixel-click the shared computer. Take control is the operator on that
X display.

## Probes

```sh
bun run doctor
bun scripts/probe-kernel.ts
```

`probe-kernel.ts` is analyze only. Do not pass `--implement` at this
checkout.
