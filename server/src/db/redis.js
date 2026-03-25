const { createClient } = require('redis');

let client;

async function connectRedis() {
  client = createClient({
    socket: {
      host: process.env.REDIS_HOST || 'localhost',
      port: parseInt(process.env.REDIS_PORT || '6379'),
    },
    password: process.env.REDIS_PASS || undefined,
  });

  client.on('error', err => console.error('Redis error:', err));
  await client.connect();
  console.log('✅ Redis connected');
  return client;
}

function getRedis() {
  if (!client) throw new Error('Redis not initialized. Call connectRedis() first.');
  return client;
}

module.exports = { connectRedis, getRedis };
