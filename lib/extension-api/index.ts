/**
 * The Vault extension SDK — the only app module that code under `extensions/`
 * may import (`docs/23_EXTENSION_SDK_PLAN.md` §3, §11; enforced by ESLint).
 *
 * Four entry points per extension (plan §4): `defineManifest` (data),
 * `defineRender` (what readers see), `defineEditor` (what authors use) and,
 * from `@/lib/extension-api/server`, `defineServer`. Client hooks live in
 * `@/lib/extension-api/react`.
 *
 * Isomorphic: imported by the server, by client components, and by manifests.
 */
import type { CompletionSource } from "@codemirror/autocomplete";
import type { Extension } from "@codemirror/state";
import type { ComponentType } from "react";
import type { ZodType } from "zod";

import type { AssetEmbedResolutionMap } from "@/lib/asset-embeds";
import type { WikiLinkResolutionMap } from "@/lib/wiki-links";

import type {
  CommandContribution,
  DocumentOverlayContribution,
  ExtensionPermission,
  ExtensionSettingsSection,
  ExtensionStateValue,
  ExtensionStateVisibility,
  SlashCommandContribution,
  VaultExtensionCategory,
} from "@/lib/extensions/types";

export type {
  CommandContribution,
  DocumentOverlayContribution,
  ExtensionPermission,
  ExtensionSettingsField,
  ExtensionSettingsSection,
  ExtensionStateValue,
  ExtensionStateVisibility,
  SlashCommandContribution,
  VaultExtensionCategory,
} from "@/lib/extensions/types";

// Wiki links are core syntax; these pure helpers are part of the SDK so an
// extension never reaches into `lib/` for them.
export {
  countWikiLinkTargets,
  escapeWikiLinkLabel,
  wikiDocKey,
  wikiKeyForTarget,
  wikiTitleKey,
} from "@/lib/wiki-links";

// Directive grammar is core; extensions read their own blocks with the same
// scanner the host uses, so the two cannot disagree about where one ends.
export {
  parseDirectiveAttributes,
  scanContainerBlocks,
  type ContainerBlockScan,
  type ContainerBodyLine,
} from "@/lib/markdown/directive-blocks";

/** Directive and fence names an extension owns (plan §3 principle 4, §5). */
export type ExtensionSyntax = {
  /** Single-line `:::name{…}` block directives, rendered by the host (plan §6). */
  blocks?: readonly string[];
  /**
   * `:::name{…}` … `:::` container directives with a body. The host renders
   * them in Read mode and leaves their source alone in Live mode (plan §6).
   */
  containers?: readonly string[];
  /** `:name[…]{…}` inline directives, rendered by the host in Read mode. */
  inline?: readonly string[];
  /** Fence languages, e.g. ```` ```mermaid ````. */
  fences?: readonly string[];
};

export type ExtensionManifest = {
  /** Namespaced: `vault.<folder>` for first-party extensions. */
  id: string;
  name: string;
  version: number;
  description: string;
  category: VaultExtensionCategory;
  defaultEnabled?: boolean;
  permissions: readonly ExtensionPermission[];
  settings?: {
    schema: ZodType<Record<string, unknown>>;
    /** Must equal `schema.parse({})`; the contract test checks it. */
    defaults?: Record<string, unknown>;
    sections?: readonly ExtensionSettingsSection[];
  };
  syntax?: ExtensionSyntax;
  /** Render even when no syntax or state is present (e.g. link previews). */
  renderAlways?: boolean;
  /** Prefetch this extension's state rows with the page. Defaults to true. */
  prefetchState?: boolean;
  /** Today's command metadata; plan §5's `commands` shape lands in slice 3. */
  commands?: readonly CommandContribution[];
  /** Today's slash contributions (`insert` / `run`); slice 3 makes them command references. */
  slashCommands?: readonly SlashCommandContribution[];
  /** Overlay ids; implementations arrive with slice 4. */
  overlays?: readonly DocumentOverlayContribution[];
};

export type JsonValue =
  | null
  | boolean
  | number
  | string
  | JsonValue[]
  // `undefined` members are allowed because JSON serialisation drops them, and
  // zod-inferred types with optional fields carry them.
  | { [key: string]: JsonValue | undefined };

/**
 * Where a document is being rendered. `workspace` is the authenticated app
 * (Read or Live); the rest are the anonymous or token-scoped read surfaces.
 */
export type ExtensionSurface = "workspace" | "public" | "share" | "guide" | "embed";

/** One prefetched state row, already filtered to what this viewer may read. */
export type ExtensionStateRow = {
  state: ExtensionStateValue;
  visibility: ExtensionStateVisibility;
  version: number;
};

/**
 * Everything the host resolved about extensions for one rendered document
 * (plan §9). Built on the server by `resolveDocumentExtensions` and passed down
 * as one serialisable prop, replacing per-extension props.
 */
export type DocumentExtensions = {
  surface: ExtensionSurface;
  documentId: string | null;
  canEdit: boolean;
  /** Extensions whose render code this document needs. */
  renderIds: string[];
  /** Extensions the viewer switched on. Empty for anonymous viewers. */
  enabledIds: string[];
  /** Viewer settings per installed extension: stored values while enabled, schema defaults otherwise. */
  settings: Record<string, Record<string, unknown>>;
  /** Prefetched state per extension, keyed by state key. */
  state: Record<string, Record<string, ExtensionStateRow>>;
  /** Each render-set extension's `loadRenderData` result. */
  data: Record<string, JsonValue>;
};

/** The serialisable context an extension component receives (plan §6). */
export type ExtensionRenderContext<TSettings = Record<string, unknown>> = {
  extensionId: string;
  documentId: string | null;
  surface: ExtensionSurface;
  canEdit: boolean;
  enabled: boolean;
  settings: TSettings;
  state: Record<string, ExtensionStateRow>;
  data: JsonValue | null;
};

/**
 * Narrows the page-level {@link DocumentExtensions} to one extension. Without
 * one (nested renders such as embeds and previews) the context is anonymous and
 * read-only: no document, no state, schema-free empty settings.
 */
export function createRenderContext<TSettings = Record<string, unknown>>(
  extensions: DocumentExtensions | null | undefined,
  extensionId: string,
): ExtensionRenderContext<TSettings> {
  if (!extensions) {
    return {
      extensionId,
      documentId: null,
      surface: "embed",
      canEdit: false,
      enabled: false,
      settings: {} as TSettings,
      state: {},
      data: null,
    };
  }

  return {
    extensionId,
    documentId: extensions.documentId,
    surface: extensions.surface,
    canEdit: extensions.canEdit,
    enabled: extensions.enabledIds.includes(extensionId),
    settings: (extensions.settings[extensionId] ?? {}) as TSettings,
    state: extensions.state[extensionId] ?? {},
    data: extensions.data[extensionId] ?? null,
  };
}

/** The document's resolved links, for rendering Markdown inside a component. */
export type ExtensionLinks = {
  wikiLinks?: WikiLinkResolutionMap;
  assetLinks?: AssetEmbedResolutionMap;
};

/**
 * One claimed directive in a document, as the `analyze` pre-pass and the
 * components see it (plan §6). Keys are unique within one rendered document and
 * stable across renders of the same text.
 */
export type ExtensionOccurrence =
  | {
      kind: "inline";
      key: string;
      name: string;
      /** The directive as written, e.g. `:calc[rent * 3]{as=USD}`. */
      source: string;
      /** Raw text between the brackets (never parsed Markdown), or null without them. */
      label: string | null;
      attributes: Record<string, string>;
    }
  | {
      kind: "block";
      key: string;
      name: string;
      /** The opening line, trimmed. */
      source: string;
      /** The lines between the fences, as written. */
      body: string;
      attributes: Record<string, string>;
    };

export type InlineOccurrence = Extract<ExtensionOccurrence, { kind: "inline" }>;

/** What `analyze` receives: this extension's occurrences, in document order. */
export type AnalyzableDocument = {
  /** The whole document, frontmatter included. */
  markdown: string;
  occurrences: ExtensionOccurrence[];
};

export type Analyzer = (doc: AnalyzableDocument, ctx: ExtensionRenderContext) => unknown;

/**
 * A document-wide pre-pass (plan §6): runs once per rendered document, before
 * any of the extension's components, which receive its result as `analysis`.
 * For work that must see every occurrence in order, like calc binding names top
 * to bottom. Loaded lazily with the components that need it.
 */
export type AnalyzeContribution = {
  load: () => Promise<{ default: Analyzer }>;
};

/** What a block component receives (plan §6). */
export type BlockProps<TSettings = Record<string, unknown>> = {
  ctx: ExtensionRenderContext<TSettings>;
  /** The directive name, e.g. `calendar`. */
  name: string;
  /** Parsed `{key=value}` attributes of the directive line. */
  attributes: Record<string, string>;
  /** The opening line's source text. */
  source: string;
  /** A container's body as written; null for a leaf block. */
  body: string | null;
  /** A container's occurrence key in `analysis`; null for a leaf block. */
  occurrenceKey: string | null;
  /** The extension's `analyze` result for this document, or null without one. */
  analysis: unknown;
  links: ExtensionLinks;
};

type LazyBlock = {
  /**
   * The component, loaded lazily. Never import a component statically into a
   * render module: server pages bundle every client component they reference
   * into their entry chunk, used or not (plan §14 slice 0). The contract test
   * rejects a static import of a `"use client"` file here.
   */
  load: () => Promise<{ default: ComponentType<BlockProps> }>;
};

/**
 * One `:::name{…}` block an extension renders (plan §6). A `leaf` is a single
 * line whose component replaces it in Live mode too (`widget`). A `container`
 * has a body and keeps its source editable in Live mode (`source`): the host
 * only claims its lines, and the extension's `live` contribution decorates them.
 */
export type BlockContribution =
  | ({ form: "leaf"; live: "widget" } & LazyBlock)
  | ({ form: "container"; live: "source" } & LazyBlock);

/** What an inline directive component receives (plan §6). */
export type InlineProps<TSettings = Record<string, unknown>> = {
  ctx: ExtensionRenderContext<TSettings>;
  occurrence: InlineOccurrence;
  /** The extension's `analyze` result for this document, or null without one. */
  analysis: unknown;
};

/** One `:name[…]` inline directive an extension renders in Read mode. */
export type InlineContribution = {
  load: () => Promise<{ default: ComponentType<InlineProps> }>;
};

/**
 * Live-mode rendering (plan §6): CodeMirror extensions that draw this
 * extension's syntax while the source stays editable, for every author of a
 * document that uses it. Privileged: it sees the whole editor. Loaded lazily.
 */
export type LiveContribution = {
  load: () => Promise<{ default: (ctx: ExtensionRenderContext) => Extension }>;
};

type SyntaxNames<M extends ExtensionManifest, K extends keyof ExtensionSyntax> =
  NonNullable<NonNullable<M["syntax"]>[K]>[number];

type OverlayIds<M extends ExtensionManifest> = NonNullable<M["overlays"]>[number]["id"];

/**
 * What an overlay component receives (plan §6, §7): one layer drawn over the
 * whole document surface, like stickers. All of it is serialisable.
 */
export type OverlayProps<TSettings = Record<string, unknown>> = {
  ctx: ExtensionRenderContext<TSettings>;
  links: ExtensionLinks;
};

/** A read-only overlay readers see, loaded lazily like a block component. */
export type OverlayContribution = {
  load: () => Promise<{ default: ComponentType<OverlayProps> }>;
};

/**
 * A wiki link, as a link preview sees it (plan §6). Built by the host from the
 * document's resolved links, in Read mode and in Live mode.
 */
export type WikiLinkInfo = {
  /** The link as written: `Term`, `doc:<id>`, … */
  target: string;
  /** The resolved document's title, else the written label. */
  label: string;
  href: string | null;
  resolved: boolean;
  /** Whether the target is a document tagged `definition` (core data). */
  isDefinition: boolean;
  /** Bounded Markdown the target offers for previews, when it has any. */
  preview: string | null;
  /** How many earlier links in this document point at the same target (Read mode). */
  occurrence: number;
};

/** What a link preview shows in its hover card. */
export type LinkPreview = {
  title: string;
  /** Rendered with links disabled, so a card never opens another. */
  markdown: string | null;
  /** Shown instead of `markdown` when there is none. */
  emptyText?: string;
  /** De-emphasize the link itself (e.g. every mention after the first). */
  quiet?: boolean;
  /**
   * A button on the card in the editor, running one of this extension's
   * commands with `args`. Ignored on read surfaces.
   */
  action?: { label: string; command: string; args?: JsonValue };
};

/**
 * Hover previews for wiki links (plan §6). A pure function of the link and the
 * render context, called in Read mode, on public pages and in Live mode.
 * Privileged: it sees every link in every document.
 */
export type LinkContribution = {
  preview: (link: WikiLinkInfo, ctx: ExtensionRenderContext) => LinkPreview | null;
};

export type RenderModule = {
  manifestId: string;
  blocks: Readonly<Record<string, BlockContribution>>;
  inline: Readonly<Record<string, InlineContribution>>;
  overlays: Readonly<Record<string, OverlayContribution>>;
  links: LinkContribution | null;
  analyze: AnalyzeContribution | null;
  live: LiveContribution | null;
};

/**
 * What readers see (plan §6). Loaded statically on the server and in the
 * browser, so it must stay light: definitions and lazy loaders only.
 */
export function defineRender<const M extends ExtensionManifest>(
  manifest: M,
  render: {
    /** Leaf blocks (`syntax.blocks`) and containers (`syntax.containers`). */
    blocks?: {
      [K in SyntaxNames<M, "blocks">]?: Extract<BlockContribution, { form: "leaf" }>;
    } & {
      [K in SyntaxNames<M, "containers">]?: Extract<BlockContribution, { form: "container" }>;
    };
    inline?: { [K in SyntaxNames<M, "inline">]?: InlineContribution };
    /**
     * Read-only overlays, keyed by manifest overlay id. They render for every
     * reader of a document that has this extension's state, enabled or not.
     */
    overlays?: { [K in OverlayIds<M>]?: OverlayContribution };
    links?: LinkContribution;
    analyze?: AnalyzeContribution;
    live?: LiveContribution;
  },
): RenderModule {
  const leaves = new Set(manifest.syntax?.blocks ?? []);
  const containers = new Set(manifest.syntax?.containers ?? []);
  const blocks = (render.blocks ?? {}) as Record<string, BlockContribution>;

  for (const [name, block] of Object.entries(blocks)) {
    const claimed = block.form === "leaf" ? leaves : containers;
    if (!claimed.has(name)) {
      throw new Error(
        `"${manifest.id}" renders ${block.form} block "${name}" without claiming it in manifest.syntax.${block.form === "leaf" ? "blocks" : "containers"}.`,
      );
    }
  }

  const inlineClaims = new Set(manifest.syntax?.inline ?? []);
  const inline = (render.inline ?? {}) as Record<string, InlineContribution>;
  for (const name of Object.keys(inline)) {
    if (!inlineClaims.has(name)) {
      throw new Error(
        `"${manifest.id}" renders inline "${name}" without claiming it in manifest.syntax.inline.`,
      );
    }
  }

  const overlays = (render.overlays ?? {}) as Record<string, OverlayContribution>;
  const declared = new Set((manifest.overlays ?? []).map((overlay) => overlay.id));
  for (const id of Object.keys(overlays)) {
    if (!declared.has(id)) {
      throw new Error(`"${manifest.id}" renders overlay "${id}" its manifest does not declare.`);
    }
  }

  return {
    manifestId: manifest.id,
    blocks,
    inline,
    overlays,
    links: render.links ?? null,
    analyze: render.analyze ?? null,
    live: render.live ?? null,
  };
}

/**
 * The editor surface a command may act on (plan §7). The host implements it
 * over the live CodeMirror view; tests implement it over a bare EditorState.
 */
export type EditorHandle = {
  /** Inserts text as its own block at the cursor, breaking the paragraph if needed. */
  insertBlock: (markdown: string, options?: { cursorOffset?: number }) => void;
  /** Inserts text at the cursor without touching the paragraph. */
  insertInline: (markdown: string, options?: { cursorOffset?: number }) => void;
  /** The current selection. */
  selection: () => { from: number; to: number; text: string };
  /**
   * Opens the host's asset picker (the user's library). Resolves to the chosen
   * asset, or null if the picker was dismissed or is unavailable here.
   */
  pickAsset: (options: {
    kinds: ReadonlyArray<"image" | "pdf">;
    title?: string;
  }) => Promise<PickedAsset | null>;
  /**
   * Opens one of this extension's dialogs (`dialogs` in `defineEditor`) and
   * resolves to what it closed with, or null when dismissed or unavailable.
   */
  openDialog: (id: string, props?: JsonValue) => Promise<JsonValue | null>;
  /**
   * Types `[[` at the cursor and opens wiki-link completion, offering only the
   * links `filter` accepts (all when omitted). Applies to that one `[[` only.
   */
  openLinkCompletion: (options?: { filter?: (link: WikiLinkInfo) => boolean }) => void;
  /** Opens a document in a workspace tab without navigating away. */
  openDocument: (documentId: string, title: string) => void;
};

export type PickedAsset = {
  id: string;
  kind: "image" | "pdf";
  displayName: string;
  mimeType: string;
};

export type EditorCommandContext = {
  extensionId: string;
  documentId: string | null;
  /** The folder of the document being edited, or null at the vault root. */
  folderId: string | null;
  settings: Record<string, unknown>;
  /** Arguments from the caller, e.g. a link preview's `action.args`. */
  args?: JsonValue;
  /**
   * Sends a session event to this extension's components on this document,
   * received with `useSessionEvent` (e.g. a command handing a picked asset to
   * an overlay). Scoped to the extension: nothing else hears it.
   */
  emit: (name: string, payload?: JsonValue) => void;
};

export type CommandHandler = (
  editor: EditorHandle,
  context: EditorCommandContext,
) => void | Promise<void>;

type CommandIds<M extends ExtensionManifest> = NonNullable<
  M["commands"]
>[number]["id"];

export type ToolbarContributionItem = {
  command: string;
  label: string;
  icon: ComponentType<{ className?: string }>;
};

/** What a dialog component receives (plan §7). */
export type DialogProps = {
  ctx: Pick<EditorCommandContext, "extensionId" | "documentId" | "folderId" | "settings">;
  /** What `openDialog` was called with. */
  props: JsonValue | undefined;
  /** Closes the dialog; `openDialog` resolves to `result` (null if omitted). */
  close: (result?: JsonValue | null) => void;
};

export type EditorModule = {
  manifestId: string;
  commands: Readonly<Record<string, CommandHandler>>;
  toolbar: readonly ToolbarContributionItem[];
  overlays: Readonly<Record<string, ComponentType<OverlayProps>>>;
  dialogs: Readonly<Record<string, ComponentType<DialogProps>>>;
  completions: ((ctx: ExtensionRenderContext) => readonly CompletionSource[]) | null;
};

/**
 * What authors use (plan §7). Client-only, loaded lazily and only for users
 * who enabled the extension. Every manifest command needs a handler: missing
 * one is a compile error.
 */
export function defineEditor<const M extends ExtensionManifest>(
  manifest: M,
  editor: {
    commands: { [K in CommandIds<M>]: CommandHandler };
    toolbar?: ReadonlyArray<
      Omit<ToolbarContributionItem, "command"> & { command: CommandIds<M> }
    >;
    /**
     * Interactive overlays for authors, keyed by manifest overlay id. Where the
     * user can edit, one replaces the render module's read-only overlay of the
     * same id.
     */
    overlays?: { [K in OverlayIds<M>]?: ComponentType<OverlayProps> };
    /** Dialogs this extension's commands open with `editor.openDialog(id)`. */
    dialogs?: Record<string, ComponentType<DialogProps>>;
    /**
     * Autocompletion sources, shown in the editor's one completion tooltip
     * beside the host's own. Privileged: they see the whole document.
     */
    completions?: (ctx: ExtensionRenderContext) => readonly CompletionSource[];
  },
): EditorModule {
  return {
    manifestId: manifest.id,
    commands: editor.commands as Record<string, CommandHandler>,
    toolbar: editor.toolbar ?? [],
    overlays: (editor.overlays ?? {}) as Record<string, ComponentType<OverlayProps>>,
    dialogs: editor.dialogs ?? {},
    completions: editor.completions ?? null,
  };
}

/**
 * Declares an extension. `const` keeps literal types, so the id and permissions
 * flow into {@link defineServer} and are checked there at compile time.
 *
 * Also validated at module load, like the registry's agent-action invariants: a
 * malformed manifest fails fast rather than when something first uses it.
 */
export function defineManifest<const M extends ExtensionManifest>(
  manifest: M,
): M {
  assertManifest(manifest);
  return manifest;
}

/** Throws on a manifest that breaks the invariants in plan §5. */
export function assertManifest(manifest: ExtensionManifest): void {
  if (!/^[a-z0-9-]+\.[a-z0-9-]+$/.test(manifest.id)) {
    throw new Error(
      `Extension id "${manifest.id}" must be "<publisher>.<name>" (lowercase).`,
    );
  }

  const namespaced = (kind: string, id: string) => {
    if (!id.startsWith(`${manifest.id}.`)) {
      throw new Error(
        `${kind} "${id}" must be namespaced under extension "${manifest.id}".`,
      );
    }
  };

  for (const command of manifest.commands ?? [])
    namespaced("Command", command.id);
  for (const slash of manifest.slashCommands ?? []) {
    namespaced("Slash command", slash.id);
    if (Boolean(slash.insert) === Boolean(slash.run)) {
      throw new Error(
        `Slash command "${slash.id}" must declare exactly one of insert or run.`,
      );
    }
  }
  for (const overlay of manifest.overlays ?? [])
    namespaced("Overlay", overlay.id);
}
