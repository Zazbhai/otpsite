# 09 — Error handling

## Error types

```
Error
└── HeleketError                  (base — catch this to handle any SDK failure)
    ├── HttpError                 (transport: DNS, TCP, TLS, timeout)
    ├── ApiError                  (state != 0; non-422)
    │     └── ValidationError     (HTTP 422 with .fields)
    └── SignatureError            (webhook signature mismatch)
```

All extend the standard `Error`. Inspect with `instanceof`.

## Quick reference

| Error             | Thrown by                 | What to do                                                         |
| ----------------- | ------------------------- | ------------------------------------------------------------------ |
| `HttpError`       | Any client method         | Retry with backoff                                                 |
| `ValidationError` | Any client method         | Surface `.fields` to the caller; do not retry                      |
| `ApiError`        | Any client method         | Inspect `.message` + `.httpStatus` + `.rawBody`; retry only on 5xx |
| `SignatureError`  | `WebhookVerifier` methods | Drop the request, return HTTP 400                                  |

## Recommended catch shape

```ts
import { ApiError, HttpError, ValidationError } from '@heleket-payment/sdk';

try {
  const invoice = await client.createInvoice(req);
  /* ... */
} catch (error) {
  if (error instanceof ValidationError) {
    // 422 — never retry. Show errors to the user.
    for (const [field, msgs] of Object.entries(error.fields)) {
      console.log(`${field}: ${msgs.join(', ')}`);
    }
  } else if (error instanceof HttpError) {
    // Transport — usually safe to retry.
    scheduleRetry();
  } else if (error instanceof ApiError) {
    // Business error. Retry only on 5xx + idempotent operation.
    if (error.httpStatus >= 500) scheduleRetry();
    else logHeleketError(error.message, error.rawBody);
  } else {
    throw error; // unknown
  }
}
```

Note the order: `ValidationError` first because it extends `ApiError` — checking `ApiError` first would always match.

## `Error.cause` for transport failures

`HttpError` carries the underlying network error in its `cause`:

```ts
catch (error) {
  if (error instanceof HttpError) {
    console.log('underlying:', error.cause);
  }
}
```

## Retry guidance

| Error                           | Safe to retry?               |
| ------------------------------- | ---------------------------- |
| `HttpError` (timeout, DNS, TLS) | Yes — exponential backoff    |
| `ApiError` HTTP 5xx             | Yes — exponential backoff    |
| `ApiError` HTTP 4xx (non-422)   | No — fix the request first   |
| `ValidationError` (422)         | No                           |
| `SignatureError`                | No — never trust the payload |

For idempotency on retries of create-\* calls, **reuse the same `order_id`**. Heleket rejects duplicates and returns the existing record.

## Logging

The SDK never logs by default. Use the `logger` Config option to route the debug sink to your application's logger:

```ts
const client = new HeleketPayment(merchantId, key, {
  debug: true,
  logger: (entry) => pino.debug(entry, 'heleket'),
});
```

For errors, catch them and pass to your logger explicitly — the SDK exposes everything needed:

```ts
catch (error) {
  if (error instanceof ApiError) {
    logger.warn({
      httpStatus: error.httpStatus,
      message: error.message,
      rawBody: error.rawBody,
      orderId: req.order_id,
    }, 'heleket api rejected create-invoice');
    throw error;
  }
}
```

## ValidationError shape

```ts
error.fields ===
  {
    amount: ['validation.required'],
    currency: ['validation.required'],
  };
```

Values are arrays of messages (sometimes more than one per field).

## Next

→ [10 — Reference](10-reference.md)
