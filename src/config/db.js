const mongoose = require('mongoose');
const dns = require('node:dns');

let cachedConnection = null;

function configureDnsServers() {
  const configuredServers = process.env.MONGO_DNS_SERVERS;
  if (!configuredServers) return;

  const servers = configuredServers.split(',').map((server) => server.trim()).filter(Boolean);
  if (servers.length === 0) {
    throw new Error('MONGO_DNS_SERVERS must contain at least one DNS server address');
  }
  dns.setServers(servers);
}

async function connectDB() {
  if (mongoose.connection.readyState === 1) {
    return mongoose.connection;
  }

  if (mongoose.connection.readyState === 2) {
    return cachedConnection || mongoose.connection.asPromise();
  }

  // A prior connection may have disconnected after its promise resolved.
  cachedConnection = null;

  const mongoUri = process.env.MONGO_URI;
  if (!mongoUri) {
    const errorMsg = 'MONGO_URI is missing from environment variables';
    console.error(errorMsg);
    throw new Error(errorMsg);
  }

  configureDnsServers();

  let connectionPromise;
  connectionPromise = mongoose.connect(mongoUri, {
    serverSelectionTimeoutMS: 10000,
  }).then((connection) => {
    console.log('MongoDB connected successfully');
    return connection;
  }).catch((error) => {
    if (cachedConnection === connectionPromise) {
      cachedConnection = null;
    }
    console.error('MongoDB connection error:', error.message);
    throw error;
  });
  cachedConnection = connectionPromise;
  return connectionPromise;
}

module.exports = connectDB;