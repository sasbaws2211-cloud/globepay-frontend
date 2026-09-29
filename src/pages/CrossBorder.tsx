import React, { useEffect, useState, useCallback } from 'react';
import { getCrossBorderTransfers, createCrossBorderTransfer, retryCrossBorderTransfer, refundCrossBorderTransfer } from '../api/services';
import type { CrossBorderTransfer } from '../api/types';
import { getErrorMessage } from '../api/client';
import { openPaystackCheckout } from '../api/paystack';
import { describeSettledPayment, usePaymentTracker } from '../hooks/usePaymentTracker';
import { useAuth } from '../context/AuthContext';

function formatGhs(value: string | number) {
  const n = typeof value === 'string' ? parseFloat(value) : value;
  return `GHS ${n.toLocaleString('en-GH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export default function CrossBorder() {
  const { user } = useAuth();
  const [transfers, setTransfers] = useState<CrossBorderTransfer[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [showForm, setShowForm] = useState(false);
  const [busy, setBusy] = useState(false);

  const [form, setForm] = useState({
    source_amount: '',
    destination_country: 'KE',
    destination_currency: 'KES',
    beneficiary_name: '',
    beneficiary_phone: '',
    network: 'MPESA', // Bitnob network code - "M-Pesa" is rejected at delivery
    sender_email: user?.email || '',
  });

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      setTransfers(await getCrossBorderTransfers());
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
      setSuccess(`${message} Your transfer is on its way.`);
    } else {
      setSuccess('');
      setError(message);
    }
    load();
  });

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      const res = await createCrossBorderTransfer({
        source_amount: form.source_amount,
        destination_country: form.destination_country,
        destination_currency: form.destination_currency,
        beneficiary: {
          destination_type: 'mobile_money',
          account_name: form.beneficiary_name,
          account_number: form.beneficiary_phone,
          network: form.network,
        },
        sender_email: form.sender_email,
      });
      setShowForm(false);
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
        <h1>Go Global</h1>
        <div className="btn-group">
          {tracking && <span className="text-muted" style={{ alignSelf: 'center', fontSize: '0.85rem' }}>Updating…</span>}
          <button className="btn btn-outline" onClick={load}>Refresh</button>
          <button className="btn btn-primary" onClick={() => setShowForm(true)}>New transfer</button>
        </div>
      </div>

      {error && <div className="alert alert-error">{error}</div>}
      {success && <div className="alert alert-success">{success}</div>}
      <div className="alert alert-info">
        Cross-border transfers are a demo feature. Requires Bitnob sandbox credentials.
      </div>

      <div className="card">
        {loading ? (
          <div className="loading-center"><div className="spinner" /></div>
        ) : transfers.length === 0 ? (
          <div className="empty-state">
            <p>No cross-border transfers yet.</p>
          </div>
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Source</th>
                  <th>Destination</th>
                  <th>Rate</th>
                  <th>Status</th>
                  <th>Date</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {transfers.map((t) => {
                  const st = (t.status || '').toLowerCase();
                  // Matches backend CrossBorderStatus: only delivery_failed means "paid but
                  // not delivered". 'failed' = the payment itself never went through, so
                  // there's nothing to retry or refund; refund_pending = refund in progress.
                  const canRetry = st === 'delivery_failed';
                  const canRefund = st === 'delivery_failed';
                  return (
                  <tr key={t.id}>
                    <td>{formatGhs(t.source_amount)}</td>
                    <td>
                      {t.destination_amount
                        ? `${t.destination_currency} ${parseFloat(t.destination_amount).toFixed(2)}`
                        : t.destination_currency}{' '}
                      ({t.destination_country})
                    </td>
                    <td>{t.exchange_rate_used || '—'}</td>
                    <td>
                      <span className={`badge badge-${['completed', 'refunded'].includes(st) ? 'success' : st === 'failed' || st === 'delivery_failed' ? 'failed' : 'pending'}`}>
                        {t.status.replaceAll('_', ' ')}
                      </span>
                      {t.failure_reason && (
                        <div style={{ fontSize: '0.75rem', color: 'var(--danger)' }}>{t.failure_reason}</div>
                      )}
                    </td>
                    <td>{new Date(t.created_at).toLocaleString()}</td>
                    <td>
                      <div className="btn-group">
                        {canRetry && (
                          <button
                            className="btn btn-sm btn-outline"
                            disabled={busy}
                            onClick={async () => {
                              setBusy(true);
                              setError('');
                              try {
                                await retryCrossBorderTransfer(t.id);
                                setSuccess('Retry started');
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
                        {canRefund && (
                          <button
                            className="btn btn-sm btn-danger"
                            disabled={busy}
                            onClick={async () => {
                              if (!window.confirm('Refund this transfer?')) return;
                              setBusy(true);
                              setError('');
                              try {
                                await refundCrossBorderTransfer(t.id);
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
                      </div>
                    </td>
                  </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {showForm && (
        <div className="modal-overlay" onClick={() => setShowForm(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h2>Cross-border transfer</h2>
            <form onSubmit={handleSubmit}>
              <div className="form-group">
                <label>Amount (GHS)</label>
                <input required type="number" step="0.01" min="1" value={form.source_amount} onChange={(e) => setForm({ ...form, source_amount: e.target.value })} />
              </div>
              <div className="form-group">
                <label>Destination country</label>
                <select value={form.destination_country} onChange={(e) => {
                  const country = e.target.value;
                  const currency = country === 'KE' ? 'KES' : country === 'NG' ? 'NGN' : 'USD';
                  setForm({ ...form, destination_country: country, destination_currency: currency });
                }}>
                  <option value="KE">Kenya (KES)</option>
                  <option value="NG">Nigeria (NGN)</option>
                  <option value="US">United States (USD)</option>
                </select>
              </div>
              <div className="form-group">
                <label>Beneficiary name</label>
                <input required value={form.beneficiary_name} onChange={(e) => setForm({ ...form, beneficiary_name: e.target.value })} />
              </div>
              <div className="form-group">
                <label>Beneficiary phone</label>
                <input required value={form.beneficiary_phone} onChange={(e) => setForm({ ...form, beneficiary_phone: e.target.value })} />
              </div>
              <div className="form-group">
                <label>Network</label>
                <input
                  value={form.network}
                  placeholder="e.g. MPESA, MTN, AIRTEL"
                  onChange={(e) => setForm({ ...form, network: e.target.value })}
                />
              </div>
              <div className="form-group">
                <label>Your email (Paystack)</label>
                <input required type="email" value={form.sender_email} onChange={(e) => setForm({ ...form, sender_email: e.target.value })} />
              </div>
              <div className="modal-actions">
                <button type="button" className="btn btn-outline" onClick={() => setShowForm(false)}>Cancel</button>
                <button type="submit" className="btn btn-primary" disabled={busy}>Continue to pay</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
