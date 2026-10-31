const test = require('node:test');
const assert = require('node:assert/strict');
const dns = require('node:dns');
const mongoose = require('mongoose');
const connectDB = require('../src/config/db');

test('concurrent connection requests share the same in-flight MongoDB connection', async () => {
  const originalConnect = mongoose.connect;
  const originalReadyState = mongoose.connection.readyState;
  const originalMongoUri = process.env.MONGO_URI;
  let calls = 0;
  let resolveConnection;
  const pendingConnection = new Promise((resolve) => { resolveConnection = resolve; });

  mongoose.connection.readyState = 0;
  process.env.MONGO_URI = 'mongodb://localhost/test';
  mongoose.connect = () => {
    calls += 1;
    mongoose.connection.readyState = 2;
    return pendingConnection;
  };

  try {
    const first = connectDB();
    const second = connectDB();
    assert.equal(calls, 1);
    mongoose.connection.readyState = 1;
    resolveConnection(mongoose);
    assert.deepEqual(await Promise.all([first, second]), [mongoose, mongoose]);
  } finally {
    mongoose.connect = originalConnect;
    mongoose.connection.readyState = originalReadyState;
    if (originalMongoUri === undefined) delete process.env.MONGO_URI;
    else process.env.MONGO_URI = originalMongoUri;
  }
});

test('MongoDB DNS servers can be overridden for Node SRV resolution', async () => {
  const originalConnect = mongoose.connect;
  const originalReadyState = mongoose.connection.readyState;
  const originalMongoUri = process.env.MONGO_URI;
  const originalDnsServers = dns.getServers();
  const originalConfiguredDnsServers = process.env.MONGO_DNS_SERVERS;

  mongoose.connection.readyState = 0;
  process.env.MONGO_URI = 'mongodb+srv://localhost/test';
  process.env.MONGO_DNS_SERVERS = '1.1.1.1, 8.8.8.8';
  mongoose.connect = () => Promise.resolve(mongoose);

  try {
    await connectDB();
    assert.deepEqual(dns.getServers(), ['1.1.1.1', '8.8.8.8']);
  } finally {
    mongoose.connect = originalConnect;
    mongoose.connection.readyState = originalReadyState;
    dns.setServers(originalDnsServers);
    if (originalMongoUri === undefined) delete process.env.MONGO_URI;
    else process.env.MONGO_URI = originalMongoUri;
    if (originalConfiguredDnsServers === undefined) delete process.env.MONGO_DNS_SERVERS;
    else process.env.MONGO_DNS_SERVERS = originalConfiguredDnsServers;
  }
});
