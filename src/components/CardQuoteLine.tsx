import { useEffect, useState } from 'react';
import { getCardQuote, type CardQuote } from '../api/services';
import { getErrorMessage } from '../api/client';

/**
 * What a new card really costs before paying: the amount that goes on the
 * card, Bitnob's fees (passed on to the user) and the total charged. Priced by
 * the backend (GET /cards/quote) so it always matches the checkout.
 */
export default function CardQuoteLine({ amountGhs }: { amountGhs: string }) {
  const [quote, setQuote] = useState<CardQuote | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    setQuote(null);
    setError('');
    if (!amountGhs || !(parseFloat(amountGhs) > 0)) return;
    let cancelled = false;
    const t = setTimeout(async () => {
      try {
        const q = await getCardQuote(amountGhs);
        if (!cancelled) setQuote(q);
      } catch (err) {
        if (!cancelled) setError(getErrorMessage(err));
      }
    }, 350);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [amountGhs]);

  if (error) {
    return <div style={{ fontSize: '0.8rem', color: 'var(--danger)', marginTop: '0.35rem' }}>{error}</div>;
  }
  if (!quote) return null;
  const f = (v: string) => parseFloat(v).toFixed(2);
  return (
    <div
      style={{ fontSize: '0.85rem', marginTop: '0.5rem', padding: '0.6rem 0.75rem', borderRadius: 8, background: '#f0fdfa', border: '1px solid #99f6e4', color: '#134e4a' }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between' }}>
        <span>On the card</span>
        <span>GHS {f(quote.amount_ghs)} (${f(quote.amount_usd)})</span>
      </div>
      <div style={{ display: 'flex', justifyContent: 'space-between' }}>
        <span>Card fees</span>
        <span>GHS {f(quote.fee_ghs)} (${f(quote.fee_usd)})</span>
      </div>
      <div style={{ display: 'flex', justifyContent: 'space-between', fontWeight: 700, borderTop: '1px solid #99f6e4', marginTop: '0.3rem', paddingTop: '0.3rem' }}>
        <span>You pay</span>
        <span>GHS {f(quote.total_ghs)}</span>
      </div>
    </div>
  );
}
