// server.js 
require('dotenv').config({ path: __dirname + '/.env' });

const express = require('express');
const cors = require('cors');
const { Pool } = require('pg');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const multer = require('multer');
const path = require('path');
const fs = require('fs');

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

const JWT_SECRET =
  process.env.JWT_SECRET || 'fallback_secret_pour_development_seulement_2024';

if (!process.env.JWT_SECRET) {
  console.warn(
    '⚠️  JWT_SECRET non défini dans .env - utilisation d\'un secret de développement'
  );
}

// =========================
// Configuration Upload & Dossier Public
// =========================

// Créer le dossier public s'il n'existe pas (pour Azure)
const publicDir = path.join(__dirname, 'public');
if (!fs.existsSync(publicDir)) {
  fs.mkdirSync(publicDir, { recursive: true });
  console.log('📁 Dossier public créé:', publicDir);
} else {
  console.log('📁 Dossier public existant:', publicDir);
}

// Configuration Multer pour l'upload
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, publicDir);
  },
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    const ext = path.extname(file.originalname);
    const sanitizedName = file.originalname
      .replace(ext, '')
      .replace(/[^a-zA-Z0-9]/g, '-')
      .substring(0, 50);
    cb(null, `dossier-rh-${sanitizedName}-${uniqueSuffix}${ext}`);
  }
});

const upload = multer({
  storage: storage,
  limits: { fileSize: 10 * 1024 * 1024 }, // 10MB max
  fileFilter: (req, file, cb) => {
    console.log('📎 Fichier reçu:', {
      originalname: file.originalname,
      mimetype: file.mimetype,
      size: file.size
    });

    const allowedTypes = [
      'application/pdf',
      'image/jpeg',
      'image/jpg',
      'image/png',
      'image/gif'
    ];
    
    if (allowedTypes.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error('Type de fichier non autorisé. Utilisez PDF, JPG, PNG ou GIF.'));
    }
  }
});

// =========================
// Middleware globaux
// =========================

// Gestion CORS (Azure)
const allowedOrigins = [
  'http://localhost:3000',
  'https://avo-hr-managment.azurewebsites.net',
  process.env.FRONTEND_URL
].filter(Boolean);

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
app.use(express.json());

// Servir les fichiers statiques du dossier public
app.use('/public', express.static(publicDir, {
  setHeaders: (res, filePath) => {
    if (filePath.endsWith('.pdf')) {
      res.set('Content-Type', 'application/pdf');
    }
  }
}));
console.log('🌐 Fichiers statiques servis depuis /public');

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
      'GET  /api/employees/:id',
      'PUT  /api/employees/:id',
      'POST /api/employees/:id/upload-dossier',
      'PUT  /api/employees/:id/archive',
      'POST /api/employees',
      'GET  /api/demandes',
      'GET  /api/demandes/:id',
      'POST /api/demandes',
      'PUT  /api/demandes/:id',
      'PUT  /api/demandes/:id/statut',
      'DELETE /api/demandes/:id'
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
      upload: {
        publicDir: publicDir,
        exists: fs.existsSync(publicDir)
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

    const client = await pool.connect();
    console.log('✅ Connexion pool établie pour login');

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
      console.log('👤 Utilisateur trouvé:', user.email);

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

// =========================
// NOUVELLE ROUTE: Upload Dossier RH
// =========================

app.post('/api/employees/:id/upload-dossier', authenticateToken, upload.single('dossier'), async (req, res) => {
  try {
    const { id } = req.params;
    
    if (!req.file) {
      console.log('❌ Aucun fichier reçu');
      return res.status(400).json({ error: 'Aucun fichier reçu' });
    }

    console.log('📤 Upload dossier RH pour employé ID:', id);
    console.log('📄 Fichier uploadé:', {
      filename: req.file.filename,
      originalname: req.file.originalname,
      mimetype: req.file.mimetype,
      size: req.file.size,
      path: req.file.path
    });

    // Construire le chemin relatif pour la base de données
    const dossierPath = `/public/${req.file.filename}`;
    
    console.log('💾 Chemin à enregistrer dans la BDD:', dossierPath);

    // Vérifier si l'employé existe
    const checkEmployee = await pool.query('SELECT id, dossier_rh FROM employees WHERE id = $1', [id]);
    
    if (checkEmployee.rows.length === 0) {
      // Supprimer le fichier uploadé si l'employé n'existe pas
      fs.unlinkSync(req.file.path);
      console.log('❌ Employé non trouvé, fichier supprimé');
      return res.status(404).json({ error: 'Employé non trouvé' });
    }

    // Supprimer l'ancien fichier s'il existe
    const oldDossier = checkEmployee.rows[0].dossier_rh;
    if (oldDossier && oldDossier.startsWith('/public/')) {
      const oldFilePath = path.join(__dirname, oldDossier);
      if (fs.existsSync(oldFilePath)) {
        try {
          fs.unlinkSync(oldFilePath);
          console.log('🗑️ Ancien fichier supprimé:', oldFilePath);
        } catch (err) {
          console.warn('⚠️ Erreur lors de la suppression de l\'ancien fichier:', err.message);
        }
      }
    }

    // Mettre à jour la base de données
    const result = await pool.query(
      'UPDATE employees SET dossier_rh = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2 RETURNING *',
      [dossierPath, id]
    );

    console.log('✅ Dossier RH uploadé et enregistré avec succès');
    
    res.json({
      success: true,
      message: 'Dossier RH uploadé avec succès',
      employee: result.rows[0],
      filePath: dossierPath,
      fileUrl: `${req.protocol}://${req.get('host')}${dossierPath}`
    });

  } catch (error) {
    console.error('❌ Erreur upload dossier:', error);
    
    // Supprimer le fichier en cas d'erreur
    if (req.file && fs.existsSync(req.file.path)) {
      try {
        fs.unlinkSync(req.file.path);
        console.log('🗑️ Fichier supprimé suite à l\'erreur');
      } catch (unlinkError) {
        console.error('❌ Erreur lors de la suppression du fichier:', unlinkError);
      }
    }
    
    res.status(500).json({ 
      error: 'Erreur lors de l\'upload du dossier',
      message: error.message 
    });
  }
});

// =========================
// Autres routes employés
// =========================

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
      date_depart,
      adresse_mail,
      mail_responsable1,
      mail_responsable2
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
          date_depart = $14, adresse_mail = $15, mail_responsable1 = $16, 
          mail_responsable2 = $17, updated_at = CURRENT_TIMESTAMP
      WHERE id = $18
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
        adresse_mail,
        mail_responsable1,
        mail_responsable2,
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
      dossier_rh,
      adresse_mail,
      mail_responsable1,
      mail_responsable2
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
      (matricule, nom, prenom, cin, passeport, date_naissance, poste, site_dep, 
       type_contrat, date_debut, salaire_brute, photo, dossier_rh, adresse_mail,
       mail_responsable1, mail_responsable2, statut) 
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, 'actif')
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
        dossier_rh || null,
        adresse_mail || null,
        mail_responsable1 || null,
        mail_responsable2 || null
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

app.get('/api/demandes', authenticateToken, async (req, res) => {
  try {
    const {
      type_demande,
      statut,
      date_debut,
      date_fin,
      employe_id,
      page = 1,
      limit = 10
    } = req.query;

    console.log('📋 Récupération des demandes RH avec filtres:', {
      type_demande,
      statut,
      date_debut,
      date_fin,
      employe_id,
      page,
      limit
    });

    let query = `
      SELECT d.*, 
             e.nom as employe_nom, 
             e.prenom as employe_prenom,
             e.poste as employe_poste,
             e.photo as employe_photo,
             e.matricule as employe_matricule,
             e.mail_responsable1,
             e.mail_responsable2,
             r1.nom as responsable1_nom,
             r1.prenom as responsable1_prenom,
             r2.nom as responsable2_nom,
             r2.prenom as responsable2_prenom
      FROM demande_rh d
      LEFT JOIN employees e ON d.employe_id = e.id
      LEFT JOIN employees r1 ON e.mail_responsable1 = r1.adresse_mail
      LEFT JOIN employees r2 ON e.mail_responsable2 = r2.adresse_mail
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

    if (date_debut && date_fin) {
      paramCount++;
      query += ` AND d.date_depart BETWEEN $${paramCount}`;
      params.push(date_debut);
      paramCount++;
      query += ` AND $${paramCount}`;
      params.push(date_fin);
    }

    query += ` ORDER BY d.created_at DESC LIMIT $${paramCount + 1} OFFSET $${paramCount + 2}`;
    params.push(parseInt(limit), (parseInt(page) - 1) * parseInt(limit));

    const result = await pool.query(query, params);

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

    if (employe_id) {
      countParamCount++;
      countQuery += ` AND d.employe_id = $${countParamCount}`;
      countParams.push(employe_id);
    }

    if (date_debut && date_fin) {
      countParamCount++;
      countQuery += ` AND d.date_depart BETWEEN $${countParamCount}`;
      countParams.push(date_debut);
      countParamCount++;
      countQuery += ` AND $${countParamCount}`;
      countParams.push(date_fin);
    }

    const countResult = await pool.query(countQuery, countParams);
    const total = parseInt(countResult.rows[0].count);

    console.log(`✅ ${result.rows.length} demandes récupérées sur ${total} total`);

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

app.get('/api/demandes/:id', authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;
    console.log('📄 Récupération demande ID:', id);
    
    const result = await pool.query(`
      SELECT d.*, 
             e.nom as employe_nom, 
             e.prenom as employe_prenom,
             e.poste as employe_poste,
             e.photo as employe_photo,
             e.matricule as employe_matricule,
             e.mail_responsable1,
             e.mail_responsable2,
             r1.nom as responsable1_nom,
             r1.prenom as responsable1_prenom,
             r2.nom as responsable2_nom,
             r2.prenom as responsable2_prenom
      FROM demande_rh d
      LEFT JOIN employees e ON d.employe_id = e.id
      LEFT JOIN employees r1 ON e.mail_responsable1 = r1.adresse_mail
      LEFT JOIN employees r2 ON e.mail_responsable2 = r2.adresse_mail
      WHERE d.id = $1
    `, [id]);

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Demande non trouvée' });
    }

    console.log('✅ Demande récupérée');
    res.json(result.rows[0]);
  } catch (error) {
    console.error('❌ Erreur récupération demande:', error);
    res.status(500).json({ 
      error: 'Erreur lors de la récupération de la demande',
      message: error.message 
    });
  }
});

app.post('/api/demandes', authenticateToken, async (req, res) => {
  try {
    console.log('➕ Création nouvelle demande RH');

    const {
      employe_id,
      type_demande,
      titre,
      type_conge,
      type_conge_autre,
      date_depart,
      date_retour,
      heure_depart,
      heure_retour,
      demi_journee,
      frais_deplacement,
      commentaire_refus
    } = req.body;

    if (!employe_id || !type_demande || !titre) {
      return res.status(400).json({
        error: 'Employé, type de demande et titre sont obligatoires'
      });
    }

    const result = await pool.query(`
      INSERT INTO demande_rh (
        employe_id, type_demande, titre, type_conge, type_conge_autre,
        date_depart, date_retour, heure_depart, heure_retour,
        demi_journee, frais_deplacement, commentaire_refus, statut,
        created_at, updated_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, 'en_attente', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
      RETURNING *
    `, [
      employe_id, 
      type_demande, 
      titre, 
      type_conge || null, 
      type_conge_autre || null,
      date_depart || null, 
      date_retour || null, 
      heure_depart || null, 
      heure_retour || null,
      demi_journee || false, 
      frais_deplacement ? parseFloat(frais_deplacement) : null, 
      commentaire_refus || null
    ]);

    console.log('✅ Demande créée, ID:', result.rows[0].id);
    res.status(201).json(result.rows[0]);
  } catch (error) {
    console.error('❌ Erreur création demande:', error);
    res.status(500).json({ 
      error: 'Erreur lors de la création de la demande',
      message: error.message 
    });
  }
});

app.put('/api/demandes/:id', authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;
    console.log('✏️ Mise à jour demande ID:', id);

    const {
      type_demande,
      titre,
      type_conge,
      type_conge_autre,
      date_depart,
      date_retour,
      heure_depart,
      heure_retour,
      demi_journee,
      frais_deplacement,
      statut,
      approuve_responsable1,
      approuve_responsable2,
      commentaire_refus
    } = req.body;

    const result = await pool.query(`
      UPDATE demande_rh 
      SET type_demande = $1, titre = $2, type_conge = $3, type_conge_autre = $4,
          date_depart = $5, date_retour = $6, heure_depart = $7, heure_retour = $8,
          demi_journee = $9, frais_deplacement = $10, statut = $11,
          approuve_responsable1 = $12, approuve_responsable2 = $13,
          commentaire_refus = $14, updated_at = CURRENT_TIMESTAMP
      WHERE id = $15
      RETURNING *
    `, [
      type_demande, 
      titre, 
      type_conge || null, 
      type_conge_autre || null,
      date_depart || null, 
      date_retour || null, 
      heure_depart || null, 
      heure_retour || null,
      demi_journee || false, 
      frais_deplacement ? parseFloat(frais_deplacement) : null, 
      statut || 'en_attente',
      approuve_responsable1 || false,
      approuve_responsable2 || false,
      commentaire_refus || null, 
      id
    ]);

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Demande non trouvée' });
    }

    console.log('✅ Demande mise à jour');
    res.json(result.rows[0]);
  } catch (error) {
    console.error('❌ Erreur mise à jour demande:', error);
    res.status(500).json({ 
      error: 'Erreur lors de la mise à jour de la demande',
      message: error.message 
    });
  }
});

app.put('/api/demandes/:id/statut', authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;
    const { statut, commentaire_refus } = req.body;

    console.log('🔄 Changement statut demande ID:', id, '->', statut);

    const result = await pool.query(`
      UPDATE demande_rh 
      SET statut = $1, commentaire_refus = $2, updated_at = CURRENT_TIMESTAMP
      WHERE id = $3
      RETURNING *
    `, [statut, commentaire_refus || null, id]);

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Demande non trouvée' });
    }

    console.log('✅ Statut demande mis à jour');
    res.json(result.rows[0]);
  } catch (error) {
    console.error('❌ Erreur changement statut:', error);
    res.status(500).json({ 
      error: 'Erreur lors du changement de statut',
      message: error.message 
    });
  }
});

app.delete('/api/demandes/:id', authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;
    console.log('🗑️ Suppression demande ID:', id);
    
    const result = await pool.query('DELETE FROM demande_rh WHERE id = $1 RETURNING *', [id]);

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Demande non trouvée' });
    }

    console.log('✅ Demande supprimée');
    res.json({ message: 'Demande supprimée avec succès', deleted: result.rows[0] });
  } catch (error) {
    console.error('❌ Erreur suppression demande:', error);
    res.status(500).json({ 
      error: 'Erreur lors de la suppression de la demande',
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
  console.log('📋 Routes demandes RH activées');
  console.log('📤 Route upload dossier RH activée');
  console.log('📁 Dossier public configuré');
  console.log('='.repeat(60) + '\n');
});

process.on('SIGINT', async () => {
  console.log('\n🛑 Arrêt du serveur...');
  await pool.end();
  process.exit(0);
});
