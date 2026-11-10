/**
 * Frontend helpers for inter-branch transfers, POS settlement and purchase
 * returns. Pure functions only (unit-tested in tests/operations.spec.ts).
 *
 * Visibility rules here only decide which buttons are SHOWN; every rule is
 * enforced again by the server (permissions, branch, state machine).
 */
import { normalizeDecimalInput, translatedLabels } from '@/services/finance';

export const TRANSFER_STATUS_LABELS = translatedLabels('status.transfer');

export const TRANSFER_STATUS_BADGES: Record<string, string> = {
  draft: 'jp-badge-neutral',
  approved: 'jp-badge-info',
  in_transit: 'jp-badge-warning',
  partially_received: 'jp-badge-warning',
  received: 'jp-badge-success',
  cancelled: 'jp-badge-danger',
  rejected: 'jp-badge-danger',
};

export const TRANSFER_EVENT_LABELS = translatedLabels('status.transferEvent');

export const POS_STATUS_LABELS = translatedLabels('status.pos');

export interface Actor {
  permissions: string[];
  branch: string;
  role: string;
  id?: string;
}

export interface TransferLike {
  status: string;
  sourceBranch: string;
  destinationBranch: string;
  createdBy?: string | null;
}

/** Actions the actor may attempt on a transfer (mirrors the server rules). */
export function transferActions(t: TransferLike, actor: Actor) {
  const can = (p: string) => actor.permissions.includes(p);
  const admin = actor.role === 'admin';
  const atSource = admin || actor.branch === t.sourceBranch;
  const atDestination = admin || actor.branch === t.destinationBranch;
  const open = t.status === 'in_transit' || t.status === 'partially_received';
  const ownDraft = Boolean(actor.id && t.createdBy && String(t.createdBy) === String(actor.id));
  return {
    approve: t.status === 'draft' && can('transfers:approve') && atSource && (admin || !ownDraft),
    reject: t.status === 'draft' && can('transfers:approve') && atSource,
    cancel: (t.status === 'draft' || t.status === 'approved') && can('transfers:write') && atSource,
    dispatch: t.status === 'approved' && can('transfers:write') && atSource,
    receive: open && can('transfers:receive') && atDestination,
    resolve: open && can('transfers:approve') && (atSource || atDestination),
  };
}

/** Receipt payload from per-line inputs ({ [lineId]: "3" | "2.500" }); empty inputs are skipped. */
export function buildReceiptLines(lines: Array<{ lineId: number; itemType: string }>, inputs: Record<number, string>) {
  return lines
    .map((line) => {
      const raw = normalizeDecimalInput(inputs[line.lineId]);
      if (!raw) return null;
      return line.itemType === 'metal'
        ? { lineId: line.lineId, weightGrams: raw }
        : { lineId: line.lineId, quantity: Number(raw) };
    })
    .filter((x): x is { lineId: number; quantity: number } | { lineId: number; weightGrams: string } => x !== null);
}

/** Purchase return payload; goods → quantity/weight per line, price_adjustment → amount per line. */
export function buildPurchaseReturn(
  kind: 'goods' | 'price_adjustment',
  lines: Array<{ lineId: number; itemType: string }>,
  inputs: Record<number, string>,
  extra: { reason: string; creditNoteNo?: string; refundMethod?: string; refundAmount?: string },
) {
  const payloadLines = lines
    .map((line) => {
      const raw = normalizeDecimalInput(inputs[line.lineId]);
      if (!raw) return null;
      if (kind === 'price_adjustment') return { lineId: line.lineId, amount: raw };
      return line.itemType === 'metal' ? { lineId: line.lineId, weightGrams: raw } : { lineId: line.lineId, quantity: Number(raw) };
    })
    .filter(Boolean);
  const payload: Record<string, unknown> = { kind, reason: extra.reason.trim(), lines: payloadLines };
  if (extra.creditNoteNo) payload.creditNoteNo = extra.creditNoteNo.trim();
  const refund = normalizeDecimalInput(extra.refundAmount);
  if (refund && extra.refundMethod) payload.refunds = [{ method: extra.refundMethod, amount: refund }];
  return payload;
}

/** Card payment `pos` block, only when the business has POS providers configured. */
export function posBlock(method: string, providerId: string, installments: number | string) {
  if (method !== 'kredi kartı' || !providerId) return undefined;
  return { providerId, installments: Number(installments) || 1 };
}

export function errorDetails(error: unknown): Record<string, unknown> | undefined {
  const e = error as { data?: { details?: Record<string, unknown> } } | undefined;
  return e?.data?.details;
}
