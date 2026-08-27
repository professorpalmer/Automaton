# Compaction sketch A

OpenRouter mouth. Don't-Break-the-Cache (arXiv 2601.06007): keep a byte-stable prefix so prompt cache can hit.

```
[cached prefix]  system + tools JSON (fixed order)
[breakpoint]     cache_control ephemeral on the first system text part
[dynamic tail]   skill bodies, claims, tool results, conversation
```

Never put timestamps, UUIDs, or reordered tool JSON in the cached prefix. Goal text and tool results live in the tail. The system prompt is cache-identical across turns when roster, rules, model, and skill catalog are unchanged.

When the working set exceeds the char budget, compact the middle with `openai/gpt-4o-mini` (OpenRouter routing). Compact instructions pin code, file paths, and decisions. The compact pass sends the same system prefix so it does not bust the cache. Do not call a Claude-only compact API.

Screenshots: keep last 3. Prune screenshot / tool image history every 25 turns, not every turn.

Aider-style: do not dump the repo into the prefix. Query-first claims and `TAIL` stay the working set bound.

Native Wave 4 cards already cover ask / host / merge. No AG-UI protocol, no agent HTML, no vault-in-every-prompt.
