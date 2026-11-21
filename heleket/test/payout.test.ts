import { createHash } from 'node:crypto';
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { HeleketPayout } from '../src/index.js';
import { FakeTransport } from './fakes/fake-transport.js';

const MERCHANT_ID = 'fffefe1a-2111-4dd8-9bcc-000000000000';
const API_KEY = 'payout-key-xyz';

function newClient(fake: FakeTransport): HeleketPayout {
  return new HeleketPayout(MERCHANT_ID, API_KEY, { transport: fake });
}

describe('PayoutClient', () => {
  it('createPayout sends expected request', async () => {
    const fake = new FakeTransport().enqueueJson({
      state: 0,
      result: { uuid: 'po-1', status: 'process', is_final: false, amount: '5', currency: 'USDT' },
    });
    const client = newClient(fake);

    const payout = await client.createPayout({
      amount: '5',
      currency: 'USDT',
      network: 'TRON',
      order_id: 'po-1',
      address: 'TDD97yguPESTpcrJMqU6h2ozZbibv4Vaqm',
      is_subtract: true,
    });
    assert.equal(payout.uuid, 'po-1');
    assert.equal(fake.lastRequest().url, 'https://api.heleket.com/v1/payout');
  });

  it('refund hits /v1/payment/refund signed with the payout key', async () => {
    const fake = new FakeTransport().enqueueJson({
      state: 0,
      result: { amount: '5', address: 'TRefundAddr', status: 'refund_process' },
    });
    const client = newClient(fake);

    const result = await client.refund({
      uuid: 'inv-1',
      address: 'TRefundAddr',
      is_subtract: true,
    });
    assert.equal(result.amount, '5');

    const req = fake.lastRequest();
    assert.equal(req.method, 'POST');
    // Payment-domain path, but signed with the payout key — that's why refund
    // lives on HeleketPayout.
    assert.equal(req.url, 'https://api.heleket.com/v1/payment/refund');
    const expectedBody = JSON.stringify({
      uuid: 'inv-1',
      address: 'TRefundAddr',
      is_subtract: true,
    });
    assert.equal(req.body, expectedBody);
    const expectedSign = createHash('md5')
      .update(Buffer.from(expectedBody).toString('base64') + API_KEY)
      .digest('hex');
    assert.equal(req.headers['sign'], expectedSign);
  });

  it('refund requires uuid or order_id', async () => {
    const client = newClient(new FakeTransport());
    await assert.rejects(
      () => client.refund({ address: 'TRefundAddr', is_subtract: true }),
      /one of uuid or order_id/,
    );
  });

  it('calculateWithdrawal serializes boolean fields', async () => {
    const fake = new FakeTransport().enqueueJson({
      state: 0,
      result: { commission: '0.5' },
    });
    const client = newClient(fake);

    await client.calculateWithdrawal({
      currency: 'USDT',
      network: 'TRON',
      amount: '10',
      is_subtract: true,
    });

    const body = JSON.parse(fake.lastRequest().body);
    assert.equal(body.currency, 'USDT');
    assert.equal(body.amount, '10');
    assert.equal(body.is_subtract, true);
  });

  it('transferToPersonal and transferToBusiness hit the expected paths', async () => {
    const fake = new FakeTransport()
      .enqueueJson({ state: 0, result: { amount: '1.5' } })
      .enqueueJson({ state: 0, result: { amount: '1.5' } });
    const client = newClient(fake);

    await client.transferToPersonal('1.5', 'USDT');
    await client.transferToBusiness('1.5', 'USDT');

    assert.equal(fake.requests[0]!.url, 'https://api.heleket.com/v1/transfer/to-personal');
    assert.equal(fake.requests[1]!.url, 'https://api.heleket.com/v1/transfer/to-business');
  });
});
