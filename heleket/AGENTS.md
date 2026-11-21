# AGENTS.md

Guidance for AI coding agents (Claude Code, Codex, Cursor, Copilot, …) working on
or integrating the **Heleket Node.js SDK**. Humans: this doubles as a fast
architecture tour — see [`docs/`](docs/README.md) for the full reference.

## What this is

The reference Node.js SDK for the [Heleket](https://heleket.com) cryptocurrency
payment API: payments, payouts, balance, exchange rates, services, and signed
webhooks. Written in TypeScript and typed end-to-end (ships `.d.ts`).

- Package: **`@heleket-payment/sdk`** on npm. Webhook-only consumers can import the
  `@heleket-payment/sdk/webhook` subpath.
- **Node 20+** (built-in `fetch`, `node:test`, `node:crypto`).
- **Zero runtime dependencies** — Node standard library only.
- Dual published output: **ESM** (`.js`) + **CommonJS** (`.cjs`) + types
  (`.d.ts` / `.d.cts`).
- Upstream API docs: <https://doc.heleket.com>.

## Repository map

| Path                             | Purpose                                                                                       |
| -------------------------------- | --------------------------------------------------------------------------------------------- |
| `src/`                           | TypeScript source — the single source of truth. Public names are re-exported from `index.ts`. |
| `src/webhook/`                   | Webhook verification, also published as the `@heleket-payment/sdk/webhook` subpath.           |
| `test/`                          | `node:test` suite + `test/fakes/fake-transport.ts` (`FakeTransport`) for offline HTTP.        |
| `examples/`                      | Runnable scripts (`01`..`12`) covering every endpoint + `_bootstrap.ts`. Need `.env`.         |
| `bin/heleket-webhook-inspect`    | CLI to verify/dump a webhook payload.                                                         |
| `docs/`                          | Full English reference (architecture, every endpoint, webhooks, …).                           |
| `scripts/build-cjs-finalize.mjs` | Post-build step: renames the CJS output to `.cjs` and rewrites `require` paths.               |
| `Makefile`                       | `make qa`, `make test`, `make lint`, `make build`, examples, Docker.                          |
| `.github/workflows/`             | `ci.yml` (gate, Node 20 & 22) · `publish.yml` (npm publish with provenance on `v*` tags).     |

## Architecture

```
HeleketPayment / HeleketPayout      (one method per endpoint; typed in, typed out)
   └─ BaseClient                    (the ONLY place that does HTTP: post / get → send)
        ├─ ResolvedConfig           (baseUrl, timeoutMs, debug, logger, transport)
        ├─ sign()                   (md5(base64(body) + apiKey); signatureEqual is constant-time)
        ├─ Transport (interface)    → FetchTransport (default, swappable)
        └─ DebugSink                (request/response trace when debug=true; never secrets)

WebhookVerifier → WebhookPayload                 (verify inbound signatures)
PaymentStatus / PayoutStatus / AmlLinkStatus     (is*Final / is*Successful helpers)
HeleketError ← ApiError / ValidationError / HttpError / SignatureError
payment-types.ts / payout-types.ts               (TypeScript request/response types)
```

`src/client.ts::send()` is the heart: it signs the **exact** body bytes, sets the
`merchant` / `sign` / `Content-Type` / `User-Agent` headers, dispatches via the
transport, and turns the response into either the parsed `result` or a typed
error. `post()` and `get()` both delegate to `send()`.

## Conventions (follow these)

- **Typed in, typed out.** Endpoints take request interfaces (in
  `payment-types.ts` / `payout-types.ts`) and return typed results.
- **Sign the exact wire bytes.** `encodeBody()` produces the JSON string and
  `sign()` hashes that same string. No params / empty object → `''` → sign
  collapses to `md5(apiKey)`. Never re-encode between signing and sending.
- **Drop `undefined`.** `encodeBody()` strips `undefined` fields so optional
  params don't reach the wire.
- **SDK-managed headers win.** Caller `options.headers` are merged first, then
  `merchant` / `sign` / `User-Agent` (and `Content-Type` when there's a body)
  overwrite them — you can't tamper with the signature or spoof the merchant.
- **Error model:** HTTP 422 → `ValidationError` (`.fields` = per-field messages);
  `state != 0` → `ApiError` (`.httpStatus`, `.rawBody`); transport failure →
  `HttpError`; bad webhook signature → `SignatureError`. All extend `HeleketError`.
- **ESM source with `NodeNext`.** Import specifiers carry the `.js` extension
  even though the files are `.ts` (e.g. `import { sign } from './signature.js'`).
  Keep this — it's what makes the dual ESM/CJS build resolve.

## How to add an endpoint

1. Add request/response types to `payment-types.ts` or `payout-types.ts`
   (snake_case wire fields).
2. Add a method to `HeleketPayment` / `HeleketPayout` calling
   `this.post('/v1/...', req)` (or `this.get(path)` for a read-only, path-only
   endpoint). Guard "one of uuid/order_id" preconditions by throwing.
3. Export any new public types/enums from `src/index.ts`.
4. Add a unit test in `test/payment.test.ts` / `payout.test.ts` using
   `FakeTransport` — assert method, URL, signed headers, body, and parsed result.
   No network.
5. If user-facing, add a runnable `examples/NN-*.ts` (+ a `Makefile` target).
6. Run `npm run qa`.

## Running things

```bash
npm install        # or: make install
npm run qa         # lint + format check + tests (the gate; CI runs Node 20 & 22)
npm run build      # ESM + CJS + types → dist/
npm test           # build ESM + node --test
npm run lint       # eslint
npm run format     # prettier --write
```

Tests are fully offline via `FakeTransport` — never hit the real API in tests.
Examples read credentials from `.env` (copy `.env.example`).

## Gotchas (do not get these wrong)

- **Webhook byte-fidelity trap.** Use `WebhookVerifier.verifyRaw(rawBody)` in
  production — it hashes the exact bytes Heleket sent (PHP-style `\/` slash
  escapes, insertion-order keys). `verify(decodedPayload)` re-encodes and is
  convenience-only — **not** safe for real traffic. See
  [`docs/06-webhooks.md`](docs/06-webhooks.md).
- **Two separate API keys.** Payments and payouts use different keys; a webhook of
  the wrong kind fails verification. `HeleketPayment` vs `HeleketPayout`.
- **Refund is the cross-key exception.** `/v1/payment/refund` is a payment-domain
  path but is signed with the **payout** key, so it lives on
  `HeleketPayout.refund()`. `HeleketPayment` does **not** expose `refund()`.
  (`refundBlockedWallet()` is a different wallet endpoint and stays on payment.)
- **`getExchangeRates` is the only GET** (`/v1/exchange-rate/{ccy}/list`; input
  in the path, empty signed body). Every other endpoint is a POST, even reads.
- **AML links** (`getAmlLinks(uuid?, orderId?)`) return questionnaire links for a
  blocked (`locked`) payment; statuses are `AmlLinkStatus`.
- **Always verify webhook signatures** before trusting a payload; whitelist
  Heleket's source IP `31.133.220.8`.
- **Never log API keys.** Debug entries carry method, URL, and body only — never
  the `sign` header or the key.

## Releasing / versioning

- One npm package = one repo: published from `github.com/Heleket/nodejs-sdk`.
- Version lives in **two** places: `package.json` and `src/version.ts` (the latter
  feeds the `User-Agent`). **Bump both.**
- Tagging `vX.Y.Z` triggers [`.github/workflows/publish.yml`](.github/workflows/publish.yml),
  which builds, asserts the tag matches the `package.json` version, and publishes
  to npm with provenance (needs the `NPM_TOKEN` repository secret).
- See [`CHANGELOG.md`](CHANGELOG.md) and [`UPGRADING.md`](UPGRADING.md).
