import { cardName, isStaleUnpaid, visibleCards } from './cards';

const NOW = Date.parse('2026-09-30T00:30:00Z');
const card = (status: string, created_at: string) => ({ status, created_at });

test('brand names are capitalised; unissued cards say so', () => {
  expect(cardName({ card_brand: 'visa' })).toBe('Visa');
  expect(cardName({ card_brand: 'MASTERCARD' })).toBe('Mastercard');
  expect(cardName({ card_brand: null })).toBe('Not issued yet');
  expect(cardName({ card_brand: '  ' })).toBe('Not issued yet');
});

test('only unpaid or failed checkouts older than a day are hidden', () => {
  expect(isStaleUnpaid(card('pending_payment', '2026-09-17T01:02:13Z'), NOW)).toBe(true); // 13 days
  expect(isStaleUnpaid(card('failed', '2026-09-28T00:00:00Z'), NOW)).toBe(true);
  expect(isStaleUnpaid(card('pending_payment', '2026-09-29T07:39:21Z'), NOW)).toBe(false); // 17 hours
  expect(isStaleUnpaid(card('refunded', '2026-09-01T00:00:00Z'), NOW)).toBe(false); // money moved - keep
  expect(isStaleUnpaid(card('active', '2026-09-01T00:00:00Z'), NOW)).toBe(false);
});

test('visibleCards drops only the stale checkouts', () => {
  const cards = [
    card('active', '2026-09-01T00:00:00Z'),
    card('pending_payment', '2026-09-17T01:02:13Z'),
    card('pending_payment', '2026-09-29T07:39:21Z'),
  ];
  expect(visibleCards(cards, NOW).map((c) => c.created_at)).toEqual(['2026-09-01T00:00:00Z', '2026-09-29T07:39:21Z']);
});
