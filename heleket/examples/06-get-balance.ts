import { makePayment, prettyPrint } from './_bootstrap.js';

const balance = await makePayment().getBalance();
prettyPrint('Balance', balance);
