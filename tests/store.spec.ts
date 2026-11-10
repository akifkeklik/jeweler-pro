import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createStore } from 'vuex';
import apiService from '@/services/api';
import { createListModule, type ListState } from '@/store/modules/listModule';
import store from '@/store';

vi.mock('@/services/api', () => ({
  default: { get: vi.fn(), post: vi.fn(), put: vi.fn(), delete: vi.fn() },
}));

interface Row { _id: number; name: string }

function listStore() {
  return createStore<{ rows: ListState<Row> }>({ modules: { rows: createListModule<Row>('/api/rows') } });
}

describe('server-owned list modules (read models)', () => {
  beforeEach(() => vi.clearAllMocks());

  it('loads the list from the API and exposes the count', async () => {
    vi.mocked(apiService.get).mockResolvedValueOnce([{ _id: 1, name: 'A' }, { _id: 2, name: 'B' }]);
    const s = listStore();
    const pending = s.dispatch('rows/fetch');
    expect(s.state.rows.loading).toBe(true);
    await expect(pending).resolves.toHaveLength(2);
    expect(apiService.get).toHaveBeenCalledWith('/api/rows');
    expect(s.state.rows.items.map((r) => r.name)).toEqual(['A', 'B']);
    expect(s.getters['rows/count']).toBe(2);
    expect(s.state.rows.loading).toBe(false);
    expect(s.state.rows.error).toBeNull();
  });

  it('records the error, keeps the previous list and rethrows', async () => {
    const s = listStore();
    vi.mocked(apiService.get).mockResolvedValueOnce([{ _id: 1, name: 'A' }]);
    await s.dispatch('rows/fetch');
    vi.mocked(apiService.get).mockRejectedValueOnce({ message: 'Sunucuya bağlanılamadı' });
    await expect(s.dispatch('rows/fetch')).rejects.toMatchObject({ message: 'Sunucuya bağlanılamadı' });
    expect(s.state.rows.error).toBe('Sunucuya bağlanılamadı');
    expect(s.state.rows.items).toHaveLength(1);
    expect(s.state.rows.loading).toBe(false);
  });

  it('treats a non-array response as an empty list', async () => {
    vi.mocked(apiService.get).mockResolvedValueOnce(null);
    const s = listStore();
    await expect(s.dispatch('rows/fetch')).resolves.toEqual([]);
    expect(s.state.rows.items).toEqual([]);
  });

  it('the root store registers exactly the modules the screens use', () => {
    expect(Object.keys((store as unknown as { _modules: { root: { _children: Record<string, unknown> } } })._modules.root._children).sort())
      .toEqual(['customers', 'notifications', 'sales', 'settings']);
  });
});
