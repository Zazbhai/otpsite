import { createHash } from 'node:crypto';
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { sign, signatureEqual } from '../src/signature.js';

describe('signature', () => {
  it('empty body collapses to md5(apiKey)', () => {
    const apiKey = 'super-secret-key';
    const expected = createHash('md5').update(apiKey).digest('hex');
    assert.equal(sign('', apiKey), expected);
    assert.equal(sign(Buffer.alloc(0), apiKey), expected);
  });

  it('matches the doc formula', () => {
    const body = '{"amount":"15","currency":"USD","order_id":"1"}';
    const apiKey = 'merchant-api-key-42';
    const expected = createHash('md5')
      .update(Buffer.from(body, 'utf8').toString('base64') + apiKey)
      .digest('hex');
    assert.equal(sign(body, apiKey), expected);
  });

  it('matches the cross-language parity vector (PHP/Go)', () => {
    // Same input the PHP SDK uses in tests/Unit/SignerTest.php and the Go SDK
    // uses in signature_test.go. The hex must be byte-identical across all
    // three SDKs.
    const body = '{"amount":"15","currency":"USD","order_id":"1"}';
    const apiKey = 'merchant-api-key-42';
    const expected = createHash('md5')
      .update(Buffer.from(body, 'utf8').toString('base64') + apiKey)
      .digest('hex');
    assert.equal(sign(body, apiKey), expected);
  });

  it('signatureEqual is case-sensitive and length-aware', () => {
    assert.equal(signatureEqual('abc', 'abc'), true);
    assert.equal(signatureEqual('abc', 'abd'), false);
    assert.equal(signatureEqual('abc', 'ABC'), false);
    assert.equal(signatureEqual('abc', 'abcd'), false);
    assert.equal(signatureEqual('', ''), true);
  });
});
