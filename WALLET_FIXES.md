Wallet changes
==============

The MySQL compatibility layer previously changed `$inc` fields before calling
Sequelize `instance.update()`. Sequelize omitted those already-dirty fields from
the SQL UPDATE. A balance displayed as deducted could remain unchanged in the
database. The shim now explicitly saves increments, preserves combined `$set`
updates, and locks rows inside transactions, including callers without one.

Purchases now reserve money and write a pending purchase ledger entry before
calling the number provider. Order creation and purchase completion commit
together. Failed placement reverses the pending debit exactly once and writes a
refund ledger entry. The watcher recovers interrupted reservations after fifteen
minutes. A late finalization cannot complete an already reversed reservation.
An upstream provider timeout can still leave an unknown upstream allocation;
the local reservation is recovered, but provider-side reconciliation requires
the upstream order identifier or an idempotency API supplied by that provider.

Website, API, expiry and provider refunds use database guards. A refund must
match its original completed purchase and owner, and is limited to that debit.
Missing or inconsistent historical ledger data blocks automatic refunds for
review instead of creating money. Watcher updates never save a stale order
document after a network call; OTPs are checked again before refunding.
Older MySQL purchases without the new verified debit reference also require
manual reconciliation: the old shim could write a purchase ledger entry without
persisting its debit. An existing ledger entry is insufficient proof of payment
for those legacy orders. The audit reports these orders separately.

Deposit callbacks, verification and admin approval share a transaction claim,
wallet credit and ledger commit. The same payment/UTR cannot credit twice;
verification is bound to the payment owner. OmniPay success must come from its
authenticated query, not the unsigned callback body. Merchant payment records
are saved before requesting payment URLs. Admin balance changes are atomic,
have ledger entries, and cannot create a negative wallet.

MySQL money columns use DECIMAL(18,4) with numeric getters. Startup checks and
migrates existing money columns once after model synchronization, and requires
InnoDB for the financial tables. The database account must be able to ALTER the
listed columns; a migration failure stops startup. MongoDB balance increments
use atomic rounding to four decimal places. Invalid prices, excessive discounts,
and non-finite amounts cannot create wallet credits through a purchase.
Legacy blank optional transaction references are converted to NULL before
synchronizing the unique reference index; actual payment references are retained.

Validation and rollout
----------------------

Run `npm test` for the local regression suite. It exercises real Sequelize
instance update/save behavior with an intercepted database transport, real
Mongoose query middleware, and transaction simulations for concurrency, rollback,
refunds, payment replays and recovery. It does not contact payment providers or
spend money. Full database locking behavior should also be validated against the
deployment's MySQL/MongoDB staging database.

Deploy the changed code and restart all application processes together so old
balance writers do not continue running. The first MySQL startup performs the
decimal migration before watchers start; plan for the time needed by ALTER TABLE
on the deployment's table sizes. Normal MongoDB transactions require a replica set.

Existing overcredits are not automatically removed. `npm run wallet:audit`
performs read-only checks against the configured database and writes
`scratch/wallet-audit.json`, reporting missing purchases, excessive/duplicate
refunds, inconsistent order costs/flags, negative wallets and stale reservations.
It checks the latest 10,000 orders by default; set WALLET_AUDIT_LIMIT to change
the bound (maximum 100,000). The report is not a complete reconstruction of
starting balances, imported credits or provider-side payments.
