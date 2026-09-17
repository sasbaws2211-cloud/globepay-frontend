import React, { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';

export default function Register() {
  const { register, error, clearError, loading } = useAuth();
  const navigate = useNavigate();
  const [form, setForm] = useState({
    phone_number: '',
    full_name: '',
    email: '',
    password: '',
    referral_code: '',
  });

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setForm((prev) => ({ ...prev, [e.target.name]: e.target.value }));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    clearError();
    try {
      await register({
        phone_number: form.phone_number.trim(),
        full_name: form.full_name.trim(),
        email: form.email.trim() || undefined,
        password: form.password,
        referral_code: form.referral_code.trim() || undefined,
      });
      navigate('/');
    } catch {
      // handled
    }
  };

  return (
    <div className="auth-page">
      <div className="auth-card">
        <h1>Create account</h1>
        <p className="subtitle">Join GlobePay – wallet, vaults & more</p>

        {error && <div className="alert alert-error">{error}</div>}

        <form onSubmit={handleSubmit}>
          <div className="form-group">
            <label>Full name</label>
            <input name="full_name" value={form.full_name} onChange={handleChange} required />
          </div>
          <div className="form-group">
            <label>Phone number</label>
            <input
              name="phone_number"
              type="tel"
              placeholder="e.g. 0244123456"
              value={form.phone_number}
              onChange={handleChange}
              required
            />
          </div>
          <div className="form-group">
            <label>Email (optional)</label>
            <input name="email" type="email" value={form.email} onChange={handleChange} />
          </div>
          <div className="form-group">
            <label>Password</label>
            <input
              name="password"
              type="password"
              value={form.password}
              onChange={handleChange}
              required
              minLength={8}
            />
          </div>
          <div className="form-group">
            <label>Referral code (optional)</label>
            <input name="referral_code" value={form.referral_code} onChange={handleChange} />
          </div>
          <button type="submit" className="btn btn-primary" style={{ width: '100%' }} disabled={loading}>
            {loading ? 'Creating…' : 'Create account'}
          </button>
        </form>

        <p className="auth-switch">
          Already have an account? <Link to="/login">Sign in</Link>
        </p>
      </div>
    </div>
  );
}
