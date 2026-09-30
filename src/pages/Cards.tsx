import React, { useEffect, useState, useCallback } from 'react';
import {
  getCards,
  getCardLimits,
  createCard,
  freezeCard,
  unfreezeCard,
  terminateCard,
  retryCardCreation,
  refundCardCreation,
  getCardTransactions,
  revealCardDetails,
  retryTerminationPayout,
  type CardDetails,
  type CardLimits,
  type CardTransaction,
} from '../api/services';
import type { Card } from '../api/types';
import { getErrorMessage } from '../api/client';
import { openPaystackCheckout } from '../api/paystack';
import { describeSettledPayment, usePaymentTracker } from '../hooks/usePaymentTracker';
import { useAuth } from '../context/AuthContext';
import CardQuoteLine from '../components/CardQuoteLine';
import { cardName, visibleCards } from '../utils/cards';

// Plain-language label for a history line (the backend's `kind` is technical).
function kindLabel(t: CardTransaction): string {
  if (t.kind === 'initial_funding') return 'Card load (GHS payment)';
  if (t.kind === 'decline') return 'Declined';
  if (t.kind === 'debit') return 'Purchase';
  if (t.kind === 'refund') return 'Refund';
  if (t.kind === 'credit') return t.description.toLowerCase().includes('fund') ? 'Card funded' : 'Money in';
  if (t.description.toLowerCase().includes('fee')) return 'Fee';
  return t.kind.charAt(0).toUpperCase() + t.kind.slice(1).replaceAll('_', ' ');
}

export default function Cards() {
  const { user } = useAuth();
  const [cards, setCards] = useState<Card[]>([]);
  const [hiddenCount, setHiddenCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [showCreate, setShowCreate] = useState(false);
  const [busy, setBusy] = useState(false);

  const [createForm, setCreateForm] = useState({
    initial_funding_ghs: '50',
    sender_email: user?.email || '',
    dial_code: '+233',
    local_phone_number: user?.phone_number?.replace(/^\+?233/, '') || '',
  });
  const [terminateCardId, setTerminateCardId] = useState<string | null>(null);
  const [terminateReason, setTerminateReason] = useState('');
  const [txCardId, setTxCardId] = useState<string | null>(null);
  const [txByCard, setTxByCard] = useState<Record<string, CardTransaction[]>>({});
  const [txLoading, setTxLoading] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const all = await getCards();
      // Abandoned checkouts (unpaid for over a day) are just clutter - hide them.
      const list = visibleCards(all);
      setHiddenCount(all.length - list.length);
      setCards(list);
    } catch (err) {
      setError(getErrorMessage(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  // Lite-card rules come from the backend so the form can't drift from what
  // Bitnob will actually accept.
  const [limits, setLimits] = useState<CardLimits | null>(null);
  useEffect(() => {
    getCardLimits().then(setLimits).catch(() => {});
  }, []);

  // Opens the history in its own panel (it used to be squeezed into the card
  // tile with a side-scroll). Always refetches: purchases and declines can
  // arrive by Bitnob webhook at any time.
  const [txError, setTxError] = useState('');
  const openTransactions = async (cardId: string) => {
    setTxCardId(cardId);
    setTxLoading(cardId);
    setTxError('');
    try {
      const list = await getCardTransactions(cardId);
      setTxByCard((prev) => ({ ...prev, [cardId]: list }));
    } catch (err) {
      setTxError(getErrorMessage(err));
    } finally {
      setTxLoading(null);
    }
  };

  // Full card details (for subscriptions etc.). Password first, then shown for
  // DETAILS_SECONDS and wiped - also wiped on close or when the tab is hidden.
  // Only ever held in this state: never stored, logged or put in a URL.
  const DETAILS_SECONDS = 60;
  const [detailsCardId, setDetailsCardId] = useState<string | null>(null);
  const [detailsPassword, setDetailsPassword] = useState('');
  const [details, setDetails] = useState<CardDetails | null>(null);
  const [detailsError, setDetailsError] = useState('');
  const [detailsBusy, setDetailsBusy] = useState(false);
  const [secondsLeft, setSecondsLeft] = useState(0);
  const [copied, setCopied] = useState('');

  const closeDetails = useCallback(() => {
    setDetailsCardId(null);
    setDetails(null);
    setDetailsPassword('');
    setDetailsError('');
    setCopied('');
  }, []);

  const handleReveal = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!detailsCardId) return;
    setDetailsBusy(true);
    setDetailsError('');
    try {
      const d = await revealCardDetails(detailsCardId, detailsPassword);
      setDetails(d);
      setSecondsLeft(DETAILS_SECONDS);
    } catch (err) {
      setDetailsError(getErrorMessage(err));
    } finally {
      setDetailsPassword('');
      setDetailsBusy(false);
    }
  };

  useEffect(() => {
    if (!details) return;
    if (secondsLeft <= 0) {
      closeDetails();
      return;
    }
    const t = setTimeout(() => setSecondsLeft((s) => s - 1), 1000);
    return () => clearTimeout(t);
  }, [details, secondsLeft, closeDetails]);

  useEffect(() => {
    if (!details) return;
    const onHide = () => { if (document.hidden) closeDetails(); };
    document.addEventListener('visibilitychange', onHide);
    return () => document.removeEventListener('visibilitychange', onHide);
  }, [details, closeDetails]);

  const copy = async (label: string, value: string) => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(label);
    } catch {
      setCopied(`!${label}`); // clipboard blocked - say so rather than silently doing nothing
    }
  };

  const { track, tracking } = usePaymentTracker((result) => {
    const { ok, message } = describeSettledPayment(result);
    if (ok) {
      setError('');
      setSuccess(`${message} Your card is being set up.`);
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
      const res = await createCard(createForm);
      setShowCreate(false);
      const result = await openPaystackCheckout(res.authorization_url);
      setSuccess(
        result === 'success'
          ? 'Payment received - confirming with Paystack…'
          : `Checkout closed before paying. Ref: ${res.reference}`
      );
      track(res.reference);
      load();
    } catch (err) {
      // Close the modal so the reason (e.g. card limit reached) isn't hidden behind it.
      setShowCreate(false);
      setSuccess('');
      setError(getErrorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  const handleFreeze = async (card: Card) => {
    setBusy(true);
    try {
      if (card.status === 'frozen' || card.status === 'inactive') {
        await unfreezeCard(card.id);
        setSuccess('Card unfrozen');
      } else {
        await freezeCard(card.id);
        // Payments tried while frozen still count toward Bitnob's 3-strike rule.
        setSuccess('Card frozen. Note: payments tried while it is frozen (e.g. a subscription renewal) count as declined payments - 3 of those close the card. Cancel subscriptions on it first if you are keeping it frozen.');
      }
      load();
    } catch (err) {
      setError(getErrorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  // Terminate errors (e.g. Bitnob's 24-hour rule) show inside its modal, not behind it.
  const [terminateError, setTerminateError] = useState('');

  const handleTerminate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!terminateCardId) return;
    setBusy(true);
    setError('');
    setTerminateError('');
    try {
      const closed = await terminateCard(terminateCardId, terminateReason.trim() || 'User requested');
      const ghs = closed.termination_payout_ghs;
      setSuccess(
        closed.termination_payout_status === 'pending'
          ? `Card terminated. GHS ${ghs} left on it is on its way to your mobile money.`
          : closed.termination_payout_status === 'failed'
            ? `Card terminated, but we couldn't send the GHS ${ghs} left on it yet - check your payout number in Settings, then tap Retry payout on the card.`
            : 'Card terminated'
      );
      setTerminateCardId(null);
      setTerminateReason('');
      load();
    } catch (err) {
      setTerminateError(getErrorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div>
      <div className="page-header">
        <h1>Virtual Cards</h1>
        <div className="btn-group">
          {tracking && <span className="text-muted" style={{ alignSelf: 'center', fontSize: '0.85rem' }}>Updating…</span>}
          <button className="btn btn-outline" onClick={load}>Refresh</button>
          <button className="btn btn-primary" onClick={() => setShowCreate(true)}>Create card</button>
        </div>
      </div>

      {error && <div className="alert alert-error">{error}</div>}
      {success && <div className="alert alert-success">{success}</div>}
      <div className="alert alert-info">
        Virtual cards are a sandbox demo feature. Requires Bitnob + Paystack sandbox credentials.
      </div>

      {hiddenCount > 0 && (
        <p className="text-muted" style={{ fontSize: '0.8rem', margin: '0 0 0.75rem' }}>
          {hiddenCount} unpaid card checkout{hiddenCount === 1 ? '' : 's'} older than a day {hiddenCount === 1 ? 'is' : 'are'} hidden.
        </p>
      )}

      {loading ? (
        <div className="loading-center"><div className="spinner" /></div>
      ) : cards.length === 0 ? (
        <div className="card empty-state">
          <p>No virtual cards yet.</p>
        </div>
      ) : (
        <div className="grid grid-2">
          {cards.map((c) => (
            <div
              key={c.id}
              className="card"
              style={{
                background: 'linear-gradient(135deg, #0f766e 0%, #134e4a 100%)',
                color: 'white',
                border: 'none',
              }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '0.75rem' }}>
                <span style={{ opacity: 0.9 }}>{cardName(c)}</span>
                <span className="badge" style={{ background: 'rgba(255,255,255,0.2)', color: 'white' }}>
                  {c.status.replaceAll('_', ' ')}
                </span>
              </div>
              <div style={{ fontFamily: 'monospace', fontSize: '1.2rem', letterSpacing: 3, marginBottom: '1rem' }}>
                {c.masked_pan || '•••• •••• •••• ••••'}
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '1rem' }}>
                <div>
                  <div style={{ fontSize: '0.75rem', opacity: 0.8 }}>Balance</div>
                  <div style={{ fontWeight: 700 }}>{c.currency} {parseFloat(c.balance).toFixed(2)}</div>
                </div>
              </div>
              {c.status === 'terminated' && c.termination_payout_ghs && (
                // What happened to the balance that was left when the card was closed.
                <div style={{ fontSize: '0.8rem', marginBottom: '0.75rem', opacity: 0.95 }}>
                  {c.termination_payout_status === 'completed' && <>GHS {c.termination_payout_ghs} left on this card was sent to your mobile money.</>}
                  {c.termination_payout_status === 'pending' && <>Sending the GHS {c.termination_payout_ghs} left on this card to your mobile money…</>}
                  {c.termination_payout_status === 'failed' && <>We couldn't send the GHS {c.termination_payout_ghs} left on this card. Check your payout number in Settings, then retry.</>}
                </div>
              )}
              {(c.decline_strikes || 0) > 0 && c.status !== 'terminated' && (
                <div style={{ fontSize: '0.8rem', marginBottom: '0.6rem', padding: '0.5rem 0.6rem', borderRadius: 8, background: 'rgba(220,38,38,0.35)' }}>
                  <strong>⚠ {c.decline_strikes} of 3 declined payments.</strong>{' '}
                  {c.decline_strikes! >= 2 ? 'One more and this card is closed for good. ' : 'After 3, this card is closed for good. '}
                  Cards can't be topped up - cancel subscriptions on it or move them to a new card.
                  {parseFloat(c.decline_fees_usd || '0') > 0 && (
                    <div style={{ marginTop: '0.25rem', opacity: 0.9 }}>
                      Declined-payment fees so far: USD {parseFloat(c.decline_fees_usd!).toFixed(2)} (taken from what's paid back if the card is closed).
                    </div>
                  )}
                </div>
              )}
              <div className="btn-group">
                {/* Statuses match backend CardStatus: only a card that exists on
                    Bitnob (active/frozen) can be frozen/terminated; a paid
                    card whose creation failed (delivery_failed) can only be
                    retried or refunded. */}
                {['active', 'frozen'].includes(c.status) && (
                  <button
                    className="btn btn-sm"
                    style={{ background: 'rgba(255,255,255,0.2)', color: 'white' }}
                    onClick={() => {
                      closeDetails();
                      setDetailsCardId(c.id);
                    }}
                  >
                    Card details
                  </button>
                )}
                {['active', 'frozen'].includes(c.status) && (
                  <button
                    className="btn btn-sm"
                    style={{ background: 'rgba(255,255,255,0.2)', color: 'white' }}
                    onClick={() => handleFreeze(c)}
                    disabled={busy}
                  >
                    {c.status === 'frozen' ? 'Unfreeze' : 'Freeze'}
                  </button>
                )}
                {['active', 'frozen'].includes(c.status) && (
                  <button
                    className="btn btn-sm"
                    style={{ background: 'rgba(220,38,38,0.35)', color: 'white' }}
                    onClick={() => {
                      setTerminateCardId(c.id);
                      setTerminateReason('');
                      setTerminateError('');
                    }}
                    disabled={busy}
                  >
                    Terminate
                  </button>
                )}
                {c.status === 'terminated' && c.termination_payout_status === 'failed' && (
                  <button
                    className="btn btn-sm"
                    style={{ background: 'rgba(255,255,255,0.25)', color: 'white' }}
                    disabled={busy}
                    onClick={async () => {
                      setBusy(true);
                      setError('');
                      try {
                        await retryTerminationPayout(c.id);
                        setSuccess('Payout started - it usually arrives within a minute.');
                        load();
                      } catch (err) {
                        setError(getErrorMessage(err));
                      } finally {
                        setBusy(false);
                      }
                    }}
                  >
                    Retry payout
                  </button>
                )}
                {c.status === 'delivery_failed' && (
                  <button
                    className="btn btn-sm"
                    style={{ background: 'rgba(255,255,255,0.25)', color: 'white' }}
                    disabled={busy}
                    onClick={async () => {
                      setBusy(true);
                      setError('');
                      try {
                        await retryCardCreation(c.id);
                        setSuccess('Card creation retry started');
                        load();
                      } catch (err) {
                        setError(getErrorMessage(err));
                      } finally {
                        setBusy(false);
                      }
                    }}
                  >
                    Retry
                  </button>
                )}
                {c.status === 'delivery_failed' && (
                  <button
                    className="btn btn-sm"
                    style={{ background: 'rgba(255,255,255,0.25)', color: 'white' }}
                    disabled={busy}
                    onClick={async () => {
                      if (!window.confirm('Refund this card creation payment?')) return;
                      setBusy(true);
                      setError('');
                      try {
                        await refundCardCreation(c.id);
                        setSuccess('Refund initiated');
                        load();
                      } catch (err) {
                        setError(getErrorMessage(err));
                      } finally {
                        setBusy(false);
                      }
                    }}
                  >
                    Refund
                  </button>
                )}
                <button
                  className="btn btn-sm"
                  style={{ background: 'rgba(255,255,255,0.2)', color: 'white' }}
                  onClick={() => openTransactions(c.id)}
                >
                  Transactions
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {detailsCardId && (() => {
        const card = cards.find((x) => x.id === detailsCardId);
        const addr = details?.billing_address;
        const expiry = details
          ? `${details.expiry_month.padStart(2, '0')}/${details.expiry_year.slice(-2)}`
          : '';
        const rows: [string, string][] = details
          ? [
              ['Card number', details.card_number.replace(/(\d{4})(?=\d)/g, '$1 ')],
              ['Expiry (MM/YY)', expiry],
              ['CVV', details.cvv],
              ['Name on card', details.name || ''],
              ...(addr
                ? ([
                    ['Billing address', [addr.line1, addr.line2].filter(Boolean).join(', ')],
                    ['City', addr.city || ''],
                    ['State / region', addr.state || ''],
                    ['Postcode / ZIP', addr.postal_code || ''],
                    ['Country', addr.country || ''],
                  ] as [string, string][])
                : []),
            ].filter(([, v]) => v) as [string, string][]
          : [];
        return (
          <div className="modal-overlay" onClick={closeDetails}>
            <div className="modal" style={{ maxWidth: 480, width: '100%' }} onClick={(e) => e.stopPropagation()}>
              <h2>Card details</h2>
              <p className="text-muted" style={{ fontSize: '0.85rem', marginTop: 0 }}>
                {card ? cardName(card) : ''} {card?.masked_pan ? `•••• ${card.masked_pan.slice(-4)}` : ''}
              </p>
              {!details ? (
                <form onSubmit={handleReveal}>
                  <p style={{ fontSize: '0.9rem' }}>
                    Enter your password to see the full card number, expiry and CVV - for example to pay for a
                    subscription online.
                  </p>
                  {detailsError && <div className="alert alert-error">{detailsError}</div>}
                  <div className="form-group">
                    <label htmlFor="card-details-password">Password</label>
                    <input
                      id="card-details-password"
                      type="password"
                      autoComplete="current-password"
                      required
                      autoFocus
                      value={detailsPassword}
                      onChange={(e) => setDetailsPassword(e.target.value)}
                    />
                  </div>
                  <div className="modal-actions">
                    <button type="button" className="btn btn-outline" onClick={closeDetails}>Cancel</button>
                    <button type="submit" className="btn btn-primary" disabled={detailsBusy || !detailsPassword}>
                      {detailsBusy ? 'Checking…' : 'Show details'}
                    </button>
                  </div>
                </form>
              ) : (
                <>
                  {card?.status === 'frozen' && (
                    <div className="alert alert-error" style={{ fontSize: '0.85rem' }}>
                      This card is frozen - unfreeze it first or payments will be declined.
                    </div>
                  )}
                  <div style={{ display: 'grid', gap: '0.6rem' }}>
                    {rows.map(([label, value]) => (
                      <div
                        key={label}
                        style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '0.75rem' }}
                      >
                        <div style={{ minWidth: 0 }}>
                          <div className="text-muted" style={{ fontSize: '0.75rem' }}>{label}</div>
                          <div style={{ fontFamily: 'monospace', fontSize: '1rem', overflowWrap: 'anywhere' }}>{value}</div>
                        </div>
                        <button
                          type="button"
                          className="btn btn-sm btn-outline"
                          style={{ flexShrink: 0 }}
                          onClick={() => copy(label, label === 'Card number' ? details.card_number : value)}
                        >
                          {copied === label ? 'Copied' : copied === `!${label}` ? 'Copy failed' : 'Copy'}
                        </button>
                      </div>
                    ))}
                  </div>
                  <p className="text-muted" style={{ fontSize: '0.8rem', marginTop: '1rem' }}>
                    Hidden in {secondsLeft}s. Don't share these with anyone - GlobePay will never ask for them.
                    Cards can't be topped up, so a subscription stops working once the card's balance runs out.
                  </p>
                  <div className="modal-actions">
                    <button type="button" className="btn btn-primary" onClick={closeDetails}>Hide</button>
                  </div>
                </>
              )}
            </div>
          </div>
        );
      })()}

      {txCardId && (() => {
        const card = cards.find((x) => x.id === txCardId);
        const rows = txByCard[txCardId] || [];
        return (
          <div className="modal-overlay" onClick={() => setTxCardId(null)}>
            <div className="modal" style={{ maxWidth: 760, width: '100%' }} onClick={(e) => e.stopPropagation()}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: '1rem', flexWrap: 'wrap' }}>
                <h2 style={{ margin: 0 }}>Transaction history</h2>
                {card && (
                  <span className="text-muted" style={{ fontSize: '0.85rem' }}>
                    {cardName(card)} {card.masked_pan ? `•••• ${card.masked_pan.slice(-4)}` : ''} · Balance{' '}
                    {card.currency} {parseFloat(card.balance).toFixed(2)}
                  </span>
                )}
              </div>
              {txError && <div className="alert alert-error" style={{ marginTop: '0.75rem' }}>{txError}</div>}
              <div style={{ marginTop: '1rem', maxHeight: '60vh', overflowY: 'auto' }}>
                {txLoading === txCardId ? (
                  <div className="loading-center"><div className="spinner" /></div>
                ) : rows.length === 0 ? (
                  <p className="text-muted">No transactions yet.</p>
                ) : (
                  <div className="table-wrap">
                    <table className="tx-table" style={{ width: '100%' }}>
                      <thead>
                        <tr>
                          <th style={{ textAlign: 'left' }}>When</th>
                          <th style={{ textAlign: 'left' }}>What</th>
                          <th style={{ textAlign: 'right' }}>Amount</th>
                          <th style={{ textAlign: 'left' }}>Status</th>
                        </tr>
                      </thead>
                      <tbody>
                        {rows.map((t) => {
                          const amt = t.amount != null ? parseFloat(String(t.amount)) : null;
                          const sign = t.direction === 'debit' ? '−' : t.direction === 'credit' ? '+' : '';
                          const declined = t.kind === 'decline';
                          return (
                            <tr key={t.id}>
                              <td style={{ whiteSpace: 'nowrap' }}>{new Date(t.created_at).toLocaleString()}</td>
                              <td>
                                <div style={{ fontWeight: 600 }}>{kindLabel(t)}</div>
                                <div className="text-muted" style={{ fontSize: '0.8rem' }}>
                                  {t.merchant_name ? `${t.merchant_name} · ` : ''}{t.description}
                                </div>
                              </td>
                              <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap', color: declined ? 'var(--danger)' : undefined }}>
                                {amt != null ? `${sign}${t.currency} ${Math.abs(amt).toFixed(2)}` : '—'}
                              </td>
                              <td>
                                <span className={`badge badge-${declined || t.status.includes('fail') ? 'failed' : ['completed', 'success', 'successful'].includes(t.status) ? 'success' : 'pending'}`}>
                                  {t.status.replaceAll('_', ' ')}
                                </span>
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
              <div className="modal-actions">
                <button type="button" className="btn btn-outline" onClick={() => openTransactions(txCardId)} disabled={txLoading === txCardId}>
                  Refresh
                </button>
                <button type="button" className="btn btn-primary" onClick={() => setTxCardId(null)}>Close</button>
              </div>
            </div>
          </div>
        );
      })()}

      {showCreate && (
        <div className="modal-overlay" onClick={() => setShowCreate(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <form onSubmit={handleCreate}>
              <div className="form-group">
                <label>Card load (GHS) - one time</label>
                <input
                  required
                  type="number"
                  step="0.01"
                  min={limits?.min_load_ghs ?? '31.01'}
                  max={limits?.max_load_ghs}
                  value={createForm.initial_funding_ghs}
                  onChange={(e) => setCreateForm({ ...createForm, initial_funding_ghs: e.target.value })}
                />
                {limits && (
                  <div className="text-muted" style={{ fontSize: '0.8rem', marginTop: '0.3rem' }}>
                    GHS {parseFloat(limits.min_load_ghs).toFixed(2)} - {parseFloat(limits.max_load_ghs).toFixed(2)}, once. Up to {limits.max_cards_per_phone} cards per phone number. Card fees are added on top.
                  </div>
                )}
                <CardQuoteLine amountGhs={createForm.initial_funding_ghs} />
              </div>
              <div className="form-group">
                <label>Email (Paystack)</label>
                <input required type="email" value={createForm.sender_email} onChange={(e) => setCreateForm({ ...createForm, sender_email: e.target.value })} />
              </div>
              <div className="form-group">
                <label>Dial code</label>
                <input required value={createForm.dial_code} onChange={(e) => setCreateForm({ ...createForm, dial_code: e.target.value })} />
              </div>
              <div className="form-group">
                <label>Local phone (no country code)</label>
                <input required value={createForm.local_phone_number} onChange={(e) => setCreateForm({ ...createForm, local_phone_number: e.target.value })} />
              </div>
              <div className="modal-actions">
                <button type="button" className="btn btn-outline" onClick={() => setShowCreate(false)}>Cancel</button>
                <button type="submit" className="btn btn-primary" disabled={busy}>Continue to pay</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {terminateCardId && (() => {
        const card = cards.find((x) => x.id === terminateCardId);
        // Bitnob refuses to terminate a card within 24 hours of creating it.
        const allowedFrom = card ? new Date(new Date(card.created_at).getTime() + 24 * 60 * 60 * 1000) : null;
        const tooNew = allowedFrom !== null && allowedFrom.getTime() > Date.now();
        const balance = card ? parseFloat(card.balance) : 0;
        return (
        <div className="modal-overlay" onClick={() => setTerminateCardId(null)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h2>Terminate card</h2>
            {terminateError && <div className="alert alert-error">{terminateError}</div>}
            <p style={{ fontSize: '0.9rem', color: 'var(--text-secondary)', marginBottom: '0.75rem' }}>
              This permanently closes the card - it can't be reopened.
            </p>
            {balance > 0 && (
              // Bitnob returns a terminated card's balance to the platform wallet;
              // GlobePay then pays the GHS equivalent to the owner's mobile money
              // (backend cards/termination_payout.py).
              user?.default_momo_number ? (
                <div className="alert" style={{ background: '#ecfdf5', border: '1px solid #6ee7b7', color: '#065f46', fontSize: '0.85rem' }}>
                  This card still holds {card?.currency} {balance.toFixed(2)}
                  {limits?.ghs_per_usd && <> (about GHS {(balance * parseFloat(limits.ghs_per_usd)).toFixed(2)})</>}.
                  {' '}It will be sent to your mobile money number ending {user.default_momo_number.slice(-4)} once
                  the card is closed.
                </div>
              ) : (
                <div className="alert alert-error" style={{ fontSize: '0.85rem' }}>
                  This card still holds {card?.currency} {balance.toFixed(2)}. Add a mobile money payout number in
                  Settings first so we can send it to you - otherwise you'll need to retry the payout afterwards.
                </div>
              )
            )}
            {tooNew && allowedFrom && (
              <div className="alert" style={{ background: '#fffbeb', border: '1px solid #fcd34d', color: '#92400e', fontSize: '0.85rem' }}>
                New cards can't be terminated for 24 hours. You can terminate this one from{' '}
                {allowedFrom.toLocaleString()}.
              </div>
            )}
            <form onSubmit={handleTerminate}>
              <div className="form-group">
                <label>Reason</label>
                <input
                  required
                  value={terminateReason}
                  onChange={(e) => setTerminateReason(e.target.value)}
                  placeholder="e.g. No longer needed"
                />
              </div>
              <div className="modal-actions">
                <button type="button" className="btn btn-outline" onClick={() => setTerminateCardId(null)}>
                  Keep card
                </button>
                <button type="submit" className="btn btn-danger" disabled={busy || tooNew}>
                  {busy ? 'Terminating…' : 'Terminate card'}
                </button>
              </div>
            </form>
          </div>
        </div>
        );
      })()}
    </div>
  );
}
