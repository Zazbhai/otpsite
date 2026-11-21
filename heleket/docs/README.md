# Heleket Node.js integration — documentation

This documentation set covers everything you need to integrate Heleket from a Node.js application. Written for both TypeScript merchants and pure-JS merchants — the SDK exposes the same JavaScript runtime in both cases, with `.d.ts` files providing types where they're wanted.

## How to read this

Start with **Installation** and **Configuration**, then either jump into **Payments** (most common starting point) or read **Architecture** first if you prefer top-down explanation. **Webhooks** is the most security-sensitive chapter — read it before going to production.

## Table of contents

| Chapter                                       | When to read                                      |
| --------------------------------------------- | ------------------------------------------------- |
| [01 — Installation](01-installation.md)       | Once, when setting up                             |
| [02 — Configuration](02-configuration.md)     | Once, plus when tuning timeouts/debug/transport   |
| [03 — Architecture](03-architecture.md)       | When you want to know how the SDK is put together |
| [04 — Payments API](04-payments.md)           | Reference for every payment endpoint              |
| [05 — Payouts API](05-payouts.md)             | Reference for every payout endpoint               |
| [06 — Webhooks](06-webhooks.md)               | **Read before production**                        |
| [07 — Debugging](07-debugging.md)             | When something doesn't work                       |
| [08 — Testing](08-testing.md)                 | When you want to write tests against the SDK      |
| [09 — Error handling](09-error-handling.md)   | When designing your error-recovery strategy       |
| [10 — Reference](10-reference.md)             | Lookup table for statuses, currencies, endpoints  |
| [12 — Troubleshooting](12-troubleshooting.md) | When stuck                                        |

## Conventions

- Code blocks marked `ts` are TypeScript. The same code (without type annotations) runs as plain JS — the SDK ships compiled `.js` so you don't need a TS toolchain to use it.
- Endpoint paths are shown relative to the API base URL (`https://api.heleket.com`).
- Square brackets indicate **optional** parameters; everything else is required.

## Upstream documentation

This SDK wraps the official Heleket API documented at <https://doc.heleket.com>. When in doubt about API semantics, the official docs are authoritative.
