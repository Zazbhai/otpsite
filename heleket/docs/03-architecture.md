# 03 — Architecture

## High-level diagram

```
              ┌───────────────────────────────────┐
              │  new HeleketPayment / HeleketPayout │
              └──────────────┬────────────────────┘
                             │
              ┌──────────────┴──────────────┐
              ▼                             ▼
      ┌──────────────────┐         ┌──────────────────┐
      │  HeleketPayment  │         │  HeleketPayout   │
      └────────┬─────────┘         └────────┬─────────┘
               │  extends                    │ extends
               └──────────────┬──────────────┘
                              ▼
                      ┌─────────────────┐
                      │   BaseClient    │   encode → sign → dispatch
                      │                 │   → decode envelope or throw
                      └────────┬────────┘
   ResolvedConfig ────────────►│
   Transport ─────────────────►│
   DebugSink (slog-style) ────►│
                              ▼
                      ┌─────────────────┐
                      │  FetchTransport │   ← default, swappable
                      └─────────────────┘
```

## Package layout

| Path                           | Purpose                                                                                                                       |
| ------------------------------ | ----------------------------------------------------------------------------------------------------------------------------- |
| `@heleket-payment/sdk` (root)  | Public types, constructors, signature helpers, error types                                                                    |
| `@heleket-payment/sdk/webhook` | Webhook signature verification + payload value type. Imported separately so webhook-only consumers don't pull the full client |

## Source files

| File                      | Responsibility                                                             |
| ------------------------- | -------------------------------------------------------------------------- |
| `src/index.ts`            | Public surface — every export merchants use                                |
| `src/config.ts`           | `ClientOptions` + `resolveConfig` validation                               |
| `src/signature.ts`        | `sign(body, key)` + `signatureEqual(a, b)`                                 |
| `src/errors.ts`           | `ApiError`, `ValidationError`, `HttpError`, `SignatureError`               |
| `src/transport.ts`        | `Transport` interface + default `FetchTransport`                           |
| `src/debug.ts`            | `DebugEntry`, `DebugSink`, default stderr sink                             |
| `src/status.ts`           | `PaymentStatus`, `PayoutStatus`, `AmlLinkStatus`, `CourseSource` + helpers |
| `src/client.ts`           | `BaseClient.post` / `.get` → `send` — the one place that performs HTTP     |
| `src/payment.ts`          | `HeleketPayment` + every payment endpoint                                  |
| `src/payment-types.ts`    | Typed request/response interfaces                                          |
| `src/payout.ts`           | `HeleketPayout` + every payout endpoint                                    |
| `src/payout-types.ts`     | Typed request/response interfaces                                          |
| `src/webhook/verifier.ts` | `WebhookVerifier` (byte-fidelity)                                          |
| `src/webhook/payload.ts`  | `WebhookPayload` with typed accessors                                      |

## Request flow

1. Caller invokes `client.createInvoice({...})`.
2. `HeleketPayment.createInvoice` calls `BaseClient.post('/v1/payment', req)`.
3. `BaseClient.post` JSON-encodes the request (filters out `undefined` fields; empty objects → empty body), then both `post` and `get` delegate to the shared `send`, which:
   - Signs the body with the API key via `sign` (empty body for `get` → `md5(apiKey)`).
   - Builds headers: `merchant`, `sign`, and `Content-Type` (only when there's a body).
   - Calls debug sink (no-op when `debug=false`).
   - Calls `Transport.roundTrip(method, url, headers, body, { signal, timeoutMs })`.
   - Calls debug sink with the response.
   - Decodes the response envelope (`state`, `result`, `errors`).
4. On `state=0`, the `result` is returned as the typed `T`. On any failure, a typed error is thrown.

Read-only, path-only endpoints (just `getExchangeRates` today) call `BaseClient.get(path)` instead, which signs an empty body and dispatches a `GET`.

## Signature flow

```
request struct           apiKey
       │                   │
       ▼                   ▼
JSON.stringify(req) (filter undefined)
       │
       ▼
body (string) ────────────►│
                           │
       Buffer.from(body).toString('base64') + apiKey
                           │
                           ▼
                  createHash('md5').digest('hex')
                           │
                           ▼
                  HTTP header "sign: <hex>"
```

The same `sign` function produces outgoing request signatures and verifies incoming webhook signatures (in the `webhook` subpackage).

## Concurrency

Node's single-threaded event loop means clients are naturally usable across concurrent async tasks. `HeleketPayment` and `HeleketPayout` hold an immutable config and a shared `FetchTransport`. There's no need to construct a client per request — share one across your HTTP handlers.

## Design choices

- **No third-party deps.** Stdlib only. Easier to vendor, audit, and install in restricted environments.
- **Transport is an interface.** Tests inject `FakeTransport`. Merchants who want a custom HTTP backend can implement the one-method contract.
- **Configuration is per-client.** No global state; create as many clients as you need.
- **Typed interfaces, never `any`.** Optional fields are typed nullably; the SDK never errors on unknown fields in responses (your typed interfaces don't see them, but they're preserved if you parse the raw body yourself).
- **`slog`-style debug sink.** A function callback receives structured entries. Wraps any logger your app uses (pino, winston, console).
- **Byte-fidelity webhook verification.** See [06-webhooks.md](06-webhooks.md) — this is the most important architectural decision in the SDK.

## Next

→ [04 — Payments API](04-payments.md)
