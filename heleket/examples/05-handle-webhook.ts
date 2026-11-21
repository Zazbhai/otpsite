// Webhook listener example. Run with:
//
//   npm run build && node dist/examples/05-handle-webhook.js
//   (or: make example-webhook)
//
// Then point your Heleket invoice's url_callback at http://<host>:8000/
// (use ngrok or similar for local development).
//
// The handler verifies the signature against HELEKET_PAYMENT_KEY via
// `verifyRaw` (the byte-fidelity entry point — REQUIRED for real Heleket
// webhooks because they're PHP-encoded with insertion-order keys and
// escaped forward slashes).

import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { SignatureError, WebhookVerifier } from '../src/index.js';
import { envOptional, envRequire } from './_bootstrap.js';

const verifier = new WebhookVerifier(envRequire('HELEKET_PAYMENT_KEY'));

const server = createServer(async (req: IncomingMessage, res: ServerResponse) => {
  if (req.method !== 'POST') {
    res.statusCode = 400;
    res.end('POST required');
    return;
  }

  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    chunks.push(chunk as Buffer);
  }
  const body = Buffer.concat(chunks).toString('utf8');

  try {
    const payload = verifier.verifyRaw(body);

    console.log(
      `[heleket] ${payload.type} ${payload.orderId} status=${payload.status} is_final=${payload.isFinal()}`,
    );

    // PRODUCTION: this example does NOT de-duplicate. Heleket will replay
    // events after retries and operators can resend manually. See
    // docs/06-webhooks.md ("Idempotency and replay protection") for the
    // recommended pattern using a unique (uuid, status) key in your DB.

    res.statusCode = 200;
    res.end('OK');
  } catch (error) {
    if (error instanceof SignatureError) {
      console.warn('[heleket] signature mismatch:', error.reason);
    } else {
      console.warn('[heleket] webhook error:', error);
    }
    res.statusCode = 400;
    res.end('invalid signature');
  }
});

const port = Number(envOptional('PORT', '8000'));
server.listen(port, () => {
  console.log(`listening on :${port}`);
});
