// server.js 
require('dotenv').config({ path: __dirname + '/.env' });

const express = require('express');
const cors = require('cors');
const { Pool } = require('pg');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const multer = require('multer');
const axios = require('axios');

const app = express();
const PORT = Number(process.env.PORT || 5000);

// Configuration multer pour l'upload de fichiers
const upload = multer();

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
  origin(origin, callback) {
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
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

// =========================
// Test connexion BDD
// =========================

pool.connect()
  .then((client) => {
    console.log('✅ Connexion à PostgreSQL réussie pour RH Application');
    return client.query('SELECT version(), current_database()');
  })
  .then((result) => {
    console.log('📊 Base de données:', result.rows[0]);
    pool.query('SELECT 1').then(() => console.log('✅ Pool PostgreSQL opérationnel'));
  })
  .catch((err) => {
    console.error('❌ ERREUR DE CONNEXION PostgreSQL:', err.message);
  });

// Gestion des erreurs de pool
pool.on('error', (err) => {
  console.error('❌ Erreur inattendue du pool PostgreSQL:', err);
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

  jwt.verify(token, process.env.JWT_SECRET || 'fallback_secret', (err, user) => {
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
    'FF6B6B', '4ECDC4', '45B7D1', '96CEB4', 'FFEAA7',
    'DDA0DD', '98D8C8', 'F7DC6F', 'BB8FCE', '85C1E9'
  ];
  const color = colors[Math.floor(Math.random() * colors.length)];
  return `https://ui-avatars.com/api/?name=${initiales}&background=${color}&color=fff&size=150`;
}

// =========================
// Test connexion GitHub
// =========================

const testGitHubConnection = async () => {
  try {
    const GITHUB_TOKEN = process.env.GITHUB_TOKEN;
    const GITHUB_OWNER = 'STS-Engineer';
    const GITHUB_REPO = 'rh-documents-repository';
    
    if (!GITHUB_TOKEN) {
      console.warn('⚠️ Token GitHub non configuré');
      return false;
    }

    const testUrl = `https://api.github.com/repos/${GITHUB_OWNER}/${GITHUB_REPO}`;
    
    const response = await axios.get(testUrl, {
      headers: {
        'Authorization': `token ${GITHUB_TOKEN}`,
        'User-Agent': 'RH-Manager-App'
      }
    });
    
    console.log('✅ Connexion GitHub réussie:', response.data.full_name);
    return true;
  } catch (error) {
    console.error('❌ Erreur connexion GitHub:', error.response?.data?.message || error.message);
    return false;
  }
};

// Tester la connexion GitHub au démarrage
setTimeout(testGitHubConnection, 2000);

// =========================
// ROUTES PRINCIPALES
// =========================

app.get('/', (req, res) => {
  res.json({
    message: '🚀 API RH Manager - Connecté à Azure PostgreSQL & GitHub',
    timestamp: new Date().toISOString(),
    environment: process.env.NODE_ENV || 'development'
  });
});

app.get('/api/health', async (req, res) => {
  try {
    const client = await pool.connect();
    const result = await client.query('SELECT version(), current_database()');
    client.release();

    const githubStatus = await testGitHubConnection();

    res.json({
      status: 'OK ✅',
      database: {
        connected: true,
        name: result.rows[0].current_database
      },
      github: {
        connected: githubStatus,
        repository: 'STS-Engineer/rh-documents-repository'
      },
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    console.error('❌ Health check échoué:', error.message);
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
    console.log('🔐 Tentative de login:', { email: req.body.email });

    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({
        success: false,
        message: 'Email et mot de passe requis'
      });
    }

    const client = await pool.connect();
    
    try {
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
      const isPasswordValid = await bcrypt.compare(password, user.password);

      if (isPasswordValid) {
        console.log('✅ Mot de passe correct');

        const token = jwt.sign(
          {
            userId: user.id,
            email: user.email
          },
          process.env.JWT_SECRET || 'fallback_secret',
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
    console.error('💥 Erreur lors du login:', error.message);
    res.status(500).json({
      success: false,
      message: 'Erreur serveur lors de la connexion',
      error: error.message
    });
  }
});

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

    const result = await pool.query('SELECT * FROM employees WHERE id = $1', [id]);

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Employé non trouvé' });
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
      matricule, nom, prenom, cin, passeport, date_naissance,
      poste, site_dep, type_contrat, date_debut, salaire_brute,
      photo, dossier_rh, date_depart
    } = req.body;

    let photoUrl = photo;
    if (photo && !isValidUrl(photo)) {
      photoUrl = getDefaultAvatar(nom, prenom);
    } else if (!photo) {
      photoUrl = getDefaultAvatar(nom, prenom);
    }

    const result = await pool.query(
      `UPDATE employees 
       SET matricule = $1, nom = $2, prenom = $3, cin = $4, passeport = $5,
           date_naissance = $6, poste = $7, site_dep = $8, type_contrat = $9,
           date_debut = $10, salaire_brute = $11, photo = $12, dossier_rh = $13,
           date_depart = $14, updated_at = CURRENT_TIMESTAMP
       WHERE id = $15 RETURNING *`,
      [
        matricule, nom, prenom, cin, passeport, date_naissance,
        poste, site_dep, type_contrat, date_debut, salaire_brute,
        photoUrl, dossier_rh, date_depart, id
      ]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Employé non trouvé' });
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

// =========================
// UPLOAD DOSSIER RH VERS GITHUB
// =========================

app.post('/api/employees/upload-dossier-rh', authenticateToken, upload.single('file'), async (req, res) => {
  try {
    const { employeeId, matricule } = req.body;
    const file = req.file;

    if (!file) {
      return res.status(400).json({ error: 'Aucun fichier fourni' });
    }

    console.log('📤 Upload dossier RH pour employé:', { matricule, employeeId, fileSize: file.size });

    // Configuration GitHub
    const GITHUB_TOKEN = process.env.GITHUB_TOKEN;
    const GITHUB_OWNER = 'STS-Engineer';
    const GITHUB_REPO = 'rh-documents-repository';
    
    if (!GITHUB_TOKEN) {
      throw new Error('Token GitHub non configuré. Veuillez configurer GITHUB_TOKEN dans les variables d\'environnement.');
    }

    // Préparer le fichier pour GitHub
    const filename = `dossier_rh_${matricule}_${Date.now()}.pdf`;
    const filePath = `pdf_rh/${filename}`;
    
    // Convertir le buffer en base64
    const fileContentBase64 = file.buffer.toString('base64');

    // URL de l'API GitHub
    const githubApiUrl = `https://api.github.com/repos/${GITHUB_OWNER}/${GITHUB_REPO}/contents/${filePath}`;

    // Préparer les données pour GitHub
    const githubData = {
      message: `📄 Ajout dossier RH - ${matricule} - ${new Date().toISOString().split('T')[0]}`,
      content: fileContentBase64,
      branch: 'main'
    };

    console.log('📁 Upload vers GitHub...', { filePath, size: fileContentBase64.length });

    // Upload vers GitHub
    const githubResponse = await axios.put(githubApiUrl, githubData, {
      headers: {
        'Authorization': `token ${GITHUB_TOKEN}`,
        'Content-Type': 'application/json',
        'User-Agent': 'RH-Manager-App'
      },
      timeout: 30000
    });

    if (githubResponse.status === 201 || githubResponse.status === 200) {
      // Construire l'URL raw du fichier (format demandé)
      const pdfUrl = `https://github.com/${GITHUB_OWNER}/${GITHUB_REPO}/raw/main/${filePath}`;
      
      console.log('✅ Fichier uploadé vers GitHub:', pdfUrl);

      // Mettre à jour l'employé avec le nouveau lien dans la colonne dossier_rh
      const updateResult = await pool.query(
        'UPDATE employees SET dossier_rh = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2 RETURNING *',
        [pdfUrl, employeeId]
      );

      if (updateResult.rows.length === 0) {
        throw new Error('Employé non trouvé lors de la mise à jour');
      }

      res.json({
        success: true,
        pdfUrl: pdfUrl,
        githubUrl: githubResponse.data.content.html_url,
        filename: filename,
        message: 'Dossier RH uploadé avec succès vers GitHub'
      });
    } else {
      throw new Error(`Erreur GitHub: ${githubResponse.status}`);
    }

  } catch (error) {
    console.error('❌ Erreur upload dossier RH:', error);
    
    let errorMessage = 'Erreur lors de l\'upload du dossier RH vers GitHub';
    
    if (error.response) {
      console.error('Détails erreur GitHub:', {
        status: error.response.status,
        data: error.response.data
      });
      
      if (error.response.status === 401) {
        errorMessage = 'Token GitHub invalide ou expiré';
      } else if (error.response.status === 403) {
        errorMessage = 'Accès refusé au repository GitHub';
      } else if (error.response.status === 404) {
        errorMessage = 'Repository GitHub non trouvé';
      } else {
        errorMessage = `Erreur GitHub: ${error.response.data?.message || error.response.status}`;
      }
    } else if (error.code === 'ECONNABORTED') {
      errorMessage = 'Timeout lors de l\'upload vers GitHub';
    } else {
      errorMessage += `: ${error.message}`;
    }

    res.status(500).json({
      success: false,
      error: errorMessage,
      details: error.response?.data
    });
  }
});

app.put('/api/employees/:id/archive', authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;
    const { entretien_depart } = req.body;

    console.log('📁 Archivage employé ID:', id);

    const result = await pool.query(
      `UPDATE employees 
       SET date_depart = CURRENT_DATE, 
           entretien_depart = $1,
           statut = 'archive',
           updated_at = CURRENT_TIMESTAMP
       WHERE id = $2 RETURNING *`,
      [entretien_depart, id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Employé non trouvé' });
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
      matricule, nom, prenom, cin, passeport, date_naissance,
      poste, site_dep, type_contrat, date_debut, salaire_brute,
      photo, dossier_rh
    } = req.body;

    if (!matricule || !nom || !prenom || !cin || !poste || !site_dep || !type_contrat || !date_debut || !salaire_brute) {
      return res.status(400).json({
        error: 'Tous les champs obligatoires doivent être remplis'
      });
    }

    let photoUrl = photo;
    if (!photoUrl) {
      photoUrl = `https://ui-avatars.com/api/?name=${prenom}+${nom}&background=3498db&color=fff&size=150`;
    }

    const result = await pool.query(
      `INSERT INTO employees 
       (matricule, nom, prenom, cin, passeport, date_naissance, poste, site_dep, type_contrat, date_debut, salaire_brute, photo, dossier_rh, statut) 
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, 'actif')
       RETURNING *`,
      [
        matricule, nom, prenom, cin, passeport || null, date_naissance,
        poste, site_dep, type_contrat, date_debut, parseFloat(salaire_brute),
        photoUrl, dossier_rh || null
      ]
    );

    console.log('✅ Employé créé, ID:', result.rows[0].id);
    res.json(result.rows[0]);
  } catch (error) {
    console.error('❌ Erreur création employé:', error);

    if (error.code === '23505') {
      if (error.constraint === 'employees_matricule_key') {
        res.status(400).json({ error: 'Le matricule existe déjà' });
      } else if (error.constraint === 'employees_cin_key') {
        res.status(400).json({ error: 'Le CIN existe déjà' });
      } else {
        res.status(400).json({ error: 'Violation de contrainte unique' });
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
// Routes Demandes RH (conservées)
// =========================

app.get('/api/demandes', authenticateToken, async (req, res) => {
  try {
    const { type_demande, statut, date_debut, date_fin, employe_id, page = 1, limit = 10 } = req.query;

    let query = `
      SELECT d.*, 
             e.nom as employe_nom, 
             e.prenom as employe_prenom,
             e.poste as employe_poste,
             e.photo as employe_photo,
             e.matricule as employe_matricule
      FROM demande_rh d
      LEFT JOIN employees e ON d.employe_id = e.id
      WHERE 1=1
    `;
    const params = [];
    let paramCount = 0;

    if (type_demande) {
      paramCount++;
      query += ` AND d.type_demande = $${paramCount}`;
      params.push(type_demande);
    }

    if (statut) {
      paramCount++;
      query += ` AND d.statut = $${paramCount}`;
      params.push(statut);
    }

    if (employe_id) {
      paramCount++;
      query += ` AND d.employe_id = $${paramCount}`;
      params.push(employe_id);
    }

    query += ` ORDER BY d.created_at DESC LIMIT $${paramCount + 1} OFFSET $${paramCount + 2}`;
    params.push(parseInt(limit), (parseInt(page) - 1) * parseInt(limit));

    const result = await pool.query(query, params);

    // Count pour la pagination
    let countQuery = `SELECT COUNT(*) FROM demande_rh d WHERE 1=1`;
    const countParams = [];
    let countParamCount = 0;

    if (type_demande) {
      countParamCount++;
      countQuery += ` AND d.type_demande = $${countParamCount}`;
      countParams.push(type_demande);
    }

    if (statut) {
      countParamCount++;
      countQuery += ` AND d.statut = $${countParamCount}`;
      countParams.push(statut);
    }

    const countResult = await pool.query(countQuery, countParams);
    const total = parseInt(countResult.rows[0].count);

    console.log(`✅ ${result.rows.length} demandes récupérées`);
    res.json({
      demandes: result.rows,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total,
        pages: Math.ceil(total / limit)
      }
    });
  } catch (error) {
    console.error('❌ Erreur récupération demandes:', error);
    res.status(500).json({ 
      error: 'Erreur lors de la récupération des demandes',
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
  console.log('🚀 SERVEUR RH DÉMARRÉ - AVEC UPLOAD GITHUB');
  console.log('='.repeat(60));
  console.log(`📍 Port: ${PORT}`);
  console.log(`🌐 URL: http://localhost:${PORT}`);
  console.log(`🗄️  Base: ${process.env.DB_NAME} @ ${process.env.DB_HOST}`);
  console.log(`🔐 JWT: ${process.env.JWT_SECRET ? '✅' : '⚠️'}`);
  console.log(`🐙 GitHub: ${process.env.GITHUB_TOKEN ? '✅ Token configuré' : '⚠️ Token manquant'}`);
  console.log(`📁 Repository: STS-Engineer/rh-documents-repository`);
  console.log(`📄 Dossier PDF: pdf_rh/`);
  console.log('='.repeat(60) + '\n');
});

process.on('SIGINT', async () => {
  console.log('\n🛑 Arrêt du serveur...');
  await pool.end();
  process.exit(0);
});
