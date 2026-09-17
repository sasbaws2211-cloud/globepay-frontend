import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import {
  requestPhoneVerification,
  confirmPhoneVerification,
  submitKycId,
  setPayoutDestination,
  setRoundUpSettings,
  closeAccount,
  getReferrals,
  getVaults,
} from '../api/services';
import type { Vault } from '../api/types';
import { getErrorMessage } from '../api/client';

const TIER_LIMITS: Record<string, { daily: string; monthly: string; label: string }> = {
  unverified: { daily: '500', monthly: '2,000', label: 'Unverified' },
  phone_verified: { daily: '5,000', monthly: '20,000', label: 'Phone verified' },
  id_verified: { daily: '20,000', monthly: '100,000', label: 'ID verified' },
};

function normalizeTier(tier: string | undefined): string {
  return (tier || 'unverified').toLowerCase();
}

export default function Settings() {
  const { user, refreshUser, logout } = useAuth();
  const navigate = useNavigate();
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [busy, setBusy] = useState(false);

  const [phoneCode, setPhoneCode] = useState('');
  const [codeSent, setCodeSent] = useState(false);
  const [ghanaCard, setGhanaCard] = useState('');

  const [payout, setPayout] = useState({
    momo_number: user?.default_momo_number || '',
    momo_bank_code: user?.default_momo_bank_code || 'MTN',
    account_name: user?.full_name || '',
  });

  const [vaults, setVaults] = useState<Vault[]>([]);
  const [roundUpVaultId, setRoundUpVaultId] = useState(user?.round_up_vault_id || '');
  const [roundUpDenom, setRoundUpDenom] = useState(user?.round_up_denomination || '5.00');

  const [referrals, setReferrals] = useState<
    { full_name: string; referral_reward_status: string; created_at: string }[]
  >([]);

  const [closePassword, setClosePassword] = useState('');
  const [showClose, setShowClose] = useState(false);

  const tierKey = normalizeTier(user?.kyc_tier);
  const limits = TIER_LIMITS[tierKey] || TIER_LIMITS.unverified;
  const isPhoneVerified = user?.is_phone_verified;
  const kycStatus = (user?.kyc_status || 'none').toLowerCase();

  useEffect(() => {
    setPayout({
      momo_number: user?.default_momo_number || '',
      momo_bank_code: user?.default_momo_bank_code || 'MTN',
      account_name: user?.full_name || '',
    });
    setRoundUpVaultId(user?.round_up_vault_id || '');
    setRoundUpDenom(user?.round_up_denomination || '5.00');
  }, [user]);

  useEffect(() => {
    getVaults().then(setVaults).catch(() => setVaults([]));
    getReferrals().then(setReferrals).catch(() => setReferrals([]));
  }, []);

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
    }, 'Phone verified. Limits raised.');
  };

  const handleSubmitId = (e: React.FormEvent) => {
    e.preventDefault();
    run(async () => {
      await submitKycId(ghanaCard.trim());
      await refreshUser();
      setGhanaCard('');
    }, 'Ghana Card submitted for verification.');
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
            Verification, payouts, round-ups, and account
          </p>
        </div>
      </div>

      {error && <div className="alert alert-error">{error}</div>}
      {success && <div className="alert alert-success">{success}</div>}

      <div className="card" style={{ marginBottom: '1rem' }}>
        <h2 style={{ fontSize: '1.1rem', marginBottom: '1rem' }}>Verification status</h2>
        <div className="grid grid-3">
          <div className="stat-card">
            <div className="stat-label">KYC tier</div>
            <div className="stat-value" style={{ fontSize: '1.15rem' }}>{limits.label}</div>
          </div>
          <div className="stat-card">
            <div className="stat-label">Daily limit</div>
            <div className="stat-value" style={{ fontSize: '1.15rem' }}>GHS {limits.daily}</div>
          </div>
          <div className="stat-card">
            <div className="stat-label">Monthly limit</div>
            <div className="stat-value" style={{ fontSize: '1.15rem' }}>GHS {limits.monthly}</div>
          </div>
        </div>
        <div style={{ marginTop: '1rem', fontSize: '0.9rem', color: 'var(--text-secondary)' }}>
          Phone:{' '}
          {isPhoneVerified ? (
            <span className="badge badge-success">Verified</span>
          ) : (
            <span className="badge badge-pending">Not verified</span>
          )}
          <span style={{ marginLeft: '1rem' }}>
            ID:{' '}
            <span
              className={`badge badge-${
                kycStatus === 'approved' || kycStatus === 'verified'
                  ? 'success'
                  : kycStatus === 'rejected'
                  ? 'failed'
                  : 'pending'
              }`}
            >
              {user?.kyc_status || 'none'}
            </span>
            {user?.kyc_rejection_reason && (
              <span style={{ marginLeft: '0.5rem', color: 'var(--danger)' }}>
                — {user.kyc_rejection_reason}
              </span>
            )}
          </span>
        </div>
      </div>

      <div className="card" style={{ marginBottom: '1rem' }}>
        <h2 style={{ fontSize: '1.1rem', marginBottom: '0.5rem' }}>1. Verify phone</h2>
        <p style={{ fontSize: '0.9rem', color: 'var(--text-secondary)', marginBottom: '1rem' }}>
          Raises limits to GHS 5,000 / day · GHS 20,000 / month
        </p>
        {isPhoneVerified ? (
          <div className="alert alert-success" style={{ marginBottom: 0 }}>Phone already verified.</div>
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
        <h2 style={{ fontSize: '1.1rem', marginBottom: '0.5rem' }}>2. Submit Ghana Card</h2>
        <p style={{ fontSize: '0.9rem', color: 'var(--text-secondary)', marginBottom: '1rem' }}>
          After approval: GHS 20,000 / day · GHS 100,000 / month
        </p>
        {tierKey === 'id_verified' || kycStatus === 'approved' || kycStatus === 'verified' ? (
          <div className="alert alert-success" style={{ marginBottom: 0 }}>ID verified.</div>
        ) : kycStatus === 'pending' || kycStatus === 'submitted' ? (
          <div className="alert alert-info" style={{ marginBottom: 0 }}>Under review.</div>
        ) : (
          <form onSubmit={handleSubmitId}>
            <div className="form-group">
              <label>Ghana Card number</label>
              <input
                value={ghanaCard}
                onChange={(e) => setGhanaCard(e.target.value)}
                placeholder="GHA-XXXXXXXXX-X"
                required
              />
            </div>
            <button type="submit" className="btn btn-primary" disabled={busy || !isPhoneVerified}>
              Submit for verification
            </button>
            {!isPhoneVerified && (
              <p style={{ marginTop: '0.5rem', fontSize: '0.85rem', color: 'var(--warning)' }}>
                Verify phone first.
              </p>
            )}
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
            <label>Mobile money number</label>
            <input
              required
              value={payout.momo_number}
              onChange={(e) => setPayout({ ...payout, momo_number: e.target.value })}
            />
          </div>
          <div className="form-group">
            <label>Network</label>
            <select
              value={payout.momo_bank_code}
              onChange={(e) => setPayout({ ...payout, momo_bank_code: e.target.value })}
            >
              <option value="MTN">MTN</option>
              <option value="ATL">AirtelTigo</option>
              <option value="VOD">Vodafone</option>
            </select>
          </div>
          <div className="form-group">
            <label>Account name</label>
            <input
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
