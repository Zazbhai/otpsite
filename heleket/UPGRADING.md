# Upgrading

This SDK follows [Semantic Versioning](https://semver.org/). Breaking changes
and the steps to adopt them are documented here, newest first.

## 0.1.0 — initial release

`0.1.0` is the first published version of `@heleket-payment/sdk`, so there is nothing to
migrate from. One convention is worth calling out up front — especially if
you've used a Heleket SDK in another language, where `refund` historically lived
on the payment client:

- **Refunds live on `HeleketPayout`, not `HeleketPayment`.** `POST
/v1/payment/refund` is a payment-domain path, but the Heleket API signs it with
  the **payout** API key. A payment client does not hold that key and cannot
  produce a valid signature, so the SDK exposes refunds on the payout client
  only.

  ```ts
  import { HeleketPayout } from '@heleket-payment/sdk';

  const payout = new HeleketPayout(merchantId, payoutKey);
  await payout.refund({ uuid: invoiceUuid, address: 'TBaCk…', is_subtract: true });
  ```

  `HeleketPayment` does not expose `refund()`. (Note: `refundBlockedWallet()` —
  the `POST /v1/wallet/blocked-address-refund` endpoint — is unrelated and
  remains on `HeleketPayment`.)
