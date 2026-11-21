import { BaseClient, paginate, type RequestOptions } from './client.js';
import { type ClientOptions, resolveConfig } from './config.js';
import type {
  HistoryOptions,
  HistoryPage,
  InfoOptions,
  RefundRequest,
  RefundResult,
  Service,
} from './payment-types.js';
import type {
  CalculateRequest,
  Calculation,
  CreatePayoutRequest,
  Payout,
  Transfer,
} from './payout-types.js';

/**
 * Client for the Heleket Payouts API plus balance transfers. Uses the payout
 * API key — distinct from the payment key.
 *
 * ```ts
 * const client = new HeleketPayout(merchantId, payoutKey);
 * const payout = await client.createPayout({
 *   amount: '5', currency: 'USDT', network: 'TRON',
 *   order_id: 'po-1', address: 'TXyz...', is_subtract: true,
 * });
 * ```
 */
export class HeleketPayout extends BaseClient {
  constructor(merchantId: string, apiKey: string, options: ClientOptions = {}) {
    super(resolveConfig(merchantId, apiKey, options));
  }

  /** Create a withdrawal. */
  async createPayout(req: CreatePayoutRequest, options?: RequestOptions): Promise<Payout> {
    return this.post('/v1/payout', req, options);
  }

  /**
   * Refund a paid invoice in full or in part.
   *
   * Hits `POST /v1/payment/refund` but is signed with the **payout** API key,
   * so it lives on {@link HeleketPayout} rather than {@link HeleketPayment}.
   * Required: `address`, `is_subtract`; one of `uuid` / `order_id`.
   */
  async refund(req: RefundRequest, options?: RequestOptions): Promise<RefundResult> {
    if (!req.uuid && !req.order_id) {
      throw new Error('heleket: one of uuid or order_id must be set');
    }
    return this.post('/v1/payment/refund', req, options);
  }

  /** Look up a payout by UUID or order_id. */
  async getInfo(opts: InfoOptions, options?: RequestOptions): Promise<Payout> {
    if (!opts.uuid && !opts.order_id) {
      throw new Error('heleket: one of uuid or order_id must be set');
    }
    return this.post('/v1/payout/info', opts, options);
  }

  /** Paginated payout history. */
  async listHistory(
    opts: HistoryOptions = {},
    options?: RequestOptions,
  ): Promise<HistoryPage<Payout>> {
    const path = opts.cursor
      ? `/v1/payout/list?cursor=${encodeURIComponent(opts.cursor)}`
      : '/v1/payout/list';
    return this.post(path, { date_from: opts.date_from, date_to: opts.date_to }, options);
  }

  /**
   * Async iterator over every payout in the merchant's history. See
   * {@link HeleketPayment.iterateHistory} for the pattern.
   */
  iterateHistory(
    opts: Omit<HistoryOptions, 'cursor'> = {},
    options?: RequestOptions,
  ): AsyncIterableIterator<Payout> {
    return paginate<Payout>((cursor) => this.listHistory({ ...opts, cursor }, options));
  }

  /** Preview the commission and final amount for a hypothetical payout. */
  async calculateWithdrawal(req: CalculateRequest, options?: RequestOptions): Promise<Calculation> {
    return this.post('/v1/payout/calculate', req, options);
  }

  /** Catalogue of supported (currency, network) pairs for payouts. */
  async listServices(options?: RequestOptions): Promise<Service[]> {
    return this.post('/v1/payout/services', null, options);
  }

  /** Move funds from the business balance to the personal wallet. */
  async transferToPersonal(
    amount: string,
    currency: string,
    options?: RequestOptions,
  ): Promise<Transfer> {
    return this.post('/v1/transfer/to-personal', { amount, currency }, options);
  }

  /** Move funds from the personal balance to the business balance. */
  async transferToBusiness(
    amount: string,
    currency: string,
    options?: RequestOptions,
  ): Promise<Transfer> {
    return this.post('/v1/transfer/to-business', { amount, currency }, options);
  }
}
