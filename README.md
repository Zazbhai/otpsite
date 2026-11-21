# OTPsite

Requires Node.js 18 or later and a MongoDB replica set or MySQL database.
Run `npm ci`, copy `.env.example` to `.env`, fill in the database and JWT settings, then run `npm start`.
Set `DB_TYPE=mysql` and configure `DB_HOST`, `DB_PORT`, `DB_NAME`, `DB_USER`, and `DB_PASS` when using MySQL.

Configure gateways in **Admin ? Payments**, or copy `payment_config.example.json` to `payment_config.json` and supply the server's own gateway credentials.
The optional `LICENSE_DOMAIN` setting restricts requests to one hostname.

Run `node tests/admin-live.test.js` to check admin updates. The SMSCandy import tests use a privately supplied SQL fixture at `smscandy-backup/smscandy-db.sql`.
