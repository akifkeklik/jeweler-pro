/**
 * Promise-based confirmation dialog that replaces `window.confirm()`.
 * Native dialogs ignore the theme and the selected language, so every explicit
 * confirmation (financial or destructive actions) goes through here instead.
 *
 *   if (!(await confirmAction({ message: t('...'), tone: 'danger' }))) return;
 */
import { reactive } from 'vue';

export interface ConfirmOptions {
  title?: string;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  tone?: 'default' | 'danger' | 'warning';
  /** When set, the dialog shows a text field and requires a value. */
  inputLabel?: string;
}

interface ConfirmState extends ConfirmOptions {
  open: boolean;
  value: string;
}

export const confirmState = reactive<ConfirmState>({
  open: false,
  message: '',
  value: '',
});

let resolver: ((value: boolean) => void) | null = null;

export function confirmAction(options: ConfirmOptions): Promise<boolean> {
  // A new request supersedes an unanswered one (treated as cancelled).
  if (resolver) resolver(false);
  Object.assign(confirmState, {
    title: undefined,
    confirmLabel: undefined,
    cancelLabel: undefined,
    tone: 'default',
    inputLabel: undefined,
    ...options,
    value: '',
    open: true,
  });
  return new Promise<boolean>((resolve) => {
    resolver = resolve;
  });
}

export function settleConfirm(value: boolean): void {
  confirmState.open = false;
  const done = resolver;
  resolver = null;
  if (done) done(value);
}

/** Themed replacement for `window.prompt()`: resolves the trimmed text, or null. */
export async function promptAction(options: ConfirmOptions & { inputLabel: string }): Promise<string | null> {
  const ok = await confirmAction(options);
  const value = confirmState.value.trim();
  return ok && value ? value : null;
}
