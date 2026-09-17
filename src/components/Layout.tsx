import React from 'react';
import { NavLink, Outlet, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';

const navItems = [
  { to: '/', label: 'Dashboard', end: true },
  { to: '/transfers', label: 'Transfers' },
  { to: '/vaults', label: 'Vaults' },
  { to: '/cards', label: 'Cards' },
  { to: '/crossborder', label: 'Go Global' },
  { to: '/splits', label: 'Split Bills' },
  { to: '/settings', label: 'Settings' },
  { to: '/admin', label: 'Admin' },
];

export default function Layout() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();

  const handleLogout = () => {
    logout();
    navigate('/login');
  };

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="sidebar-logo">GlobePay</div>
        <nav className="sidebar-nav">
          {navItems.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.end}
              className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`}
            >
              {item.label}
            </NavLink>
          ))}
        </nav>
        <div className="sidebar-footer">
          <div style={{ marginBottom: '0.5rem' }}>{user?.full_name}</div>
          <div style={{ opacity: 0.8, fontSize: '0.8rem' }}>{user?.phone_number}</div>
          <button
            className="btn btn-outline"
            style={{ marginTop: '0.75rem', width: '100%', color: 'white', borderColor: 'rgba(255,255,255,0.4)' }}
            onClick={handleLogout}
          >
            Log out
          </button>
        </div>
      </aside>
      <main className="main">
        <Outlet />
      </main>
    </div>
  );
}
