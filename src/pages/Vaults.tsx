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
import { MOMO_NETWORKS, toLocalGhanaNumber } from '../utils/momo';

// Same rule as the backend: withdrawable from lock_until (inclusive), local date.
function isLocked(v: Vault) {
  const today = new Date();
  const local = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
  return local < v.lock_until;
}

function formatGhs(value: string | number) {
  const n = typeof value === 'string' ? parseFloat(value) : value;
  return `GHS ${n.toLocaleString('en-GH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export default function Vaults() {
  const { user, refreshUser } = useAuth();
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
      // A card payment saves the card, which is what unlocks auto-contribute.
      refreshUser();
    } else {
      setSuccess('');
      setError(message);
    }
    load();
  });

  // Withdrawals go to the saved payout number unless the owner changes it here.
  const openWithdraw = (v: Vault) => {
    setActionVault(v);
    setActionType('withdraw');
    setModalError('');
    setWithdrawForm({
      momo_number: toLocalGhanaNumber(user?.default_momo_number),
      momo_network_bank_code: user?.default_momo_bank_code || 'MTN',
      account_name: user?.default_account_name || user?.full_name || '',
    });
  };

  // Errors from a form go inside that form's modal - the page-level alert
  // sits behind the overlay where nobody can see it.
  const [modalError, setModalError] = useState('');

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError('');
    setModalError('');
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
      setModalError(getErrorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  const handleContribute = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!actionVault) return;
    setBusy(true);
    setError('');
    setModalError('');
    let res;
    try {
      res = await contributeToVault(actionVault.id, contribForm.amount, contribForm.email);
    } catch (err) {
      setModalError(getErrorMessage(err)); // modal still open
      setBusy(false);
      return;
    }
    try {
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
    setModalError('');
    try {
      await withdrawFromVault(actionVault.id, withdrawForm);
      setSuccess('Withdrawal started - the money is on its way to your mobile money wallet.');
      setActionVault(null);
      setActionType(null);
      load();
    } catch (err) {
      setModalError(getErrorMessage(err));
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
          <button className="btn btn-primary" onClick={() => { setModalError(''); setShowCreate(true); }}>New vault</button>
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
                {v.status === 'withdrawn' && v.last_withdrawal_status && (
                  <div style={{ fontSize: '0.85rem', marginBottom: '0.5rem' }}>
                    Withdrawal:{' '}
                    <span className={`badge badge-${v.last_withdrawal_status === 'completed' ? 'success' : v.last_withdrawal_status === 'failed' ? 'failed' : 'pending'}`}>
                      {v.last_withdrawal_status === 'completed' ? 'Delivered to MoMo' : v.last_withdrawal_status === 'failed' ? 'Failed' : 'Sending to MoMo'}
                    </span>
                  </div>
                )}
                <div className="btn-group">
                  {/* Only what the backend will accept: a withdrawn/cancelled vault
                      takes no more money, and a locked or empty one can't be withdrawn. */}
                  {['active', 'matured'].includes(v.status) && (
                    <button
                      className="btn btn-sm btn-primary"
                      onClick={() => {
                        setActionVault(v);
                        setActionType('contribute');
                        setModalError('');
                        setContribForm({ amount: v.contribution_amount, email: user?.email || '' });
                      }}
                    >
                      Contribute
                    </button>
                  )}
                  {['active', 'matured'].includes(v.status) && parseFloat(v.balance) > 0 && (
                    isLocked(v) ? (
                      <span className="text-muted" style={{ fontSize: '0.8rem', alignSelf: 'center' }}>
                        Withdraw from {v.lock_until}
                      </span>
                    ) : (
                      <button className="btn btn-sm btn-secondary" onClick={() => openWithdraw(v)}>
                        Withdraw
                      </button>
                    )
                  )}
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
                    if (v.status !== 'active') return null; // a withdrawn/cancelled/matured vault can't start one
                    // Say why up front rather than letting the button fail after a tap
                    // (backend: recurring_enable needs a saved card and a weekly/monthly vault).
                    if (v.frequency === 'daily') {
                      return (
                        <span className="text-muted" style={{ fontSize: '0.78rem', alignSelf: 'center' }}>
                          Auto-contribute is weekly or monthly only
                        </span>
                      );
                    }
                    if (!user?.has_saved_card) {
                      return (
                        <span className="text-muted" style={{ fontSize: '0.78rem', alignSelf: 'center' }}>
                          Pay one contribution by card to turn on auto-contribute
                        </span>
                      );
                    }
                    return (
                      <button
                        className="btn btn-sm btn-outline"
                        onClick={() => handleRecurring(v, 'enable')}
                        disabled={busy}
                        title={user.paystack_card_last4 ? `Charges your card ending ${user.paystack_card_last4}` : undefined}
                      >
                        Enable auto{user.paystack_card_last4 ? ` (card •${user.paystack_card_last4})` : ''}
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
                  {/* Cancel is only for an empty vault made by mistake; one holding money is withdrawn instead. */}
                  {v.status === 'active' && parseFloat(v.balance) === 0 && (
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
            {modalError && <div className="alert alert-error">{modalError}</div>}
            <form onSubmit={handleCreate}>
              <div className="form-group">
                <label htmlFor="vault-name">Name</label>
                <input id="vault-name" required value={createForm.name} onChange={(e) => setCreateForm({ ...createForm, name: e.target.value })} />
              </div>
              <div className="form-group">
                <label htmlFor="vault-target">Target amount (GHS)</label>
                <input id="vault-target" required type="number" step="0.01" min="1" value={createForm.target_amount} onChange={(e) => setCreateForm({ ...createForm, target_amount: e.target.value })} />
              </div>
              <div className="form-group">
                <label htmlFor="vault-contribution">Contribution amount (GHS)</label>
                <input id="vault-contribution" required type="number" step="0.01" min="1" value={createForm.contribution_amount} onChange={(e) => setCreateForm({ ...createForm, contribution_amount: e.target.value })} />
              </div>
              <div className="form-group">
                <label htmlFor="vault-frequency">Frequency</label>
                <select id="vault-frequency" value={createForm.frequency} onChange={(e) => setCreateForm({ ...createForm, frequency: e.target.value })}>
                  <option value="daily">Daily</option>
                  <option value="weekly">Weekly</option>
                  <option value="monthly">Monthly</option>
                </select>
              </div>
              <div className="form-group">
                <label htmlFor="vault-lock">Lock until</label>
                <input id="vault-lock" required type="date" min={new Date().toISOString().slice(0, 10)} value={createForm.lock_until} onChange={(e) => setCreateForm({ ...createForm, lock_until: e.target.value })} />
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
            {modalError && <div className="alert alert-error">{modalError}</div>}
            <form onSubmit={handleContribute}>
              <div className="form-group">
                <label htmlFor="vault-contrib-amount">Amount (GHS)</label>
                <input id="vault-contrib-amount" required type="number" step="0.01" min="1" value={contribForm.amount} onChange={(e) => setContribForm({ ...contribForm, amount: e.target.value })} />
              </div>
              <div className="form-group">
                <label htmlFor="vault-contrib-email">Email (Paystack)</label>
                <input id="vault-contrib-email" required type="email" autoComplete="email" value={contribForm.email} onChange={(e) => setContribForm({ ...contribForm, email: e.target.value })} />
              </div>
              {!user?.has_saved_card && (
                <p className="text-muted" style={{ fontSize: '0.78rem', marginTop: '-0.5rem', marginBottom: '0.5rem' }}>
                  Tip: pay by card once and you can switch on auto-contribute.
                </p>
              )}
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
            {modalError && <div className="alert alert-error">{modalError}</div>}
            {/* Exactly what will be sent - priced by the backend with the same fee the withdrawal charges. */}
            {actionVault.withdrawal_net != null && (
              <div style={{ fontSize: '0.9rem', marginBottom: '1rem', padding: '0.7rem 0.85rem', borderRadius: 8, background: '#f0fdfa', border: '1px solid #99f6e4' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                  <span>Vault balance</span><span>{formatGhs(actionVault.balance)}</span>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', color: 'var(--text-secondary)' }}>
                  <span>Platform fee</span><span>− {formatGhs(actionVault.withdrawal_fee || 0)}</span>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontWeight: 700, borderTop: '1px solid #99f6e4', marginTop: '0.35rem', paddingTop: '0.35rem' }}>
                  <span>You receive</span><span>{formatGhs(actionVault.withdrawal_net)}</span>
                </div>
                <div className="text-muted" style={{ fontSize: '0.78rem', marginTop: '0.35rem' }}>
                  The whole balance is withdrawn and the vault closes.
                </div>
              </div>
            )}
            <form onSubmit={handleWithdraw}>
              <div className="form-group">
                <label htmlFor="vault-wd-number">Mobile money number</label>
                <input id="vault-wd-number" required inputMode="tel" autoComplete="tel-national" value={withdrawForm.momo_number} onChange={(e) => setWithdrawForm({ ...withdrawForm, momo_number: e.target.value })} />
                {user?.default_momo_number && (
                  <div className="text-muted" style={{ fontSize: '0.78rem', marginTop: '0.3rem' }}>
                    Your saved payout number - change it here for this withdrawal only.
                  </div>
                )}
              </div>
              <div className="form-group">
                <label htmlFor="vault-wd-network">Network</label>
                <select id="vault-wd-network" value={withdrawForm.momo_network_bank_code} onChange={(e) => setWithdrawForm({ ...withdrawForm, momo_network_bank_code: e.target.value })}>
                  {MOMO_NETWORKS.map((n) => <option key={n.code} value={n.code}>{n.label}</option>)}
                </select>
              </div>
              <div className="form-group">
                <label htmlFor="vault-wd-name">Account name</label>
                <input id="vault-wd-name" required autoComplete="name" value={withdrawForm.account_name} onChange={(e) => setWithdrawForm({ ...withdrawForm, account_name: e.target.value })} />
              </div>
              <div className="modal-actions">
                <button type="button" className="btn btn-outline" onClick={() => { setActionVault(null); setActionType(null); }}>Cancel</button>
                <button type="submit" className="btn btn-primary" disabled={busy}>
                  {busy ? 'Withdrawing…' : actionVault.withdrawal_net != null ? `Withdraw ${formatGhs(actionVault.withdrawal_net)}` : 'Withdraw'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
