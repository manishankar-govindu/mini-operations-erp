import { withTransaction, pool } from '../db.js';
import { DEFAULT_BATCH, lockStock, assertLocationAndItem, logTransaction } from './stock.js';
import { positiveInt, intId } from '../validation.js';
import { badRequest, conflict, notFound } from '../errors.js';

const SELECT_TR = `
  SELECT t.id, t.transfer_code, t.status, t.quantity, t.created_at, t.dispatched_at, t.received_at,
         sl.id AS source_location_id, sl.name AS source_location,
         dl.id AS destination_location_id, dl.name AS destination_location,
         i.id AS item_id, i.sku, i.name AS item
  FROM stock_transfers t
  JOIN locations sl ON sl.id = t.source_location_id
  JOIN locations dl ON dl.id = t.destination_location_id
  JOIN items i ON i.id = t.item_id`;

export async function listTransfers() {
  const { rows } = await pool.query(`${SELECT_TR} ORDER BY t.created_at DESC, t.id DESC`);
  return rows;
}

/** Creates a REQUESTED transfer. No stock moves yet; source must have enough available stock. */
export async function createTransfer(user, body) {
  const sourceId = intId(body.source_location_id, 'source_location_id');
  const destId = intId(body.destination_location_id, 'destination_location_id');
  const itemId = intId(body.item_id, 'item_id');
  const quantity = positiveInt(body.quantity, 'quantity');
  if (sourceId === destId) throw badRequest('Source and destination must be different');

  return withTransaction(async (client) => {
    await assertLocationAndItem(client, sourceId, itemId);
    await assertLocationAndItem(client, destId, itemId);
    const source = await lockStock(client, sourceId, itemId, DEFAULT_BATCH);
    if (source.available < quantity) {
      throw conflict(`Insufficient available stock at source. Available: ${source.available}, requested: ${quantity}`);
    }
    const { rows } = await client.query(
      `INSERT INTO stock_transfers (source_location_id, destination_location_id, item_id, quantity, created_by)
       VALUES ($1, $2, $3, $4, $5) RETURNING id`,
      [sourceId, destId, itemId, quantity, user.id]
    );
    const { rows: [t] } = await client.query(`${SELECT_TR} WHERE t.id = $1`, [rows[0].id]);
    return t;
  });
}

/** REQUESTED -> DISPATCHED. Reduces SOURCE physical stock only. */
export async function dispatchTransfer(user, id) {
  const transferId = intId(id, 'id');
  return withTransaction(async (client) => {
    const { rows: [t] } = await client.query(
      'SELECT * FROM stock_transfers WHERE id = $1 FOR UPDATE', [transferId]);
    if (!t) throw notFound('Transfer not found');
    if (t.status !== 'REQUESTED') throw conflict(`Transfer is ${t.status}, only REQUESTED transfers can be dispatched`);

    const source = await lockStock(client, t.source_location_id, t.item_id, DEFAULT_BATCH);
    if (source.available < t.quantity) {
      throw conflict(`Insufficient available stock at source. Available: ${source.available}, required: ${t.quantity}`);
    }
    await client.query(
      'UPDATE inventory SET physical_quantity = physical_quantity - $1, updated_at = now() WHERE id = $2',
      [t.quantity, source.id]);
    await logTransaction(client, {
      inventoryId: source.id, type: 'TRANSFER_OUT', quantity: t.quantity,
      reference: t.transfer_code, userId: user.id });
    await client.query(
      `UPDATE stock_transfers SET status = 'DISPATCHED', dispatched_at = now() WHERE id = $1`, [transferId]);
    return getTransfer(client, transferId);
  });
}

/**
 * DISPATCHED -> RECEIVED. Increases DESTINATION physical stock.
 * The status check under FOR UPDATE guarantees a transfer can only be received once.
 */
export async function receiveTransfer(user, id) {
  const transferId = intId(id, 'id');
  return withTransaction(async (client) => {
    const { rows: [t] } = await client.query(
      'SELECT * FROM stock_transfers WHERE id = $1 FOR UPDATE', [transferId]);
    if (!t) throw notFound('Transfer not found');
    if (t.status === 'RECEIVED') throw conflict('Transfer has already been received');
    if (t.status !== 'DISPATCHED') throw conflict('Transfer must be dispatched before it can be received');

    const dest = await lockStock(client, t.destination_location_id, t.item_id, DEFAULT_BATCH);
    await client.query(
      'UPDATE inventory SET physical_quantity = physical_quantity + $1, updated_at = now() WHERE id = $2',
      [t.quantity, dest.id]);
    await logTransaction(client, {
      inventoryId: dest.id, type: 'TRANSFER_IN', quantity: t.quantity,
      reference: t.transfer_code, userId: user.id });
    await client.query(
      `UPDATE stock_transfers SET status = 'RECEIVED', received_at = now() WHERE id = $1`, [transferId]);
    return getTransfer(client, transferId);
  });
}

async function getTransfer(client, id) {
  const { rows: [t] } = await client.query(`${SELECT_TR} WHERE t.id = $1`, [id]);
  return t;
}
