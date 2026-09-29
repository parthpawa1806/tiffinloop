"use client";

import type { ReactNode } from "react";
import { useFormStatus } from "react-dom";

const VARIANTS = {
  primary: "bg-black text-white hover:bg-black/85 dark:bg-white dark:text-black dark:hover:bg-white/85",
  secondary: "border border-black/15 bg-white hover:bg-black/5 dark:border-white/20 dark:bg-transparent dark:hover:bg-white/10",
  danger: "border border-red-300 text-red-700 hover:bg-red-50 dark:border-red-500/40 dark:text-red-300 dark:hover:bg-red-500/10",
};

export function SubmitButton({
  children,
  pendingLabel,
  variant = "primary",
  disabled,
  className = "",
}: {
  children: ReactNode;
  pendingLabel?: string;
  variant?: keyof typeof VARIANTS;
  disabled?: boolean;
  className?: string;
}) {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={disabled || pending}
      className={`rounded-md px-3 py-1.5 text-sm font-medium transition disabled:cursor-not-allowed disabled:opacity-50 ${VARIANTS[variant]} ${className}`}
    >
      {pending ? (pendingLabel ?? "Working…") : children}
    </button>
  );
}
