import type { Card } from '../api/types';

// A checkout nobody paid within a day is dead: the backend stops polling
// Paystack for it after 24h (CHARGE_POLL_WINDOW in payments/reconcile.py).
const UNPAID_HIDE_AFTER_MS = 24 * 60 * 60 * 1000;

/**
 * The name shown on a card tile. Bitnob sends the brand lowercase ("visa");
 * a card that was never issued (checkout unpaid, payment failed or refunded,
 * creation failed) has no brand at all.
 */
export function cardName(card: Pick<Card, 'card_brand'>): string {
  const brand = (card.card_brand || '').trim();
  if (!brand) return 'Not issued yet';
  if (brand.toLowerCase() === 'mastercard') return 'Mastercard';
  return brand.charAt(0).toUpperCase() + brand.slice(1).toLowerCase();
}

/** An abandoned checkout: never paid (or the payment failed), and over a day old. */
export function isStaleUnpaid(card: Pick<Card, 'status' | 'created_at'>, now: number = Date.now()): boolean {
  if (card.status !== 'pending_payment' && card.status !== 'failed') return false;
  return now - new Date(card.created_at).getTime() > UNPAID_HIDE_AFTER_MS;
}

/** Cards worth showing: everything except abandoned checkouts. */
export function visibleCards<T extends Pick<Card, 'status' | 'created_at'>>(cards: T[], now: number = Date.now()): T[] {
  return cards.filter((c) => !isStaleUnpaid(c, now));
}
