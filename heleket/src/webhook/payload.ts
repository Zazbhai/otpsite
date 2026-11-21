import {
  PaymentStatus,
  PayoutStatus,
  isPaymentStatusFinal,
  isPaymentStatusSuccessful,
  isPayoutStatusFinal,
  isPayoutStatusSuccessful,
} from '../status.js';

/**
 * A verified webhook event. Constructed by WebhookVerifier — never directly.
 *
 * The raw decoded JSON (including the original `sign` field) is preserved on
 * the `raw` property so callers can read fields not yet known to the SDK.
 *
 * **Money fields (`amount`, `paymentAmount`, `merchantAmount`, `commission`)
 * are decimal strings.** Heleket sends them as strings to preserve precision.
 * `Number(payload.amount)` is safe for display but loses precision for
 * arithmetic — accumulate with a decimal library (`big.js`, `decimal.js`)
 * or `BigInt` after scaling, never with the JS `+` operator.
 */
export class WebhookPayload {
  readonly raw: Record<string, unknown>;
  readonly type: string;
  readonly uuid: string;
  readonly orderId: string;
  /** Decimal string. See class-level note before doing arithmetic. */
  readonly amount: string;
  /** Decimal string. See class-level note before doing arithmetic. */
  readonly paymentAmount: string;
  /** Decimal string. See class-level note before doing arithmetic. */
  readonly merchantAmount: string;
  /** Decimal string. See class-level note before doing arithmetic. */
  readonly commission: string;
  readonly status: string;
  readonly txid: string;
  readonly network: string;
  readonly currency: string;
  readonly payerCurrency: string;
  readonly from: string;
  readonly sign: string;
  readonly isFinalField: boolean;

  constructor(raw: Record<string, unknown>, sign: string) {
    this.raw = raw;
    this.sign = sign;
    this.type = strField(raw.type);
    this.uuid = strField(raw.uuid);
    this.orderId = strField(raw.order_id);
    this.amount = strField(raw.amount);
    this.paymentAmount = strField(raw.payment_amount);
    this.merchantAmount = strField(raw.merchant_amount);
    this.commission = strField(raw.commission);
    this.status = strField(raw.status);
    this.txid = strField(raw.txid);
    this.network = strField(raw.network);
    this.currency = strField(raw.currency);
    this.payerCurrency = strField(raw.payer_currency);
    this.from = strField(raw.from);
    this.isFinalField = raw.is_final === true;
  }

  isPayment(): boolean {
    return this.type === 'payment' || this.type === 'wallet';
  }

  isPayout(): boolean {
    return this.type === 'payout';
  }

  /**
   * Reports whether the event will not transition further.
   *
   * Returns `true` if **either** the server set `is_final: true` **or** the
   * status enum is terminal. The status check runs even when the server sent
   * `is_final: false` — this guards against server-side bugs where a
   * terminal status (`paid`, `fail`, `cancel`…) is delivered without the
   * matching `is_final` flag. Returns `false` for unknown statuses.
   */
  isFinal(): boolean {
    if (this.isFinalField) return true;
    return this.isPayout() ? isPayoutStatusFinal(this.status) : isPaymentStatusFinal(this.status);
  }

  /** Reports whether the event represents a successful payment or payout. */
  isSuccessful(): boolean {
    return this.isPayout()
      ? isPayoutStatusSuccessful(this.status)
      : isPaymentStatusSuccessful(this.status);
  }
}

// Re-export status helpers for convenience in webhook code.
export { PaymentStatus, PayoutStatus };

function strField(value: unknown): string {
  if (value === null || value === undefined) return '';
  return String(value);
}
