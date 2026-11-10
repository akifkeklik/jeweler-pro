/**
 * Periodic refresh driven by the `marketAutoRefresh` setting (seconds;
 * 0 = manual only). Used by the screens that show market prices.
 *
 * - setInterval(seconds) (re)arms the timer; 0 or an unknown value stops it
 * - a tick never overlaps a run that is still in flight
 * - a tick is skipped while the tab is hidden (no background polling)
 * - stop() is final for the owning component (call it in beforeUnmount)
 */
export const MARKET_REFRESH_SECONDS = [0, 15, 30, 60] as const;
export const DEFAULT_MARKET_REFRESH_SECONDS = 30;

export interface AutoRefresh {
  setInterval(seconds: unknown): void;
  stop(): void;
  /** Active period in seconds, 0 when stopped. */
  readonly seconds: number;
}

/** Opaque timer handle: a number in browsers, a Timeout object in Node. */
type TimerHandle = ReturnType<typeof globalThis.setInterval>;

interface Timers {
  setInterval: (fn: () => void, ms: number) => TimerHandle;
  clearInterval: (id: TimerHandle) => void;
}

export function normalizeRefreshSeconds(value: unknown): number {
  const n = Number(value);
  return (MARKET_REFRESH_SECONDS as readonly number[]).includes(n) ? n : DEFAULT_MARKET_REFRESH_SECONDS;
}

export function createAutoRefresh(
  run: () => unknown | Promise<unknown>,
  {
    timers = { setInterval: (fn, ms) => globalThis.setInterval(fn, ms), clearInterval: (id) => globalThis.clearInterval(id) } satisfies Timers,
    isHidden = () => typeof document !== 'undefined' && document.visibilityState === 'hidden',
  }: { timers?: Timers; isHidden?: () => boolean } = {},
): AutoRefresh {
  let handle: TimerHandle | null = null;
  let active = 0;
  let running = false;

  const clear = () => {
    if (handle !== null) timers.clearInterval(handle);
    handle = null;
    active = 0;
  };

  const tick = async () => {
    if (running || isHidden()) return;
    running = true;
    try {
      await run();
    } catch {
      // The screen shows its own error state; a failed tick must not stop the timer.
    } finally {
      running = false;
    }
  };

  return {
    setInterval(seconds: unknown) {
      const next = normalizeRefreshSeconds(seconds);
      if (next === active && handle !== null) return;
      clear();
      if (next > 0) {
        handle = timers.setInterval(() => { void tick(); }, next * 1000);
        active = next;
      }
    },
    stop: clear,
    get seconds() {
      return active;
    },
  };
}
