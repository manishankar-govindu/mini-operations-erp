import pg from 'pg';
import { config } from './config.js';

export const pool = new pg.Pool(config.db);

pool.on('error', (err) => console.error('Idle DB client error', err));

/** Run `fn(client)` inside BEGIN/COMMIT; rolls back on any thrown error. */
export async function withTransaction(fn) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}
