# Usage and settings

Rail-bottom Settings opens Usage, Keys, and Theme. Usage is the same ledger the inspector paints.

## Sub-features

- Usage: turns, hits, misses, avoided, calls; tokens/cost stay unknown when any attempted inference lacked the field
- Keys: OpenRouter present or missing. Never print the secret
- Connectors: OpenRouter Connected / Needs key / Rejected from a live `/models` probe, not from the file existing. Locator `connector-openrouter`
- Theme: Graphite from the existing token set. No new accent

## How to get to it (user POV)

Launch Automaton. Click Settings at the bottom of the rail. Close with X.

## Driving it with bun test / GPUIX TestRenderer

`tests/shell.test.tsx` clicks `settings-open`. Locators: `settings`, `settings-usage`, `settings-keys`, `settings-connectors`, `connector-openrouter`, `settings-theme`, `settings-close`.

The native inspector uses the same ledger. `artifacts/shots/native-window-inspector.png` is the window-level proof for a hit, an avoided inference, and the measured miss.

## Gotchas

Missing provider usage stays null in `store.metrics()`. Do not coerce unknown tokens or cost to zero. Do not claim 95% cache from these numbers.
