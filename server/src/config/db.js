/**
 * MongoDB (Atlas) connection via Mongoose.
 */
const mongoose = require('mongoose');
const env = require('./env');

mongoose.set('strictQuery', true);

async function connectDB() {
  try {
    const conn = await mongoose.connect(env.MONGODB_URI, { serverSelectionTimeoutMS: 15000 });
    console.log(`[db] connected to MongoDB (${conn.connection.host}/${conn.connection.name})`);
    return conn;
  } catch (err) {
    console.error('\n[db] could not connect to MongoDB:', err.message);
    if (/authentication failed|bad auth/i.test(err.message)) {
      console.error('     → Check the username/password in MONGODB_URI (special characters in the password must be URL-encoded).');
    } else if (/ENOTFOUND|querySrv/i.test(err.message)) {
      console.error('     → Check the cluster host name in MONGODB_URI and your internet connection.');
    } else if (/timed out|Server selection/i.test(err.message)) {
      console.error('     → In Atlas, open Network Access and allow your current IP address.');
    }
    process.exit(1);
  }
}

async function disconnectDB() {
  await mongoose.disconnect();
}

module.exports = { connectDB, disconnectDB };
