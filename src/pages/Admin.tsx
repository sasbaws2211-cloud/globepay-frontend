import React, { useCallback, useEffect, useState } from 'react';
import {
  getAdminStats,
  getAdminUsers,
  setAdminUserStatus,
  getPendingKyc,
  approveKyc,
  rejectKyc,
  getStuckTransactions,
  getAuditLog,
  adminRetryCrossBorder,
  adminRefundCrossBorder,
  adminRetryCard,
  adminRefundCard,
  type PlatformStats,
  type AdminUserSummary,
  type StuckTransaction,
  type AuditLogEntry,
} from '../api/services';
import type { User } from '../api/types';
import { getErrorMessage } from '../api/client';

export default function Admin() {
  const [stats, setStats] = useState<PlatformStats | null>(null);
  const [users, setUsers] = useState<AdminUserSummary[]>([]);
  const [pendingKyc, setPendingKyc] = useState<User[]>([]);
  const [stuck, setStuck] = useState<StuckTransaction[]>([]);
  const [audit, setAudit] = useState<AuditLogEntry[]>([]);
  const [query, setQuery] = useState('');
  const [loading, setLoading] = useState(true);
  const [forbidden, setForbidden] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [busy, setBusy] = useState(false);
  const [rejectReason, setRejectReason] = useState<Record<string, string>>({});
  const [tab, setTab] = useState<'overview' | 'users' | 'kyc' | 'stuck' | 'audit'>('overview');

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const [s, u, k, st, a] = await Promise.all([
        getAdminStats(),
        getAdminUsers(),
        getPendingKyc(),
        getStuckTransactions(),
        getAuditLog(),
      ]);
      setStats(s);
      setUsers(u);
      setPendingKyc(k);
      setStuck(st);
      setAudit(a);
      setForbidden(false);
    } catch (err) {
      const msg = getErrorMessage(err);
      if (msg.toLowerCase().includes('admin') || msg.toLowerCase().includes('forbidden') || msg.includes('403')) {
        setForbidden(true);
      } else {
        setError(msg);
      }
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const run = async (fn: () => Promise<void>, ok: string) => {
    setBusy(true);
    setError('');
    setSuccess('');
    try {
      await fn();
      setSuccess(ok);
      await load();
    } catch (err) {
      setError(getErrorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  const searchUsers = async () => {
    setBusy(true);
    try {
      setUsers(await getAdminUsers(query.trim() || undefined));
    } catch (err) {
      setError(getErrorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  if (loading) {
    return (
      <div className="loading-center">
        <div className="spinner" />
        <p>Loading admin…</p>
      </div>
    );
  }

  if (forbidden) {
    return (
      <div className="card">
        <h1>Admin</h1>
        <div className="alert alert-error" style={{ marginTop: '1rem' }}>
          You do not have admin access. Promote a user with the backend script{' '}
          <code>scripts/promote_admin.py</code>.
        </div>
      </div>
    );
  }

  return (
    <div>
      <div className="page-header">
        <h1>Admin panel</h1>
        <button className="btn btn-outline" onClick={load} disabled={busy}>
          Refresh
        </button>
      </div>

      {error && <div className="alert alert-error">{error}</div>}
      {success && <div className="alert alert-success">{success}</div>}

      <div className="btn-group" style={{ marginBottom: '1rem' }}>
        {(['overview', 'users', 'kyc', 'stuck', 'audit'] as const).map((t) => (
          <button
            key={t}
            className={`btn btn-sm ${tab === t ? 'btn-primary' : 'btn-outline'}`}
            onClick={() => setTab(t)}
          >
            {t === 'kyc' ? 'Pending KYC' : t === 'stuck' ? 'Stuck txns' : t.charAt(0).toUpperCase() + t.slice(1)}
          </button>
        ))}
      </div>

      {tab === 'overview' && stats && (
        <div className="grid grid-4">
          <div className="stat-card">
            <div className="stat-label">Users</div>
            <div className="stat-value">{stats.total_users}</div>
          </div>
          <div className="stat-card">
            <div className="stat-label">Vaults</div>
            <div className="stat-value">{stats.total_vaults}</div>
          </div>
          <div className="stat-card">
            <div className="stat-label">Vault balance</div>
            <div className="stat-value" style={{ fontSize: '1.2rem' }}>
              GHS {parseFloat(stats.total_vault_balance).toLocaleString()}
            </div>
          </div>
          <div className="stat-card">
            <div className="stat-label">Fees collected</div>
            <div className="stat-value" style={{ fontSize: '1.2rem' }}>
              GHS {parseFloat(stats.total_fees_collected).toLocaleString()}
            </div>
          </div>
          <div className="stat-card">
            <div className="stat-label">Stuck transactions</div>
            <div className={`stat-value ${stats.stuck_transaction_count > 0 ? 'negative' : ''}`}>
              {stats.stuck_transaction_count}
            </div>
          </div>
        </div>
      )}

      {tab === 'users' && (
        <div className="card">
          <div className="btn-group" style={{ marginBottom: '1rem' }}>
            <input
              style={{ flex: 1, minWidth: 180, padding: '0.5rem 0.75rem', borderRadius: 8, border: '1px solid #99f6e4' }}
              placeholder="Search phone or name"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
            <button className="btn btn-primary" onClick={searchUsers} disabled={busy}>
              Search
            </button>
          </div>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Phone</th>
                  <th>Status</th>
                  <th>Admin</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {users.map((u) => (
                  <tr key={u.id}>
                    <td>{u.full_name}</td>
                    <td>{u.phone_number}</td>
                    <td>
                      <span className={`badge badge-${u.is_active ? 'success' : 'failed'}`}>
                        {u.is_active ? 'active' : 'suspended'}
                      </span>
                    </td>
                    <td>{u.is_admin ? 'Yes' : '—'}</td>
                    <td>
                      <button
                        className={`btn btn-sm ${u.is_active ? 'btn-danger' : 'btn-primary'}`}
                        disabled={busy || u.is_admin}
                        onClick={() =>
                          run(
                            async () => {
                              await setAdminUserStatus(u.id, !u.is_active);
                            },
                            u.is_active ? 'User suspended' : 'User reactivated'
                          )
                        }
                      >
                        {u.is_active ? 'Suspend' : 'Reactivate'}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {tab === 'kyc' && (
        <div className="card">
          {pendingKyc.length === 0 ? (
            <div className="empty-state">
              <p>No pending KYC submissions.</p>
            </div>
          ) : (
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Name</th>
                    <th>Phone</th>
                    <th>Tier / status</th>
                    <th>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {pendingKyc.map((u) => (
                    <tr key={u.id}>
                      <td>{u.full_name}</td>
                      <td>{u.phone_number}</td>
                      <td>
                        {u.kyc_tier} / {u.kyc_status}
                      </td>
                      <td>
                        <div className="btn-group">
                          <button
                            className="btn btn-sm btn-primary"
                            disabled={busy}
                            onClick={() =>
                              run(async () => {
                                await approveKyc(u.id);
                              }, 'KYC approved')
                            }
                          >
                            Approve
                          </button>
                          <input
                            style={{ width: 140, padding: '0.3rem 0.5rem', borderRadius: 6, border: '1px solid #99f6e4' }}
                            placeholder="Reject reason"
                            value={rejectReason[u.id] || ''}
                            onChange={(e) =>
                              setRejectReason({ ...rejectReason, [u.id]: e.target.value })
                            }
                          />
                          <button
                            className="btn btn-sm btn-danger"
                            disabled={busy}
                            onClick={() =>
                              run(async () => {
                                await rejectKyc(u.id, rejectReason[u.id] || 'Rejected by admin');
                              }, 'KYC rejected')
                            }
                          >
                            Reject
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {tab === 'stuck' && (
        <div className="card">
          {stuck.length === 0 ? (
            <div className="empty-state">
              <p>No stuck transactions.</p>
            </div>
          ) : (
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Kind</th>
                    <th>User</th>
                    <th>Amount</th>
                    <th>Status</th>
                    <th>Retries</th>
                    <th>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {stuck.map((t) => (
                    <tr key={`${t.kind}-${t.id}`}>
                      <td>{t.kind}</td>
                      <td>{t.user_phone}</td>
                      <td>{t.amount}</td>
                      <td>
                        <span className="badge badge-pending">{t.status}</span>
                        {t.failure_reason && (
                          <div style={{ fontSize: '0.75rem', color: 'var(--danger)' }}>{t.failure_reason}</div>
                        )}
                      </td>
                      <td>{t.retry_count}</td>
                      <td>
                        <div className="btn-group">
                          <button
                            className="btn btn-sm btn-primary"
                            disabled={busy}
                            onClick={() =>
                              run(async () => {
                                if (t.kind.includes('crossborder')) await adminRetryCrossBorder(t.id);
                                else if (t.kind.includes('card')) await adminRetryCard(t.id);
                              }, 'Retry queued')
                            }
                          >
                            Retry
                          </button>
                          <button
                            className="btn btn-sm btn-danger"
                            disabled={busy}
                            onClick={() =>
                              run(async () => {
                                if (t.kind.includes('crossborder')) await adminRefundCrossBorder(t.id);
                                else if (t.kind.includes('card')) await adminRefundCard(t.id);
                              }, 'Refund initiated')
                            }
                          >
                            Refund
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {tab === 'audit' && (
        <div className="card">
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>When</th>
                  <th>Admin</th>
                  <th>Action</th>
                  <th>Target</th>
                </tr>
              </thead>
              <tbody>
                {audit.map((a) => (
                  <tr key={a.id}>
                    <td>{new Date(a.created_at).toLocaleString()}</td>
                    <td>{a.admin_name}</td>
                    <td>{a.action}</td>
                    <td>
                      {a.target_type} · {a.target_id.slice(0, 8)}…
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
