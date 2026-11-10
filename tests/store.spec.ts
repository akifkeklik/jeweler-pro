import { beforeEach, describe, expect, it, vi } from 'vitest';
import apiService from '@/services/api';
import productsModule from '@/store/modules/products';
import salesModule from '@/store/modules/sales';

vi.mock('@/services/api', () => ({
  default: {
    post: vi.fn(),
    get: vi.fn(),
    put: vi.fn(),
    delete: vi.fn(),
  },
}));

describe('store CRUD actions', () => {
  beforeEach(() => vi.clearAllMocks());

  it('creates a product from the API response, not client state', async () => {
    const product = { _id: 4, name: 'Ring', price: 1250 };
    vi.mocked(apiService.post).mockResolvedValueOnce(product);
    const commit = vi.fn();

    await productsModule.actions.createProduct({ commit }, { name: 'Ring', price: 1 } as never);

    expect(apiService.post).toHaveBeenCalledWith('/api/products', { name: 'Ring', price: 1 });
    expect(commit).toHaveBeenCalledWith('ADD_PRODUCT', product);
  });

  it('updates the sales store only with the server result', async () => {
    const sale = { _id: 7, totalPrice: 2500 };
    vi.mocked(apiService.post).mockResolvedValueOnce(sale);
    const commit = vi.fn();

    await salesModule.actions.createSale({ commit }, { totalPrice: 1 } as never);

    expect(commit).toHaveBeenCalledWith('ADD_SALE', sale);
  });
});
