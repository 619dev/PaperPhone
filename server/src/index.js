require('dotenv').config();
const fs   = require('fs');
const path = require('path');
const http = require('http');
const app  = require('./app');
const { initWsServer } = require('./ws/wsServer');
const { connectDb, getDb } = require('./db/mysql');
const { connectRedis }     = require('./db/redis');
const { initMomentsTables } = require('./routes/moments');

const PORT = process.env.PORT || 3000;

async function initSchema() {
  const schemaPath = path.join(__dirname, '../db/schema.sql');
  const sql = fs.readFileSync(schemaPath, 'utf8');
  const db  = getDb();
  // Strip comments, split on semicolons, execute each statement
  const stmts = sql
    .replace(/--[^\n]*/g, '')
    .split(';')
    .map(s => s.trim())
    .filter(s => s.length > 0);
  for (const stmt of stmts) {
    await db.query(stmt);
  }
  console.log('✅ Database schema ready');
}

async function main() {
  await connectDb();
  await initSchema();
  await initMomentsTables();
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
