import type { OrderStatus } from "./normalize";

export type Tone = "neutral" | "red" | "amber" | "green" | "blue";

export const ORDER_STATUS: Record<string, { label: string; tone: Tone }> = {
  pending: { label: "Pending", tone: "neutral" },
  in_progress: { label: "In progress", tone: "blue" },
  delivered: { label: "Delivered", tone: "green" },
  cancelled: { label: "Cancelled", tone: "neutral" },
  refunded: { label: "Refunded", tone: "amber" },
  cook_dropout: { label: "Cook dropout", tone: "red" },
  unknown: { label: "Unknown", tone: "neutral" },
  reassigned: { label: "Backup cook", tone: "blue" },
  refunded_by_ops: { label: "Refunded today", tone: "amber" },
};

// Status as ops sees it: a decision taken today overrides the order log's status.
export function orderStatus(status: OrderStatus, resolution: { action: string } | null) {
  if (resolution?.action === "reassign") return ORDER_STATUS.reassigned;
  if (resolution?.action === "refund") return ORDER_STATUS.refunded_by_ops;
  return ORDER_STATUS[status];
}
