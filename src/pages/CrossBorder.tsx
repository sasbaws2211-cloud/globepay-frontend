import React, { useEffect, useMemo, useState, useCallback } from 'react';
import {
  getCrossBorderTransfers,
  createCrossBorderTransfer,
  retryCrossBorderTransfer,
  refundCrossBorderTransfer,
  getPayoutCorridors,
  getPayoutRequirements,
  getPayoutAmountLimits,
  getSenderProfile,
} from '../api/services';
import type {
  CrossBorderTransfer,
  PayoutAmountLimits,
  PayoutCorridorCountry,
  PayoutDestinationType,
  PayoutField,
  PayoutRequirements,
} from '../api/types';
import { getErrorMessage } from '../api/client';
import { openPaystackCheckout } from '../api/paystack';
import { describeSettledPayment, usePaymentTracker } from '../hooks/usePaymentTracker';
import { useAuth } from '../context/AuthContext';

function formatGhs(value: string | number) {
  const n = typeof value === 'string' ? parseFloat(value) : value;
  return `GHS ${n.toLocaleString('en-GH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

// The rate the sender actually got: what arrived per GHS paid. The stored
// exchange_rate_used is Bitnob's USDC->destination rate (our float leg), which
// isn't meaningful to someone paying in GHS (e.g. 1.0 for every USD payout).
function formatSenderRate(source: string, destination: string | null, currency: string) {
  const src = parseFloat(source);
  const dst = destination ? parseFloat(destination) : NaN;
  if (!(src > 0) || !(dst > 0)) return '—';
  const rate = (dst / src).toLocaleString('en-GH', { maximumSignificantDigits: 4 });
  return `1 GHS = ${rate} ${currency}`;
}

// Every ISO 3166-1 alpha-2 code, for Bitnob's "country_select" fields (sender
// country, country of birth, bank country...) - these can be any country, not
// only the ones Bitnob pays out to. Names come from the browser's Intl data.
const ISO_CODES = (
  'AD AE AF AG AI AL AM AO AQ AR AS AT AU AW AX AZ BA BB BD BE BF BG BH BI BJ BL BM BN BO BQ BR BS BT BV BW BY BZ ' +
  'CA CC CD CF CG CH CI CK CL CM CN CO CR CU CV CW CX CY CZ DE DJ DK DM DO DZ EC EE EG EH ER ES ET FI FJ FK FM FO FR ' +
  'GA GB GD GE GF GG GH GI GL GM GN GP GQ GR GS GT GU GW GY HK HM HN HR HT HU ID IE IL IM IN IO IQ IR IS IT JE JM JO ' +
  'JP KE KG KH KI KM KN KP KR KW KY KZ LA LB LC LI LK LR LS LT LU LV LY MA MC MD ME MF MG MH MK ML MM MN MO MP MQ MR ' +
  'MS MT MU MV MW MX MY MZ NA NC NE NF NG NI NL NO NP NR NU NZ OM PA PE PF PG PH PK PL PM PN PR PS PT PW PY QA RE RO ' +
  'RS RU RW SA SB SC SD SE SG SH SI SJ SK SL SM SN SO SR SS ST SV SX SY SZ TC TD TF TG TH TJ TK TL TM TN TO TR TT TV ' +
  'TW TZ UA UG UM US UY UZ VA VC VE VG VI VN VU WF WS YE YT ZA ZM ZW'
).split(' ');

const ALL_COUNTRIES: [string, string][] = (() => {
  let names: { of(code: string): string | undefined } | null = null;
  try {
    names = new Intl.DisplayNames(['en'], { type: 'region' });
  } catch {
    names = null;
  }
  return ISO_CODES.map((c): [string, string] => [c, names?.of(c) || c]).sort((a, b) => a[1].localeCompare(b[1]));
})();

type Values = Record<string, any>;

function subFields(spec: PayoutField[] | { fields: PayoutField[] } | undefined): PayoutField[] {
  if (!spec) return [];
  return Array.isArray(spec) ? spec : spec.fields || [];
}

function methodLabel(req: PayoutRequirements | null, key: string) {
  return req?.destination_types?.[key]?.label || key.replaceAll('_', ' ');
}

/** Renders Bitnob's field spec for one destination type - text, select,
 *  country, date, nested groups (beneficiary address) and the
 *  individual/business sender variant. The backend validates the same spec. */
function PayoutFields({
  fields,
  values,
  onChange,
  dest,
  path = 'pf',
}: {
  path?: string;
  fields: PayoutField[];
  values: Values;
  onChange: (next: Values) => void;
  dest: PayoutDestinationType;
}) {
  const set = (key: string, v: unknown) => onChange({ ...values, [key]: v });
  return (
    <>
      {fields.filter((f) => !f.hidden).map((f) => {
        const id = `${path}-${f.key}`;
        if (f.component === 'fieldset') {
          return (
            <fieldset key={f.key} className="form-group" style={{ border: '1px solid var(--border, #e5e7eb)', borderRadius: 10, padding: '0.75rem' }}>
              <legend style={{ fontWeight: 600, padding: '0 0.25rem' }}>{f.label === 'Beneficiary' ? 'Recipient details' : f.label}</legend>
              <PayoutFields fields={f.fields || []} values={values[f.key] || {}} onChange={(v) => set(f.key, v)} dest={dest} path={id} />
            </fieldset>
          );
        }
        if (f.component === 'variant_fieldset') {
          const vk = f.variant_key || 'type';
          const current: Values = values[f.key] || {};
          const variant = current[vk] || '';
          const variantNames = Object.keys(f.variants || {}).sort().reverse(); // individual first
          return (
            <fieldset key={f.key} className="form-group" style={{ border: '1px solid var(--border, #e5e7eb)', borderRadius: 10, padding: '0.75rem' }}>
              <legend style={{ fontWeight: 600, padding: '0 0.25rem' }}>{f.label === 'Sender' ? 'Your details (sender)' : f.label}</legend>
              <div className="form-group">
                <label htmlFor={id}>Sending as</label>
                <select id={id} required value={variant} onChange={(e) => set(f.key, { ...current, [vk]: e.target.value })}>
                  <option value="">Select…</option>
                  {variantNames.map((v) => (
                    <option key={v} value={v}>{v === 'individual' ? 'An individual' : v === 'business' ? 'A business' : v}</option>
                  ))}
                </select>
              </div>
              {variant && (
                <PayoutFields
                  fields={subFields(f.variants?.[variant])}
                  values={current}
                  onChange={(v) => set(f.key, { ...v, [vk]: variant })}
                  path={id}
                  dest={dest}
                />
              )}
            </fieldset>
          );
        }

        const value = values[f.key] ?? '';
        let options = f.options && f.options.length ? f.options : null;
        if (!options && f.key === 'bank_code' && dest.banks?.length) {
          options = dest.banks.map((b) => ({ label: b.name, value: b.code }));
        }
        let input: React.ReactNode;
        if (f.component === 'country_select') {
          input = (
            <select id={id} required={f.required} value={value} onChange={(e) => set(f.key, e.target.value)}>
              <option value="">Select country…</option>
              {ALL_COUNTRIES.map(([code, name]) => <option key={code} value={code}>{name}</option>)}
            </select>
          );
        } else if (options) {
          input = (
            <select id={id} required={f.required} value={value} onChange={(e) => set(f.key, e.target.value)}>
              <option value="">Select…</option>
              {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
          );
        } else if (f.component === 'date') {
          input = <input id={id} type="date" required={f.required} value={value} onChange={(e) => set(f.key, e.target.value)} />;
        } else {
          input = (
            <input
              id={id}
              required={f.required}
              value={value}
              minLength={f.min_length}
              maxLength={f.max_length}
              placeholder={f.placeholder}
              onChange={(e) => set(f.key, e.target.value)}
            />
          );
        }
        return (
          <div key={f.key} className="form-group">
            <label htmlFor={id}>{f.label}</label>
            {input}
          </div>
        );
      })}
    </>
  );
}

/** Sensible starting values: the recipient's country is the destination, and
 *  the sender block comes from the details saved last time (if any). */
function initialValues(dest: PayoutDestinationType, country: string, savedSender: Values | null): Values {
  const out: Values = {};
  for (const f of dest.fields) {
    if (f.component === 'fieldset') {
      const hasCountry = (f.fields || []).some((s) => s.key === 'country');
      out[f.key] = hasCountry ? { country } : {};
    } else if (f.component === 'variant_fieldset') {
      out[f.key] = savedSender ? { ...savedSender } : { [f.variant_key || 'type']: 'individual', country: 'GH' };
    } else if (f.component === 'country_select' && f.key === 'country') {
      out[f.key] = country;
    }
  }
  return out;
}

export default function CrossBorder() {
  const { user } = useAuth();
  const [transfers, setTransfers] = useState<CrossBorderTransfer[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [showForm, setShowForm] = useState(false);
  const [busy, setBusy] = useState(false);

  const [corridors, setCorridors] = useState<PayoutCorridorCountry[]>([]);
  const [requirements, setRequirements] = useState<PayoutRequirements | null>(null);
  const [reqLoading, setReqLoading] = useState(false);
  const [savedSender, setSavedSender] = useState<Values | null>(null);

  const [amount, setAmount] = useState('');
  const [country, setCountry] = useState('');
  const [currency, setCurrency] = useState('');
  const [method, setMethod] = useState('');
  const [values, setValues] = useState<Values>({});
  const [senderEmail, setSenderEmail] = useState(user?.email || '');
  const [saveSender, setSaveSender] = useState(true);

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

  // Bitnob checks the beneficiary before payment, so its answer (e.g. "IBAN
  // doesn't look right") arrives while this form is open - show it inside the
  // modal, not behind it.
  const [modalError, setModalError] = useState('');

  const openForm = async () => {
    setModalError('');
    setShowForm(true);
    try {
      const [list, sender] = await Promise.all([
        corridors.length ? Promise.resolve(corridors) : getPayoutCorridors(),
        getSenderProfile(),
      ]);
      setCorridors(list);
      setSavedSender(sender);
    } catch (err) {
      setModalError(getErrorMessage(err));
    }
  };

  const countryInfo = corridors.find((c) => c.code === country);
  const methods = useMemo(
    () => countryInfo?.corridors.find((c) => c.currency === currency)?.destination_types || [],
    [countryInfo, currency]
  );
  const dest = method ? requirements?.destination_types?.[method] : undefined;

  const chooseCountry = async (code: string) => {
    setCountry(code);
    setRequirements(null);
    setMethod('');
    setValues({});
    const info = corridors.find((c) => c.code === code);
    const firstCurrency = info?.corridors[0]?.currency || '';
    setCurrency(firstCurrency);
    if (!code) return;
    setReqLoading(true);
    setModalError('');
    try {
      const req = await getPayoutRequirements(code);
      setRequirements(req);
      const types = info?.corridors[0]?.destination_types || [];
      if (types.length === 1) chooseMethod(types[0], req, code);
    } catch (err) {
      setModalError(getErrorMessage(err));
    } finally {
      setReqLoading(false);
    }
  };

  const chooseMethod = (key: string, req = requirements, code = country) => {
    setMethod(key);
    const d = req?.destination_types?.[key];
    setValues(d ? initialValues(d, code, savedSender) : {});
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!dest) return;
    setBusy(true);
    setError('');
    setModalError('');
    let res;
    try {
      res = await createCrossBorderTransfer({
        source_amount: amount,
        destination_country: country,
        destination_currency: currency,
        destination_type: method,
        beneficiary: values,
        sender_email: senderEmail,
        save_sender_profile: saveSender && dest.fields.some((f) => f.key === 'sender'),
      });
    } catch (err) {
      setModalError(getErrorMessage(err)); // modal still open
      setBusy(false);
      return;
    }
    try {
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

  // Bitnob's min/max are in the currency the recipient gets; the backend also
  // converts them to roughly what to type in GHS. Until that arrives (or if
  // it fails) fall back to the destination-currency limits from the spec.
  const [amountLimits, setAmountLimits] = useState<PayoutAmountLimits | null>(null);
  useEffect(() => {
    setAmountLimits(null);
    if (!country || !currency || !method) return;
    let cancelled = false;
    getPayoutAmountLimits(country, currency, method)
      .then((l) => { if (!cancelled) setAmountLimits(l); })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [country, currency, method]);

  const limits = amountLimits ?? (dest?.limits?.min_amount ? {
    currency: dest.limits.currency || currency,
    min_amount: dest.limits.min_amount,
    max_amount: dest.limits.max_amount ?? null,
    min_ghs: null,
    max_ghs: null,
  } : null);
  const hasSender = dest?.fields.some((f) => f.key === 'sender');

  return (
    <div>
      <div className="page-header">
        <h1>Go Global</h1>
        <div className="btn-group">
          {tracking && <span className="text-muted" style={{ alignSelf: 'center', fontSize: '0.85rem' }}>Updating…</span>}
          <button className="btn btn-outline" onClick={load}>Refresh</button>
          <button className="btn btn-primary" onClick={openForm}>New transfer</button>
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
                  <th>Recipient</th>
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
                    <td>
                      {/* Nigeria bank payouts carry no recipient name - show the bank instead. */}
                      <div>{t.beneficiary_name || t.beneficiary_bank || '—'}</div>
                      <div className="text-muted" style={{ fontSize: '0.75rem' }}>
                        {[t.destination_type?.replaceAll('_', ' '), t.beneficiary_account].filter(Boolean).join(' · ')}
                      </div>
                    </td>
                    <td style={{ whiteSpace: 'nowrap' }}>{formatSenderRate(t.source_amount, t.destination_amount, t.destination_currency)}</td>
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
            {modalError && <div className="alert alert-error">{modalError}</div>}
            <form onSubmit={handleSubmit}>
              <div className="form-group">
                <label htmlFor="xb-amount">Amount (GHS)</label>
                <input
                  id="xb-amount"
                  required
                  type="number"
                  step="0.01"
                  min={limits?.min_ghs ?? '1'}
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                  aria-describedby={limits ? 'xb-amount-limits' : undefined}
                />
                {limits && (
                  <div id="xb-amount-limits" className="text-muted" style={{ fontSize: '0.8rem', marginTop: '0.35rem' }}>
                    {/* Only the minimum: Bitnob's maximums (e.g. GHS 155m for the US) sit far above any KYC tier limit. */}
                    {limits.min_ghs
                      ? <>Minimum about <strong>GHS {Number(limits.min_ghs).toLocaleString()}</strong>{' '}
                          (they must receive at least {limits.currency} {Number(limits.min_amount).toLocaleString()}).</>
                      : <>They must receive at least <strong>{limits.currency} {Number(limits.min_amount).toLocaleString()}</strong>.</>}
                  </div>
                )}
              </div>
              <div className="form-group">
                <label htmlFor="xb-country">Destination country</label>
                {/* Every country Bitnob pays out to, from its live corridor list. */}
                <select id="xb-country" required value={country} onChange={(e) => chooseCountry(e.target.value)}>
                  <option value="">{corridors.length ? 'Select country…' : 'Loading countries…'}</option>
                  {corridors.map((c) => (
                    <option key={c.code} value={c.code}>{c.flag ? `${c.flag} ` : ''}{c.name}</option>
                  ))}
                </select>
              </div>
              {countryInfo && countryInfo.corridors.length > 1 && (
                <div className="form-group">
                  <label htmlFor="xb-currency">Currency they receive</label>
                  <select id="xb-currency" value={currency} onChange={(e) => { setCurrency(e.target.value); setMethod(''); setValues({}); }}>
                    {countryInfo.corridors.map((c) => <option key={c.currency} value={c.currency}>{c.currency}</option>)}
                  </select>
                </div>
              )}
              {reqLoading && <div className="text-muted" style={{ marginBottom: '1rem' }}>Loading payout options…</div>}
              {requirements && methods.length > 0 && (
                <div className="form-group">
                  <label htmlFor="xb-method">How they receive it</label>
                  <select id="xb-method" required value={method} onChange={(e) => chooseMethod(e.target.value)}>
                    <option value="">Select…</option>
                    {methods.map((m) => <option key={m} value={m}>{methodLabel(requirements, m)}</option>)}
                  </select>
                </div>
              )}

              {dest && <PayoutFields fields={dest.fields} values={values} onChange={setValues} dest={dest} />}

              {hasSender && (
                <div className="form-group">
                  <label style={{ display: 'flex', gap: '0.5rem', alignItems: 'center', fontWeight: 400 }}>
                    <input type="checkbox" checked={saveSender} onChange={(e) => setSaveSender(e.target.checked)} style={{ width: 'auto' }} />
                    Remember my sender details for next time
                  </label>
                </div>
              )}
              <div className="form-group">
                <label htmlFor="xb-email">Your email (Paystack)</label>
                <input id="xb-email" required type="email" value={senderEmail} onChange={(e) => setSenderEmail(e.target.value)} />
              </div>
              <div className="modal-actions">
                <button type="button" className="btn btn-outline" onClick={() => setShowForm(false)}>Cancel</button>
                <button type="submit" className="btn btn-primary" disabled={busy || !dest}>
                  {busy ? 'Checking…' : 'Continue to pay'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
