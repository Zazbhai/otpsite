# Heleket Node.js integration (reference)

A production-grade reference SDK for the [Heleket](https://heleket.com) cryptocurrency payment API. Written in **TypeScript**, published as `@heleket-payment/sdk` with both `.js` (ESM) and `.d.ts` outputs — works equally well from TypeScript and pure-JavaScript projects.

Covers the full documented surface (payments, payouts, balance, services, exchange rates), ships with `node:test` unit tests, runnable examples, byte-fidelity webhook verification, debug mode wired into your choice of logger, a `heleket-webhook-inspect` CLI, and a Docker harness.

Zero runtime dependencies — only the Node.js standard library (`node:crypto`, `globalThis.fetch`, `node:http`).

## Quickstart

```ts
import { HeleketPayment } from '@heleket-payment/sdk';

const client = new HeleketPayment(merchantId, paymentKey);

const invoice = await client.createInvoice({
  amount: '15.00',
  currency: 'USD',
  order_id: 'order-42',
});

console.log(invoice.url); // → https://pay.heleket.com/pay/<uuid>
```

## Install

```bash
npm install @heleket-payment/sdk
```

Requirements: Node 20 LTS+ (built-in `fetch`, `node:test`).

## Documentation

Full reference lives in [`docs/`](docs/README.md):

- [01 — Installation](docs/01-installation.md)
- [02 — Configuration](docs/02-configuration.md)
- [03 — Architecture](docs/03-architecture.md)
- [04 — Payments API](docs/04-payments.md)
- [05 — Payouts API](docs/05-payouts.md)
- [06 — Webhooks](docs/06-webhooks.md) ⚑ critical reading
- [07 — Debugging](docs/07-debugging.md)
- [08 — Testing](docs/08-testing.md)
- [09 — Error handling](docs/09-error-handling.md)
- [10 — Reference (statuses, currencies, endpoints)](docs/10-reference.md)
- [12 — Troubleshooting](docs/12-troubleshooting.md)

## What's in the box

```
src/                     TypeScript source — single source of truth
src/webhook/             Webhook signature verification (importable as @heleket-payment/sdk/webhook)
test/                    node:test unit tests + FakeTransport for offline testing
examples/                Twelve runnable scripts covering every endpoint
bin/                     heleket-webhook-inspect — CLI for verifying webhook payloads
docker/                  Multi-stage Dockerfile (node:20-alpine)
docs/                    Full module documentation
AGENTS.md                Architecture tour for AI agents (and humans in a hurry)
```

## Common tasks

```bash
make install              # npm install
make build                # tsc → dist/
make test                 # build + node --test
make lint                 # ESLint
make format-check         # Prettier dry-run
make qa                   # All quality gates
make example-invoice      # Create a real invoice (needs .env)
make example-webhook      # Run the webhook listener on :8000
make docker-shell         # Drop into a containerized Node 20 shell
make help                 # Full target list
```

## Security notes (read this)

- **Use `verifyRaw` for production webhooks.** `verify(decodedPayload)` is a convenience but cannot recover PHP-style slash escapes that Heleket sends. See [docs/06-webhooks.md](docs/06-webhooks.md).
- **De-duplicate replays.** Use a `(uuid, status)` key in your DB before doing side-effect work — pattern documented in [docs/06-webhooks.md](docs/06-webhooks.md#idempotency-and-replay-protection).
- **Whitelist Heleket's webhook source IP `31.133.220.8`** at your reverse proxy or firewall.
- **Two separate API keys** — payments and payouts. Mixing them breaks webhook verification.
- **The SDK never logs API keys.** Debug-mode output via `slog`-style entries includes URL, method, body, status — but the `sign` header and API key are explicitly excluded.

## Releasing

- Bump the version in **both** `package.json` and `src/version.ts` (the latter feeds the `User-Agent`).
- Update [`CHANGELOG.md`](CHANGELOG.md) and, for breaking changes, [`UPGRADING.md`](UPGRADING.md).
- Tag the release `vX.Y.Z` and push the tag. [`.github/workflows/publish.yml`](.github/workflows/publish.yml) verifies the tag matches `package.json`, builds, and publishes `@heleket-payment/sdk` to npm with provenance (requires the `NPM_TOKEN` repository secret).

## License

MIT — see [LICENSE](LICENSE).
