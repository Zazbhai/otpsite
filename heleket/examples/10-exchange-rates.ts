import { makePayment, prettyPrint } from './_bootstrap.js';

const currency = process.argv[2] ?? 'USD';
const rates = await makePayment().getExchangeRates(currency);
prettyPrint(`Exchange rates for ${currency}`, rates);
