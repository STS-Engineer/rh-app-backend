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
const PDFKitDocument = require('pdfkit');
const crypto = require('crypto');
const nodemailer = require('nodemailer');

const app = express();
const PORT = Number(process.env.PORT || 5000);

// =========================
// CONFIGURATION FIXE POUR OUTLOOK
// =========================
const SMTP_HOST = "avocarbon-com.mail.protection.outlook.com";
const SMTP_PORT = 25;
const EMAIL_FROM_NAME = "Administration STS";
const EMAIL_FROM = "administration.STS@avocarbon.com";

console.log('📧 Configuration SMTP Outlook:', {
  host: SMTP_HOST,
  port: SMTP_PORT,
  from: EMAIL_FROM,
  fromName: EMAIL_FROM_NAME
});

// Configuration du transporteur email
const emailTransporter = nodemailer.createTransport({
  host: SMTP_HOST,
  port: SMTP_PORT,
  secure: false,
  tls: { 
    ciphers: 'SSLv3',
    rejectUnauthorized: false 
  },
  connectionTimeout: 10000,
  greetingTimeout: 10000,
  socketTimeout: 10000,
  debug: process.env.NODE_ENV === 'development'
});
// =========================
// JOB PLANIFIÉ POUR LES ALERTES
// =========================

// Vérifier les alertes au démarrage
setTimeout(() => {
  checkContractEndAlerts();
}, 10000); // Attendre 10s après le démarrage

// Vérifier les alertes chaque jour à 8h00
setInterval(() => {
  const now = new Date();
  if (now.getHours() === 8 && now.getMinutes() === 0) {
    checkContractEndAlerts();
  }
}, 60000); // Vérifier chaque minute
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

// JWT secret
const JWT_SECRET = process.env.JWT_SECRET || 'fallback_secret_pour_development_seulement_2024';

if (!process.env.JWT_SECRET) {
  console.warn('⚠️  JWT_SECRET non défini dans .env - utilisation d\'un secret de développement');
}

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
// Configuration des dossiers
// =========================

const uploadTempDir = path.join(__dirname, 'uploads', 'temp');
const pdfStorageDir = path.join(__dirname, 'uploads', 'pdfs');
const employeePhotoDir = path.join(__dirname, 'uploads', 'employee-photos');
const archivePdfDir = path.join(__dirname, 'uploads', 'archive-pdfs');
const uploadPaieDir = path.join(__dirname, 'uploads', 'paie');

// Créer les dossiers s'ils n'existent pas
[uploadTempDir, pdfStorageDir, employeePhotoDir, archivePdfDir, uploadPaieDir].forEach(dir => {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
    console.log(`📁 Dossier créé: ${dir}`);
  }
});

// =========================
// Configuration Multer pour les PDF d'archive
// =========================

const archivePdfStorage = multer.diskStorage({
  destination: function (req, file, cb) {
    cb(null, archivePdfDir);
  },
  filename: function (req, file, cb) {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1e9);
    cb(null, 'archive-' + uniqueSuffix + '.pdf');
  }
});

const archivePdfUpload = multer({
  storage: archivePdfStorage,
  limits: {
    fileSize: 2000 * 1024 * 1024 // 200MB max
  },
  fileFilter: function (req, file, cb) {
    if (file.mimetype === 'application/pdf') {
      cb(null, true);
    } else {
      cb(new Error('Seuls les fichiers PDF sont autorisés!'), false);
    }
  }
});

// =========================
// Configuration Multer upload (Dossier RH)
// =========================

const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    cb(null, uploadTempDir);
  },
  filename: function (req, file, cb) {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1e9);
    cb(null, 'photo-' + uniqueSuffix + path.extname(file.originalname));
  }
});

const upload = multer({
  storage: storage,
  limits: {
    fileSize: 5000 * 1024 * 1024 // 1000MB max
  },
  fileFilter: function (req, file, cb) {
    if (file.mimetype.startsWith('image/')) {
      cb(null, true);
    } else {
      cb(new Error('Seules les images sont autorisées!'), false);
    }
  }
});

// =========================
// Configuration pour photos employés
// =========================

const employeePhotoStorage = multer.diskStorage({
  destination: function (req, file, cb) {
    cb(null, employeePhotoDir);
  },
  filename: function (req, file, cb) {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1e9);
    cb(null, 'employee-' + uniqueSuffix + path.extname(file.originalname));
  }
});

const employeePhotoUpload = multer({
  storage: employeePhotoStorage,
  limits: {
    fileSize: 2000 * 1024 * 1024 //100MB max
  },
  fileFilter: function (req, file, cb) {
    if (file.mimetype.startsWith('image/')) {
      cb(null, true);
    } else {
      cb(new Error('Seules les images sont autorisées!'), false);
    }
  }
});

// =========================
// Configuration pour fiches de paie
// =========================

const uploadPaie = multer({
  storage: multer.diskStorage({
    destination: (req, file, cb) => cb(null, uploadPaieDir),
    filename: (req, file, cb) => {
      const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1e9);
      cb(null, 'paie-' + uniqueSuffix + '.pdf');
    }
  }),
  limits: { fileSize: 2000 * 1024 * 1024 }, // 200MB max
  fileFilter: (req, file, cb) => {
    if (file.mimetype === 'application/pdf') {
      cb(null, true);
    } else {
      cb(new Error('Seuls les fichiers PDF sont autorisés!'), false);
    }
  }
});

// =========================
// Test connexion BDD
// =========================

pool
  .connect()
  .then(client => {
    console.log('✅ Connexion à PostgreSQL réussie pour RH Application');
    return client.query('SELECT version(), current_database()');
  })
  .then(result => {
    console.log('📊 Base de données:', result.rows[0]);
    pool.query('SELECT 1').then(() => console.log('✅ Pool PostgreSQL opérationnel'));
  })
  .catch(err => {
    console.error('❌ ERREUR DE CONNEXION PostgreSQL:', {
      message: err.message,
      code: err.code,
      host: process.env.DB_HOST,
      port: process.env.DB_PORT,
      stack: err.stack
    });
  });

pool.on('error', err => {
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
      console.error('❌ Erreur vérification token:', err.message);
      return res.sendStatus(403);
    }
    req.user = user;
    next();
  });
};

// =========================
// Utilitaires
// =========================

function isValidUrl(string) {
  try {
    new URL(string);
    return true;
  } catch (_) {
    return false;
  }
}

function isValidEmail(email) {
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return emailRegex.test(email);
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

// Fonction pour générer un mot de passe aléatoire
function generateRandomPassword(length = 10) {
  const uppercase = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
  const lowercase = 'abcdefghijklmnopqrstuvwxyz';
  const numbers = '0123456789';
  const specials = '!@#$%^&*';
  
  let password = '';
  
  // Assurer au moins un caractère de chaque type
  password += uppercase.charAt(Math.floor(Math.random() * uppercase.length));
  password += lowercase.charAt(Math.floor(Math.random() * lowercase.length));
  password += numbers.charAt(Math.floor(Math.random() * numbers.length));
  password += specials.charAt(Math.floor(Math.random() * specials.length));
  
  // Remplir le reste
  const allChars = uppercase + lowercase + numbers + specials;
  for (let i = 4; i < length; i++) {
    password += allChars.charAt(Math.floor(Math.random() * allChars.length));
  }
  
  // Mélanger le mot de passe
  return password.split('').sort(() => 0.5 - Math.random()).join('');
}

// Fonction pour envoyer un email avec Outlook
async function sendEmail(to, subject, html) {
  try {
    const mailOptions = {
      from: {
        name: EMAIL_FROM_NAME,
        address: EMAIL_FROM
      },
      to: to,
      subject: subject,
      html: html,
      text: html.replace(/<[^>]*>/g, ''), // Version texte pour compatibilité
      headers: {
        'X-Mailer': 'RH Manager Application',
        'X-Priority': '3',
        'X-MSMail-Priority': 'Normal'
      }
    };

    console.log('📧 Tentative d\'envoi email à:', to);
    
    const info = await emailTransporter.sendMail(mailOptions);
    console.log('✅ Email envoyé avec succès:', info.messageId);
    return true;
  } catch (error) {
    console.error('❌ Erreur envoi email:', {
      message: error.message,
      code: error.code,
      response: error.response
    });
    throw error;
  }
}

// Fonction pour vérifier et envoyer les alertes de fin de contrat
async function checkContractEndAlerts() {
  try {
    console.log('🔔 Vérification des alertes de fin de contrat...');
    
    // Calculer la date dans 1 mois
    const now = new Date();
    const oneMonthLater = new Date(now);
    oneMonthLater.setMonth(oneMonthLater.getMonth() + 1);
    const oneMonthLaterStr = oneMonthLater.toISOString().split('T')[0];
    
    // Trouver les employés dont la date de fin de contrat est dans 1 mois
    const result = await pool.query(
      `SELECT id, matricule, nom, prenom, date_fin_contrat, poste 
       FROM employees 
       WHERE date_fin_contrat = $1 
         AND statut = 'actif' 
         AND (last_contract_alert IS NULL OR last_contract_alert < CURRENT_DATE - INTERVAL '7 days')`,
      [oneMonthLaterStr]
    );
    
    console.log(`📊 ${result.rows.length} employé(s) avec fin de contrat dans 1 mois`);
    
    // Envoyer des alertes pour chaque employé
    for (const employee of result.rows) {
      await sendContractEndAlert(employee);
      
      // Mettre à jour la date de dernière alerte
      await pool.query(
        'UPDATE employees SET last_contract_alert = CURRENT_TIMESTAMP WHERE id = $1',
        [employee.id]
      );
    }
    
    return result.rows;
  } catch (error) {
    console.error('❌ Erreur vérification alertes fin de contrat:', error);
    return [];
  }
}

// Fonction pour envoyer l'alerte email
async function sendContractEndAlert(employee) {
  try {
    const emailTo = 'majed.messai@avocarbon.com';
    const formattedDate = new Date(employee.date_fin_contrat).toLocaleDateString('fr-FR');
    
    const html = `
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>⚠️ Alerte Fin de Contrat</title>
        <style>
          body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; max-width: 600px; margin: 0 auto; padding: 20px; }
          .header { background: #dc3545; color: white; padding: 20px; text-align: center; border-radius: 8px 8px 0 0; }
          .content { background: #f8f9fa; padding: 30px; border: 1px solid #e9ecef; border-top: none; border-radius: 0 0 8px 8px; }
          .alert-box { background: #fff3cd; border: 2px solid #ffc107; padding: 20px; margin: 20px 0; border-radius: 5px; }
          .employee-info { background: white; border: 1px solid #dee2e6; padding: 15px; margin: 20px 0; border-radius: 5px; }
          .footer { margin-top: 30px; padding-top: 20px; border-top: 1px solid #e9ecef; color: #6c757d; font-size: 12px; text-align: center; }
          .warning-icon { font-size: 24px; margin-right: 10px; }
        </style>
      </head>
      <body>
        <div class="header">
          <h2>⚠️ ALERTE FIN DE CONTRAT</h2>
        </div>
        <div class="content">
          <div class="alert-box">
            <p><span class="warning-icon">⚠️</span> <strong>Alerte Préventive</strong></p>
            <p>La date de fin de contrat d'un employé approche dans moins d'1 mois.</p>
          </div>
          
          <div class="employee-info">
            <h3>👤 Informations de l'employé</h3>
            <p><strong>Nom complet :</strong> ${employee.prenom} ${employee.nom}</p>
            <p><strong>Matricule :</strong> ${employee.matricule}</p>
            <p><strong>Poste :</strong> ${employee.poste || 'Non spécifié'}</p>
            <p><strong>Date de fin de contrat :</strong> <span style="color: #dc3545; font-weight: bold;">${formattedDate}</span></p>
          </div>
          
         
          
          <p>Cette alerte est envoyée automatiquement par le système RH.</p>
        </div>
        <div class="footer">
          <p>© ${new Date().getFullYear()} RH Manager - Administration STS</p>
          <p>Ceci est un message automatique, merci de ne pas y répondre.</p>
        </div>
      </body>
      </html>
    `;
    
    await sendEmail(emailTo, `⚠️ Alerte Fin de Contrat - ${employee.prenom} ${employee.nom}`, html);
    console.log(`✅ Alerte envoyée pour ${employee.prenom} ${employee.nom} (Fin contrat: ${formattedDate})`);
    
  } catch (error) {
    console.error(`❌ Erreur envoi alerte pour ${employee.prenom} ${employee.nom}:`, error);
  }
}


// =========================
// NOUVELLES ROUTES POUR MOT DE PASSE OUBLIÉ
// =========================

// Route pour envoyer un nouveau mot de passe directement par email
app.post('/api/auth/send-new-password', async (req, res) => {
  try {
    const { email } = req.body;
    
    console.log('🔐 Demande de nouveau mot de passe pour:', email);
    
    if (!email || !isValidEmail(email)) {
      return res.status(400).json({
        success: false,
        message: 'Adresse email invalide'
      });
    }
    
    // Vérifier si l'utilisateur existe
    const userResult = await pool.query(
      'SELECT id, email FROM users WHERE email = $1',
      [email]
    );
    
    if (userResult.rows.length === 0) {
      console.log('❌ Utilisateur non trouvé:', email);
      // Pour des raisons de sécurité, on ne révèle pas si l'email existe ou non
      return res.json({
        success: true,
        message: 'Si un compte avec cet email existe, un nouveau mot de passe a été envoyé'
      });
    }
    
    const user = userResult.rows[0];
    
    // Générer un nouveau mot de passe
    const newPassword = generateRandomPassword(10);
    const hashedPassword = await bcrypt.hash(newPassword, 10);
    
    // Mettre à jour le mot de passe dans la base
    await pool.query(
      'UPDATE users SET password = $1 WHERE id = $2',
      [hashedPassword, user.id]
    );
    
    // Contenu HTML de l'email
    const emailHtml = `
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>Votre nouveau mot de passe RH Manager</title>
        <style>
          body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; max-width: 600px; margin: 0 auto; padding: 20px; }
          .header { background: #2563eb; color: white; padding: 20px; text-align: center; border-radius: 8px 8px 0 0; }
          .content { background: #f8fafc; padding: 30px; border: 1px solid #e5e7eb; border-top: none; border-radius: 0 0 8px 8px; }
          .password-box { background: white; border: 2px solid #2563eb; padding: 20px; margin: 20px 0; text-align: center; font-size: 18px; font-weight: bold; border-radius: 5px; }
          .button { display: inline-block; background: #2563eb; color: white; padding: 12px 24px; text-decoration: none; border-radius: 5px; font-weight: bold; margin: 20px 0; }
          .footer { margin-top: 30px; padding-top: 20px; border-top: 1px solid #e5e7eb; color: #6b7280; font-size: 12px; text-align: center; }
          .warning { background: #fee2e2; border: 2px solid #dc2626; color: #991b1b; padding: 15px; border-radius: 5px; margin: 20px 0; }
          .instructions { background: #fef3c7; border: 1px solid #f59e0b; padding: 15px; border-radius: 5px; margin: 20px 0; }
        </style>
      </head>
      <body>
        <div class="header">
          <h2>🔐 Votre nouveau mot de passe RH Manager</h2>
        </div>
        <div class="content">
          <p>Bonjour,</p>
          <p>Vous avez demandé un nouveau mot de passe pour l'application <strong>RH Manager</strong>.</p>
          <p>Voici vos nouvelles informations de connexion :</p>
          
          <div style="background: white; border: 1px solid #e5e7eb; border-radius: 5px; padding: 15px; margin: 20px 0;">
            <p><strong>Email :</strong> ${email}</p>
            <p><strong>Nouveau mot de passe :</strong></p>
            <div class="password-box">${newPassword}</div>
          </div>
          
          <div class="warning">
            <p><strong>⚠️ SÉCURITÉ :</strong> Ne partagez jamais cet email avec qui que ce soit.</p>
          </div>
          
          <div class="instructions">
            <p><strong>📋 Instructions importantes :</strong></p>
            <ol>
              <li>Connectez-vous immédiatement avec ce mot de passe</li>
              <li>Accédez à votre profil utilisateur</li>
              <li>Changez ce mot de passe temporaire par un mot de passe personnel</li>
            </ol>
          </div>
          
          <div style="text-align: center;">
            <a href="${process.env.FRONTEND_URL || 'http://localhost:3000'}" class="button">
              Me connecter à RH Manager
            </a>
          </div>
          
          <p>Cordialement,<br>L'équipe RH Manager - Administration STS</p>
        </div>
        <div class="footer">
          <p>Ceci est un message automatique, merci de ne pas y répondre.</p>
          <p>© ${new Date().getFullYear()} RH Manager - Tous droits réservés</p>
        </div>
      </body>
      </html>
    `;
    
    try {
      await sendEmail(email, 'Votre nouveau mot de passe RH Manager', emailHtml);
      
      console.log('✅ Nouveau mot de passe envoyé à:', email);
      
      res.json({
        success: true,
        message: 'Si un compte avec cet email existe, un nouveau mot de passe a été envoyé'
      });
    } catch (emailError) {
      console.error('❌ Erreur envoi email:', emailError);
      res.status(500).json({
        success: false,
        message: 'Erreur lors de l\'envoi du nouveau mot de passe'
      });
    }
    
  } catch (error) {
    console.error('❌ Erreur envoi nouveau mot de passe:', error);
    res.status(500).json({
      success: false,
      message: 'Erreur lors de l\'envoi du nouveau mot de passe'
    });
  }
});

// =========================
// ROUTES EXISTANTES (à insérer ici)
// =========================

// Route pour uploader un PDF d'archive
app.post(
  '/api/archive/upload-pdf',
  authenticateToken,
  archivePdfUpload.single('pdfFile'),
  async (req, res) => {
    try {
      console.log('📄 ========== UPLOAD PDF ARCHIVE ==========');
      
      if (!req.file) {
        console.log('❌ Aucun fichier PDF uploadé');
        return res.status(400).json({ 
          success: false, 
          error: 'Aucun fichier PDF uploadé' 
        });
      }

      console.log('📁 Fichier PDF reçu:', {
        filename: req.file.filename,
        originalname: req.file.originalname,
        size: req.file.size,
        mimetype: req.file.mimetype
      });

      // Générer l'URL accessible
      const baseUrl = process.env.BACKEND_URL || 'https://backend-rh.azurewebsites.net';
      const pdfUrl = `${baseUrl}/api/archive-pdfs/${req.file.filename}`;
      
      console.log('✅ PDF sauvegardé:', {
        fileName: req.file.filename,
        pdfUrl: pdfUrl
      });

      res.json({
        success: true,
        message: 'PDF uploadé avec succès',
        pdfUrl: pdfUrl,
        fileName: req.file.filename
      });

    } catch (error) {
      console.error('❌ Erreur upload PDF archive:', error);
      
      res.status(500).json({
        success: false,
        error: "Erreur lors de l'upload du PDF",
        details: error.message
      });
    }
  }
);

// Route pour servir les PDF d'archive
app.get('/api/archive-pdfs/:filename', (req, res) => {
  try {
    const filename = req.params.filename;
    const filePath = path.join(archivePdfDir, filename);
    
    console.log('📄 Demande PDF archive:', filename);
    
    if (!fs.existsSync(filePath)) {
      console.error('❌ PDF non trouvé:', filePath);
      return res.status(404).json({ error: 'PDF non trouvé' });
    }

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `inline; filename="${filename}"`);
    res.sendFile(filePath);
    
  } catch (error) {
    console.error('❌ Erreur service PDF archive:', error);
    res.status(500).json({ error: 'Erreur lors du chargement du PDF' });
  }
});

// Mise à jour de la route d'archivage - VERSION CORRIGÉE
app.put('/api/employees/:id/archive', authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;
    const { pdf_url, entretien_depart, date_depart } = req.body;

    console.log('📁 Archivage employé ID:', id, 'avec PDF:', pdf_url, 'Date départ brute:', date_depart);

    if (!pdf_url) {
      return res.status(400).json({
        success: false,
        error: 'Le lien PDF de l\'entretien de départ est obligatoire'
      });
    }

    // Formater la date pour PostgreSQL (YYYY-MM-DD)
    let formattedDate;
    if (date_depart) {
      try {
        // Si la date est au format ISO (avec 'T'), extraire juste la partie date
        if (date_depart.includes('T')) {
          formattedDate = date_depart.split('T')[0];
          console.log('📅 Date formatée (ISO -> YYYY-MM-DD):', formattedDate);
        } else {
          formattedDate = date_depart;
          console.log('📅 Date déjà formatée:', formattedDate);
        }
        
        // Valider que c'est une date valide
        const dateObj = new Date(formattedDate);
        if (isNaN(dateObj.getTime())) {
          return res.status(400).json({
            success: false,
            error: 'Format de date invalide'
          });
        }
      } catch (dateError) {
        console.error('❌ Erreur formatage date:', dateError);
        return res.status(400).json({
          success: false,
          error: 'Format de date invalide'
        });
      }
    } else {
      // Si aucune date n'est fournie, utiliser la date d'aujourd'hui
      formattedDate = new Date().toISOString().split('T')[0];
      console.log('📅 Utilisation date du jour:', formattedDate);
    }

    const result = await pool.query(
      `
      UPDATE employees 
      SET date_depart = $1,
          entretien_depart = $2,
          pdf_archive_url = $3,
          statut = 'archive',
          updated_at = CURRENT_TIMESTAMP
      WHERE id = $4
      RETURNING *
    `,
      [formattedDate, entretien_depart || 'Entretien de départ terminé', pdf_url, id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({
        success: false,
        error: 'Employé non trouvé'
      });
    }

    console.log('✅ Employé archivé avec PDF et date:', formattedDate);
    res.json({
      success: true,
      message: 'Employé archivé avec succès',
      employee: result.rows[0]
    });
  } catch (error) {
    console.error("❌ Erreur archivage:", error);
    
    // Message d'erreur détaillé
    let errorMessage = "Erreur lors de l'archivage de l'employé";
    
    if (error.code === '22007') {
      errorMessage = "Format de date invalide pour la base de données";
    } else if (error.code === '23505') {
      errorMessage = "Violation de contrainte unique";
    } else if (error.message.includes('date')) {
      errorMessage = "Erreur avec le format de date";
    }
    
    res.status(500).json({
      success: false,
      error: errorMessage,
      details: error.message,
      code: error.code
    });
  }
});

// Route pour uploader une photo d'employé
app.post(
  '/api/employees/upload-photo',
  authenticateToken,
  employeePhotoUpload.single('photo'),
  async (req, res) => {
    try {
      console.log('📸 ========== UPLOAD PHOTO EMPLOYÉ ==========');
      
      if (!req.file) {
        console.log('❌ Aucun fichier uploadé');
        return res.status(400).json({ 
          success: false, 
          error: 'Aucun fichier uploadé' 
        });
      }

      console.log('📁 Fichier reçu:', {
        filename: req.file.filename,
        originalname: req.file.originalname,
        size: req.file.size,
        mimetype: req.file.mimetype
      });

      // Renommer le fichier pour un nom plus propre
      const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1e9);
      const newFileName = `employee-photo-${uniqueSuffix}${path.extname(req.file.originalname)}`;
      const newFilePath = path.join(employeePhotoDir, newFileName);
      
      // Déplacer le fichier du temp vers le dossier final
      fs.renameSync(req.file.path, newFilePath);
      
      // Générer l'URL accessible
      const baseUrl = process.env.BACKEND_URL || 'https://backend-rh.azurewebsites.net';
      const photoUrl = `${baseUrl}/api/employee-photos/${newFileName}`;
      
      console.log('✅ Photo sauvegardée:', {
        newFileName: newFileName,
        photoUrl: photoUrl
      });

      res.json({
        success: true,
        message: 'Photo uploadée avec succès',
        photoUrl: photoUrl,
        fileName: newFileName
      });

    } catch (error) {
      console.error('❌ Erreur upload photo employé:', error);
      
      res.status(500).json({
        success: false,
        error: "Erreur lors de l'upload de la photo",
        details: error.message
      });
    }
  }
);

// Route pour servir les photos d'employés
app.get('/api/employee-photos/:filename', (req, res) => {
  try {
    const filename = req.params.filename;
    const filePath = path.join(employeePhotoDir, filename);
    
    console.log('🖼️ Demande photo:', filename);
    
    if (!fs.existsSync(filePath)) {
      console.error('❌ Photo non trouvée:', filePath);
      return res.status(404).json({ error: 'Photo non trouvée' });
    }

    // Déterminer le type MIME
    const ext = path.extname(filename).toLowerCase();
    const mimeTypes = {
      '.jpg': 'image/jpeg',
      '.jpeg': 'image/jpeg',
      '.png': 'image/png',
      '.gif': 'image/gif',
      '.webp': 'image/webp'
    };
    
    const contentType = mimeTypes[ext] || 'application/octet-stream';
    
    res.setHeader('Content-Type', contentType);
    res.setHeader('Cache-Control', 'public, max-age=86400'); // Cache 24h
    res.sendFile(filePath);
    
  } catch (error) {
    console.error('❌ Erreur service photo:', error);
    res.status(500).json({ error: 'Erreur lors du chargement de la photo' });
  }
});

// Upload des photos temporaires pour dossier RH
app.post(
  '/api/dossier-rh/upload-photos',
  authenticateToken,
  (req, res, next) => {
    console.log('📸 Requête reçue sur /api/dossier-rh/upload-photos');
    next();
  },
  upload.array('photos', 30),
  async (req, res) => {
    try {
      console.log('📸 Upload photos - Files reçus:', req.files?.length || 0);
      
      if (!req.files || req.files.length === 0) {
        console.log('❌ Aucun fichier reçu');
        return res.status(400).json({ error: 'Aucune photo uploadée' });
      }

      const photoInfos = req.files.map(file => ({
        filename: file.filename,
        originalname: file.originalname,
        size: file.size,
        path: file.path
      }));

      console.log('✅ Photos uploadées:', photoInfos);

      res.json({
        success: true,
        photos: photoInfos,
        message: `${req.files.length} photo(s) uploadée(s) avec succès`
      });
    } catch (error) {
      console.error('❌ Erreur upload photos:', error);
      res.status(500).json({
        error: "Erreur lors de l'upload des photos",
        details: error.message
      });
    }
  }
);



// =========================
// ROUTE POUR FUSIONNER UN DOSSIER RH EXISTANT - VERSION CORRIGÉE
// =========================
app.post(
  '/api/dossier-rh/merge-pdf/:employeeId',
  authenticateToken,
  async (req, res) => {
    try {
      const { employeeId } = req.params;
      const { photos: clientPhotos, dossierName } = req.body;

      console.log('🔄 MERGE PDF pour employé:', employeeId, 'dossier:', dossierName);

      if (!dossierName || !dossierName.trim()) {
        return res.status(400).json({ error: 'Nom de dossier manquant' });
      }

      if (!Array.isArray(clientPhotos) || clientPhotos.length === 0) {
        return res.status(400).json({ error: 'Aucune photo fournie pour le dossier' });
      }

      const employeeResult = await pool.query('SELECT * FROM employees WHERE id = $1', [
        employeeId
      ]);

      if (employeeResult.rows.length === 0) {
        return res.status(404).json({ error: 'Employé non trouvé' });
      }

      const employee = employeeResult.rows[0];

      // Construire les chemins complets des nouvelles photos
      const newPhotos = clientPhotos.map(p => ({
        ...p,
        path: path.join(uploadTempDir, p.filename)
      }));

      console.log('📂 Chemins nouvelles photos construits:', newPhotos);

      // Vérifier que les fichiers existent
      const missingFiles = newPhotos.filter(p => !fs.existsSync(p.path));
      if (missingFiles.length > 0) {
        console.error('❌ Fichiers manquants:', missingFiles);
        return res.status(400).json({
          error: 'Certaines photos sont introuvables sur le serveur',
          details: `${missingFiles.length} fichier(s) manquant(s)`
        });
      }

      // ✅ VRAIE FUSION PDF avec pdf-lib
      const generateMergedPDF = async (employee, newPhotos, dossierName) => {
        const { PDFDocument } = require('pdf-lib');
        
        console.log('🔄 Début VRAIE fusion PDF...');
        
        // ÉTAPE 1 : Créer un nouveau PDF avec les nouvelles photos
        const newPdfWithPhotos = await new Promise((resolve, reject) => {
          const doc = new PDFKitDocument({ size: 'A4', margin: 50 });
          const buffers = [];

          doc.on('data', chunk => buffers.push(chunk));
          doc.on('error', reject);
          doc.on('end', () => resolve(Buffer.concat(buffers)));

          // Page de garde
          doc.fontSize(24).text('DOSSIER RH - MISE À JOUR', { align: 'left' });
          doc.moveDown(2);
          doc.fontSize(16).text(`Employé : ${employee.prenom} ${employee.nom}`);
          doc.moveDown(0.5);
          doc.fontSize(14).text(`Matricule : ${employee.matricule || '-'}`);
          doc.moveDown(0.5);
          doc.fontSize(14).text(`Poste : ${employee.poste || '-'}`);
          doc.moveDown(0.5);
          doc.fontSize(14).text(`Nom du dossier : ${dossierName || '-'}`);
          doc.moveDown(0.5);
          doc.fontSize(12).text(`Date de mise à jour : ${new Date().toLocaleDateString('fr-FR')}`);
          doc.addPage();

          // Ajouter les nouvelles photos
          newPhotos.forEach((photo, index) => {
            try {
              if (!photo.path || !fs.existsSync(photo.path)) {
                console.warn('⚠️ Photo introuvable:', photo.path);
                return;
              }

              if (index > 0) doc.addPage();

              const pageWidth = doc.page.width;
              const pageHeight = doc.page.height;
              const maxWidth = pageWidth - 100;
              const maxHeight = pageHeight - 150;

              doc.fontSize(12).text(`Photo : ${photo.originalname || photo.filename}`, 50, 50);
              doc.image(photo.path, {
                fit: [maxWidth, maxHeight],
                align: 'center',
                valign: 'center',
                x: 50,
                y: 100
              });

              console.log('📄 Nouvelle photo ajoutée:', photo.path);
            } catch (imageError) {
              console.error(`❌ Erreur photo ${photo.filename}:`, imageError.message);
            }
          });

          doc.end();
        });

        console.log('✅ PDF des nouvelles photos créé');

        // ÉTAPE 2 : Charger l'ancien PDF s'il existe
        let oldPdfPath = null;
        if (employee.dossier_rh) {
          const urlParts = employee.dossier_rh.split('/');
          const oldPdfFilename = urlParts[urlParts.length - 1];
          oldPdfPath = path.join(pdfStorageDir, oldPdfFilename);
          
          if (!fs.existsSync(oldPdfPath)) {
            console.warn('⚠️ Ancien PDF introuvable, création d\'un nouveau dossier');
            oldPdfPath = null;
          } else {
            console.log('✅ Ancien PDF trouvé:', oldPdfPath);
          }
        }

        // ÉTAPE 3 : Fusionner les PDF avec pdf-lib
        const mergedPdfDoc = await PDFDocument.create();

        // Si ancien PDF existe, copier toutes ses pages en premier
        if (oldPdfPath) {
          console.log('📄 Copie des anciennes pages...');
          const oldPdfBytes = fs.readFileSync(oldPdfPath);
          const oldPdfDoc = await PDFDocument.load(oldPdfBytes);
          const oldPages = await mergedPdfDoc.copyPages(oldPdfDoc, oldPdfDoc.getPageIndices());
          
          oldPages.forEach(page => {
            mergedPdfDoc.addPage(page);
          });
          
          console.log(`✅ ${oldPages.length} anciennes pages copiées`);
        }

        // Copier les nouvelles pages
        console.log('📄 Copie des nouvelles pages...');
        const newPdfDoc = await PDFDocument.load(newPdfWithPhotos);
        const newPages = await mergedPdfDoc.copyPages(newPdfDoc, newPdfDoc.getPageIndices());
        
        newPages.forEach(page => {
          mergedPdfDoc.addPage(page);
        });
        
        console.log(`✅ ${newPages.length} nouvelles pages copiées`);

        // ÉTAPE 4 : Sauvegarder le PDF fusionné
        const mergedPdfBytes = await mergedPdfDoc.save();
        const fileName = `dossier-${employee.matricule || 'EMP'}-${Date.now()}.pdf`;
        const filePath = path.join(pdfStorageDir, fileName);
        
        fs.writeFileSync(filePath, mergedPdfBytes);
        
        const baseUrl = process.env.BACKEND_URL || 'https://backend-rh.azurewebsites.net';
        const pdfUrl = `${baseUrl}/api/pdfs/${fileName}`;
        
        console.log('✅ PDF fusionné sauvegardé:', pdfUrl);
        console.log(`📊 Total pages dans le PDF final: ${mergedPdfDoc.getPageCount()}`);
        
        return { pdfUrl, oldPdfPath };
      };

      const { pdfUrl, oldPdfPath } = await generateMergedPDF(employee, newPhotos, dossierName);

      // Supprimer l'ancien PDF SEULEMENT après succès de la fusion
      if (oldPdfPath && fs.existsSync(oldPdfPath)) {
        try {
          fs.unlinkSync(oldPdfPath);
          console.log('🧹 Ancien PDF supprimé après fusion:', oldPdfPath);
        } catch (deleteError) {
          console.warn('⚠️ Impossible de supprimer l\'ancien PDF:', deleteError.message);
        }
      }

      const updateResult = await pool.query(
        'UPDATE employees SET dossier_rh = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2 RETURNING *',
        [pdfUrl, employeeId]
      );

      // Nettoyer les fichiers temporaires
      newPhotos.forEach(photo => {
        try {
          if (photo.path && fs.existsSync(photo.path)) {
            fs.unlinkSync(photo.path);
            console.log('🧹 Fichier temporaire supprimé:', photo.path);
          }
        } catch (cleanupErr) {
          console.warn('⚠️ Erreur suppression fichier temporaire:', photo.path);
        }
      });

      res.json({
        success: true,
        message: 'Dossier RH fusionné avec succès',
        pdfUrl: pdfUrl,
        employee: updateResult.rows[0]
      });
    } catch (error) {
      console.error('❌ Erreur fusion PDF:', {
        message: error.message,
        stack: error.stack
      });
      res.status(500).json({
        error: 'Erreur lors de la fusion du PDF',
        details: error.message
      });
    }
  }
);


// Générer le PDF et le stocker localement
app.post(
  '/api/dossier-rh/generate-pdf/:employeeId',
  authenticateToken,
  async (req, res) => {
    try {
      const { employeeId } = req.params;
      const { photos: clientPhotos, dossierName } = req.body;

      console.log('📄 Génération PDF pour employé:', employeeId, 'dossier:', dossierName);

      if (!dossierName || !dossierName.trim()) {
        return res.status(400).json({ error: 'Nom de dossier manquant' });
      }

      if (!Array.isArray(clientPhotos) || clientPhotos.length === 0) {
        return res.status(400).json({ error: 'Aucune photo fournie pour le dossier' });
      }

      const employeeResult = await pool.query('SELECT * FROM employees WHERE id = $1', [
        employeeId
      ]);

      if (employeeResult.rows.length === 0) {
        return res.status(404).json({ error: 'Employé non trouvé' });
      }

      const employee = employeeResult.rows[0];

      // Construire les chemins complets des photos
      const photos = clientPhotos.map(p => ({
        ...p,
        path: path.join(uploadTempDir, p.filename)
      }));

      console.log('📂 Chemins photos construits:', photos);

      // Vérifier que les fichiers existent
      const missingFiles = photos.filter(p => !fs.existsSync(p.path));
      if (missingFiles.length > 0) {
        console.error('❌ Fichiers manquants:', missingFiles);
        return res.status(400).json({
          error: 'Certaines photos sont introuvables sur le serveur',
          details: `${missingFiles.length} fichier(s) manquant(s)`
        });
      }

      // Fonction pour générer et sauvegarder le PDF
      const generateAndSavePDF = (employee, photos, dossierName) => {
        return new Promise((resolve, reject) => {
          try {
            console.log('🧾 Début génération PDF avec pdfkit...');
            const doc = new PDFKitDocument({ size: 'A4', margin: 50 });
            const buffers = [];

            doc.on('data', chunk => buffers.push(chunk));
            doc.on('error', err => {
              console.error('❌ Erreur PDFKit:', err);
              reject(err);
            });

            doc.on('end', async () => {
              try {
                const pdfBuffer = Buffer.concat(buffers);
                const fileName = `dossier-${employee.matricule || 'EMP'}-${Date.now()}.pdf`;
                console.log('💾 Sauvegarde locale du fichier:', fileName);
                
                const filePath = path.join(pdfStorageDir, fileName);
                fs.writeFileSync(filePath, pdfBuffer);
                
                const baseUrl = process.env.BACKEND_URL || 'https://backend-rh.azurewebsites.net';
                const pdfUrl = `${baseUrl}/api/pdfs/${fileName}`;
                
                console.log('✅ PDF sauvegardé localement:', pdfUrl);
                resolve(pdfUrl);
              } catch (saveError) {
                console.error('❌ Erreur sauvegarde locale:', saveError);
                reject(saveError);
              }
            });

            // Contenu du PDF
            doc.fontSize(24).text('DOSSIER RH', { align: 'left' });
            doc.moveDown(2);

            doc.fontSize(16).text(`Employé : ${employee.prenom} ${employee.nom}`);
            doc.moveDown(0.5);
            doc.fontSize(14).text(`Matricule : ${employee.matricule || '-'}`);
            doc.moveDown(0.5);
            doc.fontSize(14).text(`Poste : ${employee.poste || '-'}`);
            doc.moveDown(0.5);
            doc.fontSize(14).text(`Département / Site : ${employee.site_dep || '-'}`);
            doc.moveDown(0.5);
            doc.fontSize(14).text(`Nom du dossier : ${dossierName || '-'}`);
            doc.moveDown(0.5);
            doc
              .fontSize(12)
              .text(`Date de génération : ${new Date().toLocaleDateString('fr-FR')}`);
            doc.addPage();

            // Pages des photos
            if (Array.isArray(photos)) {
              photos.forEach((photo, index) => {
                try {
                  if (!photo.path || !fs.existsSync(photo.path)) {
                    console.warn('⚠️ Photo introuvable:', photo.path);
                    return;
                  }

                  if (index > 0) {
                    doc.addPage();
                  }

                  const pageWidth = doc.page.width;
                  const pageHeight = doc.page.height;
                  const maxWidth = pageWidth - 100;
                  const maxHeight = pageHeight - 150;

                  doc
                    .fontSize(12)
                    .text(`Photo : ${photo.originalname || photo.filename}`, 50, 50);

                  doc.image(photo.path, {
                    fit: [maxWidth, maxHeight],
                    align: 'center',
                    valign: 'center',
                    x: 50,
                    y: 100
                  });

                  console.log('📄 Photo ajoutée au PDF:', photo.path);
                } catch (imageError) {
                  console.error(
                    `❌ Erreur avec la photo ${photo.filename}:`,
                    imageError.message
                  );
                }
              });
            }

            doc.end();
          } catch (error) {
            console.error('❌ Erreur générale generateAndSavePDF:', error);
            reject(error);
          }
        });
      };

      const pdfUrl = await generateAndSavePDF(employee, photos, dossierName);

      const updateResult = await pool.query(
        'UPDATE employees SET dossier_rh = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2 RETURNING *',
        [pdfUrl, employeeId]
      );

      // Nettoyer les fichiers temporaires
      photos.forEach(photo => {
        try {
          if (photo.path && fs.existsSync(photo.path)) {
            fs.unlinkSync(photo.path);
            console.log('🧹 Fichier temporaire supprimé:', photo.path);
          }
        } catch (cleanupErr) {
          console.warn(
            '⚠️ Erreur suppression fichier temporaire:',
            photo.path,
            cleanupErr.message
          );
        }
      });

      res.json({
        success: true,
        message: 'Dossier RH généré avec succès',
        pdfUrl: pdfUrl,
        employee: updateResult.rows[0]
      });
    } catch (error) {
      console.error('❌ Erreur génération PDF (route):', {
        message: error.message,
        stack: error.stack
      });
      res.status(500).json({
        error: 'Erreur lors de la génération du PDF',
        details: error.message
      });
    }
  }
);

// Route pour servir les PDF
app.get('/api/pdfs/:filename', (req, res) => {
  try {
    const filename = req.params.filename;
    const filePath = path.join(pdfStorageDir, filename);
    
    if (!fs.existsSync(filePath)) {
      return res.status(404).json({ error: 'PDF non trouvé' });
    }

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `inline; filename="${filename}"`);
    res.sendFile(filePath);
    
  } catch (error) {
    console.error('❌ Erreur service PDF:', error);
    res.status(500).json({ error: 'Erreur lors du chargement du PDF' });
  }
});

// =========================
// Routes Fiche de Paie
// =========================

const { PDFDocument } = require('pdf-lib');
const pdfParse = require('pdf-parse');

// Fonction pour extraire le matricule d'une page PDF
function extraireMatricule(texte) {
  console.log('🔍 Texte complet pour extraction (500 caractères):', texte.substring(0, 500));
  
  const patterns = [
    /MATE\.\s*(\d{1,3})/i,
    /MATR\.\s*(\d{1,3})/i,
    /MATE\s+(\d{1,3})/i,
    /MATR\s+(\d{1,3})/i,
    /\|\s*(\d{1,3})\s*\|\s*[A-Z]/i,
    /MATRICULE[\s:]*(\d{1,3})/i
  ];

  for (const pattern of patterns) {
    const match = texte.match(pattern);
    if (match && match[1]) {
      const matricule = match[1].trim();
      console.log(`✅ Matricule trouvé avec pattern ${pattern}: ${matricule}`);
      return matricule;
    }
  }
  
  const lines = texte.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    
    if (line.includes('MATE') || line.includes('MATR')) {
      const nextLine = i + 1 < lines.length ? lines[i + 1] : '';
      const numbers = nextLine.match(/\b(\d{2,3})\b/g);
      
      if (numbers && numbers.length > 0) {
        console.log(`✅ Matricule trouvé dans ligne suivante: ${numbers[0]}`);
        return numbers[0];
      }
    }
  }
  
  console.log('⚠️ Aucun matricule trouvé dans le texte');
  return null;
}

// Fonction pour envoyer la fiche de paie par email
async function envoyerFichePaieParEmail(employe, pdfPath, fileName) {
  const moisActuel = new Date().toLocaleDateString('fr-FR', { 
    month: 'long', 
    year: 'numeric' 
  });

  const mailOptions = {
    from: {
      name: 'Administration STS',
      address: 'administration.STS@avocarbon.com'
    },
    to: employe.adresse_mail,
    subject: `Votre fiche de paie - ${moisActuel}`,
    html: `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
        <h2 style="color: #2563eb; border-bottom: 2px solid #2563eb; padding-bottom: 10px;">
          📄 Votre fiche de paie
        </h2>
        <div style="background: #f8fafc; padding: 20px; border-radius: 8px; margin: 20px 0;">
          <p><strong>Bonjour ${employe.prenom} ${employe.nom},</strong></p>
          <p>Veuillez trouver ci-joint votre fiche de paie pour le mois de <strong>${moisActuel}</strong>.</p>
          <p><strong>Matricule :</strong> ${employe.matricule}</p>
          <p><strong>Poste :</strong> ${employe.poste || 'N/A'}</p>
        </div>
        <p style="color: #6b7280; font-size: 14px;">
          Ce document est confidentiel et personnel. Merci de le conserver précieusement.
        </p>
        <p style="color: #6b7280; font-size: 12px; margin-top: 30px; text-align: center;">
          Ceci est un message automatique, merci de ne pas y répondre.
        </p>
      </div>
    `,
    attachments: [
      {
        filename: fileName,
        path: pdfPath,
        contentType: 'application/pdf'
      }
    ]
  };

  try {
    await emailTransporter.sendMail(mailOptions);
    console.log(`📧 Email envoyé à ${employe.adresse_mail}`);
  } catch (error) {
    console.error('❌ Erreur envoi email:', error);
    throw new Error(`Impossible d'envoyer l'email à ${employe.adresse_mail}: ${error.message}`);
  }
}

// Route principale pour traiter les fiches de paie
app.post(
  '/api/fiche-paie/process',
  authenticateToken,
  uploadPaie.single('pdfFile'),
  async (req, res) => {
    console.log('📄 Traitement des fiches de paie...');
    
    if (!req.file) {
      return res.status(400).json({ error: 'Aucun fichier PDF uploadé' });
    }

    const pdfPath = req.file.path;
    const results = {
      total: 0,
      success: 0,
      errors: []
    };

    try {
      const pdfBytes = fs.readFileSync(pdfPath);
      const pdfDoc = await PDFDocument.load(pdfBytes);
      const totalPages = pdfDoc.getPageCount();
      
      console.log(`📑 PDF chargé: ${totalPages} page(s)`);
      results.total = totalPages;

      for (let i = 0; i < totalPages; i++) {
        try {
          console.log(`\n🔍 Traitement page ${i + 1}/${totalPages}`);
          
          const singlePagePdf = await PDFDocument.create();
          const [copiedPage] = await singlePagePdf.copyPages(pdfDoc, [i]);
          singlePagePdf.addPage(copiedPage);
          
          const singlePageBytes = await singlePagePdf.save();
          const tempPath = path.join(uploadPaieDir, `temp-page-${i}.pdf`);
          fs.writeFileSync(tempPath, singlePageBytes);
          
          const dataBuffer = fs.readFileSync(tempPath);
          const pdfData = await pdfParse(dataBuffer);
          const texte = pdfData.text;
          
          console.log('📝 Extrait de texte (200 premiers caractères):', texte.substring(0, 200));
          
          const matricule = extraireMatricule(texte);
          
          if (!matricule) {
            console.warn(`⚠️ Page ${i + 1}: Matricule non trouvé`);
            results.errors.push({
              page: i + 1,
              error: 'Matricule non trouvé dans la page'
            });
            fs.unlinkSync(tempPath);
            continue;
          }
          
          console.log(`✅ Matricule trouvé: ${matricule}`);
          
          const employeResult = await pool.query(
            'SELECT * FROM employees WHERE matricule = $1',
            [matricule]
          );
          
          if (employeResult.rows.length === 0) {
            console.warn(`⚠️ Page ${i + 1}: Employé avec matricule ${matricule} non trouvé`);
            results.errors.push({
              page: i + 1,
              matricule: matricule,
              error: 'Employé non trouvé dans la base de données'
            });
            fs.unlinkSync(tempPath);
            continue;
          }
          
          const employe = employeResult.rows[0];
          
          if (!employe.adresse_mail) {
            console.warn(`⚠️ Page ${i + 1}: Employé ${employe.nom} ${employe.prenom} sans email`);
            results.errors.push({
              page: i + 1,
              matricule: matricule,
              employe: `${employe.nom} ${employe.prenom}`,
              error: 'Adresse email manquante'
            });
            fs.unlinkSync(tempPath);
            continue;
          }
          
          const fileName = `fiche-paie-${matricule}-${Date.now()}.pdf`;
          const finalPath = path.join(uploadPaieDir, fileName);
          
          fs.renameSync(tempPath, finalPath);
          
          await envoyerFichePaieParEmail(employe, finalPath, fileName);
          
          console.log(`✅ Page ${i + 1}: Fiche de paie envoyée à ${employe.adresse_mail}`);
          results.success++;
          
          setTimeout(() => {
            if (fs.existsSync(finalPath)) {
              fs.unlinkSync(finalPath);
              console.log(`🧹 Fichier nettoyé: ${fileName}`);
            }
          }, 60000);
          
        } catch (pageError) {
          console.error(`❌ Erreur page ${i + 1}:`, pageError);
          results.errors.push({
            page: i + 1,
            error: pageError.message
          });
        }
      }
      
      if (fs.existsSync(pdfPath)) {
        fs.unlinkSync(pdfPath);
        console.log('🧹 Fichier principal nettoyé');
      }
      
      console.log('\n📊 Résultats finaux:', results);
      
      res.json({
        success: true,
        message: `Traitement terminé: ${results.success}/${results.total} fiches envoyées`,
        results: results
      });
      
    } catch (error) {
      console.error('❌ Erreur traitement PDF:', error);
      
      if (fs.existsSync(pdfPath)) {
        fs.unlinkSync(pdfPath);
      }
      
      res.status(500).json({
        error: 'Erreur lors du traitement du PDF',
        details: error.message,
        results: results
      });
    }
  }
);

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
      'POST /api/auth/send-new-password',
      'GET  /api/employees',
      'GET  /api/employees/archives',
      'GET  /api/employees/search?q=nom',
      'PUT  /api/employees/:id',
      'PUT  /api/employees/:id/archive',
      'POST /api/employees',
      'POST /api/employees/upload-photo',
      'GET  /api/employee-photos/:filename',
      'POST /api/archive/upload-pdf',
      'GET  /api/archive-pdfs/:filename',
      'GET  /api/demandes',
      'GET  /api/demandes/:id',
      'POST /api/demandes',
      'PUT  /api/demandes/:id',
      'PUT  /api/demandes/:id/statut',
      'DELETE /api/demandes/:id',
      'POST /api/dossier-rh/upload-photos',
      'POST /api/dossier-rh/generate-pdf/:employeeId',
      'GET  /api/pdfs/:filename',
      'POST /api/fiche-paie/process'
    ]
  });
});

// Health check
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

// =========================
// ROUTE POUR SUPPRIMER LE DOSSIER RH
// =========================
app.delete('/api/employees/:id/dossier-rh', authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;
    
    console.log('🗑️ Suppression dossier RH pour employé ID:', id);

    // Récupérer l'employé pour avoir l'URL du dossier RH
    const employeeResult = await pool.query(
      'SELECT id, nom, prenom, matricule, dossier_rh FROM employees WHERE id = $1',
      [id]
    );

    if (employeeResult.rows.length === 0) {
      return res.status(404).json({
        success: false,
        error: 'Employé non trouvé'
      });
    }

    const employee = employeeResult.rows[0];
    
    if (!employee.dossier_rh) {
      return res.status(400).json({
        success: false,
        error: 'Aucun dossier RH à supprimer'
      });
    }

    // Extraire le nom du fichier PDF de l'URL
    let pdfFilename = null;
    try {
      if (employee.dossier_rh) {
        const urlParts = employee.dossier_rh.split('/');
        pdfFilename = urlParts[urlParts.length - 1];
        
        if (pdfFilename) {
          const pdfPath = path.join(pdfStorageDir, pdfFilename);
          
          // Supprimer le fichier PDF du système de fichiers
          if (fs.existsSync(pdfPath)) {
            fs.unlinkSync(pdfPath);
            console.log('✅ Fichier PDF supprimé:', pdfFilename);
          } else {
            console.warn('⚠️ Fichier PDF non trouvé sur le serveur:', pdfPath);
          }
        }
      }
    } catch (fileError) {
      console.warn('⚠️ Erreur lors de la suppression du fichier PDF:', fileError.message);
      // On continue quand même car le fichier pourrait ne pas exister ou être ailleurs
    }

    // Mettre à jour la base de données pour supprimer le lien
    const updateResult = await pool.query(
      'UPDATE employees SET dossier_rh = NULL, updated_at = CURRENT_TIMESTAMP WHERE id = $1 RETURNING *',
      [id]
    );

    console.log('✅ Dossier RH supprimé pour:', `${employee.prenom} ${employee.nom}`);

    res.json({
      success: true,
      message: 'Dossier RH supprimé avec succès',
      employee: updateResult.rows[0],
      deletedFile: pdfFilename
    });

  } catch (error) {
    console.error('❌ Erreur suppression dossier RH:', error);
    res.status(500).json({
      success: false,
      error: 'Erreur lors de la suppression du dossier RH',
      details: error.message
    });
  }
});



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
    const params = [];

    if (statut === 'archive') {
      query += 'statut = $1';
      params.push('archive');
    } else {
      query += '(statut = $1 OR statut IS NULL)';
      params.push('actif');
    }

    if (q) {
      query += ' AND (nom ILIKE $2 OR prenom ILIKE $2 OR poste ILIKE $2 OR matricule ILIKE $2 OR adresse_mail ILIKE $2)';
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
      date_emission_passport,      
      date_expiration_passport, 
      date_naissance,
      poste,
      site_dep,
      type_contrat,
      date_debut,
      date_fin_contrat,
      salaire_brute,
      photo,
      dossier_rh,
      date_depart,
      pdf_archive_url,
      adresse_mail,
      mail_responsable1,
      mail_responsable2
    } = req.body;

    console.log('📋 Données reçues pour mise à jour:', {
      id,
      matricule,
      nom,
      prenom,
      date_fin_contrat
    });

    // Validation des emails
    if (adresse_mail && !isValidEmail(adresse_mail)) {
      return res.status(400).json({
        success: false,
        error: 'Adresse email de l\'employé invalide'
      });
    }
    
    if (mail_responsable1 && !isValidEmail(mail_responsable1)) {
      return res.status(400).json({
        success: false,
        error: 'Adresse email du responsable 1 invalide'
      });
    }
    
    if (mail_responsable2 && !isValidEmail(mail_responsable2)) {
      return res.status(400).json({
        success: false,
        error: 'Adresse email du responsable 2 invalide'
      });
    }

    let photoUrl = photo;
    if (photo && !isValidUrl(photo)) {
      photoUrl = getDefaultAvatar(nom, prenom);
    } else if (!photo) {
      photoUrl = getDefaultAvatar(nom, prenom);
    }

    // VÉRIFIEZ LE NOMBRE DE PARAMÈTRES :
    // Vous avez 22 "?" dans la requête, donc 22 éléments dans le tableau
    const result = await pool.query(
      `
      UPDATE employees 
      SET matricule = $1, nom = $2, prenom = $3, cin = $4, passeport = $5,
          date_emission_passport = $6, date_expiration_passport = $7,
          date_naissance = $8, poste = $9, site_dep = $10, type_contrat = $11,
          date_debut = $12, date_fin_contrat = $13, salaire_brute = $14,
          photo = $15, dossier_rh = $16,
          date_depart = $17, pdf_archive_url = $18, 
          adresse_mail = $19, mail_responsable1 = $20, mail_responsable2 = $21,
          updated_at = CURRENT_TIMESTAMP
      WHERE id = $22
      RETURNING *
    `,
      [
        matricule,                    // $1
        nom,                          // $2
        prenom,                       // $3
        cin,                          // $4
        passeport,                    // $5
        date_emission_passport || null,    // $6
        date_expiration_passport || null,  // $7
        date_naissance,               // $8
        poste,                        // $9
        site_dep,                     // $10
        type_contrat,                 // $11
        date_debut,                   // $12
        date_fin_contrat || null,     // $13 (NOUVEAU)
        salaire_brute,                // $14
        photoUrl,                     // $15
        dossier_rh,                   // $16
        date_depart,                  // $17
        pdf_archive_url,              // $18
        adresse_mail || null,         // $19
        mail_responsable1 || null,    // $20
        mail_responsable2 || null,    // $21
        id                            // $22
      ]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({
        success: false,
        error: 'Employé non trouvé'
      });
    }

    console.log('✅ Employé mis à jour avec succès');
    
    // Vérifier si besoin d'envoyer une alerte
    if (date_fin_contrat) {
      const now = new Date();
      const oneMonthLater = new Date(now);
      oneMonthLater.setMonth(oneMonthLater.getMonth() + 1);
      const contractEndDate = new Date(date_fin_contrat);
      
      // Si la date de fin est dans 1 mois, envoyer une alerte
      if (contractEndDate.toDateString() === oneMonthLater.toDateString()) {
        const employee = result.rows[0];
        setTimeout(() => {
          sendContractEndAlert(employee);
        }, 5000);
      }
    }
    
    res.json({
      success: true,
      data: result.rows[0],
      message: 'Employé mis à jour avec succès'
    });
  } catch (error) {
    console.error('❌ Erreur mise à jour employé:', error);
    console.error('❌ Détails erreur:', {
      code: error.code,
      constraint: error.constraint,
      detail: error.detail,
      message: error.message,
      stack: error.stack
    });
    
    let errorMessage = "Erreur lors de la mise à jour de l'employé";
    
    if (error.code === '23505') {
      if (error.constraint === 'employees_matricule_key') {
        errorMessage = 'Le matricule existe déjà';
      } else if (error.constraint === 'employees_cin_key') {
        errorMessage = 'Le CIN existe déjà';
      } else if (error.constraint === 'employees_adresse_mail_key') {
        errorMessage = 'L\'adresse email existe déjà';
      }
    } else if (error.code === '22007') {
      errorMessage = 'Format de date invalide';
    } else if (error.message && error.message.includes('parameter')) {
      errorMessage = 'Erreur de paramètres dans la requête SQL';
    }
    
    res.status(500).json({
      success: false,
      error: errorMessage,
      details: error.message,
      code: error.code
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
      date_emission_passport,
      date_expiration_passport,   
      date_naissance,
      poste,
      site_dep,
      type_contrat,
      date_debut,
      date_fin_contrat,
      salaire_brute,
      photo,
      dossier_rh,
      adresse_mail,
      mail_responsable1,
      mail_responsable2
    } = req.body;

    // Log des données reçues pour debug
    console.log('📋 Données reçues:', {
      matricule,
      nom,
      prenom,
      cin,
      poste,
      adresse_mail,
      date_fin_contrat
    });

    if (
      !matricule ||
      !nom ||
      !prenom ||
      !cin ||
      !poste ||
      !site_dep ||
      !type_contrat ||
      !date_debut ||
      !salaire_brute ||
      !adresse_mail
    ) {
      console.log('❌ Champs manquants:', {
        matricule: !matricule,
        nom: !nom,
        prenom: !prenom,
        cin: !cin,
        poste: !poste,
        site_dep: !site_dep,
        type_contrat: !type_contrat,
        date_debut: !date_debut,
        salaire_brute: !salaire_brute,
        adresse_mail: !adresse_mail
      });
      return res.status(400).json({
        success: false,
        error: 'Tous les champs obligatoires doivent être remplis'
      });
    }

    // Validation des emails
    if (!isValidEmail(adresse_mail)) {
      return res.status(400).json({
        success: false,
        error: 'Adresse email de l\'employé invalide'
      });
    }
    
    if (mail_responsable1 && !isValidEmail(mail_responsable1)) {
      return res.status(400).json({
        success: false,
        error: 'Adresse email du responsable 1 invalide'
      });
    }
    
    if (mail_responsable2 && !isValidEmail(mail_responsable2)) {
      return res.status(400).json({
        success: false,
        error: 'Adresse email du responsable 2 invalide'
      });
    }

    let photoUrl = photo;
    if (!photoUrl) {
      photoUrl = getDefaultAvatar(nom, prenom);
    }

    console.log('📝 Exécution requête INSERT avec photo URL:', photoUrl);

    // REQUÊTE CORRIGÉE : 20 paramètres au lieu de 19
    const result = await pool.query(
      `
      INSERT INTO employees 
      (matricule, nom, prenom, cin, passeport, 
       date_emission_passport, date_expiration_passport,
       date_naissance, poste, site_dep, type_contrat, 
       date_debut, date_fin_contrat, salaire_brute, photo, dossier_rh,
       adresse_mail, mail_responsable1, mail_responsable2, statut) 
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20)
      RETURNING *
    `,
      [
        matricule,
        nom,
        prenom,
        cin,
        passeport || null,
        date_emission_passport || null,
        date_expiration_passport || null,
        date_naissance,
        poste,
        site_dep,
        type_contrat,
        date_debut,
        date_fin_contrat || null,
        parseFloat(salaire_brute),
        photoUrl,
        dossier_rh || null,
        adresse_mail,
        mail_responsable1 || null,
        mail_responsable2 || null,
        'actif'
      ]
    );

    console.log('✅ Employé créé, ID:', result.rows[0].id);

    // Vérifier si besoin d'envoyer une alerte
    if (date_fin_contrat) {
      const now = new Date();
      const oneMonthLater = new Date(now);
      oneMonthLater.setMonth(oneMonthLater.getMonth() + 1);
      const contractEndDate = new Date(date_fin_contrat);
      
      // Si la date de fin est dans 1 mois, envoyer une alerte
      if (contractEndDate.toDateString() === oneMonthLater.toDateString()) {
        const employee = result.rows[0];
        setTimeout(() => {
          sendContractEndAlert(employee);
        }, 5000);
      }
    }

    res.json({
      success: true,
      data: result.rows[0],
      message: 'Employé créé avec succès'
    });
    
  } catch (error) {
    console.error('❌ Erreur création employé:', error);
    console.error('❌ Détails erreur:', {
      code: error.code,
      constraint: error.constraint,
      detail: error.detail,
      message: error.message
    });

    if (error.code === '23505') {
      if (error.constraint === 'employees_matricule_key') {
        res.status(400).json({
          success: false,
          error: 'Le matricule existe déjà'
        });
      } else if (error.constraint === 'employees_cin_key') {
        res.status(400).json({
          success: false,
          error: 'Le CIN existe déjà'
        });
      } else if (error.constraint === 'employees_adresse_mail_key') {
        res.status(400).json({
          success: false,
          error: 'L\'adresse email existe déjà'
        });
      } else {
        res.status(400).json({
          success: false,
          error: 'Violation de contrainte unique',
          details: error.detail
        });
      }
    } else {
      res.status(500).json({
        success: false,
        error: "Erreur lors de la création de l'employé",
        message: error.message,
        code: error.code
      });
    }
  }
});


// Route pour vérifier manuellement les alertes de fin de contrat
app.get('/api/contract-alerts/check', authenticateToken, async (req, res) => {
  try {
    const alerts = await checkContractEndAlerts();
    
    res.json({
      success: true,
      message: `Vérification terminée. ${alerts.length} alerte(s) envoyée(s).`,
      alerts: alerts.map(e => ({
        id: e.id,
        nom: `${e.prenom} ${e.nom}`,
        matricule: e.matricule,
        date_fin_contrat: e.date_fin_contrat,
        poste: e.poste
      }))
    });
  } catch (error) {
    console.error('❌ Erreur vérification manuelle:', error);
    res.status(500).json({
      success: false,
      error: 'Erreur lors de la vérification des alertes',
      message: error.message
    });
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
      limit = 1000,
      _t
    } = req.query;

    console.log('📋 Récupération demandes avec filtres:', {
      type_demande,
      statut,
      date_debut,
      date_fin,
      employe_id
    });

    let query = `
      SELECT 
        d.*,
        e.nom as employe_nom, 
        e.prenom as employe_prenom,
        e.poste as employe_poste,
        e.photo as employe_photo,
        e.matricule as employe_matricule,
        e.mail_responsable1,
        e.mail_responsable2,
        e.adresse_mail as employe_email
      FROM demande_rh d
      LEFT JOIN employees e ON d.employe_id = e.id
      WHERE 1=1
    `;
    
    const params = [];
    let paramCount = 0;

    if (type_demande && type_demande !== '' && type_demande !== 'undefined') {
      paramCount++;
      query += ` AND LOWER(TRIM(d.type_demande)) = LOWER($${paramCount})`;
      params.push(type_demande.trim());
      console.log(`✅ Filtre type_demande appliqué: "${type_demande}"`);
    }

    if (statut && statut !== '' && statut !== 'undefined') {
      paramCount++;
      query += ` AND d.statut = $${paramCount}`;
      params.push(statut);
      console.log(`✅ Filtre statut: ${statut}`);
    }

    if (employe_id && employe_id !== '' && employe_id !== 'undefined') {
      paramCount++;
      query += ` AND d.employe_id = $${paramCount}`;
      params.push(employe_id);
      console.log(`✅ Filtre employe_id: ${employe_id}`);
    }

    if (date_debut && date_debut !== '' && date_debut !== 'undefined') {
      paramCount++;
      query += ` AND d.date_depart >= $${paramCount}`;
      params.push(date_debut);
      console.log(`✅ Filtre date_debut: ${date_debut}`);
    }

    if (date_fin && date_fin !== '' && date_fin !== 'undefined') {
      paramCount++;
      query += ` AND d.date_depart <= $${paramCount}`;
      params.push(date_fin);
      console.log(`✅ Filtre date_fin: ${date_fin}`);
    }

    query += ` ORDER BY d.created_at DESC`;
    
    console.log('📝 Requête SQL finale:', query);
    console.log('📝 Paramètres:', params);

    const result = await pool.query(query, params);
    
    console.log(`📊 Résultats de base: ${result.rows.length} demandes`);
    
    const demandesAvecResponsables = await Promise.all(
      result.rows.map(async (demande) => {
        let responsable1_nom = null;
        let responsable1_prenom = null;
        
        if (demande.mail_responsable1) {
          const resp1Result = await pool.query(
            'SELECT nom, prenom FROM employees WHERE adresse_mail = $1 LIMIT 1',
            [demande.mail_responsable1]
          );
          if (resp1Result.rows.length > 0) {
            responsable1_nom = resp1Result.rows[0].nom;
            responsable1_prenom = resp1Result.rows[0].prenom;
          }
        }
        
        let responsable2_nom = null;
        let responsable2_prenom = null;
        
        if (demande.mail_responsable2) {
          const resp2Result = await pool.query(
            'SELECT nom, prenom FROM employees WHERE adresse_mail = $1 LIMIT 1',
            [demande.mail_responsable2]
          );
          if (resp2Result.rows.length > 0) {
            responsable2_nom = resp2Result.rows[0].nom;
            responsable2_prenom = resp2Result.rows[0].prenom;
          }
        }
        
        return {
          ...demande,
          responsable1_nom,
          responsable1_prenom,
          responsable2_nom,
          responsable2_prenom
        };
      })
    );

    let countQuery = `SELECT COUNT(*) as total_count FROM demande_rh d WHERE 1=1`;
    const countParams = [];
    let countParamCount = 0;

    if (type_demande && type_demande !== '' && type_demande !== 'undefined') {
      countParamCount++;
      countQuery += ` AND LOWER(TRIM(d.type_demande)) = LOWER($${countParamCount})`;
      countParams.push(type_demande.trim());
    }

    if (statut && statut !== '' && statut !== 'undefined') {
      countParamCount++;
      countQuery += ` AND d.statut = $${countParamCount}`;
      countParams.push(statut);
    }

    if (date_debut && date_debut !== '' && date_debut !== 'undefined') {
      countParamCount++;
      countQuery += ` AND d.date_depart >= $${countParamCount}`;
      countParams.push(date_debut);
    }

    if (date_fin && date_fin !== '' && date_fin !== 'undefined') {
      countParamCount++;
      countQuery += ` AND d.date_depart <= $${countParamCount}`;
      countParams.push(date_fin);
    }

    const countResult = await pool.query(countQuery, countParams);
    const total = parseInt(countResult.rows[0]?.total_count || 0);

    console.log(`✅ Résultats finaux: ${demandesAvecResponsables.length} demandes sur ${total} total en base`);

    res.json({
      success: true,
      demandes: demandesAvecResponsables,
      pagination: {
        page: parseInt(page),
        limit: limit && limit !== 'all' ? parseInt(limit) : total,
        total,
        pages: limit && limit !== 'all' ? Math.ceil(total / parseInt(limit)) : 1
      },
      debug: {
        countInBase: total,
        countReturned: demandesAvecResponsables.length,
        hasDuplicates: demandesAvecResponsables.length !== total
      }
    });
  } catch (error) {
    console.error('❌ Erreur récupération demandes:', error);
    res.status(500).json({
      success: false,
      error: 'Erreur lors de la récupération des demandes',
      message: error.message
    });
  }
});

app.get('/api/demandes/:id', authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;
    console.log('📄 Récupération demande ID:', id);

    const result = await pool.query(
      `
      SELECT d.*, 
             e.nom as employe_nom, 
             e.prenom as employe_prenom,
             e.poste as employe_poste,
             e.photo as employe_photo,
             e.matricule as employe_matricule,
             e.mail_responsable1,
             e.mail_responsable2,
             e.adresse_mail as employe_email,
             r1.nom as responsable1_nom,
             r1.prenom as responsable1_prenom,
             r2.nom as responsable2_nom,
             r2.prenom as responsable2_prenom
      FROM demande_rh d
      LEFT JOIN employees e ON d.employe_id = e.id
      LEFT JOIN employees r1 ON e.mail_responsable1 = r1.adresse_mail
      LEFT JOIN employees r2 ON e.mail_responsable2 = r2.adresse_mail
      WHERE d.id = $1
    `,
      [id]
    );

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

    const result = await pool.query(
      `
      INSERT INTO demande_rh (
        employe_id, type_demande, titre, type_conge, type_conge_autre,
        date_depart, date_retour, heure_depart, heure_retour,
        demi_journee, frais_deplacement, commentaire_refus, statut,
        created_at, updated_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, 'en_attente', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
      RETURNING *
    `,
      [
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
      ]
    );

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

    let finalStatut = statut;
    
    if (approuve_responsable1 === false || approuve_responsable2 === false) {
      finalStatut = 'refuse';
    } else if (approuve_responsable1 === true && approuve_responsable2 === true) {
      finalStatut = 'approuve';
    } else if (approuve_responsable1 === true && !approuve_responsable2) {
      const employeeResult = await pool.query(
        'SELECT mail_responsable2 FROM employees WHERE id = (SELECT employe_id FROM demande_rh WHERE id = $1)',
        [id]
      );
      
      if (employeeResult.rows.length > 0 && !employeeResult.rows[0].mail_responsable2) {
        finalStatut = 'approuve';
      } else {
        finalStatut = 'en_attente';
      }
    } else if (approuve_responsable2 === true && !approuve_responsable1) {
      finalStatut = 'en_attente';
    } else {
      finalStatut = finalStatut || 'en_attente';
    }

    const result = await pool.query(
      `
      UPDATE demande_rh 
      SET type_demande = $1, titre = $2, type_conge = $3, type_conge_autre = $4,
          date_depart = $5, date_retour = $6, heure_depart = $7, heure_retour = $8,
          demi_journee = $9, frais_deplacement = $10, statut = $11,
          approuve_responsable1 = $12, approuve_responsable2 = $13,
          commentaire_refus = $14, updated_at = CURRENT_TIMESTAMP
      WHERE id = $15
      RETURNING *
    `,
      [
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
        finalStatut,
        approuve_responsable1 || false,
        approuve_responsable2 || false,
        commentaire_refus || null,
        id
      ]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Demande non trouvée' });
    }

    console.log('✅ Demande mise à jour - Statut:', finalStatut);
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

    const result = await pool.query(
      `
      UPDATE demande_rh 
      SET statut = $1, commentaire_refus = $2, updated_at = CURRENT_TIMESTAMP
      WHERE id = $3
      RETURNING *
    `,
      [statut, commentaire_refus || null, id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Demande non trouvé' });
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

    const result = await pool.query(
      'DELETE FROM demande_rh WHERE id = $1 RETURNING *',
      [id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Demande non trouvée' });
    }

    console.log('✅ Demande supprimée');
    res.json({
      message: 'Demande supprimée avec succès',
      deleted: result.rows[0]
    });
  } catch (error) {
    console.error('❌ Erreur suppression demande:', error);
    res.status(500).json({
      error: 'Erreur lors de la suppression de la demande',
      message: error.message
    });
  }
});

// ==================================================
// =================== MODULE VISA ==================
// ==================================================

const { types } = require("pg");
types.setTypeParser(1082, (val) => val);

const PizZip = require("pizzip");
const Docxtemplater = require("docxtemplater");

const ASSURANCE_REQUEST_TO = process.env.ASSURANCE_REQUEST_TO || "ons.ghariani@avocarbon.com";
const BILLET_REQUEST_TO = process.env.BILLET_REQUEST_TO || "ons.ghariani@avocarbon.com";

// ==================================================
// STOCKAGE VISA
// - visa-pdfs : uploads PDF (user)
// - visa-generated : docs générés (DOCX)
// ==================================================
const visaPdfDir = path.join(__dirname, "uploads", "visa-pdfs");
const visaGeneratedDir = path.join(__dirname, "uploads", "visa-generated");

for (const dir of [visaPdfDir, visaGeneratedDir]) {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
    console.log(`📁 Dossier VISA créé: ${dir}`);
  }
}

// ==================================================
// ROUTES POUR SERVIR LES FICHIERS VISA
// ==================================================
app.get("/api/visa-pdfs/:filename", (req, res) => {
  try {
    const filename = path.basename(req.params.filename);
    const filePath = path.join(visaPdfDir, filename);

    if (!fs.existsSync(filePath)) {
      return res.status(404).json({ error: "PDF VISA non trouvé" });
    }

    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `inline; filename="${filename}"`);
    return res.sendFile(filePath);
  } catch (error) {
    console.error("❌ Erreur service PDF VISA:", error);
    return res.status(500).json({ error: "Erreur lors du chargement du PDF VISA" });
  }
});

app.get("/api/visa-generated/:filename", (req, res) => {
  try {
    const filename = path.basename(req.params.filename);
    const filePath = path.join(visaGeneratedDir, filename);

    if (!fs.existsSync(filePath)) {
      return res.status(404).json({ error: "Fichier VISA généré introuvable" });
    }

    const ext = path.extname(filename).toLowerCase();
    const contentType =
      ext === ".docx"
        ? "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
        : "application/octet-stream";

    res.setHeader("Content-Type", contentType);
    res.setHeader("Content-Disposition", `inline; filename="${filename}"`);
    return res.sendFile(filePath);
  } catch (error) {
    console.error("❌ Erreur service VISA generated:", error);
    return res.status(500).json({ error: "Erreur lors du chargement du fichier VISA" });
  }
});

function buildVisaPdfUrl(filename) {
  const baseUrl = process.env.BACKEND_URL || `https://backend-rh.azurewebsites.net`;
  return `${baseUrl}/api/visa-pdfs/${filename}`;
}

function buildVisaGeneratedUrl(filename) {
  const baseUrl = process.env.BACKEND_URL || `https://backend-rh.azurewebsites.net`;
  return `${baseUrl}/api/visa-generated/${filename}`;
}

// ==================================================
// MULTER VISA (UPLOAD PDF only) — FormData field = pdfFile
// ==================================================
const visaPdfStorage = multer.diskStorage({
  destination: function (req, file, cb) {
    cb(null, visaPdfDir);
  },
  filename: function (req, file, cb) {
    const originalName = path.basename(file.originalname || "visa.pdf");

    const safeName = originalName
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/[^a-zA-Z0-9.\-_]/g, "_")
      .replace(/_+/g, "_")
      .replace(/^_|_$/g, "");

    const ext = (path.extname(safeName) || ".pdf").toLowerCase();
    const base = path.basename(safeName, ext) || "visa";

    cb(null, `${base}${ext}`);
  },
});

const visaPdfUpload = multer({
  storage: visaPdfStorage,
  limits: { fileSize: 200 * 1024 * 1024 }, // 200MB
  fileFilter: function (req, file, cb) {
    if (file.mimetype === "application/pdf") cb(null, true);
    else cb(new Error("Seuls les fichiers PDF sont autorisés!"), false);
  },
});

// ==================================================
// TEMPLATE DOCUMENTS VISA
// ==================================================
function createDocumentsTemplate() {
  return [
    { code: "PASSEPORT_ORIGINAL", label: "Passeport (original)", mode: "PHYSICAL" },
    { code: "PHOTOS", label: "2 photos d'identité", mode: "PHYSICAL" },
    { code: "COPIE_PAGE_1_PASSEPORT", label: "Copie page 1 passeport", mode: "PHYSICAL" },
    { code: "CNSS", label: "Copie Historique CNSS", mode: "UPLOAD" },
    { code: "FICHES_PAIE", label: "3 dernières fiches de paie", mode: "UPLOAD" },

    { code: "ATTESTATION_TRAVAIL", label: "Attestation de travail", mode: "UPLOAD" },
    { code: "ORDRE_MISSION", label: "Ordre de mission", mode: "UPLOAD" },
    { code: "INVITATION", label: "Invitation + prise en charge", mode: "UPLOAD" },
    { code: "FRAIS_VISA", label: "Recepissé", mode: "UPLOAD" },

    { code: "ASSURANCE", label: "Assurance voyage", mode: "UPLOAD" },
    { code: "BILLET_AVION", label: "Billet d'avion", mode: "UPLOAD" },
    { code: "RESERVATION_HOTEL", label: "Réservation d'hôtel", mode: "UPLOAD" },
  ];
}

function safeFilename(str) {
  return String(str || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9_-]+/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_|_$/g, "");
}

function formatDateFR(d) {
  if (!d) return "";
  return new Date(d).toLocaleDateString("fr-FR");
}

// ==================================================
// HELPERS DB VISA
// ==================================================
async function getEmployeeByIdVisa(employeId) {
  const result = await pool.query(
    `SELECT id, nom, prenom, adresse_mail, date_naissance, cin, date_debut, poste, passeport, date_expiration_passport
     FROM employees WHERE id = $1`,
    [employeId]
  );
  if (result.rows.length === 0) throw new Error("Employé non trouvé");
  return result.rows[0];
}

async function getDossierEmailContext(dossierId) {
  const r = await pool.query(
    `SELECT d.id as dossier_id, d.date_depart, d.date_retour, d.motif_deplacement,
            e.id as employee_id, e.prenom, e.nom
     FROM visa_dossiers d
     JOIN employees e ON e.id = d.employee_id
     WHERE d.id = $1`,
    [dossierId]
  );
  if (!r.rows.length) throw new Error("Dossier introuvable");
  const row = r.rows[0];

  return {
    dossierId: row.dossier_id,
    employeeId: row.employee_id,
    employeeName: `${row.prenom} ${row.nom}`,
    departureDate: row.date_depart,
    returnDate: row.date_retour,
    motif: row.motif_deplacement,
  };
}

// ==================================================
// EMAILS VISA (utilise emailTransporter EXISTANT)
// ==================================================
async function sendVisaDossierCreationEmail({ to, employeeName }) {
  if (!to) throw new Error("Email employé manquant");

  const subject = `Dossier Visa – Documents à fournir (${employeeName})`;
  const html = `
    <div style="font-family: Arial, sans-serif; line-height:1.6">
      <p>Bonjour <b>${employeeName}</b>,</p>
      <p>Votre <b>dossier visa</b> a été créé. Merci de préparer les éléments suivants :</p>
      <ul>
        <li><b>Ramener votre passeport (original)</b></li>
        <li><b>Ramener une copie de la page 1 du passeport</b></li>
        <li><b>Ramener 2 photos d'identité</b></li>
        <li><b>Envoyer par mail une copie de l’historique CNSS</b> à
          <a href="mailto:${EMAIL_FROM}">${EMAIL_FROM}</a>
        </li>
      </ul>
      <p>Merci,<br/>${EMAIL_FROM_NAME}</p>
    </div>
  `;

  return emailTransporter.sendMail({
    from: `"${EMAIL_FROM_NAME}" <${EMAIL_FROM}>`,
    to,
    subject,
    html,
  });
}

async function sendAssuranceRequestEmail({ to, employeeName, departureDate, returnDate }) {
  const subject = `Demande Assurance Voyage – ${employeeName}`;
  const html = `
    <div style="font-family: Arial, sans-serif; line-height:1.6">
      <p>Bonjour,</p>
      <p>Merci de <b>fournir l’assurance voyage</b> pour :</p>
      <p>
        <b>Employé :</b> ${employeeName}<br/>
        <b>Date départ :</b> ${departureDate}<br/>
        <b>Date retour :</b> ${returnDate}
      </p>
      <p>Merci,<br/>${EMAIL_FROM_NAME}</p>
    </div>
  `;

  return emailTransporter.sendMail({
    from: `"${EMAIL_FROM_NAME}" <${EMAIL_FROM}>`,
    to,
    subject,
    html,
  });
}

async function sendBilletRequestEmail({ to, employeeName, departureDate, returnDate }) {
  const subject = `Demande Billet d’avion – ${employeeName}`;
  const html = `
    <div style="font-family: Arial, sans-serif; line-height:1.6">
      <p>Bonjour,</p>
      <p>Merci de <b>fournir le billet d’avion</b> pour :</p>
      <p>
        <b>Employé :</b> ${employeeName}<br/>
        <b>Date départ :</b> ${departureDate}<br/>
        <b>Date retour :</b> ${returnDate}
      </p>
      <p>Merci,<br/>${EMAIL_FROM_NAME}</p>
    </div>
  `;

  return emailTransporter.sendMail({
    from: `"${EMAIL_FROM_NAME}" <${EMAIL_FROM}>`,
    to,
    subject,
    html,
  });
}

// ==================================================
// GÉNÉRATION DOCX (SANS LIBREOFFICE)
// ==================================================
function replacePlaceholders(zip, replacements) {
  const files = zip.files;
  Object.keys(files).forEach((fileName) => {
    if (!fileName.endsWith(".xml")) return;
    let xml = files[fileName].asText();
    for (const key in replacements) {
      const value = replacements[key] == null ? "" : String(replacements[key]);
      const regex = new RegExp("\\[" + key + "\\]", "g");
      xml = xml.replace(regex, value);
    }
    zip.file(fileName, xml);
  });
}

function generateDocxFromTemplate(templatePath, replacements) {
  if (!fs.existsSync(templatePath)) {
    throw new Error("Fichier modèle introuvable : " + templatePath);
  }
  const content = fs.readFileSync(templatePath, "binary");
  const zip = new PizZip(content);
  replacePlaceholders(zip, replacements);

  const doc = new Docxtemplater(zip, { paragraphLoop: true, linebreaks: true });
  doc.render();

  return doc.getZip().generate({ type: "nodebuffer" });
}

async function generateDocumentDOCX(templateName, replacements, baseFilename, nomComplet) {
  const templatePath = path.join(__dirname, "templates", templateName);
  const docxBuffer = generateDocxFromTemplate(templatePath, replacements);

  const employeePart = safeFilename(nomComplet);
  const date = new Date().toISOString().split("T")[0];
  const filename = `${baseFilename}_${employeePart}_${date}.docx`;

  return { buffer: docxBuffer, filename };
}

async function saveGeneratedDocxAndUpdateDoc({ buffer, filename, docId }) {
  const outPath = path.join(visaGeneratedDir, filename);
  fs.writeFileSync(outPath, buffer);

  const fileUrl = buildVisaGeneratedUrl(filename);

  await pool.query(
    `UPDATE visa_documents
     SET statut = 'UPLOADED',
         file_url = $1,
         original_filename = $2,
         updated_at = now()
     WHERE id = $3`,
    [fileUrl, filename, docId]
  );

  return { fileUrl };
}

// ==================================================
// API Employees (liste employés actifs)
// ==================================================
app.get("/api/employee", authenticateToken, async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT id, nom, prenom, poste, statut
       FROM employees
       WHERE statut = 'actif'
       ORDER BY nom, prenom`
    );
    res.json(result.rows);
  } catch (err) {
    console.error("❌ /api/employee error:", err);
    res.status(500).json({ message: err.message });
  }
});


// ==================================================
// ===================== ROUTES VISA =================
// ==================================================

// Liste dossiers VISA
app.get("/api/visa-dossiers", authenticateToken, async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT 
        d.id,
        d.employee_id,
        d.date_depart,
        d.date_retour,
        d.motif_deplacement,
        d.statut,
        d.numero_visa,
        d.visa_date_debut,
        d.visa_date_fin,
        d.created_at,
        d.updated_at,
        e.prenom,
        e.nom,
        e.poste,
        COUNT(vd.id)::int AS total_docs,
        COALESCE(SUM(
          CASE
            WHEN vd.mode = 'UPLOAD'  AND vd.statut = 'UPLOADED' THEN 1
            WHEN vd.mode = 'PHYSICAL' AND vd.statut = 'RECEIVED_PHYSICAL' THEN 1
            ELSE 0
          END
        ), 0)::int AS ok_docs
      FROM visa_dossiers d
      JOIN employees e ON e.id = d.employee_id
      LEFT JOIN visa_documents vd ON vd.dossier_id = d.id
      GROUP BY d.id, e.prenom, e.nom, e.poste
      ORDER BY d.created_at DESC
    `);

    const dossiers = result.rows.map((r) => {
      const totalDocs = Number(r.total_docs || 0);
      const okDocs = Number(r.ok_docs || 0);
      const percent = totalDocs > 0 ? Math.round((okDocs / totalDocs) * 100) : 0;

      return {
        id: r.id,
        employee: {
          id: r.employee_id,
          name: `${r.prenom} ${r.nom}`,
          poste: r.poste || "",
          department: r.departement || "",
        },
        departureDate: r.date_depart,
        returnDate: r.date_retour,
        motif: r.motif_deplacement,
        status: r.statut,
        visa: {
          numero: r.numero_visa,
          dateDebut: r.visa_date_debut,
          dateFin: r.visa_date_fin,
        },
        progress: { okDocs, totalDocs, percent },
        createdAt: r.created_at,
        updatedAt: r.updated_at,
      };
    });

    res.json(dossiers);
  } catch (err) {
    console.error("❌ /api/visa-dossiers error:", err);
    res.status(500).json({ message: err.message });
  }
});

// Dossier VISA détail
app.get("/api/visa-dossiers/:id", authenticateToken, async (req, res) => {
  const dossierId = Number(req.params.id);
  try {
    const dRes = await pool.query(
      `SELECT d.*, e.prenom, e.nom, e.poste
       FROM visa_dossiers d
       JOIN employees e ON e.id = d.employee_id
       WHERE d.id = $1`,
      [dossierId]
    );
    if (!dRes.rows.length) return res.status(404).json({ message: "Dossier introuvable" });

    const r = dRes.rows[0];

    const docsRes = await pool.query(
      `SELECT *
       FROM visa_documents
       WHERE dossier_id = $1
       ORDER BY id`,
      [dossierId]
    );

    const dossier = {
      id: r.id,
      employee: {
        id: r.employee_id,
        name: `${r.prenom} ${r.nom}`,
        poste: r.poste || "",
        department: r.departement || "",
      },
      departureDate: r.date_depart,
      returnDate: r.date_retour,
      motif: r.motif_deplacement,
      status: r.statut,
      documents: docsRes.rows.map((d) => ({
        id: d.id,
        code: d.code,
        label: d.label,
        mode: d.mode,
        status: d.statut,
        fileUrl: d.file_url,
        originalFilename: d.original_filename,
      })),
    };

    res.json(dossier);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// Créer dossier VISA + template + email employé
app.post("/api/visa-dossiers", authenticateToken, async (req, res) => {
  const { employeeId, motif, departureDate, returnDate } = req.body;

  if (!employeeId || !motif || !departureDate || !returnDate) {
    return res.status(400).json({ message: "Champs manquants" });
  }
  if (returnDate < departureDate) {
    return res.status(400).json({ message: "date_retour doit être >= date_depart" });
  }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    const dIns = await client.query(
      `INSERT INTO visa_dossiers (employee_id, motif_deplacement, date_depart, date_retour)
       VALUES ($1,$2,$3,$4)
       RETURNING id`,
      [employeeId, motif, departureDate, returnDate]
    );
    const dossierId = dIns.rows[0].id;

    const template = createDocumentsTemplate();
    for (const doc of template) {
      await client.query(
        `INSERT INTO visa_documents (dossier_id, code, label, mode, statut)
         VALUES ($1,$2,$3,$4,'MISSING')`,
        [dossierId, doc.code, doc.label, doc.mode]
      );
    }

    await client.query("COMMIT");

    let emailSent = false;
    let emailError = null;

    try {
      const emp = await getEmployeeByIdVisa(employeeId);
      await sendVisaDossierCreationEmail({
        to: emp.adresse_mail,
        employeeName: `${emp.prenom} ${emp.nom}`,
      });
      emailSent = true;
    } catch (e) {
      emailError = e.message;
      console.error("❌ Erreur envoi email dossier:", e.message);
    }

    res.json({ id: dossierId, emailSent, emailError });
  } catch (err) {
    await client.query("ROLLBACK");
    res.status(500).json({ message: err.message });
  } finally {
    client.release();
  }
});

// Upload document VISA (PDF) — FormData field = pdfFile
app.post(
  "/api/visa-documents/:id/upload",
  authenticateToken,
  visaPdfUpload.single("pdfFile"),
  async (req, res) => {
    const docId = Number(req.params.id);

    try {
      if (!req.file) {
        return res.status(400).json({ success: false, error: "Aucun fichier PDF uploadé" });
      }

      const fileUrl = buildVisaPdfUrl(req.file.filename);

      await pool.query(
        `UPDATE visa_documents
         SET statut = 'UPLOADED',
             file_url = $1,
             original_filename = $2,
             updated_at = now()
         WHERE id = $3`,
        [fileUrl, req.file.originalname, docId]
      );

      return res.json({
        success: true,
        fileUrl,
        originalFilename: req.file.originalname,
        filename: req.file.filename,
      });
    } catch (err) {
      console.error("❌ upload visa doc error:", err);
      return res.status(500).json({ message: err.message });
    }
  }
);

// Mettre à jour doc (statut / url)
app.patch("/api/visa-documents/:id", authenticateToken, async (req, res) => {
  const docId = Number(req.params.id);
  const { status, fileUrl, originalFilename } = req.body;

  if (!status) return res.status(400).json({ message: "status obligatoire" });

  try {
    await pool.query(
      `UPDATE visa_documents
       SET statut = $1,
           file_url = COALESCE($2, file_url),
           original_filename = COALESCE($3, original_filename),
           updated_at = now()
       WHERE id = $4`,
      [status, fileUrl || null, originalFilename || null, docId]
    );
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// Envoyer mail assurance
app.post("/api/email/assurance", authenticateToken, async (req, res) => {
  try {
    const { dossierId } = req.body;
    if (!dossierId) return res.status(400).json({ message: "dossierId obligatoire" });

    const ctx = await getDossierEmailContext(Number(dossierId));
    await sendAssuranceRequestEmail({
      to: ASSURANCE_REQUEST_TO,
      employeeName: ctx.employeeName,
      departureDate: ctx.departureDate,
      returnDate: ctx.returnDate,
    });

    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ message: e.message });
  }
});

// Envoyer mail billet
app.post("/api/email/billet", authenticateToken, async (req, res) => {
  try {
    const { dossierId } = req.body;
    if (!dossierId) return res.status(400).json({ message: "dossierId obligatoire" });

    const ctx = await getDossierEmailContext(Number(dossierId));
    await sendBilletRequestEmail({
      to: BILLET_REQUEST_TO,
      employeeName: ctx.employeeName,
      departureDate: ctx.departureDate,
      returnDate: ctx.returnDate,
    });

    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ message: e.message });
  }
});

// Changer statut dossier VISA
app.patch("/api/visa-dossiers/:id/status", authenticateToken, async (req, res) => {
  const dossierId = Number(req.params.id);
  const { status, visaNumero, visaDateDebut, visaDateFin } = req.body;

  if (!status) return res.status(400).json({ message: "status obligatoire" });

  try {
    await pool.query(
      `UPDATE visa_dossiers
       SET statut = $1,
           numero_visa = COALESCE($2, numero_visa),
           visa_date_debut = COALESCE($3, visa_date_debut),
           visa_date_fin = COALESCE($4, visa_date_fin),
           updated_at = now()
       WHERE id = $5`,
      [status, visaNumero || null, visaDateDebut || null, visaDateFin || null, dossierId]
    );
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// ==================================================
// ✅ ROUTES GÉNÉRATION (DOCX) — sans LibreOffice
// ==================================================

// Générer attestation de travail (DOCX)
app.post("/api/attestation-travail", authenticateToken, async (req, res) => {
  const { employeId, docId } = req.body;
  if (!employeId || !docId) return res.status(400).json({ message: "employeId et docId obligatoires" });

  try {
    const emp = await getEmployeeByIdVisa(employeId);
    const nomComplet = `${emp.prenom} ${emp.nom}`;
    const todayStr = new Date().toLocaleDateString("fr-FR");

    const replacements = {
      1: nomComplet,
      2: formatDateFR(emp.date_naissance),
      3: emp.cin || "",
      4: formatDateFR(emp.date_debut),
      5: emp.poste || "",
      6: todayStr,
    };

    const docxResult = await generateDocumentDOCX(
      "Attestation de travail Modèle IA.docx",
      replacements,
      "attestation_travail",
      nomComplet
    );

    const { fileUrl } = await saveGeneratedDocxAndUpdateDoc({
      buffer: docxResult.buffer,
      filename: docxResult.filename,
      docId,
    });

    res.json({ fileUrl, filename: docxResult.filename });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// Générer invitation + prise en charge (DOCX)
app.post("/api/invitation-prise-en-charge", authenticateToken, async (req, res) => {
  const { employeId, dateDebutSejour, dateFinSejour, docId } = req.body;
  if (!employeId || !dateDebutSejour || !dateFinSejour || !docId) {
    return res.status(400).json({ message: "employeId, dates, docId obligatoires" });
  }

  try {
    const emp = await getEmployeeByIdVisa(employeId);
    const nomComplet = `${emp.prenom} ${emp.nom}`;
    const todayStr = new Date().toLocaleDateString("fr-FR");

    const replacements = {
      1: todayStr,
      2: nomComplet,
      3: formatDateFR(dateDebutSejour),
      4: formatDateFR(dateFinSejour),
      5: nomComplet,
      6: emp.passeport || "",
      7: formatDateFR(emp.date_expiration_passport),
      8: nomComplet,
      9: nomComplet,
    };

    const docxResult = await generateDocumentDOCX(
      "Invitation et prise en charge Modèle IA.docx",
      replacements,
      "invitation_prise_en_charge",
      nomComplet
    );

    const { fileUrl } = await saveGeneratedDocxAndUpdateDoc({
      buffer: docxResult.buffer,
      filename: docxResult.filename,
      docId,
    });

    res.json({ fileUrl, filename: docxResult.filename });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// Générer ordre de mission (DOCX)
app.post("/api/ordre-mission", authenticateToken, async (req, res) => {
  const { employeId, objectifMission, dateDebutMission, dateFinMission, docId } = req.body;
  if (!employeId || !objectifMission || !dateDebutMission || !dateFinMission || !docId) {
    return res.status(400).json({ message: "champs obligatoires manquants" });
  }

  try {
    const emp = await getEmployeeByIdVisa(employeId);
    const nomComplet = `${emp.prenom} ${emp.nom}`;
    const todayStr = new Date().toLocaleDateString("fr-FR");

    const replacements = {
      1: nomComplet,
      2: emp.passeport || "",
      3: formatDateFR(emp.date_expiration_passport),
      4: emp.poste || "",
      5: objectifMission,
      6: formatDateFR(dateDebutMission),
      7: formatDateFR(dateFinMission),
      8: todayStr,
    };

    const docxResult = await generateDocumentDOCX(
      "Ordre de mission Modèle IA.docx",
      replacements,
      "ordre_mission",
      nomComplet
    );

    const { fileUrl } = await saveGeneratedDocxAndUpdateDoc({
      buffer: docxResult.buffer,
      filename: docxResult.filename,
      docId,
    });

    res.json({ fileUrl, filename: docxResult.filename });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// --------------------------------------------------
// PDF COMPLET DOSSIER VISA (fusion des PDF seulement)
// --------------------------------------------------
app.get("/api/visa-dossiers/:id/dossier-pdf", async (req, res) => {
  const dossierId = Number(req.params.id);

  try {
    const dossierRes = await pool.query(
      `SELECT e.prenom, e.nom
       FROM visa_dossiers d
       JOIN employees e ON e.id = d.employee_id
       WHERE d.id = $1`,
      [dossierId]
    );

    if (!dossierRes.rows.length) {
      return res.status(404).json({ message: "Dossier introuvable" });
    }

    const { prenom, nom } = dossierRes.rows[0];

    const docsRes = await pool.query(
      `SELECT file_url
       FROM visa_documents
       WHERE dossier_id = $1
         AND statut = 'UPLOADED'
         AND file_url IS NOT NULL
       ORDER BY id ASC`,
      [dossierId]
    );

    const docs = docsRes.rows.filter((d) =>
      String(d.file_url).toLowerCase().endsWith(".pdf")
    );

    if (!docs.length) {
      return res.status(400).json({
        message: "Aucun document PDF uploadé à fusionner pour ce dossier.",
      });
    }

    const mergedPdf = await PDFDocument.create();

    function fileUrlToLocalPath(fileUrl) {
      let pathname = fileUrl;
      if (fileUrl.startsWith("http")) {
        pathname = decodeURIComponent(new URL(fileUrl).pathname);
      }

      const prefix = "/api/visa-pdfs/";
      if (!pathname.startsWith(prefix)) {
        throw new Error(`file_url invalide (doit commencer par ${prefix})`);
      }

      const filename = pathname.replace(prefix, "");
      const localPath = path.join(visaPdfDir, filename);

      const resolved = path.resolve(localPath);
      const resolvedDir = path.resolve(visaPdfDir);
      if (!resolved.startsWith(resolvedDir)) {
        throw new Error("Chemin fichier non autorisé");
      }
      return resolved;
    }

    for (const d of docs) {
      const localPath = fileUrlToLocalPath(d.file_url);

      if (!fs.existsSync(localPath)) {
        throw new Error(`Fichier introuvable : ${localPath}`);
      }

      const pdfBytes = fs.readFileSync(localPath);
      const pdf = await PDFDocument.load(pdfBytes);

      const pages = await mergedPdf.copyPages(pdf, pdf.getPageIndices());
      pages.forEach((p) => mergedPdf.addPage(p));
    }

    const finalPdf = await mergedPdf.save();

    const employeePart = safeFilename(`${prenom}_${nom}`);
    const datePart = new Date().toISOString().slice(0, 10);
    const filename = `Dossier_Visa_${employeePart}_${datePart}.pdf`;

    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `inline; filename="${filename}"`);

    return res.send(Buffer.from(finalPdf));
  } catch (err) {
    console.error("❌ dossier-pdf error:", err);
    return res.status(500).json({
      message: err.message || "Erreur génération PDF du dossier",
    });
  }
});

// =========================
// Fallback & erreurs
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
// Démarrage serveur
// =========================

app.listen(PORT, () => {
  console.log('\n' + '='.repeat(60));
  console.log('🚀 SERVEUR RH DÉMARRÉ');
  console.log('='.repeat(60));
  console.log(`📍 Port: ${PORT}`);
  console.log(`🌐 URL: http://localhost:${PORT}`);
  console.log(`🗄️  Base: ${process.env.DB_NAME} @ ${process.env.DB_HOST}`);
  console.log(`🔐 JWT: ${process.env.JWT_SECRET ? '✅' : '⚠️'}`);
  console.log(`📧 Email: ${EMAIL_FROM}`);
  console.log(`🌍 ENV: ${process.env.NODE_ENV || 'development'}`);
  console.log('📁 Dossier photos employés:', employeePhotoDir);
  console.log('📁 Dossier PDFs:', pdfStorageDir);
  console.log('📁 Dossier Archive PDFs:', archivePdfDir);
  console.log('='.repeat(60) + '\n');
});

process.on('SIGINT', async () => {
  console.log('\n🛑 Arrêt du serveur...');
  await pool.end();
  process.exit(0);
});
