# @live-direct-marketing/sdk

[![npm](https://img.shields.io/npm/v/@live-direct-marketing/sdk.svg)](https://www.npmjs.com/package/@live-direct-marketing/sdk)

Official TypeScript SDK for **[LDM.delivery](https://developers.live-direct-marketing.online)** — email delivery API for AI agents. Pay only for inbox delivery, not for sent.

- Zero runtime dependencies
- Native `fetch`, works in Node ≥18, edge runtimes, browsers
- Typed request / response
- Self-serve key issuance — no signup form required

## Install

```bash
npm install @live-direct-marketing/sdk
```

## Quickstart

```ts
import { LDM } from '@live-direct-marketing/sdk';

// 1. Get a sandbox key (one-time, no credentials needed)
const { api_key } = await LDM.requestKey({
  email: 'you@yourdomain.com',
  use_case: 'AI agent outreach',
});

// 2. Send a message
const ldm = new LDM({ apiKey: api_key });
const msg = await ldm.messages.send({
  to: 'cto@acme.com',
  subject: 'Re: infrastructure partnership',
  body: 'Hi — we built an inbox delivery API for AI agents...',
});

console.log(msg.id, msg.status);
// cmo2p666900067p7y9jqosenh  queued_for_moderation
```

## Sandbox vs approved

Every key issued via `LDM.requestKey()` starts in **sandbox** scope:

- All `messages.send` calls are **held for moderation** before delivery
- Quota: 500 messages / month
- Response: `{ status: 'queued_for_moderation' }` with `billing_contact`

To go live — reach out to **welcome@live-direct-marketing.online** for moderation + billing setup. Once approved, your key is promoted to `approved` scope and messages start flowing.

## API

### `LDM.requestKey(req)`

Self-serve signup. Returns an active sandbox key.

```ts
const { api_key, quota, next_steps } = await LDM.requestKey({
  email: 'me@example.com',
  org: 'Acme Corp',          // optional
  use_case: 'transactional',  // optional
  channel: 'mcp',             // optional: form | a2a | mcp
});
```

### `new LDM({ apiKey })`

```ts
const ldm = new LDM({
  apiKey: 'ldm_pk_...',
  baseUrl: 'https://api.live-direct-marketing.online/v1', // optional override
  timeoutMs: 30_000,                                      // default
});
```

### `ldm.messages.send(req)`

```ts
await ldm.messages.send({
  to: 'cto@acme.com',
  subject: 'Hi',
  body: 'Plain text or HTML',
  from_pool: 'managed', // or 'dedicated' (approved scope only)
});
```

### `ldm.messages.get(id)`

```ts
const status = await ldm.messages.get('cmo2p666900067p7y9jqosenh');
```

### `LDM.health()`

```ts
const { status } = await LDM.health(); // { status: 'ok', ts: '...' }
```

## Errors

```ts
import {
  LDMError,
  UnauthorizedError,
  QuotaExceededError,
  ValidationError,
} from '@live-direct-marketing/sdk';

try {
  await ldm.messages.send({ ... });
} catch (err) {
  if (err instanceof QuotaExceededError) {
    // contact billing@
  }
}
```

## A2A & MCP

The API publishes an A2A agent card so autonomous agents can onboard without a human:

```
GET https://api.live-direct-marketing.online/v1/.well-known/agent-card.json
```

### MCP server

This package also ships a stdio Model Context Protocol server. Any MCP-compatible client (Claude Desktop, Cursor, etc.) can wire it up and send email without writing API code.

**Claude Desktop** — add to `claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "ldm": {
      "command": "npx",
      "args": ["-y", "@live-direct-marketing/sdk", "ldm-mcp"],
      "env": { "LDM_API_KEY": "ldm_pk_..." }
    }
  }
}
```

If `LDM_API_KEY` is not set, the agent can call the `ldm_request_key` tool first — the issued key is stored at `~/.ldm/credentials.json` (mode `0600`) and reused automatically.

**Exposed tools:**

| Tool | Purpose |
|---|---|
| `ldm_health` | API health check, no auth |
| `ldm_request_key` | Self-serve sandbox key issuance |
| `ldm_send_message` | Send an email (sandbox → held for moderation) |
| `ldm_get_message` | Look up status by message id |

## License

MIT © Live Direct Marketing
