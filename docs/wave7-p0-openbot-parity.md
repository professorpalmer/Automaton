# Wave 7 P0 — OpenBot chat-loop parity (patterns only)

**Status:** Implemented on branch `feat/wave-7-p0-toolline-ask-stall`.  
**Policy:** Steal **patterns only** from CopilotKit/OpenBot. No `@ag-ui/*`, no
CopilotKit npm, no generative UI / sandboxed iframes. Mouths = OpenRouter;
Jobs = Puppetmaster. Native `@gpuix/react` only. Sisters stay separate.

Do **not** cut a release tag in the P0 PR (v0.16.0 waits on coordinator).

## P0a — ToolLine-class mouth / hop feed cards

| OpenBot | Automaton |
| --- | --- |
| `ToolLine` one-line rhythm + disclosure | `src/chrome/tool-line.tsx` |
| Running shimmer | Pulse lease opacity (`motion` / Wave 6 pulse) |
| Handoff / escalation reuse ToolLine | Hop relays + `ask_person` stream rows |

- Consecutive `mouth-stream` rows that share `tool` + `intent` collapse at
  paint (`mouthStreamSuperseded`) so decide→act→done advances one card.
- Sent / from relays with envelope fields paint expandable Task /
  Constraints / Expecting / Outcome (paths & policy only — never secrets,
  stdout, or file bytes).
- Tones: running / refused / failed / done.

## P0b — `ask_person` mouth exit

JSON emit:

```json
{ "type": "ask_person", "question": "…", "why": "…" }
```

- Ends the turn; parks a purpose=`ask` widget (`askPersonWidget` —
  allowCustom Reply) with `why` as helpText.
- Speaks `Put to you.`; paints mouth-stream decide→act→done for
  `ask_person`; durable `action_events` row via `buildActionEvent`.
- Prompt cue (`WIDGET_CUE`): prefer ask_person over hop when no sister can
  settle it. Not gated on a hop grant.
- Answer resumes via existing `answerWidget` → `send` path.
- Not an on-call rota / Jobs GATE widget. Auto does not auto-approve when
  unattended.

## P0c — Mouth silence watchdog + sticky stopped banner

| OpenBot | Automaton |
| --- | --- |
| `stall-guard` / `turn-watchdog` | `src/runtime/mouth-stall.ts` |
| Sticky stopped sentence | `Thread.stoppedReason` + `StoppedTurnBanner` |

- Watches OpenRouter **response body** silence between chunks (injectable
  clock; `AUTOMATON_MOUTH_STALL_MS`, default 45s; `0` disables).
- On stall: `MouthStallError` → `mouthFailSpeak` →
  `OpenRouter went quiet mid-reply. Try again.`
- `failMouth` parks sticky `stoppedReason`; next `paintSend` / `send`
  clears it. Auth / empty / rate-limit remain distinct sentences.
- Does **not** abort Puppetmaster Jobs. Consumer/UI pause is not Bot silence
  (watch is on the OpenRouter body pump).

## Out of scope (P1+)

Interrupt history hygiene, hop `mayAddress` grants, hold cancelled-vs-refused,
computer activity epoch, proposed-sister consent — see
`artifacts/automaton-wave7-openbot-parity-audit.md`.

## Tests

`tests/wave7-p0.test.ts` — ToolLine fold, hop envelope, ask_person parse /
widget resume, injectable stall clock, sticky banner clear.
