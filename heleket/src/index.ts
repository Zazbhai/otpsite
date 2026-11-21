// Public API surface of @heleket-payment/sdk.
//
// Use the `webhook` subpath import for webhook-only consumers:
//
//     import { WebhookVerifier } from '@heleket-payment/sdk/webhook';

export { HeleketPayment } from './payment.js';
export { HeleketPayout } from './payout.js';

export type { ClientOptions, ResolvedConfig } from './config.js';

export { DEFAULT_BASE_URL, DEFAULT_TIMEOUT_MS } from './config.js';

export type { DebugEntry, DebugSink } from './debug.js';
export { stderrSink } from './debug.js';

export type { Transport, TransportResponse } from './transport.js';
export { FetchTransport } from './transport.js';

export { sign, signatureEqual } from './signature.js';

export { ApiError, HeleketError, HttpError, SignatureError, ValidationError } from './errors.js';

export {
  AmlLinkStatus,
  CourseSource,
  PaymentStatus,
  PayoutStatus,
  isAmlLinkStatusFinal,
  isAmlLinkStatusSuccessful,
  isPaymentStatusFinal,
  isPaymentStatusSuccessful,
  isPayoutStatusFinal,
  isPayoutStatusSuccessful,
  toAmlLinkStatus,
  toPaymentStatus,
  toPayoutStatus,
} from './status.js';

export type { RequestOptions } from './client.js';

export type {
  AmlLink,
  Balance,
  BlockStaticWalletRequest,
  BlockedWallet,
  Conversion,
  CreateInvoiceRequest,
  CreateStaticWalletRequest,
  CurrencyNetwork,
  ExchangeRate,
  HistoryOptions,
  HistoryPage,
  InfoOptions,
  Invoice,
  Pagination,
  QrCode,
  RefundRequest,
  RefundResult,
  Service,
  ServiceCommission,
  ServiceLimit,
  StaticWallet,
  TestWebhookRequest,
  WalletBalance,
} from './payment-types.js';

export type {
  CalculateRequest,
  Calculation,
  CreatePayoutRequest,
  Payout,
  Transfer,
} from './payout-types.js';

// Re-export the webhook subpackage's public types from the root for convenience
// (consumers can still import from '@heleket-payment/sdk/webhook' for tree-shaking).
export { WebhookPayload, WebhookVerifier } from './webhook/index.js';
