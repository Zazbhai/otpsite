# 07 — Debugging

Two tools ship with the SDK: a **debug flag** for runtime tracing via a `slog`-style sink, and a **webhook inspector CLI** for ad-hoc payload verification.

## Debug mode

Pass `debug: true` to the client constructor, or set `HELEKET_DEBUG=1` in your `.env` if you use the example bootstrap.

```ts
import { HeleketPayment, type DebugEntry } from '@heleket-payment/sdk';

const client = new HeleketPayment(merchantId, paymentKey, {
  debug: true,
  // Optional: route to your app's logger
  logger: (entry: DebugEntry) => myLogger.debug(entry),
});
```

Default sink writes to **stderr** (so stdout capture is unaffected):

```
[heleket][→ POST https://api.heleket.com/v1/payment] {"amount":"15.00","currency":"USD","order_id":"order-42"}
[heleket][← 200] {"state":0,"result":{"uuid":"...", ...}}
```

> ⚠️ Debug output contains the **request body** and **response body**. The API key and the `sign` header are **never** passed to the sink. Still, scrub debug logs before sharing.

## Webhook inspector CLI

`heleket-webhook-inspect` reads a JSON webhook payload, prints the parsed fields, and verifies the signature (using `verifyRaw`, so PHP slash escapes are handled correctly).

Build it once:

```bash
make build
```

### Usage

```bash
# From stdin (most common)
cat webhook.json | node dist/bin/heleket-webhook-inspect.js --key=$HELEKET_PAYMENT_KEY

# From a file
node dist/bin/heleket-webhook-inspect.js --key=$KEY --file=webhook.json

# Hint the expected type
node dist/bin/heleket-webhook-inspect.js --key=$KEY --type=payout < webhook.json
```

After `npm publish`, it's also available as a global `npx` command:

```bash
npx heleket-webhook-inspect --key=$KEY --file=webhook.json
```

### Sample output

```
Heleket webhook inspector
----------------------------------------
  type       payment
  uuid       1ec87133-b22d-4643-988f-cac29a6ac85d
  order_id   order-42
  status     paid
  amount     15.00
  network    tron
  txid       deadbeef
  is_final   yes
  sign       4a8f2c2c4a8f2c2c…

signature: valid
```

### Exit codes

| Code | Meaning                           |
| ---- | --------------------------------- |
| 0    | Payload valid, signature verified |
| 1    | Input not parseable as JSON       |
| 2    | Signature mismatch                |
| 3    | Missing arguments                 |

### Where to get the payload

Capture it in your handler before verification fails:

```ts
try {
  const payload = verifier.verifyRaw(body);
} catch (error) {
  await fs.writeFile('/tmp/heleket-failed.json', body);
  throw error;
}
```

Then pipe that file into the inspector.

## Common error shapes

| Symptom                                               | Likely cause                                                                                                                    |
| ----------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| Always `signature: INVALID`                           | Wrong API key — using payment key for a payout webhook (or vice versa)                                                          |
| Signature valid in `--file` but invalid in production | Middleware mutated the body before your handler read it. Disable `express.json()` on the webhook route, or use `express.raw()`. |
| `ValidationError` from `createInvoice`                | A required field is missing — `.fields` lists them                                                                              |
| `ApiError` with `"Server error, #1"`                  | Heleket-side outage; retry after a short backoff                                                                                |
| `HttpError` mentioning "aborted" / "timed out"        | Network timeout — raise `timeoutMs` or check egress firewalls                                                                   |

## Custom transport with verbose tracing

```ts
import { type Transport, HeleketPayment } from '@heleket-payment/sdk';

class TracingTransport implements Transport {
  constructor(private inner: Transport) {}
  async roundTrip(method, url, headers, body, options) {
    console.log(`→ ${method} ${url}\n${body}`);
    const resp = await this.inner.roundTrip(method, url, headers, body, options);
    console.log(`← ${resp.statusCode}\n${resp.body}`);
    return resp;
  }
}
```

## Next

→ [08 — Testing](08-testing.md)
