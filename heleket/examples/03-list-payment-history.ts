import { makePayment, prettyPrint } from './_bootstrap.js';

const client = makePayment();

const dateFrom = process.argv[2];
const dateTo = process.argv[3];

const page = await client.listHistory({ date_from: dateFrom, date_to: dateTo });
prettyPrint('Page 1', page);

if (page.paginate?.nextCursor) {
  const next = await client.listHistory({
    date_from: dateFrom,
    date_to: dateTo,
    cursor: page.paginate.nextCursor,
  });
  prettyPrint('Page 2', next);
}
