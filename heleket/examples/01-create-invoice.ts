import { ValidationError } from '../src/index.js';
import { envOptional, makePayment, prettyPrint, randomOrderId } from './_bootstrap.js';

const client = makePayment();

try {
  const invoice = await client.createInvoice({
    amount: '15.00',
    currency: 'USD',
    order_id: randomOrderId('demo'),
    lifetime: 3600,
    url_callback: envOptional('HELEKET_WEBHOOK_URL', ''),
  });

  prettyPrint('Invoice created', invoice);
  console.log('\nPayment page:', invoice.url);
} catch (error) {
  if (error instanceof ValidationError) {
    console.error('Validation failed:');
    for (const [field, messages] of Object.entries(error.fields)) {
      console.error(`  ${field}: ${messages.join(', ')}`);
    }
    process.exit(2);
  }
  console.error('create invoice:', error);
  process.exit(3);
}
