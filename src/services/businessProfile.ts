import apiService from '@/services/api';

/**
 * Business profile (legal identity + fiscal/compliance rules), stored on
 * the server per business: every device prints the same, audited details.
 * Mirrors backend/services/businessProfileService.js.
 */
export interface BusinessProfile {
  companyName: string;
  authorizedPerson: string;
  taxOffice: string;
  taxNumber: string;
  mersisNo: string;
  phone: string;
  email: string;
  address: string;
  receiptFooter: string;
  vat: { enabled: boolean; standardRateBp: number; approvedBy: string; approvedAt: string | null };
  compliance: { identificationThreshold: number | null; kvkkNoticeVersion: string };
  updatedAt: string | null;
  configured: boolean;
}

export const IDENTITY_FIELDS = [
  'companyName', 'authorizedPerson', 'taxOffice', 'taxNumber', 'mersisNo', 'phone', 'email', 'address', 'receiptFooter',
] as const;

export function emptyProfile(): BusinessProfile {
  return {
    companyName: '', authorizedPerson: '', taxOffice: '', taxNumber: '', mersisNo: '',
    phone: '', email: '', address: '', receiptFooter: '',
    vat: { enabled: false, standardRateBp: 2000, approvedBy: '', approvedAt: null },
    compliance: { identificationThreshold: null, kvkkNoticeVersion: '' },
    updatedAt: null,
    configured: false,
  };
}

let cached: BusinessProfile | null = null;

export async function fetchBusinessProfile({ force = false } = {}): Promise<BusinessProfile> {
  if (cached && !force) return cached;
  const data = await apiService.get<BusinessProfile>('/api/business-profile');
  cached = { ...emptyProfile(), ...(data || {}) };
  return cached;
}

/** Payload for PUT: only editable fields, decimal threshold as a string. */
export function toUpdatePayload(profile: BusinessProfile) {
  const identity = Object.fromEntries(IDENTITY_FIELDS.map((key) => [key, String(profile[key] ?? '').trim()])) as Record<(typeof IDENTITY_FIELDS)[number], string>;
  const threshold = profile.compliance.identificationThreshold;
  return {
    ...identity,
    vat: {
      enabled: Boolean(profile.vat.enabled),
      standardRateBp: Math.round(Number(profile.vat.standardRateBp) || 0),
      approvedBy: String(profile.vat.approvedBy || '').trim(),
    },
    compliance: {
      identificationThreshold: threshold === null || threshold === undefined || String(threshold).trim() === ''
        ? null
        : Number(threshold).toFixed(2),
      kvkkNoticeVersion: String(profile.compliance.kvkkNoticeVersion || '').trim(),
    },
  };
}

export async function saveBusinessProfile(profile: BusinessProfile): Promise<BusinessProfile> {
  const data = await apiService.put<BusinessProfile>('/api/business-profile', toUpdatePayload(profile));
  cached = { ...emptyProfile(), ...(data || {}) };
  return cached;
}

/** Test hook / logout: forget the cached profile. */
export function clearBusinessProfileCache() {
  cached = null;
}
