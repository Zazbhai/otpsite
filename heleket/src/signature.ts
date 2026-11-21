import { createHash, timingSafeEqual } from 'node:crypto';

/**
 * Heleket request and webhook signature.
 *
 * Formula (per https://doc.heleket.com/general/request-format):
 *
 *     sign = md5( base64(json_body) . apiKey )
 *
 * For requests with no parameters, pass an empty string — base64-encoding it
 * yields the empty string, so the hash collapses to md5(apiKey).
 *
 * The body argument MUST be the exact bytes that will be sent over the wire.
 * The same function is used to produce outgoing request signatures and to
 * verify incoming webhook signatures.
 */
export function sign(body: string | Buffer, apiKey: string): string {
  const bodyBuf = typeof body === 'string' ? Buffer.from(body, 'utf8') : body;
  const encoded = bodyBuf.toString('base64');
  return createHash('md5')
    .update(encoded + apiKey)
    .digest('hex');
}

/**
 * Constant-time comparison of two hex signatures. Use this in webhook
 * verification to avoid timing side-channels.
 *
 * Encoding is pinned to `'ascii'` — Heleket signatures are MD5 hex (32
 * ASCII chars). The default `Buffer.from` encoding is `'utf8'` which is
 * equivalent for ASCII but would silently misbehave if anything else slipped
 * in. Pinning the encoding makes the assumption explicit.
 */
export function signatureEqual(expected: string, actual: string): boolean {
  if (expected.length !== actual.length) {
    return false;
  }
  return timingSafeEqual(Buffer.from(expected, 'ascii'), Buffer.from(actual, 'ascii'));
}
