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
      limit = 10
    } = req.query;

    let query = `
      SELECT d.*, 
             e.nom as employe_nom, 
             e.prenom as employe_prenom,
             e.poste as employe_poste,
             e.photo as employe_photo
      FROM demande_rh d
      LEFT JOIN employees e ON d.employe_id = e.id
      WHERE 1=1
    `;
    const params = [];
    let paramCount = 0;

    // Filtres
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

    // Ordre et pagination
    query += ` ORDER BY d.created_at DESC LIMIT $${paramCount + 1} OFFSET $${paramCount + 2}`;
    params.push(limit, (page - 1) * limit);

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
    console.error('Erreur récupération demandes:', error);
    res.status(500).json({ error: 'Erreur lors de la récupération des demandes' });
  }
});

// GET une demande spécifique
router.get('/:id', authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;
    
    const result = await pool.query(`
      SELECT d.*, 
             e.nom as employe_nom, 
             e.prenom as employe_prenom,
             e.poste as employe_poste,
             e.photo as employe_photo,
             e.matricule as employe_matricule
      FROM demande_rh d
      LEFT JOIN employees e ON d.employe_id = e.id
      WHERE d.id = $1
    `, [id]);

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Demande non trouvée' });
    }

    res.json(result.rows[0]);
  } catch (error) {
    console.error('Erreur récupération demande:', error);
    res.status(500).json({ error: 'Erreur lors de la récupération de la demande' });
  }
});

// POST nouvelle demande
router.post('/', authenticateToken, async (req, res) => {
  try {
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

    const result = await pool.query(`
      INSERT INTO demande_rh (
        employe_id, type_demande, titre, type_conge, type_conge_autre,
        date_depart, date_retour, heure_depart, heure_retour,
        demi_journee, frais_deplacement, commentaire_refus, statut
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, 'en_attente')
      RETURNING *
    `, [
      employe_id, type_demande, titre, type_conge, type_conge_autre,
      date_depart, date_retour, heure_depart, heure_retour,
      demi_journee, frais_deplacement, commentaire_refus
    ]);

    res.status(201).json(result.rows[0]);
  } catch (error) {
    console.error('Erreur création demande:', error);
    res.status(500).json({ error: 'Erreur lors de la création de la demande' });
  }
});

// PUT mise à jour demande
router.put('/:id', authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;
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
      type_demande, titre, type_conge, type_conge_autre,
      date_depart, date_retour, heure_depart, heure_retour,
      demi_journee, frais_deplacement, statut,
      approuve_responsable1, approuve_responsable2,
      commentaire_refus, id
    ]);

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Demande non trouvée' });
    }

    res.json(result.rows[0]);
  } catch (error) {
    console.error('Erreur mise à jour demande:', error);
    res.status(500).json({ error: 'Erreur lors de la mise à jour de la demande' });
  }
});

// PUT statut demande
router.put('/:id/statut', authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;
    const { statut, commentaire_refus } = req.body;

    const result = await pool.query(`
      UPDATE demande_rh 
      SET statut = $1, commentaire_refus = $2, updated_at = CURRENT_TIMESTAMP
      WHERE id = $3
      RETURNING *
    `, [statut, commentaire_refus, id]);

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Demande non trouvée' });
    }

    res.json(result.rows[0]);
  } catch (error) {
    console.error('Erreur changement statut:', error);
    res.status(500).json({ error: 'Erreur lors du changement de statut' });
  }
});

// DELETE demande
router.delete('/:id', authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;
    
    const result = await pool.query('DELETE FROM demande_rh WHERE id = $1 RETURNING *', [id]);

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Demande non trouvée' });
    }

    res.json({ message: 'Demande supprimée avec succès' });
  } catch (error) {
    console.error('Erreur suppression demande:', error);
    res.status(500).json({ error: 'Erreur lors de la suppression de la demande' });
  }
});

module.exports = router;
