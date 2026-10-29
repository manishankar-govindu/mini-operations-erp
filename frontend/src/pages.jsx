import React, { useCallback, useEffect, useState } from 'react';
import { api, newIdempotencyKey } from './api.js';

const ADMIN = 'admin', OPS = 'operations_user', SALES = 'sales_user';

/* ---------- shared helpers ---------- */

function useLoader(loader, deps, onAuthError) {
  const [data, setData] = useState([]);
  const [error, setError] = useState('');
  const reload = useCallback(async () => {
    try { setData(await loader()); setError(''); }
    catch (e) { setError(e.message); onAuthError?.(e); }
  }, deps); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { reload(); }, [reload]);
  return { data, error, setError, reload };
}

function useActions(token, reload, setError, onAuthError) {
  return async (fn) => {
    try { await fn(); await reload(); setError(''); }
    catch (e) { setError(e.message); onAuthError?.(e); }
  };
}

function Table({ columns, rows, empty = 'No records' }) {
  if (!rows.length) return <p className="muted">{empty}</p>;
  return (
    <table>
      <thead><tr>{columns.map((c) => <th key={c.header}>{c.header}</th>)}</tr></thead>
      <tbody>
        {rows.map((r) => (
          <tr key={r.id}>{columns.map((c) => <td key={c.header}>{c.render(r)}</td>)}</tr>
        ))}
      </tbody>
    </table>
  );
}

const Msg = ({ error }) => (error ? <div className="error">{error}</div> : null);

function Select({ label, value, onChange, options }) {
  return (
    <label>{label}
      <select value={value} onChange={(e) => onChange(e.target.value)} required>
        <option value="">-- select --</option>
        {options.map((o) => <option key={o.id} value={o.id}>{o.label}</option>)}
      </select>
    </label>
  );
}

function useMaster(token, onAuthError) {
  const [locations, setLocations] = useState([]);
  const [items, setItems] = useState([]);
  const [users, setUsers] = useState([]);
  useEffect(() => {
    const load = async () => {
      try {
        const [l, i, u] = await Promise.all([
          api('GET', '/master/locations', { token }),
          api('GET', '/master/items', { token }),
          api('GET', '/master/users', { token }).catch(() => []),
        ]);
        setLocations(l.map((x) => ({ id: x.id, label: `${x.code} – ${x.name}` })));
        setItems(i.map((x) => ({ id: x.id, label: `${x.sku} – ${x.name}` })));
        setUsers(u.map((x) => ({ id: x.id, label: `${x.full_name} (${x.role})` })));
      } catch (e) { onAuthError?.(e); }
    };
    load();
  }, [token]); // eslint-disable-line react-hooks/exhaustive-deps
  return { locations, items, users };
}

/* ---------- 1. Login ---------- */

export function LoginPage({ onLogin }) {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const submit = async (e) => {
    e.preventDefault();
    try { onLogin(await api('POST', '/auth/login', { body: { username, password } })); }
    catch (err) { setError(err.message); }
  };
  return (
    <div className="login">
      <form className="card" onSubmit={submit}>
        <h2>Sign in</h2>
        <label>Username<input value={username} onChange={(e) => setUsername(e.target.value)} required autoFocus /></label>
        <label>Password<input type="password" value={password} onChange={(e) => setPassword(e.target.value)} required /></label>
        <Msg error={error} />
        <button type="submit">Sign in</button>
        <p className="muted small">Demo users: admin, ops, sales · password123</p>
      </form>
    </div>
  );
}

/* ---------- 2. Inventory ---------- */

export function InventoryPage({ token, role, onAuthError }) {
  const { data, error, setError, reload } = useLoader(
    () => api('GET', '/inventory', { token }), [token], onAuthError);
  const { locations, items } = useMaster(token, onAuthError);
  const [form, setForm] = useState({ location_id: '', item_id: '', quantity: '', batch: '' });
  const [key, setKey] = useState(newIdempotencyKey());
  const act = useActions(token, reload, setError, onAuthError);
  const canStockIn = [ADMIN, OPS].includes(role);

  const submit = (e) => {
    e.preventDefault();
    act(async () => {
      await api('POST', '/inventory/stock-in', {
        token,
        body: { ...form, quantity: Number(form.quantity), idempotency_key: key },
      });
      setForm({ location_id: '', item_id: '', quantity: '', batch: '' });
      setKey(newIdempotencyKey());
    });
  };

  return (
    <section>
      <h2>Inventory</h2>
      <Msg error={error} />
      <Table
        columns={[
          { header: 'Location', render: (r) => r.location },
          { header: 'SKU', render: (r) => r.sku },
          { header: 'Item', render: (r) => r.item },
          { header: 'Category', render: (r) => r.category },
          { header: 'Batch', render: (r) => r.batch },
          { header: 'Physical', render: (r) => r.physical_quantity },
          { header: 'Reserved', render: (r) => r.reserved_quantity },
          { header: 'Available', render: (r) => <strong>{r.available_quantity}</strong> },
        ]}
        rows={data}
        empty="No inventory"
      />
      {canStockIn && (
        <form className="card inline" onSubmit={submit}>
          <h3>Stock in</h3>
          <Select label="Location" value={form.location_id} onChange={(v) => setForm({ ...form, location_id: v })} options={locations} />
          <Select label="Item" value={form.item_id} onChange={(v) => setForm({ ...form, item_id: v })} options={items} />
          <label>Quantity<input type="number" min="1" step="1" value={form.quantity} onChange={(e) => setForm({ ...form, quantity: e.target.value })} required /></label>
          <label>Batch (optional)<input value={form.batch} onChange={(e) => setForm({ ...form, batch: e.target.value })} /></label>
          <button type="submit">Add stock</button>
        </form>
      )}
    </section>
  );
}

/* ---------- 3. Work orders ---------- */

export function WorkOrdersPage({ token, role, onAuthError }) {
  const { data, error, setError, reload } = useLoader(
    () => api('GET', '/work-orders', { token }), [token], onAuthError);
  const { locations, items, users } = useMaster(token, onAuthError);
  const [form, setForm] = useState({ location_id: '', item_id: '', required_quantity: '', assigned_user_id: '' });
  const act = useActions(token, reload, setError, onAuthError);
  const isAdmin = role === ADMIN;
  const canAdvance = [ADMIN, OPS].includes(role);

  const create = (e) => {
    e.preventDefault();
    act(async () => {
      await api('POST', '/work-orders', { token, body: {
        location_id: form.location_id, item_id: form.item_id,
        required_quantity: Number(form.required_quantity), assigned_user_id: form.assigned_user_id } });
      setForm({ location_id: '', item_id: '', required_quantity: '', assigned_user_id: '' });
    });
  };

  return (
    <section>
      <h2>Work Orders</h2>
      <Msg error={error} />
      <Table
        columns={[
          { header: 'Work Order', render: (r) => r.work_order_code },
          { header: 'Location', render: (r) => r.location },
          { header: 'Item', render: (r) => r.item },
          { header: 'Required', render: (r) => r.required_quantity },
          { header: 'Shortage', render: (r) => (r.shortage > 0 ? <span className="warn">{r.shortage}</span> : 0) },
          { header: 'Assigned To', render: (r) => r.assigned_user },
          { header: 'Status', render: (r) => r.status },
          { header: '', render: (r) => (canAdvance && r.status !== 'COMPLETED'
              ? <button onClick={() => act(() => api('PATCH', `/work-orders/${r.id}/advance`, { token }))}>
                  {r.status === 'ASSIGNED' ? 'Start' : 'Complete'}</button>
              : null) },
        ]}
        rows={data}
        empty="No work orders"
      />
      {isAdmin && (
        <form className="card inline" onSubmit={create}>
          <h3>New work order</h3>
          <Select label="Location" value={form.location_id} onChange={(v) => setForm({ ...form, location_id: v })} options={locations} />
          <Select label="Item (material)" value={form.item_id} onChange={(v) => setForm({ ...form, item_id: v })} options={items} />
          <label>Required quantity<input type="number" min="1" step="1" value={form.required_quantity} onChange={(e) => setForm({ ...form, required_quantity: e.target.value })} required /></label>
          <Select label="Assigned user" value={form.assigned_user_id} onChange={(v) => setForm({ ...form, assigned_user_id: v })} options={users} />
          <button type="submit">Create</button>
        </form>
      )}
    </section>
  );
}

/* ---------- 4. Internal transfers ---------- */

export function TransfersPage({ token, role, onAuthError }) {
  const { data, error, setError, reload } = useLoader(
    () => api('GET', '/transfers', { token }), [token], onAuthError);
  const { locations, items } = useMaster(token, onAuthError);
  const [form, setForm] = useState({ source_location_id: '', destination_location_id: '', item_id: '', quantity: '' });
  const act = useActions(token, reload, setError, onAuthError);
  const canAct = [ADMIN, OPS].includes(role);

  const create = (e) => {
    e.preventDefault();
    act(async () => {
      await api('POST', '/transfers', { token, body: { ...form, quantity: Number(form.quantity) } });
      setForm({ source_location_id: '', destination_location_id: '', item_id: '', quantity: '' });
    });
  };

  return (
    <section>
      <h2>Internal Transfers</h2>
      <Msg error={error} />
      <Table
        columns={[
          { header: 'Transfer', render: (r) => r.transfer_code },
          { header: 'From', render: (r) => r.source_location },
          { header: 'To', render: (r) => r.destination_location },
          { header: 'Item', render: (r) => r.item },
          { header: 'Quantity', render: (r) => r.quantity },
          { header: 'Status', render: (r) => r.status },
          { header: 'Actions', render: (r) => (
              <>
                {canAct && r.status === 'REQUESTED' && <button onClick={() => act(() => api('PATCH', `/transfers/${r.id}/dispatch`, { token }))}>Dispatch</button>}
                {canAct && r.status === 'DISPATCHED' && <button onClick={() => act(() => api('PATCH', `/transfers/${r.id}/receive`, { token }))}>Receive</button>}
              </>) },
        ]}
        rows={data}
        empty="No transfers"
      />
      {canAct && (
        <form className="card inline" onSubmit={create}>
          <h3>New transfer</h3>
          <Select label="From" value={form.source_location_id} onChange={(v) => setForm({ ...form, source_location_id: v })} options={locations} />
          <Select label="To" value={form.destination_location_id} onChange={(v) => setForm({ ...form, destination_location_id: v })} options={locations} />
          <Select label="Item" value={form.item_id} onChange={(v) => setForm({ ...form, item_id: v })} options={items} />
          <label>Quantity<input type="number" min="1" step="1" value={form.quantity} onChange={(e) => setForm({ ...form, quantity: e.target.value })} required /></label>
          <button type="submit">Request transfer</button>
        </form>
      )}
    </section>
  );
}

/* ---------- 5. Customer orders ---------- */

export function OrdersPage({ token, role, onAuthError }) {
  const { data, error, setError, reload } = useLoader(
    () => api('GET', '/orders', { token }), [token], onAuthError);
  const { locations, items } = useMaster(token, onAuthError);
  const [form, setForm] = useState({ location_id: '', item_id: '', quantity: '', customer_name: '' });
  const act = useActions(token, reload, setError, onAuthError);
  const canAct = [ADMIN, SALES].includes(role);

  const create = (e) => {
    e.preventDefault();
    act(async () => {
      await api('POST', '/orders', { token, body: { ...form, quantity: Number(form.quantity) } });
      setForm({ location_id: '', item_id: '', quantity: '', customer_name: '' });
    });
  };

  return (
    <section>
      <h2>Customer Orders</h2>
      <Msg error={error} />
      <Table
        columns={[
          { header: 'Order', render: (r) => r.order_code },
          { header: 'Customer', render: (r) => r.customer_name },
          { header: 'Location', render: (r) => r.location },
          { header: 'Item', render: (r) => r.item },
          { header: 'Quantity', render: (r) => r.quantity },
          { header: 'Status', render: (r) => r.status },
          { header: 'Actions', render: (r) => (
              <>
                {canAct && r.status === 'RESERVED' && <>
                  <button onClick={() => act(() => api('PATCH', `/orders/${r.id}/complete`, { token }))}>Complete</button>{' '}
                  <button className="danger" onClick={() => act(() => api('PATCH', `/orders/${r.id}/cancel`, { token }))}>Cancel</button>
                </>}
              </>) },
        ]}
        rows={data}
        empty="No orders"
      />
      {canAct && (
        <form className="card inline" onSubmit={create}>
          <h3>New order (reserves stock)</h3>
          <label>Customer<input value={form.customer_name} onChange={(e) => setForm({ ...form, customer_name: e.target.value })} required /></label>
          <Select label="Location" value={form.location_id} onChange={(v) => setForm({ ...form, location_id: v })} options={locations} />
          <Select label="Item" value={form.item_id} onChange={(v) => setForm({ ...form, item_id: v })} options={items} />
          <label>Quantity<input type="number" min="1" step="1" value={form.quantity} onChange={(e) => setForm({ ...form, quantity: e.target.value })} required /></label>
          <button type="submit">Create order</button>
        </form>
      )}
    </section>
  );
}
