import { isAmlLinkStatusFinal } from '../src/index.js';
import { makePayment, prettyPrint } from './_bootstrap.js';

const id = process.argv[2];
if (!id) {
  console.error('Usage: node 12-aml-links.js <uuid-or-order-id>');
  process.exit(1);
}

const isUuid = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/.test(
  id,
);

// AML/KYC/SoF questionnaire links for a blocked (`locked`) payment.
const links = await makePayment().getAmlLinks(isUuid ? id : undefined, isUuid ? undefined : id);
prettyPrint('AML links', links);
for (const link of links) {
  const final = isAmlLinkStatusFinal(link.status ?? '') ? '(final)' : '(pending)';
  console.log(link.status, final, link.link);
}
