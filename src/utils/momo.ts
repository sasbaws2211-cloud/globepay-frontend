// Ghana mobile money networks, keyed by the Paystack bank code the backend
// sends. Vodafone Ghana rebranded to Telecel in 2024 - the code is still VOD.
export const MOMO_NETWORKS: { code: string; label: string }[] = [
  { code: 'MTN', label: 'MTN MoMo' },
  { code: 'ATL', label: 'AirtelTigo Money' },
  { code: 'VOD', label: 'Telecel Cash (formerly Vodafone)' },
];

// Saved numbers are stored as +233XXXXXXXXX; people type and read 0XXXXXXXXX.
export function toLocalGhanaNumber(phone: string | null | undefined): string {
  if (!phone) return '';
  const digits = phone.replace(/\D/g, '');
  if (digits.startsWith('233') && digits.length === 12) return `0${digits.slice(3)}`;
  return phone;
}
