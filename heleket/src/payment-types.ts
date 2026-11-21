import type { AmlLinkStatus, CourseSource, PaymentStatus } from './status.js';

/** Request body for POST /v1/payment. See docs for the full optional set. */
export interface CreateInvoiceRequest {
  /** Required. */
  amount: string;
  /** Required. */
  currency: string;
  /** Required. Unique within your merchant invoices. */
  order_id: string;

  /** Optional fields. */
  network?: string;
  url_return?: string;
  url_success?: string;
  url_callback?: string;
  is_payment_multiple?: boolean;
  lifetime?: number;
  to_currency?: string;
  subtract?: number;
  accuracy_payment_percent?: string;
  additional_data?: string;
  currencies?: CurrencyNetwork[];
  except_currencies?: CurrencyNetwork[];
  course_source?: CourseSource;
  from_referral_code?: string;
  discount_percent?: number;
  is_refresh?: boolean;
  payer_email?: string;
}

export interface CurrencyNetwork {
  currency: string;
  network?: string;
}

/** Response of POST /v1/payment and POST /v1/payment/info. */
export interface Invoice {
  uuid: string;
  order_id: string;
  amount: string;
  payment_amount?: string | null;
  payment_amount_usd?: string | null;
  payer_amount?: string;
  payer_currency?: string;
  currency: string;
  merchant_amount?: string | null;
  network?: string;
  address?: string;
  from?: string | null;
  txid?: string | null;
  payment_status?: PaymentStatus | string;
  status?: PaymentStatus | string;
  url?: string;
  expired_at?: number;
  is_final: boolean;
  additional_data?: string | null;
  created_at?: string;
  updated_at?: string;
  commission?: string;
  address_qr_code?: string;
  discount_percent?: number;
  discount?: string;
  convert?: Conversion;
}

export interface Conversion {
  to_currency: string;
  commission: string;
  rate: string;
  amount: string;
}

/**
 * Identifier for the "uuid OR order_id" endpoints. Set exactly one — the SDK
 * rejects empty input client-side and the server prioritises order_id when
 * both are passed.
 */
export interface InfoOptions {
  uuid?: string;
  order_id?: string;
}

/** Filter for the paginated history endpoints. Date format: "YYYY-MM-DD HH:MM:SS". */
export interface HistoryOptions {
  date_from?: string;
  date_to?: string;
  cursor?: string;
}

/** Paginated response shape for /v1/payment/list and /v1/payout/list. */
export interface HistoryPage<T> {
  items: T[];
  paginate: Pagination;
}

export interface Pagination {
  count: number;
  hasPages: boolean;
  nextCursor?: string;
  previousCursor?: string;
  perPage: number;
}

export interface CreateStaticWalletRequest {
  currency: string;
  network: string;
  order_id: string;
  url_callback?: string;
}

export interface StaticWallet {
  uuid: string;
  wallet_uuid?: string;
  order_id: string;
  address: string;
  network: string;
  currency: string;
  url?: string;
}

export interface QrCode {
  image: string;
}

export interface BlockStaticWalletRequest {
  uuid?: string;
  order_id?: string;
  is_refund?: boolean;
}

export interface BlockedWallet {
  uuid: string;
  status: string;
  order_id?: string;
}

export interface RefundRequest {
  uuid?: string;
  order_id?: string;
  address: string;
  is_subtract: boolean;
}

export interface RefundResult {
  commission?: string;
  amount?: string;
  currency?: string;
  txid?: string | null;
  network?: string;
  address?: string;
  status?: string;
}

/**
 * One AML/KYC/SoF questionnaire link, returned per item by
 * {@link HeleketPayment.getAmlLinks} for a blocked (`locked`) payment. Hand
 * `link` to the end user to complete the questionnaire and unblock the payment.
 */
export interface AmlLink {
  link?: string;
  expired_at?: string;
  status?: AmlLinkStatus | string;
}

/** "type" must be "payment" or "wallet". */
export interface TestWebhookRequest {
  type: 'payment' | 'wallet';
  url_callback: string;
  currency: string;
  network: string;
  status: PaymentStatus | string;
  uuid?: string;
  order_id?: string;
}

export interface Service {
  network: string;
  currency: string;
  is_available: boolean;
  limit?: ServiceLimit;
  commission?: ServiceCommission;
}

export interface ServiceLimit {
  min_amount?: string;
  max_amount?: string;
}

export interface ServiceCommission {
  fee_amount?: string;
  percent?: string;
}

/** Response of POST /v1/balance. Heleket wraps this in a one-element array. */
export interface Balance {
  merchant: WalletBalance[];
  user: WalletBalance[];
}

export interface WalletBalance {
  uuid?: string;
  balance: string;
  currency_code: string;
}

export interface ExchangeRate {
  from: string;
  to: string;
  course: string;
  source?: string;
}
