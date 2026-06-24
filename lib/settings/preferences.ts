import type { Theme } from "@/components/theme-provider";

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
    commandPaletteShortcut: "mod-k" | "mod-shift-p" | "off";
    vimMode: boolean;
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
    hotkeys: {
      editorShortcutsEnabled: readBoolean(
        get("hotkeys", "defaults").editorShortcutsEnabled,
        true,
      ),
      commandPaletteShortcut: readEnum(
        get("hotkeys", "defaults").commandPaletteShortcut,
        ["mod-k", "mod-shift-p", "off"],
        "mod-k",
      ),
      vimMode: readBoolean(get("hotkeys", "defaults").vimMode, false),
    },
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
