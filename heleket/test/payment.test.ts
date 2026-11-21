import { createHash } from 'node:crypto';
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { ApiError, HeleketPayment, HttpError, ValidationError } from '../src/index.js';
import { FakeTransport } from './fakes/fake-transport.js';

const MERCHANT_ID = '8b03432e-385b-4670-8d06-064591096795';
const API_KEY = 'payment-key-abc';

function newClient(fake: FakeTransport): HeleketPayment {
  return new HeleketPayment(MERCHANT_ID, API_KEY, { transport: fake });
}

describe('PaymentClient', () => {
  it('createInvoice sends signed JSON POST', async () => {
    const fake = new FakeTransport().enqueueJson({
      state: 0,
      result: { uuid: 'uuid-1', order_id: 'order-1' },
    });
    const client = newClient(fake);

    const invoice = await client.createInvoice({
      amount: '15',
      currency: 'USD',
      order_id: 'order-1',
    });
    assert.equal(invoice.uuid, 'uuid-1');

    const req = fake.lastRequest();
    assert.equal(req.method, 'POST');
    assert.equal(req.url, 'https://api.heleket.com/v1/payment');
    assert.equal(req.headers['merchant'], MERCHANT_ID);
    assert.equal(req.headers['Content-Type'], 'application/json');
    // SDK tags itself so Heleket support can attribute traffic without
    // sniffing for Node's default undici UA.
    assert.match(req.headers['User-Agent'] ?? '', /^heleket-node-sdk\//);

    const expectedBody = JSON.stringify({ amount: '15', currency: 'USD', order_id: 'order-1' });
    assert.equal(req.body, expectedBody);

    const expectedSign = createHash('md5')
      .update(Buffer.from(expectedBody).toString('base64') + API_KEY)
      .digest('hex');
    assert.equal(req.headers['sign'], expectedSign);
  });

  it('empty params signs the empty string', async () => {
    const fake = new FakeTransport().enqueueJson({
      state: 0,
      result: [{ balance: { merchant: [], user: [] } }],
    });
    const client = newClient(fake);

    await client.getBalance();

    const req = fake.lastRequest();
    assert.equal(req.body, '');
    const expected = createHash('md5').update(API_KEY).digest('hex');
    assert.equal(req.headers['sign'], expected);
  });

  it('validation error becomes ValidationError', async () => {
    const fake = new FakeTransport().enqueueJson(
      {
        state: 1,
        errors: { amount: ['validation.required'] },
      },
      422,
    );
    const client = newClient(fake);

    await assert.rejects(
      () => client.createInvoice({ amount: '', currency: '', order_id: '' }),
      (error: Error) => {
        assert.ok(error instanceof ValidationError, `got ${error.constructor.name}`);
        assert.equal((error as ValidationError).httpStatus, 422);
        assert.deepEqual((error as ValidationError).fields, { amount: ['validation.required'] });
        return true;
      },
    );
  });

  it('api error becomes ApiError', async () => {
    const fake = new FakeTransport().enqueueJson(
      { state: 1, message: 'The network was not found' },
      400,
    );
    const client = newClient(fake);

    await assert.rejects(
      () => client.createInvoice({ amount: '1', currency: 'USD', order_id: 'x' }),
      (error: Error) => {
        assert.ok(error instanceof ApiError);
        assert.equal((error as ApiError).httpStatus, 400);
        assert.match(error.message, /network was not found/);
        return true;
      },
    );
  });

  it('getInfo requires uuid or order_id', async () => {
    const client = newClient(new FakeTransport());
    await assert.rejects(() => client.getInfo({}), /one of uuid or order_id/);
  });

  it('listHistory appends cursor as query string', async () => {
    const fake = new FakeTransport().enqueueJson({
      state: 0,
      result: { items: [], paginate: { count: 0, hasPages: false, perPage: 15 } },
    });
    const client = newClient(fake);

    await client.listHistory({ cursor: 'abc=def' });
    assert.equal(
      fake.lastRequest().url,
      'https://api.heleket.com/v1/payment/list?cursor=abc%3Ddef',
    );
  });

  it('getExchangeRates issues a GET with an empty signed body', async () => {
    const fake = new FakeTransport().enqueueJson({
      state: 0,
      result: [{ from: 'USDT', to: 'USD', course: '1.0' }],
    });
    const client = newClient(fake);

    const rates = await client.getExchangeRates('USD');
    assert.equal(rates.length, 1);
    assert.equal(rates[0]?.from, 'USDT');

    const req = fake.lastRequest();
    assert.equal(req.method, 'GET');
    assert.equal(req.url, 'https://api.heleket.com/v1/exchange-rate/USD/list');
    // No body on a GET — the signed bytes collapse to md5(api_key), and no
    // Content-Type is advertised.
    assert.equal(req.body, '');
    assert.equal(req.headers['Content-Type'], undefined);
    const expectedSign = createHash('md5').update(API_KEY).digest('hex');
    assert.equal(req.headers['sign'], expectedSign);
  });

  it('getAmlLinks posts the identifier and parses the list', async () => {
    const fake = new FakeTransport().enqueueJson({
      state: 0,
      result: [
        { link: 'https://aml.heleket.com/q/abc', expired_at: '1700000000', status: 'pending' },
      ],
    });
    const client = newClient(fake);

    const links = await client.getAmlLinks('uuid-9');
    assert.equal(links.length, 1);
    assert.equal(links[0]?.status, 'pending');

    const req = fake.lastRequest();
    assert.equal(req.method, 'POST');
    assert.equal(req.url, 'https://api.heleket.com/v1/payment/aml-links');
    const body = JSON.parse(req.body);
    assert.equal(body.uuid, 'uuid-9');
    // order_id was undefined, so encodeBody strips it from the wire payload.
    assert.equal(body.order_id, undefined);
  });

  it('getAmlLinks requires uuid or order_id', async () => {
    const client = newClient(new FakeTransport());
    await assert.rejects(() => client.getAmlLinks(), /one of uuid or order_id/);
  });

  it('transport failure surfaces as HttpError', async () => {
    const fake = new FakeTransport().failNext(new Error('simulated network drop'));
    const client = newClient(fake);

    await assert.rejects(
      () => client.createInvoice({ amount: '1', currency: 'USD', order_id: 'x' }),
      (error: Error) => {
        assert.ok(error instanceof HttpError);
        return true;
      },
    );
  });
});
