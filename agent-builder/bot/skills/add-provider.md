---
description: Use when the user wants to add, switch, or troubleshoot another model API besides Miarouter.
---

# Add a model API

Miarouter is built in. Another OpenAI-compatible API is a JSON entry, not a code change. A different protocol needs a small edit in `bot/lib/providers.ts`.

## OpenAI-compatible API

1. Put the key in its own env var, such as `OPENROUTER_API_KEY`. Do not paste the key into chat or into the JSON.
2. Add one object to `EXTRA_PROVIDERS_JSON`:

```json
[
  {
    "id": "openrouter",
    "label": "OpenRouter",
    "protocol": "openai-compatible",
    "baseUrl": "https://openrouter.ai/api/v1",
    "apiKeyEnv": "OPENROUTER_API_KEY",
    "defaultModel": "openai/gpt-4o-mini"
  }
]
```

3. Rules the loader enforces: `id` is lowercase and unique (`miarouter` is reserved); `protocol` is `openai-compatible`; `baseUrl` is `https`, or `http` only for localhost; `apiKeyEnv` is uppercase and does not start with `CURSOR_`.
4. On Cursor hosting, add that env name to `hosting.secretNames` and the API host to `hosting.egressDomains` in `bot/agent.ts`, then set the secret and redeploy.
5. Call `list_providers`. `configured: true` means the key is set. `ignored` explains any skipped entry.

## Point Miarouter at another host

Set `MIAROUTER_BASE_URL` (default `https://api.maiarouter.ai/v1`) and `MIAROUTER_DEFAULT_MODEL`. The key stays `MIAROUTER_API_KEY`. A different host also belongs in `hosting.egressDomains` before deploy.

## Another protocol

Add a branch in `completeChat` inside `bot/lib/providers.ts`, keep the key read inside the call (not at import time), and keep the same result shape. Leave auth, size caps, and redaction in that file.
