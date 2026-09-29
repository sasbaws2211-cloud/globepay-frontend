import React, { useEffect, useState, useCallback } from 'react';
import { getTransfers, sendMoney, getPendingClaims, claimTransfer, refreshTransfer } from '../api/services';
import type { Transfer } from '../api/types';
import { generateIdempotencyKey, getErrorMessage } from '../api/client';
import { openPaystackCheckout } from '../api/paystack';
import { useAuth } from '../context/AuthContext';

// States that change on Paystack's side (payment confirmed, payout delivered)
// rather than from anything the user does in this page.
const IN_FLIGHT = new Set(['pending_payment', 'payout_pending']);
const POLL_EVERY_MS = 4000;
// Poll for a few minutes after the page opens or a payment is made, then stop;
// the backend's own reconcile sweep keeps checking after that.
const POLL_WINDOW_MS = 3 * 60 * 1000;
// Don't keep asking about checkouts nobody paid (the seed data has some).
const STALE_UNPAID_MS = 24 * 60 * 60 * 1000;

function isPollable(t: Transfer) {
  if (!IN_FLIGHT.has(t.status)) return false;
  return t.status !== 'pending_payment' || Date.now() - new Date(t.created_at).getTime() < STALE_UNPAID_MS;
}

function formatGhs(value: string | number) {
  const n = typeof value === 'string' ? parseFloat(value) : value;
  return `GHS ${(Number.isFinite(n) ? n : 0).toLocaleString('en-GH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function statusLabel(status: string) {
  return status.replaceAll('_', ' ');
}

export default function Transfers() {
  const { user } = useAuth();
  const [transfers, setTransfers] = useState<Transfer[]>([]);
  const [pending, setPending] = useState<Transfer[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [showSend, setShowSend] = useState(false);
  const [sending, setSending] = useState(false);
  const [sendIdempotencyKey, setSendIdempotencyKey] = useState('');
  const [form, setForm] = useState({
    recipient_phone_number: '',
    amount: '',
    note: '',
    sender_email: user?.email || '',
  });
  const [claimForm, setClaimForm] = useState({
    transferId: '',
    momo_number: '',
    momo_bank_code: 'MTN',
    account_name: '',
  });
  const [showClaim, setShowClaim] = useState(false);
  const [pollUntil, setPollUntil] = useState(() => Date.now() + POLL_WINDOW_MS);
  const [polling, setPolling] = useState(false);

  const armPolling = () => setPollUntil(Date.now() + POLL_WINDOW_MS);

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const [t, p] = await Promise.all([getTransfers(), getPendingClaims().catch(() => [])]);
      setTransfers(t);
      setPending(p);
    } catch (err) {
      setError(getErrorMessage(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const hasPollable = transfers.some(isPollable);
  useEffect(() => {
    if (!hasPollable || Date.now() >= pollUntil) {
      setPolling(false);
      return;
    }
    setPolling(true);
    let cancelled = false;
    const tick = async () => {
      if (document.hidden || Date.now() >= pollUntil) return;
      const targets = transfers.filter(isPollable);
      const results = await Promise.allSettled(targets.map((t) => refreshTransfer(t.id)));
      if (cancelled) return;
      const updated = new Map<string, Transfer>();
      results.forEach((r) => r.status === 'fulfilled' && updated.set(r.value.id, r.value));
      const changed = targets.some((t) => updated.get(t.id) && updated.get(t.id)!.status !== t.status);
      if (changed) {
        setTransfers((current) => current.map((t) => updated.get(t.id) || t));
        getPendingClaims().then((p) => !cancelled && setPending(p)).catch(() => {});
      }
      if (Date.now() >= pollUntil) setPolling(false);
    };
    const id = window.setInterval(tick, POLL_EVERY_MS);
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, [transfers, hasPollable, pollUntil]);

  useEffect(() => {
    if (user?.email && !form.sender_email) {
      setForm((current) => ({ ...current, sender_email: user.email || '' }));
    }
  }, [user?.email, form.sender_email]);

  const handleSend = async (e: React.FormEvent) => {
    e.preventDefault();
    setSending(true);
    setError('');
    setSuccess('');
    try {
      const res = await sendMoney({
        recipient_phone_number: form.recipient_phone_number.trim(),
        amount: form.amount,
        note: form.note || undefined,
        sender_email: form.sender_email.trim(),
      }, sendIdempotencyKey || generateIdempotencyKey());
      setShowSend(false);
      setSendIdempotencyKey('');
      setForm({ recipient_phone_number: '', amount: '', note: '', sender_email: user?.email || '' });
      load();
      const result = await openPaystackCheckout(res.authorization_url);
      if (result === 'success') {
        setSuccess('Payment received - confirming with Paystack…');
        if (res.transfer_id) {
          // Don't wait for the next poll tick for the first check.
          refreshTransfer(res.transfer_id)
            .then((t) => setTransfers((current) => current.map((c) => (c.id === t.id ? t : c))))
            .catch(() => {});
        }
      } else {
        setSuccess(`Checkout closed before paying. The transfer stays pending payment. Ref: ${res.reference}`);
      }
      armPolling();
    } catch (err) {
      setError(getErrorMessage(err));
    } finally {
      setSending(false);
    }
  };

  const handleClaim = async (e: React.FormEvent) => {
    e.preventDefault();
    setSending(true);
    setError('');
    try {
      await claimTransfer(claimForm.transferId, {
        momo_number: claimForm.momo_number,
        momo_bank_code: claimForm.momo_bank_code,
        account_name: claimForm.account_name,
        save_as_default: true,
      });
      setSuccess('Payout requested - tracking delivery…');
      setShowClaim(false);
      armPolling();
      load();
    } catch (err) {
      setError(getErrorMessage(err));
    } finally {
      setSending(false);
    }
  };

  return (
    <div>
      <div className="page-header">
        <h1>Transfers</h1>
        <div className="btn-group">
          {polling && <span className="text-muted" style={{ alignSelf: 'center', fontSize: '0.85rem' }}>Updating…</span>}
          <button className="btn btn-outline" onClick={() => { armPolling(); load(); }}>Refresh</button>
          <button className="btn btn-primary" onClick={() => { setSendIdempotencyKey(generateIdempotencyKey()); setShowSend(true); }}>Send money</button>
        </div>
      </div>

      {error && <div className="alert alert-error">{error}</div>}
      {success && <div className="alert alert-success">{success}</div>}

      {pending.length > 0 && (
        <div className="card" style={{ marginBottom: '1rem', borderColor: '#fbbf24' }}>
          <h2 style={{ fontSize: '1.05rem', marginBottom: '0.35rem' }}>Transfers waiting for payout details</h2>
          <p className="text-muted" style={{ marginBottom: '0.75rem' }}>Add a mobile money destination to release the funds.</p>
          {pending.map((t) => (
            <div key={t.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '0.5rem 0' }}>
              <span>{formatGhs(t.gross_amount)} · {new Date(t.created_at).toLocaleDateString()}</span>
              <button
                className="btn btn-sm btn-primary"
                onClick={() => {
                  setClaimForm((f) => ({ ...f, transferId: t.id }));
                  setShowClaim(true);
                }}
              >
                Claim
              </button>
            </div>
          ))}
        </div>
      )}

      <div className="card">
        {loading ? (
          <div className="loading-center"><div className="spinner" /></div>
        ) : transfers.length === 0 ? (
          <div className="empty-state">
            <p>No transfers yet.</p>
          </div>
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Amount</th>
                  <th>Net</th>
                  <th>Fee</th>
                  <th>Note</th>
                  <th>Status</th>
                  <th>Date</th>
                </tr>
              </thead>
              <tbody>
                {transfers.map((t) => (
                  <tr key={t.id}>
                    <td>{formatGhs(t.gross_amount)}</td>
                    <td>{formatGhs(t.net_amount)}</td>
                    <td>{formatGhs(t.platform_fee)}</td>
                    <td>{t.note || '—'}</td>
                    <td>
                      <span className={`badge badge-${t.status === 'completed' ? 'success' : t.status === 'failed' ? 'failed' : 'pending'}`}>
                        {statusLabel(t.status)}
                      </span>
                    </td>
                    <td>{new Date(t.created_at).toLocaleString()}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {showSend && (
        <div className="modal-overlay" onClick={() => setShowSend(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h2>Send money</h2>
            <form onSubmit={handleSend}>
              <div className="form-group">
                <label>Recipient phone</label>
                <input
                  required
                  value={form.recipient_phone_number}
                  onChange={(e) => setForm({ ...form, recipient_phone_number: e.target.value })}
                  placeholder="0244123456"
                />
              </div>
              <div className="form-group">
                <label>Amount (GHS)</label>
                <input
                  required
                  type="number"
                  step="0.01"
                  min="1"
                  value={form.amount}
                  onChange={(e) => setForm({ ...form, amount: e.target.value })}
                />
              </div>
              <div className="form-group">
                <label>Note (optional)</label>
                <input value={form.note} onChange={(e) => setForm({ ...form, note: e.target.value })} />
              </div>
              <div className="form-group">
                <label>Your email (for Paystack)</label>
                <input
                  required
                  type="email"
                  value={form.sender_email}
                  onChange={(e) => setForm({ ...form, sender_email: e.target.value })}
                />
              </div>
              <div className="modal-actions">
                <button type="button" className="btn btn-outline" onClick={() => setShowSend(false)}>Cancel</button>
                <button type="submit" className="btn btn-primary" disabled={sending}>
                  {sending ? 'Processing…' : 'Continue to pay'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {showClaim && (
        <div className="modal-overlay" onClick={() => setShowClaim(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h2>Claim transfer</h2>
            <form onSubmit={handleClaim}>
              <div className="form-group">
                <label>Mobile money number</label>
                <input required value={claimForm.momo_number} onChange={(e) => setClaimForm({ ...claimForm, momo_number: e.target.value })} />
              </div>
              <div className="form-group">
                <label>Network</label>
                <select value={claimForm.momo_bank_code} onChange={(e) => setClaimForm({ ...claimForm, momo_bank_code: e.target.value })}>
                  <option value="MTN">MTN</option>
                  <option value="ATL">AirtelTigo</option>
                  <option value="VOD">Vodafone</option>
                </select>
              </div>
              <div className="form-group">
                <label>Account name</label>
                <input required value={claimForm.account_name} onChange={(e) => setClaimForm({ ...claimForm, account_name: e.target.value })} />
              </div>
              <div className="modal-actions">
                <button type="button" className="btn btn-outline" onClick={() => setShowClaim(false)}>Cancel</button>
                <button type="submit" className="btn btn-primary" disabled={sending}>Claim</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
