// The five mandatory tests from the case study, plus concurrency checks.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { resetDatabase, startServer, ids, stockOf, pool } from './helpers.js';

let srv, I;
before(async () => { await resetDatabase(); srv = await startServer(); I = await ids(); });
after(async () => { await srv.close(); });

const newStockKey = () => `key-${Date.now()}-${Math.random()}`;

test('Test 1: cannot reserve more than available inventory', async () => {
  await resetDatabase();
  const sales = srv.as('sales');
  // Item A at MAIN: physical 100, reserved 0 -> available 100
  const ok = await sales.post('/orders', { location_id: I.main, item_id: I.itemA, quantity: 60, customer_name: 'Acme' });
  assert.equal(ok.status, 201);
  const over = await sales.post('/orders', { location_id: I.main, item_id: I.itemA, quantity: 50, customer_name: 'Beta' });
  assert.equal(over.status, 409);
  assert.match(over.data.error, /Available: 40/);
  const stock = await stockOf(I.main, I.itemA);
  assert.equal(stock.reserved_quantity, 60, 'rejected reservation must not change stock');
});

test('Test 1b: two concurrent reservations cannot both succeed (80 + 50 on 100)', async () => {
  await resetDatabase();
  const sales = srv.as('sales');
  const body = (qty, name) => ({ location_id: I.main, item_id: I.itemA, quantity: qty, customer_name: name });
  const results = await Promise.all([
    sales.post('/orders', body(80, 'User A')),
    sales.post('/orders', body(50, 'User B')),
  ]);
  const statuses = results.map((r) => r.status).sort();
  assert.deepEqual(statuses, [201, 409], 'exactly one request must succeed');
  const stock = await stockOf(I.main, I.itemA);
  assert.ok(stock.reserved_quantity <= stock.physical_quantity);
  assert.equal(stock.reserved_quantity, 80);
});

test('Test 2: cannot transfer more than available inventory', async () => {
  await resetDatabase();
  const ops = srv.as('ops');
  // 100 physical at MAIN, but 30 reserved by a customer order -> available 70
  const o = await srv.as('sales').post('/orders', { location_id: I.main, item_id: I.itemA, quantity: 30, customer_name: 'Acme' });
  assert.equal(o.status, 201);
  const tooMuch = await ops.post('/transfers', { source_location_id: I.main, destination_location_id: I.north, item_id: I.itemA, quantity: 71 });
  assert.equal(tooMuch.status, 409);
  const fine = await ops.post('/transfers', { source_location_id: I.main, destination_location_id: I.north, item_id: I.itemA, quantity: 70 });
  assert.equal(fine.status, 201);
});

test('Test 3: destination stock increases only after transfer receipt', async () => {
  await resetDatabase();
  const ops = srv.as('ops');
  const before = await stockOf(I.north, I.itemA);
  const t = await ops.post('/transfers', { source_location_id: I.main, destination_location_id: I.north, item_id: I.itemA, quantity: 25 });
  assert.equal(t.status, 201);
  const id = t.data.id;

  assert.equal((await stockOf(I.north, I.itemA)).physical_quantity, before.physical_quantity, 'no change at request');
  await ops.patch(`/transfers/${id}/dispatch`);
  assert.equal((await stockOf(I.north, I.itemA)).physical_quantity, before.physical_quantity, 'no change at dispatch');
  assert.equal((await stockOf(I.main, I.itemA)).physical_quantity, 75, 'source reduced on dispatch');

  const r = await ops.patch(`/transfers/${id}/receive`);
  assert.equal(r.status, 200);
  assert.equal((await stockOf(I.north, I.itemA)).physical_quantity, before.physical_quantity + 25, 'destination increases on receipt');
});

test('Test 4: same transfer cannot be received twice', async () => {
  await resetDatabase();
  const ops = srv.as('ops');
  const t = await ops.post('/transfers', { source_location_id: I.main, destination_location_id: I.north, item_id: I.itemA, quantity: 10 });
  await ops.patch(`/transfers/${t.data.id}/dispatch`);
  const first = await ops.patch(`/transfers/${t.data.id}/receive`);
  assert.equal(first.status, 200);
  const second = await ops.patch(`/transfers/${t.data.id}/receive`);
  assert.equal(second.status, 409);
  assert.equal((await stockOf(I.north, I.itemA)).physical_quantity, 50, 'destination credited exactly once (40 + 10)');
});

test('Test 4b: concurrent receive requests credit destination only once', async () => {
  await resetDatabase();
  const ops = srv.as('ops');
  const t = await ops.post('/transfers', { source_location_id: I.main, destination_location_id: I.north, item_id: I.itemA, quantity: 10 });
  await ops.patch(`/transfers/${t.data.id}/dispatch`);
  const results = await Promise.all([1, 2, 3].map(() => ops.patch(`/transfers/${t.data.id}/receive`)));
  assert.deepEqual(results.map((r) => r.status).sort(), [200, 409, 409]);
  assert.equal((await stockOf(I.north, I.itemA)).physical_quantity, 50);
});

test('Test 5: unauthorized user cannot perform restricted operation', async () => {
  await resetDatabase();
  // Sales user cannot create work orders (admin only)
  const denied = await srv.as('sales').post('/work-orders', { location_id: I.main, item_id: I.itemA, required_quantity: 10, assigned_user_id: I.opsUser });
  assert.equal(denied.status, 403);
  // Operations user cannot create customer orders
  const denied2 = await srv.as('ops').post('/orders', { location_id: I.main, item_id: I.itemA, quantity: 5, customer_name: 'X' });
  assert.equal(denied2.status, 403);
  // No token at all
  const anon = await srv.api('GET', '/inventory');
  assert.equal(anon.status, 401);
  // Forged token
  const forged = await srv.api('GET', '/inventory', { token: 'abc.def.ghi' });
  assert.equal(forged.status, 401);
  // Admin is allowed
  const ok = await srv.as('admin').post('/work-orders', { location_id: I.main, item_id: I.itemA, required_quantity: 10, assigned_user_id: I.opsUser });
  assert.equal(ok.status, 201);
});

test('Duplicate stock-in with the same idempotency key is rejected and not applied twice', async () => {
  await resetDatabase();
  const ops = srv.as('ops');
  const key = newStockKey();
  const body = { location_id: I.main, item_id: I.itemA, quantity: 20, idempotency_key: key };
  assert.equal((await ops.post('/inventory/stock-in', body)).status, 201);
  assert.equal((await ops.post('/inventory/stock-in', body)).status, 409);
  assert.equal((await stockOf(I.main, I.itemA)).physical_quantity, 120);
});

test('Invalid and negative quantities are rejected and leave stock untouched', async () => {
  await resetDatabase();
  const sales = srv.as('sales');
  for (const q of [0, -5, 1.5, 'abc', null]) {
    const r = await sales.post('/orders', { location_id: I.main, item_id: I.itemA, quantity: q, customer_name: 'X' });
    assert.equal(r.status, 400, `quantity ${q} should be rejected`);
  }
  assert.equal((await stockOf(I.main, I.itemA)).reserved_quantity, 0);
});

test('Cancelling an order releases its reservation; completing it consumes stock', async () => {
  await resetDatabase();
  const sales = srv.as('sales');
  const o = await sales.post('/orders', { location_id: I.main, item_id: I.itemA, quantity: 40, customer_name: 'Acme' });
  assert.equal((await stockOf(I.main, I.itemA)).reserved_quantity, 40);

  const c = await sales.patch(`/orders/${o.data.id}/cancel`);
  assert.equal(c.data.status, 'CANCELLED');
  assert.deepEqual(
    { p: (await stockOf(I.main, I.itemA)).physical_quantity, r: (await stockOf(I.main, I.itemA)).reserved_quantity },
    { p: 100, r: 0 });
  assert.equal((await sales.patch(`/orders/${o.data.id}/cancel`)).status, 409, 'cannot cancel twice');

  const o2 = await sales.post('/orders', { location_id: I.main, item_id: I.itemA, quantity: 15, customer_name: 'Beta' });
  const done = await sales.patch(`/orders/${o2.data.id}/complete`);
  assert.equal(done.data.status, 'COMPLETED');
  assert.deepEqual(
    { p: (await stockOf(I.main, I.itemA)).physical_quantity, r: (await stockOf(I.main, I.itemA)).reserved_quantity },
    { p: 85, r: 0 });
});

test('Work order calculates shortage automatically', async () => {
  await resetDatabase();
  const admin = srv.as('admin');
  // Item A at MAIN: available 100, required 130 -> shortage 30
  const wo = await admin.post('/work-orders', { location_id: I.main, item_id: I.itemA, required_quantity: 130, assigned_user_id: I.opsUser });
  assert.equal(wo.status, 201);
  assert.equal(wo.data.shortage, 30);
  assert.equal(wo.data.status, 'ASSIGNED');
  assert.match(wo.data.work_order_code, /^WO-\d{6}$/);
  const adv = await srv.as('ops').patch(`/work-orders/${wo.data.id}/advance`);
  assert.equal(adv.data.status, 'IN_PROGRESS');
});

test('Locations are isolated: a transfer from NORTH cannot use MAIN stock', async () => {
  await resetDatabase();
  // NORTH has 40 of Item A; requesting 41 must fail even though MAIN has plenty.
  const r = await srv.as('ops').post('/transfers', { source_location_id: I.north, destination_location_id: I.main, item_id: I.itemA, quantity: 41 });
  assert.equal(r.status, 409);
});

after(async () => { await pool.end().catch(() => {}); });
