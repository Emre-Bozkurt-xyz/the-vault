import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

const widths = {
  narrow: "max-w-3xl",
  default: "max-w-6xl",
  wide: "max-w-7xl",
  full: "max-w-none",
} as const;

/**
 * Standard frame for a workspace page. The shell gives pages no padding of
 * their own (documents manage their own measure), so every other page uses
 * this to get the same gutters whether the side panels are open or not: a
 * centered column that never runs edge to edge against a panel.
 */
export function WorkspacePage({
  width = "default",
  className,
  children,
}: {
  width?: keyof typeof widths;
  className?: string;
  children: ReactNode;
}) {
  return (
    <section
      className={cn(
        "mx-auto w-full px-4 py-6 sm:px-6 lg:px-8 lg:py-8 xl:px-10",
        widths[width],
        className,
      )}
    >
      {children}
    </section>
  );
}
