import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  transferActions, buildReceiptLines, buildPurchaseReturn, posBlock, TRANSFER_STATUS_LABELS,
} from '@/services/operations';

const http = vi.hoisted(() => ({ post: vi.fn() }));
vi.mock('axios', () => ({
  default: {
    create: vi.fn(() => ({
      post: http.post,
      interceptors: { request: { use: vi.fn() }, response: { use: vi.fn() } },
    })),
  },
}));

import router, { routes } from '@/router/index.js';
import { resetAuthSessionForTests, setSession } from '@/services/authSession';

const manager = (branch: string, id = 'm1') => ({
  permissions: ['transfers:read', 'transfers:write', 'transfers:approve', 'transfers:receive'], branch, role: 'manager', id,
});
const staff = (branch: string) => ({ permissions: ['transfers:read', 'transfers:receive'], branch, role: 'staff', id: 's1' });
const transfer = (status: string, createdBy = 'creator') => ({ status, sourceBranch: 'A', destinationBranch: 'B', createdBy });

describe('transfer action visibility (mirrors server rules)', () => {
  it('a draft is approved by another source-branch manager, never by its creator or the destination', () => {
    expect(transferActions(transfer('draft', 'm1'), manager('A', 'm1')).approve).toBe(false);
    expect(transferActions(transfer('draft', 'm1'), manager('A', 'm2')).approve).toBe(true);
    expect(transferActions(transfer('draft'), manager('B')).approve).toBe(false);
    expect(transferActions(transfer('draft', 'x'), { ...manager('Z'), role: 'admin', id: 'x' }).approve).toBe(true);
  });

  it('only the source dispatches/cancels; only the destination receives; staff cannot resolve shortfalls', () => {
    expect(transferActions(transfer('approved'), manager('A')).dispatch).toBe(true);
    expect(transferActions(transfer('approved'), manager('B')).dispatch).toBe(false);
    expect(transferActions(transfer('approved'), manager('A')).cancel).toBe(true);
    expect(transferActions(transfer('in_transit'), manager('A')).cancel).toBe(false);
    expect(transferActions(transfer('in_transit'), staff('B')).receive).toBe(true);
    expect(transferActions(transfer('in_transit'), staff('A')).receive).toBe(false);
    expect(transferActions(transfer('partially_received'), staff('B')).resolve).toBe(false);
    expect(transferActions(transfer('partially_received'), manager('B')).resolve).toBe(true);
    expect(transferActions(transfer('received'), manager('B'))).toEqual({
      approve: false, reject: false, cancel: false, dispatch: false, receive: false, resolve: false,
    });
    expect(Object.keys(TRANSFER_STATUS_LABELS)).toHaveLength(7);
  });
});

describe('payload builders send exact decimal strings', () => {
  it('receipt lines: products as integer quantities, metal as gram text; blanks skipped', () => {
    const lines = [{ lineId: 1, itemType: 'product' }, { lineId: 2, itemType: 'metal' }, { lineId: 3, itemType: 'product' }];
    expect(buildReceiptLines(lines, { 1: '3', 2: '2,500', 3: '' })).toEqual([
      { lineId: 1, quantity: 3 }, { lineId: 2, weightGrams: '2.500' },
    ]);
  });

  it('purchase return: goods vs price adjustment, optional refund', () => {
    const lines = [{ lineId: 1, itemType: 'product' }, { lineId: 2, itemType: 'metal' }];
    expect(buildPurchaseReturn('goods', lines, { 1: '2', 2: '1.250' }, { reason: ' Kusurlu ' })).toEqual({
      kind: 'goods', reason: 'Kusurlu', lines: [{ lineId: 1, quantity: 2 }, { lineId: 2, weightGrams: '1.250' }],
    });
    expect(buildPurchaseReturn('price_adjustment', lines, { 1: '1.234,50' }, { reason: 'fark', refundMethod: 'havale', refundAmount: '100' })).toEqual({
      kind: 'price_adjustment', reason: 'fark', lines: [{ lineId: 1, amount: '1234.50' }], refunds: [{ method: 'havale', amount: '100' }],
    });
  });

  it('pos block only for card payments with a provider', () => {
    expect(posBlock('nakit', 'p1', 1)).toBeUndefined();
    expect(posBlock('kredi kartı', '', 1)).toBeUndefined();
    expect(posBlock('kredi kartı', 'p1', '3')).toEqual({ providerId: 'p1', installments: 3 });
  });
});

describe('new routes are permission-guarded', () => {
  beforeEach(async () => {
    resetAuthSessionForTests();
    http.post.mockReset();
    http.post.mockRejectedValue({ response: { status: 401, data: { code: 'REFRESH_TOKEN_MISSING' } } });
    await router.push('/login');
    resetAuthSessionForTests();
  });

  it('declares the backend permission of each page', () => {
    expect(routes.find((r: (typeof routes)[number]) => r.path === '/transfers')?.meta?.permission).toBe('transfers:read');
    expect(routes.find((r: (typeof routes)[number]) => r.path === '/pos')?.meta?.permission).toBe('pos:read');
  });

  it('staff with transfers:read reach /transfers but not /pos', async () => {
    setSession({
      token: 't', expiresIn: 900,
      user: { id: '1', email: 's@x.co', name: 'S', role: 'staff', branch: 'A', businessId: 'b', customPermissions: [], permissions: ['dashboard:read', 'transfers:read'] },
    });
    await router.push('/transfers');
    expect(router.currentRoute.value.path).toBe('/transfers');
    await router.push('/pos');
    expect(router.currentRoute.value.path).not.toBe('/pos');
  });
});
