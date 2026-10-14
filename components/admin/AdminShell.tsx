import type { ReactNode } from "react";

import { AdminNav } from "@/components/admin/AdminNav";
import { WorkspacePage } from "@/components/workspace/WorkspacePage";

/**
 * Shared chrome for the admin dashboard section pages (overview, users, assets,
 * tags, official-docs list). The focused doc editor deliberately opts out, so
 * this is a wrapper component rather than a route `layout.tsx`.
 */
export function AdminShell({ children }: { children: ReactNode }) {
  return (
    <WorkspacePage width="wide" className="grid gap-5">
      <header className="grid gap-3">
        <h1 className="text-2xl font-semibold tracking-tight vault-display">
          Admin
        </h1>
        <AdminNav />
      </header>
      {children}
    </WorkspacePage>
  );
}
