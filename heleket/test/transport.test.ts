import { createServer, type Server } from 'node:http';
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';

import { HeleketPayment } from '../src/payment.js';

describe('FetchTransport (real http loopback)', () => {
  let server: Server;
  let baseUrl: string;
  let captured: { body: string; merchant: string; sign: string } = {
    body: '',
    merchant: '',
    sign: '',
  };

  before(async () => {
    server = createServer((req, res) => {
      const chunks: Buffer[] = [];
      req.on('data', (chunk: Buffer) => chunks.push(chunk));
      req.on('end', () => {
        captured = {
          body: Buffer.concat(chunks).toString('utf8'),
          merchant: String(req.headers['merchant'] ?? ''),
          sign: String(req.headers['sign'] ?? ''),
        };
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ state: 0, result: { uuid: 'u1', order_id: 'order-1' } }));
      });
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const addr = server.address();
    if (addr && typeof addr === 'object') {
      baseUrl = `http://127.0.0.1:${addr.port}`;
    } else {
      throw new Error('failed to bind test server');
    }
  });

  after(async () => {
    await new Promise<void>((resolve, reject) =>
      server.close((err) => (err ? reject(err) : resolve())),
    );
  });

  it('forwards body bytes verbatim and includes signed headers', async () => {
    const client = new HeleketPayment('merchant-id', 'key', { baseUrl });
    await client.createInvoice({ amount: '1', currency: 'USD', order_id: 'order-1' });

    assert.ok(captured.body.includes('"order_id":"order-1"'));
    assert.equal(captured.merchant, 'merchant-id');
    assert.ok(captured.sign.length === 32, 'expected 32-char md5 hex');
  });
});
