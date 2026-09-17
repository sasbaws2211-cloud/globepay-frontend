import React, { useEffect, useState, useCallback } from 'react';
import {
  getCards,
  createCard,
  fundCard,
  freezeCard,
  unfreezeCard,
  terminateCard,
  retryCardCreation,
  refundCardCreation,
  getCardFundings,
  getCardTransactions,
  retryCardFunding,
  refundCardFunding,
  type CardFunding,
  type CardTransaction,
} from '../api/services';
import type { Card } from '../api/types';
import { getErrorMessage } from '../api/client';
import { useAuth } from '../context/AuthContext';

export default function Cards() {
  const { user } = useAuth();
  const [cards, setCards] = useState<Card[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [showCreate, setShowCreate] = useState(false);
  const [fundCardId, setFundCardId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const [createForm, setCreateForm] = useState({
    initial_funding_ghs: '50',
    sender_email: user?.email || '',
    dial_code: '+233',
    local_phone_number: user?.phone_number?.replace(/^\+?233/, '') || '',
  });
  const [fundForm, setFundForm] = useState({ amount_ghs: '', sender_email: user?.email || '' });
  const [terminateCardId, setTerminateCardId] = useState<string | null>(null);
  const [terminateReason, setTerminateReason] = useState('');
  const [expandedCardId, setExpandedCardId] = useState<string | null>(null);
  const [fundingsByCard, setFundingsByCard] = useState<Record<string, CardFunding[]>>({});
  const [fundingsLoading, setFundingsLoading] = useState<string | null>(null);
  const [txCardId, setTxCardId] = useState<string | null>(null);
  const [txByCard, setTxByCard] = useState<Record<string, CardTransaction[]>>({});
  const [txLoading, setTxLoading] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      setCards(await getCards());
    } catch (err) {
      setError(getErrorMessage(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const toggleFundings = async (cardId: string) => {
    if (expandedCardId === cardId) {
      setExpandedCardId(null);
      return;
    }
    setExpandedCardId(cardId);
    if (fundingsByCard[cardId]) return;
    setFundingsLoading(cardId);
    setError('');
    try {
      const list = await getCardFundings(cardId);
      setFundingsByCard((prev) => ({ ...prev, [cardId]: list }));
    } catch (err) {
      setError(getErrorMessage(err));
    } finally {
      setFundingsLoading(null);
    }
  };

  const refreshFundings = async (cardId: string) => {
    try {
      const list = await getCardFundings(cardId);
      setFundingsByCard((prev) => ({ ...prev, [cardId]: list }));
    } catch (err) {
      setError(getErrorMessage(err));
    }
  };

  const toggleTransactions = async (cardId: string) => {
    if (txCardId === cardId) {
      setTxCardId(null);
      return;
    }
    setTxCardId(cardId);
    if (txByCard[cardId]) return;
    setTxLoading(cardId);
    setError('');
    try {
      const list = await getCardTransactions(cardId);
      setTxByCard((prev) => ({ ...prev, [cardId]: list }));
    } catch (err) {
      setError(getErrorMessage(err));
    } finally {
      setTxLoading(null);
    }
  };

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      const res = await createCard(createForm);
      setSuccess(`Card creation started. Ref: ${res.reference}`);
      if (res.authorization_url) window.open(res.authorization_url, '_blank');
      setShowCreate(false);
      load();
    } catch (err) {
      setError(getErrorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  const handleFund = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!fundCardId) return;
    setBusy(true);
    setError('');
    try {
      const res = await fundCard(fundCardId, fundForm.amount_ghs, fundForm.sender_email);
      setSuccess(`Funding started. Ref: ${res.reference}`);
      if (res.authorization_url) window.open(res.authorization_url, '_blank');
      setFundCardId(null);
      load();
    } catch (err) {
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
        setSuccess('Card frozen');
      }
      load();
    } catch (err) {
      setError(getErrorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  const handleTerminate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!terminateCardId) return;
    setBusy(true);
    setError('');
    try {
      await terminateCard(terminateCardId, terminateReason.trim() || 'User requested');
      setSuccess('Card terminated');
      setTerminateCardId(null);
      setTerminateReason('');
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
        <h1>Virtual Cards</h1>
        <div className="btn-group">
          <button className="btn btn-outline" onClick={load}>Refresh</button>
          <button className="btn btn-primary" onClick={() => setShowCreate(true)}>Create card</button>
        </div>
      </div>

      {error && <div className="alert alert-error">{error}</div>}
      {success && <div className="alert alert-success">{success}</div>}
      <div className="alert alert-info">
        Virtual cards are a sandbox demo feature. Requires Bitnob + Paystack sandbox credentials.
      </div>

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
                <span style={{ opacity: 0.9 }}>{c.card_brand || 'GlobePay Card'}</span>
                <span className="badge" style={{ background: 'rgba(255,255,255,0.2)', color: 'white' }}>
                  {c.status}
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
              <div className="btn-group">
                <button
                  className="btn btn-sm"
                  style={{ background: 'rgba(255,255,255,0.2)', color: 'white' }}
                  onClick={() => {
                    setFundCardId(c.id);
                    setFundForm({ amount_ghs: '20', sender_email: user?.email || '' });
                  }}
                  disabled={['terminated', 'failed'].includes((c.status || '').toLowerCase())}
                >
                  Fund
                </button>
                <button
                  className="btn btn-sm"
                  style={{ background: 'rgba(255,255,255,0.2)', color: 'white' }}
                  onClick={() => handleFreeze(c)}
                  disabled={busy || ['terminated', 'failed'].includes((c.status || '').toLowerCase())}
                >
                  {c.status === 'frozen' || c.status === 'inactive' ? 'Unfreeze' : 'Freeze'}
                </button>
                {!['terminated', 'failed'].includes((c.status || '').toLowerCase()) && (
                  <button
                    className="btn btn-sm"
                    style={{ background: 'rgba(220,38,38,0.35)', color: 'white' }}
                    onClick={() => {
                      setTerminateCardId(c.id);
                      setTerminateReason('');
                    }}
                    disabled={busy}
                  >
                    Terminate
                  </button>
                )}
                {['failed', 'pending'].includes((c.status || '').toLowerCase()) && (
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
                {['failed'].includes((c.status || '').toLowerCase()) && (
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
                  onClick={() => toggleFundings(c.id)}
                >
                  {expandedCardId === c.id ? 'Hide top-ups' : 'Top-up history'}
                </button>
                <button
                  className="btn btn-sm"
                  style={{ background: 'rgba(255,255,255,0.2)', color: 'white' }}
                  onClick={() => toggleTransactions(c.id)}
                >
                  {txCardId === c.id ? 'Hide history' : 'Transactions'}
                </button>
              </div>
              {expandedCardId === c.id && (
                <div
                  style={{
                    marginTop: '1rem',
                    padding: '0.75rem',
                    background: 'rgba(0,0,0,0.2)',
                    borderRadius: 8,
                    fontSize: '0.85rem',
                  }}
                >
                  <div style={{ fontWeight: 600, marginBottom: '0.5rem' }}>Top-up history</div>
                  {fundingsLoading === c.id ? (
                    <div>Loading…</div>
                  ) : !(fundingsByCard[c.id] || []).length ? (
                    <div style={{ opacity: 0.85 }}>No top-ups yet.</div>
                  ) : (
                    <div className="table-wrap">
                      <table style={{ width: '100%', color: 'white' }}>
                        <thead>
                          <tr>
                            <th style={{ textAlign: 'left', opacity: 0.8 }}>Amount</th>
                            <th style={{ textAlign: 'left', opacity: 0.8 }}>Status</th>
                            <th style={{ textAlign: 'left', opacity: 0.8 }}>Date</th>
                            <th></th>
                          </tr>
                        </thead>
                        <tbody>
                          {(fundingsByCard[c.id] || []).map((f) => {
                            const st = (f.status || '').toLowerCase();
                            const canAct = st.includes('fail') || st === 'delivery_failed';
                            return (
                              <tr key={f.id}>
                                <td>
                                  GHS {parseFloat(f.amount_ghs).toFixed(2)}
                                  <span style={{ opacity: 0.75 }}> / ${parseFloat(f.amount_usd).toFixed(2)}</span>
                                </td>
                                <td>
                                  {f.status}
                                  {f.failure_reason && (
                                    <div style={{ fontSize: '0.75rem', color: '#fecaca' }}>{f.failure_reason}</div>
                                  )}
                                </td>
                                <td>{new Date(f.created_at).toLocaleDateString()}</td>
                                <td>
                                  {canAct && (
                                    <div className="btn-group">
                                      <button
                                        className="btn btn-sm"
                                        style={{ background: 'rgba(255,255,255,0.25)', color: 'white' }}
                                        disabled={busy}
                                        onClick={async () => {
                                          setBusy(true);
                                          try {
                                            await retryCardFunding(c.id, f.id);
                                            setSuccess('Funding retry started');
                                            await refreshFundings(c.id);
                                          } catch (err) {
                                            setError(getErrorMessage(err));
                                          } finally {
                                            setBusy(false);
                                          }
                                        }}
                                      >
                                        Retry
                                      </button>
                                      <button
                                        className="btn btn-sm"
                                        style={{ background: 'rgba(220,38,38,0.4)', color: 'white' }}
                                        disabled={busy}
                                        onClick={async () => {
                                          if (!window.confirm('Refund this top-up?')) return;
                                          setBusy(true);
                                          try {
                                            await refundCardFunding(c.id, f.id);
                                            setSuccess('Funding refund initiated');
                                            await refreshFundings(c.id);
                                          } catch (err) {
                                            setError(getErrorMessage(err));
                                          } finally {
                                            setBusy(false);
                                          }
                                        }}
                                      >
                                        Refund
                                      </button>
                                    </div>
                                  )}
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
              )}
              {txCardId === c.id && (
                <div
                  style={{
                    marginTop: '1rem',
                    padding: '0.75rem',
                    background: 'rgba(0,0,0,0.25)',
                    borderRadius: 8,
                    fontSize: '0.85rem',
                  }}
                >
                  <div style={{ fontWeight: 600, marginBottom: '0.5rem' }}>Transaction history</div>
                  {txLoading === c.id ? (
                    <div>Loading…</div>
                  ) : !(txByCard[c.id] || []).length ? (
                    <div style={{ opacity: 0.85 }}>No transactions yet.</div>
                  ) : (
                    <div className="table-wrap">
                      <table style={{ width: '100%', color: 'white' }}>
                        <thead>
                          <tr>
                            <th style={{ textAlign: 'left', opacity: 0.8 }}>When</th>
                            <th style={{ textAlign: 'left', opacity: 0.8 }}>Type</th>
                            <th style={{ textAlign: 'left', opacity: 0.8 }}>Description</th>
                            <th style={{ textAlign: 'right', opacity: 0.8 }}>Amount</th>
                            <th style={{ textAlign: 'left', opacity: 0.8 }}>Status</th>
                          </tr>
                        </thead>
                        <tbody>
                          {(txByCard[c.id] || []).map((t) => {
                            const amt = t.amount != null ? parseFloat(String(t.amount)) : null;
                            const sign =
                              t.direction === 'debit' ? '−' : t.direction === 'credit' ? '+' : '';
                            return (
                              <tr key={t.id}>
                                <td>{new Date(t.created_at).toLocaleString()}</td>
                                <td style={{ textTransform: 'capitalize' }}>{t.kind}</td>
                                <td>
                                  {t.description}
                                  {t.merchant_name && (
                                    <div style={{ opacity: 0.75, fontSize: '0.75rem' }}>{t.merchant_name}</div>
                                  )}
                                  <div style={{ opacity: 0.6, fontSize: '0.7rem' }}>{t.source}</div>
                                </td>
                                <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>
                                  {amt != null
                                    ? `${sign}${t.currency} ${Math.abs(amt).toFixed(2)}`
                                    : '—'}
                                </td>
                                <td>{t.status}</td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {showCreate && (
        <div className="modal-overlay" onClick={() => setShowCreate(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h2>Create virtual card</h2>
            <form onSubmit={handleCreate}>
              <div className="form-group">
                <label>Initial funding (GHS)</label>
                <input required type="number" step="0.01" min="10" value={createForm.initial_funding_ghs} onChange={(e) => setCreateForm({ ...createForm, initial_funding_ghs: e.target.value })} />
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

      {fundCardId && (
        <div className="modal-overlay" onClick={() => setFundCardId(null)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h2>Fund card</h2>
            <form onSubmit={handleFund}>
              <div className="form-group">
                <label>Amount (GHS)</label>
                <input required type="number" step="0.01" min="1" value={fundForm.amount_ghs} onChange={(e) => setFundForm({ ...fundForm, amount_ghs: e.target.value })} />
              </div>
              <div className="form-group">
                <label>Email</label>
                <input required type="email" value={fundForm.sender_email} onChange={(e) => setFundForm({ ...fundForm, sender_email: e.target.value })} />
              </div>
              <div className="modal-actions">
                <button type="button" className="btn btn-outline" onClick={() => setFundCardId(null)}>Cancel</button>
                <button type="submit" className="btn btn-primary" disabled={busy}>Continue to pay</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {terminateCardId && (
        <div className="modal-overlay" onClick={() => setTerminateCardId(null)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h2>Terminate card</h2>
            <p style={{ fontSize: '0.9rem', color: 'var(--text-secondary)', marginBottom: '1rem' }}>
              This permanently closes the card. Any remaining balance handling follows the provider rules.
            </p>
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
                <button type="submit" className="btn btn-danger" disabled={busy}>
                  {busy ? 'Terminating…' : 'Terminate card'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
