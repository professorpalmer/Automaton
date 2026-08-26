# Send stays Send

A Puppetmaster job does not lock the composer. Stop is a button. Send remains.

## Sub-features

- Kernel job running, Staff still accepts Send
- Job strip lists running handles
- Stop cancels that handle only

## How to get to it (user POV)

Click Kernel. Send a long fix request. Switch to Staff. Keep typing. Send.

## Driving it with bun test

`tests/session.test.ts` "Staff send succeeds while Kernel job is running".

## Gotchas

`working` is not `composerEnterBusy`. Do not treat the job strip as Steer-only chrome.
