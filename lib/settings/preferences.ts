import type { Theme } from "@/components/theme-provider";
import { canonicalizeBinding, isValidBinding } from "@/lib/shortcuts/binding";
import { isShortcutId } from "@/lib/shortcuts/registry";

export type UserSettingRows = Array<{
  namespace: string;
  key: string;
  value: Record<string, unknown>;
}>;

export type Preferences = {
  appearance: {
    themeId: Theme;
    accentColor: "neutral" | "blue" | "green" | "rose";
    editorFontSize: number;
    readingFontSize: number;
    monospaceFont: "geist" | "system" | "serif";
    readableLineLength: boolean;
  };
  workspace: {
    restoreTabs: boolean;
    rememberPanels: boolean;
    openLinksInNewTab: boolean;
    defaultPanel: "files" | "search" | "gallery" | "assets" | "docs";
  };
  editor: {
    defaultMode: "live" | "read" | "source";
    lineNumbers: boolean;
    readableLineLength: boolean;
    autoSaveDelayMs: number;
    spellcheck: boolean;
  };
  filesAssets: {
    defaultImageLayout: "block" | "wrap" | "inline";
    defaultImageWidth: "small" | "medium" | "large" | "full";
    copyEmbedsWithTitle: boolean;
    openPdfsInNewTab: boolean;
    showPrivatePublishWarning: boolean;
  };
  hotkeys: {
    editorShortcutsEnabled: boolean;
    vimMode: boolean;
    /** Sparse per-shortcut overrides keyed by registry id (null = disabled). */
    keybindings: Record<string, string | null>;
  };
  coreFeatures: {
    livePreview: boolean;
    wikiLinks: boolean;
    assetEmbeds: boolean;
    callouts: boolean;
    math: boolean;
    documentEmbeds: boolean;
  };
  advanced: {
    debugHistoryRestore: boolean;
    confirmDestructiveActions: boolean;
    reduceMotion: boolean;
  };
};

export function buildPreferences(rows: UserSettingRows): Preferences {
  const get = (namespace: string, key: string) =>
    rows.find((row) => row.namespace === namespace && row.key === key)?.value ??
    {};

  return {
    appearance: {
      themeId: readEnum(
        get("appearance", "theme").themeId,
        ["dark", "light", "midnight", "graphite", "paper", "system"],
        "dark",
      ),
      accentColor: readEnum(
        get("appearance", "theme").accentColor,
        ["neutral", "blue", "green", "rose"],
        "neutral",
      ),
      editorFontSize: readNumber(get("appearance", "theme").editorFontSize, 16),
      readingFontSize: readNumber(get("appearance", "theme").readingFontSize, 18),
      monospaceFont: readEnum(
        get("appearance", "theme").monospaceFont,
        ["geist", "system", "serif"],
        "geist",
      ),
      readableLineLength: readBoolean(
        get("appearance", "theme").readableLineLength,
        true,
      ),
    },
    workspace: {
      restoreTabs: readBoolean(get("workspace", "defaults").restoreTabs, true),
      rememberPanels: readBoolean(get("workspace", "defaults").rememberPanels, true),
      openLinksInNewTab: readBoolean(
        get("workspace", "defaults").openLinksInNewTab,
        false,
      ),
      defaultPanel: readEnum(
        get("workspace", "defaults").defaultPanel,
        ["files", "search", "gallery", "assets", "docs"],
        "files",
      ),
    },
    editor: {
      defaultMode: readEnum(
        get("editor", "defaults").defaultMode,
        ["live", "read", "source"],
        "live",
      ),
      lineNumbers: readBoolean(get("editor", "defaults").lineNumbers, false),
      readableLineLength: readBoolean(
        get("editor", "defaults").readableLineLength,
        true,
      ),
      autoSaveDelayMs: readNumber(
        get("editor", "defaults").autoSaveDelayMs,
        900,
      ),
      spellcheck: readBoolean(get("editor", "defaults").spellcheck, true),
    },
    filesAssets: {
      defaultImageLayout: readEnum(
        get("files-assets", "defaults").defaultImageLayout,
        ["block", "wrap", "inline"],
        "block",
      ),
      defaultImageWidth: readEnum(
        get("files-assets", "defaults").defaultImageWidth,
        ["small", "medium", "large", "full"],
        "large",
      ),
      copyEmbedsWithTitle: readBoolean(
        get("files-assets", "defaults").copyEmbedsWithTitle,
        true,
      ),
      openPdfsInNewTab: readBoolean(
        get("files-assets", "defaults").openPdfsInNewTab,
        true,
      ),
      showPrivatePublishWarning: readBoolean(
        get("files-assets", "defaults").showPrivatePublishWarning,
        true,
      ),
    },
    hotkeys: readHotkeys(get("hotkeys", "defaults")),
    coreFeatures: {
      livePreview: readBoolean(
        get("workspace", "core-features").livePreview,
        true,
      ),
      wikiLinks: readBoolean(get("workspace", "core-features").wikiLinks, true),
      assetEmbeds: readBoolean(
        get("workspace", "core-features").assetEmbeds,
        true,
      ),
      callouts: readBoolean(get("workspace", "core-features").callouts, true),
      math: readBoolean(get("workspace", "core-features").math, true),
      documentEmbeds: readBoolean(
        get("workspace", "core-features").documentEmbeds,
        true,
      ),
    },
    advanced: {
      debugHistoryRestore: readBoolean(
        get("advanced", "defaults").debugHistoryRestore,
        false,
      ),
      confirmDestructiveActions: readBoolean(
        get("advanced", "defaults").confirmDestructiveActions,
        true,
      ),
      reduceMotion: readBoolean(get("advanced", "defaults").reduceMotion, false),
    },
  };
}

function readHotkeys(raw: Record<string, unknown>): Preferences["hotkeys"] {
  const keybindings = readKeybindings(raw.keybindings);

  // Migrate the legacy `commandPaletteShortcut` enum into the keybindings map so
  // existing rows keep their palette shortcut. "mod-k" is the default (no override).
  if (!("global.commandPalette" in keybindings)) {
    if (raw.commandPaletteShortcut === "off") {
      keybindings["global.commandPalette"] = null;
    } else if (raw.commandPaletteShortcut === "mod-shift-p") {
      keybindings["global.commandPalette"] = "Mod-Shift-p";
    }
  }

  return {
    editorShortcutsEnabled: readBoolean(raw.editorShortcutsEnabled, true),
    vimMode: readBoolean(raw.vimMode, false),
    keybindings,
  };
}

function readKeybindings(value: unknown): Record<string, string | null> {
  const result: Record<string, string | null> = {};

  if (value && typeof value === "object" && !Array.isArray(value)) {
    for (const [id, binding] of Object.entries(
      value as Record<string, unknown>,
    )) {
      if (!isShortcutId(id)) {
        continue;
      }

      if (binding === null) {
        result[id] = null;
      } else if (typeof binding === "string" && isValidBinding(binding)) {
        result[id] = canonicalizeBinding(binding) ?? binding;
      }
    }
  }

  return result;
}

function readBoolean(value: unknown, fallback: boolean) {
  return typeof value === "boolean" ? value : fallback;
}

function readNumber(value: unknown, fallback: number) {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function readEnum<const T extends readonly string[]>(
  value: unknown,
  allowed: T,
  fallback: T[number],
): T[number] {
  return typeof value === "string" && allowed.includes(value)
    ? value
    : fallback;
}
