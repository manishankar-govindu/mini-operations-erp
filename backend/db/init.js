// Applies db/schema.sql. WARNING: drops and recreates all tables.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { pool } from '../src/db.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const sql = fs.readFileSync(path.join(here, 'schema.sql'), 'utf8');

try {
  await pool.query(sql);
  console.log('Schema applied.');
} finally {
  await pool.end();
}
