import type { Transport, TransportResponse } from '../../src/transport.js';
import { HttpError } from '../../src/errors.js';

export interface RecordedRequest {
  method: string;
  url: string;
  headers: Record<string, string>;
  body: string;
}

/**
 * In-memory Transport for unit tests. Enqueue canned responses with
 * `enqueueJson`, then inspect what the client sent via `requests` /
 * `lastRequest`. Calls pop responses in FIFO order — the test fails if the
 * queue runs dry.
 */
export class FakeTransport implements Transport {
  private queue: Array<TransportResponse | Error> = [];
  readonly requests: RecordedRequest[] = [];

  enqueue(response: TransportResponse): this {
    this.queue.push(response);
    return this;
  }

  enqueueJson(payload: unknown, statusCode = 200): this {
    return this.enqueue({
      statusCode,
      body: JSON.stringify(payload),
      headers: { 'content-type': 'application/json' },
    });
  }

  failNext(error: Error): this {
    this.queue.push(error);
    return this;
  }

  async roundTrip(
    method: string,
    url: string,
    headers: Record<string, string>,
    body: string,
  ): Promise<TransportResponse> {
    this.requests.push({ method, url, headers: { ...headers }, body });

    const next = this.queue.shift();
    if (!next) {
      throw new Error(`FakeTransport: no enqueued response for ${method} ${url}`);
    }
    if (next instanceof Error) {
      throw new HttpError(next.message, { cause: next });
    }
    return next;
  }

  lastRequest(): RecordedRequest {
    if (this.requests.length === 0) {
      throw new Error('FakeTransport: no requests recorded');
    }
    return this.requests[this.requests.length - 1]!;
  }
}
