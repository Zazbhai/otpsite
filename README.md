# OTPsite

Requires Node.js 18 or later and a MongoDB replica set or MySQL database.
Run `npm ci`, copy `.env.example` to `.env`, fill in the database and JWT settings, then run `npm start`.
Set `DB_TYPE=mysql` and configure `DB_HOST`, `DB_PORT`, `DB_NAME`, `DB_USER`, and `DB_PASS` when using MySQL.

Configure gateways in **Admin ? Payments**, or copy `payment_config.example.json` to `payment_config.json` and supply the server's own gateway credentials.
The optional `LICENSE_DOMAIN` setting restricts requests to one hostname.

Run `node tests/admin-live.test.js` to check admin updates. The SMSCandy import tests use a privately supplied SQL fixture at `smscandy-backup/smscandy-db.sql`.

For slow `getNumber` requests, inspect `[Slow API request]` stages. A stage such as
`provider_getNumber_1_headers` means attempt 1 is waiting for the provider's response
headers (including DNS, connection and TLS setup); `_body` means headers arrived
but the response body has not finished. `_retry_wait` is the pause between attempts.
The numbered stages separate multiple provider requests from one stalled request.
Set a server's retry count to 1 when diagnosing upstream latency. There is no
application-imposed allocation timeout; a `client_disconnected` event means the
downstream connection closed, and cannot identify which client or proxy closed it.
A disconnected purchase can still finish, so check order history before making
another purchase. Increasing the client's timeout only allows a longer wait;
upstream latency requires investigating the VPS-to-provider connection or the provider.
