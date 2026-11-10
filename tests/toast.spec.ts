import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createStore } from 'vuex';
import notification, { ERROR_MIN_DURATION, MAX_VISIBLE } from '@/store/modules/notification';

function makeStore(toastDuration = 4000) {
  return createStore({
    modules: {
      notifications: notification,
      settings: { namespaced: true, state: () => ({ toastDuration }) },
    },
  });
}

describe('toast notification queue', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  const list = (store: ReturnType<typeof makeStore>) => (store.state as any).notifications.notifications;

  it('auto-dismisses ordinary confirmations after the preferred 3–5 s duration', async () => {
    const store = makeStore(4000);
    await store.dispatch('notifications/showSuccess', 'Theme updated');
    expect(list(store)).toHaveLength(1);
    vi.advanceTimersByTime(3999);
    expect(list(store)).toHaveLength(1);
    vi.advanceTimersByTime(1);
    expect(list(store)).toHaveLength(0);
  });

  it('keeps errors visible longer so they can be read', async () => {
    const store = makeStore(3000);
    await store.dispatch('notifications/showError', 'Failed');
    expect(list(store)[0].duration).toBe(ERROR_MIN_DURATION);
    vi.advanceTimersByTime(ERROR_MIN_DURATION - 1);
    expect(list(store)).toHaveLength(1);
  });

  it('coalesces identical messages instead of stacking copies', async () => {
    const store = makeStore();
    await store.dispatch('notifications/showSuccess', 'Preferences saved');
    vi.advanceTimersByTime(3000);
    await store.dispatch('notifications/showSuccess', 'Preferences saved');
    expect(list(store)).toHaveLength(1);
    expect(list(store)[0].count).toBe(2);
    // the timer restarted on the repeat
    vi.advanceTimersByTime(3999);
    expect(list(store)).toHaveLength(1);
  });

  it(`never shows more than ${MAX_VISIBLE} toasts (oldest leaves first)`, async () => {
    const store = makeStore();
    for (let i = 1; i <= 6; i += 1) await store.dispatch('notifications/showInfo', `Message ${i}`);
    expect(list(store).map((n: any) => n.message)).toEqual(['Message 4', 'Message 5', 'Message 6']);
  });

  it('dismisses manually and clears the pending timer', async () => {
    const store = makeStore();
    const id = await store.dispatch('notifications/showWarning', 'Careful');
    await store.dispatch('notifications/removeNotification', id);
    expect(list(store)).toHaveLength(0);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('pauses while hovered and resumes with a short grace period', async () => {
    const store = makeStore();
    const id = await store.dispatch('notifications/showSuccess', 'Hold me');
    await store.dispatch('notifications/holdNotification', id);
    vi.advanceTimersByTime(20000);
    expect(list(store)).toHaveLength(1);
    await store.dispatch('notifications/releaseNotification', id);
    vi.advanceTimersByTime(2500);
    expect(list(store)).toHaveLength(0);
  });

  it('ignores empty messages', async () => {
    const store = makeStore();
    expect(await store.dispatch('notifications/showError', '   ')).toBeNull();
    expect(list(store)).toHaveLength(0);
  });
});
