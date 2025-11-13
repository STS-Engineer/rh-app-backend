// server.js
require('dotenv').config({ path: __dirname + '/.env' });

const express = require('express');
const cors = require('cors');
const { Pool } = require('pg');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const path = require('path');

const app = express();
const PORT = Number(process.env.PORT || 5000);

// =========================
// Configuration de la base
// =========================

const dbConfig = {
  user: process.env.DB_USER,
  host: process.env.DB_HOST,
  database: process.env.DB_NAME,
  password: process.env.DB_PASSWORD,
  port: Number(process.env.DB_PORT || 5432),
  ssl: { require: true, rejectUnauthorized: false },
  connectionTimeoutMillis: 10000,
  idleTimeoutMillis: 30000
};

console.log('🔧 Configuration de la base de données:', {
  user: dbConfig.user,
  host: dbConfig.host,
  database: dbConfig.database,
  port: dbConfig.port,
  ssl: 'Activé',
  password: dbConfig.password ? '✅ Présent' : '❌ Manquant'
});

const pool = new Pool(dbConfig);

// Middleware pour servir les fichiers statiques (important pour Azure)
app.use(express.static(path.join(__dirname, 'public')));

// =========================
// Middleware globaux
// =========================

const allowedOrigins = [
  'http://localhost:3000',
  'https://avo-hr-managment.azurewebsites.net'
];

if (process.env.FRONTEND_URL && !allowedOrigins.includes(process.env.FRONTEND_URL)) {
  allowedOrigins.push(process.env.FRONTEND_URL);
}

const corsOptions = {
  origin: function (origin, callback) {
    if (!origin || allowedOrigins.indexOf(origin) !== -1) {
      callback(null, true);
    } else {
      console.warn('🚫 Origin non autorisée par CORS:', origin);
      callback(new Error('Not allowed by CORS'));
    }
  },
  credentials: true
};

app.use(cors(corsOptions));
app.use(express.json());

// =========================
// Middleware d'authentification
// =========================

const JWT_SECRET = process.env.JWT_SECRET || 'fallback_secret_pour_development_seulement_2024';

const authenticateToken = (req, res, next) => {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];

  if (token == null) {
    return res.status(401).json({ error: 'Token manquant' });
  }

  jwt.verify(token, JWT_SECRET, (err, user) => {
    if (err) {
      return res.status(403).json({ error: 'Token invalide' });
    }
    req.user = user;
    next();
  });
};

// =========================
// Routes de base
// =========================

app.get('/', (req, res) => {
  res.json({
    message: '🚀 API RH Manager - Connecté à Azure PostgreSQL',
    timestamp: new Date().toISOString(),
    environment: process.env.NODE_ENV || 'development'
  });
});

app.get('/api/health', async (req, res) => {
  try {
    const result = await pool.query('SELECT version(), current_database()');
    res.json({
      status: 'OK ✅',
      message: 'Backend RH opérationnel',
      database: {
        connected: true,
        version: result.rows[0].version,
        name: result.rows[0].current_database
      }
    });
  } catch (error) {
    console.error('❌ Health check échoué:', error);
    res.status(500).json({
      status: 'Error',
      message: 'Erreur base de données',
      error: error.message
    });
  }
});

// =========================
// Authentification
// =========================

app.post('/api/auth/login', async (req, res) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({
        success: false,
        message: 'Email et mot de passe requis'
      });
    }

    const userResult = await pool.query(
      'SELECT * FROM users WHERE email = $1',
      [email]
    );

    if (userResult.rows.length === 0) {
      return res.status(401).json({
        success: false,
        message: 'Email ou mot de passe incorrect'
      });
    }

    const user = userResult.rows[0];
    const isPasswordValid = await bcrypt.compare(password, user.password);

    if (isPasswordValid) {
      const token = jwt.sign(
        { userId: user.id, email: user.email },
        JWT_SECRET,
        { expiresIn: '24h' }
      );

      res.json({
        success: true,
        token: token,
        user: { id: user.id, email: user.email }
      });
    } else {
      res.status(401).json({
        success: false,
        message: 'Email ou mot de passe incorrect'
      });
    }
  } catch (error) {
    console.error('💥 Erreur lors du login:', error);
    res.status(500).json({
      success: false,
      message: 'Erreur serveur lors de la connexion',
      error: error.message
    });
  }
});

// =========================
// Routes Demandes RH - SIMPLIFIÉES
// =========================

// Route de test simple sans authentification d'abord
app.get('/api/test-demandes', async (req, res) => {
  try {
    console.log('🧪 Test simple des demandes RH');
    
    // Test direct sans filtres
    const result = await pool.query(`
      SELECT 
        dr.id,
        dr.type_demande,
        dr.statut,
        dr.titre,
        dr.created_at,
        e.nom as employe_nom,
        e.prenom as employe_prenom
      FROM demande_rh dr
      LEFT JOIN employees e ON dr.employe_id = e.id
      ORDER BY dr.created_at DESC
      LIMIT 10
    `);

    console.log(`✅ ${result.rows.length} demandes trouvées`);
    
    res.json({
      success: true,
      count: result.rows.length,
      demandes: result.rows
    });
    
  } catch (error) {
    console.error('❌ Erreur test demandes:', error);
    res.status(500).json({
      success: false,
      error: error.message,
      detail: error.detail
    });
  }
});

// Route debug sans authentification
app.get('/api/debug-demandes', async (req, res) => {
  try {
    console.log('🐛 Debug: Vérification table demande_rh');
    
    // 1. Compter les demandes
    const countResult = await pool.query('SELECT COUNT(*) as total FROM demande_rh');
    const total = parseInt(countResult.rows[0].total);
    
    // 2. Vérifier la structure de la table
    const structureResult = await pool.query(`
      SELECT column_name, data_type 
      FROM information_schema.columns 
      WHERE table_name = 'demande_rh' 
      ORDER BY ordinal_position
    `);
    
    // 3. Quelques exemples
    const sampleResult = await pool.query(`
      SELECT * FROM demande_rh 
      ORDER BY created_at DESC 
      LIMIT 3
    `);

    res.json({
      success: true,
      total_demandes: total,
      structure_table: structureResult.rows,
      echantillon: sampleResult.rows,
      message: total > 0 ? 
        `✅ ${total} demandes trouvées dans la table` : 
        '❌ Aucune demande dans la table'
    });
    
  } catch (error) {
    console.error('❌ Erreur debug:', error);
    res.status(500).json({
      success: false,
      error: error.message,
      detail: error.detail
    });
  }
});

// Route principale des demandes RH (avec auth)
app.get('/api/demandes-rh', authenticateToken, async (req, res) => {
  try {
    console.log('📋 Récupération des demandes RH');

    const { type, statut, dateDebut, dateFin } = req.query;
    
    let query = `
      SELECT 
        dr.*,
        e.nom as employe_nom,
        e.prenom as employe_prenom,
        e.matricule as employe_matricule,
        e.poste as employe_poste
      FROM demande_rh dr
      LEFT JOIN employees e ON dr.employe_id = e.id
      WHERE 1=1
    `;
    
    let params = [];
    let paramCount = 0;

    if (type) {
      paramCount++;
      query += ` AND dr.type_demande = $${paramCount}`;
      params.push(type);
    }

    if (statut) {
      paramCount++;
      query += ` AND dr.statut = $${paramCount}`;
      params.push(statut);
    }

    if (dateDebut) {
      paramCount++;
      query += ` AND dr.date_depart >= $${paramCount}`;
      params.push(dateDebut);
    }

    if (dateFin) {
      paramCount++;
      query += ` AND dr.date_depart <= $${paramCount}`;
      params.push(dateFin);
    }

    query += ' ORDER BY dr.created_at DESC';

    const result = await pool.query(query, params);
    console.log(`✅ ${result.rows.length} demandes RH récupérées`);

    res.json(result.rows);
    
  } catch (error) {
    console.error('❌ Erreur récupération demandes RH:', error);
    res.status(500).json({
      error: 'Erreur lors de la récupération des demandes RH',
      message: error.message
    });
  }
});

// =========================
// Routes Employés (existantes)
// =========================

app.get('/api/employees', authenticateToken, async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT * FROM employees 
      WHERE statut = 'actif' OR statut IS NULL
      ORDER BY nom, prenom
    `);
    res.json(result.rows);
  } catch (error) {
    console.error('❌ Erreur récupération employés:', error);
    res.status(500).json({ error: 'Erreur lors de la récupération des employés' });
  }
});

// ... autres routes employés existantes ...

// =========================
// Gestion des routes inexistantes pour l'API
// =========================

// Pour toutes les routes API non trouvées
app.use('/api/*', (req, res) => {
  res.status(404).json({
    error: 'Route API non trouvée',
    path: req.originalUrl
  });
});

// Pour les autres routes (SPA)
app.get('*', (req, res) => {
  res.json({
    message: 'API RH Manager',
    note: 'Cette route n\'existe pas dans l\'API',
    available_routes: [
      '/api/health',
      '/api/auth/login',
      '/api/employees',
      '/api/demandes-rh',
      '/api/test-demandes',
      '/api/debug-demandes'
    ]
  });
});

// =========================
// Gestion des erreurs
// =========================

app.use((err, req, res, next) => {
  console.error('💥 Erreur serveur:', err);
  res.status(500).json({
    error: 'Erreur interne du serveur',
    message: err.message
  });
});

// =========================
// DÉMARRAGE DU SERVEUR
// =========================

app.listen(PORT, '0.0.0.0', () => {
  console.log('\n' + '='.repeat(60));
  console.log('🚀 SERVEUR RH DÉMARRÉ');
  console.log('='.repeat(60));
  console.log(`📍 Port: ${PORT}`);
  console.log(`🌐 URL: http://localhost:${PORT}`);
  console.log(`🌍 ENV: ${process.env.NODE_ENV || 'development'}`);
  console.log('='.repeat(60) + '\n');
});

process.on('SIGINT', async () => {
  console.log('\n🛑 Arrêt du serveur...');
  await pool.end();
  process.exit(0);
});
