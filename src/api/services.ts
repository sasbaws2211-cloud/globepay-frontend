import api, { generateIdempotencyKey } from './client';
import type {
  User,
  Token,
  WalletSummary,
  Transfer,
  TransferQuote,
  Vault,
  Card,
  CrossBorderTransfer,
  PayoutAmountLimits,
  PayoutCorridorCountry,
  PayoutRequirements,
  SplitBill,
  AuthUrlResponse,
} from './types';

// ─── Auth ───────────────────────────────────────────────────────────────────
export async function register(data: {
  phone_number: string;
  full_name: string;
  email?: string;
  password: string;
  referral_code?: string;
}): Promise<User> {
  const res = await api.post<User>('/auth/register', data);
  return res.data;
}

export async function login(phone_number: string, password: string): Promise<Token> {
  const res = await api.post<Token>('/auth/login', { phone_number, password });
  return res.data;
}

export async function getMe(): Promise<User> {
  const res = await api.get<User>('/auth/me');
  return res.data;
}

// Verification tier and how much of its daily/monthly limit is used
// (confirmed payments in, plus checkouts started in the last 30 minutes).
export interface TransactionLimits {
  kyc_tier: 'unverified' | 'phone_verified' | 'id_verified';
  daily_limit: string;
  daily_used: string;
  daily_remaining: string;
  monthly_limit: string;
  monthly_used: string;
  monthly_remaining: string;
}

export async function getMyLimits(): Promise<TransactionLimits> {
  const res = await api.get<TransactionLimits>('/auth/me/limits');
  return res.data;
}

// ─── Wallet ─────────────────────────────────────────────────────────────────
export async function getWalletSummary(): Promise<WalletSummary> {
  const res = await api.get<WalletSummary>('/wallet/summary');
  return res.data;
}

export async function getTransfers(): Promise<Transfer[]> {
  const res = await api.get<Transfer[]>('/wallet/transfers');
  return res.data;
}

export async function sendMoney(payload: {
  recipient_phone_number: string;
  amount: number | string;
  note?: string;
  sender_email: string;
}, idempotencyKey?: string): Promise<AuthUrlResponse> {
  const res = await api.post<AuthUrlResponse>('/wallet/transfers', payload, {
    headers: { 'Idempotency-Key': idempotencyKey || generateIdempotencyKey() },
  });
  return res.data;
}

/** Review step before paying: recipient, fee, what they get, round-up and total. Creates nothing. */
export async function quoteTransfer(payload: { recipient_phone_number: string; amount: string }): Promise<TransferQuote> {
  const res = await api.post<TransferQuote>('/wallet/transfers/quote', payload);
  return res.data;
}

/** Asks the backend to check Paystack for this transfer's payment/payout and
 * returns its (possibly updated) state - polled while a transfer is in flight. */
export async function refreshTransfer(transferId: string): Promise<Transfer> {
  const res = await api.post<Transfer>(`/wallet/transfers/${transferId}/refresh`);
  return res.data;
}

export interface PaymentRefresh {
  kind: 'vault_contribution' | 'splitbill_share' | 'crossborder_transfer' | 'card_creation';
  status: string;
  pending: boolean;
}

/** Same idea as refreshTransfer, for every other kind of checkout, looked up by its payment reference. */
export async function refreshPayment(reference: string): Promise<PaymentRefresh> {
  const res = await api.post<PaymentRefresh>(`/payments/${encodeURIComponent(reference)}/refresh`);
  return res.data;
}

export async function getPendingClaims(): Promise<Transfer[]> {
  const res = await api.get<Transfer[]>('/wallet/transfers/pending-claim');
  return res.data;
}

export async function claimTransfer(
  transferId: string,
  payload: {
    momo_number: string;
    momo_bank_code: string;
    account_name: string;
    save_as_default?: boolean;
  }
): Promise<Transfer> {
  const res = await api.post<Transfer>(`/wallet/transfers/${transferId}/claim`, payload);
  return res.data;
}

// ─── Vaults ─────────────────────────────────────────────────────────────────
export async function getVaults(): Promise<Vault[]> {
  const res = await api.get<Vault[]>('/vaults');
  return res.data;
}

export async function createVault(payload: {
  name: string;
  target_amount: number | string;
  contribution_amount: number | string;
  frequency: string;
  lock_until: string;
}): Promise<Vault> {
  const res = await api.post<Vault>('/vaults', payload);
  return res.data;
}

export async function contributeToVault(
  vaultId: string,
  amount: number | string,
  email: string
): Promise<AuthUrlResponse> {
  const res = await api.post<AuthUrlResponse>(
    `/vaults/${vaultId}/contribute`,
    { amount, email },
    { headers: { 'Idempotency-Key': generateIdempotencyKey() } }
  );
  return res.data;
}

export async function withdrawFromVault(
  vaultId: string,
  payload: {
    momo_number: string;
    momo_network_bank_code: string;
    account_name: string;
  }
): Promise<unknown> {
  const res = await api.post(`/vaults/${vaultId}/withdraw`, payload);
  return res.data;
}

export async function cancelVault(vaultId: string): Promise<Vault> {
  const res = await api.post<Vault>(`/vaults/${vaultId}/cancel`);
  return res.data;
}

// ─── Cards ──────────────────────────────────────────────────────────────────
export interface CardLimits {
  card_type: string; // "lite" - the only card type GlobePay issues
  can_top_up: boolean; // false for lite cards: loaded once, at creation
  min_load_ghs: string;
  max_load_ghs: string;
  min_load_usd: string;
  max_load_usd: string;
  max_cards_per_phone: number;
  creation_fee_usd: string;
  ghs_per_usd: string; // also what a terminated card's leftover balance is paid back at
  fees: { creation_usd: string; funding_flat_usd: string; funding_flat_below_usd: string; funding_percent: string };
}

// Price of a new card before paying: on the card + Bitnob's fees (passed on) = total.
export interface CardQuote {
  amount_ghs: string;
  amount_usd: string;
  fee_ghs: string;
  fee_usd: string;
  total_ghs: string;
}

export async function getCardQuote(amount_ghs: string): Promise<CardQuote> {
  const res = await api.get<CardQuote>('/cards/quote', { params: { amount_ghs } });
  return res.data;
}

export async function retryTerminationPayout(cardId: string): Promise<Card> {
  const res = await api.post<Card>(`/cards/${cardId}/termination-payout/retry`);
  return res.data;
}

export async function getCardLimits(): Promise<CardLimits> {
  const res = await api.get<CardLimits>('/cards/limits');
  return res.data;
}

export async function getCards(): Promise<Card[]> {
  const res = await api.get<Card[]>('/cards');
  return res.data;
}

export async function createCard(payload: {
  initial_funding_ghs: number | string; // what goes on the card - Bitnob's fees are added on top
  sender_email: string;
  dial_code: string; // Bitnob keys lite-card customers by phone
  local_phone_number: string;
}): Promise<AuthUrlResponse> {
  const res = await api.post<AuthUrlResponse>('/cards', payload, {
    headers: { 'Idempotency-Key': generateIdempotencyKey() },
  });
  return res.data;
}

// Full number / expiry / CVV for the owner, after re-entering their password.
// Keep the result in component state only - never in storage or logs.
export interface CardDetails {
  card_number: string;
  cvv: string;
  expiry_month: string;
  expiry_year: string;
  name: string | null;
  card_brand: string | null;
  billing_address: {
    line1?: string | null;
    line2?: string | null;
    city?: string | null;
    state?: string | null;
    postal_code?: string | null;
    country?: string | null;
  } | null;
}

export async function revealCardDetails(cardId: string, password: string): Promise<CardDetails> {
  const res = await api.post<CardDetails>(`/cards/${cardId}/details`, { password });
  return res.data;
}

export async function freezeCard(cardId: string): Promise<Card> {
  const res = await api.post<Card>(`/cards/${cardId}/freeze`);
  return res.data;
}

export async function unfreezeCard(cardId: string): Promise<Card> {
  const res = await api.post<Card>(`/cards/${cardId}/unfreeze`);
  return res.data;
}

// ─── Cross-border ───────────────────────────────────────────────────────────
export async function getCrossBorderTransfers(): Promise<CrossBorderTransfer[]> {
  const res = await api.get<CrossBorderTransfer[]>('/crossborder/transfers');
  return res.data;
}

export async function getPayoutCorridors(): Promise<PayoutCorridorCountry[]> {
  const res = await api.get<PayoutCorridorCountry[]>('/crossborder/corridors');
  return res.data;
}

export async function getPayoutRequirements(country: string): Promise<PayoutRequirements> {
  const res = await api.get<PayoutRequirements>(`/crossborder/corridors/${country}`);
  return res.data;
}

export async function getPayoutAmountLimits(
  country: string,
  currency: string,
  destinationType: string
): Promise<PayoutAmountLimits> {
  const res = await api.get<PayoutAmountLimits>(`/crossborder/corridors/${country}/limits`, {
    params: { currency, destination_type: destinationType },
  });
  return res.data;
}

export async function getSenderProfile(): Promise<Record<string, string> | null> {
  const res = await api.get<{ sender: Record<string, string> | null }>('/crossborder/sender-profile');
  return res.data.sender;
}

export async function createCrossBorderTransfer(payload: {
  source_amount: number | string;
  destination_country: string;
  destination_currency: string;
  destination_type: string;
  // Fields exactly as Bitnob's requirements for destination_type define them.
  beneficiary: Record<string, unknown>;
  sender_email: string;
  save_sender_profile?: boolean;
}): Promise<AuthUrlResponse> {
  const res = await api.post<AuthUrlResponse>('/crossborder/transfers', payload, {
    headers: { 'Idempotency-Key': generateIdempotencyKey() },
  });
  return res.data;
}

// ─── Split bills ────────────────────────────────────────────────────────────
export async function getSplitBills(): Promise<SplitBill[]> {
  // Backend may expose list via organizer; we try common path
  try {
    const res = await api.get<SplitBill[]>('/splits');
    return res.data;
  } catch {
    return [];
  }
}

export async function createSplitBill(payload: {
  title: string;
  total_amount: number | string;
  participant_phone_numbers: string[];
}): Promise<SplitBill> {
  const res = await api.post<SplitBill>('/splits', payload);
  return res.data;
}

// ─── Auth / KYC ─────────────────────────────────────────────────────────────
export async function requestPhoneVerification(): Promise<{ message: string }> {
  const res = await api.post<{ message: string }>('/auth/verify-phone/request');
  return res.data;
}

export async function confirmPhoneVerification(code: string): Promise<User> {
  const res = await api.post<User>('/auth/verify-phone/confirm', { code });
  return res.data;
}

// ─── Vault recurring ────────────────────────────────────────────────────────
export async function enableRecurring(vaultId: string): Promise<Vault> {
  const res = await api.post<Vault>(`/vaults/${vaultId}/recurring/enable`);
  return res.data;
}

export async function pauseRecurring(vaultId: string): Promise<Vault> {
  const res = await api.post<Vault>(`/vaults/${vaultId}/recurring/pause`);
  return res.data;
}

export async function resumeRecurring(vaultId: string): Promise<Vault> {
  const res = await api.post<Vault>(`/vaults/${vaultId}/recurring/resume`);
  return res.data;
}

export async function cancelRecurring(vaultId: string): Promise<Vault> {
  const res = await api.post<Vault>(`/vaults/${vaultId}/recurring/cancel`);
  return res.data;
}

// ─── Card terminate ─────────────────────────────────────────────────────────
export async function terminateCard(cardId: string, reason: string): Promise<Card> {
  const res = await api.post<Card>(`/cards/${cardId}/terminate`, { reason });
  return res.data;
}

// ─── Password reset ─────────────────────────────────────────────────────────
export async function requestPasswordReset(phone_number: string): Promise<{ message: string }> {
  const res = await api.post<{ message: string }>('/auth/password-reset/request', { phone_number });
  return res.data;
}

export async function confirmPasswordReset(payload: {
  phone_number: string;
  code: string;
  new_password: string;
}): Promise<Token> {
  const res = await api.post<Token>('/auth/password-reset/confirm', payload);
  return res.data;
}

// ─── Account settings ───────────────────────────────────────────────────────
export async function closeAccount(password: string): Promise<void> {
  await api.post('/auth/me/close-account', { password });
}

export async function setPayoutDestination(payload: {
  momo_number: string;
  momo_bank_code: string;
  account_name: string;
}): Promise<User> {
  const res = await api.put<User>('/auth/me/payout-destination', payload);
  return res.data;
}

export async function setRoundUpSettings(payload: {
  vault_id: string | null;
  denomination?: number | string;
}): Promise<User> {
  const res = await api.put<User>('/auth/me/round-up-settings', payload);
  return res.data;
}

export async function getReferrals(): Promise<
  { full_name: string; referral_reward_status: string; created_at: string }[]
> {
  const res = await api.get('/auth/me/referrals');
  return res.data;
}

// ─── Vault statement ────────────────────────────────────────────────────────
export async function downloadVaultStatement(vaultId: string, vaultName: string): Promise<void> {
  const res = await api.get(`/vaults/${vaultId}/statement`, { responseType: 'blob' });
  const url = window.URL.createObjectURL(new Blob([res.data], { type: 'text/csv' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = `${vaultName || 'vault'}-statement.csv`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  window.URL.revokeObjectURL(url);
}

// ─── Card retry / refund ────────────────────────────────────────────────────
export async function retryCardCreation(cardId: string): Promise<Card> {
  const res = await api.post<Card>(`/cards/${cardId}/retry`);
  return res.data;
}

export async function refundCardCreation(cardId: string): Promise<Card> {
  const res = await api.post<Card>(`/cards/${cardId}/refund`);
  return res.data;
}

// ─── Admin ──────────────────────────────────────────────────────────────────
export interface PlatformStats {
  total_users: number;
  total_vaults: number;
  total_vault_balance: string;
  total_fees_collected: string;
  stuck_transaction_count: number;
}

export interface AdminUserSummary {
  id: string;
  phone_number: string;
  full_name: string;
  email: string | null;
  is_active: boolean;
  is_admin: boolean;
  created_at: string;
}

export interface StuckTransaction {
  kind: string;
  id: string;
  user_id: string;
  user_phone: string;
  amount: string;
  status: string;
  failure_reason: string | null;
  retry_count: number;
  created_at: string;
}

export interface AuditLogEntry {
  id: string;
  admin_user_id: string;
  admin_name: string;
  action: string;
  target_type: string;
  target_id: string;
  details: Record<string, unknown> | null;
  created_at: string;
}

export async function getAdminStats(): Promise<PlatformStats> {
  const res = await api.get<PlatformStats>('/admin/stats');
  return res.data;
}

export async function getAdminUsers(q?: string): Promise<AdminUserSummary[]> {
  const res = await api.get<AdminUserSummary[]>('/admin/users', { params: q ? { q } : {} });
  return res.data;
}

export async function setAdminUserStatus(userId: string, is_active: boolean): Promise<AdminUserSummary> {
  const res = await api.patch<AdminUserSummary>(`/admin/users/${userId}/status`, { is_active });
  return res.data;
}


export async function getStuckTransactions(): Promise<StuckTransaction[]> {
  const res = await api.get<StuckTransaction[]>('/admin/stuck-transactions');
  return res.data;
}

export async function getAuditLog(): Promise<AuditLogEntry[]> {
  const res = await api.get<AuditLogEntry[]>('/admin/audit-log');
  return res.data;
}

export async function adminRetryCrossBorder(transferId: string): Promise<unknown> {
  const res = await api.post(`/admin/crossborder/transfers/${transferId}/retry`);
  return res.data;
}

export async function adminRefundCrossBorder(transferId: string): Promise<unknown> {
  const res = await api.post(`/admin/crossborder/transfers/${transferId}/refund`);
  return res.data;
}

export async function adminRetryCard(cardId: string): Promise<Card> {
  const res = await api.post<Card>(`/admin/cards/${cardId}/retry`);
  return res.data;
}

export async function adminRefundCard(cardId: string): Promise<Card> {
  const res = await api.post<Card>(`/admin/cards/${cardId}/refund`);
  return res.data;
}

// ─── Splits (full) ──────────────────────────────────────────────────────────
export async function getPendingShares(): Promise<
  {
    id: string;
    split_bill_id: string;
    user_id: string;
    gross_amount: string;
    status: string;
    created_at: string;
    paid_at: string | null;
  }[]
> {
  const res = await api.get('/splits/pending/me');
  return res.data;
}

export async function getSplitBill(splitBillId: string): Promise<SplitBill> {
  const res = await api.get<SplitBill>(`/splits/${splitBillId}`);
  return res.data;
}

export async function cancelSplitBill(splitBillId: string): Promise<SplitBill> {
  const res = await api.post<SplitBill>(`/splits/${splitBillId}/cancel`);
  return res.data;
}

// Stop collecting: drop what's still owed and make the collected money withdrawable.
export async function closeSplitBill(splitBillId: string): Promise<SplitBill> {
  const res = await api.post<SplitBill>(`/splits/${splitBillId}/close`);
  return res.data;
}

// Withdraw a settled bill's money (also retries a failed withdrawal).
export async function withdrawSplitBill(
  splitBillId: string,
  payload: { destination: 'momo' | 'vault'; vault_id?: string }
): Promise<SplitBill> {
  const res = await api.post<SplitBill>(`/splits/${splitBillId}/withdraw`, payload);
  return res.data;
}

export async function retrySplitSharePayout(splitBillId: string, shareId: string) {
  const res = await api.post(`/splits/${splitBillId}/shares/${shareId}/retry-payout`);
  return res.data;
}

export async function paySplitShare(
  splitBillId: string,
  email: string
): Promise<AuthUrlResponse> {
  const res = await api.post<AuthUrlResponse>(
    `/splits/${splitBillId}/pay`,
    { email },
    { headers: { 'Idempotency-Key': generateIdempotencyKey() } }
  );
  return res.data;
}

// ─── Cross-border user retry/refund ─────────────────────────────────────────
export async function retryCrossBorderTransfer(transferId: string): Promise<CrossBorderTransfer> {
  const res = await api.post<CrossBorderTransfer>(`/crossborder/transfers/${transferId}/retry`);
  return res.data;
}

export async function refundCrossBorderTransfer(transferId: string): Promise<CrossBorderTransfer> {
  const res = await api.post<CrossBorderTransfer>(`/crossborder/transfers/${transferId}/refund`);
  return res.data;
}

export async function getCrossBorderTransfer(transferId: string): Promise<CrossBorderTransfer> {
  const res = await api.get<CrossBorderTransfer>(`/crossborder/transfers/${transferId}`);
  return res.data;
}

// ─── Card transaction history ───────────────────────────────────────────────
export interface CardTransaction {
  id: string;
  card_id: string;
  kind: string;
  direction: string;
  amount: string | null;
  currency: string;
  amount_ghs: string | null;
  amount_usd: string | null;
  status: string;
  description: string;
  merchant_name: string | null;
  reference: string | null;
  source: string;
  created_at: string;
}

export async function getCardTransactions(cardId: string): Promise<CardTransaction[]> {
  const res = await api.get<CardTransaction[]>(`/cards/${cardId}/transactions`);
  return res.data;
}

