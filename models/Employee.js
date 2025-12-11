import pool from '../config/database.js';

export const Employee = {
  async findAll() {
    const result = await pool.query('SELECT * FROM employees ORDER BY nom, prenom');
    return result.rows;
  },

  async findById(id) {
    const result = await pool.query('SELECT * FROM employees WHERE id = $1', [id]);
    return result.rows[0];
  },

  async searchByName(searchTerm) {
    const result = await pool.query(
      'SELECT * FROM employees WHERE nom ILIKE $1 OR prenom ILIKE $1 ORDER BY nom, prenom',
      [`%${searchTerm}%`]
    );
    return result.rows;
  },

  async update(id, employeeData) {
    const {
      matricule, nom, prenom, cin, passeport, date_emission_passport, date_expiration_passport, date_naissance,
      poste, site_dep, type_contrat, date_debut, salaire_brute,
      photo, dossier_rh
    } = employeeData;

    const result = await pool.query(
      `UPDATE employees SET 
        matricule = $1, nom = $2, prenom = $3, cin = $4, passeport = $5,
        date_emission_passport = $6, date_expiration_passport = $7, // NOUVEAU
        date_naissance = $8, poste = $9, site_dep = $10, type_contrat = $11,
        date_debut = $12, salaire_brute = $13, photo = $14, dossier_rh = $15,
        updated_at = CURRENT_TIMESTAMP
       WHERE id = $16 RETURNING *`,
      [
        matricule, nom, prenom, cin, passeport,
        date_emission_passport || null, date_expiration_passport || null, // NOUVEAU
        date_naissance, poste, site_dep, type_contrat, 
        date_debut, salaire_brute, photo, dossier_rh, 
        id
      ]
    );
    return result.rows[0];
  }
};
