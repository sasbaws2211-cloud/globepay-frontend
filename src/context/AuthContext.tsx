import React, { createContext, useContext, useEffect, useState, useCallback } from 'react';
import { login as apiLogin, register as apiRegister, getMe } from '../api/services';
import type { User } from '../api/types';
import { getErrorMessage } from '../api/client';

interface AuthContextValue {
  user: User | null;
  token: string | null;
  loading: boolean;
  error: string | null;
  login: (phone: string, password: string) => Promise<void>;
  register: (data: {
    phone_number: string;
    full_name: string;
    email?: string;
    password: string;
    referral_code?: string;
  }) => Promise<void>;
  logout: () => void;
  refreshUser: () => Promise<void>;
  clearError: () => void;
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [token, setToken] = useState<string | null>(() => localStorage.getItem('globepay_token'));
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refreshUser = useCallback(async () => {
    if (!localStorage.getItem('globepay_token')) {
      setUser(null);
      setLoading(false);
      return;
    }
    try {
      const me = await getMe();
      setUser(me);
      setError(null);
    } catch (err) {
      localStorage.removeItem('globepay_token');
      setToken(null);
      setUser(null);
      setError(getErrorMessage(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refreshUser();
  }, [refreshUser]);

  const login = async (phone: string, password: string) => {
    setLoading(true);
    setError(null);
    try {
      const { access_token } = await apiLogin(phone, password);
      localStorage.setItem('globepay_token', access_token);
      setToken(access_token);
      const me = await getMe();
      setUser(me);
    } catch (err) {
      setError(getErrorMessage(err));
      throw err;
    } finally {
      setLoading(false);
    }
  };

  const register = async (data: {
    phone_number: string;
    full_name: string;
    email?: string;
    password: string;
    referral_code?: string;
  }) => {
    setLoading(true);
    setError(null);
    try {
      await apiRegister(data);
      // Auto-login after register
      await login(data.phone_number, data.password);
    } catch (err) {
      setError(getErrorMessage(err));
      setLoading(false);
      throw err;
    }
  };

  const logout = () => {
    localStorage.removeItem('globepay_token');
    setToken(null);
    setUser(null);
    setError(null);
  };

  const clearError = () => setError(null);

  return (
    <AuthContext.Provider
      value={{ user, token, loading, error, login, register, logout, refreshUser, clearError }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
