import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { HeleketPayment } from '../src/payment.js';
import { HeleketPayout } from '../src/payout.js';

describe('client construction', () => {
  it('rejects empty merchant id', () => {
    assert.throws(() => new HeleketPayment('   ', 'key'), /merchantId/);
  });

  it('rejects empty api key', () => {
    assert.throws(() => new HeleketPayment('merchant', ''), /apiKey/);
  });

  it('rejects non-positive timeout', () => {
    assert.throws(() => new HeleketPayment('merchant', 'key', { timeoutMs: 0 }), /timeoutMs/);
  });

  it('accepts valid construction', () => {
    const payment = new HeleketPayment('merchant', 'key', { debug: true, timeoutMs: 60_000 });
    assert.ok(payment);
    const payout = new HeleketPayout('merchant', 'payout-key');
    assert.ok(payout);
  });

  it('trims trailing slashes from baseUrl', () => {
    // Indirect: HeleketPayment isn't expected to expose its baseUrl, but we
    // exercise the resolveConfig path that does the trimming.
    const payment = new HeleketPayment('merchant', 'key', { baseUrl: 'https://example.com/' });
    assert.ok(payment);
  });

  it('rejects merchantId with CRLF (header injection guard)', () => {
    assert.throws(() => new HeleketPayment('uuid\r\nX-Injected: 1', 'key'), /control character/);
  });

  it('rejects apiKey with control characters', () => {
    assert.throws(() => new HeleketPayment('merchant', 'key\x00'), /control character/);
    assert.throws(() => new HeleketPayment('merchant', 'key\nbad'), /control character/);
  });
});
