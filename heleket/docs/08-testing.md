# 08 — Testing

## Running the SDK's own tests

```bash
make test         # build:esm + node --test on the compiled dist/test/*.test.js
make lint         # ESLint
make format-check # Prettier dry-run
make qa           # All gates
```

In Docker:

```bash
make docker-qa
```

The SDK uses Node's built-in `node:test` runner — no Jest, Mocha, or Vitest dependency.

## Writing tests against the SDK

The SDK is fully testable offline thanks to the `Transport` interface. Inject `FakeTransport` (from the test fixtures included in the repo, or write your own) and the client will skip the network entirely.

```ts
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { HeleketPayment, type Transport, type TransportResponse } from '@heleket-payment/sdk';

class FakeTransport implements Transport {
  responses: TransportResponse[] = [];
  requests: Array<{ url: string; body: string }> = [];

  enqueueJson(payload: unknown, statusCode = 200) {
    this.responses.push({
      statusCode,
      body: JSON.stringify(payload),
      headers: { 'content-type': 'application/json' },
    });
    return this;
  }

  async roundTrip(_method: string, url: string, _headers: Record<string, string>, body: string) {
    this.requests.push({ url, body });
    const resp = this.responses.shift();
    if (!resp) throw new Error(`unexpected request to ${url}`);
    return resp;
  }
}

describe('checkout flow', () => {
  it('creates the right invoice', async () => {
    const fake = new FakeTransport().enqueueJson({
      state: 0,
      result: { uuid: 'uuid-1', url: 'https://pay/...' },
    });

    const client = new HeleketPayment('merchant', 'key', { transport: fake });

    const invoice = await client.createInvoice({
      amount: '1',
      currency: 'USD',
      order_id: 'x',
    });

    assert.equal(invoice.uuid, 'uuid-1');
    assert.equal(fake.requests[0]!.url, 'https://api.heleket.com/v1/payment');
  });
});
```

## Integration tests against real Heleket

Gate them on env vars and skip when missing:

```ts
import { it } from 'node:test';

it('creates a real invoice', { skip: !process.env.HELEKET_PAYMENT_KEY }, async () => {
  const client = new HeleketPayment(
    process.env.HELEKET_MERCHANT_ID!,
    process.env.HELEKET_PAYMENT_KEY!,
  );
  const invoice = await client.createInvoice({
    amount: '1',
    currency: 'USD',
    order_id: 'integ-' + Date.now(),
  });
  assert.ok(invoice.url.startsWith('https://pay.heleket.com/'));
});
```

## CI example (GitHub Actions)

```yaml
name: Node SDK
on: [push, pull_request]
jobs:
  qa:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: '20'
          cache: 'npm'
      - run: npm ci
      - run: npm run qa
```

## Next

→ [09 — Error handling](09-error-handling.md)
