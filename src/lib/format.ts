import { TIMEZONE } from "./config";

export function fmtTime(d: Date | string): string {
  return new Date(d).toLocaleTimeString("en-IN", { timeZone: TIMEZONE, hour: "numeric", minute: "2-digit" }).toUpperCase();
}

export function fmtDate(d: Date | string): string {
  return new Date(d).toLocaleDateString("en-IN", { timeZone: TIMEZONE, day: "numeric", month: "short" });
}

// "2h 5m", "45m"; negative durations are shown as "late by …" by callers.
export function fmtDuration(ms: number): string {
  const mins = Math.round(Math.abs(ms) / 60000);
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return h ? `${h}h ${m}m` : `${m}m`;
}

export const inr = (n: number) => `₹${n.toLocaleString("en-IN")}`;
