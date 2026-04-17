#!/usr/bin/env node
/**
 * LDM.delivery — MCP (Model Context Protocol) server.
 *
 * Exposes email delivery as MCP tools so any MCP-compatible agent
 * (Claude Desktop, Cursor, custom) can send email without writing API code.
 *
 * Usage (Claude Desktop config):
 *
 *   "mcpServers": {
 *     "ldm": {
 *       "command": "npx",
 *       "args": ["-y", "@live-direct-marketing/sdk", "mcp"],
 *       "env": { "LDM_API_KEY": "ldm_pk_..." }
 *     }
 *   }
 *
 * If LDM_API_KEY is not set, the first call to ldm_send_message will
 * auto-request a sandbox key using LDM_SIGNUP_EMAIL (or prompt the agent to).
 */

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import { LDM, DEFAULT_BASE_URL } from './index.js';
import { promises as fs } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

const CREDENTIALS_PATH = join(homedir(), '.ldm', 'credentials.json');
const BASE_URL = process.env.LDM_BASE_URL ?? DEFAULT_BASE_URL;

interface Credentials {
  api_key: string;
  email?: string;
  created_at: string;
}

async function loadKey(): Promise<string | null> {
  if (process.env.LDM_API_KEY) return process.env.LDM_API_KEY;
  try {
    const raw = await fs.readFile(CREDENTIALS_PATH, 'utf8');
    const creds = JSON.parse(raw) as Credentials;
    return creds.api_key || null;
  } catch {
    return null;
  }
}

async function saveKey(creds: Credentials): Promise<void> {
  await fs.mkdir(join(homedir(), '.ldm'), { recursive: true });
  await fs.writeFile(CREDENTIALS_PATH, JSON.stringify(creds, null, 2), {
    mode: 0o600,
  });
}

function clientFor(apiKey: string): LDM {
  return new LDM({ apiKey, baseUrl: BASE_URL });
}

const TOOLS = [
  {
    name: 'ldm_request_key',
    description:
      'Request a sandbox LDM API key. Returned key is stored locally and reused automatically. Required if no LDM_API_KEY env is set.',
    inputSchema: {
      type: 'object',
      properties: {
        email: { type: 'string', description: 'Contact email for the key owner' },
        org: { type: 'string', description: 'Organization name (optional)' },
        use_case: { type: 'string', description: 'Short description of intended use' },
      },
      required: ['email'],
    },
  },
  {
    name: 'ldm_send_message',
    description:
      'Send an email message via LDM.delivery. Sandbox keys hold messages for moderation before delivery. Returns message id and status.',
    inputSchema: {
      type: 'object',
      properties: {
        to: { type: 'string', description: 'Recipient email address' },
        subject: { type: 'string', description: 'Email subject line' },
        body: { type: 'string', description: 'Email body (plain text or HTML)' },
        from_pool: {
          type: 'string',
          enum: ['managed', 'dedicated'],
          description: 'Sender pool (default: managed)',
        },
      },
      required: ['to', 'subject', 'body'],
    },
  },
  {
    name: 'ldm_get_message',
    description: 'Look up the current status of a previously sent message by id.',
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'string', description: 'Message id returned by ldm_send_message' },
      },
      required: ['id'],
    },
  },
  {
    name: 'ldm_health',
    description: 'Check LDM.delivery API health. No auth required.',
    inputSchema: { type: 'object', properties: {} },
  },
] as const;

async function main(): Promise<void> {
  const server = new Server(
    { name: 'ldm-delivery', version: '0.2.0' },
    { capabilities: { tools: {} } },
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: TOOLS,
  }));

  server.setRequestHandler(CallToolRequestSchema, async (req) => {
    const { name, arguments: args } = req.params;
    const a = args ?? {};
    try {
      if (name === 'ldm_health') {
        const h = await LDM.health({ baseUrl: BASE_URL });
        return {
          content: [{ type: 'text', text: JSON.stringify(h, null, 2) }],
        };
      }

      if (name === 'ldm_request_key') {
        const email = String(a.email ?? '');
        if (!email) throw new Error('email required');
        const resp = await LDM.requestKey(
          {
            email,
            org: a.org ? String(a.org) : undefined,
            use_case: a.use_case ? String(a.use_case) : undefined,
            channel: 'mcp',
          },
          { baseUrl: BASE_URL },
        );
        await saveKey({
          api_key: resp.api_key,
          email,
          created_at: new Date().toISOString(),
        });
        return {
          content: [
            {
              type: 'text',
              text:
                `Key issued (scope=${resp.scope}, saved to ${CREDENTIALS_PATH}). ` +
                `Quota: ${resp.quota.remaining}/${resp.quota.monthly} / month. ` +
                `Next: ${resp.next_steps.message}`,
            },
          ],
        };
      }

      if (name === 'ldm_send_message') {
        const key = await loadKey();
        if (!key) {
          return {
            isError: true,
            content: [
              {
                type: 'text',
                text:
                  'No API key configured. Call ldm_request_key first, or set LDM_API_KEY env var.',
              },
            ],
          };
        }
        const ldm = clientFor(key);
        const msg = await ldm.messages.send({
          to: String(a.to ?? ''),
          subject: String(a.subject ?? ''),
          body: String(a.body ?? ''),
          from_pool: a.from_pool as 'managed' | 'dedicated' | undefined,
        });
        return {
          content: [{ type: 'text', text: JSON.stringify(msg, null, 2) }],
        };
      }

      if (name === 'ldm_get_message') {
        const key = await loadKey();
        if (!key) throw new Error('No API key — call ldm_request_key first');
        const ldm = clientFor(key);
        const status = await ldm.messages.get(String(a.id ?? ''));
        return {
          content: [{ type: 'text', text: JSON.stringify(status, null, 2) }],
        };
      }

      return {
        isError: true,
        content: [{ type: 'text', text: `Unknown tool: ${name}` }],
      };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return {
        isError: true,
        content: [{ type: 'text', text: `Error: ${msg}` }],
      };
    }
  });

  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error('[ldm-mcp] fatal:', err);
  process.exit(1);
});
