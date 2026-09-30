export interface User {
  id: string;
  phone_number: string;
  full_name: string;
  email: string | null;
  is_phone_verified: boolean;
  kyc_tier?: 'unverified' | 'phone_verified' | 'id_verified';
  referral_code: string;
  referral_reward_status: string;
  default_momo_number: string | null;
  default_momo_bank_code: string | null;
  default_account_name?: string | null;
  round_up_vault_id: string | null;
  round_up_denomination: string;
  has_saved_card?: boolean; // a reusable card from an earlier card payment - needed for auto-contribute
  paystack_card_last4?: string | null;
}

export interface Token {
  access_token: string;
  token_type: string;
}

export interface WalletSummary {
  received_total: string;
  sent_total: string;
  fee_total: string;
  roundup_total: string;
  net_flow: string;
}

export interface Transfer {
  id: string;
  sender_id: string;
  recipient_id: string;
  gross_amount: string;
  platform_fee: string;
  net_amount: string;
  note: string | null;
  roundup_amount: string;
  status: string;
  created_at: string;
  completed_at: string | null;
  // Relative to the signed-in user (set by the backend).
  direction?: 'sent' | 'received' | null;
  counterparty_name?: string | null;
  counterparty_phone?: string | null; // masked
  pay_url?: string | null; // sender of an unpaid transfer: reopen its checkout
}

export interface TransferQuote {
  recipient_name: string;
  recipient_phone: string;
  amount: string;
  platform_fee: string;
  recipient_gets: string;
  roundup_amount: string;
  total_charge: string;
}

export interface Vault {
  id: string;
  name: string;
  target_amount: string;
  contribution_amount: string;
  frequency: string;
  balance: string;
  lock_until: string;
  status: string;
  recurring_status: string;
  next_charge_date: string | null;
  recurring_consecutive_failures: number;
  recurring_last_failure_reason: string | null;
  last_withdrawal_status?: 'pending' | 'completed' | 'failed' | null; // latest payout's real state
  withdrawal_fee?: string | null; // platform fee on withdrawing the whole balance now
  withdrawal_net?: string | null; // what that withdrawal would actually send
  created_at: string;
}

export interface Card {
  id: string;
  status: string;
  masked_pan: string | null;
  card_brand: string | null;
  balance: string;
  currency: string;
  failure_reason: string | null;
  retry_count: number;
  refund_reference: string | null;
  refunded_at: string | null;
  initial_funding_ghs?: string | null;
  fee_ghs?: string | null; // Bitnob's creation fees, passed on to the user
  // Bitnob's decline rule: 3 declined payments (low balance / frozen card) close the card.
  decline_strikes?: number;
  decline_fees_usd?: string; // $0.75 for the 2nd and 3rd - taken from the payout when the card closes
  last_decline_at?: string | null;
  // Leftover balance paid to the owner's mobile money after termination.
  termination_refund_usd?: string | null;
  termination_payout_ghs?: string | null;
  termination_payout_status?: 'not_started' | 'not_needed' | 'pending' | 'completed' | 'failed';
  created_at: string;
  updated_at: string;
}

export interface CrossBorderTransfer {
  id: string;
  source_amount: string;
  destination_country: string;
  destination_currency: string;
  destination_amount: string | null;
  exchange_rate_used: string | null;
  beneficiary_bank?: string | null;
  status: string;
  bitnob_status: string | null;
  failure_reason: string | null;
  retry_count: number;
  refund_reference: string | null;
  refunded_at: string | null;
  created_at: string;
  completed_at: string | null;
  destination_type: string | null;
  beneficiary_name: string | null;
  beneficiary_account: string | null; // masked, e.g. "•••• 3000"
}

// Bitnob payout corridors - see backend crossborder/corridors.py.
export interface PayoutCorridorCountry {
  code: string;
  name: string;
  flag?: string;
  corridors: { currency: string; destination_types: string[] }[];
}

// GET /crossborder/corridors/{country}/limits - min/max in the destination
// currency, plus the approximate GHS to type (null if no rate was available).
export interface PayoutAmountLimits {
  currency: string;
  min_amount: number | string | null;
  max_amount: number | string | null;
  min_ghs: number | string | null;
  max_ghs: number | string | null;
}

export interface PayoutField {
  key: string;
  label: string;
  component: string; // text | select | country_select | date | fieldset | variant_fieldset
  required?: boolean;
  pattern?: string;
  min_length?: number;
  max_length?: number;
  placeholder?: string;
  hidden?: boolean;
  options?: { label: string; value: string }[];
  fields?: PayoutField[];
  variant_key?: string;
  variants?: Record<string, PayoutField[] | { fields: PayoutField[] }>;
}

export interface PayoutDestinationType {
  key: string;
  label: string;
  fields: PayoutField[];
  banks?: { code: string; name: string }[];
  limits?: { min_amount?: string; max_amount?: string; currency?: string };
}

export interface PayoutRequirements {
  code: string;
  name: string;
  destination_types: Record<string, PayoutDestinationType>;
}

export interface SplitBill {
  id: string;
  organizer_id: string;
  title: string;
  total_amount: string;
  status: string;
  created_at: string;
  shares: {
    id: string;
    split_bill_id?: string;
    user_id: string;
    gross_amount: string;
    status: string;
    payout_status?: string;
    created_at: string;
    paid_at: string | null;
    participant_name?: string | null;
    is_organizer?: boolean; // the organizer's own, already-covered portion
  }[];
  // true: paid shares are held on the bill until the organizer withdraws.
  // false: an older bill that paid each share out as it came in.
  collects_funds?: boolean;
  collected_gross_amount?: string | null; // organizer only - what was paid; a vault withdrawal gets all of it (no fee)
  collected_amount?: string | null; // organizer only - what a mobile money withdrawal gets, after the platform fee
  withdrawal?: SplitWithdrawal | null; // organizer only
}

export interface SplitWithdrawal {
  id: string;
  destination: 'momo' | 'vault';
  vault_id: string | null;
  vault_name: string | null;
  amount: string; // what the organizer receives
  fee: string; // platform fee taken - "0.00" for a vault
  status: 'pending' | 'completed' | 'failed';
  failure_reason: string | null;
  attempts: number;
  updated_at: string;
}

export interface AuthUrlResponse {
  authorization_url: string;
  reference: string;
  transfer_id?: string | null; // wallet transfers only
}
