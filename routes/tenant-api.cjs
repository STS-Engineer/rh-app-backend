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

  router.get('/france/onboarding/:employeeId', authenticateToken, async (req, res) => {
    try {
      const schema = getSchemaForUser(req.user);
      if (schema !== 'schema_fr') return res.status(403).json({ error: 'France tenant only' });
      const record = await pool.query(`SELECT * FROM schema_fr.onboarding_records WHERE employee_id=$1`, [req.params.employeeId]);
      if (!record.rows.length) return res.json({ record: null, tasks: [] });
      const tasks = await pool.query(`SELECT * FROM schema_fr.onboarding_tasks WHERE onboarding_id=$1 ORDER BY sort_order, id`, [record.rows[0].id]);
      res.json({ record: record.rows[0], tasks: tasks.rows });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  router.put('/france/onboarding/:employeeId', authenticateToken, async (req, res) => {
    try {
      const schema = getSchemaForUser(req.user);
      if (schema !== 'schema_fr') return res.status(403).json({ error: 'France tenant only' });
      const { status, start_date, target_completion_date, owner_email, notes } = req.body;
      const q = `INSERT INTO schema_fr.onboarding_records (employee_id,status,start_date,target_completion_date,owner_email,notes,created_by)
                 VALUES ($1,$2,$3,$4,$5,$6,$7)
                 ON CONFLICT (employee_id) DO UPDATE SET
                 status=EXCLUDED.status,start_date=EXCLUDED.start_date,target_completion_date=EXCLUDED.target_completion_date,owner_email=EXCLUDED.owner_email,notes=EXCLUDED.notes
                 RETURNING *`;
      const r = await pool.query(q, [req.params.employeeId, status || 'in_progress', start_date || null, target_completion_date || null, owner_email || null, notes || null, req.user?.email || null]);
      res.json(r.rows[0]);
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  router.post('/france/onboarding/:employeeId/tasks', authenticateToken, async (req, res) => {
    try {
      const schema = getSchemaForUser(req.user);
      if (schema !== 'schema_fr') return res.status(403).json({ error: 'France tenant only' });
      const upsert = await pool.query(`INSERT INTO schema_fr.onboarding_records (employee_id, status, created_by) VALUES ($1,'in_progress',$2) ON CONFLICT (employee_id) DO UPDATE SET updated_at=CURRENT_TIMESTAMP RETURNING id`, [req.params.employeeId, req.user?.email || null]);
      const onboardingId = upsert.rows[0].id;
      const { task_code, title, description, due_date, assignee_email, sort_order } = req.body;
      const r = await pool.query(`INSERT INTO schema_fr.onboarding_tasks (onboarding_id, task_code, title, description, due_date, assignee_email, sort_order) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
        [onboardingId, task_code || 'custom', title, description || null, due_date || null, assignee_email || null, sort_order || 0]);
      res.status(201).json(r.rows[0]);
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  router.patch('/france/onboarding/tasks/:taskId', authenticateToken, async (req, res) => {
    try {
      const { status, title, description, due_date, assignee_email } = req.body;
      const r = await pool.query(`UPDATE schema_fr.onboarding_tasks SET
        status=COALESCE($1,status), title=COALESCE($2,title), description=COALESCE($3,description), due_date=COALESCE($4,due_date), assignee_email=COALESCE($5,assignee_email),
        completed_at = CASE WHEN COALESCE($1,status)='done' THEN CURRENT_TIMESTAMP ELSE completed_at END
        WHERE id=$6 RETURNING *`, [status || null, title || null, description || null, due_date || null, assignee_email || null, req.params.taskId]);
      if (!r.rows.length) return res.status(404).json({ error: 'Task not found' });
      res.json(r.rows[0]);
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  router.get('/france/career/:employeeId/events', authenticateToken, async (req, res) => {
    try {
      const r = await pool.query(`SELECT * FROM schema_fr.career_events WHERE employee_id=$1 ORDER BY event_date DESC, id DESC`, [req.params.employeeId]);
      res.json(r.rows);
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  router.post('/france/career/:employeeId/events', authenticateToken, async (req, res) => {
    try {
      const { event_type, event_date, title, details, old_value, new_value, salary_old, salary_new, rating } = req.body;
      const r = await pool.query(`INSERT INTO schema_fr.career_events
        (employee_id,event_type,event_date,title,details,old_value,new_value,salary_old,salary_new,rating,created_by)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING *`,
        [req.params.employeeId, event_type, event_date, title, details || null, old_value || null, new_value || null, salary_old || null, salary_new || null, rating || null, req.user?.email || null]);
      res.status(201).json(r.rows[0]);
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  router.get('/france/offboarding/:employeeId', authenticateToken, async (req, res) => {
    try {
      const record = await pool.query(`SELECT * FROM schema_fr.offboarding_records WHERE employee_id=$1 ORDER BY id DESC LIMIT 1`, [req.params.employeeId]);
      if (!record.rows.length) return res.json({ record: null, tasks: [] });
      const tasks = await pool.query(`SELECT * FROM schema_fr.offboarding_tasks WHERE offboarding_id=$1 ORDER BY sort_order, id`, [record.rows[0].id]);
      res.json({ record: record.rows[0], tasks: tasks.rows });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  router.post('/france/offboarding/:employeeId', authenticateToken, async (req, res) => {
    try {
      const { departure_date, reason, interview_notes, owner_email } = req.body;
      const q = `INSERT INTO schema_fr.offboarding_records (employee_id, departure_date, reason, interview_notes, owner_email, created_by)
                 VALUES ($1,$2,$3,$4,$5,$6)
                 RETURNING *`;
      const r = await pool.query(q, [req.params.employeeId, departure_date, reason || null, interview_notes || null, owner_email || null, req.user?.email || null]);
      res.status(201).json(r.rows[0]);
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  router.post('/france/offboarding/:employeeId/tasks', authenticateToken, async (req, res) => {
    try {
      const rec = await pool.query(`SELECT id FROM schema_fr.offboarding_records WHERE employee_id=$1 ORDER BY id DESC LIMIT 1`, [req.params.employeeId]);
      if (!rec.rows.length) return res.status(400).json({ error: 'Create offboarding record first' });
      const { task_code, title, description, due_date, assignee_email, sort_order } = req.body;
      const r = await pool.query(`INSERT INTO schema_fr.offboarding_tasks (offboarding_id,task_code,title,description,due_date,assignee_email,sort_order)
        VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
        [rec.rows[0].id, task_code || 'custom', title, description || null, due_date || null, assignee_email || null, sort_order || 0]);
      res.status(201).json(r.rows[0]);
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  router.patch('/france/offboarding/tasks/:taskId', authenticateToken, async (req, res) => {
    try {
      const { status } = req.body;
      const r = await pool.query(`UPDATE schema_fr.offboarding_tasks
        SET status=COALESCE($1,status), completed_at = CASE WHEN COALESCE($1,status)='done' THEN CURRENT_TIMESTAMP ELSE completed_at END
        WHERE id=$2 RETURNING *`, [status || null, req.params.taskId]);
      if (!r.rows.length) return res.status(404).json({ error: 'Task not found' });
      res.json(r.rows[0]);
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  return router;
};
