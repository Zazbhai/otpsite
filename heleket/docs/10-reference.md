# 10 — Reference

Quick lookup tables.

## Payment statuses (`PaymentStatus`)

| Constant                           | Wire value             | Final? | Successful? |
| ---------------------------------- | ---------------------- | ------ | ----------- |
| `PaymentStatus.Paid`               | `paid`                 | ✓      | ✓           |
| `PaymentStatus.PaidOver`           | `paid_over`            | ✓      | ✓           |
| `PaymentStatus.WrongAmount`        | `wrong_amount`         | ✓      | —           |
| `PaymentStatus.WrongAmountWaiting` | `wrong_amount_waiting` | —      | —           |
| `PaymentStatus.Check`              | `check`                | —      | —           |
| `PaymentStatus.ConfirmCheck`       | `confirm_check`        | —      | —           |
| `PaymentStatus.Process`            | `process`              | —      | —           |
| `PaymentStatus.Fail`               | `fail`                 | ✓      | —           |
| `PaymentStatus.Cancel`             | `cancel`               | ✓      | —           |
| `PaymentStatus.SystemFail`         | `system_fail`          | ✓      | —           |
| `PaymentStatus.Locked`             | `locked`               | ✓      | —           |
| `PaymentStatus.RefundProcess`      | `refund_process`       | —      | —           |
| `PaymentStatus.RefundPaid`         | `refund_paid`          | ✓      | —           |
| `PaymentStatus.RefundFail`         | `refund_fail`          | ✓      | —           |

Helpers:

```ts
import { isPaymentStatusFinal, isPaymentStatusSuccessful } from '@heleket-payment/sdk';

isPaymentStatusFinal('paid'); // true
isPaymentStatusSuccessful('paid'); // true
```

## Payout statuses (`PayoutStatus`)

| Constant                  | Wire value    | Final? | Successful? |
| ------------------------- | ------------- | ------ | ----------- |
| `PayoutStatus.Process`    | `process`     | —      | —           |
| `PayoutStatus.Check`      | `check`       | —      | —           |
| `PayoutStatus.Paid`       | `paid`        | ✓      | ✓           |
| `PayoutStatus.Fail`       | `fail`        | ✓      | —           |
| `PayoutStatus.Cancel`     | `cancel`      | ✓      | —           |
| `PayoutStatus.SystemFail` | `system_fail` | ✓      | —           |

## AML-link statuses (`AmlLinkStatus`)

Returned per item by `getAmlLinks` for a blocked (`locked`) payment.

| Constant                  | Wire value  | Final? | Successful? |
| ------------------------- | ----------- | ------ | ----------- |
| `AmlLinkStatus.Init`      | `init`      | —      | —           |
| `AmlLinkStatus.Pending`   | `pending`   | —      | —           |
| `AmlLinkStatus.Completed` | `completed` | ✓      | ✓           |
| `AmlLinkStatus.Expired`   | `expired`   | ✓      | —           |

Helpers: `toAmlLinkStatus`, `isAmlLinkStatusFinal`, `isAmlLinkStatusSuccessful`.

## Exchange-rate sources (`CourseSource`)

- `CourseSource.Binance` (`"Binance"`)
- `CourseSource.BinanceP2P` (`"BinanceP2P"`)
- `CourseSource.Exmo` (`"Exmo"`)
- `CourseSource.Kucoin` (`"Kucoin"`)

## Endpoint table

| Method                   | Path                                      | Surface        |
| ------------------------ | ----------------------------------------- | -------------- |
| `createInvoice`          | `POST /v1/payment`                        | HeleketPayment |
| `getInfo` (payment)      | `POST /v1/payment/info`                   | HeleketPayment |
| `getAmlLinks`            | `POST /v1/payment/aml-links`              | HeleketPayment |
| `listHistory` (payment)  | `POST /v1/payment/list`                   | HeleketPayment |
| `refund`                 | `POST /v1/payment/refund`                 | HeleketPayout  |
| `resendWebhook`          | `POST /v1/payment/resend`                 | HeleketPayment |
| `listServices` (payment) | `POST /v1/payment/services`               | HeleketPayment |
| `createStaticWallet`     | `POST /v1/wallet`                         | HeleketPayment |
| `generateQrCode`         | `POST /v1/wallet/qr`                      | HeleketPayment |
| `blockStaticWallet`      | `POST /v1/wallet/block-address`           | HeleketPayment |
| `refundBlockedWallet`    | `POST /v1/wallet/blocked-address-refund`  | HeleketPayment |
| `testWebhook`            | `POST /v1/test-webhook/{payment\|wallet}` | HeleketPayment |
| `getBalance`             | `POST /v1/balance`                        | HeleketPayment |
| `getExchangeRates`       | `GET /v1/exchange-rate/{currency}/list`   | HeleketPayment |
| `createPayout`           | `POST /v1/payout`                         | HeleketPayout  |
| `getInfo` (payout)       | `POST /v1/payout/info`                    | HeleketPayout  |
| `listHistory` (payout)   | `POST /v1/payout/list`                    | HeleketPayout  |
| `calculateWithdrawal`    | `POST /v1/payout/calculate`               | HeleketPayout  |
| `listServices` (payout)  | `POST /v1/payout/services`                | HeleketPayout  |
| `transferToPersonal`     | `POST /v1/transfer/to-personal`           | HeleketPayout  |
| `transferToBusiness`     | `POST /v1/transfer/to-business`           | HeleketPayout  |

## Currency and network codes

Heleket's catalogue evolves. Always source the authoritative list from `listServices` at runtime rather than hard-coding values. Examples at time of writing:

- Currencies: `BTC`, `ETH`, `USDT`, `USDC`, `DAI`, `LTC`, `BCH`, `XRP`, `TRX`, `TON`, `BNB`, `MATIC`, `DOGE`, `SHIB`, `DASH`, `XMR`
- Networks: `bitcoin`, `ethereum`, `tron`, `bsc`, `polygon`, `ton`, `litecoin`, `bch`, `ripple`, `dogecoin`, `dash`, `monero`

## HTTP / signing reminders

- All requests use `POST` except `getExchangeRates`, which is a `GET` (read-only, input in the path).
- All requests include `merchant`, `sign`, `Content-Type: application/json` headers.
- `sign` = `md5(base64(json_body) . apiKey)`. For no-arg endpoints, body and sign are computed over the empty string.
- Webhook `sign` uses the same formula against the corresponding API key.

## Next

→ [12 — Troubleshooting](12-troubleshooting.md).
