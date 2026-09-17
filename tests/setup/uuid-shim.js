// `uuid` v13 ships ESM only, which Jest's CommonJS runtime cannot require.
// The app only uses v4(); Node's crypto.randomUUID() is the same thing.
const { randomUUID } = require('crypto');
module.exports = { v4: randomUUID, validate: (s) => /^[0-9a-f-]{36}$/i.test(String(s)) };
