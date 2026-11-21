# 04 — Payments API

Every method on `HeleketPayment`. All examples assume:

```ts
import { HeleketPayment } from '@heleket-payment/sdk';
const client = new HeleketPayment(merchantId, paymentKey);
```

Errors:

- `ValidationError` on HTTP 422 (call `instanceof ValidationError` and read `.fields`)
- `ApiError` on any other API failure (`.httpStatus`, `.rawBody`)
- `HttpError` on transport failure (wraps `.cause`)

See [09 — Error handling](09-error-handling.md).

## createInvoice

`createInvoice(req: CreateInvoiceRequest, options?: RequestOptions): Promise<Invoice>` → `POST /v1/payment`

Required: `amount`, `currency`, `order_id`. See [`payment-types.ts`](../src/payment-types.ts) for every optional field.

```ts
const invoice = await client.createInvoice({
  amount: '15.00',
  currency: 'USD',
  order_id: 'order-42',
  lifetime: 3600,
  url_callback: 'https://your.site/heleket-webhook',
});

console.log(invoice.url); // payment page
console.log(invoice.address); // wallet address (for payer)
console.log(invoice.payment_status); // initial status (typically "check")
```

## getInfo

`getInfo(opts: InfoOptions): Promise<Invoice>` → `POST /v1/payment/info`

Set exactly one of `uuid` or `order_id`.

```ts
const info = await client.getInfo({ uuid: invoiceUuid });
// or
const info = await client.getInfo({ order_id: 'order-42' });
```

## listHistory

`listHistory(opts?: HistoryOptions): Promise<HistoryPage<Invoice>>` → `POST /v1/payment/list`

Date format: `YYYY-MM-DD HH:MM:SS`. Pagination cursors come from a previous response's `paginate.nextCursor`.

```ts
const page = await client.listHistory({
  date_from: '2026-01-01 00:00:00',
  date_to: '2026-05-20 23:59:59',
});

for (const invoice of page.items) {
  /* ... */
}

if (page.paginate.nextCursor) {
  const next = await client.listHistory({ cursor: page.paginate.nextCursor });
}
```

## createStaticWallet

`createStaticWallet(req: CreateStaticWalletRequest): Promise<StaticWallet>` → `POST /v1/wallet`

Persistent address bound to an order ID — incoming transfers are credited to the merchant.

```ts
const wallet = await client.createStaticWallet({
  currency: 'USDT',
  network: 'tron',
  order_id: 'topup-user-7',
});
```

## generateQrCode

`generateQrCode(merchantPaymentUuid: string): Promise<QrCode>` → `POST /v1/wallet/qr`

Returns a base64 QR-code image for the given static wallet.

```ts
const qr = await client.generateQrCode(wallet.uuid);
// embed in HTML: <img src={qr.image}>
```

## blockStaticWallet

`blockStaticWallet(req: BlockStaticWalletRequest): Promise<BlockedWallet>` → `POST /v1/wallet/block-address`

```ts
await client.blockStaticWallet({ order_id: 'topup-user-7', is_refund: false });
```

## refundBlockedWallet

`refundBlockedWallet(uuid: string, address: string): Promise<RefundResult>` → `POST /v1/wallet/blocked-address-refund`

```ts
await client.refundBlockedWallet(wallet.uuid, 'TXyz...recovery-address...');
```

## getAmlLinks

`getAmlLinks(uuid?: string, orderId?: string): Promise<AmlLink[]>` → `POST /v1/payment/aml-links`

AML/KYC/SoF questionnaire links for a blocked (`locked`) payment. Pass one of `uuid` / `orderId`. Hand each `link` to the end user to complete the questionnaire and unblock the payment; compare `status` against `AmlLinkStatus`.

```ts
const links = await client.getAmlLinks(invoiceUuid);
for (const l of links) {
  console.log(l.status, l.link); // e.g. "pending" https://aml.heleket.com/...
}
```

## refund — moved to `HeleketPayout`

Refunds (`POST /v1/payment/refund`) are signed with the **payout** API key, so the method lives on [`HeleketPayout.refund`](05-payouts.md#refund), **not** `HeleketPayment`. (Don't confuse it with `refundBlockedWallet` above — that's a separate wallet endpoint that stays here.)

## resendWebhook

`resendWebhook(opts: InfoOptions): Promise<void>` → `POST /v1/payment/resend`

```ts
await client.resendWebhook({ order_id: 'order-42' });
```

## testWebhook

`testWebhook(req: TestWebhookRequest): Promise<void>` → `POST /v1/test-webhook/{payment|wallet}`

```ts
await client.testWebhook({
  type: 'payment',
  url_callback: 'https://your.site/heleket-webhook',
  currency: 'USD',
  network: 'tron',
  status: 'paid',
  order_id: 'order-42',
});
```

## listServices

`listServices(): Promise<Service[]>` → `POST /v1/payment/services`

```ts
const services = await client.listServices();
for (const s of services) {
  console.log(`${s.currency} on ${s.network}`);
}
```

## getBalance

`getBalance(): Promise<Balance>` → `POST /v1/balance`

```ts
const balance = await client.getBalance();
for (const row of balance.merchant) {
  console.log(`${row.currency_code}: ${row.balance}`);
}
```

## getExchangeRates

`getExchangeRates(currency: string): Promise<ExchangeRate[]>` → `GET /v1/exchange-rate/{currency}/list`

This is the **only** `GET` endpoint in the SDK — it's read-only and carries its input in the path, so the signed body is empty (`sign = md5(apiKey)`). Every other endpoint is a `POST`.

```ts
const rates = await client.getExchangeRates('USD');
for (const r of rates) {
  console.log(`${r.from} → ${r.to} = ${r.course} (${r.source})`);
}
```

## Next

→ [05 — Payouts API](05-payouts.md)
