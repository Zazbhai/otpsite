import { HttpError } from './errors.js';
import { VERSION } from './version.js';

/** Identifies the SDK to Heleket so support/observability can attribute traffic. */
export const USER_AGENT = `heleket-node-sdk/${VERSION}`;

/**
 * HTTP response captured by a Transport. The raw body is preserved as a string
 * (verbatim — no JSON decoding) so signature checks and the debug logger see
 * the exact bytes Heleket sent.
 */
export interface TransportResponse {
  statusCode: number;
  body: string;
  headers: Record<string, string>;
}

/**
 * HTTP transport contract. Implementations send an HTTP request and return a
 * TransportResponse with the raw response body preserved.
 *
 * The SDK ships a `FetchTransport` by default (built on the global fetch API
 * available in Node 18+). Tests inject `FakeTransport` (in `test/fakes/`) to
 * skip the network entirely. Merchants who want custom HTTP behaviour
 * (proxies, retries, instrumentation) can plug in their own implementation
 * via the `transport` Config option.
 */
export interface Transport {
  /**
   * Send the request and return the response. Implementations MUST forward
   * the body bytes verbatim — the SDK has already signed those exact bytes,
   * and any mutation would invalidate the signature.
   */
  roundTrip(
    method: string,
    url: string,
    headers: Record<string, string>,
    body: string,
    options?: { signal?: AbortSignal; timeoutMs?: number },
  ): Promise<TransportResponse>;
}

/**
 * Default Transport. Uses the global `fetch` API (Node 18+).
 */
export class FetchTransport implements Transport {
  async roundTrip(
    method: string,
    url: string,
    headers: Record<string, string>,
    body: string,
    options?: { signal?: AbortSignal; timeoutMs?: number },
  ): Promise<TransportResponse> {
    const timeoutController = new AbortController();
    const timeoutMs = options?.timeoutMs ?? 30_000;
    const timeoutId = setTimeout(
      () => timeoutController.abort(new Error('request timed out')),
      timeoutMs,
    );

    // If the caller passed their own signal, abort our controller when it does.
    const callerSignal = options?.signal;
    if (callerSignal) {
      if (callerSignal.aborted) {
        timeoutController.abort(callerSignal.reason);
      } else {
        callerSignal.addEventListener('abort', () => timeoutController.abort(callerSignal.reason), {
          once: true,
        });
      }
    }

    try {
      const response = await fetch(url, {
        method,
        headers,
        body: body === '' ? undefined : body,
        signal: timeoutController.signal,
      });

      const text = await response.text();
      const headerMap: Record<string, string> = {};
      response.headers.forEach((value, key) => {
        headerMap[key.toLowerCase()] = value;
      });

      return {
        statusCode: response.status,
        body: text,
        headers: headerMap,
      };
    } catch (error) {
      throw new HttpError(
        `transport failed: ${error instanceof Error ? error.message : String(error)}`,
        { cause: error },
      );
    } finally {
      clearTimeout(timeoutId);
    }
  }
}
