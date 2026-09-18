"use client";

import { useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import {
  Blocks,
  FileImage,
  Keyboard,
  MonitorCog,
  Paintbrush,
  Settings2,
  SlidersHorizontal,
  Sparkles,
  UserRound,
  Wrench,
} from "lucide-react";

import { SettingsNavigationContext } from "@/components/settings/settings-navigation";
import type {
  SettingsIconKey,
  SettingsPage,
} from "@/components/settings/settings-pages";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";

const icons: Record<SettingsIconKey, typeof UserRound> = {
  account: UserRound,
  workspace: MonitorCog,
  editor: SlidersHorizontal,
  appearance: Paintbrush,
  snippets: Sparkles,
  "files-assets": FileImage,
  hotkeys: Keyboard,
  "core-features": Settings2,
  extensions: Blocks,
  advanced: Wrench,
};

type SettingsModalProps = {
  pages: SettingsPage[];
  /** The page shown first when the active page is not controlled. */
  defaultPageId?: string;
  /** Controlled active page; pair with `onActivePageChange`. */
  activePageId?: string;
  onActivePageChange?: (pageId: string) => void;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  closeHref?: string;
};

export function SettingsModal({
  pages,
  defaultPageId,
  activePageId: controlledPageId,
  onActivePageChange,
  open: controlledOpen,
  onOpenChange,
  closeHref,
}: SettingsModalProps) {
  const router = useRouter();
  const [uncontrolledOpen, setUncontrolledOpen] = useState(true);
  const [uncontrolledPageId, setUncontrolledPageId] = useState(
    defaultPageId ?? pages[0]?.id ?? "",
  );
  const open = controlledOpen ?? uncontrolledOpen;
  const requestedPageId = controlledPageId ?? uncontrolledPageId;
  // Falls back to the first page when the requested one no longer exists — an
  // extension's page disappears the moment it is disabled from inside the modal.
  const page = pages.find((candidate) => candidate.id === requestedPageId) ?? pages[0];
  const corePages = pages.filter((candidate) => candidate.group === "core");
  const extensionPages = pages.filter(
    (candidate) => candidate.group === "extensions",
  );

  function goTo(pageId: string) {
    if (controlledPageId === undefined) {
      setUncontrolledPageId(pageId);
    }

    onActivePageChange?.(pageId);
  }

  function handleOpenChange(nextOpen: boolean) {
    if (controlledOpen === undefined) {
      setUncontrolledOpen(nextOpen);
    }

    onOpenChange?.(nextOpen);

    if (!nextOpen && closeHref) {
      router.push(closeHref);
    }
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent
        className="grid h-[min(88dvh,760px)] w-[min(72rem,calc(100vw-1.5rem))] max-w-none grid-rows-[auto_minmax(0,1fr)] grid-cols-1 gap-0 overflow-hidden rounded-[8px] border border-border/80 bg-background p-0 shadow-2xl sm:max-w-none md:grid-cols-[14rem_minmax(0,1fr)] md:grid-rows-1"
        showCloseButton
      >
        <aside className="min-h-0 min-w-0 border-b border-border/70 bg-sidebar/80 md:border-r md:border-b-0">
          <div className="border-b border-border/70 px-4 py-3">
            <p className="text-[0.68rem] font-semibold uppercase tracking-[0.2em] text-muted-foreground">
              Vault
            </p>
            <h2 className="mt-1 text-base font-semibold">Settings</h2>
          </div>
          {/* A horizontal, scrollable strip on mobile; a vertical list at md+. */}
          <nav className="flex min-h-0 items-center gap-1 overflow-x-auto px-2 py-2 md:block md:overflow-y-auto">
            {corePages.map((item) => {
              const Icon = item.icon ? icons[item.icon] : null;

              return (
                <NavButton
                  key={item.id}
                  active={item.id === page?.id}
                  onClick={() => goTo(item.id)}
                >
                  {Icon ? <Icon className="size-3.5 shrink-0" /> : null}
                  <span className="truncate">{item.label}</span>
                </NavButton>
              );
            })}

            {extensionPages.length > 0 ? (
              <>
                {/* The extension group reads as separate from the app's own
                    settings: a rule, a small label, and no icons. */}
                <div
                  aria-hidden="true"
                  className="mx-1 h-5 w-px shrink-0 bg-border/70 md:mx-2 md:mt-3 md:mb-1 md:h-px md:w-auto"
                />
                <p className="hidden px-2 pt-1 pb-1 text-[0.64rem] font-semibold uppercase tracking-[0.18em] text-muted-foreground/80 md:block">
                  Extensions
                </p>
                {extensionPages.map((item) => (
                  <NavButton
                    key={item.id}
                    active={item.id === page?.id}
                    onClick={() => goTo(item.id)}
                    quiet
                  >
                    <span className="truncate">{item.label}</span>
                  </NavButton>
                ))}
              </>
            ) : null}
          </nav>
        </aside>

        <main className="min-h-0 min-w-0 overflow-x-hidden overflow-y-auto">
          {page ? (
            <>
              <div className="border-b border-border/70 px-4 py-4 md:px-6">
                <DialogHeader>
                  <DialogTitle className="text-xl font-semibold tracking-tight md:text-2xl">
                    {page.label}
                  </DialogTitle>
                  {/* Wraps: an extension writes its own description, and
                      clipping it to one line hides the end of the sentence. */}
                  <DialogDescription className="max-w-3xl text-pretty">
                    {page.description}
                  </DialogDescription>
                </DialogHeader>
              </div>
              <div className="px-4 py-4 md:px-6 md:py-5">
                <SettingsNavigationContext.Provider value={goTo}>
                  {page.content}
                </SettingsNavigationContext.Provider>
              </div>
            </>
          ) : null}
        </main>
      </DialogContent>
    </Dialog>
  );
}

function NavButton({
  active,
  quiet = false,
  onClick,
  children,
}: {
  active: boolean;
  /** Extension pages: no icon column, so their labels line up with core labels. */
  quiet?: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-current={active ? "page" : undefined}
      className={cn(
        "flex shrink-0 items-center gap-2 whitespace-nowrap rounded-[5px] px-2 py-1.5 text-left text-sm transition md:w-full",
        quiet && "md:pl-[1.875rem]",
        active
          ? "bg-sidebar-accent font-medium text-sidebar-accent-foreground"
          : "text-muted-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground",
      )}
    >
      {children}
    </button>
  );
}
