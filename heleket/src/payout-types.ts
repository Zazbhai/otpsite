import type { PayoutStatus } from './status.js';

/** Request body for POST /v1/payout. */
export interface CreatePayoutRequest {
  /** Required. */
  amount: string;
  currency: string;
  order_id: string;
  address: string;
  is_subtract: boolean;

  /** Optional. */
  network?: string;
  url_callback?: string;
  to_currency?: string;
  course_source?: string;
  from_currency?: string;
  priority?: string;
  memo?: string;
}

/** Response of POST /v1/payout and POST /v1/payout/info. */
export interface Payout {
  uuid: string;
  amount: string;
  currency: string;
  commission?: string;
  merchant_amount?: string;
  network?: string;
  address?: string;
  txid?: string | null;
  status: PayoutStatus | string;
  is_final: boolean;
  balance?: number | string;
  payer_currency?: string;
  payer_amount?: number | string;
  order_id?: string;
  created_at?: string;
  updated_at?: string;
}

export interface CalculateRequest {
  currency: string;
  network: string;
  amount: string;
  is_subtract?: boolean;
}

export interface Calculation {
  commission: string;
  merchant_amount?: string;
  amount?: string;
  network?: string;
  currency?: string;
}

export interface Transfer {
  user_wallet_uuid?: string;
  merchant_wallet_uuid?: string;
  amount?: string;
  currency?: string;
}
