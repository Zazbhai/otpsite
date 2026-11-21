/**
 * Payment statuses. See
 * https://doc.heleket.com/methods/payments/payment-statuses for details.
 */
export const PaymentStatus = {
  /** Exact amount received. Final + successful. */
  Paid: 'paid',
  /** Overpayment received. Final + successful. */
  PaidOver: 'paid_over',
  /** Underpaid, no further attempts allowed. Final. */
  WrongAmount: 'wrong_amount',
  /** Payment is being processed. Intermediate. */
  Process: 'process',
  /** Seen on-chain; awaiting confirmations. Intermediate. */
  ConfirmCheck: 'confirm_check',
  /** Underpaid, additional top-ups accepted. Intermediate. */
  WrongAmountWaiting: 'wrong_amount_waiting',
  /** Waiting for the transaction to appear on-chain. Intermediate. */
  Check: 'check',
  /** Payment error. Final. */
  Fail: 'fail',
  /** Invoice abandoned by the client. Final. */
  Cancel: 'cancel',
  /** System-side error. Final. */
  SystemFail: 'system_fail',
  /** Refund in flight. Intermediate. */
  RefundProcess: 'refund_process',
  /** Refund failed. Final. */
  RefundFail: 'refund_fail',
  /** Refund completed. Final. */
  RefundPaid: 'refund_paid',
  /** AML hold. Final. */
  Locked: 'locked',
  /**
   * Sentinel for statuses the SDK doesn't yet know about. The wire value
   * is `'unknown'`; in practice you obtain it via {@link toPaymentStatus}
   * after Heleket ships a new status that this SDK version hasn't been
   * updated to recognise. Treated as non-final, non-successful.
   */
  Unknown: 'unknown',
} as const;

export type PaymentStatus = (typeof PaymentStatus)[keyof typeof PaymentStatus];

const PAYMENT_STATUS_VALUES: Set<string> = new Set(Object.values(PaymentStatus));

/**
 * Normalise a wire-level status string into a {@link PaymentStatus}. Returns
 * {@link PaymentStatus.Unknown} for any value the SDK doesn't recognise,
 * which lets merchant code stay running when Heleket introduces a new
 * status before this SDK is updated.
 */
export function toPaymentStatus(value: string): PaymentStatus {
  return PAYMENT_STATUS_VALUES.has(value) ? (value as PaymentStatus) : PaymentStatus.Unknown;
}

const PAYMENT_FINAL: Set<string> = new Set([
  PaymentStatus.Paid,
  PaymentStatus.PaidOver,
  PaymentStatus.WrongAmount,
  PaymentStatus.Fail,
  PaymentStatus.Cancel,
  PaymentStatus.SystemFail,
  PaymentStatus.RefundFail,
  PaymentStatus.RefundPaid,
  PaymentStatus.Locked,
]);

const PAYMENT_SUCCESSFUL: Set<string> = new Set([PaymentStatus.Paid, PaymentStatus.PaidOver]);

/** Reports whether the payment status is terminal — invoice won't transition further. */
export function isPaymentStatusFinal(status: string): boolean {
  return PAYMENT_FINAL.has(status);
}

/** Reports whether the status represents a successful payment. */
export function isPaymentStatusSuccessful(status: string): boolean {
  return PAYMENT_SUCCESSFUL.has(status);
}

/**
 * Payout statuses. See
 * https://doc.heleket.com/methods/payouts/payout-statuses for details.
 */
export const PayoutStatus = {
  Process: 'process',
  Check: 'check',
  Paid: 'paid',
  Fail: 'fail',
  Cancel: 'cancel',
  SystemFail: 'system_fail',
  /** Sentinel for statuses the SDK doesn't yet know about. See {@link toPayoutStatus}. */
  Unknown: 'unknown',
} as const;

export type PayoutStatus = (typeof PayoutStatus)[keyof typeof PayoutStatus];

const PAYOUT_STATUS_VALUES: Set<string> = new Set(Object.values(PayoutStatus));

/** Normalise a wire-level payout status. Returns {@link PayoutStatus.Unknown} on miss. */
export function toPayoutStatus(value: string): PayoutStatus {
  return PAYOUT_STATUS_VALUES.has(value) ? (value as PayoutStatus) : PayoutStatus.Unknown;
}

const PAYOUT_FINAL: Set<string> = new Set([
  PayoutStatus.Paid,
  PayoutStatus.Fail,
  PayoutStatus.Cancel,
  PayoutStatus.SystemFail,
]);

/** Reports whether the payout status is terminal. */
export function isPayoutStatusFinal(status: string): boolean {
  return PAYOUT_FINAL.has(status);
}

/** Reports whether the payout settled successfully. */
export function isPayoutStatusSuccessful(status: string): boolean {
  return status === PayoutStatus.Paid;
}

/**
 * AML/KYC/SoF questionnaire-link statuses. Returned per item by
 * {@link HeleketPayment.getAmlLinks} for a blocked (`locked`) payment. "Final"
 * statuses are terminal — the link won't transition further; intermediate ones
 * may still change while the user works through the questionnaire.
 */
export const AmlLinkStatus = {
  /** Link created, not yet opened. Intermediate. */
  Init: 'init',
  /** User is working through the questionnaire. Intermediate. */
  Pending: 'pending',
  /** Questionnaire completed. Final + successful. */
  Completed: 'completed',
  /** Link expired before completion. Final. */
  Expired: 'expired',
  /** Sentinel for statuses the SDK doesn't yet know about. See {@link toAmlLinkStatus}. */
  Unknown: 'unknown',
} as const;

export type AmlLinkStatus = (typeof AmlLinkStatus)[keyof typeof AmlLinkStatus];

const AML_LINK_STATUS_VALUES: Set<string> = new Set(Object.values(AmlLinkStatus));

/** Normalise a wire-level AML-link status. Returns {@link AmlLinkStatus.Unknown} on miss. */
export function toAmlLinkStatus(value: string): AmlLinkStatus {
  return AML_LINK_STATUS_VALUES.has(value) ? (value as AmlLinkStatus) : AmlLinkStatus.Unknown;
}

const AML_LINK_FINAL: Set<string> = new Set([AmlLinkStatus.Completed, AmlLinkStatus.Expired]);

/** Reports whether the AML link is terminal — it won't transition further. */
export function isAmlLinkStatusFinal(status: string): boolean {
  return AML_LINK_FINAL.has(status);
}

/** Reports whether the questionnaire was completed. */
export function isAmlLinkStatusSuccessful(status: string): boolean {
  return status === AmlLinkStatus.Completed;
}

/**
 * Exchange-rate sources accepted by create-invoice and create-payout. See
 * https://doc.heleket.com/methods/payments/creating-invoice (course_source).
 */
export const CourseSource = {
  Binance: 'Binance',
  BinanceP2P: 'BinanceP2P',
  Exmo: 'Exmo',
  Kucoin: 'Kucoin',
} as const;

export type CourseSource = (typeof CourseSource)[keyof typeof CourseSource];
