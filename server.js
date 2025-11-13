// server.js
require('dotenv').config({ path: __dirname + '/.env' });

const express = require('express');
const cors = require('cors');
const { Pool } = require('pg');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');

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
  connectionTimeoutMillis: 10000, // 10 secondes
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

// =========================
// Logs de configuration
// =========================

console.log('🔧 Variables d\'environnement:', {
  DB_USER: process.env.DB_USER || '❌ Manquant',
  DB_HOST: process.env.DB_HOST || '❌ Manquant',
  DB_NAME: process.env.DB_NAME || '❌ Manquant',
  DB_PORT: process.env.DB_PORT || '5432 (défaut)',
  JWT_SECRET: process.env.JWT_SECRET ? '✅ Défini' : '❌ Manquant',
  FRONTEND_URL: process.env.FRONTEND_URL || '❌ Non défini',
  NODE_ENV: process.env.NODE_ENV || 'development'
});

// Vérification et définition de JWT_SECRET
const JWT_SECRET =
  process.env.JWT_SECRET || 'fallback_secret_pour_development_seulement_2024';

if (!process.env.JWT_SECRET) {
  console.warn(
    '⚠️  JWT_SECRET non défini dans .env - utilisation d\'un secret de développement'
  );
}

// =========================
// Middleware globaux
// =========================

// Gestion CORS (local + Azure)
const allowedOrigins = [
  'http://localhost:3000',
  'https://avo-hr-managment.azurewebsites.net'
];

if (process.env.FRONTEND_URL && !allowedOrigins.includes(process.env.FRONTEND_URL)) {
  allowedOrigins.push(process.env.FRONTEND_URL);
}

const corsOptions = {
  origin(origin, callback) {
    // Autoriser les outils sans header Origin (Postman, curl…)
    if (!origin) return callback(null, true);

    if (allowedOrigins.includes(origin)) {
      return callback(null, true);
    } else {
      console.warn('🚫 Origin non autorisée par CORS:', origin);
      return callback(null, false);
    }
  },
  credentials: true
};

app.use(cors(corsOptions));
app.options('*', cors(corsOptions));
app.use(express.json());

// =========================
// Test connexion BDD
// =========================

pool
  .connect()
  .then((client) => {
    console.log('✅ Connexion à PostgreSQL réussie pour RH Application');
    return client.query('SELECT version(), current_database()');
  })
  .then((result) => {
    console.log('📊 Base de données:', result.rows[0]);
    pool.query('SELECT 1').then(() => console.log('✅ Pool PostgreSQL opérationnel'));
  })
  .catch((err) => {
    console.error('❌ ERREUR DE CONNEXION PostgreSQL:', {
      message: err.message,
      code: err.code,
      host: process.env.DB_HOST,
      port: process.env.DB_PORT,
      stack: err.stack
    });
  });

// Gestion des erreurs de pool
pool.on('error', (err) => {
  console.error('❌ Erreur inattendue du pool PostgreSQL:', err);
});

// =========================
// ROUTES RH
// =========================

// Route racine
app.get('/', (req, res) => {
  res.json({
    message: '🚀 API RH Manager - Connecté à Azure PostgreSQL',
    timestamp: new Date().toISOString(),
    database: 'Azure PostgreSQL',
    environment: process.env.NODE_ENV || 'development',
    endpoints: [
      'GET  /api/health',
      'POST /api/auth/login',
      'GET  /api/employees',
      'GET  /api/employees/archives',
      'GET  /api/employees/search?q=nom',
      'PUT  /api/employees/:id',
      'PUT  /api/employees/:id/archive',
      'POST /api/employees',
      'GET  /api/demandes-rh',
      'GET  /api/debug/demandes-rh'
    ]
  });
});

// Route de santé
app.get('/api/health', async (req, res) => {
  try {
    console.log('🏥 Health check - Tentative de connexion à la base...');
    
    const client = await pool.connect();
    console.log('✅ Client connecté');
    
    const result = await client.query('SELECT version(), current_database()');
    client.release();
    
    console.log('✅ Requête exécutée avec succès');

    res.json({
      status: 'OK ✅',
      message: 'Backend RH opérationnel',
      database: {
        connected: true,
        version: result.rows[0].version,
        name: result.rows[0].current_database,
        host: process.env.DB_HOST,
        port: process.env.DB_PORT
      },
      jwt: process.env.JWT_SECRET ? 'Configuré' : 'Utilisation fallback',
      environment: process.env.NODE_ENV || 'development',
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    console.error('❌ Health check échoué:', {
      message: error.message,
      code: error.code,
      stack: error.stack
    });
    
    res.status(500).json({
      status: 'Error',
      message: 'Erreur base de données',
      error: error.message,
      code: error.code,
      details: {
        host: process.env.DB_HOST,
        port: process.env.DB_PORT,
        database: process.env.DB_NAME
      }
    });
  }
});

// =========================
// Authentification
// =========================

app.post('/api/auth/login', async (req, res) => {
  try {
    console.log('🔐 Tentative de login:', { email: req.body.email });

    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({
        success: false,
        message: 'Email et mot de passe requis'
      });
    }

    // Vérifier la connexion à la base
    const client = await pool.connect();
    console.log('✅ Connexion pool établie pour login');

    try {
      // Rechercher l'utilisateur
      const userResult = await client.query(
        'SELECT * FROM users WHERE email = $1',
        [email]
      );

      if (userResult.rows.length === 0) {
        console.log('❌ Utilisateur non trouvé:', email);
        return res.status(401).json({
          success: false,
          message: 'Email ou mot de passe incorrect'
        });
      }

      const user = userResult.rows[0];
      console.log('👤 Utilisateur trouvé:', user.email);

      // Vérifier le mot de passe
      const isPasswordValid = await bcrypt.compare(password, user.password);

      if (isPasswordValid) {
        console.log('✅ Mot de passe correct');

        const token = jwt.sign(
          {
            userId: user.id,
            email: user.email
          },
          JWT_SECRET,
          { expiresIn: '24h' }
        );

        res.json({
          success: true,
          token: token,
          user: {
            id: user.id,
            email: user.email
          }
        });
      } else {
        console.log('❌ Mot de passe incorrect');
        res.status(401).json({
          success: false,
          message: 'Email ou mot de passe incorrect'
        });
      }
    } finally {
      client.release();
    }
  } catch (error) {
    console.error('💥 Erreur lors du login:', {
      message: error.message,
      code: error.code,
      stack: error.stack
    });

    res.status(500).json({
      success: false,
      message: 'Erreur serveur lors de la connexion',
      error: error.message
    });
  }
});

// =========================
// Middleware d'authentification
// =========================

const authenticateToken = (req, res, next) => {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];

  if (token == null) {
    return res.sendStatus(401);
  }

  jwt.verify(token, JWT_SECRET, (err, user) => {
    if (err) {
      return res.sendStatus(403);
    }
    req.user = user;
    next();
  });
};

// =========================
// Fonctions utilitaires
// =========================

function isValidUrl(string) {
  try {
    new URL(string);
    return true;
  } catch (_) {
    return false;
  }
}

function getDefaultAvatar(nom, prenom) {
  const initiales = (prenom.charAt(0) + nom.charAt(0)).toUpperCase();
  const colors = [
    'FF6B6B',
    '4ECDC4',
    '45B7D1',
    '96CEB4',
    'FFEAA7',
    'DDA0DD',
    '98D8C8',
    'F7DC6F',
    'BB8FCE',
    '85C1E9'
  ];
  const color = colors[Math.floor(Math.random() * colors.length)];

  return `https://ui-avatars.com/api/?name=${initiales}&background=${color}&color=fff&size=150`;
}

// =========================
// Routes Employés
// =========================

app.get('/api/employees', authenticateToken, async (req, res) => {
  try {
    console.log('👥 Récupération des employés actifs');

    const result = await pool.query(`
      SELECT * FROM employees 
      WHERE statut = 'actif' OR statut IS NULL
      ORDER BY nom, prenom
    `);

    console.log(`✅ ${result.rows.length} employés actifs récupérés`);
    res.json(result.rows);
  } catch (error) {
    console.error('❌ Erreur récupération employés:', error);
    res.status(500).json({
      error: 'Erreur lors de la récupération des employés',
      message: error.message
    });
  }
});

app.get('/api/employees/archives', authenticateToken, async (req, res) => {
  try {
    console.log('📁 Récupération des employés archivés');

    const result = await pool.query(`
      SELECT * FROM employees 
      WHERE statut = 'archive'
      ORDER BY date_depart DESC, nom, prenom
    `);

    console.log(`✅ ${result.rows.length} employés archivés récupérés`);
    res.json(result.rows);
  } catch (error) {
    console.error('❌ Erreur récupération archives:', error);
    res.status(500).json({
      error: 'Erreur lors de la récupération des archives',
      message: error.message
    });
  }
});

app.get('/api/employees/search', authenticateToken, async (req, res) => {
  try {
    const { q, statut = 'actif' } = req.query;
    console.log('🔍 Recherche employés:', { q, statut });

    let query = 'SELECT * FROM employees WHERE ';
    let params = [];

    if (statut === 'archive') {
      query += 'statut = $1';
      params.push('archive');
    } else {
      query += '(statut = $1 OR statut IS NULL)';
      params.push('actif');
    }

    if (q) {
      query += ' AND (nom ILIKE $2 OR prenom ILIKE $2 OR poste ILIKE $2)';
      params.push(`%${q}%`);
    }

    query += ' ORDER BY nom, prenom';

    const result = await pool.query(query, params);

    console.log(`✅ ${result.rows.length} employés trouvés`);
    res.json(result.rows);
  } catch (error) {
    console.error('❌ Erreur recherche employés:', error);
    res.status(500).json({
      error: 'Erreur lors de la recherche',
      message: error.message
    });
  }
});

app.get('/api/employees/:id', authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;
    console.log('👤 Récupération employé ID:', id);

    const result = await pool.query('SELECT * FROM employees WHERE id = $1', [
      id
    ]);

    if (result.rows.length === 0) {
      return res.status(404).json({
        error: 'Employé non trouvé'
      });
    }

    res.json(result.rows[0]);
  } catch (error) {
    console.error('❌ Erreur récupération employé:', error);
    res.status(500).json({
      error: "Erreur lors de la récupération de l'employé",
      message: error.message
    });
  }
});

app.put('/api/employees/:id', authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;
    console.log('✏️ Mise à jour employé ID:', id);

    const {
      matricule,
      nom,
      prenom,
      cin,
      passeport,
      date_naissance,
      poste,
      site_dep,
      type_contrat,
      date_debut,
      salaire_brute,
      photo,
      dossier_rh,
      date_depart
    } = req.body;

    let photoUrl = photo;
    if (photo && !isValidUrl(photo)) {
      photoUrl = getDefaultAvatar(nom, prenom);
    } else if (!photo) {
      photoUrl = getDefaultAvatar(nom, prenom);
    }

    const result = await pool.query(
      `
      UPDATE employees 
      SET matricule = $1, nom = $2, prenom = $3, cin = $4, passeport = $5,
          date_naissance = $6, poste = $7, site_dep = $8, type_contrat = $9,
          date_debut = $10, salaire_brute = $11, photo = $12, dossier_rh = $13,
          date_depart = $14, updated_at = CURRENT_TIMESTAMP
      WHERE id = $15
      RETURNING *
    `,
      [
        matricule,
        nom,
        prenom,
        cin,
        passeport,
        date_naissance,
        poste,
        site_dep,
        type_contrat,
        date_debut,
        salaire_brute,
        photoUrl,
        dossier_rh,
        date_depart,
        id
      ]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({
        error: 'Employé non trouvé'
      });
    }

    console.log('✅ Employé mis à jour');
    res.json(result.rows[0]);
  } catch (error) {
    console.error('❌ Erreur mise à jour employé:', error);
    res.status(500).json({
      error: "Erreur lors de la mise à jour de l'employé",
      message: error.message
    });
  }
});

app.put('/api/employees/:id/archive', authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;
    const { entretien_depart } = req.body;

    console.log('📁 Archivage employé ID:', id);

    const result = await pool.query(
      `
      UPDATE employees 
      SET date_depart = CURRENT_DATE, 
          entretien_depart = $1,
          statut = 'archive',
          updated_at = CURRENT_TIMESTAMP
      WHERE id = $2
      RETURNING *
    `,
      [entretien_depart, id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({
        error: 'Employé non trouvé'
      });
    }

    console.log('✅ Employé archivé');
    res.json(result.rows[0]);
  } catch (error) {
    console.error("❌ Erreur archivage:", error);
    res.status(500).json({
      error: "Erreur lors de l'archivage de l'employé",
      message: error.message
    });
  }
});

app.post('/api/employees', authenticateToken, async (req, res) => {
  try {
    console.log('➕ Création nouvel employé');

    const {
      matricule,
      nom,
      prenom,
      cin,
      passeport,
      date_naissance,
      poste,
      site_dep,
      type_contrat,
      date_debut,
      salaire_brute,
      photo,
      dossier_rh
    } = req.body;

    if (
      !matricule ||
      !nom ||
      !prenom ||
      !cin ||
      !poste ||
      !site_dep ||
      !type_contrat ||
      !date_debut ||
      !salaire_brute
    ) {
      return res.status(400).json({
        error: 'Tous les champs obligatoires doivent être remplis'
      });
    }

    let photoUrl = photo;
    if (!photoUrl) {
      photoUrl = `https://ui-avatars.com/api/?name=${prenom}+${nom}&background=3498db&color=fff&size=150`;
    }

    const result = await pool.query(
      `
      INSERT INTO employees 
      (matricule, nom, prenom, cin, passeport, date_naissance, poste, site_dep, type_contrat, date_debut, salaire_brute, photo, dossier_rh, statut) 
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, 'actif')
      RETURNING *
    `,
      [
        matricule,
        nom,
        prenom,
        cin,
        passeport || null,
        date_naissance,
        poste,
        site_dep,
        type_contrat,
        date_debut,
        parseFloat(salaire_brute),
        photoUrl,
        dossier_rh || null
      ]
    );

    console.log('✅ Employé créé, ID:', result.rows[0].id);
    res.json(result.rows[0]);
  } catch (error) {
    console.error('❌ Erreur création employé:', error);

    if (error.code === '23505') {
      if (error.constraint === 'employees_matricule_key') {
        res.status(400).json({
          error: 'Le matricule existe déjà'
        });
      } else if (error.constraint === 'employees_cin_key') {
        res.status(400).json({
          error: 'Le CIN existe déjà'
        });
      } else {
        res.status(400).json({
          error: 'Violation de contrainte unique'
        });
      }
    } else {
      res.status(500).json({
        error: "Erreur lors de la création de l'employé",
        message: error.message
      });
    }
  }
});

// =========================
// Routes Demandes RH
// =========================

app.get('/api/demandes-rh', authenticateToken, async (req, res) => {
  try {
    console.log('📋 Récupération des demandes RH - Query params:', req.query);

    const { type, statut, dateDebut, dateFin } = req.query;
    
    let query = `
      SELECT dr.*, 
             e.nom as employe_nom, 
             e.prenom as employe_prenom,
             e.matricule as employe_matricule
      FROM demande_rh dr
      LEFT JOIN employees e ON dr.employe_id = e.id
      WHERE 1=1
    `;
    let params = [];
    let paramCount = 0;

    // Filtres
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

    // Tri par date de création (les plus récents en premier)
    query += ' ORDER BY dr.created_at DESC';

    console.log('📝 Requête SQL:', query);
    console.log('📝 Paramètres:', params);

    const result = await pool.query(query, params);

    console.log(`✅ ${result.rows.length} demandes RH récupérées`);
    
    // Log les premières demandes pour vérification
    if (result.rows.length > 0) {
      console.log('📄 Exemple de demandes:', result.rows.slice(0, 2));
    }

    res.json(result.rows);
  } catch (error) {
    console.error('❌ Erreur récupération demandes RH:', error);
    res.status(500).json({
      error: 'Erreur lors de la récupération des demandes RH',
      message: error.message,
      details: error.detail
    });
  }
});

// Route de debug pour vérifier les données demande_rh
app.get('/api/debug/demandes-rh', authenticateToken, async (req, res) => {
  try {
    console.log('🐛 Debug: Vérification directe table demande_rh');
    
    // Test 1: Compter le nombre total de demandes
    const countResult = await pool.query('SELECT COUNT(*) as total FROM demande_rh');
    console.log('📊 Total demandes dans la table:', countResult.rows[0].total);
    
    // Test 2: Récupérer quelques demandes avec toutes les colonnes
    const sampleResult = await pool.query(`
      SELECT * FROM demande_rh 
      ORDER BY created_at DESC 
      LIMIT 5
    `);
    
    console.log('📄 Échantillon de demandes:', JSON.stringify(sampleResult.rows, null, 2));
    
    // Test 3: Vérifier la jointure avec employees
    const joinResult = await pool.query(`
      SELECT 
        dr.id,
        dr.type_demande,
        dr.statut,
        dr.titre,
        e.nom as employe_nom,
        e.prenom as employe_prenom
      FROM demande_rh dr
      LEFT JOIN employees e ON dr.employe_id = e.id
      LIMIT 5
    `);
    
    console.log('🔗 Test jointure:', JSON.stringify(joinResult.rows, null, 2));

    res.json({
      total_demandes: parseInt(countResult.rows[0].total),
      echantillon: sampleResult.rows,
      jointure_test: joinResult.rows,
      message: `✅ Debug réussi - ${countResult.rows[0].total} demandes trouvées`
    });
    
  } catch (error) {
    console.error('❌ Erreur debug demandes RH:', error);
    res.status(500).json({
      error: 'Erreur debug',
      message: error.message,
      detail: error.detail
    });
  }
});

app.get('/api/demandes-rh/:id', authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;
    console.log('📋 Récupération demande RH ID:', id);

    const result = await pool.query(
      `SELECT dr.*, 
              e.nom as employe_nom, 
              e.prenom as employe_prenom,
              e.matricule as employe_matricule,
              e.poste as employe_poste
       FROM demande_rh dr
       LEFT JOIN employees e ON dr.employe_id = e.id
       WHERE dr.id = $1`,
      [id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({
        error: 'Demande RH non trouvée'
      });
    }

    res.json(result.rows[0]);
  } catch (error) {
    console.error('❌ Erreur récupération demande RH:', error);
    res.status(500).json({
      error: 'Erreur lors de la récupération de la demande RH',
      message: error.message
    });
  }
});

// =========================
// Routes fallback & erreurs
// =========================

app.use('*', (req, res) => {
  res.status(404).json({
    error: 'Route non trouvée',
    path: req.originalUrl
  });
});

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

app.listen(PORT, () => {
  console.log('\n' + '='.repeat(60));
  console.log('🚀 SERVEUR RH DÉMARRÉ');
  console.log('='.repeat(60));
  console.log(`📍 Port: ${PORT}`);
  console.log(`🌐 URL: http://localhost:${PORT}`);
  console.log(`🗄️  Base: ${process.env.DB_NAME} @ ${process.env.DB_HOST}`);
  console.log(`🔐 JWT: ${process.env.JWT_SECRET ? '✅' : '⚠️'}`);
  console.log(`🌍 ENV: ${process.env.NODE_ENV || 'development'}`);
  console.log('='.repeat(60) + '\n');
});

process.on('SIGINT', async () => {
  console.log('\n🛑 Arrêt du serveur...');
  await pool.end();
  process.exit(0);
});
