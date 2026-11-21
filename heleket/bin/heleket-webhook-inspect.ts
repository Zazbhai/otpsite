#!/usr/bin/env node
// Heleket webhook inspector.
//
//   # Preferred: pass the API key via env var so it doesn't land in shell
//   # history or appear in `ps` output.
//   export HELEKET_API_KEY=$HELEKET_PAYMENT_KEY
//   cat webhook.json | heleket-webhook-inspect
//
//   # Or pass it explicitly (less safe — recorded in shell history).
//   heleket-webhook-inspect --key=$KEY --file=webhook.json
//   heleket-webhook-inspect --key=$KEY --type=payout < webhook.json
//
// Exit codes:
//   0 — payload valid, signature verified
//   1 — payload could not be parsed
//   2 — signature does not match
//   3 — missing arguments

import { parseArgs } from 'node:util';
import { readFileSync } from 'node:fs';
import { SignatureError, WebhookVerifier } from '../src/index.js';

const COLOR_RESET = '\x1b[0m';
const COLOR_RED = '\x1b[31m';
const COLOR_GREEN = '\x1b[32m';

const { values: flags } = parseArgs({
  options: {
    key: { type: 'string' },
    file: { type: 'string' },
    type: { type: 'string' },
  },
  strict: false,
});

const apiKey = (flags.key as string | undefined) || process.env.HELEKET_API_KEY || '';
if (!apiKey) {
  process.stderr.write(
    'Usage: heleket-webhook-inspect [--key=<api-key>] [--file=<path>] [--type=payment|payout]\n' +
      'Set HELEKET_API_KEY in the environment to avoid passing the key on the command line.\n',
  );
  process.exit(3);
}

let body: string;
if (flags.file) {
  body = readFileSync(flags.file as string, 'utf8');
} else {
  body = readFileSync(0, 'utf8'); // fd 0 = stdin
}

if (!body) {
  process.stderr.write('No input received. Pipe a JSON payload to stdin or pass --file=<path>.\n');
  process.exit(1);
}

let parsed: Record<string, unknown>;
try {
  parsed = JSON.parse(body) as Record<string, unknown>;
} catch (error) {
  process.stderr.write(
    `Input is not valid JSON: ${error instanceof Error ? error.message : String(error)}\n`,
  );
  process.exit(1);
}

console.log('Heleket webhook inspector');
console.log('----------------------------------------');
printField('type', parsed.type);
printField('uuid', parsed.uuid);
printField('order_id', parsed.order_id);
printField('status', parsed.status);
printField('amount', parsed.amount);
printField('network', parsed.network);
printField('txid', parsed.txid);
if ('is_final' in parsed) {
  printField('is_final', boolish(parsed.is_final));
} else {
  printField('is_final', '(missing)');
}
const signValue = parsed.sign;
if (typeof signValue === 'string') {
  printField('sign', signValue.length > 16 ? signValue.slice(0, 16) + '…' : signValue);
} else {
  printField('sign', '(missing)');
}

if (flags.type && parsed.type !== flags.type) {
  process.stderr.write(
    `\nWarning: --type=${String(flags.type)} but payload type is ${String(parsed.type)}\n`,
  );
}

try {
  new WebhookVerifier(apiKey).verifyRaw(body);
  console.log(`\nsignature: ${COLOR_GREEN}valid${COLOR_RESET}`);
  process.exit(0);
} catch (error) {
  const reason = error instanceof SignatureError ? error.reason : String(error);
  console.log(`\nsignature: ${COLOR_RED}INVALID${COLOR_RESET} — ${reason}`);
  console.log('Hints:');
  console.log('  - Are you using the same API key that was configured when the webhook was sent?');
  console.log(
    '  - Payment webhooks sign with the payment key; payout webhooks sign with the payout key.',
  );
  console.log(
    '  - If you re-serialised the payload before passing it here, the slash escaping may have been lost.',
  );
  process.exit(2);
}

function printField(name: string, value: unknown): void {
  if (value === null || value === undefined) {
    console.log(`  ${name.padEnd(10)} (missing)`);
    return;
  }
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    console.log(`  ${name.padEnd(10)} ${value}`);
    return;
  }
  console.log(`  ${name.padEnd(10)} ${JSON.stringify(value)}`);
}

function boolish(value: unknown): string {
  if (value === true) return 'yes';
  if (value === false) return 'no';
  return String(value);
}
