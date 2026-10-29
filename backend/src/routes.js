import { Router } from 'express';
import { authenticate, authorize, login, ROLES } from './auth.js';
import { pool } from './db.js';
import { badRequest } from './errors.js';
import { requiredString } from './validation.js';
import * as inv from './services/inventory.js';
import * as wo from './services/workOrders.js';
import * as tr from './services/transfers.js';
import * as ord from './services/orders.js';

const { ADMIN, OPERATIONS, SALES } = ROLES;
const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

export const router = Router();

// ---- Auth ----
router.post('/auth/login', wrap(async (req, res) => {
  const username = requiredString(req.body?.username, 'username', 100);
  const password = requiredString(req.body?.password, 'password', 200);
  res.json(await login(username, password));
}));

router.get('/auth/me', authenticate, (req, res) => res.json({ user: req.user }));

// Everything below requires a valid token.
router.use(authenticate);

// ---- Master data ----
router.get('/master/locations', wrap(async (req, res) => {
  res.json((await pool.query('SELECT id, code, name FROM locations ORDER BY code')).rows);
}));
router.get('/master/items', wrap(async (req, res) => {
  res.json((await pool.query(`SELECT i.id, i.sku, i.name, i.unit, c.name AS category
    FROM items i JOIN categories c ON c.id = i.category_id ORDER BY i.sku`)).rows);
}));
router.get('/master/users', authorize(ADMIN, OPERATIONS, SALES), wrap(async (req, res) => {
  res.json((await pool.query(`SELECT id, username, full_name, role FROM users ORDER BY username`)).rows);
}));

// ---- Inventory ----
router.get('/inventory', wrap(async (req, res) => {
  res.json(await inv.listInventory({ locationId: req.query.location_id }));
}));
router.post('/inventory/stock-in', authorize(ADMIN, OPERATIONS), wrap(async (req, res) => {
  res.status(201).json(await inv.stockIn(req.user, req.body || {}));
}));

// ---- Work orders ----
router.get('/work-orders', wrap(async (req, res) => res.json(await wo.listWorkOrders())));
router.post('/work-orders', authorize(ADMIN), wrap(async (req, res) => {
  res.status(201).json(await wo.createWorkOrder(req.user, req.body || {}));
}));
router.patch('/work-orders/:id/advance', authorize(ADMIN, OPERATIONS), wrap(async (req, res) => {
  res.json(await wo.advanceWorkOrder(req.params.id));
}));

// ---- Internal transfers ----
router.get('/transfers', wrap(async (req, res) => res.json(await tr.listTransfers())));
router.post('/transfers', authorize(ADMIN, OPERATIONS), wrap(async (req, res) => {
  res.status(201).json(await tr.createTransfer(req.user, req.body || {}));
}));
router.patch('/transfers/:id/dispatch', authorize(ADMIN, OPERATIONS), wrap(async (req, res) => {
  res.json(await tr.dispatchTransfer(req.user, req.params.id));
}));
router.patch('/transfers/:id/receive', authorize(ADMIN, OPERATIONS), wrap(async (req, res) => {
  res.json(await tr.receiveTransfer(req.user, req.params.id));
}));

// ---- Customer orders ----
router.get('/orders', wrap(async (req, res) => res.json(await ord.listOrders())));
router.post('/orders', authorize(ADMIN, SALES), wrap(async (req, res) => {
  res.status(201).json(await ord.createOrder(req.user, req.body || {}));
}));
router.patch('/orders/:id/cancel', authorize(ADMIN, SALES), wrap(async (req, res) => {
  res.json(await ord.cancelOrder(req.user, req.params.id));
}));
router.patch('/orders/:id/complete', authorize(ADMIN, SALES), wrap(async (req, res) => {
  res.json(await ord.completeOrder(req.user, req.params.id));
}));
