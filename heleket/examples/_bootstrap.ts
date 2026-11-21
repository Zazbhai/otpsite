// Shared example bootstrap.
//   - tiny inline .env loader (no dotenv dep)
//   - factories for PaymentClient / PayoutClient
//   - prettyPrint helper

import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { HeleketPayment, HeleketPayout } from '../src/index.js';

const here = fileURLToPath(new URL('.', import.meta.url));

function loadEnv(): void {
  for (const candidate of [join(here, '..', '.env'), join(here, '..', '..', '.env')]) {
    if (!existsSync(candidate)) continue;
    const text = readFileSync(candidate, 'utf8');
    for (const line of text.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const eq = trimmed.indexOf('=');
      if (eq < 0) continue;
      const key = trimmed.slice(0, eq).trim();
      let value = trimmed.slice(eq + 1).trim();
      if (
        (value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))
      ) {
        value = value.slice(1, -1);
      }
      if (process.env[key] === undefined) process.env[key] = value;
    }
    return;
  }
}

loadEnv();

export function envRequire(name: string): string {
  const value = process.env[name];
  if (!value) {
    process.stderr.write(`Missing env var: ${name}\nCopy .env.example to .env and fill it in.\n`);
    process.exit(1);
  }
  return value;
}

export function envOptional(name: string, fallback = ''): string {
  return process.env[name] ?? fallback;
}

export function makePayment(): HeleketPayment {
  return new HeleketPayment(envRequire('HELEKET_MERCHANT_ID'), envRequire('HELEKET_PAYMENT_KEY'), {
    debug: process.env.HELEKET_DEBUG === '1',
  });
}

export function makePayout(): HeleketPayout {
  return new HeleketPayout(envRequire('HELEKET_MERCHANT_ID'), envRequire('HELEKET_PAYOUT_KEY'), {
    debug: process.env.HELEKET_DEBUG === '1',
  });
}

export function prettyPrint(label: string, value: unknown): void {
  process.stdout.write(`\n=== ${label} ===\n`);
  process.stdout.write(JSON.stringify(value, null, 2) + '\n');
}

export function randomOrderId(prefix: string): string {
  const bytes = new Uint8Array(4);
  crypto.getRandomValues(bytes);
  return prefix + '-' + Buffer.from(bytes).toString('hex');
}
