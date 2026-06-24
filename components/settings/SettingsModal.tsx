"use client";

import { useEffect, useMemo, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import {
  Blocks,
  Command,
  FileImage,
  Keyboard,
  MonitorCog,
  Paintbrush,
  Settings2,
  SlidersHorizontal,
  UserRound,
  Wrench,
} from "lucide-react";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";

type SettingsSectionId =
  | "account"
  | "workspace"
  | "editor"
  | "appearance"
  | "files-assets"
  | "hotkeys"
  | "core-features"
  | "extension-browser"
  | "installed-extensions"
  | "advanced";

type SettingsModalProps = {
  accountSection: ReactNode;
  workspaceSection?: ReactNode;
  editorSection?: ReactNode;
  appearanceSection?: ReactNode;
  filesAssetsSection?: ReactNode;
  hotkeysSection?: ReactNode;
  coreFeaturesSection?: ReactNode;
  extensionBrowserSection?: ReactNode;
  installedExtensionsSection?: ReactNode;
  advancedSection?: ReactNode;
  defaultSection?: SettingsSectionId;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  closeHref?: string;
};

const settingsSections: Array<{
  id: SettingsSectionId;
  label: string;
  description: string;
  icon: typeof UserRound;
}> = [
  {
    id: "account",
    label: "Account",
    description: "Profile, OAuth providers, and sign out.",
    icon: UserRound,
  },
  {
    id: "workspace",
    label: "Workspace",
    description: "Tabs, panels, and app behavior.",
    icon: MonitorCog,
  },
  {
    id: "editor",
    label: "Editor",
    description: "Markdown editing defaults.",
    icon: SlidersHorizontal,
  },
  {
    id: "appearance",
    label: "Appearance",
    description: "Themes, fonts, and document presentation.",
    icon: Paintbrush,
  },
  {
    id: "files-assets",
    label: "Files & assets",
    description: "Uploads, embeds, and asset defaults.",
    icon: FileImage,
  },
  {
    id: "hotkeys",
    label: "Hotkeys",
    description: "Commands and shortcut conflicts.",
    icon: Keyboard,
  },
  {
    id: "core-features",
    label: "Core features",
    description: "Built-in editor and workspace capabilities.",
    icon: Settings2,
  },
  {
    id: "extension-browser",
    label: "Extension browser",
    description: "Browse local built-in extensions.",
    icon: Blocks,
  },
  {
    id: "installed-extensions",
    label: "Installed extensions",
    description: "Enabled extensions and their settings.",
    icon: Command,
  },
  {
    id: "advanced",
    label: "Advanced",
    description: "Diagnostics and reset controls.",
    icon: Wrench,
  },
];

export function SettingsModal({
  accountSection,
  workspaceSection,
  editorSection,
  appearanceSection,
  filesAssetsSection,
  hotkeysSection,
  coreFeaturesSection,
  extensionBrowserSection,
  installedExtensionsSection,
  advancedSection,
  defaultSection = "account",
  open: controlledOpen,
  onOpenChange,
  closeHref,
}: SettingsModalProps) {
  const router = useRouter();
  const [uncontrolledOpen, setUncontrolledOpen] = useState(true);
  const [activeSection, setActiveSection] =
    useState<SettingsSectionId>(defaultSection);
  const open = controlledOpen ?? uncontrolledOpen;
  const section = useMemo(
    () =>
      settingsSections.find((candidate) => candidate.id === activeSection) ??
      settingsSections[0],
    [activeSection],
  );

  useEffect(() => {
    setActiveSection(defaultSection);
  }, [defaultSection]);

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
        className="grid h-[min(82vh,760px)] w-[min(72rem,calc(100vw-2rem))] max-w-none grid-cols-[15.5rem_minmax(0,1fr)] gap-0 overflow-hidden rounded-[8px] border border-border/80 bg-background p-0 shadow-2xl sm:max-w-none"
        showCloseButton
      >
        <aside className="min-h-0 border-r border-border/70 bg-sidebar/80">
          <div className="border-b border-border/70 px-4 py-3">
            <p className="text-[0.68rem] font-semibold uppercase tracking-[0.2em] text-muted-foreground">
              Vault
            </p>
            <h2 className="mt-1 text-base font-semibold">Settings</h2>
          </div>
          <nav className="min-h-0 overflow-y-auto px-2 py-2">
            {settingsSections.map((item) => {
              const Icon = item.icon;
              const active = item.id === activeSection;

              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => setActiveSection(item.id)}
                  className={cn(
                    "grid w-full grid-cols-[1rem_1fr] gap-x-2 rounded-[5px] px-2 py-2 text-left text-sm transition",
                    active
                      ? "bg-sidebar-accent text-sidebar-accent-foreground"
                      : "text-muted-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground",
                  )}
                >
                  <Icon className="mt-0.5 size-3.5" />
                  <span className="min-w-0">
                    <span className="block truncate font-medium">
                      {item.label}
                    </span>
                    <span className="mt-0.5 block text-xs leading-4 opacity-70">
                      {item.description}
                    </span>
                  </span>
                </button>
              );
            })}
          </nav>
        </aside>

        <main className="min-h-0 overflow-y-auto">
          <div className="border-b border-border/70 px-6 py-4">
            <DialogHeader>
              <DialogTitle className="text-2xl vault-display">
                {section.label}
              </DialogTitle>
              <DialogDescription>{section.description}</DialogDescription>
            </DialogHeader>
          </div>
          <div className="px-6 py-5">
            {activeSection === "account" ? (
              accountSection
            ) : activeSection === "workspace" && workspaceSection ? (
              workspaceSection
            ) : activeSection === "editor" && editorSection ? (
              editorSection
            ) : activeSection === "appearance" && appearanceSection ? (
              appearanceSection
            ) : activeSection === "files-assets" && filesAssetsSection ? (
              filesAssetsSection
            ) : activeSection === "hotkeys" && hotkeysSection ? (
              hotkeysSection
            ) : activeSection === "core-features" && coreFeaturesSection ? (
              coreFeaturesSection
            ) : activeSection === "extension-browser" &&
              extensionBrowserSection ? (
              extensionBrowserSection
            ) : activeSection === "installed-extensions" &&
              installedExtensionsSection ? (
              installedExtensionsSection
            ) : activeSection === "advanced" && advancedSection ? (
              advancedSection
            ) : (
              <SettingsPlaceholder section={section.label} />
            )}
          </div>
        </main>
      </DialogContent>
    </Dialog>
  );
}

function SettingsPlaceholder({ section }: { section: string }) {
  return (
    <div className="border border-dashed border-border/70 bg-card/35 p-6">
      <p className="text-sm font-medium">{section} settings are planned.</p>
      <p className="mt-2 max-w-2xl text-sm leading-6 text-muted-foreground">
        This section is part of the settings and extension-browser checkpoint.
        The modal shell is in place first so persistence, theme controls,
        extension enablement, and generated extension settings can land in
        focused slices.
      </p>
    </div>
  );
}
