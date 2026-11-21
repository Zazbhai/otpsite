import { makePayout, prettyPrint } from './_bootstrap.js';

const id = process.argv[2];
if (!id) {
  console.error('Usage: node 08-get-payout-info.js <uuid-or-order-id>');
  process.exit(1);
}

const isUuid = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/.test(
  id,
);

const info = await makePayout().getInfo(isUuid ? { uuid: id } : { order_id: id });
prettyPrint('Payout info', info);
