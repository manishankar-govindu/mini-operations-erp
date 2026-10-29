import { pool } from '../src/db.js';
import { seedDatabase } from './seedData.js';

const client = await pool.connect();
try {
  await client.query('BEGIN');
  await seedDatabase(client);
  await client.query('COMMIT');
  console.log('Seed data inserted. Users: admin / ops / sales (password123)');
} catch (e) {
  await client.query('ROLLBACK');
  throw e;
} finally {
  client.release();
  await pool.end();
}
