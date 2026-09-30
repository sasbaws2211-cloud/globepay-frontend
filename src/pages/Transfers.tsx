import React, { useEffect, useState, useCallback } from 'react';
import { getTransfers, sendMoney, getPendingClaims, claimTransfer, refreshTransfer, quoteTransfer } from '../api/services';
import type { Transfer, TransferQuote } from '../api/types';
import { generateIdempotencyKey, getErrorMessage } from '../api/client';
import { openPaystackCheckout } from '../api/paystack';
import { useAuth } from '../context/AuthContext';
import { MOMO_NETWORKS } from '../utils/momo';

// States that change on Paystack's side (payment confirmed, payout delivered)
// rather than from anything the user does in this page.
const IN_FLIGHT = new Set(['pending_payment', 'payout_pending']);
const POLL_EVERY_MS = 4000;
// Poll for a few minutes after the page opens or a payment is made, then stop;
// the backend's own reconcile sweep keeps checking after that.
const POLL_WINDOW_MS = 3 * 60 * 1000;
// Don't keep asking about checkouts nobody paid (the seed data has some).
const STALE_UNPAID_MS = 24 * 60 * 60 * 1000;
// A payout that hasn't settled within an hour is stuck on Paystack's side
// (e.g. held for OTP) - the backend sweep keeps checking it, but it shouldn't
// keep this page's "Updating…" indicator on.
const STALE_PAYOUT_MS = 60 * 60 * 1000;

function isPollable(t: Transfer) {
  if (!IN_FLIGHT.has(t.status)) return false;
  const age = Date.now() - new Date(t.created_at).getTime();
  return age < (t.status === 'pending_payment' ? STALE_UNPAID_MS : STALE_PAYOUT_MS);
}

// What to tell the sender once a transfer they just paid moves on.
function settledMessage(t: Transfer): { ok: boolean; text: string } | null {
  const who = t.counterparty_name ? ` to ${t.counterparty_name}` : '';
  switch (t.status) {
    case 'payout_pending':
      return { ok: true, text: `Payment confirmed - sending GHS ${t.net_amount}${who}…` };
    case 'awaiting_recipient_payout_info':
      return { ok: true, text: `Payment confirmed. ${t.counterparty_name || 'The recipient'} needs to add payout details to receive it.` };
    case 'completed':
      return { ok: true, text: `Transfer complete - GHS ${t.net_amount} delivered${who}.` };
    case 'failed':
      return { ok: false, text: "The payment didn't go through - you haven't been charged." };
    default:
      return null;
  }
}

function formatGhs(value: string | number) {
  const n = typeof value === 'string' ? parseFloat(value) : value;
  return `GHS ${(Number.isFinite(n) ? n : 0).toLocaleString('en-GH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function statusLabel(status: string) {
  return status.replaceAll('_', ' ');
}

const EMPTY_FORM = { recipient_phone_number: '', amount: '', note: '', sender_email: '' };

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
  const [form, setForm] = useState({ ...EMPTY_FORM, sender_email: user?.email || '' });
  // Two-step send: fill the form, then review exactly what will be charged.
  const [quote, setQuote] = useState<TransferQuote | null>(null);
  const [modalError, setModalError] = useState('');
  const [claimForm, setClaimForm] = useState({
    transferId: '',
    momo_number: '',
    momo_bank_code: 'MTN',
    account_name: '',
  });
  const [showClaim, setShowClaim] = useState(false);
  const [pollUntil, setPollUntil] = useState(() => Date.now() + POLL_WINDOW_MS);
  const [polling, setPolling] = useState(false);
  // The transfer the sender just paid, so the banner can follow it to completion.
  const [watchedId, setWatchedId] = useState<string | null>(null);

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
    let id = 0;
    const tick = async () => {
      if (Date.now() >= pollUntil) {
        // Window over: stop for real (this used to return early and leave
        // "Updating…" showing forever).
        window.clearInterval(id);
        setPolling(false);
        return;
      }
      if (document.hidden) return;
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
    };
    id = window.setInterval(tick, POLL_EVERY_MS);
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, [transfers, hasPollable, pollUntil]);

  // Keep the banner in step with the transfer the sender just paid.
  const watched = watchedId ? transfers.find((t) => t.id === watchedId) : undefined;
  const watchedStatus = watched?.status;
  useEffect(() => {
    if (!watched) return;
    const msg = settledMessage(watched);
    if (!msg) return;
    if (msg.ok) {
      setError('');
      setSuccess(msg.text);
    } else {
      setSuccess('');
      setError(msg.text);
    }
    // Stop following once it's final.
    if (['completed', 'failed', 'awaiting_recipient_payout_info'].includes(watched.status)) setWatchedId(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [watchedId, watchedStatus]);

  useEffect(() => {
    if (user?.email && !form.sender_email) {
      setForm((current) => ({ ...current, sender_email: user.email || '' }));
    }
  }, [user?.email, form.sender_email]);

  const openSend = () => {
    setSendIdempotencyKey(generateIdempotencyKey());
    setQuote(null);
    setModalError('');
    setShowSend(true);
  };

  const closeSend = () => {
    setShowSend(false);
    setQuote(null);
    setModalError('');
  };

  // Opens Paystack for a transfer (new or resumed), then lets polling confirm it.
  const payInApp = async (authorizationUrl: string, transferId?: string | null, reference?: string) => {
    const result = await openPaystackCheckout(authorizationUrl);
    if (result === 'success') {
      setSuccess('Payment received - confirming with Paystack…');
      if (transferId) setWatchedId(transferId);
      if (transferId) {
        // Don't wait for the next poll tick for the first check.
        refreshTransfer(transferId)
          .then((t) => setTransfers((current) => current.map((c) => (c.id === t.id ? t : c))))
          .catch(() => {});
      }
    } else {
      setSuccess(
        `Checkout closed before paying. The transfer stays pending - use Pay to finish it.${reference ? ` Ref: ${reference}` : ''}`
      );
    }
    armPolling();
  };

  // Step 1: review. Nothing is created or charged yet.
  const handleReview = async (e: React.FormEvent) => {
    e.preventDefault();
    setSending(true);
    setModalError('');
    try {
      setQuote(await quoteTransfer({ recipient_phone_number: form.recipient_phone_number.trim(), amount: form.amount }));
      // One key per reviewed quote: a double-tapped Pay replays safely, but
      // going Back and changing the amount doesn't collide with the old key.
      setSendIdempotencyKey(generateIdempotencyKey());
    } catch (err) {
      setModalError(getErrorMessage(err));
    } finally {
      setSending(false);
    }
  };

  // Step 2: create the transfer and pay.
  const handleSend = async () => {
    setSending(true);
    setModalError('');
    setError('');
    setSuccess('');
    try {
      const res = await sendMoney({
        recipient_phone_number: form.recipient_phone_number.trim(),
        amount: form.amount,
        note: form.note || undefined,
        sender_email: form.sender_email.trim(),
      }, sendIdempotencyKey || generateIdempotencyKey());
      closeSend();
      setSendIdempotencyKey('');
      setForm({ ...EMPTY_FORM, sender_email: user?.email || '' });
      load();
      await payInApp(res.authorization_url, res.transfer_id, res.reference);
    } catch (err) {
      // Still in the modal: show the reason there, not behind the overlay.
      setModalError(getErrorMessage(err));
    } finally {
      setSending(false);
    }
  };

  const handleResume = async (t: Transfer) => {
    if (!t.pay_url) return;
    setError('');
    setSuccess('');
    try {
      await payInApp(t.pay_url, t.id);
    } catch (err) {
      setError(getErrorMessage(err));
    }
  };

  const handleClaim = async (e: React.FormEvent) => {
    e.preventDefault();
    setSending(true);
    setModalError('');
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
      setModalError(getErrorMessage(err));
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
          <button className="btn btn-primary" onClick={openSend}>Send money</button>
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
              {/* net_amount is what actually reaches the recipient, after the fee. */}
              <span>
                {formatGhs(t.net_amount)}
                {t.counterparty_name && <> from {t.counterparty_name}</>} · {new Date(t.created_at).toLocaleDateString()}
              </span>
              <button
                className="btn btn-sm btn-primary"
                onClick={() => {
                  setClaimForm((f) => ({ ...f, transferId: t.id }));
                  setModalError('');
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
                  <th>With</th>
                  <th>Amount</th>
                  <th>Fee</th>
                  <th>Note</th>
                  <th>Status</th>
                  <th>Date</th>
                </tr>
              </thead>
              <tbody>
                {transfers.map((t) => {
                  const sent = t.direction === 'sent';
                  const roundup = parseFloat(t.roundup_amount || '0');
                  // No money moved for a failed or never-paid transfer, so don't
                  // show it as a credit/debit.
                  const moved = !['failed', 'pending_payment'].includes(t.status);
                  const shown = formatGhs(sent ? t.gross_amount : t.net_amount);
                  return (
                    <tr key={t.id}>
                      <td>
                        <div style={{ fontSize: '0.75rem', color: sent ? '#b45309' : '#047857', fontWeight: 600 }}>
                          {sent ? 'Sent to' : 'Received from'}
                        </div>
                        <div>{t.counterparty_name || '—'}</div>
                        {t.counterparty_phone && <div className="text-muted" style={{ fontSize: '0.75rem' }}>{t.counterparty_phone}</div>}
                      </td>
                      <td>
                        {/* Sender sees what they sent; recipient sees what they got. */}
                        {moved ? `${sent ? '−' : '+'}${shown}` : <span className="text-muted">{shown}</span>}
                        {sent && moved && roundup > 0 && (
                          <div className="text-muted" style={{ fontSize: '0.75rem' }}>+ {formatGhs(roundup)} round-up saved</div>
                        )}
                      </td>
                      <td>{formatGhs(t.platform_fee)}</td>
                      <td>{t.note || '—'}</td>
                      <td>
                        <span className={`badge badge-${t.status === 'completed' ? 'success' : t.status === 'failed' ? 'failed' : 'pending'}`}>
                          {statusLabel(t.status)}
                        </span>
                        {t.pay_url && (
                          <div style={{ marginTop: '0.35rem' }}>
                            <button className="btn btn-sm btn-primary" onClick={() => handleResume(t)}>Pay</button>
                          </div>
                        )}
                      </td>
                      <td>{new Date(t.created_at).toLocaleString()}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {showSend && (
        <div className="modal-overlay" onClick={closeSend}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h2>{quote ? 'Review transfer' : 'Send money'}</h2>
            {modalError && <div className="alert alert-error">{modalError}</div>}
            {!quote ? (
              <form onSubmit={handleReview}>
                <div className="form-group">
                  <label htmlFor="send-phone">Recipient phone</label>
                  <input
                    id="send-phone"
                    inputMode="tel"
                    required
                    value={form.recipient_phone_number}
                    onChange={(e) => setForm({ ...form, recipient_phone_number: e.target.value })}
                    placeholder="0244123456"
                  />
                </div>
                <div className="form-group">
                  <label htmlFor="send-amount">Amount (GHS)</label>
                  <input
                    id="send-amount"
                    required
                    type="number"
                    step="0.01"
                    min="1"
                    value={form.amount}
                    onChange={(e) => setForm({ ...form, amount: e.target.value })}
                  />
                </div>
                <div className="form-group">
                  <label htmlFor="send-note">Note (optional)</label>
                  <input id="send-note" value={form.note} onChange={(e) => setForm({ ...form, note: e.target.value })} />
                </div>
                <div className="form-group">
                  <label htmlFor="send-email">Your email (for Paystack)</label>
                  <input
                    id="send-email"
                    required
                    type="email"
                    value={form.sender_email}
                    onChange={(e) => setForm({ ...form, sender_email: e.target.value })}
                  />
                </div>
                <div className="modal-actions">
                  <button type="button" className="btn btn-outline" onClick={closeSend}>Cancel</button>
                  <button type="submit" className="btn btn-primary" disabled={sending}>
                    {sending ? 'Checking…' : 'Review'}
                  </button>
                </div>
              </form>
            ) : (
              <div>
                <table style={{ width: '100%', marginBottom: '1rem' }}>
                  <tbody>
                    <tr><td className="text-muted">To</td><td style={{ textAlign: 'right' }}><strong>{quote.recipient_name}</strong><div className="text-muted" style={{ fontSize: '0.8rem' }}>{quote.recipient_phone}</div></td></tr>
                    <tr><td className="text-muted">You send</td><td style={{ textAlign: 'right' }}>{formatGhs(quote.amount)}</td></tr>
                    <tr><td className="text-muted">Fee (from their amount)</td><td style={{ textAlign: 'right' }}>−{formatGhs(quote.platform_fee)}</td></tr>
                    <tr><td className="text-muted">They receive</td><td style={{ textAlign: 'right' }}><strong>{formatGhs(quote.recipient_gets)}</strong></td></tr>
                    {parseFloat(quote.roundup_amount) > 0 && (
                      <tr><td className="text-muted">Round-up to your savings</td><td style={{ textAlign: 'right' }}>+{formatGhs(quote.roundup_amount)}</td></tr>
                    )}
                    <tr><td><strong>You pay</strong></td><td style={{ textAlign: 'right' }}><strong>{formatGhs(quote.total_charge)}</strong></td></tr>
                  </tbody>
                </table>
                <div className="modal-actions">
                  <button type="button" className="btn btn-outline" onClick={() => { setQuote(null); setModalError(''); }} disabled={sending}>Back</button>
                  <button type="button" className="btn btn-primary" onClick={handleSend} disabled={sending}>
                    {sending ? 'Processing…' : `Pay ${formatGhs(quote.total_charge)}`}
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {showClaim && (
        <div className="modal-overlay" onClick={() => setShowClaim(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h2>Claim transfer</h2>
            {modalError && <div className="alert alert-error">{modalError}</div>}
            <form onSubmit={handleClaim}>
              <div className="form-group">
                <label htmlFor="claim-number">Mobile money number</label>
                <input id="claim-number" required inputMode="tel" value={claimForm.momo_number} onChange={(e) => setClaimForm({ ...claimForm, momo_number: e.target.value })} />
              </div>
              <div className="form-group">
                <label htmlFor="claim-network">Network</label>
                <select id="claim-network" value={claimForm.momo_bank_code} onChange={(e) => setClaimForm({ ...claimForm, momo_bank_code: e.target.value })}>
                  {MOMO_NETWORKS.map((n) => <option key={n.code} value={n.code}>{n.label}</option>)}
                </select>
              </div>
              <div className="form-group">
                <label htmlFor="claim-name">Account name</label>
                <input id="claim-name" required value={claimForm.account_name} onChange={(e) => setClaimForm({ ...claimForm, account_name: e.target.value })} />
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
