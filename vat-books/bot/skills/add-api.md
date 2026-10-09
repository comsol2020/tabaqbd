---
description: Use when the operator wants to add, list, or remove an API for later, without calling it yet.
---

# Add an API

The registry is a list, not a client. `add_api` stores a label, base URL, and the env var that will hold the key. `list_apis` shows that list. `remove_api` drops one id.

- Never paste the key into the chat, the note, or the URL.
- `baseUrl` is `https`, or `http` only for localhost. No user, password, query, or hash.
- `apiKeyEnv` is uppercase, such as `NBR_API_KEY`, and must not start with `CURSOR_`.
- Registering does not send books, scans, or PINs anywhere.
- Do not invent a request to a registered API. A later tool can read one id from this list for one named purpose. There is no open-ended call tool.
