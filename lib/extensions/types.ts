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

/**
 * State surface handed to an agent action handler. Unlike {@link ExtensionStateApi},
 * every method is pre-bound to the acting extension's id — a handler cannot name
 * (let alone touch) another extension's state. The server builds this; handlers
 * never import `db` or the permission-checked state functions directly.
 */
export type ExtensionAgentStateApi = {
  get: (stateKey?: string) => Promise<ExtensionStateValue | null>;
  set: (
    state: ExtensionStateValue,
    options?: {
      stateKey?: string;
      visibility?: ExtensionStateVisibility;
      version?: number;
    },
  ) => Promise<void>;
  list: () => Promise<
    Array<{
      stateKey: string;
      state: ExtensionStateValue;
      visibility: ExtensionStateVisibility;
      version: number;
    }>
  >;
  delete: (stateKey?: string) => Promise<void>;
};

/**
 * Read-only asset surface for an agent action. Async (unlike the client-side
 * {@link ExtensionAssetApi}, which reads a preloaded map), owner-scoped: `get`
 * resolves an asset the acting user owns, or null. Present only with `asset:read`.
 */
export type ExtensionAgentAssetApi = {
  get: (assetId: string) => Promise<{
    id: string;
    kind: "image" | "pdf";
    displayName: string;
    mimeType: string;
    visibility: "private" | "public";
  } | null>;
};

/**
 * Markdown surface for a document-scoped agent action. `read` is present with
 * `document:read`; the mutators (`append`/`insertAtHeading`/`edit`) are present
 * with `document:write` and go through the collab session (conflict-free, same
 * persistence/versioning path as the human editor).
 */
export type ExtensionAgentMarkdownApi = {
  read?: () => Promise<string>;
  append?: (markdown: string) => Promise<{ length: number }>;
  insertAtHeading?: (
    heading: string,
    markdown: string,
    position?: "section_start" | "section_end",
  ) => Promise<{ inserted: boolean }>;
  edit?: (
    edits: Array<{ oldString: string; newString: string }>,
  ) => Promise<{ applied: number }>;
};

/**
 * Document surface for a document-scoped agent action. Only the capabilities the
 * action's declared permissions allow are populated: `state` always (reads need
 * `document:read`, writes `document:write-extension-state`), `markdown.read` with
 * `document:read` and its mutators with `document:write`, `assets` with `asset:read`.
 */
export type ExtensionAgentDocumentContext = {
  id: string;
  canEdit: boolean;
  state: ExtensionAgentStateApi;
  assets?: ExtensionAgentAssetApi;
  markdown?: ExtensionAgentMarkdownApi;
};

export type ExtensionAgentWorkspaceStateEntry = {
  documentId: string;
  documentTitle: string;
  stateKey: string;
  state: ExtensionStateValue;
  visibility: ExtensionStateVisibility;
  version: number;
};

/**
 * Cross-document, owner-scoped state surface for a `scope: "workspace"` action —
 * pre-bound to the acting extension. Lets an action aggregate its own state
 * across all the user's documents (e.g. "every task in any calendar I own").
 */
export type ExtensionAgentWorkspaceStateApi = {
  listAcrossDocuments: () => Promise<ExtensionAgentWorkspaceStateEntry[]>;
};

export type ExtensionAgentWorkspaceContext = {
  /** Present with `document:read`. */
  state?: ExtensionAgentWorkspaceStateApi;
};

/**
 * The sandbox a {@link VaultExtensionAgentAction} handler runs against. The
 * server constructs it per call after resolving the acting user, the target
 * document (for document-scoped actions), and the action's permissions.
 */
export type ExtensionAgentActionContext = {
  user: { id: string };
  /** Present for `scope: "document"` actions. */
  document?: ExtensionAgentDocumentContext;
  /** Present for `scope: "workspace"` actions. */
  workspace?: ExtensionAgentWorkspaceContext;
};

export type ExtensionAgentActionResult = {
  /** Optional structured payload returned to the caller. Serialized to JSON for the model, so it must be JSON-safe. */
  data?: unknown;
  /** Optional human/agent-readable summary of what happened. */
  message?: string;
};

export type ExtensionAgentActionScope = "document" | "workspace";

/**
 * An agent-invokable operation an extension exposes. The `input` schema is both
 * validated server-side and surfaced to the model as JSON Schema (discovery).
 * The `handler` is a pure function of `(input, ctx)` — it must not import
 * server-only modules; all capabilities arrive via the sandboxed `ctx`.
 */
export type VaultExtensionAgentAction<TInput = unknown> = {
  /** Globally unique, namespaced under the extension id (e.g. "vault.calendar.addEntry"). */
  id: string;
  title: string;
  description: string;
  scope: ExtensionAgentActionScope;
  /** Whether the action mutates state. Document-scoped mutating actions require edit access. */
  mutates?: boolean;
  /**
   * Capabilities the handler needs. Must be a subset of the extension's own
   * `permissions`; the registry asserts this. Gates which `ctx` surfaces exist.
   */
  permissions?: ExtensionPermission[];
  input: ZodType<TInput>;
  /**
   * Optional schema for the handler's `data`. When present it is surfaced to the
   * model as JSON Schema (so returns are self-describing) and the dispatcher
   * validates `result.data` against it after the handler runs.
   */
  output?: ZodType;
  handler: (
    input: TInput,
    context: ExtensionAgentActionContext,
  ) => Promise<ExtensionAgentActionResult>;
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
  agent?: {
    actions: VaultExtensionAgentAction[];
  };
};
