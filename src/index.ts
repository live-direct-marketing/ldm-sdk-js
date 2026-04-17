/**
 * @live-direct-marketing/sdk
 * Typed client for the LDM.delivery public API.
 *
 *   import { LDM } from '@live-direct-marketing/sdk';
 *   const ldm = new LDM({ apiKey: 'ldm_pk_...' });
 *   await ldm.messages.send({ to: 'cto@acme.com', subject: 'Hi', body: '...' });
 *
 * Obtain a key without credentials (sandbox — moderation-gated):
 *   const { api_key } = await LDM.requestKey({ email: 'me@you.com' });
 */

export const DEFAULT_BASE_URL = 'https://api.live-direct-marketing.online/v1';

// -- errors -------------------------------------------------------------------

export class LDMError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly code?: string,
    public readonly body?: unknown,
  ) {
    super(message);
    this.name = 'LDMError';
  }
}
export class UnauthorizedError extends LDMError {
  constructor(body?: unknown) {
    super('Invalid or missing API key', 401, 'unauthorized', body);
    this.name = 'UnauthorizedError';
  }
}
export class QuotaExceededError extends LDMError {
  constructor(body?: unknown) {
    super('Monthly quota exceeded — contact billing', 402, 'quota_exceeded', body);
    this.name = 'QuotaExceededError';
  }
}
export class ValidationError extends LDMError {
  constructor(message: string, body?: unknown) {
    super(message, 400, 'validation_error', body);
    this.name = 'ValidationError';
  }
}

// -- types --------------------------------------------------------------------

export interface LDMOptions {
  apiKey: string;
  baseUrl?: string;
  fetch?: typeof fetch;
  timeoutMs?: number;
}

export interface SignupRequest {
  email: string;
  org?: string;
  use_case?: string;
  channel?: 'form' | 'a2a' | 'mcp';
}

export interface SignupResponse {
  api_key: string;
  key_id: string;
  scope: 'sandbox' | 'approved';
  moderation_status: 'pending' | 'approved' | 'rejected';
  quota: { monthly: number; remaining: number; resets_at: string };
  next_steps: { message: string; billing_contact: string };
  docs: string;
}

export interface SendMessageRequest {
  to: string;
  subject: string;
  body: string;
  from_pool?: 'managed' | 'dedicated';
}

export interface SendMessageResponse {
  id: string;
  status:
    | 'queued_for_moderation'
    | 'approved'
    | 'sending'
    | 'sent'
    | 'failed';
  queued_at: string;
  message?: string;
  billing_contact?: string;
}

export interface MessageStatus {
  id: string;
  status: string;
  to: string;
  subject: string;
  queued_at: string;
  sent_at: string | null;
  failed_at: string | null;
  error: string | null;
}

// -- internal http ------------------------------------------------------------

interface HttpOpts {
  method: 'GET' | 'POST';
  path: string;
  body?: unknown;
  auth?: boolean;
}

class Http {
  constructor(
    private readonly opts: Required<Pick<LDMOptions, 'baseUrl' | 'timeoutMs'>> & {
      apiKey?: string;
      fetch: typeof fetch;
    },
  ) {}

  async call<T>(req: HttpOpts): Promise<T> {
    const url = this.opts.baseUrl + req.path;
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'User-Agent': '@live-direct-marketing/sdk',
    };
    if (req.auth) {
      if (!this.opts.apiKey) throw new UnauthorizedError();
      headers.Authorization = `Bearer ${this.opts.apiKey}`;
    }
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), this.opts.timeoutMs);
    let res: Response;
    try {
      res = await this.opts.fetch(url, {
        method: req.method,
        headers,
        body: req.body ? JSON.stringify(req.body) : undefined,
        signal: ctrl.signal,
      });
    } finally {
      clearTimeout(t);
    }
    const text = await res.text();
    let parsed: unknown = undefined;
    if (text) {
      try {
        parsed = JSON.parse(text);
      } catch {
        parsed = text;
      }
    }
    if (!res.ok) {
      const msg =
        (parsed && typeof parsed === 'object' && 'message' in parsed
          ? String((parsed as { message: unknown }).message)
          : '') || `HTTP ${res.status}`;
      if (res.status === 401) throw new UnauthorizedError(parsed);
      if (res.status === 402) throw new QuotaExceededError(parsed);
      if (res.status === 400) throw new ValidationError(msg, parsed);
      throw new LDMError(msg, res.status, undefined, parsed);
    }
    return parsed as T;
  }
}

// -- resource: messages -------------------------------------------------------

class Messages {
  constructor(private readonly http: Http) {}

  send(req: SendMessageRequest): Promise<SendMessageResponse> {
    return this.http.call({
      method: 'POST',
      path: '/messages',
      body: req,
      auth: true,
    });
  }

  get(id: string): Promise<MessageStatus> {
    return this.http.call({
      method: 'GET',
      path: `/messages/${encodeURIComponent(id)}`,
      auth: true,
    });
  }
}

// -- resource: keys (static — no auth) ----------------------------------------

class Keys {
  constructor(private readonly http: Http) {}
  request(req: SignupRequest): Promise<SignupResponse> {
    return this.http.call({ method: 'POST', path: '/signup', body: req });
  }
}

// -- main client --------------------------------------------------------------

export class LDM {
  readonly messages: Messages;
  readonly keys: Keys;

  constructor(opts: LDMOptions) {
    if (!opts.apiKey) {
      throw new Error('apiKey is required — obtain one via LDM.requestKey()');
    }
    const http = new Http({
      baseUrl: opts.baseUrl ?? DEFAULT_BASE_URL,
      timeoutMs: opts.timeoutMs ?? 30_000,
      fetch: opts.fetch ?? globalThis.fetch,
      apiKey: opts.apiKey,
    });
    this.messages = new Messages(http);
    this.keys = new Keys(http);
  }

  /**
   * Request a sandbox API key without credentials.
   * Key is active immediately. Messages are held for moderation before delivery.
   */
  static async requestKey(
    req: SignupRequest,
    opts: { baseUrl?: string; fetch?: typeof fetch; timeoutMs?: number } = {},
  ): Promise<SignupResponse> {
    const http = new Http({
      baseUrl: opts.baseUrl ?? DEFAULT_BASE_URL,
      timeoutMs: opts.timeoutMs ?? 30_000,
      fetch: opts.fetch ?? globalThis.fetch,
    });
    return http.call({ method: 'POST', path: '/signup', body: req });
  }

  /** Public health check — no auth required */
  static async health(
    opts: { baseUrl?: string; fetch?: typeof fetch } = {},
  ): Promise<{ status: string; ts: string }> {
    const http = new Http({
      baseUrl: opts.baseUrl ?? DEFAULT_BASE_URL,
      timeoutMs: 10_000,
      fetch: opts.fetch ?? globalThis.fetch,
    });
    return http.call({ method: 'GET', path: '/health' });
  }
}

export default LDM;
