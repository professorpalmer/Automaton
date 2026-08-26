# Fan-out confirm

Messaging three or more agents requires confirm. Dismiss is no send.

## Sub-features

- `@Staff @Kernel @Research` opens the card
- Confirm delivers paraphrased notes
- Dismiss leaves threads empty

## How to get to it (user POV)

In Staff, type three @names and Send.

## Driving it with bun test

`tests/session.test.ts` fan-out cases. UI: `fanout-confirm-yes` / `fanout-confirm-no`.

## Gotchas

The note is a paraphrase, never a paste of a complaint.
