# Automaton

Unshipped. Same suite as Puppetmaster, Marionette, and portablellm.wiki. Soldiers' Angels talks to a chief of staff; a durable team ships the next operator tool to their Render; screenshot steer keeps polishing. They pay their own tokens.

## Run

```
python3 -m venv .venv
.venv/bin/python -m pip install -e ".[dev]"
.venv/bin/python -m pytest tests -q
.venv/bin/automaton
```

Open http://127.0.0.1:8765

`.venv/bin/automaton --doctor` reports whether a tenant key is present. Host `OPENROUTER_API_KEY` is ignored. Default job budget cap is $5 (`tenant/soldiers-angels/secrets/budget.json`). A job is not an official playbook until maker-check (`POST /api/jobs/{id}/ready` then `/check`).

Describe a tool. After it ships, say `turn that button blue` or paste a screenshot. Screenshots are always accepted. Flash is the text-only floor, so a vision sidecar must transcribe them. That needs a tenant OpenRouter key in `tenant/soldiers-angels/secrets/openrouter.key` or `AUTOMATON_TENANT_OPENROUTER_API_KEY`. Host keys are ignored on purpose.

## Gates

Client-pays tokens. No multi-tenant. No ship. Secrets never enter the wiki. Env vars do not grant FormAssembly / SharePoint / Salesforce.

Product memory lives in the org box catalog (`tenant/soldiers-angels/catalog/`), not Portable LLM Wiki.

## Host

We stamp isolated Automaton boxes onto the client's Render. They pay Render, tokens, and git. We keep the image current.

```
.venv/bin/automaton-host
```

Open http://127.0.0.1:8766. The host never uses Cary's keys. A stamp needs their Render API key. The box URL is what they open.
