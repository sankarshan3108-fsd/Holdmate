/**
 * Environment loading. All secrets come from server/.env (never committed).
 */
const path = require('path');

require('dotenv').config({ path: path.join(__dirname, '..', '..', '.env') });

const num = (v, fallback) => {
  const n = parseFloat(v);
  return Number.isFinite(n) ? n : fallback;
};

const env = {
  PORT: parseInt(process.env.PORT || '5000', 10),
  NODE_ENV: process.env.NODE_ENV || 'development',
  MONGODB_URI: (process.env.MONGODB_URI || '').trim(),
  JWT_SECRET: process.env.JWT_SECRET || '',
  JWT_EXPIRES_IN: '7d',
  COOKIE_NAME: 'hm_token',
  HUB: {
    name: 'Coimbatore Junction',
    lat: num(process.env.HUB_LAT, 10.9965),
    lng: num(process.env.HUB_LNG, 76.9667)
  },
  SERVICE_RADIUS_KM: num(process.env.SERVICE_RADIUS_KM, 15),
  CORS_ORIGINS: (process.env.CORS_ORIGINS || 'http://localhost:5500,http://127.0.0.1:5500')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
};
env.isProd = env.NODE_ENV === 'production';
env.isDev = !env.isProd;

/** Stop early with a clear message if required settings are missing. */
env.assertRequired = function assertRequired() {
  const problems = [];
  if (!env.MONGODB_URI) problems.push('MONGODB_URI is empty — paste your MongoDB Atlas connection string.');
  else if (!/^mongodb(\+srv)?:\/\//.test(env.MONGODB_URI)) problems.push('MONGODB_URI must start with mongodb:// or mongodb+srv://');
  if (!env.JWT_SECRET) problems.push('JWT_SECRET is empty.');
  else if (env.JWT_SECRET.length < 32) problems.push('JWT_SECRET must be at least 32 characters long.');
  if (problems.length) {
    console.error('\n[config] server/.env is missing or incomplete:');
    problems.forEach((p) => console.error('  - ' + p));
    console.error('\nCopy server/.env.example to server/.env and fill it in. See server/README.md.\n');
    process.exit(1);
  }
};

module.exports = env;
