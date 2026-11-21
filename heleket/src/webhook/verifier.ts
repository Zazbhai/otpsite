import { isUtf8 } from 'node:buffer';

import { SignatureError } from '../errors.js';
import { sign as signBytes, signatureEqual } from '../signature.js';
import { WebhookPayload } from './payload.js';

/**
 * Verifier for Heleket webhook signatures.
 *
 * Use the API key that matches the webhook type:
 *   - `payment` / `wallet` → payment API key
 *   - `payout`             → payout API key
 *
 * # Why two methods
 *
 * Heleket's server uses PHP-encoded JSON: insertion-order keys, forward
 * slashes escaped as `\/`. JavaScript preserves object insertion order
 * (ES2015 spec) but `JSON.stringify` does NOT escape `/`. So a Node.js
 * round-trip through `JSON.parse` / `JSON.stringify` strips the slash
 * escapes and breaks the signature.
 *
 * `verifyRaw` works on the **raw bytes** of the request body and is the
 * method that handles real Heleket webhooks correctly.
 *
 * `verify(decoded)` accepts an already-decoded payload object — convenient
 * but lossy. It cannot recover PHP slash escapes, so it only works against
 * payloads that originated in a Node-compatible encoder (typically test
 * fixtures, never the real production traffic).
 */
export class WebhookVerifier {
  private readonly apiKey: string;

  constructor(apiKey: string) {
    this.apiKey = apiKey;
  }

  /**
   * Verify the signature of a raw JSON body. Preferred entry point — handles
   * PHP-style slash escapes by hashing the raw bytes minus the `sign` field.
   *
   * @param rawBody — the verbatim request body (string or Buffer).
   * @throws SignatureError on malformed JSON, missing sign, or mismatch.
   */
  verifyRaw(rawBody: string | Buffer): WebhookPayload {
    let bodyStr: string;
    if (typeof rawBody === 'string') {
      bodyStr = rawBody;
    } else {
      // `Buffer.toString('utf8')` silently replaces invalid bytes with U+FFFD,
      // which would still go through the signature check and surface as a
      // confusing "signature mismatch". Reject up front so the merchant gets
      // an actionable error instead.
      if (!isUtf8(rawBody)) {
        throw new SignatureError('body is not valid UTF-8');
      }
      bodyStr = rawBody.toString('utf8');
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(bodyStr);
    } catch (error) {
      throw new SignatureError(
        `body is not valid JSON: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw new SignatureError('webhook body must be a JSON object');
    }

    const decoded = parsed as Record<string, unknown>;
    const signValue = decoded.sign;
    if (typeof signValue !== 'string' || signValue === '') {
      throw new SignatureError('missing or empty sign field');
    }

    const stripped = stripSignFieldFromRawBody(bodyStr, signValue);
    const expected = signBytes(stripped, this.apiKey);

    if (!signatureEqual(expected, signValue)) {
      throw new SignatureError('signature mismatch');
    }

    return new WebhookPayload(decoded, signValue);
  }

  /**
   * Verify an already-decoded payload. Convenience entry point — see the
   * class-level docs about when it's safe.
   */
  verify(payload: Record<string, unknown>): WebhookPayload {
    const signValue = payload.sign;
    if (typeof signValue !== 'string' || signValue === '') {
      throw new SignatureError('missing or empty sign field');
    }

    const withoutSign: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(payload)) {
      if (k === 'sign') continue;
      withoutSign[k] = v;
    }

    const reencoded = JSON.stringify(withoutSign);
    const expected = signBytes(reencoded, this.apiKey);

    if (!signatureEqual(expected, signValue)) {
      throw new SignatureError('signature mismatch');
    }

    return new WebhookPayload(payload, signValue);
  }
}

/**
 * Remove the `"sign":"<hex>"` field from a raw JSON body, preserving every
 * other byte exactly. Handles three positions:
 *
 *   - sign-first:  `{"sign":"...","other":...}`
 *   - sign-middle: `{"a":...,"sign":"...","b":...}`
 *   - sign-last:   `{"other":...,"sign":"..."}`
 *
 * The neighbouring comma is consumed so the resulting JSON stays valid. The
 * verifier then hashes the returned bytes — preserving PHP slash escapes
 * (`\/`) and insertion order automatically.
 *
 * SAFETY: this finds the FIRST literal occurrence of `"sign":"<expectedSign>"`
 * in the body. A maliciously crafted field value that contained the same
 * 32-char hex would have to (a) survive JSON string escaping (PHP encodes
 * inner quotes as `\"`, so the regex cannot match inside a string value) and
 * (b) be known to the attacker before they could collide with a real sign,
 * which itself requires the API key. The combination makes this exploitable
 * only with the secret you'd otherwise just forge the sign with. We still
 * keep the strip conservative: anchor on the exact sign value, never a
 * pattern.
 */
function stripSignFieldFromRawBody(body: string, expectedSign: string): string {
  // Locate `"sign":"<expectedSign>"` literally to avoid mis-matching a value
  // that happens to look like a sign elsewhere in the JSON.
  const escapedSign = expectedSign.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const fieldRegex = new RegExp(`"sign"\\s*:\\s*"${escapedSign}"`);
  const found = body.match(fieldRegex);
  if (!found || found.index === undefined) {
    throw new SignatureError('sign field not found at expected position in raw body');
  }
  const start = found.index;
  const end = start + found[0].length;

  // Try to consume a leading comma (sign field is NOT first).
  let s = start;
  while (s > 0 && isWhitespace(body.charCodeAt(s - 1))) s--;
  if (s > 0 && body.charCodeAt(s - 1) === COMMA) {
    return body.slice(0, s - 1) + body.slice(end);
  }

  // Otherwise consume a trailing comma (sign field IS first, others follow).
  let e = end;
  while (e < body.length && isWhitespace(body.charCodeAt(e))) e++;
  if (e < body.length && body.charCodeAt(e) === COMMA) {
    return body.slice(0, start) + body.slice(e + 1);
  }

  // No neighbouring comma → sign was the only field.
  return body.slice(0, start) + body.slice(end);
}

const COMMA = 0x2c;

function isWhitespace(code: number): boolean {
  return code === 0x20 || code === 0x09 || code === 0x0a || code === 0x0d;
}
