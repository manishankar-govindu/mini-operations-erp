import { withTransaction, pool } from '../db.js';
import { DEFAULT_BATCH, lockStock, assertLocationAndItem, logTransaction } from './stock.js';
import { positiveInt, intId, requiredString } from '../validation.js';
import { badRequest } from '../errors.js';

export async function listInventory({ locationId } = {}) {
  const params = [];
  let where = '';
  if (locationId) {
    params.push(intId(locationId, 'location_id'));
    where = 'WHERE inv.location_id = $1';
  }
  const { rows } = await pool.query(`
    SELECT inv.id, l.id AS location_id, l.name AS location, i.id AS item_id, i.sku, i.name AS item,
           c.name AS category, inv.batch,
           inv.physical_quantity, inv.reserved_quantity,
           (inv.physical_quantity - inv.reserved_quantity) AS available_quantity
    FROM inventory inv
    JOIN locations l ON l.id = inv.location_id
    JOIN items i ON i.id = inv.item_id
    JOIN categories c ON c.id = i.category_id
    ${where}
    ORDER BY l.code, i.sku, inv.batch`, params);
  return rows;
}

/** Adds physical stock. Duplicate idempotency keys are rejected with 409. */
export async function stockIn(user, body) {
  const locationId = intId(body.location_id, 'location_id');
  const itemId = intId(body.item_id, 'item_id');
  const quantity = positiveInt(body.quantity, 'quantity');
  const batch = body.batch ? requiredString(body.batch, 'batch', 50) : DEFAULT_BATCH;
  const idempotencyKey = body.idempotency_key
    ? requiredString(body.idempotency_key, 'idempotency_key', 100)
    : null;
  if (!idempotencyKey) throw badRequest('idempotency_key is required to prevent duplicate postings');

  return withTransaction(async (client) => {
    await assertLocationAndItem(client, locationId, itemId);
    const stock = await lockStock(client, locationId, itemId, batch);
    await client.query(
      'UPDATE inventory SET physical_quantity = physical_quantity + $1, updated_at = now() WHERE id = $2',
      [quantity, stock.id]
    );
    await logTransaction(client, {
      inventoryId: stock.id, type: 'STOCK_IN', quantity,
      reference: 'MANUAL', idempotencyKey, userId: user.id,
    });
    return { inventory_id: stock.id, added: quantity };
  });
}
