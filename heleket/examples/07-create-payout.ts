import { ValidationError } from '../src/index.js';
import { envOptional, makePayout, prettyPrint, randomOrderId } from './_bootstrap.js';

const [, , amount, address] = process.argv;
if (!amount || !address) {
  console.error('Usage: node 07-create-payout.js <amount> <address>');
  process.exit(1);
}

try {
  const payout = await makePayout().createPayout({
    amount,
    currency: 'USDT',
    network: 'TRON',
    order_id: randomOrderId('payout'),
    address,
    is_subtract: true,
    url_callback: envOptional('HELEKET_PAYOUT_WEBHOOK_URL', ''),
  });

  prettyPrint('Payout created', payout);
} catch (error) {
  if (error instanceof ValidationError) {
    console.error('Validation failed:');
    for (const [field, messages] of Object.entries(error.fields)) {
      console.error(`  ${field}: ${messages.join(', ')}`);
    }
    process.exit(2);
  }
  console.error('create payout:', error);
  process.exit(3);
}
