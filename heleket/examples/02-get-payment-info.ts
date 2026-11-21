import { isPaymentStatusFinal } from '../src/index.js';
import { makePayment, prettyPrint } from './_bootstrap.js';

const id = process.argv[2];
if (!id) {
  console.error('Usage: node 02-get-payment-info.js <uuid-or-order-id>');
  process.exit(1);
}

const isUuid = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/.test(
  id,
);

const client = makePayment();
const info = await client.getInfo(isUuid ? { uuid: id } : { order_id: id });

prettyPrint('Payment info', info);

const status = info.status || info.payment_status || '';
console.log('\nStatus:', status);
console.log(
  isPaymentStatusFinal(status) ? '(final)' : '(intermediate — keep polling or wait for webhook)',
);
