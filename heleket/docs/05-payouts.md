# 05 — Payouts API

Withdrawals from the merchant balance. Uses the **payout API key** — different from the payment key.

```ts
import { HeleketPayout } from '@heleket-payment/sdk';
const client = new HeleketPayout(merchantId, payoutKey);
```

Error model identical to `HeleketPayment` — see [09 — Error handling](09-error-handling.md).

## createPayout

`createPayout(req: CreatePayoutRequest): Promise<Payout>` → `POST /v1/payout`

Required: `amount`, `currency`, `order_id`, `address`, `is_subtract`.

Important fields:

| Field         | Meaning                                                                       |
| ------------- | ----------------------------------------------------------------------------- |
| `is_subtract` | `true` → commission deducted from `amount`; `false` → commission added on top |
| `network`     | Required for multi-network coins (USDT etc.)                                  |
| `priority`    | `economy`, `high`, `highest`, `recommended` — BTC/ETH/POLY/BSC only           |
| `to_currency` | Required if `currency` is fiat                                                |
| `memo`        | Required for TON (1–30 chars)                                                 |

```ts
const payout = await client.createPayout({
  amount: '5.00',
  currency: 'USDT',
  network: 'TRON',
  order_id: 'payout-001',
  address: 'TDD97yguPESTpcrJMqU6h2ozZbibv4Vaqm',
  is_subtract: true,
  priority: 'recommended',
  url_callback: 'https://your.site/heleket-payout-webhook',
});

console.log(payout.uuid);
console.log(payout.status); // typically "process" initially
console.log(payout.balance); // remaining balance after deduction
```

## refund

`refund(req: RefundRequest): Promise<RefundResult>` → `POST /v1/payment/refund`

Refund a paid invoice in full or in part. Although the path is in the payment domain, the Heleket API signs `/v1/payment/refund` with the **payout** API key — that's why `refund` lives on `HeleketPayout` and not `HeleketPayment`.

Required: `address`, `is_subtract`; one of `uuid` / `order_id`.

```ts
await client.refund({
  uuid: invoiceUuid,
  address: 'TBaCkAdDrEsS',
  is_subtract: true,
});
```

## getInfo

`getInfo(opts: InfoOptions): Promise<Payout>` → `POST /v1/payout/info`

```ts
const info = await client.getInfo({ uuid: payout.uuid });
```

## listHistory

`listHistory(opts?: HistoryOptions): Promise<HistoryPage<Payout>>` → `POST /v1/payout/list`

```ts
const page = await client.listHistory({ date_from: '2026-01-01 00:00:00' });
for (const p of page.items) {
  /* ... */
}
```

## calculateWithdrawal

`calculateWithdrawal(req: CalculateRequest): Promise<Calculation>` → `POST /v1/payout/calculate`

Preview commission and final amount before committing.

```ts
const preview = await client.calculateWithdrawal({
  currency: 'USDT',
  network: 'TRON',
  amount: '100',
  is_subtract: true,
});
console.log(preview.commission); // e.g. "1.00"
console.log(preview.merchant_amount); // amount debited
```

## listServices

`listServices(): Promise<Service[]>` → `POST /v1/payout/services`

```ts
const services = await client.listServices();
```

## transferToPersonal

`transferToPersonal(amount: string, currency: string): Promise<Transfer>` → `POST /v1/transfer/to-personal`

Move funds from the business balance to the personal wallet (same Heleket account).

```ts
await client.transferToPersonal('10.00', 'USDT');
```

## transferToBusiness

`transferToBusiness(amount: string, currency: string): Promise<Transfer>` → `POST /v1/transfer/to-business`

The reverse transfer.

```ts
await client.transferToBusiness('10.00', 'USDT');
```

## Next

→ [06 — Webhooks](06-webhooks.md) — **read before going to production**.
