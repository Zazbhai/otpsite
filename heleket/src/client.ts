import type { ResolvedConfig } from './config.js';
import { ApiError, HttpError, ValidationError } from './errors.js';
import { sign } from './signature.js';
import { USER_AGENT } from './transport.js';

/**
 * Per-call options accepted by every PaymentClient and PayoutClient method.
 */
export interface RequestOptions {
  /** Caller-controlled cancellation. */
  signal?: AbortSignal;
  /**
   * Extra request headers merged on top of the SDK-managed set (`merchant`,
   * `sign`, `Content-Type`, `User-Agent`). Useful for forwarding tracing
   * IDs or, where Heleket supports it, an `Idempotency-Key` to make a
   * retried `create-invoice` / `create-payout` safe. SDK-managed headers
   * cannot be overridden — the signature header in particular must match
   * what the SDK computed.
   */
  headers?: Record<string, string>;
}

/**
 * Shared HTTP plumbing for PaymentClient and PayoutClient.
 *
 * Encodes the request to JSON, signs it, dispatches via the configured
 * Transport, dumps to the debug sink if enabled, and translates the response
 * into either a typed result or a typed error.
 */
export abstract class BaseClient {
  protected readonly config: ResolvedConfig;

  protected constructor(config: ResolvedConfig) {
    this.config = config;
  }

  protected async post<T>(path: string, params: unknown, options?: RequestOptions): Promise<T> {
    return this.send<T>('POST', path, encodeBody(params), options);
  }

  /**
   * Send a signed GET request. For read-only endpoints that carry all their
   * input in the path (e.g. exchange rates). There is no request body, so the
   * signed bytes are the empty string — exactly like a POST with no params:
   * `sign = md5(api_key)`.
   */
  protected async get<T>(path: string, options?: RequestOptions): Promise<T> {
    return this.send<T>('GET', path, '', options);
  }

  /**
   * Sign the exact body bytes, attach the auth headers, dispatch via the
   * transport, and translate the response. Shared by {@link post} and
   * {@link get} so the signing and error handling live in exactly one place.
   */
  private async send<T>(
    method: 'GET' | 'POST',
    path: string,
    body: string,
    options?: RequestOptions,
  ): Promise<T> {
    const signature = sign(body, this.config.apiKey);
    const url = this.config.baseUrl + path;

    // Caller-supplied headers go in first; SDK-managed headers (`merchant`,
    // `sign`, `Content-Type`, `User-Agent`) overwrite to prevent accidental
    // signature tampering or merchant-ID spoofing through `options.headers`.
    // User-Agent lives here (not in FetchTransport) so it's set consistently
    // across every Transport implementation, including custom ones.
    const headers: Record<string, string> = {
      ...(options?.headers ?? {}),
      merchant: this.config.merchantId,
      sign: signature,
      'User-Agent': USER_AGENT,
    };
    // Only advertise Content-Type when there's actually a body — Heleket's
    // empty-params and GET endpoints sign and send no body, so a stray header
    // would be technically incorrect.
    if (body !== '') {
      headers['Content-Type'] = 'application/json';
    }

    if (this.config.debug) {
      this.config.logger({ kind: 'request', method, url, body });
    }

    let response;
    try {
      response = await this.config.transport.roundTrip(method, url, headers, body, {
        signal: options?.signal,
        timeoutMs: this.config.timeoutMs,
      });
    } catch (error) {
      if (error instanceof HttpError) {
        throw error;
      }
      throw new HttpError(
        `transport failed: ${error instanceof Error ? error.message : String(error)}`,
        { cause: error },
      );
    }

    if (this.config.debug) {
      this.config.logger({ kind: 'response', status: response.statusCode, body: response.body });
    }

    return parseResponse<T>(response.statusCode, response.body);
  }
}

/**
 * Encode the request payload. `undefined`/`null` and empty objects yield the
 * empty string, matching the empty-params signing rule shared with the PHP
 * and Go SDKs.
 */
export function encodeBody(params: unknown): string {
  if (params === undefined || params === null) {
    return '';
  }
  // Strip undefined fields (TypeScript may leave them in optional struct fields).
  if (typeof params === 'object' && !Array.isArray(params)) {
    const filtered: Record<string, unknown> = {};
    let hasAny = false;
    for (const [k, v] of Object.entries(params)) {
      if (v === undefined) continue;
      filtered[k] = v;
      hasAny = true;
    }
    if (!hasAny) return '';
    return JSON.stringify(filtered);
  }
  return JSON.stringify(params);
}

interface Envelope<T> {
  state: number;
  result?: T;
  message?: string;
  errors?: Record<string, string[] | string>;
}

/**
 * Page-walker helper. Given a function that fetches one page by cursor,
 * yields items across all pages until `paginate.nextCursor` is empty.
 *
 * Mirrors the typical Node async-iterator pattern so merchants can write:
 *
 *     for await (const invoice of paginate(cursor => client.listHistory({ cursor }))) {
 *       ...
 *     }
 *
 * The fetcher is intentionally async — pass the merchant's date filters via
 * closure to keep the helper signature simple.
 */
export async function* paginate<T>(
  fetchPage: (cursor: string | undefined) => Promise<{
    items: T[];
    paginate: { nextCursor?: string; hasPages: boolean };
  }>,
): AsyncIterableIterator<T> {
  let cursor: string | undefined;
  for (;;) {
    const page = await fetchPage(cursor);
    for (const item of page.items) {
      yield item;
    }
    if (!page.paginate?.hasPages || !page.paginate.nextCursor) {
      return;
    }
    cursor = page.paginate.nextCursor;
  }
}

/**
 * Decode the standard Heleket response envelope:
 *
 *     { state, result, message?, errors? }
 *
 * On state !== 0 or HTTP 422, throw a typed error. On success, return the
 * `result` field as the typed T.
 */
export function parseResponse<T>(statusCode: number, body: string): T {
  let parsed: Envelope<T> | null = null;
  if (body) {
    try {
      parsed = JSON.parse(body);
    } catch {
      // Fall through; we'll throw a generic ApiError below.
    }
  }

  if (statusCode === 422) {
    const fields = normaliseFields(parsed?.errors);
    throw new ValidationError(`validation failed: ${summarise(fields)}`, statusCode, fields, body);
  }

  if (parsed === null) {
    throw new ApiError(`non-JSON response (HTTP ${statusCode})`, statusCode, body);
  }

  if (parsed.state !== 0) {
    const msg = parsed.message ?? `api error (state=${parsed.state})`;
    throw new ApiError(msg, statusCode, body);
  }

  // Endpoints with no meaningful return resolve as undefined.
  return parsed.result as T;
}

function normaliseFields(raw: unknown): Record<string, string[]> {
  if (!raw || typeof raw !== 'object') return {};
  const out: Record<string, string[]> = {};
  for (const [field, value] of Object.entries(raw as Record<string, unknown>)) {
    if (Array.isArray(value)) {
      out[field] = value.map((v) => String(v));
    } else {
      out[field] = [String(value)];
    }
  }
  return out;
}

function summarise(fields: Record<string, string[]>): string {
  const parts: string[] = [];
  for (const [name, msgs] of Object.entries(fields)) {
    parts.push(`${name} (${msgs.join(', ')})`);
  }
  return parts.length === 0 ? '(no field details)' : parts.join('; ');
}
