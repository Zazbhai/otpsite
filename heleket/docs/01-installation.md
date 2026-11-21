# 01 — Installation

## Requirements

| Component             | Minimum version | Notes                                                                               |
| --------------------- | --------------- | ----------------------------------------------------------------------------------- |
| Node.js               | 20 LTS          | Built-in `fetch`, `node:test`, `log/slog`-style sinks                               |
| TypeScript (optional) | 5.4             | Only needed if your project compiles TS — the published package already ships `.js` |

The SDK has **no runtime third-party dependencies**.

## Install

```bash
npm install @heleket-payment/sdk
```

ESM is the only published module format:

```ts
import { HeleketPayment, HeleketPayout } from '@heleket-payment/sdk';

// For webhook-only consumers (tree-shakes the rest of the SDK):
import { WebhookVerifier } from '@heleket-payment/sdk/webhook';
```

If your project uses CommonJS (`require`), use a top-level `await import()`:

```js
const { HeleketPayment } = await import('@heleket-payment/sdk');
```

## TypeScript or JavaScript — both supported

The SDK is **written** in TypeScript. The published artefact is plain `.js` plus `.d.ts` declarations. So:

- **TypeScript projects** get compile-time safety on every call and full autocomplete.
- **JavaScript projects** get autocomplete and inline parameter docs through the `.d.ts` files (VS Code / WebStorm / Neovim with LSP all pick them up automatically). No TypeScript build step required.

This is the same model used by `stripe`, `openai`, `@aws-sdk/*`.

## Verifying the install

A one-liner that signs an empty body — does not hit the network:

```ts
import { sign } from '@heleket-payment/sdk';
console.log(sign('', 'your-api-key'));
```

If you see a 32-character lowercase hex string, the SDK is wired up correctly.

## Getting API credentials

You need three pieces of information from <https://dash.heleket.com>:

1. **Merchant UUID** — Settings → API. Looks like `8b03432e-385b-4670-8d06-064591096795`.
2. **Payment API key** — Business → Domain → API key. Used for invoices, balance, exchange rates, and **payment webhook verification**.
3. **Payout API key** — Settings → API → Payout. Used for withdrawals and **payout webhook verification**. Generating a new key locks withdrawals for 24h.

Store them outside source control. The SDK never logs them in plaintext.

## Next

→ [02 — Configuration](02-configuration.md)
