# Skills library

Product skills are markdown playbooks under `~/.automaton/skills/<id>/SKILL.md`.
The **Settings → Skills** library is the primary UX (list id/name + one-line
use-when description). The inspector may still import a URL and pin. Version
follows package (`0.2.0`).

Mouths stay **Send**. Coding still goes **Jobs → Puppetmaster** — skills are
prompt layers, not implement workers.

## Model

| Field | Role |
| --- | --- |
| `id` | Folder name `/^[a-z0-9]+(?:-[a-z0-9]+)*$/` — the only path gate |
| `name` + `description` | Catalog line; description is the required “use this when …” |
| `body` | Markdown after frontmatter — loads on match, pin, or `@name` |
| `origin` | `local` (authored in Settings) or `imported` (URL / zip) |
| `enabled` | Imported skills land **disabled** until Enable / inspector toggle |
| Agent `skillIds` | Pins — attach by id, never a filesystem path |

## Authoring (local)

Settings create / edit / delete local skills. Required: name, description
(“use this when …”), and body. Open a row to view the markdown body; Save
writes frontmatter + body. Unknown ids surface a clear **Need** — never a
silent no-op.

## Imported

Import remains URL → `SKILL.md` (GitHub blob/tree rewritten to raw; zips
yield markdown and skip `scripts/`). Imported body / name / description are
**read-only** in Settings. Enable / disable, pin / unpin, and delete are OK.
Delete clears profile pins for that id.

## Progressive disclosure

- Catalog is name + description only, budgeted (~15 skills / 4kB).
- Full body loads via `selectSkillBodies` on pin, `@mention`, id/name match,
  or description match — not on every turn.
- `disable-model-invocation: true` stays off the catalog until pin / `@mention`.

## Offer-once

On composer **Send**, if the text matches an installed skill (same matchers as
body selection) and the skill is not already pinned, Staff shows **one** chat
widget: Pin / Not now. Dismiss (or Not now) persists under
`~/.automaton/skill-offers-dismissed.json` so the offer does not repeat.
Never invent skills that are not installed.

## API (`src/runtime/skills.ts`)

| API | Role |
| --- | --- |
| `listSkills` / `getSkill` | Catalog rows; unknown id → throw |
| `readSkillMarkdown` / `readSkillBody` | Open / apply body without paths |
| `createSkill` / `updateSkill` | Local authoring only |
| `deleteSkill` | Remove dir + clear profile pins |
| `importSkillFromUrl` / `setSkillEnabled` | Import + enable |
| `pickSkillOffer` / `dismissSkillOffer` | Offer-once helpers |

## Invariants

- Do not dump every `SKILL.md` into every turn.
- Do not auto-fire imported skills.
- No skill recorder / invented marketplace rows.
