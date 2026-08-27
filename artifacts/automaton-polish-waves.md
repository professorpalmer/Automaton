# Automaton polish waves

Wave 2 (this branch): steer-queue. Stop here.

Chief of Staff is the only seeded mouth. `dropUnclaimedSeedSisters` stays. Do not seed Kernel or Research. Users spin up more automata via the Chief / factory (`addLiveAgent` / New agent). GPU tweens stay size / pos / opacity / radius. No glass window. Do not touch `pm.ts`, blob bake, I2/J2, Puppetmaster, or Marionette.

## 1. First-open greeting — DONE

Parked spec: `artifacts/automaton-intro-greeting.md`.

- Empty new thread is not blank. Dedicated mouth `intro` (not `must_first` / `answer`).
- `isMouthBusy('intro')` so the mark chews. `composerEnterBusy('intro')` is false so Send stays Send.
- `maybeIntro` from `setActive` (when `introPlayedAt` is passed) and `addLiveAgent` when focused.
- Hidden cue in `buildWorkingSet({ intro: true })`. No claims, attachments, dispatch, or `jobKindForKit`.
- Cheap model `openai/gpt-4o-mini`. Offline / no key uses `{name}. {title}.`
- `introPlayedAt` on the profile. Once per automaton. User send first wins and still stamps the flag.
- Tiny copy that the Chief is how you make more is in the Staff intro cue.

## 2. Steer-queue — DONE

Send stays live while a mouth turn is in flight. Queued user text does **not** append to `thread.items` until drain. Stop-then-steer survives Stop: the parked line is the next turn, not a leftover bubble. A job/delegation queue is dropped on Stop.

`shouldQueueSteer(mouth, computerBusy)` parks mid-turn Send. `composerEnterBusy` is false so Send stays Send. Drain after `completeMouth` / `failMouth` / idle job batch / Stop. Thread `computerBusy` is the Wave 3 attach point.

## 3. Worker computer-use + who-is-driving

Parked spec: `artifacts/automaton-computer-use-11.md`.

Mouth **workers** get box tools. Staff still does not pixel-click in `src/app.tsx`. Operator Take control stays for secrets.

Who-is-driving:

- REFUSE pixel / CDP while a human has Take control.
- Display lease: one pixel driver at a time.
- Idle the lease; defer if the display is busy.

Do not vendor exec-daemon, noVNC, or a hosted computer-use vendor. Box tools go through existing `boxExec` + Chromium debug port.

## 4. In-chat widgets + secret-request (slice M)

Merge / promote is a **widget**, not an auto-book. Secret-request is a card, not a spoken password. Widgets are native GPUI, not agent HTML.

Do not add job ids to spoken lines unless the user asked.

## 5. Skill import

Markdown-only. Disabled by default. Skip scripts. Pin URL + hash. Name regex is the path gate. Progressive disclosure in inspector / Staff.

Today: `src/runtime/skills.ts` lists local `SKILL.md`. Import is the missing slice.

## 6. Unattended ≠ Auto + cache-stable compaction

Unattended is not Auto. Do not silently raise autonomy.

Cache-stable compaction:

- Stable prefix so prompt cache can hit.
- Last-3 screenshots only.
- Prune every 25 turns.

AG-UI-shaped **native** cards, not agent HTML. Compaction sketch: `artifacts/automaton-compaction-plan.md` (Sketch A). Do not inject the vault into every prompt.

## Invariants for every later wave

- One Chief of Staff king seat. No Kernel / Research auto-seed.
- Running a job is not mouth busy. Composer stays Send unless `composerEnterBusy`.
- Fan-out to 3+ needs confirm.
- Staff does not pixel-click.
- `bun test` is CI. Do not skip tests.
