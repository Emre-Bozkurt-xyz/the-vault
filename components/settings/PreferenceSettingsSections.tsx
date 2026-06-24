"use client";

import { useState, useTransition, type ReactNode } from "react";
import {
  AlertTriangle,
  Braces,
  Command,
  FileImage,
  Keyboard,
  MonitorCog,
  Paintbrush,
  SlidersHorizontal,
} from "lucide-react";

import { Input } from "@/components/ui/input";
import { useVaultTheme, type Theme } from "@/components/theme-provider";
import type { Preferences } from "@/lib/settings/preferences";
import {
  saveAdvancedSettingsAction,
  saveAppearanceSettingsAction,
  saveCoreFeaturesSettingsAction,
  saveEditorSettingsAction,
  saveFilesAssetsSettingsAction,
  saveHotkeysSettingsAction,
  saveWorkspaceSettingsAction,
} from "@/server/user-settings-actions";

type Option = [string, string];

export function AppearanceSettingsSection({
  preferences,
}: {
  preferences: Preferences["appearance"];
}) {
  const { setTheme } = useVaultTheme();
  const [state, setState] = useState(preferences);
  const [isPending, startTransition] = useTransition();

  function update(next: Preferences["appearance"]) {
    setState(next);
    setTheme(next.themeId);
    startTransition(() => void saveAppearanceSettingsAction(next));
  }

  return (
    <SettingsGroup
      icon={<Paintbrush className="size-4" />}
      title="Appearance"
      description="Theme and document presentation defaults."
      saving={isPending}
    >
      <SettingRow title="Theme" description="Controls the workspace color scheme.">
        <SelectControl
          value={state.themeId}
          onChange={(themeId) => update({ ...state, themeId: themeId as Theme })}
          options={[
            ["dark", "Dark"],
            ["light", "Light"],
            ["midnight", "Midnight"],
            ["graphite", "Graphite"],
            ["paper", "Paper"],
            ["system", "System"],
          ]}
        />
      </SettingRow>
      <SettingRow title="Accent color" description="Reserved for buttons, focus rings, and selected states.">
        <SelectControl
          value={state.accentColor}
          onChange={(accentColor) =>
            update({
              ...state,
              accentColor: accentColor as Preferences["appearance"]["accentColor"],
            })
          }
          options={[
            ["neutral", "Neutral"],
            ["blue", "Blue"],
            ["green", "Green"],
            ["rose", "Rose"],
          ]}
        />
      </SettingRow>
      <SettingRow title="Editor font size" description="Default text size for editable Markdown.">
        <NumberControl
          value={state.editorFontSize}
          min={13}
          max={22}
          onChange={(editorFontSize) => update({ ...state, editorFontSize })}
        />
      </SettingRow>
      <SettingRow title="Reading font size" description="Default text size for rendered documents.">
        <NumberControl
          value={state.readingFontSize}
          min={14}
          max={24}
          onChange={(readingFontSize) => update({ ...state, readingFontSize })}
        />
      </SettingRow>
      <SettingRow title="Monospace font" description="Source editor and code font preference.">
        <SelectControl
          value={state.monospaceFont}
          onChange={(monospaceFont) =>
            update({
              ...state,
              monospaceFont:
                monospaceFont as Preferences["appearance"]["monospaceFont"],
            })
          }
          options={[
            ["geist", "Geist Mono"],
            ["system", "System mono"],
            ["serif", "Serif source"],
          ]}
        />
      </SettingRow>
      <SettingRow title="Readable line length" description="Limit document width for longer reading sessions.">
        <ToggleControl
          checked={state.readableLineLength}
          onChange={(readableLineLength) =>
            update({ ...state, readableLineLength })
          }
        />
      </SettingRow>
    </SettingsGroup>
  );
}

export function WorkspaceSettingsSection({
  preferences,
}: {
  preferences: Preferences["workspace"];
}) {
  const [state, setState] = useState(preferences);
  const [isPending, startTransition] = useTransition();

  function update(next: Preferences["workspace"]) {
    setState(next);
    startTransition(() => void saveWorkspaceSettingsAction(next));
  }

  return (
    <SettingsGroup
      icon={<MonitorCog className="size-4" />}
      title="Workspace"
      description="Tabs, panels, and navigation behavior."
      saving={isPending}
    >
      <SettingRow title="Restore open tabs" description="Bring back workspace tabs after reload.">
        <ToggleControl
          checked={state.restoreTabs}
          onChange={(restoreTabs) => update({ ...state, restoreTabs })}
        />
      </SettingRow>
      <SettingRow title="Remember panels" description="Restore panel widths and collapsed state.">
        <ToggleControl
          checked={state.rememberPanels}
          onChange={(rememberPanels) => update({ ...state, rememberPanels })}
        />
      </SettingRow>
      <SettingRow title="Open links in new tab" description="Prefer new workspace tabs for internal links.">
        <ToggleControl
          checked={state.openLinksInNewTab}
          onChange={(openLinksInNewTab) =>
            update({ ...state, openLinksInNewTab })
          }
        />
      </SettingRow>
      <SettingRow title="Default left panel" description="Panel selected when no route implies one.">
        <SelectControl
          value={state.defaultPanel}
          onChange={(defaultPanel) =>
            update({
              ...state,
              defaultPanel:
                defaultPanel as Preferences["workspace"]["defaultPanel"],
            })
          }
          options={[
            ["files", "Files"],
            ["search", "Search"],
            ["gallery", "Gallery"],
            ["assets", "Assets"],
            ["docs", "Docs"],
          ]}
        />
      </SettingRow>
    </SettingsGroup>
  );
}

export function EditorSettingsSection({
  preferences,
}: {
  preferences: Preferences["editor"];
}) {
  const [state, setState] = useState(preferences);
  const [isPending, startTransition] = useTransition();

  function update(next: Preferences["editor"]) {
    setState(next);
    startTransition(() => void saveEditorSettingsAction(next));
  }

  return (
    <SettingsGroup
      icon={<SlidersHorizontal className="size-4" />}
      title="Editor"
      description="Markdown editing defaults for new editor sessions."
      saving={isPending}
    >
      <SettingRow title="Default editor mode" description="The initial view for newly opened Markdown tabs.">
        <SelectControl
          value={state.defaultMode}
          onChange={(defaultMode) =>
            update({
              ...state,
              defaultMode: defaultMode as Preferences["editor"]["defaultMode"],
            })
          }
          options={[
            ["live", "Live"],
            ["read", "Read"],
            ["source", "Source"],
          ]}
        />
      </SettingRow>
      <SettingRow title="Line numbers" description="Show line numbers in source-style editing modes.">
        <ToggleControl
          checked={state.lineNumbers}
          onChange={(lineNumbers) => update({ ...state, lineNumbers })}
        />
      </SettingRow>
      <SettingRow title="Readable line length" description="Constrain the editor column width.">
        <ToggleControl
          checked={state.readableLineLength}
          onChange={(readableLineLength) =>
            update({ ...state, readableLineLength })
          }
        />
      </SettingRow>
      <SettingRow title="Browser spellcheck" description="Allow the browser to underline spelling issues.">
        <ToggleControl
          checked={state.spellcheck}
          onChange={(spellcheck) => update({ ...state, spellcheck })}
        />
      </SettingRow>
      <SettingRow title="Autosave delay" description="Delay in milliseconds before a quiet editor saves.">
        <NumberControl
          value={state.autoSaveDelayMs}
          min={300}
          max={5000}
          step={100}
          onChange={(autoSaveDelayMs) =>
            update({ ...state, autoSaveDelayMs })
          }
        />
      </SettingRow>
    </SettingsGroup>
  );
}

export function FilesAssetsSettingsSection({
  preferences,
}: {
  preferences: Preferences["filesAssets"];
}) {
  const [state, setState] = useState(preferences);
  const [isPending, startTransition] = useTransition();

  function update(next: Preferences["filesAssets"]) {
    setState(next);
    startTransition(() => void saveFilesAssetsSettingsAction(next));
  }

  return (
    <SettingsGroup
      icon={<FileImage className="size-4" />}
      title="Files & assets"
      description="Defaults for uploaded images, PDFs, and embed copy behavior."
      saving={isPending}
    >
      <SettingRow title="Default image layout" description="Layout applied when inserting uploaded images.">
        <SelectControl
          value={state.defaultImageLayout}
          onChange={(defaultImageLayout) =>
            update({
              ...state,
              defaultImageLayout:
                defaultImageLayout as Preferences["filesAssets"]["defaultImageLayout"],
            })
          }
          options={[
            ["block", "Block"],
            ["wrap", "Text wrap"],
            ["inline", "Inline"],
          ]}
        />
      </SettingRow>
      <SettingRow title="Default image width" description="Initial size for newly inserted image embeds.">
        <SelectControl
          value={state.defaultImageWidth}
          onChange={(defaultImageWidth) =>
            update({
              ...state,
              defaultImageWidth:
                defaultImageWidth as Preferences["filesAssets"]["defaultImageWidth"],
            })
          }
          options={[
            ["small", "Small"],
            ["medium", "Medium"],
            ["large", "Large"],
            ["full", "Full"],
          ]}
        />
      </SettingRow>
      <SettingRow title="Copy embeds with title" description="Use display names in copied asset embeds.">
        <ToggleControl
          checked={state.copyEmbedsWithTitle}
          onChange={(copyEmbedsWithTitle) =>
            update({ ...state, copyEmbedsWithTitle })
          }
        />
      </SettingRow>
      <SettingRow title="Open PDFs in new tab" description="Avoid replacing the workspace tab when opening PDFs.">
        <ToggleControl
          checked={state.openPdfsInNewTab}
          onChange={(openPdfsInNewTab) =>
            update({ ...state, openPdfsInNewTab })
          }
        />
      </SettingRow>
      <SettingRow title="Private embed warning" description="Warn before publishing docs that reference private assets.">
        <ToggleControl
          checked={state.showPrivatePublishWarning}
          onChange={(showPrivatePublishWarning) =>
            update({ ...state, showPrivatePublishWarning })
          }
        />
      </SettingRow>
    </SettingsGroup>
  );
}

export function HotkeysSettingsSection({
  preferences,
}: {
  preferences: Preferences["hotkeys"];
}) {
  const [state, setState] = useState(preferences);
  const [isPending, startTransition] = useTransition();

  function update(next: Preferences["hotkeys"]) {
    setState(next);
    startTransition(() => void saveHotkeysSettingsAction(next));
  }

  return (
    <SettingsGroup
      icon={<Keyboard className="size-4" />}
      title="Hotkeys"
      description="Command shortcuts and keyboard behavior."
      saving={isPending}
    >
      <SettingRow title="Editor shortcuts" description="Enable Markdown editing shortcuts.">
        <ToggleControl
          checked={state.editorShortcutsEnabled}
          onChange={(editorShortcutsEnabled) =>
            update({ ...state, editorShortcutsEnabled })
          }
        />
      </SettingRow>
      <SettingRow title="Command palette shortcut" description="Shortcut reserved for the future command palette.">
        <SelectControl
          value={state.commandPaletteShortcut}
          onChange={(commandPaletteShortcut) =>
            update({
              ...state,
              commandPaletteShortcut:
                commandPaletteShortcut as Preferences["hotkeys"]["commandPaletteShortcut"],
            })
          }
          options={[
            ["mod-k", "Ctrl/Cmd + K"],
            ["mod-shift-p", "Ctrl/Cmd + Shift + P"],
            ["off", "Off"],
          ]}
        />
      </SettingRow>
      <SettingRow title="Vim mode" description="Placeholder for future editor keymap support.">
        <ToggleControl
          checked={state.vimMode}
          onChange={(vimMode) => update({ ...state, vimMode })}
        />
      </SettingRow>
    </SettingsGroup>
  );
}

export function CoreFeaturesSettingsSection({
  preferences,
}: {
  preferences: Preferences["coreFeatures"];
}) {
  const [state, setState] = useState(preferences);
  const [isPending, startTransition] = useTransition();

  function update(next: Preferences["coreFeatures"]) {
    setState(next);
    startTransition(() => void saveCoreFeaturesSettingsAction(next));
  }

  return (
    <SettingsGroup
      icon={<Braces className="size-4" />}
      title="Core features"
      description="Core document features remain readable even when disabled later."
      saving={isPending}
    >
      {[
        ["livePreview", "Live preview blocks", "Rendered CM6 blocks in live mode."],
        ["wikiLinks", "Wiki links", "Internal links and document embeds."],
        ["assetEmbeds", "Asset embeds", "Uploaded asset embeds and groups."],
        ["callouts", "Callouts", "Obsidian-style callout blocks."],
        ["math", "Math", "LaTeX math rendering and previews."],
        ["documentEmbeds", "Document transclusions", "Embedded document cards."],
      ].map(([key, title, description]) => (
        <SettingRow key={key} title={title} description={description}>
          <ToggleControl
            checked={state[key as keyof Preferences["coreFeatures"]]}
            onChange={(value) =>
              update({ ...state, [key]: value })
            }
          />
        </SettingRow>
      ))}
    </SettingsGroup>
  );
}

export function AdvancedSettingsSection({
  preferences,
}: {
  preferences: Preferences["advanced"];
}) {
  const [state, setState] = useState(preferences);
  const [isPending, startTransition] = useTransition();

  function update(next: Preferences["advanced"]) {
    setState(next);
    startTransition(() => void saveAdvancedSettingsAction(next));
  }

  return (
    <SettingsGroup
      icon={<AlertTriangle className="size-4" />}
      title="Advanced"
      description="Diagnostics and safety defaults."
      saving={isPending}
    >
      <SettingRow title="History restore debug logs" description="Write workspace history restore diagnostics to the browser console.">
        <ToggleControl
          checked={state.debugHistoryRestore}
          onChange={(debugHistoryRestore) =>
            update({ ...state, debugHistoryRestore })
          }
        />
      </SettingRow>
      <SettingRow title="Confirm destructive actions" description="Prefer confirmation flows for delete, archive, and reset operations.">
        <ToggleControl
          checked={state.confirmDestructiveActions}
          onChange={(confirmDestructiveActions) =>
            update({ ...state, confirmDestructiveActions })
          }
        />
      </SettingRow>
      <SettingRow title="Reduce motion" description="Reduce optional transitions where supported.">
        <ToggleControl
          checked={state.reduceMotion}
          onChange={(reduceMotion) => update({ ...state, reduceMotion })}
        />
      </SettingRow>
    </SettingsGroup>
  );
}

export function CoreCommandsSettingsSection() {
  return (
    <SettingsGroup
      icon={<Command className="size-4" />}
      title="Commands"
      description="Current built-in command surface."
    >
      {[
        ["Create document", "Available from the file panel and new tab.", "Default"],
        ["Insert asset group", "Available from the Markdown toolbar.", "Default"],
        ["Create restore point", "Available from the document context panel.", "Default"],
      ].map(([title, description, value]) => (
        <SettingRow key={title} title={title} description={description}>
          <span className="text-sm text-muted-foreground">{value}</span>
        </SettingRow>
      ))}
    </SettingsGroup>
  );
}

function SettingsGroup({
  icon,
  title,
  description,
  saving,
  children,
}: {
  icon: ReactNode;
  title: string;
  description: string;
  saving?: boolean;
  children: ReactNode;
}) {
  return (
    <section className="grid gap-4">
      <div className="flex items-start justify-between gap-4">
        <div className="flex items-start gap-3">
          <div className="flex size-8 shrink-0 items-center justify-center rounded-[6px] border border-border/70 bg-card text-muted-foreground">
            {icon}
          </div>
          <div>
            <h3 className="text-lg font-semibold">{title}</h3>
            <p className="mt-1 text-sm text-muted-foreground">{description}</p>
          </div>
        </div>
        <span className="min-w-16 text-right text-xs text-muted-foreground">
          {saving ? "Saving..." : "Saved"}
        </span>
      </div>
      <div className="overflow-hidden rounded-[8px] border border-border/70 bg-card/45">
        {children}
      </div>
    </section>
  );
}

function SettingRow({
  title,
  description,
  children,
}: {
  title: string;
  description: string;
  children: ReactNode;
}) {
  return (
    <div className="grid gap-3 border-b border-border/70 px-4 py-4 last:border-b-0 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center">
      <div className="min-w-0">
        <p className="text-base font-medium">{title}</p>
        <p className="mt-1 max-w-2xl text-sm leading-5 text-muted-foreground">
          {description}
        </p>
      </div>
      <div className="flex min-w-32 justify-start sm:justify-end">{children}</div>
    </div>
  );
}

function ToggleControl({
  checked,
  onChange,
}: {
  checked: boolean;
  onChange: (checked: boolean) => void;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      onClick={() => onChange(!checked)}
      className={[
        "relative h-7 w-12 rounded-full border transition",
        checked
          ? "border-primary bg-primary"
          : "border-border bg-muted",
      ].join(" ")}
    >
      <span
        className={[
          "absolute top-1/2 size-5 -translate-y-1/2 rounded-full bg-background shadow transition",
          checked ? "left-[1.45rem]" : "left-1",
        ].join(" ")}
      />
    </button>
  );
}

function SelectControl({
  value,
  options,
  onChange,
}: {
  value: string;
  options: Option[];
  onChange: (value: string) => void;
}) {
  return (
    <select
      value={value}
      onChange={(event) => onChange(event.target.value)}
      className="h-9 min-w-36 rounded-[6px] border border-input bg-background px-2 text-sm outline-none transition focus:border-ring"
    >
      {options.map(([optionValue, label]) => (
        <option key={optionValue} value={optionValue}>
          {label}
        </option>
      ))}
    </select>
  );
}

function NumberControl({
  value,
  min,
  max,
  step = 1,
  onChange,
}: {
  value: number;
  min: number;
  max: number;
  step?: number;
  onChange: (value: number) => void;
}) {
  return (
    <Input
      type="number"
      min={min}
      max={max}
      step={step}
      value={value}
      onChange={(event) => onChange(Number(event.target.value))}
      className="w-28"
    />
  );
}
