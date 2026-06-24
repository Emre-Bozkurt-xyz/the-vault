import type { CompletionSource } from "@codemirror/autocomplete";
import type { EditorState, Extension, Range, StateEffect } from "@codemirror/state";
import type { Decoration, KeyBinding, WidgetType } from "@codemirror/view";
import type { ZodType } from "zod";

import type { AssetEmbedResolutionMap } from "@/lib/asset-embeds";
import type { WikiLinkResolutionMap } from "@/lib/wiki-links";

export type VaultExtensionKind = "core" | "built-in";
export type VaultExtensionCategory =
  | "editor"
  | "document"
  | "workspace"
  | "assets"
  | "visual";

export type ExtensionPermission =
  | "document:read"
  | "document:write"
  | "document:write-extension-state"
  | "asset:read"
  | "asset:write"
  | "workspace:panel"
  | "workspace:page";

export type ExtensionStateVisibility = "private" | "public" | "editor-only";

export type ExtensionStateValue =
  | null
  | boolean
  | number
  | string
  | ExtensionStateValue[]
  | { [key: string]: ExtensionStateValue };

export type ExtensionDocumentContext = {
  id: string;
  canRead: boolean;
  canEdit: boolean;
};

export type ExtensionUserContext = {
  id: string;
  role: "user" | "admin";
} | null;

export type ExtensionRuntimeContext = {
  document: ExtensionDocumentContext;
  user: ExtensionUserContext;
  assets: ExtensionAssetApi;
  state: ExtensionStateApi;
};

export type ExtensionAssetApi = {
  resolve: (assetId: string) => AssetEmbedResolutionMap[string] | null;
};

export type ExtensionStateApi = {
  get: (extensionId: string, stateKey?: string) => Promise<ExtensionStateValue | null>;
  set: (
    extensionId: string,
    state: ExtensionStateValue,
    options?: {
      stateKey?: string;
      visibility?: ExtensionStateVisibility;
      version?: number;
    },
  ) => Promise<void>;
};

export type LiveBlockInstance = {
  kind: string;
  from: number;
  to: number;
  startLine: number;
  endLine: number;
  source: string;
};

export type LiveBlockScanContext = {
  syntaxExclusions: Array<{ from: number; to: number }>;
  occupiedRanges: Array<{ from: number; to: number }>;
};

export type LiveBlockWidgetContext = {
  assetLinks: AssetEmbedResolutionMap;
  wikiLinks?: WikiLinkResolutionMap;
};

export type LiveBlockSpec<
  TBlock extends LiveBlockInstance = LiveBlockInstance,
  TContext extends LiveBlockWidgetContext = LiveBlockWidgetContext,
> = {
  id: TBlock["kind"];
  priority: number;
  scan: (state: EditorState, context: LiveBlockScanContext) => TBlock[];
  isActive?: (state: EditorState, block: TBlock) => boolean;
  widget: (block: TBlock, context: TContext) => WidgetType;
  activeDecorations?: (
    state: EditorState,
    block: TBlock,
    context: TContext,
  ) => Range<Decoration>[];
  activeExtensions?: (state: EditorState, block: TBlock, context: TContext) => Extension[];
  effects?: (state: EditorState, block: TBlock, context: TContext) => StateEffect<unknown>[];
};

export type MarkdownPreprocessor = (markdown: string, context: ExtensionRuntimeContext) => string;

export type MarkdownRendererContribution = {
  id: string;
  priority: number;
};

export type CompletionContribution = {
  id: string;
  source: CompletionSource;
};

export type ToolbarContribution = {
  id: string;
  label: string;
};

export type ExtensionStateSchema = {
  extensionId: string;
  stateKey?: string;
  version: number;
  schema: ZodType<ExtensionStateValue>;
};

export type DocumentOverlayContribution = {
  id: string;
};

export type DocumentInspectorContribution = {
  id: string;
};

export type WorkspacePageContribution = {
  id: string;
  href: string;
  label: string;
};

export type WorkspacePanelContribution = {
  id: string;
  label: string;
};

export type CommandContribution = {
  id: string;
  label: string;
  description?: string;
  sourceExtensionId?: string;
  defaultKeymap?: KeyBinding[];
  keymap?: KeyBinding[];
};

export type ExtensionSettingsSection = {
  id: string;
  label: string;
  fields: ExtensionSettingsField[];
};

export type ExtensionSettingsField =
  | {
      type: "toggle";
      key: string;
      label: string;
      description?: string;
    }
  | {
      type: "select";
      key: string;
      label: string;
      description?: string;
      options: Array<{ label: string; value: string }>;
    }
  | {
      type: "number";
      key: string;
      label: string;
      description?: string;
      min?: number;
      max?: number;
      step?: number;
    }
  | {
      type: "text";
      key: string;
      label: string;
      description?: string;
      placeholder?: string;
    };

export type VaultExtension = {
  id: string;
  name: string;
  version: number;
  kind: VaultExtensionKind;
  description?: string;
  category?: VaultExtensionCategory;
  permissions?: ExtensionPermission[];
  defaultEnabled?: boolean;
  settings?: {
    schema?: ZodType<Record<string, unknown>>;
    defaults?: Record<string, unknown>;
    sections?: ExtensionSettingsSection[];
  };
  markdown?: {
    liveBlocks?: LiveBlockSpec[];
    preprocessors?: MarkdownPreprocessor[];
    renderers?: MarkdownRendererContribution[];
    completions?: CompletionContribution[];
    toolbarItems?: ToolbarContribution[];
  };
  documentState?: {
    schemas: ExtensionStateSchema[];
    overlays?: DocumentOverlayContribution[];
    inspectors?: DocumentInspectorContribution[];
  };
  workspace?: {
    pages?: WorkspacePageContribution[];
    panels?: WorkspacePanelContribution[];
    commands?: CommandContribution[];
  };
};
