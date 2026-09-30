import React, { useEffect, useState, useCallback } from 'react';
import {
  createSplitBill,
  getPendingShares,
  getSplitBills,
  getVaults,
  cancelSplitBill,
  closeSplitBill,
  paySplitShare,
  retrySplitSharePayout,
  withdrawSplitBill,
} from '../api/services';
import type { SplitBill, Vault } from '../api/types';
import { getErrorMessage } from '../api/client';
import { openPaystackCheckout } from '../api/paystack';
import { describeSettledPayment, usePaymentTracker } from '../hooks/usePaymentTracker';
import { useAuth } from '../context/AuthContext';

function formatGhs(value: string | number) {
  const n = typeof value === 'string' ? parseFloat(value) : value;
  return `GHS ${n.toLocaleString('en-GH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

type PendingShare = {
  id: string;
  split_bill_id: string;
  user_id: string;
  gross_amount: string;
  status: string;
  created_at: string;
  paid_at: string | null;
};

export default function Splits() {
  const { user } = useAuth();
  const [bills, setBills] = useState<SplitBill[]>([]);
  const [pending, setPending] = useState<PendingShare[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [showCreate, setShowCreate] = useState(false);
  const [busy, setBusy] = useState(false);
  const [payEmail, setPayEmail] = useState(user?.email || '');
  const [payingId, setPayingId] = useState<string | null>(null);

  const [form, setForm] = useState({
    title: '',
    total_amount: '',
    phones: '',
  });

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      // Every bill I organized or owe a share in comes from the backend, on
      // any device - this replaced remembering bill ids in the browser.
      const [p, mine] = await Promise.all([
        getPendingShares().catch(() => [] as PendingShare[]),
        getSplitBills(),
      ]);
      setPending(p);
      setBills(mine);
    } catch (err) {
      setError(getErrorMessage(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  // A mobile money withdrawal settles in the background (webhook / 2-minute
  // sweep) - keep the page fresh while one is in flight.
  const withdrawalInFlight = bills.some((b) => b.withdrawal?.status === 'pending');
  useEffect(() => {
    if (!withdrawalInFlight) return;
    const t = setInterval(() => {
      getSplitBills().then(setBills).catch(() => {});
    }, 5000);
    return () => clearInterval(t);
  }, [withdrawalInFlight]);

  // ─── Withdraw (collecting bills, organizer) ───
  const [withdrawBill, setWithdrawBill] = useState<SplitBill | null>(null);
  const [destination, setDestination] = useState<'momo' | 'vault'>('momo');
  const [vaults, setVaults] = useState<Vault[]>([]);
  const [vaultId, setVaultId] = useState('');
  const [withdrawError, setWithdrawError] = useState('');

  const openWithdraw = async (bill: SplitBill) => {
    setWithdrawBill(bill);
    setWithdrawError('');
    setDestination(user?.default_momo_number ? 'momo' : 'vault');
    try {
      // A withdrawn or cancelled vault can't take money any more.
      const open = (await getVaults()).filter((v) => !['withdrawn', 'cancelled'].includes(v.status));
      setVaults(open);
      setVaultId(open[0]?.id || '');
    } catch {
      setVaults([]);
    }
  };

  const handleWithdraw = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!withdrawBill) return;
    setBusy(true);
    setWithdrawError('');
    try {
      const updated = await withdrawSplitBill(
        withdrawBill.id,
        destination === 'vault' ? { destination, vault_id: vaultId } : { destination }
      );
      const w = updated.withdrawal;
      setWithdrawBill(null);
      setError('');
      if (w?.status === 'failed') {
        setSuccess('');
        setError(`Withdrawal didn't go through: ${w.failure_reason || 'unknown reason'}. You can try again.`);
      } else {
        setSuccess(
          w?.destination === 'vault'
            ? `${formatGhs(w.amount)} added to your vault "${w.vault_name}" - no fee.`
            : `${formatGhs(w?.amount || 0)} is on its way to your mobile money.`
        );
      }
      load();
    } catch (err) {
      setWithdrawError(getErrorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  const handleClose = async (bill: SplitBill) => {
    const unpaid = bill.shares.filter((s) => s.status === 'pending').length;
    if (!window.confirm(
      `Close "${bill.title}"? ${unpaid} unpaid ${unpaid === 1 ? 'share' : 'shares'} will be dropped and you can withdraw what's been collected.`
    )) return;
    setBusy(true);
    setError('');
    try {
      await closeSplitBill(bill.id);
      setSuccess('Bill closed - you can now withdraw what was collected.');
      load();
    } catch (err) {
      setError(getErrorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  const { track, tracking } = usePaymentTracker((result) => {
    const { ok, message } = describeSettledPayment(result);
    if (ok) {
      setError('');
      setSuccess(`${message} Your share is marked paid.`);
    } else {
      setSuccess('');
      setError(message);
    }
    load();
  });

  // Errors from the create form go inside its modal - the page-level alert
  // sits behind the overlay where nobody can see it.
  const [modalError, setModalError] = useState('');

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError('');
    setModalError('');
    try {
      const phones = form.phones
        .split(/[\n,]+/)
        .map((x) => x.trim())
        .filter(Boolean);
      await createSplitBill({
        title: form.title,
        total_amount: form.total_amount,
        participant_phone_numbers: phones,
      });
      setSuccess('Split bill created');
      setShowCreate(false);
      setForm({ title: '', total_amount: '', phones: '' });
      load();
    } catch (err) {
      setModalError(getErrorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  const handleCancel = async (bill: SplitBill) => {
    if (!window.confirm(`Cancel split “${bill.title}”? Only allowed if nobody has paid yet.`)) return;
    setBusy(true);
    setError('');
    try {
      await cancelSplitBill(bill.id);
      setSuccess('Split cancelled');
      load();
    } catch (err) {
      setError(getErrorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  const handleRetryPayout = async (bill: SplitBill, shareId: string) => {
    setBusy(true);
    setError('');
    try {
      await retrySplitSharePayout(bill.id, shareId);
      setSuccess('Payout re-sent');
      load();
    } catch (err) {
      setError(getErrorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  const handlePay = async (splitBillId: string) => {
    setBusy(true);
    setError('');
    try {
      const res = await paySplitShare(splitBillId, payEmail.trim() || user?.email || '');
      setPayingId(null);
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

  return (
    <div>
      <div className="page-header">
        <h1>Split Bills</h1>
        <div className="btn-group">
          {tracking && <span className="text-muted" style={{ alignSelf: 'center', fontSize: '0.85rem' }}>Updating…</span>}
          <button className="btn btn-outline" onClick={load}>
            Refresh
          </button>
          <button className="btn btn-primary" onClick={() => { setModalError(''); setShowCreate(true); }}>
            New split
          </button>
        </div>
      </div>

      {error && <div className="alert alert-error">{error}</div>}
      {success && <div className="alert alert-success">{success}</div>}

      {/* Pending shares to pay */}
      <div className="card" style={{ marginBottom: '1rem' }}>
        <h2 style={{ fontSize: '1.1rem', marginBottom: '0.75rem' }}>Your pending shares</h2>
        {pending.length === 0 ? (
          <p style={{ color: 'var(--text-secondary)', fontSize: '0.9rem' }}>Nothing to pay right now.</p>
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Amount</th>
                  <th>Status</th>
                  <th>Date</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {pending.map((s) => (
                  <tr key={s.id}>
                    <td>{formatGhs(s.gross_amount)}</td>
                    <td>
                      <span className="badge badge-pending">{s.status}</span>
                    </td>
                    <td>{new Date(s.created_at).toLocaleDateString()}</td>
                    <td>
                      {payingId === s.split_bill_id ? (
                        <div className="btn-group">
                          <input
                            style={{ width: 160, padding: '0.3rem 0.5rem', borderRadius: 6, border: '1px solid #99f6e4' }}
                            type="email"
                            placeholder="Email for Paystack"
                            value={payEmail}
                            onChange={(e) => setPayEmail(e.target.value)}
                          />
                          <button
                            className="btn btn-sm btn-primary"
                            disabled={busy}
                            onClick={() => handlePay(s.split_bill_id)}
                          >
                            Pay now
                          </button>
                          <button className="btn btn-sm btn-outline" onClick={() => setPayingId(null)}>
                            Cancel
                          </button>
                        </div>
                      ) : (
                        <button
                          className="btn btn-sm btn-primary"
                          onClick={() => {
                            setPayingId(s.split_bill_id);
                            setPayEmail(user?.email || '');
                          }}
                        >
                          Pay share
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Bills list */}
      {loading ? (
        <div className="loading-center">
          <div className="spinner" />
        </div>
      ) : bills.length === 0 ? (
        <div className="card empty-state">
          <p>No split bills yet. Create one, or bills people add you to will show up here.</p>
        </div>
      ) : (
        <div className="grid grid-2">
          {bills.map((b) => {
            const isOrganizer = user?.id === b.organizer_id;
            const collecting = !!b.collects_funds;
            const others = b.shares.filter((s) => !s.is_organizer);
            const paidCount = others.filter((s) => s.status === 'paid').length;
            const owedCount = others.filter((s) => s.status !== 'cancelled').length;
            const w = b.withdrawal;
            // Withdrawal wording is for the organizer; participants just see the bill is paid up.
            const label =
              !collecting ? b.status
              : b.status === 'open' ? 'collecting'
              : !isOrganizer && (b.status === 'settled' || b.status === 'withdrawn') ? 'settled'
              : b.status === 'settled' ? (w?.status === 'pending' ? 'withdrawing' : 'ready to withdraw')
              : b.status;
            const tone =
              b.status === 'cancelled' ? 'failed'
              : b.status === 'withdrawn' || (!collecting && b.status === 'settled') || (!isOrganizer && b.status === 'settled') ? 'success'
              : b.status === 'settled' ? 'active'
              : 'pending';
            return (
              <div key={b.id} className="card">
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '0.5rem', marginBottom: '0.5rem' }}>
                  <h3 style={{ fontSize: '1.05rem' }}>{b.title}</h3>
                  <span className={`badge badge-${tone}`} style={{ whiteSpace: 'nowrap' }}>{label}</span>
                </div>
                <div style={{ fontWeight: 700, color: 'var(--primary)', marginBottom: '0.5rem' }}>
                  {formatGhs(b.total_amount)}
                </div>
                <div style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', marginBottom: '0.75rem' }}>
                  {isOrganizer ? 'You organized' : 'Participant'} · {new Date(b.created_at).toLocaleDateString()}
                </div>
                {collecting && isOrganizer && b.status !== 'cancelled' && owedCount > 0 && (
                  // How much has come in - held on the bill until the organizer withdraws it.
                  <div style={{ marginBottom: '0.75rem' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.85rem', marginBottom: '0.3rem' }}>
                      <span>{paidCount} of {owedCount} paid</span>
                      <span style={{ fontWeight: 600 }}>{formatGhs(b.collected_gross_amount || 0)} collected</span>
                    </div>
                    <div style={{ height: 6, borderRadius: 999, background: 'var(--border)', overflow: 'hidden' }}>
                      <div style={{ width: `${(paidCount / owedCount) * 100}%`, height: '100%', background: 'var(--primary)', transition: 'width 0.3s' }} />
                    </div>
                  </div>
                )}
                {b.shares && b.shares.length > 0 && (
                  <ul style={{ listStyle: 'none', fontSize: '0.85rem', marginBottom: '0.75rem' }}>
                    {b.shares.map((s) => (
                      <li
                        key={s.id}
                        style={{ display: 'flex', justifyContent: 'space-between', padding: '0.25rem 0' }}
                      >
                        <span>
                          {s.is_organizer
                            ? isOrganizer ? 'You (organizer)' : `${s.participant_name || 'Organizer'} (organizer)`
                            : s.user_id === user?.id ? 'You' : s.participant_name || 'Participant'}
                          {' · '}
                          {formatGhs(s.gross_amount)}
                        </span>
                        <span style={{ display: 'flex', gap: '0.35rem', alignItems: 'center' }}>
                          <span className={`badge badge-${s.status === 'paid' ? 'success' : s.status === 'cancelled' ? 'failed' : 'pending'}`}>
                            {s.is_organizer ? 'covered' : s.status === 'cancelled' ? 'dropped' : s.status}
                          </span>
                          {/* Per-share payouts exist only on older bills; collecting bills pay out once, below. */}
                          {!collecting && isOrganizer && s.status === 'paid' && s.payout_status && s.payout_status !== 'completed' && (
                            <span className={`badge badge-${s.payout_status === 'failed' ? 'failed' : 'pending'}`}>
                              payout {s.payout_status.replaceAll('_', ' ')}
                            </span>
                          )}
                          {!collecting && isOrganizer && s.payout_status === 'failed' && (
                            <button className="btn btn-sm btn-outline" disabled={busy} onClick={() => handleRetryPayout(b, s.id)}>
                              Retry payout
                            </button>
                          )}
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
                <div className="btn-group">
                  {/* Only when my own share is still unpaid - the backend refuses a second payment. */}
                  {!isOrganizer && b.status === 'open' && b.shares?.some((s) => s.user_id === user?.id && s.status === 'pending') && (
                    <button
                      className="btn btn-sm btn-primary"
                      onClick={() => {
                        setPayingId(b.id);
                        setPayEmail(user?.email || '');
                      }}
                    >
                      Pay my share
                    </button>
                  )}
                  {/* Cancel only while nobody else has paid - the backend refuses otherwise. */}
                  {isOrganizer && b.status === 'open' && paidCount === 0 && (
                    <button className="btn btn-sm btn-danger" disabled={busy} onClick={() => handleCancel(b)}>
                      Cancel split
                    </button>
                  )}
                  {/* Someone has paid but not everyone: stop waiting and withdraw what came in. */}
                  {collecting && isOrganizer && b.status === 'open' && paidCount > 0 && (
                    <button className="btn btn-sm btn-outline" disabled={busy} onClick={() => handleClose(b)}>
                      Close &amp; collect
                    </button>
                  )}
                  {collecting && isOrganizer && b.status === 'settled' && (!w || w.status === 'failed') && (
                    <button className="btn btn-sm btn-primary" disabled={busy} onClick={() => openWithdraw(b)}>
                      {w?.status === 'failed' ? 'Try withdrawing again' : 'Withdraw'}
                    </button>
                  )}
                </div>
                {collecting && isOrganizer && w && (
                  <div
                    className={`alert ${w.status === 'failed' ? 'alert-error' : w.status === 'completed' ? 'alert-success' : 'alert-info'}`}
                    style={{ marginTop: '0.75rem', marginBottom: 0, fontSize: '0.85rem' }}
                  >
                    {w.status === 'pending' && <>Sending {formatGhs(w.amount)} to your mobile money…</>}
                    {w.status === 'completed' && (
                      w.destination === 'vault'
                        ? <>{formatGhs(w.amount)} added to your vault “{w.vault_name}”{parseFloat(w.fee) > 0 ? ` (after a ${formatGhs(w.fee)} fee)` : ' - no fee'}.</>
                        : <>{formatGhs(w.amount)} sent to your mobile money (after a {formatGhs(w.fee)} fee).</>
                    )}
                    {w.status === 'failed' && <>Withdrawal failed: {w.failure_reason || 'unknown reason'}. Try again to mobile money or a vault.</>}
                  </div>
                )}
                {payingId === b.id && (
                  <div style={{ marginTop: '0.75rem', display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
                    <input
                      style={{ flex: 1, minWidth: 140, padding: '0.4rem 0.6rem', borderRadius: 6, border: '1px solid #99f6e4' }}
                      type="email"
                      placeholder="Email for Paystack"
                      value={payEmail}
                      onChange={(e) => setPayEmail(e.target.value)}
                    />
                    <button className="btn btn-sm btn-primary" disabled={busy} onClick={() => handlePay(b.id)}>
                      Continue to pay
                    </button>
                    <button className="btn btn-sm btn-outline" onClick={() => setPayingId(null)}>
                      Cancel
                    </button>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {withdrawBill && (() => {
        // Vault: everything collected, no fee. Mobile money: after the platform fee.
        const gross = parseFloat(withdrawBill.collected_gross_amount || '0');
        const net = parseFloat(withdrawBill.collected_amount || '0');
        const vaultAmount = formatGhs(gross);
        const momoAmount = formatGhs(net);
        const momoFee = formatGhs(gross - net);
        return (
        <div className="modal-overlay" onClick={() => !busy && setWithdrawBill(null)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h2>Withdraw from “{withdrawBill.title}”</h2>
            <p className="text-muted" style={{ marginTop: '-0.5rem', marginBottom: '1rem' }}>
              {formatGhs(withdrawBill.collected_gross_amount || 0)} was collected. Save it to a vault and there's no fee.
            </p>
            {withdrawError && <div className="alert alert-error">{withdrawError}</div>}
            <form onSubmit={handleWithdraw}>
              <div className="form-group">
                <label>Where should it go?</label>
                <div style={{ display: 'grid', gap: '0.5rem' }}>
                  {([
                    ['momo', `Mobile money - you get ${momoAmount}`,
                      user?.default_momo_number
                        ? `After a ${momoFee} platform fee. To your number ending ${user.default_momo_number.slice(-4)} - usually within a minute.`
                        : 'Add a payout number in Settings first.',
                      !user?.default_momo_number],
                    ['vault', `One of my vaults - you get ${vaultAmount}`,
                      vaults.length ? 'No fee. Added instantly - keep saving it.' : 'You have no open vaults - create one on the Vaults page.',
                      vaults.length === 0],
                  ] as const).map(([value, title, blurb, disabled]) => (
                    <label
                      key={value}
                      style={{
                        display: 'flex', gap: '0.6rem', alignItems: 'flex-start', padding: '0.6rem 0.75rem', borderRadius: 8,
                        border: `1px solid ${destination === value ? 'var(--primary)' : '#d1d5db'}`,
                        opacity: disabled ? 0.55 : 1, cursor: disabled ? 'not-allowed' : 'pointer',
                        fontWeight: 400,
                      }}
                    >
                      <input
                        type="radio"
                        name="destination"
                        value={value}
                        disabled={disabled}
                        checked={destination === value}
                        onChange={() => setDestination(value)}
                        style={{ marginTop: '0.2rem', width: 'auto', flex: '0 0 auto' }}
                      />
                      <span>
                        <strong>{title}</strong>
                        <span className="text-muted" style={{ display: 'block', fontSize: '0.8rem' }}>{blurb}</span>
                      </span>
                    </label>
                  ))}
                </div>
              </div>
              {destination === 'vault' && vaults.length > 0 && (
                <div className="form-group">
                  <label htmlFor="split-vault">Vault</label>
                  <select id="split-vault" required value={vaultId} onChange={(e) => setVaultId(e.target.value)}>
                    {vaults.map((v) => (
                      <option key={v.id} value={v.id}>
                        {v.name} - {formatGhs(v.balance)} of {formatGhs(v.target_amount)}
                      </option>
                    ))}
                  </select>
                </div>
              )}
              <div className="modal-actions">
                <button type="button" className="btn btn-outline" disabled={busy} onClick={() => setWithdrawBill(null)}>
                  Cancel
                </button>
                <button
                  type="submit"
                  className="btn btn-primary"
                  disabled={busy || (destination === 'momo' ? !user?.default_momo_number : !vaultId)}
                >
                  {busy ? 'Withdrawing…' : `Withdraw ${destination === 'vault' ? vaultAmount : momoAmount}`}
                </button>
              </div>
            </form>
          </div>
        </div>
        );
      })()}

      {showCreate && (
        <div className="modal-overlay" onClick={() => setShowCreate(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h2>Create split bill</h2>
            {modalError && <div className="alert alert-error">{modalError}</div>}
            <form onSubmit={handleCreate}>
              <div className="form-group">
                <label>Title</label>
                <input required value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} />
              </div>
              <div className="form-group">
                <label>Total amount (GHS)</label>
                <input
                  required
                  type="number"
                  step="0.01"
                  min="1"
                  value={form.total_amount}
                  onChange={(e) => setForm({ ...form, total_amount: e.target.value })}
                />
              </div>
              <div className="form-group">
                <label>Participant phones (comma or newline)</label>
                <textarea
                  required
                  rows={3}
                  value={form.phones}
                  onChange={(e) => setForm({ ...form, phones: e.target.value })}
                  placeholder="0244123456, 0201234567"
                />
              </div>
              <div className="modal-actions">
                <button type="button" className="btn btn-outline" onClick={() => setShowCreate(false)}>
                  Cancel
                </button>
                <button type="submit" className="btn btn-primary" disabled={busy}>
                  Create
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
