import pkg from 'pg';
const { Pool } = pkg;

// Configuration pour Azure PostgreSQL SANS SSL
const pool = new Pool({
  user: process.env.DB_USER,
  host: process.env.DB_HOST,
  database: process.env.DB_NAME,
  password: process.env.DB_PASS,
  port: process.env.DB_PORT,
  ssl: false, // Désactivation complète du SSL
  max: 20,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 20000,
});

// Test de connexion
const testConnection = async () => {
  let client;
  try {
    client = await pool.connect();
    const result = await client.query('SELECT version(), current_database()');
    console.log('✅ Connecté à Azure PostgreSQL avec succès (SANS SSL)');
    console.log(`📊 PostgreSQL Version: ${result.rows[0].version}`);
    console.log(`🌐 Base de données: ${result.rows[0].current_database}`);
    console.log(`🏠 Hôte: ${process.env.DB_HOST}`);
    
    // Vérifier les tables
    try {
      const tables = await client.query(`
        SELECT table_name 
        FROM information_schema.tables 
        WHERE table_schema = 'public'
      `);
      console.log(`📋 Tables disponibles: ${tables.rows.map(t => t.table_name).join(', ') || 'Aucune'}`);
    } catch (tableError) {
      console.log('ℹ️  Impossible de lister les tables (probablement vides)');
    }
    
  } catch (error) {
    console.error('❌ Erreur de connexion:', error.message);
  } finally {
    if (client) client.release();
  }
};

testConnection();

export default pool;