import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import {
  requestPhoneVerification,
  confirmPhoneVerification,
  setPayoutDestination,
  setRoundUpSettings,
  closeAccount,
  getReferrals,
  getVaults,
  getMyLimits,
  type TransactionLimits,
} from '../api/services';
import type { Vault } from '../api/types';
import { getErrorMessage } from '../api/client';
import { MOMO_NETWORKS, toLocalGhanaNumber } from '../utils/momo';

const TIER_LABELS: Record<TransactionLimits['kyc_tier'], string> = {
  unverified: 'Unverified',
  phone_verified: 'Phone verified',
  id_verified: 'ID verified',
};

function ghs(value: string) {
  return `GHS ${parseFloat(value).toLocaleString('en-GH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export default function Settings() {
  const { user, refreshUser, logout } = useAuth();
  const navigate = useNavigate();
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [busy, setBusy] = useState(false);

  const [phoneCode, setPhoneCode] = useState('');
  const [codeSent, setCodeSent] = useState(false);

  const [payout, setPayout] = useState({
    momo_number: toLocalGhanaNumber(user?.default_momo_number),
    momo_bank_code: user?.default_momo_bank_code || 'MTN',
    account_name: user?.default_account_name || user?.full_name || '',
  });

  const [vaults, setVaults] = useState<Vault[]>([]);
  const [roundUpVaultId, setRoundUpVaultId] = useState(user?.round_up_vault_id || '');
  const [roundUpDenom, setRoundUpDenom] = useState(user?.round_up_denomination || '5.00');

  const [referrals, setReferrals] = useState<
    { full_name: string; referral_reward_status: string; created_at: string }[]
  >([]);

  const [closePassword, setClosePassword] = useState('');
  const [showClose, setShowClose] = useState(false);

  const isPhoneVerified = user?.is_phone_verified;

  useEffect(() => {
    setPayout({
      momo_number: toLocalGhanaNumber(user?.default_momo_number),
      momo_bank_code: user?.default_momo_bank_code || 'MTN',
      account_name: user?.default_account_name || user?.full_name || '',
    });
    setRoundUpVaultId(user?.round_up_vault_id || '');
    setRoundUpDenom(user?.round_up_denomination || '5.00');
  }, [user]);

  useEffect(() => {
    getVaults().then(setVaults).catch(() => setVaults([]));
    getReferrals().then(setReferrals).catch(() => setReferrals([]));
  }, []);

  // Re-read after the phone is verified (that raises the tier).
  const [limits, setLimits] = useState<TransactionLimits | null>(null);
  useEffect(() => {
    getMyLimits().then(setLimits).catch(() => setLimits(null));
  }, [user?.kyc_tier]);

  const run = async (fn: () => Promise<void>, okMsg: string) => {
    setBusy(true);
    setError('');
    setSuccess('');
    try {
      await fn();
      if (okMsg) setSuccess(okMsg);
    } catch (err) {
      setError(getErrorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  const handleRequestPhoneCode = () =>
    run(async () => {
      const res = await requestPhoneVerification();
      setCodeSent(true);
      setSuccess(res.message || 'Verification code sent.');
    }, '');

  const handleConfirmPhone = (e: React.FormEvent) => {
    e.preventDefault();
    run(async () => {
      await confirmPhoneVerification(phoneCode.trim());
      await refreshUser();
      setPhoneCode('');
      setCodeSent(false);
    }, 'Phone verified.');
  };

  const handlePayout = (e: React.FormEvent) => {
    e.preventDefault();
    run(async () => {
      await setPayoutDestination(payout);
      await refreshUser();
    }, 'Payout destination saved.');
  };

  const handleRoundUp = (e: React.FormEvent) => {
    e.preventDefault();
    run(async () => {
      await setRoundUpSettings({
        vault_id: roundUpVaultId || null,
        denomination: roundUpDenom,
      });
      await refreshUser();
    }, roundUpVaultId ? 'Round-up enabled.' : 'Round-up disabled.');
  };

  const handleCloseAccount = (e: React.FormEvent) => {
    e.preventDefault();
    if (!window.confirm('Permanently close your account? This cannot be undone.')) return;
    run(async () => {
      await closeAccount(closePassword);
      logout();
      navigate('/login');
    }, 'Account closed.');
  };

  return (
    <div>
      <div className="page-header">
        <div>
          <h1>Settings</h1>
          <p style={{ color: 'var(--text-secondary)', fontSize: '0.95rem' }}>
            Phone, payouts, round-ups, and account
          </p>
        </div>
      </div>

      {error && <div className="alert alert-error">{error}</div>}
      {success && <div className="alert alert-success">{success}</div>}

      {limits && (
        <div className="card" style={{ marginBottom: '1rem' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '0.5rem', marginBottom: '0.75rem' }}>
            <h2 style={{ fontSize: '1.1rem' }}>Your transaction limits</h2>
            <span className="badge badge-active" style={{ whiteSpace: 'nowrap' }}>{TIER_LABELS[limits.kyc_tier]}</span>
          </div>
          {([
            ['Today (last 24 hours)', limits.daily_used, limits.daily_limit],
            ['This month (last 30 days)', limits.monthly_used, limits.monthly_limit],
          ] as const).map(([label, used, max]) => {
            const pct = Math.min(100, (parseFloat(used) / parseFloat(max)) * 100);
            return (
              <div key={label} style={{ marginBottom: '0.75rem' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.85rem', marginBottom: '0.3rem' }}>
                  <span>{label}</span>
                  <span>{ghs(used)} of {ghs(max)}</span>
                </div>
                <div style={{ height: 6, borderRadius: 999, background: 'var(--border)', overflow: 'hidden' }}>
                  <div style={{ width: `${pct}%`, height: '100%', background: pct >= 100 ? 'var(--danger)' : 'var(--primary)' }} />
                </div>
              </div>
            );
          })}
          <p className="text-muted" style={{ fontSize: '0.8rem' }}>
            Counts money you pay into GlobePay: transfers, vault contributions, cards, cross-border and split-bill shares.
            {limits.kyc_tier === 'unverified' && ' Verify your phone number below to raise your limits.'}
            {limits.kyc_tier === 'phone_verified' && ' Verifying your ID raises them further - contact support.'}
          </p>
        </div>
      )}

      <div className="card" style={{ marginBottom: '1rem' }}>
        <h2 style={{ fontSize: '1.1rem', marginBottom: '0.5rem' }}>Verify phone</h2>
        <p style={{ fontSize: '0.9rem', color: 'var(--text-secondary)', marginBottom: '1rem' }}>
          Confirms this number is yours.
        </p>
        {isPhoneVerified ? (
          <div className="alert alert-success" style={{ marginBottom: 0 }}>Phone verified.</div>
        ) : !codeSent ? (
          <button className="btn btn-primary" onClick={handleRequestPhoneCode} disabled={busy}>
            Send verification code
          </button>
        ) : (
          <form onSubmit={handleConfirmPhone}>
            <div className="form-group">
              <label>Code sent to {user?.phone_number}</label>
              <input value={phoneCode} onChange={(e) => setPhoneCode(e.target.value)} required />
            </div>
            <div className="btn-group">
              <button type="submit" className="btn btn-primary" disabled={busy}>Confirm</button>
              <button type="button" className="btn btn-outline" onClick={handleRequestPhoneCode} disabled={busy}>
                Resend
              </button>
            </div>
          </form>
        )}
      </div>

      <div className="card" style={{ marginBottom: '1rem' }}>
        <h2 style={{ fontSize: '1.1rem', marginBottom: '0.5rem' }}>Default payout (MoMo)</h2>
        <p style={{ fontSize: '0.9rem', color: 'var(--text-secondary)', marginBottom: '1rem' }}>
          Used when claiming transfers and withdrawing from vaults
        </p>
        <form onSubmit={handlePayout}>
          <div className="form-group">
            <label htmlFor="payout-number">Mobile money number</label>
            <input
              id="payout-number"
              required
              inputMode="tel"
              value={payout.momo_number}
              onChange={(e) => setPayout({ ...payout, momo_number: e.target.value })}
            />
          </div>
          <div className="form-group">
            <label htmlFor="payout-network">Network</label>
            <select
              id="payout-network"
              value={payout.momo_bank_code}
              onChange={(e) => setPayout({ ...payout, momo_bank_code: e.target.value })}
            >
              {MOMO_NETWORKS.map((n) => <option key={n.code} value={n.code}>{n.label}</option>)}
            </select>
          </div>
          <div className="form-group">
            <label htmlFor="payout-name">Account name</label>
            <input
              id="payout-name"
              required
              value={payout.account_name}
              onChange={(e) => setPayout({ ...payout, account_name: e.target.value })}
            />
          </div>
          <button type="submit" className="btn btn-primary" disabled={busy}>
            Save payout destination
          </button>
        </form>
      </div>

      <div className="card" style={{ marginBottom: '1rem' }}>
        <h2 style={{ fontSize: '1.1rem', marginBottom: '0.5rem' }}>Round-up savings</h2>
        <p style={{ fontSize: '0.9rem', color: 'var(--text-secondary)', marginBottom: '1rem' }}>
          Round transfers up to the nearest denomination and save the difference into a vault
        </p>
        <form onSubmit={handleRoundUp}>
          <div className="form-group">
            <label>Target vault</label>
            <select value={roundUpVaultId} onChange={(e) => setRoundUpVaultId(e.target.value)}>
              <option value="">Disabled</option>
              {vaults
                .filter((v) => (v.status || '').toLowerCase() === 'active')
                .map((v) => (
                  <option key={v.id} value={v.id}>
                    {v.name}
                  </option>
                ))}
            </select>
          </div>
          <div className="form-group">
            <label>Denomination (GHS)</label>
            <input
              type="number"
              step="0.01"
              min="1"
              value={roundUpDenom}
              onChange={(e) => setRoundUpDenom(e.target.value)}
            />
          </div>
          <button type="submit" className="btn btn-primary" disabled={busy}>
            Save round-up settings
          </button>
        </form>
      </div>

      <div className="card" style={{ marginBottom: '1rem' }}>
        <h2 style={{ fontSize: '1.1rem', marginBottom: '0.5rem' }}>Referrals</h2>
        <p style={{ fontSize: '0.9rem', marginBottom: '0.75rem' }}>
          Your code:{' '}
          <code style={{ background: '#f0fdfa', padding: '0.15rem 0.4rem', borderRadius: 4 }}>
            {user?.referral_code}
          </code>
        </p>
        {referrals.length === 0 ? (
          <p style={{ color: 'var(--text-secondary)', fontSize: '0.9rem' }}>No referrals yet.</p>
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Reward</th>
                  <th>Joined</th>
                </tr>
              </thead>
              <tbody>
                {referrals.map((r, i) => (
                  <tr key={i}>
                    <td>{r.full_name}</td>
                    <td>
                      <span className="badge badge-pending">{r.referral_reward_status}</span>
                    </td>
                    <td>{new Date(r.created_at).toLocaleDateString()}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div className="card" style={{ marginBottom: '1rem' }}>
        <h2 style={{ fontSize: '1.1rem', marginBottom: '0.75rem' }}>Account</h2>
        <div style={{ fontSize: '0.95rem' }}>
          <div style={{ marginBottom: '0.35rem' }}>
            <strong>Name:</strong> {user?.full_name}
          </div>
          <div style={{ marginBottom: '0.35rem' }}>
            <strong>Phone:</strong> {user?.phone_number}
          </div>
          {user?.email && (
            <div style={{ marginBottom: '0.35rem' }}>
              <strong>Email:</strong> {user.email}
            </div>
          )}
        </div>
      </div>

      <div className="card" style={{ borderColor: '#fecaca' }}>
        <h2 style={{ fontSize: '1.1rem', marginBottom: '0.5rem', color: 'var(--danger)' }}>
          Close account
        </h2>
        <p style={{ fontSize: '0.9rem', color: 'var(--text-secondary)', marginBottom: '1rem' }}>
          Permanently closes your account. Requires your password.
        </p>
        {!showClose ? (
          <button className="btn btn-danger" onClick={() => setShowClose(true)}>
            Close my account
          </button>
        ) : (
          <form onSubmit={handleCloseAccount}>
            <div className="form-group">
              <label>Confirm with password</label>
              <input
                type="password"
                required
                value={closePassword}
                onChange={(e) => setClosePassword(e.target.value)}
              />
            </div>
            <div className="btn-group">
              <button type="submit" className="btn btn-danger" disabled={busy}>
                {busy ? 'Closing…' : 'Confirm close account'}
              </button>
              <button type="button" className="btn btn-outline" onClick={() => setShowClose(false)}>
                Cancel
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
