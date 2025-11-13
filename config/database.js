// config/database.js
import pkg from 'pg';
const { Pool } = pkg;

// On considère que si NODE_ENV === 'production', on est sur Azure
const isProd = process.env.NODE_ENV === 'production';

const pool = new Pool({
  user: process.env.DB_USER,
  host: process.env.DB_HOST,
  database: process.env.DB_NAME,
  password: process.env.DB_PASSWORD,          // 🔴 ICI : DB_PASSWORD (et plus DB_PASS)
  port: Number(process.env.DB_PORT || 5432),
  ssl: isProd
    ? { require: true, rejectUnauthorized: false } // Azure PostgreSQL : SSL ON
    : false,                                       // Local : sans SSL
  max: 20,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 20000,
});

// Test de connexion (juste pour debug au démarrage)
const testConnection = async () => {
  let client;
  try {
    client = await pool.connect();
    const result = await client.query('SELECT version(), current_database()');
    console.log('✅ Connecté à PostgreSQL');
    console.log(`📊 Version: ${result.rows[0].version}`);
    console.log(`🌐 Base: ${result.rows[0].current_database}`);
    console.log(`🏠 Hôte: ${process.env.DB_HOST}`);

    try {
      const tables = await client.query(`
        SELECT table_name 
        FROM information_schema.tables 
        WHERE table_schema = 'public'
      `);
      console.log(
        `📋 Tables: ${tables.rows.map((t) => t.table_name).join(', ') || 'Aucune'}`
      );
    } catch (tableError) {
      console.log('ℹ️  Impossible de lister les tables:', tableError.message);
    }
  } catch (error) {
    console.error('❌ Erreur de connexion PostgreSQL:', error.message);
  } finally {
    if (client) client.release();
  }
};

testConnection();

export default pool;
