import type { OrderStatus } from "./normalize";

export type Tone = "neutral" | "red" | "amber" | "green" | "blue";

// The 18 raw statuses collapse (in normalize.ts) to 6, then to 5 buckets for reporting:
//   Delivered     Delivered, delivered, DELIVERED, Completed
//   Open          Pending, pending, In Progress, in-progress
//   Cancelled     Cancelled, cancelled, CANCELLED
//   Refunded      refunded, Refunded
//   Cook dropout  cook_dropout, cook no show, Cook No-Show, No Show, Cancelled - Cook Unavailable
// "No Show" alone could mean the subscriber didn't show; we treat it as a cook no-show
// because the order log only records cook-side no-shows. The UI says so (NO_SHOW_NOTE).
export type Bucket = "delivered" | "open" | "cancelled" | "refunded" | "cook_dropout";

export const BUCKETS: Record<Bucket, { label: string; tone: Tone }> = {
  delivered: { label: "Delivered", tone: "green" },
  open: { label: "Open", tone: "neutral" },
  cancelled: { label: "Cancelled", tone: "neutral" },
  refunded: { label: "Refunded", tone: "amber" },
  cook_dropout: { label: "Cook dropout", tone: "red" },
};

export function statusBucket(s: OrderStatus): Bucket {
  if (s === "pending" || s === "in_progress" || s === "unknown") return "open";
  return s;
}

export const NO_SHOW_NOTE =
  "\"No Show\" in the order log is treated as a cook no-show (27 orders). It could also mean the subscriber wasn't there; the log doesn't say.";

// Order list statuses: the 5 buckets plus today's ops decisions.
export const ORDER_STATUS: Record<string, { label: string; tone: Tone }> = {
  ...BUCKETS,
  reassigned: { label: "Backup cook", tone: "blue" },
  refunded_by_ops: { label: "Refunded today", tone: "amber" },
};

// Status as ops sees it: a decision taken today overrides the order log's status.
export function orderStatus(status: OrderStatus, resolution: { action: string } | null) {
  if (resolution?.action === "reassign") return ORDER_STATUS.reassigned;
  if (resolution?.action === "refund") return ORDER_STATUS.refunded_by_ops;
  return BUCKETS[statusBucket(status)];
}
