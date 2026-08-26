# Staff rail

The left rail lists named mouths. Clicking one swaps the feed and draft. Hidden agents stay out.

## Sub-features

- Staff, Kernel, Research visible by default
- Unread badge when another mouth speaks
- Busy dot is mouth-busy, not a flying job

## How to get to it (user POV)

Launch Automaton. The rail is on the left under Agents. Click Kernel — the titlebar switches to Kernel. Typing in Staff's composer is not the same as selecting Kernel.

## Driving it with bun test / GPUIX TestRenderer

`findByTestId('agent-kernel')`. Click. Feed header shows Kernel.

## Gotchas

Do not remount the whole app to switch agents. `setActive` only.
