import { makePayout, prettyPrint } from './_bootstrap.js';

const uuid = process.argv[2];
const address = process.argv[3];
if (!uuid || !address) {
  console.error('Usage: node 11-refund.js <invoice-uuid> <refund-address>');
  process.exit(1);
}

// Refunds are signed with the PAYOUT key, so they live on HeleketPayout — not
// HeleketPayment.
const result = await makePayout().refund({ uuid, address, is_subtract: true });
prettyPrint('Refund', result);
