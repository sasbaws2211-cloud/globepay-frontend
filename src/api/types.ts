export interface User {
  id: string;
  phone_number: string;
  full_name: string;
  email: string | null;
  is_phone_verified: boolean;
  kyc_tier: string;
  kyc_status: string;
  kyc_rejection_reason: string | null;
  referral_code: string;
  referral_reward_status: string;
  default_momo_number: string | null;
  default_momo_bank_code: string | null;
  round_up_vault_id: string | null;
  round_up_denomination: string;
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
  status: string;
  bitnob_status: string | null;
  failure_reason: string | null;
  retry_count: number;
  refund_reference: string | null;
  refunded_at: string | null;
  created_at: string;
  completed_at: string | null;
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
    created_at: string;
    paid_at: string | null;
  }[];
}

export interface AuthUrlResponse {
  authorization_url: string;
  reference: string;
}
