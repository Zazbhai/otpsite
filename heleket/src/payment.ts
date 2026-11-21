import { BaseClient, paginate, type RequestOptions } from './client.js';
import { type ClientOptions, resolveConfig } from './config.js';
import type {
  AmlLink,
  Balance,
  BlockStaticWalletRequest,
  BlockedWallet,
  CreateInvoiceRequest,
  CreateStaticWalletRequest,
  ExchangeRate,
  HistoryOptions,
  HistoryPage,
  InfoOptions,
  Invoice,
  QrCode,
  RefundResult,
  Service,
  StaticWallet,
  TestWebhookRequest,
} from './payment-types.js';

/**
 * Client for the Heleket Payments API plus the balance and exchange-rate
 * endpoints.
 *
 * Construct with the payment API key and merchant UUID. The client is safe
 * for concurrent use across async tasks — it holds immutable config and a
 * fetch-based transport.
 *
 * ```ts
 * const client = new HeleketPayment(merchantId, paymentKey, { debug: true });
 * const invoice = await client.createInvoice({ amount: '15', currency: 'USD', order_id: 'order-42' });
 * ```
 */
export class HeleketPayment extends BaseClient {
  constructor(merchantId: string, apiKey: string, options: ClientOptions = {}) {
    super(resolveConfig(merchantId, apiKey, options));
  }

  /** Create a new invoice. */
  async createInvoice(req: CreateInvoiceRequest, options?: RequestOptions): Promise<Invoice> {
    return this.post('/v1/payment', req, options);
  }

  /** Look up an invoice by UUID or order_id. Set exactly one. */
  async getInfo(opts: InfoOptions, options?: RequestOptions): Promise<Invoice> {
    requireUuidOrOrderId(opts);
    return this.post('/v1/payment/info', opts, options);
  }

  /**
   * AML/KYC/SoF questionnaire links for a blocked (`locked`) payment.
   *
   * Returns the questionnaire links the end user must complete to unblock a
   * held payment. Look up by `uuid` OR `orderId` (the server prioritises
   * `order_id` when both are sent). Each item carries `link` (the URL to hand
   * to the user), `expired_at`, and `status` (an {@link AmlLinkStatus}).
   */
  async getAmlLinks(uuid?: string, orderId?: string, options?: RequestOptions): Promise<AmlLink[]> {
    if (!uuid && !orderId) {
      throw new Error('heleket: one of uuid or order_id must be set');
    }
    const result = await this.post<AmlLink[] | null>(
      '/v1/payment/aml-links',
      { uuid, order_id: orderId },
      options,
    );
    return result ?? [];
  }

  /** Paginated payment history with optional date filters. */
  async listHistory(
    opts: HistoryOptions = {},
    options?: RequestOptions,
  ): Promise<HistoryPage<Invoice>> {
    const path = appendCursor('/v1/payment/list', opts.cursor);
    const body = { date_from: opts.date_from, date_to: opts.date_to };
    return this.post(path, body, options);
  }

  /**
   * Async iterator over every invoice in the merchant's history, walking the
   * cursor for you. Use this when you actually want every record and don't
   * care about per-page bookkeeping.
   *
   * ```ts
   * for await (const invoice of client.iterateHistory({ date_from: '2025-01-01' })) {
   *   await archive(invoice);
   * }
   * ```
   *
   * The iterator stops when Heleket reports no more pages. Pass an
   * `AbortSignal` via `options.signal` to cancel mid-walk.
   */
  iterateHistory(
    opts: Omit<HistoryOptions, 'cursor'> = {},
    options?: RequestOptions,
  ): AsyncIterableIterator<Invoice> {
    return paginate<Invoice>((cursor) => this.listHistory({ ...opts, cursor }, options));
  }

  /** Create a persistent top-up wallet bound to an order_id. */
  async createStaticWallet(
    req: CreateStaticWalletRequest,
    options?: RequestOptions,
  ): Promise<StaticWallet> {
    return this.post('/v1/wallet', req, options);
  }

  /** Generate a base64 QR-code image for an existing static wallet. */
  async generateQrCode(merchantPaymentUuid: string, options?: RequestOptions): Promise<QrCode> {
    return this.post('/v1/wallet/qr', { merchant_payment_uuid: merchantPaymentUuid }, options);
  }

  /** Stop a static wallet from accepting further transfers. */
  async blockStaticWallet(
    req: BlockStaticWalletRequest,
    options?: RequestOptions,
  ): Promise<BlockedWallet> {
    requireUuidOrOrderId(req);
    return this.post('/v1/wallet/block-address', req, options);
  }

  /** Send the contents of a blocked wallet to a recovery address. */
  async refundBlockedWallet(
    uuid: string,
    address: string,
    options?: RequestOptions,
  ): Promise<RefundResult> {
    return this.post('/v1/wallet/blocked-address-refund', { uuid, address }, options);
  }

  /** Ask Heleket to redeliver the last webhook for the invoice. */
  async resendWebhook(opts: InfoOptions, options?: RequestOptions): Promise<void> {
    requireUuidOrOrderId(opts);
    await this.post<void>('/v1/payment/resend', opts, options);
  }

  /** Send a synthetic webhook event to the merchant's callback URL. */
  async testWebhook(req: TestWebhookRequest, options?: RequestOptions): Promise<void> {
    if (req.type !== 'payment' && req.type !== 'wallet') {
      throw new Error('heleket: TestWebhookRequest.type must be "payment" or "wallet"');
    }
    requireUuidOrOrderId(req);
    const { type, ...body } = req;
    await this.post<void>(`/v1/test-webhook/${type}`, body, options);
  }

  /** Catalogue of supported (currency, network) pairs for payments. */
  async listServices(options?: RequestOptions): Promise<Service[]> {
    return this.post('/v1/payment/services', null, options);
  }

  /** Merchant + personal balances by currency. */
  async getBalance(options?: RequestOptions): Promise<Balance> {
    // The API wraps the balance in a one-element array of { balance: {...} }.
    const wrappers = await this.post<Array<{ balance: Balance }>>('/v1/balance', null, options);
    return wrappers[0]?.balance ?? { merchant: [], user: [] };
  }

  /**
   * Exchange-rate list for a given fiat currency. Read-only endpoint: issued as
   * a GET with the currency in the path (empty signed body).
   */
  async getExchangeRates(currency: string, options?: RequestOptions): Promise<ExchangeRate[]> {
    return this.get(`/v1/exchange-rate/${encodeURIComponent(currency)}/list`, options);
  }
}

function requireUuidOrOrderId(input: { uuid?: string; order_id?: string }): void {
  if (!input.uuid && !input.order_id) {
    throw new Error('heleket: one of uuid or order_id must be set');
  }
}

function appendCursor(path: string, cursor?: string): string {
  if (!cursor) return path;
  return `${path}?cursor=${encodeURIComponent(cursor)}`;
}
