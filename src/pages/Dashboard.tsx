import React, { useEffect, useState, useCallback } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { getWalletSummary, getTransfers, getVaults, getCards } from '../api/services';
import { cardName, visibleCards } from '../utils/cards';
import type { WalletSummary, Transfer, Vault, Card } from '../api/types';
import { getErrorMessage } from '../api/client';

function formatGhs(value: string | number) {
  const n = typeof value === 'string' ? parseFloat(value) : value;
  return `GHS ${n.toLocaleString('en-GH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export default function Dashboard() {
  const { user } = useAuth();
  const [summary, setSummary] = useState<WalletSummary | null>(null);
  const [transfers, setTransfers] = useState<Transfer[]>([]);
  const [vaults, setVaults] = useState<Vault[]>([]);
  const [cards, setCards] = useState<Card[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const [s, t, v, c] = await Promise.all([
        getWalletSummary(),
        getTransfers(),
        getVaults(),
        getCards().catch(() => [] as Card[]),
      ]);
      setSummary(s);
      setTransfers(t.slice(0, 5));
      setVaults(v.slice(0, 3));
      setCards(visibleCards(c).slice(0, 3));
    } catch (err) {
      setError(getErrorMessage(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  if (loading) {
    return (
      <div className="loading-center">
        <div className="spinner" />
        <p>Loading dashboard…</p>
      </div>
    );
  }

  return (
    <div>
      <div className="page-header">
        <div>
          <h1>Hi, {user?.full_name?.split(' ')[0] || 'there'} 👋</h1>
          <p style={{ color: 'var(--text-secondary)', fontSize: '0.95rem' }}>
            Your personal finance overview
          </p>
        </div>
        <button className="btn btn-outline" onClick={load}>
          Refresh
        </button>
      </div>

      {error && <div className="alert alert-error">{error}</div>}

      {summary && (
        <div className="grid grid-4" style={{ marginBottom: '1.5rem' }}>
          <div className="stat-card">
            <div className="stat-label">Received</div>
            <div className="stat-value positive">{formatGhs(summary.received_total)}</div>
          </div>
          <div className="stat-card">
            <div className="stat-label">Sent</div>
            <div className="stat-value">{formatGhs(summary.sent_total)}</div>
          </div>
          <div className="stat-card">
            <div className="stat-label">Fees</div>
            <div className="stat-value">{formatGhs(summary.fee_total)}</div>
          </div>
          <div className="stat-card">
            <div className="stat-label">Net flow</div>
            <div
              className={`stat-value ${parseFloat(summary.net_flow) >= 0 ? 'positive' : 'negative'}`}
            >
              {formatGhs(summary.net_flow)}
            </div>
          </div>
        </div>
      )}

      <div className="grid grid-2">
        <div className="card">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
            <h2 style={{ fontSize: '1.1rem' }}>Recent transfers</h2>
            <Link to="/transfers" className="btn btn-sm btn-outline">View all</Link>
          </div>
          {transfers.length === 0 ? (
            <div className="empty-state">
              <p>No transfers yet. Send money to get started.</p>
            </div>
          ) : (
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Amount</th>
                    <th>Status</th>
                    <th>Date</th>
                  </tr>
                </thead>
                <tbody>
                  {transfers.map((t) => (
                    <tr key={t.id}>
                      <td>{formatGhs(t.gross_amount)}</td>
                      <td>
                        <span className={`badge badge-${t.status === 'completed' ? 'success' : t.status === 'failed' ? 'failed' : 'pending'}`}>
                          {t.status}
                        </span>
                      </td>
                      <td>{new Date(t.created_at).toLocaleDateString()}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        <div className="card">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
            <h2 style={{ fontSize: '1.1rem' }}>Savings vaults</h2>
            <Link to="/vaults" className="btn btn-sm btn-outline">View all</Link>
          </div>
          {vaults.length === 0 ? (
            <div className="empty-state">
              <p>No vaults yet. Create a savings goal.</p>
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
              {vaults.map((v) => (
                <div key={v.id} style={{ padding: '0.75rem', background: '#f0fdfa', borderRadius: 8 }}>
                  <div style={{ fontWeight: 600 }}>{v.name}</div>
                  <div style={{ fontSize: '0.9rem', color: 'var(--text-secondary)' }}>
                    {formatGhs(v.balance)} / {formatGhs(v.target_amount)} · {v.status}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {cards.length > 0 && (
        <div className="card" style={{ marginTop: '1rem' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
            <h2 style={{ fontSize: '1.1rem' }}>Virtual cards</h2>
            <Link to="/cards" className="btn btn-sm btn-outline">Manage</Link>
          </div>
          <div className="grid grid-3">
            {cards.map((c) => (
              <div key={c.id} style={{ padding: '1rem', background: 'linear-gradient(135deg,#0f766e,#134e4a)', color: 'white', borderRadius: 12 }}>
                <div style={{ fontSize: '0.8rem', opacity: 0.85 }}>{cardName(c)}</div>
                <div style={{ fontFamily: 'monospace', letterSpacing: 2, margin: '0.5rem 0' }}>
                  {c.masked_pan || '•••• ••••'}
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.9rem' }}>
                  <span>{c.currency} {parseFloat(c.balance).toFixed(2)}</span>
                  <span className="badge" style={{ background: 'rgba(255,255,255,0.2)', color: 'white' }}>{c.status.replaceAll('_', ' ')}</span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
