const mysql = require('mysql2/promise');

let pool;

async function connectDb() {
  pool = mysql.createPool({
    host: process.env.DB_HOST || 'localhost',
    port: parseInt(process.env.DB_PORT || '3306'),
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASS || 'root',
    database: process.env.DB_NAME || 'paperphone',
    waitForConnections: true,
    connectionLimit: 20,
    queueLimit: 0,
    charset: 'utf8mb4',
    timezone: '+00:00',
  });

  // Verify connection
  const conn = await pool.getConnection();
  console.log('✅ MySQL connected');
  conn.release();
  return pool;
}

function getDb() {
  if (!pool) throw new Error('DB not initialized. Call connectDb() first.');
  return pool;
}

module.exports = { connectDb, getDb };
