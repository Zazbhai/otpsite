# 12 — Troubleshooting

The most common merchant problems and their fixes.

## 1. `signature: INVALID` on webhooks

**Most likely cause:** verifying with the wrong API key.

- Payment + static-wallet webhooks (`type: payment`, `type: wallet`) → **payment** API key
- Payout webhooks (`type: payout`) → **payout** API key

```ts
new WebhookVerifier(paymentApiKey); // for payment webhooks
new WebhookVerifier(payoutApiKey); // for payout webhooks
```

**Other causes:**

- Middleware mutated the body before your handler read it. In Express, replace `express.json()` with `express.raw({ type: 'application/json' })` on the webhook route.
- You called `verify(decoded)` instead of `verifyRaw(rawBody)`. `verify` re-stringifies, which loses PHP slash escapes. **Always use `verifyRaw` in production.**

Run the inspector:

```bash
echo '<paste payload>' | node dist/bin/heleket-webhook-inspect.js --key=$KEY
```

## 2. `ValidationError` when creating an invoice

`error.fields` lists the offending fields. The most-seen ones:

| Field          | Common reason                                                                           |
| -------------- | --------------------------------------------------------------------------------------- |
| `amount`       | Empty, non-numeric, or below the minimum for the chosen currency                        |
| `order_id`     | Duplicate (already exists in your merchant invoices) or contains unsupported characters |
| `currency`     | Currency code not enabled for your merchant                                             |
| `url_callback` | Not HTTPS, or shorter than 6 chars                                                      |

## 3. `ApiError` with `Wrong key` / `You are forbidden`

The merchant account is restricted or in moderation. Check the dashboard at <https://dash.heleket.com>. New accounts need domain verification before invoices are accepted.

## 4. `HttpError` containing `aborted` / `timed out`

Heleket can take 5–10 seconds during heavy blockchain confirmation. Raise the timeout:

```ts
new HeleketPayment(merchantId, key, { timeoutMs: 60_000 });
```

If the timeout fires on every call, your egress firewall is blocking `api.heleket.com:443`.

## 5. Payments stuck in `check` / `confirm_check`

- `check` = waiting for the transaction to appear in the mempool
- `confirm_check` = seen on-chain, awaiting confirmations (typically 1–6 depending on the network)

Wait. Don't poll faster than every 30 seconds.

`wrong_amount_waiting` means the payer underpaid — the invoice is still open and additional top-ups are accepted.

## 6. Payout API key recently rotated

> "Withdrawals will be temporarily blocked for 24 hours after generating a new payout API key."

Not a bug — schedule rotations accordingly.

## 7. Outbound signature mismatch

If Heleket rejects your **outbound** requests with a signature error, the most common cause is hand-rolled HTTP (the SDK handles signing correctly internally). The recipe:

```ts
import { sign } from '@heleket-payment/sdk';

const body = JSON.stringify(params);
const signature = sign(body, apiKey);

await fetch(url, {
  method: 'POST',
  headers: {
    merchant: merchantId,
    sign: signature,
    'Content-Type': 'application/json',
  },
  body, // must be the SAME bytes that were signed
});
```

## 8. Webhook never received

- Confirm `url_callback` is publicly reachable (`curl` from a different network).
- Use `testWebhook` to send a synthetic event without a real payment.
- Check your server logs for 4xx/5xx replies — Heleket retries until you 200; a 200 with broken logic is recorded as delivered.
- Whitelist `31.133.220.8` rather than blocking unknown IPs at the firewall.

## 9. `is_subtract` confusion on payouts

| Value   | Behaviour                                                                                            |
| ------- | ---------------------------------------------------------------------------------------------------- |
| `true`  | Commission deducted from `amount`. Recipient receives `amount - commission`.                         |
| `false` | Commission added on top. Recipient receives `amount`. Your balance is debited `amount + commission`. |

Use `calculateWithdrawal` to preview the numbers before committing.

## 10. Static wallet keeps emitting `is_final=true` per deposit

By design — each top-up generates its own webhook with `is_final=true` for that particular event. The wallet itself remains open and accepts further deposits. Don't close it after one event.

## 11. `MODULE_NOT_FOUND` when running examples

You ran `node examples/01-create-invoice.ts` instead of building first. Use:

```bash
npm run build && node dist/examples/01-create-invoice.js
# or, with the bundled Makefile:
make example-invoice
```

The SDK ships compiled `.js` — the source `.ts` files are not directly runnable by Node without a TS loader.

## Still stuck?

Capture the failing request/response with `debug: true` (see [07 — Debugging](07-debugging.md)), then reach out to Heleket support at <https://heleket.com/contacts> with:

- The `order_id` involved
- Approximate timestamps (UTC+3)
- The error type (e.g. `ValidationError`) and message
- A redacted excerpt of the debug output (strip API keys)

## End of documentation

Back to [docs index](README.md) or [README](../README.md).
