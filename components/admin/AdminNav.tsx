"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  BookOpen,
  Hash,
  HardDrive,
  LayoutDashboard,
  Users,
} from "lucide-react";

import { cn } from "@/lib/utils";

type AdminTab = {
  label: string;
  href: string;
  icon: typeof LayoutDashboard;
  exact?: boolean;
};

const TABS: AdminTab[] = [
  { label: "Overview", href: "/dashboard/admin", icon: LayoutDashboard, exact: true },
  { label: "Users", href: "/dashboard/admin/users", icon: Users },
  { label: "Assets", href: "/dashboard/admin/assets", icon: HardDrive },
  { label: "Tags", href: "/dashboard/admin/tags", icon: Hash },
  { label: "Official docs", href: "/dashboard/admin/docs", icon: BookOpen },
];

export function AdminNav() {
  const pathname = usePathname();

  return (
    <nav className="flex flex-wrap gap-1 border-b border-border/70">
      {TABS.map((tab) => {
        const active = tab.exact
          ? pathname === tab.href
          : pathname === tab.href || pathname.startsWith(`${tab.href}/`);
        const Icon = tab.icon;

        return (
          <Link
            key={tab.href}
            href={tab.href}
            className={cn(
              "flex items-center gap-2 border-b-2 px-3 py-2 text-sm font-medium transition -mb-px",
              active
                ? "border-primary text-foreground"
                : "border-transparent text-muted-foreground hover:text-foreground",
            )}
          >
            <Icon className="size-4" />
            {tab.label}
          </Link>
        );
      })}
    </nav>
  );
}
