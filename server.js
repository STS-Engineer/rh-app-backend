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
const axios = require('axios');

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

// JWT secret
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
// Configuration Multer upload (Dossier RH)
// =========================

const uploadTempDir = path.join(__dirname, 'uploads', 'temp');
const pdfStorageDir = path.join(__dirname, 'uploads', 'pdfs');

// Créer les dossiers s'ils n'existent pas
[uploadTempDir, pdfStorageDir].forEach(dir => {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
    console.log(`📁 Dossier créé: ${dir}`);
  }
});

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
    fileSize: 10 * 1024 * 1024 // 10MB max
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

const employeePhotoDir = path.join(__dirname, 'uploads', 'employee-photos');

if (!fs.existsSync(employeePhotoDir)) {
  fs.mkdirSync(employeePhotoDir, { recursive: true });
  console.log(`📁 Dossier photos employés créé: ${employeePhotoDir}`);
}

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
    fileSize: 5 * 1024 * 1024 // 5MB max
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
// Routes pour photos employés
// =========================

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

// =========================
// Routes Dossier RH
// =========================

// Upload des photos temporaires pour dossier RH
app.post(
  '/api/dossier-rh/upload-photos',
  authenticateToken,
  (req, res, next) => {
    console.log('📸 Requête reçue sur /api/dossier-rh/upload-photos');
    next();
  },
  upload.array('photos', 10),
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

// Générer le PDF et le stocker localement
app.post(
  '/api/dossier-rh/generate-pdf/:employeeId',
  authenticateToken,
  async (req, res) => {
    try {
      const { employeeId } = req.params;
      const { photos: clientPhotos, dossierName } = req.body;

      console.log('📄 Génération PDF pour employé:', employeeId, 'dossier:', dossierName);
      console.log('📸 Photos reçues du client:', clientPhotos);

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

// Génération + sauvegarde PDF local
async function generateAndSavePDF(employee, photos, dossierName) {
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
          
          const pdfUrl = await savePDFLocally(pdfBuffer, fileName);
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
}

// Sauvegarde locale du PDF
async function savePDFLocally(pdfBuffer, fileName) {
  try {
    const filePath = path.join(pdfStorageDir, fileName);
    fs.writeFileSync(filePath, pdfBuffer);
    
    // URL accessible via une route dédiée
    const baseUrl = process.env.BACKEND_URL || 'https://backend-rh.azurewebsites.net';
    const pdfUrl = `${baseUrl}/api/pdfs/${fileName}`;
    
    console.log('✅ PDF sauvegardé:', filePath);
    console.log('🔗 URL accessible:', pdfUrl);
    
    return pdfUrl;
  } catch (error) {
    console.error('❌ Erreur sauvegarde locale PDF:', error);
    throw new Error('Impossible de sauvegarder le PDF localement');
  }
}

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
const nodemailer = require('nodemailer');

// Configuration SMTP Outlook
const transporter = nodemailer.createTransport({
  host: 'avocarbon-com.mail.protection.outlook.com',
  port: 25,
  secure: false,
  tls: { rejectUnauthorized: false }
});

// Configuration Multer pour les PDF de paie
const uploadPaieDir = path.join(__dirname, 'uploads', 'paie');
if (!fs.existsSync(uploadPaieDir)) {
  fs.mkdirSync(uploadPaieDir, { recursive: true });
  console.log(`📁 Dossier créé: ${uploadPaieDir}`);
}

const uploadPaie = multer({
  storage: multer.diskStorage({
    destination: (req, file, cb) => cb(null, uploadPaieDir),
    filename: (req, file, cb) => {
      const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1e9);
      cb(null, 'paie-' + uniqueSuffix + '.pdf');
    }
  }),
  limits: { fileSize: 50 * 1024 * 1024 }, // 50MB max
  fileFilter: (req, file, cb) => {
    if (file.mimetype === 'application/pdf') {
      cb(null, true);
    } else {
      cb(new Error('Seuls les fichiers PDF sont autorisés!'), false);
    }
  }
});

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
    await transporter.sendMail(mailOptions);
    console.log(`📧 Email envoyé à ${employe.adresse_mail}`);
  } catch (error) {
    console.error('❌ Erreur envoi email:', error);
    throw new Error(`Impossible d'envoyer l'email à ${employe.adresse_mail}: ${error.message}`);
  }
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
      'PUT  /api/employees/:id',
      'PUT  /api/employees/:id/archive',
      'POST /api/employees',
      'POST /api/employees/upload-photo', // NOUVEAU
      'GET  /api/employee-photos/:filename', // NOUVEAU
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
      photoUrl = getDefaultAvatar(nom, prenom);
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

app.get('/api/demandes', authenticateToken, async (req, res) => {
  try {
    const {
      type_demande,
      statut,
      date_debut,
      date_fin,
      employe_id,
      page = 1,
      limit = 1000
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
  console.log(`🌍 ENV: ${process.env.NODE_ENV || 'development'}`);
  console.log('📁 Dossier photos employés:', employeePhotoDir);
  console.log('📁 Dossier PDFs:', pdfStorageDir);
  console.log('='.repeat(60) + '\n');
});

process.on('SIGINT', async () => {
  console.log('\n🛑 Arrêt du serveur...');
  await pool.end();
  process.exit(0);
});
