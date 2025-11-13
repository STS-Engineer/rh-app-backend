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

const pool = new Pool({
  user: process.env.DB_USER,
  host: process.env.DB_HOST,
  database: process.env.DB_NAME,
  password: process.env.DB_PASSWORD,
  port: Number(process.env.DB_PORT || 5432),
  ssl: { require: true, rejectUnauthorized: false } // Azure PostgreSQL
});

// =========================
// Logs de configuration
// =========================

console.log('🔧 Configuration vérifiée:', {
  DB_USER: process.env.DB_USER,
  DB_HOST: process.env.DB_HOST,
  DB_NAME: process.env.DB_NAME,
  JWT_SECRET: process.env.JWT_SECRET ? '✅ Défini' : '❌ Manquant',
  FRONTEND_URL: process.env.FRONTEND_URL || '❌ Non défini'
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
const allowedOrigins = ['https://avo-hr-managment.azurewebsites.net/'];

if (process.env.FRONTEND_URL) {
  allowedOrigins.push(process.env.FRONTEND_URL);
}

app.use(
  cors({
    origin: function (origin, callback) {
      // Autoriser les outils sans header Origin (Postman, curl…)
      if (!origin) return callback(null, true);

      if (allowedOrigins.includes(origin)) {
        return callback(null, true);
      } else {
        console.warn('🚫 Origin non autorisée par CORS:', origin);
        return callback(new Error('Not allowed by CORS'));
      }
    },
    credentials: true
  })
);

app.use(express.json());

// =========================
// Test connexion BDD
// =========================

pool
  .connect()
  .then((client) => {
    console.log('✅ Connexion à PostgreSQL réussie pour RH Application');
    client.release();
  })
  .catch((err) => {
    console.error('❌ Erreur de connexion à PostgreSQL:', err);
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
    endpoints: [
      'GET  /api/health',
      'POST /api/auth/login',
      'GET  /api/employees',
      'GET  /api/employees/archives',
      'GET  /api/employees/search?q=nom',
      'PUT  /api/employees/:id',
      'PUT  /api/employees/:id/archive'
    ]
  });
});

// Route de santé
app.get('/api/health', async (req, res) => {
  try {
    const client = await pool.connect();
    const result = await client.query('SELECT version(), current_database()');
    client.release();

    res.json({
      status: 'OK ✅',
      message: 'Backend RH opérationnel',
      database: {
        connected: true,
        version: result.rows[0].version,
        name: result.rows[0].current_database
      },
      jwt: process.env.JWT_SECRET ? 'Configuré' : 'Utilisation fallback',
      timestamp: new Date().toISOString()
    });
  } catch (error) {
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

// Route de login avec vérification en base de données
app.post('/api/auth/login', async (req, res) => {
  try {
    console.log('🔐 Tentative de login:', req.body);

    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({
        success: false,
        message: 'Email et mot de passe requis'
      });
    }

    // Rechercher l'utilisateur dans la base de données
    const userResult = await pool.query('SELECT * FROM users WHERE email = $1', [
      email
    ]);

    if (userResult.rows.length === 0) {
      console.log('❌ Utilisateur non trouvé:', email);
      return res.status(401).json({
        success: false,
        message: 'Email ou mot de passe incorrect'
      });
    }

    const user = userResult.rows[0];
    console.log('👤 Utilisateur trouvé dans la base:', user.email);

    // Vérifier le mot de passe
    const isPasswordValid = await bcrypt.compare(password, user.password);

    if (isPasswordValid) {
      console.log('✅ Mot de passe correct');

      // Vérifier que JWT_SECRET est disponible
      if (!JWT_SECRET) {
        throw new Error('JWT_SECRET non configuré');
      }

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
  } catch (error) {
    console.error('💥 Erreur lors du login:', error.message);

    if (error.message.includes('JWT_SECRET')) {
      res.status(500).json({
        success: false,
        message: 'Erreur de configuration serveur - JWT non configuré'
      });
    } else {
      res.status(500).json({
        success: false,
        message: 'Erreur serveur lors de la connexion'
      });
    }
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

// Valider les URLs
function isValidUrl(string) {
  try {
    new URL(string);
    return true;
  } catch (_) {
    return false;
  }
}

// Générer des avatars par défaut basés sur les initiales
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

// Récupérer tous les employés actifs
app.get('/api/employees', authenticateToken, async (req, res) => {
  try {
    console.log('👥 Récupération des employés actifs depuis la base de données');

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

// Récupérer les employés archivés
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

// Recherche d'employés avec filtre de statut
app.get('/api/employees/search', authenticateToken, async (req, res) => {
  try {
    const { q, statut = 'actif' } = req.query;
    console.log('🔍 Recherche employés avec terme:', q, 'statut:', statut);

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

    console.log(`✅ ${result.rows.length} employés trouvés pour "${q}"`);
    res.json(result.rows);
  } catch (error) {
    console.error('❌ Erreur recherche employés:', error);
    res.status(500).json({
      error: 'Erreur lors de la recherche',
      message: error.message
    });
  }
});

// Récupérer un employé spécifique
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

// Mettre à jour un employé
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

    // Validation de l'URL de la photo
    let photoUrl = photo;
    if (photo && !isValidUrl(photo)) {
      // Si ce n'est pas une URL valide, utiliser une image par défaut
      photoUrl = getDefaultAvatar(nom, prenom);
    } else if (!photo) {
      // Si aucune photo n'est fournie, utiliser l'avatar par défaut
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

    console.log('✅ Employé mis à jour avec succès');
    res.json(result.rows[0]);
  } catch (error) {
    console.error('❌ Erreur mise à jour employé:', error);
    res.status(500).json({
      error: "Erreur lors de la mise à jour de l'employé",
      message: error.message
    });
  }
});

// Archiver un employé
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

    console.log('✅ Employé archivé avec succès');
    res.json(result.rows[0]);
  } catch (error) {
    console.error("❌ Erreur archivage employé:", error);
    res.status(500).json({
      error: "Erreur lors de l'archivage de l'employé",
      message: error.message
    });
  }
});

// Créer un nouvel employé
app.post('/api/employees', authenticateToken, async (req, res) => {
  try {
    console.log('➕ Création nouvel employé:', req.body);

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

    // Validation des champs requis
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

    // Générer une photo par défaut si non fournie
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

    console.log('✅ Nouvel employé créé avec ID:', result.rows[0].id);
    res.json(result.rows[0]);
  } catch (error) {
    console.error('❌ Erreur création employé:', error);

    if (error.code === '23505') {
      // Violation de contrainte unique
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
// Routes fallback & erreurs
// =========================

// Route de fallback
app.use('*', (req, res) => {
  console.log('❌ Route non trouvée:', req.originalUrl);
  res.status(404).json({
    error: 'Route non trouvée',
    path: req.originalUrl,
    availableEndpoints: [
      'GET /',
      'GET /api/health',
      'POST /api/auth/login',
      'GET /api/employees',
      'GET /api/employees/archives',
      'GET /api/employees/search?q=nom',
      'PUT /api/employees/:id',
      'PUT /api/employees/:id/archive'
    ]
  });
});

// Gestionnaire d'erreurs global
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
  console.log('🚀 SERVEUR RH DÉMARRÉ AVEC SUCCÈS!');
  console.log('='.repeat(60));
  console.log(`📍 Port: ${PORT}`);
  console.log(`🌐 URL: http://localhost:${PORT}`);
  console.log(`🗄️  Base: ${process.env.DB_NAME}`);
  console.log(`🔐 JWT: ${process.env.JWT_SECRET ? '✅ Configuré' : '⚠️  Fallback'}`);
  console.log('');
  console.log('📋 ENDPOINTS DISPONIBLES:');
  console.log(`   ✅ GET  http://localhost:${PORT}/`);
  console.log(`   ✅ GET  http://localhost:${PORT}/api/health`);
  console.log(`   ✅ POST http://localhost:${PORT}/api/auth/login`);
  console.log(`   ✅ GET  http://localhost:${PORT}/api/employees`);
  console.log(`   ✅ GET  http://localhost:${PORT}/api/employees/archives`);
  console.log(`   ✅ PUT  http://localhost:${PORT}/api/employees/:id`);
  console.log(`   ✅ PUT  http://localhost:${PORT}/api/employees/:id/archive`);
  console.log('='.repeat(60) + '\n');
});

// Gestion de la fermeture propre
process.on('SIGINT', async () => {
  console.log('\n🛑 Arrêt du serveur RH...');
  await pool.end();
  process.exit(0);
});
