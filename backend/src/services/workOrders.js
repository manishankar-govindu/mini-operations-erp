import { withTransaction, pool } from '../db.js';
import { DEFAULT_BATCH, lockStock, assertLocationAndItem } from './stock.js';
import { positiveInt, intId } from '../validation.js';
import { badRequest, notFound, conflict } from '../errors.js';

const SELECT_WO = `
  SELECT wo.id, wo.work_order_code, wo.status, wo.required_quantity, wo.shortage,
         wo.created_at, l.id AS location_id, l.name AS location,
         i.id AS item_id, i.sku, i.name AS item,
         u.id AS assigned_user_id, u.username AS assigned_user
  FROM work_orders wo
  JOIN locations l ON l.id = wo.location_id
  JOIN items i ON i.id = wo.item_id
  JOIN users u ON u.id = wo.assigned_user_id`;

const NEXT_STATUS = { ASSIGNED: 'IN_PROGRESS', IN_PROGRESS: 'COMPLETED' };

export async function listWorkOrders() {
  const { rows } = await pool.query(`${SELECT_WO} ORDER BY wo.created_at DESC, wo.id DESC`);
  return rows;
}

/**
 * Creates a work order and calculates material shortage:
 * shortage = max(0, required - available at the location).
 */
export async function createWorkOrder(user, body) {
  const locationId = intId(body.location_id, 'location_id');
  const itemId = intId(body.item_id, 'item_id');
  const requiredQuantity = positiveInt(body.required_quantity, 'required_quantity');
  const assignedUserId = intId(body.assigned_user_id, 'assigned_user_id');

  return withTransaction(async (client) => {
    await assertLocationAndItem(client, locationId, itemId);
    const assignee = await client.query('SELECT 1 FROM users WHERE id = $1', [assignedUserId]);
    if (!assignee.rowCount) throw notFound('Assigned user not found');

    const stock = await lockStock(client, locationId, itemId, DEFAULT_BATCH);
    const shortage = Math.max(0, requiredQuantity - stock.available);

    const { rows } = await client.query(
      `INSERT INTO work_orders (location_id, item_id, required_quantity, shortage, assigned_user_id, created_by)
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
      [locationId, itemId, requiredQuantity, shortage, assignedUserId, user.id]
    );
    const { rows: [wo] } = await client.query(`${SELECT_WO} WHERE wo.id = $1`, [rows[0].id]);
    return wo;
  });
}

/** Moves a work order one step forward: ASSIGNED -> IN_PROGRESS -> COMPLETED. */
export async function advanceWorkOrder(id) {
  const woId = intId(id, 'id');
  return withTransaction(async (client) => {
    const { rows } = await client.query('SELECT status FROM work_orders WHERE id = $1 FOR UPDATE', [woId]);
    if (!rows[0]) throw notFound('Work order not found');
    const next = NEXT_STATUS[rows[0].status];
    if (!next) throw conflict('Work order is already completed');
    await client.query('UPDATE work_orders SET status = $1 WHERE id = $2', [next, woId]);
    const { rows: [wo] } = await client.query(`${SELECT_WO} WHERE wo.id = $1`, [woId]);
    return wo;
  });
}
