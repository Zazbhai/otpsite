# Changelog

All notable changes to this project are documented here. The format is based on
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project
adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.1.0] - 2026-06-26

Initial public release — a production-grade reference Node.js SDK for the Heleket
cryptocurrency payment API. Written in TypeScript, published as `@heleket-payment/sdk`
with dual ESM + CommonJS output and bundled type definitions. Zero runtime
dependencies (Node standard library only).

### Added

- `HeleketPayment` / `HeleketPayout` clients with fully typed TypeScript
  request/response models.
- Payments API: invoices, info, AML/KYC/SoF links, history, static wallets, QR
  codes, wallet blocking and blocked-wallet refunds, webhook resend, test
  webhooks, and the services catalogue.
- Payouts API: payouts, refunds, info, history, fee calculation, transfers, and
  services.
- Balance and exchange-rate endpoints.
- `HeleketPayout.refund()` → `POST /v1/payment/refund`. This endpoint is signed
  with the **payout** API key, so the method lives on `HeleketPayout` rather than
  `HeleketPayment`.
- `HeleketPayment.getAmlLinks(uuid?, orderId?)` → `POST /v1/payment/aml-links`:
  AML/KYC/SoF questionnaire links for a blocked (`locked`) payment, plus the
  `AmlLinkStatus` enum with `isAmlLinkStatusFinal()` / `isAmlLinkStatusSuccessful()`
  helpers.
- Signed webhook verification (`WebhookVerifier`, `WebhookPayload`) with
  byte-fidelity raw-body hashing and constant-time signature comparison.
- Swappable HTTP transport (`Transport` interface, default `FetchTransport`,
  plus a `FakeTransport` for offline tests).
- Typed error hierarchy (`HeleketError` → `ApiError`, `ValidationError`,
  `HttpError`, `SignatureError`).
- Status enums (`PaymentStatus`, `PayoutStatus`, `AmlLinkStatus`) with
  `is*Final` / `is*Successful` helpers, each tolerant of unknown wire values.
- Debug mode via a pluggable `DebugSink` that never emits API keys or the `sign`
  header.
- `heleket-webhook-inspect` CLI, runnable examples for every endpoint, full
  module documentation under `docs/`, and a Docker harness.

### Notes

- The exchange-rate endpoint (`getExchangeRates`) is issued as a `GET` request
  (the only GET in the SDK); every other endpoint is a `POST`, even reads.
- Refunds are deliberately exposed on `HeleketPayout`, not `HeleketPayment` — see
  [`UPGRADING.md`](UPGRADING.md) and [`docs/05-payouts.md`](docs/05-payouts.md).
