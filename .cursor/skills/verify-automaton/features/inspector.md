# Header inspector

Click the mouth name in the still titlebar (or Cmd+Shift+I) to open a closeable inspector. It is identity + ledger chrome, not a second chat.

## Sub-features

- Mouth name, title, and description
- Last three claims for that mouth (text only; secrets and spoken job ids stripped)
- Last job handle as kind + status. No Puppetmaster id unless the user asked
- `StaffStore.metrics()` hits / misses / avoided / calls, with tokens and cost or honest unknown
- Kernel may show `~/.automaton/sandboxes/…` only when a worktree exists
- Desktop: capture on open, Refresh (`desktop-refresh`), click preview recaptures. Missing Chrome stays No screen yet
- Query hit paints a quiet `answered from store` line under the mouth bubble

## How to get to it (user POV)

Launch Automaton. Click Staff (or Kernel / Research) in the titlebar. Close with X.

## Driving it with bun test / GPUIX TestRenderer

`tests/shell.test.tsx` clicks `titlebar-name` / `inspector-close`. Locators: `inspector`, `inspector-mouth`, `inspector-claims`, `inspector-job`, `inspector-ledger`, `query-hit`.

Native proof: `artifacts/shots/native-window-inspector.png` shows the inspector painted in the running Automaton window with the query-hit ledger.

## Gotchas

Headless paint is not a native-window proof. Do not print keys or `pmJobId`. Titlebar stays still; no Waku chips.
