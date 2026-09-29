import React, { useEffect, useState, useCallback } from 'react';
import {
  getVaults,
  createVault,
  contributeToVault,
  withdrawFromVault,
  cancelVault,
  enableRecurring,
  pauseRecurring,
  resumeRecurring,
  cancelRecurring,
  downloadVaultStatement,
} from '../api/services';
import type { Vault } from '../api/types';
import { getErrorMessage } from '../api/client';
import { openPaystackCheckout } from '../api/paystack';
import { describeSettledPayment, usePaymentTracker } from '../hooks/usePaymentTracker';
import { useAuth } from '../context/AuthContext';

function formatGhs(value: string | number) {
  const n = typeof value === 'string' ? parseFloat(value) : value;
  return `GHS ${n.toLocaleString('en-GH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export default function Vaults() {
  const { user } = useAuth();
  const [vaults, setVaults] = useState<Vault[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [showCreate, setShowCreate] = useState(false);
  const [actionVault, setActionVault] = useState<Vault | null>(null);
  const [actionType, setActionType] = useState<'contribute' | 'withdraw' | null>(null);
  const [busy, setBusy] = useState(false);

  const [createForm, setCreateForm] = useState({
    name: '',
    target_amount: '',
    contribution_amount: '',
    frequency: 'weekly',
    lock_until: '',
  });
  const [contribForm, setContribForm] = useState({ amount: '', email: user?.email || '' });
  const [withdrawForm, setWithdrawForm] = useState({
    momo_number: '',
    momo_network_bank_code: 'MTN',
    account_name: '',
  });

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      setVaults(await getVaults());
    } catch (err) {
      setError(getErrorMessage(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const { track, tracking } = usePaymentTracker((result) => {
    const { ok, message } = describeSettledPayment(result);
    if (ok) {
      setError('');
      setSuccess(`${message} Your vault balance has been updated.`);
    } else {
      setSuccess('');
      setError(message);
    }
    load();
  });

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      await createVault({
        name: createForm.name,
        target_amount: createForm.target_amount,
        contribution_amount: createForm.contribution_amount,
        frequency: createForm.frequency,
        lock_until: createForm.lock_until,
      });
      setSuccess('Vault created');
      setShowCreate(false);
      load();
    } catch (err) {
      setError(getErrorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  const handleContribute = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!actionVault) return;
    setBusy(true);
    setError('');
    try {
      const res = await contributeToVault(actionVault.id, contribForm.amount, contribForm.email);
      setActionVault(null);
      setActionType(null);
      const result = await openPaystackCheckout(res.authorization_url);
      setSuccess(
        result === 'success'
          ? 'Payment received - confirming with Paystack…'
          : `Checkout closed before paying. Ref: ${res.reference}`
      );
      track(res.reference);
      load();
    } catch (err) {
      setError(getErrorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  const handleWithdraw = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!actionVault) return;
    setBusy(true);
    setError('');
    try {
      await withdrawFromVault(actionVault.id, withdrawForm);
      setSuccess('Withdrawal initiated');
      setActionVault(null);
      setActionType(null);
      load();
    } catch (err) {
      setError(getErrorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  const handleCancel = async (vault: Vault) => {
    if (!window.confirm(`Cancel vault "${vault.name}"?`)) return;
    setBusy(true);
    try {
      await cancelVault(vault.id);
      setSuccess('Vault cancelled');
      load();
    } catch (err) {
      setError(getErrorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  const handleRecurring = async (
    vault: Vault,
    action: 'enable' | 'pause' | 'resume' | 'cancel'
  ) => {
    const labels = {
      enable: 'Enable auto-contribute for',
      pause: 'Pause auto-contribute for',
      resume: 'Resume auto-contribute for',
      cancel: 'Cancel auto-contribute for',
    };
    if (action === 'cancel' && !window.confirm(`${labels[action]} "${vault.name}"?`)) return;
    setBusy(true);
    setError('');
    try {
      if (action === 'enable') await enableRecurring(vault.id);
      else if (action === 'pause') await pauseRecurring(vault.id);
      else if (action === 'resume') await resumeRecurring(vault.id);
      else await cancelRecurring(vault.id);
      setSuccess(`Recurring ${action}d`);
      load();
    } catch (err) {
      setError(getErrorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div>
      <div className="page-header">
        <h1>Savings Vaults</h1>
        <div className="btn-group">
          {tracking && <span className="text-muted" style={{ alignSelf: 'center', fontSize: '0.85rem' }}>Updating…</span>}
          <button className="btn btn-outline" onClick={load}>Refresh</button>
          <button className="btn btn-primary" onClick={() => setShowCreate(true)}>New vault</button>
        </div>
      </div>

      {error && <div className="alert alert-error">{error}</div>}
      {success && <div className="alert alert-success">{success}</div>}

      {loading ? (
        <div className="loading-center"><div className="spinner" /></div>
      ) : vaults.length === 0 ? (
        <div className="card empty-state">
          <p>No savings vaults yet. Create one to start locking funds toward a goal.</p>
        </div>
      ) : (
        <div className="grid grid-2">
          {vaults.map((v) => {
            const progress = Math.min(100, (parseFloat(v.balance) / parseFloat(v.target_amount)) * 100);
            return (
              <div key={v.id} className="card">
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '0.5rem' }}>
                  <h3 style={{ fontSize: '1.05rem' }}>{v.name}</h3>
                  <span className={`badge badge-${v.status === 'active' ? 'active' : 'pending'}`}>{v.status}</span>
                </div>
                <div style={{ fontSize: '1.25rem', fontWeight: 700, color: 'var(--primary)', marginBottom: '0.35rem' }}>
                  {formatGhs(v.balance)}
                </div>
                <div style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', marginBottom: '0.5rem' }}>
                  of {formatGhs(v.target_amount)} · {v.frequency} · locks until {v.lock_until}
                </div>
                <div style={{ fontSize: '0.8rem', marginBottom: '0.5rem' }}>
                  Auto-contribute:{' '}
                  <span className={`badge badge-${
                    (v.recurring_status || '').toLowerCase() === 'active' ? 'success'
                    : (v.recurring_status || '').toLowerCase() === 'paused' ? 'pending'
                    : 'pending'
                  }`}>
                    {v.recurring_status || 'off'}
                  </span>
                  {v.next_charge_date && (
                    <span style={{ color: 'var(--text-secondary)', marginLeft: '0.5rem' }}>
                      next {v.next_charge_date}
                    </span>
                  )}
                </div>
                <div style={{ height: 8, background: '#ccfbf1', borderRadius: 4, overflow: 'hidden', marginBottom: '1rem' }}>
                  <div style={{ width: `${progress}%`, height: '100%', background: 'var(--primary)' }} />
                </div>
                <div className="btn-group">
                  <button
                    className="btn btn-sm btn-primary"
                    onClick={() => {
                      setActionVault(v);
                      setActionType('contribute');
                      setContribForm({ amount: v.contribution_amount, email: user?.email || '' });
                    }}
                  >
                    Contribute
                  </button>
                  <button
                    className="btn btn-sm btn-secondary"
                    onClick={() => {
                      setActionVault(v);
                      setActionType('withdraw');
                    }}
                  >
                    Withdraw
                  </button>
                  {(() => {
                    const rs = (v.recurring_status || '').toLowerCase();
                    if (rs === 'active') {
                      return (
                        <>
                          <button className="btn btn-sm btn-outline" onClick={() => handleRecurring(v, 'pause')} disabled={busy}>Pause auto</button>
                          <button className="btn btn-sm btn-outline" onClick={() => handleRecurring(v, 'cancel')} disabled={busy}>Stop auto</button>
                        </>
                      );
                    }
                    if (rs === 'paused') {
                      return (
                        <>
                          <button className="btn btn-sm btn-outline" onClick={() => handleRecurring(v, 'resume')} disabled={busy}>Resume auto</button>
                          <button className="btn btn-sm btn-outline" onClick={() => handleRecurring(v, 'cancel')} disabled={busy}>Stop auto</button>
                        </>
                      );
                    }
                    return (
                      <button className="btn btn-sm btn-outline" onClick={() => handleRecurring(v, 'enable')} disabled={busy || v.status !== 'active'}>
                        Enable auto
                      </button>
                    );
                  })()}
                  <button
                    className="btn btn-sm btn-outline"
                    onClick={async () => {
                      setBusy(true);
                      setError('');
                      try {
                        await downloadVaultStatement(v.id, v.name);
                        setSuccess('Statement downloaded');
                      } catch (err) {
                        setError(getErrorMessage(err));
                      } finally {
                        setBusy(false);
                      }
                    }}
                    disabled={busy}
                  >
                    Statement CSV
                  </button>
                  {v.status === 'active' && (
                    <button className="btn btn-sm btn-danger" onClick={() => handleCancel(v)} disabled={busy}>
                      Cancel vault
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {showCreate && (
        <div className="modal-overlay" onClick={() => setShowCreate(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h2>Create vault</h2>
            <form onSubmit={handleCreate}>
              <div className="form-group">
                <label>Name</label>
                <input required value={createForm.name} onChange={(e) => setCreateForm({ ...createForm, name: e.target.value })} />
              </div>
              <div className="form-group">
                <label>Target amount (GHS)</label>
                <input required type="number" step="0.01" min="1" value={createForm.target_amount} onChange={(e) => setCreateForm({ ...createForm, target_amount: e.target.value })} />
              </div>
              <div className="form-group">
                <label>Contribution amount (GHS)</label>
                <input required type="number" step="0.01" min="1" value={createForm.contribution_amount} onChange={(e) => setCreateForm({ ...createForm, contribution_amount: e.target.value })} />
              </div>
              <div className="form-group">
                <label>Frequency</label>
                <select value={createForm.frequency} onChange={(e) => setCreateForm({ ...createForm, frequency: e.target.value })}>
                  <option value="daily">Daily</option>
                  <option value="weekly">Weekly</option>
                  <option value="monthly">Monthly</option>
                </select>
              </div>
              <div className="form-group">
                <label>Lock until</label>
                <input required type="date" value={createForm.lock_until} onChange={(e) => setCreateForm({ ...createForm, lock_until: e.target.value })} />
              </div>
              <div className="modal-actions">
                <button type="button" className="btn btn-outline" onClick={() => setShowCreate(false)}>Cancel</button>
                <button type="submit" className="btn btn-primary" disabled={busy}>Create</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {actionVault && actionType === 'contribute' && (
        <div className="modal-overlay" onClick={() => { setActionVault(null); setActionType(null); }}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h2>Contribute to {actionVault.name}</h2>
            <form onSubmit={handleContribute}>
              <div className="form-group">
                <label>Amount (GHS)</label>
                <input required type="number" step="0.01" min="1" value={contribForm.amount} onChange={(e) => setContribForm({ ...contribForm, amount: e.target.value })} />
              </div>
              <div className="form-group">
                <label>Email (Paystack)</label>
                <input required type="email" value={contribForm.email} onChange={(e) => setContribForm({ ...contribForm, email: e.target.value })} />
              </div>
              <div className="modal-actions">
                <button type="button" className="btn btn-outline" onClick={() => { setActionVault(null); setActionType(null); }}>Cancel</button>
                <button type="submit" className="btn btn-primary" disabled={busy}>Continue to pay</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {actionVault && actionType === 'withdraw' && (
        <div className="modal-overlay" onClick={() => { setActionVault(null); setActionType(null); }}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h2>Withdraw from {actionVault.name}</h2>
            <form onSubmit={handleWithdraw}>
              <div className="form-group">
                <label>Mobile money number</label>
                <input required value={withdrawForm.momo_number} onChange={(e) => setWithdrawForm({ ...withdrawForm, momo_number: e.target.value })} />
              </div>
              <div className="form-group">
                <label>Network</label>
                <select value={withdrawForm.momo_network_bank_code} onChange={(e) => setWithdrawForm({ ...withdrawForm, momo_network_bank_code: e.target.value })}>
                  <option value="MTN">MTN</option>
                  <option value="ATL">AirtelTigo</option>
                  <option value="VOD">Vodafone</option>
                </select>
              </div>
              <div className="form-group">
                <label>Account name</label>
                <input required value={withdrawForm.account_name} onChange={(e) => setWithdrawForm({ ...withdrawForm, account_name: e.target.value })} />
              </div>
              <div className="modal-actions">
                <button type="button" className="btn btn-outline" onClick={() => { setActionVault(null); setActionType(null); }}>Cancel</button>
                <button type="submit" className="btn btn-primary" disabled={busy}>Withdraw</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
