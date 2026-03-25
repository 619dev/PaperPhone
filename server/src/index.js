require('dotenv').config();
const http = require('http');
const app = require('./app');
const { initWsServer } = require('./ws/wsServer');
const { connectDb } = require('./db/mysql');
const { connectRedis } = require('./db/redis');

const PORT = process.env.PORT || 3000;

async function main() {
  await connectDb();
  await connectRedis();

  const server = http.createServer(app);
  initWsServer(server);

  server.listen(PORT, () => {
    console.log(`🚀 PaperPhone server running on http://localhost:${PORT}`);
  });
}

main().catch(err => {
  console.error('Failed to start server:', err);
  process.exit(1);
});
