# 02 — Configuration

## Two API keys, two clients

Heleket has two distinct API keys:

| Key             | Used by                                                               | SDK class        |
| --------------- | --------------------------------------------------------------------- | ---------------- |
| Payment API key | `/v1/payment/*`, `/v1/wallet/*`, `/v1/balance`, `/v1/exchange-rate/*` | `HeleketPayment` |
| Payout API key  | `/v1/payout/*`, `/v1/transfer/*`                                      | `HeleketPayout`  |

Each key is also used to verify **its own** webhooks (payment webhooks → payment key; payout webhooks → payout key).

## Default construction

```ts
import { HeleketPayment, HeleketPayout } from '@heleket-payment/sdk';

const payment = new HeleketPayment(merchantId, paymentKey);
const payout = new HeleketPayout(merchantId, payoutKey);
```

## ClientOptions

Pass a third argument to override defaults:

```ts
const client = new HeleketPayment(merchantId, paymentKey, {
  debug: true,
  timeoutMs: 60_000,
  baseUrl: 'https://api.heleket.com',
  logger: (entry) => myLogger.debug(entry),
  transport: customTransport,
});
```

Available options:

| Option      | Default                   | Purpose                                  |
| ----------- | ------------------------- | ---------------------------------------- |
| `baseUrl`   | `https://api.heleket.com` | Override API base URL (testing only)     |
| `timeoutMs` | `30_000`                  | Per-request timeout                      |
| `debug`     | `false`                   | Toggle debug logging                     |
| `logger`    | stderr text sink          | Custom debug sink, receives `DebugEntry` |
| `transport` | `FetchTransport`          | Replace the HTTP layer entirely          |

## Custom transport

The `Transport` interface has a single method. Implement it to plug in retry middleware, instrumentation, or a non-fetch HTTP client.

```ts
import { type Transport, HeleketPayment } from '@heleket-payment/sdk';

const myTransport: Transport = {
  async roundTrip(method, url, headers, body, options) {
    // ... your logic
  },
};

const client = new HeleketPayment(merchantId, paymentKey, { transport: myTransport });
```

## AbortSignal

Every public method accepts an optional `{ signal }`:

```ts
const controller = new AbortController();
setTimeout(() => controller.abort(), 5_000);

try {
  await client.createInvoice({ ... }, { signal: controller.signal });
} catch (error) {
  // HttpError if the request was cancelled
}
```

## Environment variables (recommended)

The example bootstrap reads these:

```env
HELEKET_MERCHANT_ID=...
HELEKET_PAYMENT_KEY=...
HELEKET_PAYOUT_KEY=...
HELEKET_DEBUG=0
```

Use the same names in your production environment for consistency.

## Timeouts

Default is 30 seconds. Heleket's `/v1/payout` and `/v1/payment` endpoints can take several seconds during blockchain confirmations — don't drop below 10s.

## Next

→ [03 — Architecture](03-architecture.md) or jump to [04 — Payments API](04-payments.md).
