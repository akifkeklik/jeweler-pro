/**
 * Active POS providers of the user's branch (card payments). The server
 * computes the commission at capture; the client only offers the provider
 * and its allowed installment counts.
 */
import apiService from '@/services/api';
import { hasPermission } from '@/services/authSession';

export interface PosProviderOption {
  _id: string;
  name: string;
  installments: number[];
}

export async function loadActivePosProviders(): Promise<PosProviderOption[]> {
  if (!hasPermission('sales:write')) return [];
  try {
    const providers = await apiService.get<PosProviderOption[]>('/api/pos/providers/active');
    return Array.isArray(providers) ? providers : [];
  } catch {
    return [];
  }
}

/** With exactly one active provider the server picks it; send it explicitly anyway. */
export function defaultProviderId(providers: PosProviderOption[]): string {
  return providers.length === 1 ? providers[0]._id : '';
}

export function installmentsOf(providers: PosProviderOption[], providerId: string | undefined): number[] {
  const id = providerId || defaultProviderId(providers);
  const provider = providers.find((p) => p._id === id);
  return provider && provider.installments.length ? provider.installments : [1];
}
