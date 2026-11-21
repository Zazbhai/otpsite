import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { SignatureError, sign, WebhookVerifier } from '../src/index.js';

const API_KEY = 'webhook-secret';

function makeSignedPayload(fields: Record<string, unknown>): {
  payload: Record<string, unknown>;
  raw: string;
} {
  const body = JSON.stringify(fields);
  const payload = { ...fields, sign: sign(body, API_KEY) };
  return { payload, raw: JSON.stringify(payload) };
}

describe('WebhookVerifier', () => {
  it('verifyRaw accepts a valid Node-encoded payload', () => {
    const { raw } = makeSignedPayload({
      type: 'payment',
      uuid: 'pmt-1',
      order_id: 'order-1',
      status: 'paid',
      is_final: true,
      amount: '15.00',
      txid: '0xabc',
      network: 'bsc',
    });

    const result = new WebhookVerifier(API_KEY).verifyRaw(raw);
    assert.ok(result.isPayment());
    assert.equal(result.uuid, 'pmt-1');
    assert.equal(result.orderId, 'order-1');
    assert.equal(result.status, 'paid');
    assert.ok(result.isFinal());
    assert.ok(result.isSuccessful());
  });

  it('verifyRaw rejects a tampered payload', () => {
    const { payload } = makeSignedPayload({ type: 'payment', uuid: 'u1', status: 'paid' });
    payload.status = 'fail';
    const tampered = JSON.stringify(payload);

    assert.throws(() => new WebhookVerifier(API_KEY).verifyRaw(tampered), SignatureError);
  });

  it('verifyRaw rejects missing sign', () => {
    assert.throws(
      () => new WebhookVerifier(API_KEY).verifyRaw('{"type":"payment"}'),
      SignatureError,
    );
  });

  it('verifyRaw rejects wrong key', () => {
    const { raw } = makeSignedPayload({ type: 'payment', status: 'paid' });
    assert.throws(() => new WebhookVerifier('a-different-key').verifyRaw(raw), SignatureError);
  });

  it('verifyRaw rejects invalid JSON', () => {
    assert.throws(() => new WebhookVerifier(API_KEY).verifyRaw('not json'), SignatureError);
  });

  it('verifyRaw rejects JSON arrays (must be an object)', () => {
    assert.throws(() => new WebhookVerifier(API_KEY).verifyRaw('[1,2,3]'), SignatureError);
  });

  it('verifyRaw rejects buffers with invalid UTF-8 bytes', () => {
    // Without an early UTF-8 check, Buffer.toString('utf8') would silently
    // replace invalid bytes with U+FFFD and the request would fail later as
    // a confusing "signature mismatch". Surface the real reason instead.
    assert.throws(
      () =>
        new WebhookVerifier(API_KEY).verifyRaw(Buffer.from([0xff, 0xfe, 0x00, 0x62, 0x61, 0x64])),
      /UTF-8/,
    );
  });

  // The critical test: a real Heleket webhook is PHP-encoded with insertion-
  // order keys and escaped forward slashes (\/). Go's JSON encoder sorts keys
  // and doesn't escape slashes — we caught this exact bug in the Go SDK. Node's
  // JSON.stringify preserves insertion order but doesn't escape slashes either.
  // verifyRaw must work on the raw bytes so the slash escapes survive.
  it('verifyRaw handles PHP-style payloads (insertion order + \\/ escapes)', () => {
    const bodyWithoutSign = `{"type":"payment","uuid":"u1","status":"paid","url":"https:\\/\\/pay.heleket.com\\/pay\\/abc"}`;
    const computedSign = sign(bodyWithoutSign, API_KEY);
    const body = `{"type":"payment","uuid":"u1","status":"paid","url":"https:\\/\\/pay.heleket.com\\/pay\\/abc","sign":"${computedSign}"}`;

    const result = new WebhookVerifier(API_KEY).verifyRaw(body);
    assert.equal(result.uuid, 'u1');
    assert.equal(result.status, 'paid');
  });

  it('verifyRaw handles sign as the first field', () => {
    const bodyWithoutSign = `{"type":"payment","uuid":"u1","status":"paid"}`;
    const computedSign = sign(bodyWithoutSign, API_KEY);
    const body = `{"sign":"${computedSign}","type":"payment","uuid":"u1","status":"paid"}`;

    const result = new WebhookVerifier(API_KEY).verifyRaw(body);
    assert.equal(result.status, 'paid');
  });

  it('verifyRaw handles sign as the only field', () => {
    const computedSign = sign('{}', API_KEY);
    const body = `{"sign":"${computedSign}"}`;

    // The stripped body becomes "{}" so this should verify.
    const result = new WebhookVerifier(API_KEY).verifyRaw(body);
    assert.equal(result.uuid, '');
  });

  it('verify (legacy) works for Node-encoded payloads', () => {
    const { payload } = makeSignedPayload({
      type: 'payout',
      uuid: 'po-7',
      status: 'paid',
      is_final: true,
    });

    const result = new WebhookVerifier(API_KEY).verify(payload);
    assert.ok(result.isPayout());
    assert.ok(result.isSuccessful());
  });
});
