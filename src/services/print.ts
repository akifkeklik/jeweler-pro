/**
 * Printing helpers (receipts, labels). The document is rendered into a hidden
 * iframe and printed from there, so the app itself is never replaced and no
 * popup blocker is involved. All dynamic text must go through `escapeHtml`.
 */
export function escapeHtml(value: unknown): string {
  return String(value ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] as string));
}

export function printDocument(html: string): void {
  if (typeof document === 'undefined') return;
  const frame = document.createElement('iframe');
  frame.setAttribute('aria-hidden', 'true');
  frame.style.cssText = 'position:fixed;right:0;bottom:0;width:0;height:0;border:0;visibility:hidden';
  document.body.appendChild(frame);
  const doc = frame.contentDocument;
  const win = frame.contentWindow;
  if (!doc || !win) {
    frame.remove();
    return;
  }
  doc.open();
  doc.write(html);
  doc.close();
  const cleanup = () => setTimeout(() => frame.remove(), 500);
  win.addEventListener('afterprint', cleanup, { once: true });
  // Give images/SVG a tick to lay out before the print dialog opens.
  setTimeout(() => {
    win.focus();
    win.print();
    cleanup();
  }, 50);
}
