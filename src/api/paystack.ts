// Paystack's inline popup, so checkout opens as an overlay inside the app
// instead of a new browser tab (which pop-up blockers also tend to kill,
// since window.open only runs after the initiate request resolves).
//
// The backend still initializes every transaction server-side (amount,
// reference, metadata stay trusted); the popup just resumes that
// transaction using the access code at the end of its authorization_url.

const INLINE_JS_URL = 'https://js.paystack.co/v2/inline.js';

export type CheckoutResult = 'success' | 'cancelled';

interface PaystackCallbacks {
  onSuccess?: (transaction: { reference: string }) => void;
  onCancel?: () => void;
  onError?: (error: { message?: string }) => void;
}

interface PaystackPopInstance {
  resumeTransaction(accessCode: string, callbacks?: PaystackCallbacks): void;
}

declare global {
  interface Window {
    PaystackPop?: new () => PaystackPopInstance;
  }
}

let loader: Promise<void> | null = null;

function loadInlineJs(): Promise<void> {
  if (window.PaystackPop) return Promise.resolve();
  if (!loader) {
    loader = new Promise<void>((resolve, reject) => {
      const script = document.createElement('script');
      script.src = INLINE_JS_URL;
      script.async = true;
      script.onload = () => resolve();
      script.onerror = () => {
        loader = null; // allow a retry on the next checkout
        script.remove();
        reject(new Error('Could not load Paystack checkout. Check your connection and try again.'));
      };
      document.head.appendChild(script);
    });
  }
  return loader;
}

function accessCodeFrom(authorizationUrl: string): string {
  const code = new URL(authorizationUrl).pathname.split('/').filter(Boolean).pop();
  if (!code) throw new Error('Invalid Paystack checkout link');
  return code;
}

/** Opens the Paystack popup for a backend-initialized transaction and resolves
 * when the payer finishes ('success') or closes it ('cancelled'). 'success'
 * only means Paystack reported the charge - the backend still confirms it. */
export async function openPaystackCheckout(authorizationUrl: string): Promise<CheckoutResult> {
  await loadInlineJs();
  const accessCode = accessCodeFrom(authorizationUrl);
  return new Promise<CheckoutResult>((resolve, reject) => {
    const popup = new window.PaystackPop!();
    popup.resumeTransaction(accessCode, {
      onSuccess: () => resolve('success'),
      onCancel: () => resolve('cancelled'),
      onError: (error) => reject(new Error(error?.message || 'Paystack checkout failed')),
    });
  });
}
