# Version / release surface

Installed Automaton shows a real version — not an unversioned tip forever.

Current band is package (`0.3.0`). Version stays until the next band cut. This surface does
**not** bump the band and does **not** publish to PyPI.

## Sources of truth

| Source | Field | Role |
| --- | --- | --- |
| `package.json` | `version` | Installed chrome (Settings About, optional titlebar chip) |
| `macos/.../Info.plist` | `CFBundleShortVersionString` | Ship-path twin; must match package |
| GitHub Latest | `gh release view --json tagName` | Release channel (notify only) |
| `origin/main` tip | git rev-list | Existing tip/dirty update modal (unchanged peer) |

## Release notify

On launch (and a slow pulse), Automaton compares installed semver to the Latest
GitHub release tag (leading `v` stripped). When behind:

1. Offer the existing Update modal extended with installed vs latest tag
2. **Notify only** — never auto-upgrade
3. Cary clicks **Update** → existing `applyUpdate` (ff-only onto `origin/main`) + relaunch
4. **Later** → `dismissRelease(tag)` (parallel to git `dismissUpdate(sha)`)

Git-behind-main stays first-class alongside the release check. Fail soft if
GitHub is unreachable — never invent “up to date” (`checkLatestRelease` → `null`).

## Settings → About

- Installed `package.json` version
- Info.plist match or **WARN** drift
- Latest release line, or **Couldn't check**

## Doctor

`bun run doctor` **WARN**s when `package.json` version ≠ plist
`CFBundleShortVersionString`. WARN only — does not alone flip `ok` false.

## Code

- `src/runtime/version.ts` — read versions, semver helpers, release check, dismiss
- `src/runtime/updates.ts` — git tip/dirty channel + shared `~/.automaton/update.json`
- `src/update-modal.tsx` — `kind: 'git' | 'release'`
