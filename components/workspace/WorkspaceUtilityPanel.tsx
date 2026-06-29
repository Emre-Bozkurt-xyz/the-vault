import Link from "next/link";
import {
  BookOpen,
  Hash,
  HardDrive,
  ImageIcon,
  LayoutDashboard,
  LayoutGrid,
  Search,
  Settings,
  ShieldCheck,
} from "lucide-react";

import { cn } from "@/lib/utils";

type UtilityPanelMode = "search" | "gallery" | "assets" | "admin";

type UtilityPanelItem = {
  label: string;
  href: string;
  description: string;
  icon: typeof Settings;
};

const panelContent: Record<
  UtilityPanelMode,
  {
    label: string;
    title: string;
    description: string;
    items: UtilityPanelItem[];
  }
> = {
  search: {
    label: "Search",
    title: "Search",
    description: "Global search is not wired yet. Current shortcuts live here.",
    items: [
      {
        label: "Files",
        href: "/workspace",
        description: "Open your recent documents.",
        icon: Search,
      },
      {
        label: "Gallery",
        href: "/gallery",
        description: "Browse public documents.",
        icon: LayoutGrid,
      },
      {
        label: "Assets",
        href: "/assets",
        description: "Browse your uploaded content.",
        icon: ImageIcon,
      },
      {
        label: "Docs",
        href: "/docs",
        description: "Read official Vault guides.",
        icon: BookOpen,
      },
    ],
  },
  gallery: {
    label: "Public",
    title: "Gallery",
    description: "Public content browsing and discovery.",
    items: [
      {
        label: "Public documents",
        href: "/gallery",
        description: "Browse published Vault documents.",
        icon: LayoutGrid,
      },
      {
        label: "Publishing guide",
        href: "/docs/guides/sharing-and-permissions",
        description: "Learn how sharing and publishing work.",
        icon: BookOpen,
      },
    ],
  },
  assets: {
    label: "Library",
    title: "Assets",
    description: "Private uploads and publish controls.",
    items: [
      {
        label: "My assets",
        href: "/assets",
        description: "Browse and configure uploaded images and PDFs.",
        icon: ImageIcon,
      },
      {
        label: "Public gallery",
        href: "/gallery",
        description: "See public content.",
        icon: LayoutGrid,
      },
    ],
  },
  admin: {
    label: "Admin",
    title: "Admin",
    description: "Moderation and official documentation tools.",
    items: [
      {
        label: "Overview",
        href: "/dashboard/admin",
        description: "Dashboard metrics and recent activity.",
        icon: LayoutDashboard,
      },
      {
        label: "Users",
        href: "/dashboard/admin/users",
        description: "Roles, bans, quotas, and account moderation.",
        icon: ShieldCheck,
      },
      {
        label: "Assets",
        href: "/dashboard/admin/assets",
        description: "Storage usage, quotas, and asset moderation.",
        icon: HardDrive,
      },
      {
        label: "Tags",
        href: "/dashboard/admin/tags",
        description: "Canonical tags, aliases, and cleanup.",
        icon: Hash,
      },
      {
        label: "Official docs",
        href: "/dashboard/admin/docs",
        description: "Publish user-facing Markdown documentation.",
        icon: BookOpen,
      },
    ],
  },
};

export function WorkspaceUtilityPanel({
  mode,
  activeHref,
  isAdmin = false,
}: {
  mode: UtilityPanelMode;
  activeHref?: string;
  isAdmin?: boolean;
}) {
  const content = panelContent[mode];
  const items =
    mode === "admin" && !isAdmin
      ? []
      : content.items;

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="border-b border-border/70 px-3 py-2">
        <p className="text-[0.68rem] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
          {content.label}
        </p>
        <h2 className="text-sm font-semibold">{content.title}</h2>
        <p className="mt-1 text-xs leading-5 text-muted-foreground">
          {content.description}
        </p>
      </div>

      <nav className="grid gap-1 px-2 py-2">
        {items.length > 0 ? (
          items.map((item) => {
            const Icon = item.icon;
            const active = activeHref === item.href;

            return (
              <Link
                key={item.href}
                href={item.href}
                className={cn(
                  "grid grid-cols-[1rem_1fr] gap-x-2 rounded-[5px] px-2 py-2 text-sm transition hover:bg-sidebar-accent hover:text-sidebar-accent-foreground",
                  active
                    ? "bg-sidebar-accent text-sidebar-accent-foreground"
                    : "text-muted-foreground",
                )}
              >
                <Icon className="mt-0.5 size-3.5" />
                <span className="min-w-0">
                  <span className="block truncate font-medium">{item.label}</span>
                  <span className="mt-0.5 block text-xs leading-4 opacity-70">
                    {item.description}
                  </span>
                </span>
              </Link>
            );
          })
        ) : (
          <p className="px-2 py-2 text-xs text-muted-foreground">
            Admin tools are only available to admin accounts.
          </p>
        )}
      </nav>
    </div>
  );
}
