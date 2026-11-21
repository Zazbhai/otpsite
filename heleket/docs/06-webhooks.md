# 06 — Webhooks

Webhooks deliver payment and payout status updates to your server. **Always** verify the signature before trusting the payload.

## How Heleket signs webhooks

For every webhook event Heleket POSTs a JSON body containing your fields plus a `sign` field. The signature is computed exactly like outbound request signatures:

```
sign = md5( base64( json_body_without_sign_field ) . apiKey )
```

The key depends on the webhook type:

| Webhook type        | Key to verify with |
| ------------------- | ------------------ |
| `payment`, `wallet` | Payment API key    |
| `payout`            | Payout API key     |

If you mix them up, every webhook fails.

## Why `verifyRaw` (not `verify`) for production

Heleket's server uses PHP-encoded JSON: insertion-order keys, forward slashes escaped as `\/` (`"https:\/\/pay.heleket.com\/..."`).

JavaScript's behaviour:

- `JSON.parse` then `JSON.stringify` preserves object key order (ES2015 spec) ✓
- `JSON.stringify` does **NOT** escape forward slashes ✗

So a Node.js round-trip through `JSON.parse` and `JSON.stringify` strips the slash escapes — and the resulting bytes no longer match what Heleket signed.

**`verifyRaw(rawBody)` works on the raw bytes** (it surgically removes the `sign` field from the original bytes and hashes the remainder). This is the method that handles real Heleket webhooks correctly.

**`verify(decoded)` is a convenience** for already-decoded payloads. It's lossy — it re-stringifies and can't recover the slash escapes — so it only works against payloads that originated in a Node-compatible encoder (typically tests).

## Verifying a webhook

```ts
import { createServer } from 'node:http';
import { SignatureError, WebhookVerifier } from '@heleket-payment/sdk/webhook';

const verifier = new WebhookVerifier(paymentKey);

const server = createServer(async (req, res) => {
  if (req.method !== 'POST') {
    res.statusCode = 400;
    res.end();
    return;
  }

  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(chunk as Buffer);
  const body = Buffer.concat(chunks).toString('utf8');

  try {
    const payload = verifier.verifyRaw(body);

    if (payload.isSuccessful()) {
      markOrderPaid(payload.orderId, payload.amount);
    }

    res.statusCode = 200;
    res.end('OK');
  } catch (error) {
    if (error instanceof SignatureError) {
      console.warn('[heleket] signature mismatch:', error.reason);
    }
    res.statusCode = 400;
    res.end('invalid signature');
  }
});

server.listen(8000);
```

## With Express / Fastify

If you use Express, **don't** install `express.json()` on the webhook route — that consumes the body before your handler sees it. Either skip body parsing on that route or use `express.raw()` to keep the bytes intact:

```ts
import express from 'express';
app.post('/heleket-webhook', express.raw({ type: 'application/json' }), (req, res) => {
  const body: Buffer = req.body;
  const payload = verifier.verifyRaw(body);
  res.status(200).send('OK');
});
```

## Reading the verified payload

`WebhookPayload` exposes typed accessors plus the original decoded map:

```ts
payload.type; // "payment", "wallet", or "payout"
payload.isPayment(); // true for payment/wallet
payload.isPayout();
payload.uuid;
payload.orderId;
payload.status; // "paid", "wrong_amount", "process", ...
payload.isFinal(); // server-provided OR falls back to status enum
payload.isSuccessful(); // true for paid / paid_over
payload.amount;
payload.txid;
payload.network;
payload.raw; // Record<string, unknown> — every field from Heleket
```

## Idempotency and replay protection

Heleket may deliver the same status more than once. Common causes:

- **Retries** — if you respond non-2xx (or time out), Heleket retries with the same payload.
- **Manual replays** — operators (and your own code via `resendWebhook`) can re-send historical events.
- **Network drops** — your edge accepted the request but the response never reached Heleket, so it retries.

A signature-valid webhook captured off the wire can also be replayed by an attacker who proxies it back to your endpoint. The signature alone does **not** prove freshness.

**You must de-duplicate.** Treat each `(uuid, status)` pair as a unique event and store it before doing any side-effect work.

### Pattern with Postgres

```sql
CREATE TABLE heleket_webhook_events (
    event_key    VARCHAR(128) PRIMARY KEY,
    payload      JSONB NOT NULL,
    received_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    processed_at TIMESTAMPTZ
);
```

```ts
const eventKey = `${payload.uuid}:${payload.status}`;

const result = await pg.query(
  `INSERT INTO heleket_webhook_events (event_key, payload)
   VALUES ($1, $2)
   ON CONFLICT (event_key) DO NOTHING`,
  [eventKey, JSON.stringify(payload.raw)],
);

if (result.rowCount === 0) {
  // Duplicate — already processed.
  res.status(200).send('OK (duplicate)');
  return;
}

try {
  await processWebhook(payload);
  await pg.query(`UPDATE heleket_webhook_events SET processed_at = NOW() WHERE event_key = $1`, [
    eventKey,
  ]);
} catch (err) {
  // Release the claim so Heleket's retry can succeed.
  await pg.query(`DELETE FROM heleket_webhook_events WHERE event_key = $1`, [eventKey]);
  throw err;
}

res.status(200).send('OK');
```

### Pattern with Redis (ioredis)

```ts
import Redis from 'ioredis';
const redis = new Redis();

const claimed = await redis.set(`heleket:webhook:${eventKey}`, '1', 'NX', 'EX', 86400);
if (!claimed) {
  res.status(200).send('OK (duplicate)');
  return;
}
await processWebhook(payload);
```

The Redis variant is simpler but forgets after the TTL — pick a window longer than Heleket's retry window (24h is safe).

### Why `(uuid, status)`, not just `uuid`

A single invoice can legitimately progress through several statuses — for example `check` → `paid`, or `wrong_amount_waiting` → `paid`. Deduping by `uuid` alone would drop the second event and your accounting would diverge. The `(uuid, status)` pair is unique per real state transition.

## IP allowlisting

Heleket sends webhooks from `31.133.220.8`. Allow only that IP at your reverse proxy if possible. **Don't rely on IP alone** — signature verification is the authoritative trust boundary.

## Local development

Use a tunnel:

```bash
make example-webhook
# In another terminal:
ngrok http 8000
```

Then either point `url_callback` at the ngrok URL or trigger a synthetic event via `testWebhook`:

```ts
await paymentClient.testWebhook({
  type: 'payment',
  url_callback: 'https://abc.ngrok.io',
  currency: 'USD',
  network: 'tron',
  status: 'paid',
  order_id: 'order-42',
});
```

## When signatures fail — debug recipe

Capture the failing payload, then:

```bash
echo '<paste the JSON here>' | npx heleket-webhook-inspect --key=$KEY
# or:
make webhook-inspect KEY=$HELEKET_PAYMENT_KEY
```

See [07 — Debugging](07-debugging.md).

## Next

→ [07 — Debugging](07-debugging.md)
