const express = require('express');
const router = express.Router();
const { Pool } = require('pg');
const authenticateToken = require('../middleware/auth');

const pool = new Pool({
  user: process.env.DB_USER,
  host: process.env.DB_HOST,
  database: process.env.DB_NAME,
  password: process.env.DB_PASSWORD,
  port: Number(process.env.DB_PORT || 5432),
  ssl: { require: true, rejectUnauthorized: false }
});

// GET toutes les demandes RH avec filtres
router.get('/', authenticateToken, async (req, res) => {
  try {
    const {
      type_demande,
      statut,
      date_debut,
      date_fin,
      employe_id,
      page = 1,
      limit = 50
    } = req.query;

    console.log('🔍 Filtres reçus dans /api/demandes:', {
      type_demande,
      statut,
      date_debut,
      date_fin,
      employe_id,
      page,
      limit
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
        -- Récupérer les infos du responsable 1
        r1.nom as responsable1_nom,
        r1.prenom as responsable1_prenom,
        -- Récupérer les infos du responsable 2
        r2.nom as responsable2_nom,
        r2.prenom as responsable2_prenom
      FROM demande_rh d
      LEFT JOIN employees e ON d.employe_id = e.id
      -- Jointure pour le responsable 1
      LEFT JOIN employees r1 ON e.mail_responsable1 = r1.adresse_mail
      -- Jointure pour le responsable 2
      LEFT JOIN employees r2 ON e.mail_responsable2 = r2.adresse_mail
      WHERE 1=1
    `;
    const params = [];
    let paramCount = 0;

    // Filtres avec debug détaillé
    if (type_demande && type_demande !== '') {
      console.log('🎯 Appliquer filtre type_demande:', type_demande);
      paramCount++;
      query += ` AND d.type_demande = $${paramCount}`;
      params.push(type_demande);
    } else {
      console.log('🎯 Pas de filtre type_demande ou valeur vide');
    }

    if (statut && statut !== '') {
      console.log('🎯 Appliquer filtre statut:', statut);
      paramCount++;
      query += ` AND d.statut = $${paramCount}`;
      params.push(statut);
    } else {
      console.log('🎯 Pas de filtre statut ou valeur vide');
    }

    if (employe_id && employe_id !== '') {
      console.log('🎯 Appliquer filtre employe_id:', employe_id);
      paramCount++;
      query += ` AND d.employe_id = $${paramCount}`;
      params.push(employe_id);
    } else {
      console.log('🎯 Pas de filtre employe_id ou valeur vide');
    }

    if (date_debut && date_fin && date_debut !== '' && date_fin !== '') {
      console.log('🎯 Appliquer filtre dates:', date_debut, '->', date_fin);
      paramCount++;
      query += ` AND d.date_depart BETWEEN $${paramCount}`;
      params.push(date_debut);
      paramCount++;
      query += ` AND $${paramCount}`;
      params.push(date_fin);
    } else {
      console.log('🎯 Pas de filtre dates ou dates incomplètes');
    }

    console.log('📊 Requête SQL finale:', query);
    console.log('📊 Paramètres SQL:', params);

    // Ordre et pagination
    const offset = (parseInt(page) - 1) * parseInt(limit);
    query += ` ORDER BY d.created_at DESC LIMIT $${paramCount + 1} OFFSET $${paramCount + 2}`;
    params.push(parseInt(limit), offset);

    console.log('📊 Pagination - limit:', limit, 'offset:', offset);

    const result = await pool.query(query, params);
    console.log(`✅ ${result.rows.length} demandes récupérées`);

    // Debug des données récupérées
    if (result.rows.length > 0) {
      const typesRecuperes = [...new Set(result.rows.map(d => d.type_demande))];
      const statutsRecuperes = [...new Set(result.rows.map(d => d.statut))];
      console.log('📋 Types de demandes récupérés:', typesRecuperes);
      console.log('📋 Statuts récupérés:', statutsRecuperes);
      
      // Afficher les premières données pour debug
      console.log('🐛 Échantillon des données récupérées:');
      result.rows.slice(0, 3).forEach((demande, index) => {
        console.log(`  Demande ${index + 1}:`, {
          id: demande.id,
          type_demande: demande.type_demande,
          statut: demande.statut,
          employe: `${demande.employe_prenom} ${demande.employe_nom}`,
          mail_responsable1: demande.mail_responsable1,
          mail_responsable2: demande.mail_responsable2,
          responsable1: `${demande.responsable1_prenom} ${demande.responsable1_nom}`,
          responsable2: `${demande.responsable2_prenom} ${demande.responsable2_nom}`,
          approuve_responsable1: demande.approuve_responsable1,
          approuve_responsable2: demande.approuve_responsable2
        });
      });
    } else {
      console.log('📭 Aucune demande récupérée avec les filtres actuels');
    }

    // Count pour la pagination (identique aux filtres de la requête principale)
    let countQuery = `SELECT COUNT(*) FROM demande_rh d WHERE 1=1`;
    const countParams = [];
    let countParamCount = 0;

    if (type_demande && type_demande !== '') {
      countParamCount++;
      countQuery += ` AND d.type_demande = $${countParamCount}`;
      countParams.push(type_demande);
    }

    if (statut && statut !== '') {
      countParamCount++;
      countQuery += ` AND d.statut = $${countParamCount}`;
      countParams.push(statut);
    }

    if (employe_id && employe_id !== '') {
      countParamCount++;
      countQuery += ` AND d.employe_id = $${countParamCount}`;
      countParams.push(employe_id);
    }

    if (date_debut && date_fin && date_debut !== '' && date_fin !== '') {
      countParamCount++;
      countQuery += ` AND d.date_depart BETWEEN $${countParamCount}`;
      countParams.push(date_debut);
      countParamCount++;
      countQuery += ` AND $${countParamCount}`;
      countParams.push(date_fin);
    }

    console.log('📊 Count query:', countQuery);
    console.log('📊 Count params:', countParams);

    const countResult = await pool.query(countQuery, countParams);
    const total = parseInt(countResult.rows[0].count);

    console.log(`📊 Total demandes avec filtres: ${total}`);

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
      message: error.message,
      details: error.detail
    });
  }
});

// GET une demande spécifique
router.get('/:id', authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;
    console.log('📄 Récupération demande spécifique ID:', id);
    
    const result = await pool.query(`
      SELECT 
        d.*, 
        e.nom as employe_nom, 
        e.prenom as employe_prenom,
        e.poste as employe_poste,
        e.photo as employe_photo,
        e.matricule as employe_matricule,
        e.mail_responsable1,
        e.mail_responsable2,
        -- Récupérer les infos du responsable 1
        r1.nom as responsable1_nom,
        r1.prenom as responsable1_prenom,
        -- Récupérer les infos du responsable 2
        r2.nom as responsable2_nom,
        r2.prenom as responsable2_prenom
      FROM demande_rh d
      LEFT JOIN employees e ON d.employe_id = e.id
      -- Jointure pour le responsable 1
      LEFT JOIN employees r1 ON e.mail_responsable1 = r1.adresse_mail
      -- Jointure pour le responsable 2
      LEFT JOIN employees r2 ON e.mail_responsable2 = r2.adresse_mail
      WHERE d.id = $1
    `, [id]);

    if (result.rows.length === 0) {
      console.log('❌ Demande non trouvée ID:', id);
      return res.status(404).json({ error: 'Demande non trouvée' });
    }

    console.log('✅ Demande récupérée:', result.rows[0].id);
    res.json(result.rows[0]);
  } catch (error) {
    console.error('❌ Erreur récupération demande spécifique:', error);
    res.status(500).json({ 
      error: 'Erreur lors de la récupération de la demande',
      message: error.message 
    });
  }
});

// POST nouvelle demande
router.post('/', authenticateToken, async (req, res) => {
  try {
    console.log('➕ Création nouvelle demande RH');
    console.log('📦 Données reçues:', req.body);

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

    // Validation des champs obligatoires
    if (!employe_id || !type_demande || !titre) {
      console.log('❌ Champs obligatoires manquants');
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
      message: error.message,
      detail: error.detail
    });
  }
});

// PUT mise à jour demande
router.put('/:id', authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;
    console.log('✏️ Mise à jour demande ID:', id);
    console.log('📦 Données de mise à jour:', req.body);

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
      console.log('❌ Demande non trouvée pour mise à jour ID:', id);
      return res.status(404).json({ error: 'Demande non trouvée' });
    }

    console.log('✅ Demande mise à jour ID:', id);
    res.json(result.rows[0]);
  } catch (error) {
    console.error('❌ Erreur mise à jour demande:', error);
    res.status(500).json({ 
      error: 'Erreur lors de la mise à jour de la demande',
      message: error.message 
    });
  }
});

// PUT statut demande
router.put('/:id/statut', authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;
    const { statut, commentaire_refus } = req.body;

    console.log('🔄 Changement statut demande ID:', id, '->', statut);
    console.log('📦 Données statut:', { statut, commentaire_refus });

    const result = await pool.query(`
      UPDATE demande_rh 
      SET statut = $1, commentaire_refus = $2, updated_at = CURRENT_TIMESTAMP
      WHERE id = $3
      RETURNING *
    `, [statut, commentaire_refus || null, id]);

    if (result.rows.length === 0) {
      console.log('❌ Demande non trouvée pour changement statut ID:', id);
      return res.status(404).json({ error: 'Demande non trouvée' });
    }

    console.log('✅ Statut demande mis à jour ID:', id);
    res.json(result.rows[0]);
  } catch (error) {
    console.error('❌ Erreur changement statut:', error);
    res.status(500).json({ 
      error: 'Erreur lors du changement de statut',
      message: error.message 
    });
  }
});

// PUT approbation responsable 1
router.put('/:id/approbation/responsable1', authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;
    const { approuve } = req.body;

    console.log('👤 Approbation responsable 1 demande ID:', id, '->', approuve);

    const result = await pool.query(`
      UPDATE demande_rh 
      SET approuve_responsable1 = $1, updated_at = CURRENT_TIMESTAMP
      WHERE id = $2
      RETURNING *
    `, [approuve, id]);

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Demande non trouvée' });
    }

    console.log('✅ Approbation responsable 1 mise à jour');
    res.json(result.rows[0]);
  } catch (error) {
    console.error('❌ Erreur approbation responsable 1:', error);
    res.status(500).json({ 
      error: 'Erreur lors de l\'approbation du responsable 1',
      message: error.message 
    });
  }
});

// PUT approbation responsable 2
router.put('/:id/approbation/responsable2', authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;
    const { approuve } = req.body;

    console.log('👤 Approbation responsable 2 demande ID:', id, '->', approuve);

    const result = await pool.query(`
      UPDATE demande_rh 
      SET approuve_responsable2 = $1, updated_at = CURRENT_TIMESTAMP
      WHERE id = $2
      RETURNING *
    `, [approuve, id]);

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Demande non trouvée' });
    }

    console.log('✅ Approbation responsable 2 mise à jour');
    res.json(result.rows[0]);
  } catch (error) {
    console.error('❌ Erreur approbation responsable 2:', error);
    res.status(500).json({ 
      error: 'Erreur lors de l\'approbation du responsable 2',
      message: error.message 
    });
  }
});

// DELETE demande
router.delete('/:id', authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;
    console.log('🗑️ Suppression demande ID:', id);
    
    const result = await pool.query('DELETE FROM demande_rh WHERE id = $1 RETURNING *', [id]);

    if (result.rows.length === 0) {
      console.log('❌ Demande non trouvée pour suppression ID:', id);
      return res.status(404).json({ error: 'Demande non trouvée' });
    }

    console.log('✅ Demande supprimée ID:', id);
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

// GET statistiques des demandes
router.get('/stats/general', authenticateToken, async (req, res) => {
  try {
    console.log('📊 Récupération statistiques générales');

    const statsResult = await pool.query(`
      SELECT 
        COUNT(*) as total,
        COUNT(CASE WHEN statut = 'en_attente' THEN 1 END) as en_attente,
        COUNT(CASE WHEN statut = 'approuve' THEN 1 END) as approuve,
        COUNT(CASE WHEN statut = 'refuse' THEN 1 END) as refuse,
        COUNT(CASE WHEN statut = 'en_cours' THEN 1 END) as en_cours,
        COUNT(CASE WHEN type_demande = 'congé' THEN 1 END) as conges,
        COUNT(CASE WHEN type_demande = 'autorisation_absence' THEN 1 END) as absences,
        COUNT(CASE WHEN type_demande = 'frais_deplacement' THEN 1 END) as frais,
        COUNT(CASE WHEN type_demande = 'autre' THEN 1 END) as autres
      FROM demande_rh
    `);

    const stats = statsResult.rows[0];
    console.log('✅ Statistiques récupérées:', stats);

    res.json(stats);
  } catch (error) {
    console.error('❌ Erreur récupération statistiques:', error);
    res.status(500).json({ 
      error: 'Erreur lors de la récupération des statistiques',
      message: error.message 
    });
  }
});

module.exports = router;
