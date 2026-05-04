const express = require('express');
const { getSchemaForUser, employeeScopeClause } = require('../middleware/tenantScope.cjs');

module.exports = function createTenantApi({ pool, authenticateToken }) {
  const router = express.Router();

  router.get('/employees', authenticateToken, async (req, res) => {
    try {
      const schema = getSchemaForUser(req.user);
      const scope = employeeScopeClause(req.user, 'e', 1);
      const query = `SELECT e.* FROM ${schema}.employees e WHERE (e.statut = 'actif' OR e.statut IS NULL) AND ${scope.clause} ORDER BY e.nom, e.prenom`;
      const result = await pool.query(query, scope.params);
      res.json(result.rows);
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  router.get('/france/emergency-contacts/:employeeId', authenticateToken, async (req, res) => {
    try {
      const schema = getSchemaForUser(req.user);
      if (schema !== 'schema_fr') return res.status(403).json({ error: 'France tenant only' });
      const result = await pool.query(
        `SELECT * FROM schema_fr.emergency_contacts WHERE employee_id = $1`,
        [req.params.employeeId]
      );
      res.json(result.rows[0] || null);
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  router.put('/france/emergency-contacts/:employeeId', authenticateToken, async (req, res) => {
    try {
      const schema = getSchemaForUser(req.user);
      if (schema !== 'schema_fr') return res.status(403).json({ error: 'France tenant only' });
      const { nom, prenom, relation, telephone, email } = req.body;
      const q = `
        INSERT INTO schema_fr.emergency_contacts (employee_id, nom, prenom, relation, telephone, email, updated_at)
        VALUES ($1,$2,$3,$4,$5,$6,CURRENT_TIMESTAMP)
        ON CONFLICT (employee_id) DO UPDATE SET
          nom=EXCLUDED.nom, prenom=EXCLUDED.prenom, relation=EXCLUDED.relation, telephone=EXCLUDED.telephone, email=EXCLUDED.email, updated_at=CURRENT_TIMESTAMP
        RETURNING *`;
      const result = await pool.query(q, [req.params.employeeId, nom, prenom, relation || null, telephone, email || null]);
      res.json(result.rows[0]);
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  router.put('/demandes/:id/approve-level1', authenticateToken, async (req, res) => {
    try {
      const schema = getSchemaForUser(req.user);
      const id = req.params.id;
      const d = await pool.query(
        `SELECT d.*, e.mail_responsable2 FROM ${schema}.demande_rh d JOIN ${schema}.employees e ON e.id=d.employe_id WHERE d.id=$1`,
        [id]
      );
      if (!d.rows.length) return res.status(404).json({ error: 'Demande non trouvée' });
      const hasL2 = !!d.rows[0].mail_responsable2;
      const status = hasL2 ? 'en_attente' : 'approuve';
      const upd = await pool.query(
        `UPDATE ${schema}.demande_rh SET approuve_responsable1=true, statut=$1, updated_at=CURRENT_TIMESTAMP WHERE id=$2 RETURNING *`,
        [status, id]
      );
      res.json(upd.rows[0]);
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  router.put('/demandes/:id/approve-level2', authenticateToken, async (req, res) => {
    try {
      const schema = getSchemaForUser(req.user);
      const upd = await pool.query(
        `UPDATE ${schema}.demande_rh SET approuve_responsable2=true, statut='approuve', updated_at=CURRENT_TIMESTAMP WHERE id=$1 RETURNING *`,
        [req.params.id]
      );
      if (!upd.rows.length) return res.status(404).json({ error: 'Demande non trouvée' });
      res.json(upd.rows[0]);
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  return router;
};

