// db.js
const { Pool } = require('pg');

const dbConfig = {
  user: process.env.DB_USER,
  host: process.env.DB_HOST,
  database: process.env.DB_NAME,
  password: process.env.DB_PASSWORD,
  port: Number(process.env.DB_PORT || 5432),
  ssl: { require: true, rejectUnauthorized: false },
  connectionTimeoutMillis: 10000, // 10 secondes
  idleTimeoutMillis: 30000
};

const pool = new Pool(dbConfig);

module.exports = {
  pool,
  dbConfig
};
