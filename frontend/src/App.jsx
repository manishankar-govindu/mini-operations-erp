import React, { useState } from 'react';
import { LoginPage, InventoryPage, WorkOrdersPage, TransfersPage, OrdersPage } from './pages.jsx';

const ROLE_LABEL = { admin: 'Admin', operations_user: 'Operations User', sales_user: 'Sales User' };

const TABS = [
  { key: 'inventory', label: 'Inventory', roles: ['admin', 'operations_user', 'sales_user'] },
  { key: 'workorders', label: 'Work Orders', roles: ['admin', 'operations_user'] },
  { key: 'transfers', label: 'Internal Transfers', roles: ['admin', 'operations_user'] },
  { key: 'orders', label: 'Customer Orders', roles: ['admin', 'sales_user'] },
];

export default function App() {
  const [session, setSession] = useState(() => {
    try { return JSON.parse(localStorage.getItem('erp-session')); } catch { return null; }
  });
  const [tab, setTab] = useState('inventory');

  const signIn = (s) => { localStorage.setItem('erp-session', JSON.stringify(s)); setSession(s); };
  const signOut = () => { localStorage.removeItem('erp-session'); setSession(null); };

  if (!session) return <LoginPage onLogin={signIn} />;

  // Tabs the user may see. Backend still enforces every permission.
  const visible = TABS.filter((t) => t.roles.includes(session.user.role));
  const current = visible.find((t) => t.key === tab) ? tab : visible[0].key;
  const token = session.token;
  const onAuthError = (e) => { if (e.status === 401) signOut(); };

  const pages = {
    inventory: <InventoryPage token={token} role={session.user.role} onAuthError={onAuthError} />,
    workorders: <WorkOrdersPage token={token} role={session.user.role} onAuthError={onAuthError} />,
    transfers: <TransfersPage token={token} role={session.user.role} onAuthError={onAuthError} />,
    orders: <OrdersPage token={token} role={session.user.role} onAuthError={onAuthError} />,
  };

  return (
    <div className="layout">
      <header className="topbar">
        <strong>Mini Operations ERP</strong>
        <span className="who">{session.user.full_name} · {ROLE_LABEL[session.user.role]}</span>
        <button className="link" onClick={signOut}>Logout</button>
      </header>
      <nav className="tabs">
        {visible.map((t) => (
          <button key={t.key} className={current === t.key ? 'active' : ''} onClick={() => setTab(t.key)}>{t.label}</button>
        ))}
      </nav>
      <main>{pages[current]}</main>
    </div>
  );
}
