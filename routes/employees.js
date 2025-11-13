import express from 'express';
import { Employee } from '../models/Employee.js';
import { authenticateToken } from '../middleware/auth.js';

const router = express.Router();

// Get all employees
router.get('/', authenticateToken, async (req, res) => {
  try {
    const employees = await Employee.findAll();
    res.json(employees);
  } catch (error) {
    res.status(500).json({ error: 'Erreur lors de la récupération des employés' });
  }
});

// Search employees by name
router.get('/search', authenticateToken, async (req, res) => {
  try {
    const { q } = req.query;
    const employees = await Employee.searchByName(q);
    res.json(employees);
  } catch (error) {
    res.status(500).json({ error: 'Erreur lors de la recherche' });
  }
});

// Update employee
router.put('/:id', authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;
    const updatedEmployee = await Employee.update(id, req.body);
    res.json(updatedEmployee);
  } catch (error) {
    res.status(500).json({ error: 'Erreur lors de la mise à jour' });
  }
});

export default router;