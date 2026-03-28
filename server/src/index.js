require('dotenv').config();
const fs   = require('fs');
const path = require('path');
const http = require('http');
const app  = require('./app');
const { initWsServer } = require('./ws/wsServer');
const { connectDb, getDb } = require('./db/mysql');
const { connectRedis }     = require('./db/redis');
const { initMomentsTables } = require('./routes/moments');
const { initTagTables }      = require('./routes/tags');

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
  await initTagTables();
  await connectRedis();

  const server = http.createServer(app);
  initWsServer(server);

  server.listen(PORT, () => {
    console.log(`🚀 PaperPhone server running on http://localhost:${PORT}`);
    startMessageCleanup();
  });
}

/**
 * Periodic cleanup — delete expired messages based on auto_delete settings.
 * Runs every hour.
 */
function startMessageCleanup() {
  const INTERVAL = 60 * 60 * 1000; // 1 hour

  async function cleanup() {
    try {
      const db = getDb();

      // Delete expired private messages
      const [privResult] = await db.query(`
        DELETE m FROM messages m
        JOIN friends f ON (
          (f.user_id = m.from_id AND f.friend_id = m.to_id)
          OR (f.user_id = m.to_id AND f.friend_id = m.from_id)
        )
        WHERE m.type = 'private'
          AND f.auto_delete > 0
          AND m.created_at < DATE_SUB(NOW(), INTERVAL f.auto_delete SECOND)
      `);

      // Delete expired group messages
      const [grpResult] = await db.query(`
        DELETE m FROM messages m
        JOIN \`groups\` g ON g.id = m.to_id
        WHERE m.type = 'group'
          AND g.auto_delete > 0
          AND m.created_at < DATE_SUB(NOW(), INTERVAL g.auto_delete SECOND)
      `);

      const total = (privResult.affectedRows || 0) + (grpResult.affectedRows || 0);
      if (total > 0) {
        console.log(`🗑️  Auto-deleted ${total} expired messages`);
      }
    } catch (err) {
      console.error('Message cleanup error:', err.message);
    }
  }

  // Run once on startup, then every hour
  cleanup();
  setInterval(cleanup, INTERVAL);
  console.log('⏱️  Message auto-delete cleanup scheduled (every 1h)');
}

main().catch(err => {
  console.error('Failed to start server:', err);
  process.exit(1);
});
