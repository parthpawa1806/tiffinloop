"use client";

import Form from "next/form";
import type { ReactNode } from "react";

// GET form for list filters: dropdowns apply on change, text search applies on Enter.
export function FilterForm({ action, children }: { action: string; children: ReactNode }) {
  return (
    <Form
      action={action}
      scroll={false}
      onChange={(e) => {
        if ((e.target as HTMLElement).tagName === "SELECT") e.currentTarget.requestSubmit();
      }}
      className="mb-4 flex flex-wrap items-center gap-2"
    >
      {children}
    </Form>
  );
}
