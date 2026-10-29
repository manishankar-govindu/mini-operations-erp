// Test harness: resets the TEST database, starts the app on a random port, and provides a tiny HTTP client.
process.env.NODE_ENV = 'test';
const { readFileSync } = await import('node:fs');
const { fileURLToPath } = await import('node:url');
const path = await import('node:path');
const { pool } = await import('../src/db.js');
const { createApp } = await import('../src/app.js');
const { seedDatabase } = await import('../db/seedData.js');

const schemaSql = readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), '../db/schema.sql'), 'utf8');

export async function resetDatabase() {
  await pool.query(schemaSql);
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await seedDatabase(client);
    await client.query('COMMIT');
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }
}

export async function startServer() {
  const server = createApp().listen(0);
  await new Promise((r) => server.once('listening', r));
  const base = `http://127.0.0.1:${server.address().port}/api`;

  async function api(method, url, { token, body } = {}) {
    const res = await fetch(base + url, {
      method,
      headers: {
        ...(body ? { 'Content-Type': 'application/json' } : {}),
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
    });
    const data = await res.json().catch(() => null);
    return { status: res.status, data };
  }

  const tokens = {};
  async function login(username) {
    if (!tokens[username]) {
      const r = await api('POST', '/auth/login', { body: { username, password: 'password123' } });
      tokens[username] = r.data.token;
    }
    return tokens[username];
  }

  /** Helper that returns an api call pre-authenticated as the given user. */
  const as = (username) => ({
    get: async (url) => api('GET', url, { token: await login(username) }),
    post: async (url, body) => api('POST', url, { token: await login(username), body }),
    patch: async (url, body) => api('PATCH', url, { token: await login(username), body }),
  });

  return {
    api, as, login,
    async close() {
      await new Promise((r) => server.close(r));
      await pool.end();
    },
  };
}

/** Looks up a seeded id by its natural key. */
export async function ids() {
  const q = async (sql) => (await pool.query(sql)).rows[0].id;
  return {
    main: await q(`SELECT id FROM locations WHERE code='MAIN'`),
    north: await q(`SELECT id FROM locations WHERE code='NORTH'`),
    itemA: await q(`SELECT id FROM items WHERE sku='ITEM-A'`),
    itemB: await q(`SELECT id FROM items WHERE sku='ITEM-B'`),
    opsUser: await q(`SELECT id FROM users WHERE username='ops'`),
  };
}

export async function stockOf(locationId, itemId) {
  const { rows } = await pool.query(
    `SELECT physical_quantity, reserved_quantity FROM inventory
     WHERE location_id=$1 AND item_id=$2 AND batch='DEFAULT'`, [locationId, itemId]);
  return rows[0] ?? { physical_quantity: 0, reserved_quantity: 0 };
}

export { pool };
