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
      matricule, nom, prenom, cin, passeport, date_naissance,
      poste, site_dep, type_contrat, date_debut, salaire_brute,
      photo, dossier_rh
    } = employeeData;

    const result = await pool.query(
      `UPDATE employees SET 
        matricule = $1, nom = $2, prenom = $3, cin = $4, passeport = $5,
        date_naissance = $6, poste = $7, site_dep = $8, type_contrat = $9,
        date_debut = $10, salaire_brute = $11, photo = $12, dossier_rh = $13,
        updated_at = CURRENT_TIMESTAMP
       WHERE id = $14 RETURNING *`,
      [
        matricule, nom, prenom, cin, passeport, date_naissance,
        poste, site_dep, type_contrat, date_debut, salaire_brute,
        photo, dossier_rh, id
      ]
    );
    return result.rows[0];
  }
};