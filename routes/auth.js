import express from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import pool from '../config/database.js';

const router = express.Router();

// ✅ Strongly recommended: require JWT_SECRET in production
const JWT_SECRET = process.env.JWT_SECRET || 'votre_secret_jwt_temporaire';

router.post('/login', async (req, res) => {
  try {
    const { email, password, rememberMe } = req.body;

    console.log('🔐 Tentative de connexion:', email);

    if (!email || !password) {
      return res.status(400).json({
        success: false,
        message: 'Email et mot de passe requis'
      });
    }

    const result = await pool.query('SELECT * FROM users WHERE email = $1', [email]);
    const user = result.rows[0];

    if (!user) {
      console.log('❌ Utilisateur non trouvé:', email);
      return res.status(401).json({
        success: false,
        message: 'Email ou mot de passe incorrect'
      });
    }

    console.log('👤 Utilisateur trouvé, vérification du mot de passe...');

    const isPasswordValid = await bcrypt.compare(password, user.password);

    if (!isPasswordValid) {
      console.log('❌ Mot de passe incorrect pour:', email);
      return res.status(401).json({
        success: false,
        message: 'Email ou mot de passe incorrect'
      });
    }

    // ✅ Remember me: 30 days, else 24 hours
    const expiresIn = rememberMe ? '30d' : '24h';

    const token = jwt.sign(
      { userId: user.id, email: user.email },
      JWT_SECRET,
      { expiresIn }
    );

    console.log('✅ Connexion réussie pour:', email);

    return res.json({
      success: true,
      token,
      expiresIn,
      user: {
        id: user.id,
        email: user.email
      }
    });
  } catch (error) {
    console.error('💥 Erreur lors de la connexion:', error);

    if (error.code === '28P01') {
      return res.status(500).json({
        success: false,
        message: 'Erreur de connexion à la base de données'
      });
    }

    return res.status(500).json({
      success: false,
      message: 'Erreur serveur lors de la connexion'
    });
  }
});

// Route pour vérifier la santé de l'API
router.get('/health', async (req, res) => {
  try {
    await pool.query('SELECT 1');
    res.json({
      status: 'OK',
      database: 'Connected',
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    res.status(500).json({
      status: 'Error',
      database: 'Disconnected',
      error: error.message
    });
  }
});

export default router;
