import { makePayment, prettyPrint, randomOrderId } from './_bootstrap.js';

const wallet = await makePayment().createStaticWallet({
  currency: 'USDT',
  network: 'tron',
  order_id: randomOrderId('wallet'),
});

prettyPrint('Static wallet', wallet);
console.log('\nAddress:', wallet.address);
