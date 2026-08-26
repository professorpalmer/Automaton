# Org-box host

Python host under `face/`, `harness/`, and `provision/`. Separate from
native `src/` staff. The operator talks to a chief of staff; the host
stamps an isolated box onto the tenant's Render account. It is not a
multi-tenant SaaS claim.

```sh
python3 -m venv .venv
.venv/bin/python -m pip install -e ".[dev]"
.venv/bin/python -m pytest tests -q
.venv/bin/automaton
```

Face listens on http://127.0.0.1:8765. `automaton-host` is the stamp desk.

## Gates

- Tenants pay their own tokens, Render, and git. Never bundle host
  operator keys or sell inference.
- Secrets stay in the tenant vault (`harness/vault.py`). Never git, never
  the wiki catalog.
- Environment variables do not grant FormAssembly, SharePoint, or
  Salesforce access.
- Product memory lives in the org-box catalog, not an external wiki.

Tenant trees live under `tenant/<slug>/`. Secrets, jobs, uploads, and wiki
paths in those trees are gitignored except for a keep file and public
`box.json` where present.

## Related

- [Staff surface](staff.md) is the native GPUI product, not this host.
