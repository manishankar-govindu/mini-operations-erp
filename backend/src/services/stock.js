import { conflict, notFound } from '../errors.js';

export const DEFAULT_BATCH = 'DEFAULT';

/**
 * Locks (SELECT ... FOR UPDATE) the stock row for location+item+batch,
 * creating it with zero quantity if it does not exist yet.
 * Every stock-changing operation calls this inside a transaction, so
 * concurrent requests for the same stock are serialized.
 */
export async function lockStock(client, locationId, itemId, batch = DEFAULT_BATCH) {
  await client.query(
    `INSERT INTO inventory (location_id, item_id, batch)
     VALUES ($1, $2, $3) ON CONFLICT (location_id, item_id, batch) DO NOTHING`,
    [locationId, itemId, batch]
  );
  const { rows } = await client.query(
    `SELECT * FROM inventory WHERE location_id = $1 AND item_id = $2 AND batch = $3 FOR UPDATE`,
    [locationId, itemId, batch]
  );
  const row = rows[0];
  if (!row) throw notFound('Stock record not found');
  return { ...row, available: row.physical_quantity - row.reserved_quantity };
}

export async function assertLocationAndItem(client, locationId, itemId) {
  const loc = await client.query('SELECT 1 FROM locations WHERE id = $1', [locationId]);
  if (!loc.rowCount) throw notFound('Location not found');
  const item = await client.query('SELECT 1 FROM items WHERE id = $1', [itemId]);
  if (!item.rowCount) throw notFound('Item not found');
}

export async function logTransaction(client, { inventoryId, type, quantity, reference, idempotencyKey = null, userId }) {
  try {
    await client.query(
      `INSERT INTO inventory_transactions (inventory_id, type, quantity, reference, idempotency_key, created_by)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [inventoryId, type, quantity, reference, idempotencyKey, userId]
    );
  } catch (err) {
    if (err.code === '23505') throw conflict('Duplicate inventory transaction (idempotency key already used)');
    throw err;
  }
}
