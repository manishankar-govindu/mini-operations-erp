import { withTransaction, pool } from '../db.js';
import { DEFAULT_BATCH, lockStock, assertLocationAndItem, logTransaction } from './stock.js';
import { positiveInt, intId, requiredString } from '../validation.js';
import { conflict, notFound } from '../errors.js';

const SELECT_ORDER = `
  SELECT o.id, o.order_code, o.status, o.quantity, o.customer_name, o.created_at,
         l.id AS location_id, l.name AS location, i.id AS item_id, i.sku, i.name AS item
  FROM customer_orders o
  JOIN locations l ON l.id = o.location_id
  JOIN items i ON i.id = o.item_id`;

export async function listOrders() {
  const { rows } = await pool.query(`${SELECT_ORDER} ORDER BY o.created_at DESC, o.id DESC`);
  return rows;
}

/**
 * Creates an order and reserves stock atomically. Reservation is rejected
 * if it would exceed available quantity, so concurrent orders cannot
 * over-reserve (the stock row lock serializes them).
 */
export async function createOrder(user, body) {
  const locationId = intId(body.location_id, 'location_id');
  const itemId = intId(body.item_id, 'item_id');
  const quantity = positiveInt(body.quantity, 'quantity');
  const customerName = requiredString(body.customer_name, 'customer_name');

  return withTransaction(async (client) => {
    await assertLocationAndItem(client, locationId, itemId);
    const stock = await lockStock(client, locationId, itemId, DEFAULT_BATCH);
    if (stock.available < quantity) {
      throw conflict(`Insufficient available stock to reserve. Available: ${stock.available}, requested: ${quantity}`);
    }
    await client.query(
      'UPDATE inventory SET reserved_quantity = reserved_quantity + $1, updated_at = now() WHERE id = $2',
      [quantity, stock.id]);
    await logTransaction(client, { inventoryId: stock.id, type: 'RESERVE', quantity, reference: 'NEW_ORDER', userId: user.id });
    const { rows } = await client.query(
      `INSERT INTO customer_orders (location_id, item_id, quantity, customer_name, created_by)
       VALUES ($1, $2, $3, $4, $5) RETURNING id`,
      [locationId, itemId, quantity, customerName, user.id]);
    const { rows: [o] } = await client.query(`${SELECT_ORDER} WHERE o.id = $1`, [rows[0].id]);
    return o;
  });
}

/** Lock order row, then its stock row, and fail unless it is still RESERVED. */
async function lockReservedOrder(client, id) {
  const { rows: [o] } = await client.query('SELECT * FROM customer_orders WHERE id = $1 FOR UPDATE', [id]);
  if (!o) throw notFound('Order not found');
  if (o.status !== 'RESERVED') throw conflict(`Order is ${o.status}; only RESERVED orders can change`);
  const stock = await lockStock(client, o.location_id, o.item_id, DEFAULT_BATCH);
  return { order: o, stock };
}

/** Cancels an order and releases its reserved quantity. */
export async function cancelOrder(user, id) {
  const orderId = intId(id, 'id');
  return withTransaction(async (client) => {
    const { order, stock } = await lockReservedOrder(client, orderId);
    await client.query(
      'UPDATE inventory SET reserved_quantity = reserved_quantity - $1, updated_at = now() WHERE id = $2',
      [order.quantity, stock.id]);
    await logTransaction(client, { inventoryId: stock.id, type: 'RELEASE', quantity: order.quantity, reference: order.order_code, userId: user.id });
    await client.query(`UPDATE customer_orders SET status = 'CANCELLED' WHERE id = $1`, [orderId]);
    const { rows: [o] } = await client.query(`${SELECT_ORDER} WHERE o.id = $1`, [orderId]);
    return o;
  });
}

/** Ships a reserved order: physical and reserved both decrease. */
export async function completeOrder(user, id) {
  const orderId = intId(id, 'id');
  return withTransaction(async (client) => {
    const { order, stock } = await lockReservedOrder(client, orderId);
    await client.query(
      `UPDATE inventory SET physical_quantity = physical_quantity - $1,
         reserved_quantity = reserved_quantity - $1, updated_at = now() WHERE id = $2`,
      [order.quantity, stock.id]);
    await logTransaction(client, { inventoryId: stock.id, type: 'COMPLETE_ORDER', quantity: order.quantity, reference: order.order_code, userId: user.id });
    await client.query(`UPDATE customer_orders SET status = 'COMPLETED' WHERE id = $1`, [orderId]);
    const { rows: [o] } = await client.query(`${SELECT_ORDER} WHERE o.id = $1`, [orderId]);
    return o;
  });
}
