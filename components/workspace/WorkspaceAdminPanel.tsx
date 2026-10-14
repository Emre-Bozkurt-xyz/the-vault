"use client";

import {
  BookOpen,
  Hash,
  HardDrive,
  LayoutDashboard,
  ShieldCheck,
  Users,
} from "lucide-react";

import {
  SidePanel,
  SidePanelBody,
  SidePanelEmpty,
  SidePanelHeader,
  SidePanelNavItem,
  SidePanelSection,
  useActiveHref,
} from "@/components/workspace/SidePanel";

const SECTIONS = [
  {
    title: "Dashboard",
    items: [
      {
        label: "Overview",
        href: "/dashboard/admin",
        detail: "Metrics and recent signups",
        icon: LayoutDashboard,
        prefix: false,
      },
    ],
  },
  {
    title: "Manage",
    items: [
      {
        label: "Users",
        href: "/dashboard/admin/users",
        detail: "Roles, bans, grants, quotas",
        icon: Users,
        prefix: true,
      },
      {
        label: "Assets",
        href: "/dashboard/admin/assets",
        detail: "Storage, upload limits, moderation",
        icon: HardDrive,
        prefix: true,
      },
      {
        label: "Tags",
        href: "/dashboard/admin/tags",
        detail: "Canonical tags and aliases",
        icon: Hash,
        prefix: true,
      },
    ],
  },
  {
    title: "Content",
    items: [
      {
        label: "Official docs",
        href: "/dashboard/admin/docs",
        detail: "Publish user-facing guides",
        icon: BookOpen,
        prefix: true,
      },
    ],
  },
] as const;

/** Admin mode of the left panel: the admin dashboard's sections. */
export function WorkspaceAdminPanel({ isAdmin }: { isAdmin: boolean }) {
  const isActive = useActiveHref();

  return (
    <SidePanel>
      <SidePanelHeader icon={ShieldCheck} title="Admin" subtitle="Moderation and publishing" />
      <SidePanelBody>
        {isAdmin ? (
          SECTIONS.map((section) => (
            <SidePanelSection key={section.title} title={section.title}>
              {section.items.map((item) => (
                <SidePanelNavItem
                  key={item.href}
                  href={item.href}
                  icon={item.icon}
                  label={item.label}
                  detail={item.detail}
                  active={isActive(item.href, { prefix: item.prefix })}
                />
              ))}
            </SidePanelSection>
          ))
        ) : (
          <SidePanelEmpty>Admin tools are only available to admin accounts.</SidePanelEmpty>
        )}
      </SidePanelBody>
    </SidePanel>
  );
}
