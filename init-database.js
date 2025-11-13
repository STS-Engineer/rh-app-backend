require('dotenv').config({ path: __dirname + '/.env' });
const { Client } = require('pg');
const bcrypt = require('bcryptjs');

const client = new Client({
  user: process.env.DB_USER,
  host: process.env.DB_HOST,
  database: process.env.DB_NAME,
  password: process.env.DB_PASSWORD,
  port: Number(process.env.DB_PORT || 5432),
  ssl: { require: true, rejectUnauthorized: false }
});

async function initializeDatabase() {
  try {
    await client.connect();
    console.log('✅ Connecté à Azure PostgreSQL pour RH Application');

    // Créer la table users
    await client.query(`
      CREATE TABLE IF NOT EXISTS users (
        id SERIAL PRIMARY KEY,
        email VARCHAR(255) UNIQUE NOT NULL,
        password VARCHAR(255) NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);
    console.log('✅ Table users créée/vérifiée');

    // Créer la table employees
    await client.query(`
      CREATE TABLE IF NOT EXISTS employees (
        id SERIAL PRIMARY KEY,
        matricule VARCHAR(50) UNIQUE NOT NULL,
        nom VARCHAR(100) NOT NULL,
        prenom VARCHAR(100) NOT NULL,
        cin VARCHAR(50) UNIQUE NOT NULL,
        passeport VARCHAR(100),
        date_naissance DATE NOT NULL,
        poste VARCHAR(100) NOT NULL,
        site_dep VARCHAR(100) NOT NULL,
        type_contrat VARCHAR(50) NOT NULL,
        date_debut DATE NOT NULL,
        salaire_brute DECIMAL(10,2) NOT NULL,
        photo VARCHAR(255),
        dossier_rh VARCHAR(255),
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);
    console.log('✅ Table employees créée/vérifiée');

    // Créer l'utilisateur admin
    const hashedPassword = await bcrypt.hash('password', 10);
    
    await client.query(
      `INSERT INTO users (email, password) 
       VALUES ($1, $2) 
       ON CONFLICT (email) DO UPDATE SET password = $2`,
      ['admin@rh.com', hashedPassword]
    );
    console.log('✅ Utilisateur admin créé/mis à jour');

    // Insérer des employés de test
    const employees = [
      {
        matricule: 'EMP001',
        nom: 'Dupont',
        prenom: 'Jean',
        cin: 'AB123456',
        passeport: 'P12345678',
        date_naissance: '1990-05-15',
        poste: 'Développeur Fullstack',
        site_dep: 'Siège Central',
        type_contrat: 'CDI',
        date_debut: '2020-01-15',
        salaire_brute: 35000.00,
        photo: 'https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?w=150&h=150&fit=crop&crop=face',
        dossier_rh: 'dossier_jean.pdf'
      },
      {
        matricule: 'EMP002',
        nom: 'Martin',
        prenom: 'Marie',
        cin: 'CD789012',
        passeport: 'P87654321',
        date_naissance: '1985-08-22',
        poste: 'Chef de Projet',
        site_dep: 'Site Nord',
        type_contrat: 'CDI',
        date_debut: '2019-03-10',
        salaire_brute: 45000.00,
        photo: 'https://images.unsplash.com/photo-1494790108755-2616b612b786?w=150&h=150&fit=crop&crop=face',
        dossier_rh: 'dossier_marie.pdf'
      }
    ];

    for (const emp of employees) {
      await client.query(
        `INSERT INTO employees 
         (matricule, nom, prenom, cin, passeport, date_naissance, poste, site_dep, type_contrat, date_debut, salaire_brute, photo, dossier_rh) 
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
         ON CONFLICT (matricule) DO NOTHING`,
        [emp.matricule, emp.nom, emp.prenom, emp.cin, emp.passeport, emp.date_naissance, emp.poste, emp.site_dep, emp.type_contrat, emp.date_debut, emp.salaire_brute, emp.photo, emp.dossier_rh]
      );
    }
    console.log('✅ Employés de test créés');

    // Statistiques
    const usersCount = await client.query('SELECT COUNT(*) FROM users');
    const employeesCount = await client.query('SELECT COUNT(*) FROM employees');
    
    console.log('\n📊 STATISTIQUES RH:');
    console.log(`   👤 Utilisateurs: ${usersCount.rows[0].count}`);
    console.log(`   👥 Employés: ${employeesCount.rows[0].count}`);
    console.log('\n🎉 Base de données RH initialisée avec succès!');

  } catch (error) {
    console.error('❌ Erreur initialisation base RH:', error);
  } finally {
    await client.end();
  }
}

initializeDatabase();