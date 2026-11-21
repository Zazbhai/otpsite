import { makePayment, makePayout, prettyPrint } from './_bootstrap.js';

const kind = process.argv[2] ?? 'payment';

switch (kind) {
  case 'payment':
    prettyPrint('Payment services', await makePayment().listServices());
    break;
  case 'payout':
    prettyPrint('Payout services', await makePayout().listServices());
    break;
  default:
    console.error('Usage: node 09-list-services.js [payment|payout]');
    process.exit(1);
}
