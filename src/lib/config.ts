// The scenario is frozen at 10:30 AM IST on 23 Sep 2026 (see data/raw/README.txt).
// Everything time-based reads from here, never from the real clock.
export const TIMEZONE = "Asia/Kolkata";
export const NOW = new Date("2026-09-23T10:30:00+05:30");
export const TODAY = "2026-09-23";

// Delivery windows. A subscriber must be notified before the window starts.
export const MEAL_WINDOWS = {
  lunch: { start: "12:30", end: "14:00" },
  dinner: { start: "19:30", end: "21:00" },
} as const;

export function mealDeadline(date: string, meal: keyof typeof MEAL_WINDOWS): Date {
  return new Date(`${date}T${MEAL_WINDOWS[meal].start}:00+05:30`);
}

// Leadership dashboard window: the 30 days before today (today is still in progress).
export const DASHBOARD_DAYS = 30;
