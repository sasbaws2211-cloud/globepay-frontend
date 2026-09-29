import React, { useEffect, useState, useCallback } from 'react';
import {
  createSplitBill,
  getPendingShares,
  getSplitBill,
  cancelSplitBill,
  paySplitShare,
  retrySplitSharePayout,
} from '../api/services';
import type { SplitBill } from '../api/types';
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

const STORAGE_KEY = 'globepay_my_splits';

function loadStoredBills(): string[] {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]');
  } catch {
    return [];
  }
}

function storeBillId(id: string) {
  const ids = loadStoredBills();
  if (!ids.includes(id)) {
    localStorage.setItem(STORAGE_KEY, JSON.stringify([id, ...ids].slice(0, 50)));
  }
}

export default function Splits() {
  const { user } = useAuth();
  const [bills, setBills] = useState<SplitBill[]>([]);
  const [pending, setPending] = useState<PendingShare[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [showCreate, setShowCreate] = useState(false);
  const [busy, setBusy] = useState(false);
  const [lookupId, setLookupId] = useState('');
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
      const [p, storedIds] = await Promise.all([
        getPendingShares().catch(() => [] as PendingShare[]),
        Promise.resolve(loadStoredBills()),
      ]);
      setPending(p);

      const loaded: SplitBill[] = [];
      for (const id of storedIds) {
        try {
          loaded.push(await getSplitBill(id));
        } catch {
          /* expired / not found */
        }
      }
      // also attach bills from pending shares
      const pendingBillIds = Array.from(new Set(p.map((s) => s.split_bill_id).filter(Boolean)));
      for (const id of pendingBillIds) {
        if (!loaded.find((b) => b.id === id)) {
          try {
            loaded.push(await getSplitBill(id));
            storeBillId(id);
          } catch {
            /* ignore */
          }
        }
      }
      setBills(loaded);
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
      setSuccess(`${message} Your share is marked paid.`);
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
      const phones = form.phones
        .split(/[\n,]+/)
        .map((x) => x.trim())
        .filter(Boolean);
      const bill = await createSplitBill({
        title: form.title,
        total_amount: form.total_amount,
        participant_phone_numbers: phones,
      });
      storeBillId(bill.id);
      setSuccess('Split bill created');
      setShowCreate(false);
      setForm({ title: '', total_amount: '', phones: '' });
      load();
    } catch (err) {
      setError(getErrorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  const handleLookup = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!lookupId.trim()) return;
    setBusy(true);
    setError('');
    try {
      const bill = await getSplitBill(lookupId.trim());
      storeBillId(bill.id);
      setSuccess(`Loaded “${bill.title}”`);
      setLookupId('');
      load();
    } catch (err) {
      setError(getErrorMessage(err));
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
          <button className="btn btn-primary" onClick={() => setShowCreate(true)}>
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

      {/* Lookup by ID */}
      <div className="card" style={{ marginBottom: '1rem' }}>
        <h2 style={{ fontSize: '1.05rem', marginBottom: '0.5rem' }}>Open a split by ID</h2>
        <form onSubmit={handleLookup} className="btn-group">
          <input
            style={{ flex: 1, minWidth: 200, padding: '0.5rem 0.75rem', borderRadius: 8, border: '1px solid #99f6e4' }}
            placeholder="Split bill UUID"
            value={lookupId}
            onChange={(e) => setLookupId(e.target.value)}
          />
          <button type="submit" className="btn btn-outline" disabled={busy}>
            Load
          </button>
        </form>
      </div>

      {/* Bills list */}
      {loading ? (
        <div className="loading-center">
          <div className="spinner" />
        </div>
      ) : bills.length === 0 ? (
        <div className="card empty-state">
          <p>No split bills loaded yet. Create one or open by ID.</p>
        </div>
      ) : (
        <div className="grid grid-2">
          {bills.map((b) => {
            const isOrganizer = user?.id === b.organizer_id;
            return (
              <div key={b.id} className="card">
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '0.5rem' }}>
                  <h3 style={{ fontSize: '1.05rem' }}>{b.title}</h3>
                  <span
                    className={`badge badge-${
                      b.status === 'settled' ? 'success' : b.status === 'cancelled' ? 'failed' : 'pending'
                    }`}
                  >
                    {b.status}
                  </span>
                </div>
                <div style={{ fontWeight: 700, color: 'var(--primary)', marginBottom: '0.5rem' }}>
                  {formatGhs(b.total_amount)}
                </div>
                <div style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', marginBottom: '0.75rem' }}>
                  {isOrganizer ? 'You organized' : 'Participant'} · {new Date(b.created_at).toLocaleDateString()}
                </div>
                {b.shares && b.shares.length > 0 && (
                  <ul style={{ listStyle: 'none', fontSize: '0.85rem', marginBottom: '0.75rem' }}>
                    {b.shares.map((s) => (
                      <li
                        key={s.id}
                        style={{ display: 'flex', justifyContent: 'space-between', padding: '0.25rem 0' }}
                      >
                        <span>{formatGhs(s.gross_amount)}</span>
                        <span style={{ display: 'flex', gap: '0.35rem', alignItems: 'center' }}>
                          <span className={`badge badge-${s.status === 'paid' ? 'success' : 'pending'}`}>
                            {s.status}
                          </span>
                          {isOrganizer && s.status === 'paid' && s.payout_status && s.payout_status !== 'completed' && (
                            <span className={`badge badge-${s.payout_status === 'failed' ? 'failed' : 'pending'}`}>
                              payout {s.payout_status.replaceAll('_', ' ')}
                            </span>
                          )}
                          {isOrganizer && s.payout_status === 'failed' && (
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
                  {!isOrganizer && b.status === 'open' && (
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
                  {isOrganizer && b.status === 'open' && (
                    <button className="btn btn-sm btn-danger" disabled={busy} onClick={() => handleCancel(b)}>
                      Cancel split
                    </button>
                  )}
                </div>
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

      {showCreate && (
        <div className="modal-overlay" onClick={() => setShowCreate(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h2>Create split bill</h2>
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
