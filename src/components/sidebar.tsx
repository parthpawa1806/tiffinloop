"use client";

import { ChefHat, ClipboardList, LayoutDashboard, Menu, MessageCircle, ReceiptIndianRupee, Users, X } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { type ReactNode, useState } from "react";

const NAV = [
  { href: "/dropouts", label: "Cook dropouts", icon: ChefHat },
  { href: "/orders", label: "Orders", icon: ClipboardList },
  { href: "/cooks", label: "Cooks", icon: Users },
  { href: "/chats", label: "Chats", icon: MessageCircle },
  { href: "/refunds", label: "Refunds", icon: ReceiptIndianRupee },
  { href: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
];

export function Sidebar({ needsAction, footer }: { needsAction: number; footer: ReactNode }) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);

  const nav = (
    <nav className="flex flex-1 flex-col gap-0.5 px-3">
      {NAV.map(({ href, label, icon: Icon }) => {
        const active = pathname === href || pathname.startsWith(`${href}/`);
        return (
          <Link
            key={href}
            href={href}
            onClick={() => setOpen(false)}
            className={`flex items-center gap-3 rounded-md px-3 py-2 text-sm transition ${
              active
                ? "bg-black/[0.06] font-medium text-black dark:bg-white/10 dark:text-white"
                : "text-black/65 hover:bg-black/[0.04] hover:text-black dark:text-white/65 dark:hover:bg-white/5 dark:hover:text-white"
            }`}
          >
            <Icon size={17} strokeWidth={1.75} aria-hidden />
            <span className="flex-1">{label}</span>
            {href === "/dropouts" && needsAction > 0 && (
              <span className="rounded-full bg-red-600 px-1.5 text-xs font-medium text-white">{needsAction}</span>
            )}
          </Link>
        );
      })}
    </nav>
  );

  const brand = (
    <div className="px-6 pb-6 pt-5">
      <div className="text-base font-semibold tracking-tight">TiffinLoop</div>
      <div className="text-xs text-black/50 dark:text-white/50">Ops console</div>
    </div>
  );

  return (
    <>
      {/* Mobile top bar */}
      <div className="sticky top-0 z-30 flex items-center gap-3 border-b border-black/10 bg-white px-4 py-3 md:hidden dark:border-white/10 dark:bg-neutral-950">
        <button onClick={() => setOpen(true)} aria-label="Open menu" className="rounded-md p-1 hover:bg-black/5 dark:hover:bg-white/10">
          <Menu size={20} />
        </button>
        <span className="font-semibold">TiffinLoop</span>
        {needsAction > 0 && <span className="ml-auto rounded-full bg-red-600 px-2 text-xs font-medium text-white">{needsAction} need action</span>}
      </div>

      {/* Mobile drawer */}
      {open && (
        <div className="fixed inset-0 z-40 md:hidden">
          <div className="absolute inset-0 bg-black/40" onClick={() => setOpen(false)} />
          <aside className="absolute inset-y-0 left-0 flex w-64 flex-col bg-white shadow-xl dark:bg-neutral-950">
            <button onClick={() => setOpen(false)} aria-label="Close menu" className="absolute right-3 top-4 rounded-md p-1 hover:bg-black/5 dark:hover:bg-white/10">
              <X size={18} />
            </button>
            {brand}
            {nav}
            <div className="border-t border-black/10 p-4 dark:border-white/10">{footer}</div>
          </aside>
        </div>
      )}

      {/* Desktop sidebar */}
      <aside className="sticky top-0 hidden h-screen w-60 shrink-0 flex-col border-r border-black/10 bg-neutral-50 md:flex dark:border-white/10 dark:bg-neutral-950">
        {brand}
        {nav}
        <div className="border-t border-black/10 p-4 dark:border-white/10">{footer}</div>
      </aside>
    </>
  );
}
