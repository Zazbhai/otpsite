import { stderrSink, type DebugSink } from './debug.js';
import { FetchTransport, type Transport } from './transport.js';

export const DEFAULT_BASE_URL = 'https://api.heleket.com';
export const DEFAULT_TIMEOUT_MS = 30_000;

/**
 * Options accepted by the PaymentClient and PayoutClient constructors. All
 * fields are optional except merchantId and apiKey, which are positional.
 */
export interface ClientOptions {
  /** Override the API base URL — rarely needed outside tests. */
  baseUrl?: string;
  /** Per-request timeout in milliseconds. Defaults to 30_000. */
  timeoutMs?: number;
  /** When true, every HTTP request and response is emitted to `logger`. */
  debug?: boolean;
  /** Replace the default debug sink. Defaults to writing to stderr. */
  logger?: DebugSink;
  /** Inject a custom Transport (tests, retry middleware, etc.). */
  transport?: Transport;
}

/**
 * Resolved, immutable configuration. Built by `resolveConfig` from the
 * merchant credentials and the optional ClientOptions.
 */
export interface ResolvedConfig {
  merchantId: string;
  apiKey: string;
  baseUrl: string;
  timeoutMs: number;
  debug: boolean;
  logger: DebugSink;
  transport: Transport;
}

/**
 * Validate inputs and apply defaults. Throws on missing or malformed values.
 *
 * Header-injection guard: `merchantId` and `apiKey` are echoed verbatim into
 * the `merchant:` and `sign:` request headers, and `apiKey` participates in
 * the signature hash. A CR (0x0D), LF (0x0A), NUL (0x00), or any other ASCII
 * control char in those values would either smuggle headers (CRLF) or break
 * the signature in surprising ways. Reject them upfront so the failure is
 * actionable instead of a mysterious 4xx down the road.
 */
export function resolveConfig(
  merchantId: string,
  apiKey: string,
  options: ClientOptions = {},
): ResolvedConfig {
  const trimmedMerchant = merchantId?.trim() ?? '';
  const trimmedKey = apiKey?.trim() ?? '';

  if (!trimmedMerchant) {
    throw new Error('heleket: merchantId must not be empty');
  }
  if (!trimmedKey) {
    throw new Error('heleket: apiKey must not be empty');
  }
  assertHeaderSafe('merchantId', trimmedMerchant);
  assertHeaderSafe('apiKey', trimmedKey);

  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  if (timeoutMs <= 0) {
    throw new Error('heleket: timeoutMs must be > 0');
  }

  return {
    merchantId: trimmedMerchant,
    apiKey: trimmedKey,
    baseUrl: (options.baseUrl ?? DEFAULT_BASE_URL).replace(/\/+$/, ''),
    timeoutMs,
    debug: options.debug ?? false,
    logger: options.logger ?? stderrSink,
    transport: options.transport ?? new FetchTransport(),
  };
}

/**
 * Reject ASCII control characters (0x00-0x1F, 0x7F) anywhere in a
 * header-bound value. Custom Transport implementations may bypass undici's
 * CRLF validation, so the SDK enforces the same invariant at the config
 * boundary — char-by-char to keep the regex literal free of escaped control
 * bytes that some editors mangle.
 */
function assertHeaderSafe(field: string, value: string): void {
  for (let i = 0; i < value.length; i++) {
    const code = value.charCodeAt(i);
    if (code < 0x20 || code === 0x7f) {
      throw new Error(
        `heleket: ${field} contains a control character (CR, LF, NUL, or other) — ` +
          `not safe to use as an HTTP header value`,
      );
    }
  }
}
