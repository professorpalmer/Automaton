# ToyVendor

Unshipped. One-tenant proof: Soldiers' Angels talks to a chief of staff, a durable job ships the next operator tool, then screenshot steer changes it. They pay their own tokens.

## Run

```
python3 -m venv .venv
.venv/bin/python -m pip install -e ".[dev]"
.venv/bin/python -m pytest tests -q
.venv/bin/toyvendor
```

Open http://127.0.0.1:8765

Describe a tool. After it ships, say `turn that button blue` or paste a screenshot. Screenshots are always accepted. Flash is the text-only floor, so a vision sidecar must transcribe them. That needs a tenant OpenRouter key in `tenant/secrets/openrouter.key` or `TOYVENDOR_TENANT_OPENROUTER_API_KEY`. Host keys are ignored on purpose.

## Gates

Client-pays tokens. No multi-tenant. No ship. Secrets never enter the wiki. Env vars do not grant FormAssembly / SharePoint / Salesforce.

Product memory lives in the personal wiki, not this README.
