/**
 * "console" provider — development only. Generates the code here and prints it in the terminal.
 * The code is stored hashed (bcrypt) and checked locally.
 */
const env = require('../../../config/env');
const { randomDigits } = require('../../../utils/ids');
const { ProviderError } = require('../http');

module.exports = {
  name: 'console',
  channel: 'console',
  managesCode: false, // we generate + check the code ourselves

  async send(phone) {
    if (env.isProd) throw new ProviderError('console SMS provider is disabled in production');
    const code = randomDigits(6);
    console.log('\n+--------------------------------------+');
    console.log(`|  HoldMate login OTP for ${phone}   |`);
    console.log(`|              ${code}                  |`);
    console.log('|  (valid for 5 minutes)               |');
    console.log('+--------------------------------------+\n');
    return { code };
  }
};
