import { useCallback, useEffect, useRef, useState } from 'react';
import { refreshPayment, type PaymentRefresh } from '../api/services';

const POLL_EVERY_MS = 4000;
// Stop polling a reference after this long; the backend's reconcile sweep
// keeps checking it every couple of minutes after that.
const GIVE_UP_AFTER_MS = 3 * 60 * 1000;

/**
 * Polls POST /payments/{reference}/refresh for checkouts started on this page
 * until Paystack reports a final state, then calls onSettled once per
 * reference. Track a reference whether the popup reported success or was
 * closed - a mobile-money approval can still land after the popup is gone.
 */
export function usePaymentTracker(onSettled: (result: PaymentRefresh, reference: string) => void) {
  const [references, setReferences] = useState<string[]>([]);
  const startedAt = useRef(new Map<string, number>());
  const onSettledRef = useRef(onSettled);
  onSettledRef.current = onSettled;

  const stop = useCallback((reference: string) => {
    startedAt.current.delete(reference);
    setReferences((current) => current.filter((r) => r !== reference));
  }, []);

  const check = useCallback(
    async (reference: string) => {
      try {
        const result = await refreshPayment(reference);
        if (!startedAt.current.has(reference)) return; // stopped meanwhile
        if (!result.pending) {
          stop(reference);
          onSettledRef.current(result, reference);
        }
      } catch {
        // transient network/API error - keep trying until the window closes
      }
      const started = startedAt.current.get(reference);
      if (started !== undefined && Date.now() - started > GIVE_UP_AFTER_MS) stop(reference);
    },
    [stop]
  );

  const track = useCallback(
    (reference: string) => {
      if (startedAt.current.has(reference)) return;
      startedAt.current.set(reference, Date.now());
      setReferences((current) => [...current, reference]);
      check(reference); // first check right away, not after one interval
    },
    [check]
  );

  useEffect(() => {
    if (references.length === 0) return;
    const id = window.setInterval(() => {
      if (!document.hidden) references.forEach(check);
    }, POLL_EVERY_MS);
    return () => window.clearInterval(id);
  }, [references, check]);

  return { track, tracking: references.length > 0 };
}

/** Human wording for a settled payment, shared by the checkout pages. */
export function describeSettledPayment(result: PaymentRefresh): { ok: boolean; message: string } {
  if (result.status === 'failed') return { ok: false, message: "Payment didn't go through - you haven't been charged." };
  if (result.status === 'delivery_failed') {
    // Cross-border / cards: the GHS charge succeeded, the Bitnob delivery step didn't.
    return { ok: false, message: 'Payment received, but delivery failed - you can retry or request a refund below.' };
  }
  return { ok: true, message: 'Payment confirmed.' };
}
