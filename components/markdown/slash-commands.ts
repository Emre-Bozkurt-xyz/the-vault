import {
  startCompletion,
  type Completion,
  type CompletionContext,
  type CompletionResult,
  type CompletionSource,
} from "@codemirror/autocomplete";
import { syntaxTree } from "@codemirror/language";
import { EditorSelection, type EditorState } from "@codemirror/state";
import { type EditorView } from "@codemirror/view";

import { type MarkdownFormat } from "./MarkdownToolbar";

/**
 * The primitives the slash menu drives. Both come from `MarkdownEditor`, which
 * owns the editor view and the shared insertion helpers; the source itself is
 * stateless so it can be created once inside the editor's extension memo.
 *
 * - `applyFormat` routes to the same handlers the toolbar and keyboard
 *   shortcuts use, so every slash insertion behaves identically to its toolbar
 *   twin (leading-break handling, cursor placement, collab transactions).
 * - `insertBlock` is the raw block inserter for the few items that have no
 *   `MarkdownFormat` (callout, math), placing `text` on its own line and
 *   optionally seating the cursor at `cursorOffset` within it.
 */
export type SlashCommandActions = {
  applyFormat: (format: MarkdownFormat) => void;
  insertBlock: (
    view: EditorView,
    text: string,
    cursorOffset: number | null,
  ) => void;
};

/**
 * An enabled extension's slash item, resolved to a flat client shape by the
 * editor (from the registry's `getSlashCommandContributions`, filtered to the
 * user's enabled extensions). Kept markdown-only: it inserts a block via the
 * shared `insertBlock` helper.
 */
export type ExtensionSlashCommand = {
  id: string;
  /** The `/token` shown and filtered. */
  label: string;
  /** Human name shown in the menu. */
  title: string;
  /** Tooltip section, already defaulted to the extension name by the editor. */
  section: string;
  keywords?: string;
  insert: {
    markdown: string | (() => string);
    cursorOffset?: number;
  };
};

type SlashItem = {
  id: string;
  /** The `/token` (without the slash) shown as the hint and matched first. */
  label: string;
  /** Human label shown as the primary text in the tooltip. */
  detail: string;
  section: string;
  /** Extra terms (besides label/detail) used for filtering. */
  keywords?: string;
  /** CodeMirror completion `type` → `.cm-completionIcon-<type>` glyph (see components.css). */
  iconType?: string;
  run: (view: EditorView, actions: SlashCommandActions) => void;
};

/**
 * Per-item CodeMirror completion `type`, styled to a monochrome glyph in
 * `app/styles/components.css`. `type` is presentational only — it does not
 * affect ranking (only `section` did, which is why we don't set it).
 */
const CORE_ICON_TYPES: Record<string, string> = {
  heading1: "vault-heading",
  heading2: "vault-heading",
  heading3: "vault-heading",
  bulletList: "vault-bullet",
  orderedList: "vault-number",
  taskList: "vault-task",
  blockquote: "vault-quote",
  codeFence: "vault-code",
  table: "vault-table",
  callout: "vault-callout",
  math: "vault-math",
  region: "vault-region",
  divider: "vault-divider",
  image: "vault-image",
  assetGroup: "vault-gallery",
  wikiLink: "vault-link",
};

const SECTION_TEXT = "Text";
const SECTION_LISTS = "Lists";
const SECTION_BLOCKS = "Blocks";
const SECTION_INSERT = "Insert";

const SLASH_ITEMS: SlashItem[] = [
  {
    id: "heading1",
    label: "h1",
    detail: "Heading 1",
    section: SECTION_TEXT,
    keywords: "heading title large",
    run: (_view, actions) => actions.applyFormat("heading1"),
  },
  {
    id: "heading2",
    label: "h2",
    detail: "Heading 2",
    section: SECTION_TEXT,
    keywords: "heading subtitle",
    run: (_view, actions) => actions.applyFormat("heading2"),
  },
  {
    id: "heading3",
    label: "h3",
    detail: "Heading 3",
    section: SECTION_TEXT,
    keywords: "heading",
    run: (_view, actions) => actions.applyFormat("heading3"),
  },
  {
    id: "bulletList",
    label: "bullet",
    detail: "Bullet list",
    section: SECTION_LISTS,
    keywords: "unordered ul list dash",
    run: (_view, actions) => actions.applyFormat("bulletList"),
  },
  {
    id: "orderedList",
    label: "number",
    detail: "Numbered list",
    section: SECTION_LISTS,
    keywords: "ordered ol list",
    run: (_view, actions) => actions.applyFormat("orderedList"),
  },
  {
    id: "taskList",
    label: "todo",
    detail: "Task list",
    section: SECTION_LISTS,
    keywords: "task checkbox check tick",
    run: (_view, actions) => actions.applyFormat("taskList"),
  },
  {
    id: "blockquote",
    label: "quote",
    detail: "Quote",
    section: SECTION_BLOCKS,
    keywords: "blockquote citation",
    run: (_view, actions) => actions.applyFormat("blockquote"),
  },
  {
    id: "codeFence",
    label: "code",
    detail: "Code block",
    section: SECTION_BLOCKS,
    keywords: "fence codeblock snippet",
    run: (_view, actions) => actions.applyFormat("codeFence"),
  },
  {
    id: "table",
    label: "table",
    detail: "Table",
    section: SECTION_BLOCKS,
    keywords: "grid rows columns",
    run: (_view, actions) => actions.applyFormat("table"),
  },
  {
    id: "callout",
    label: "callout",
    detail: "Callout",
    section: SECTION_BLOCKS,
    keywords: "note admonition aside info warning",
    run: (view, actions) => {
      const text = "> [!note] Title\n> Content";
      actions.insertBlock(view, text, text.indexOf("Title"));
    },
  },
  {
    id: "math",
    label: "math",
    detail: "Math block",
    section: SECTION_BLOCKS,
    keywords: "latex katex equation formula tex",
    run: (view, actions) => {
      // `$$\n\n$$` — cursor onto the empty middle line (offset 3, past `$$\n`).
      actions.insertBlock(view, "$$\n\n$$", 3);
    },
  },
  {
    id: "region",
    label: "region",
    detail: "Foldable region",
    section: SECTION_BLOCKS,
    keywords: "collapsible fold toggle details section",
    run: (_view, actions) => actions.applyFormat("region"),
  },
  {
    id: "divider",
    label: "divider",
    detail: "Divider",
    section: SECTION_BLOCKS,
    keywords: "hr horizontal rule separator line",
    run: (_view, actions) => actions.applyFormat("horizontalRule"),
  },
  {
    id: "image",
    label: "image",
    detail: "Upload image",
    section: SECTION_INSERT,
    keywords: "picture photo asset upload file",
    run: (_view, actions) => actions.applyFormat("imageUpload"),
  },
  {
    id: "assetGroup",
    label: "gallery",
    detail: "Asset group",
    section: SECTION_INSERT,
    keywords: "images grid assets group",
    run: (_view, actions) => actions.applyFormat("assetGroup"),
  },
  {
    id: "wikiLink",
    label: "link",
    detail: "Wiki link",
    section: SECTION_INSERT,
    keywords: "internal document reference backlink",
    run: (view) => insertWikiLinkTrigger(view),
  },
];

/**
 * Slash menu completion source. Registered alongside the html/wiki-link/asset
 * sources in the editor's `autocompletion({ override })`. Returns null (so the
 * tooltip never opens) unless a `/query` sits at the cursor at a line start or
 * after whitespace, outside frontmatter and code.
 */
export function createSlashCommandCompletionSource(options: {
  applyFormat: SlashCommandActions["applyFormat"];
  insertBlock: SlashCommandActions["insertBlock"];
  /** Slash items from the user's enabled extensions (empty when none). */
  extensionCommands?: ExtensionSlashCommand[];
}): CompletionSource {
  const actions: SlashCommandActions = {
    applyFormat: options.applyFormat,
    insertBlock: options.insertBlock,
  };
  // Core items first, then extension items — declaration order is the tie-break
  // CodeMirror falls back to when the query is empty or scores are equal.
  const items: SlashItem[] = [
    ...SLASH_ITEMS.map((item) => ({
      ...item,
      iconType: CORE_ICON_TYPES[item.id] ?? "vault-block",
    })),
    ...(options.extensionCommands ?? []).map(toExtensionItem),
  ];

  return (context: CompletionContext): CompletionResult | null => {
    const slash = findSlashQuery(context.state, context.pos);

    if (!slash) {
      return null;
    }

    const line = context.state.doc.lineAt(context.pos);

    if (line.number <= getFrontmatterEndLine(context.state.doc)) {
      return null;
    }

    if (isInsideCode(context.state, slash.from)) {
      return null;
    }

    return {
      // `from` sits just after the slash, so CodeMirror filters the typed query
      // (not the leading `/`) against each option's label natively — which keeps
      // selection, Enter/Tab acceptance, and match highlighting working the way
      // they do for the wiki-link and asset sources. `validFor` re-filters as
      // the user types and closes the menu once a non-word char (e.g. a space)
      // ends the query.
      from: slash.from + 1,
      to: context.pos,
      validFor: /^[\w-]*$/,
      options: items.map((item) => toCompletion(item, actions)),
    };
  };
}

function toExtensionItem(command: ExtensionSlashCommand): SlashItem {
  return {
    id: command.id,
    label: command.label,
    detail: command.title,
    section: command.section,
    keywords: command.keywords,
    iconType: "vault-extension",
    run: (view, actions) => {
      const markdown =
        typeof command.insert.markdown === "function"
          ? command.insert.markdown()
          : command.insert.markdown;
      actions.insertBlock(view, markdown, command.insert.cursorOffset ?? null);
    },
  };
}

function toCompletion(
  item: SlashItem,
  actions: SlashCommandActions,
): Completion {
  return {
    // Keywords ride in the (hidden) label so CodeMirror's fuzzy filter matches
    // them; `displayLabel` is what the user actually sees.
    label: item.keywords ? `${item.label} ${item.keywords}` : item.label,
    displayLabel: item.detail,
    detail: `/${item.label}`,
    // `type` drives the tooltip glyph via `.cm-completionIcon-<type>` (see
    // components.css). Intentionally NO `section`: CodeMirror orders sections by
    // their position in the options array (core items first), which overrides
    // match score — a fully typed "calendar" would still rank under the "Blocks"
    // section. Left flat, options rank purely by CodeMirror's fuzzy score.
    // (`item.section` is retained on the item for a future grouped empty-state.)
    type: item.iconType,
    apply: (view, _completion, from, to) => {
      // `from` is just past the slash, so `from - 1` reaches back over it: drop
      // the whole `/query` first, then run the insertion at the cleaned cursor
      // so the shared helpers see the same state a toolbar click would.
      view.dispatch({
        changes: { from: from - 1, to },
        selection: EditorSelection.cursor(from - 1),
      });
      item.run(view, actions);
    },
  };
}

/**
 * Locates an open `/query` immediately before the cursor. Only matches when the
 * slash follows start-of-line or whitespace, so `either/or` and `https://` in
 * prose never trigger the menu. Returns the slash's position.
 */
function findSlashQuery(
  state: EditorState,
  pos: number,
): { from: number } | null {
  const line = state.doc.lineAt(pos);
  const beforeCursor = state.sliceDoc(line.from, pos);
  const match = /(?:^|\s)\/([\w-]*)$/.exec(beforeCursor);

  if (!match) {
    return null;
  }

  return { from: pos - match[1].length - 1 };
}

function isInsideCode(state: EditorState, pos: number): boolean {
  const tree = syntaxTree(state);
  let node: ReturnType<typeof tree.resolveInner> | null = tree.resolveInner(
    pos,
    -1,
  );

  while (node) {
    if (
      node.name === "FencedCode" ||
      node.name === "CodeBlock" ||
      node.name === "InlineCode"
    ) {
      return true;
    }
    node = node.parent;
  }

  return false;
}

/**
 * Line number of the closing `---` of a leading YAML frontmatter block, or `0`
 * when the document does not open with one. Mirrors the editor's own
 * frontmatter scan so the slash menu never opens inside the Properties block.
 */
function getFrontmatterEndLine(doc: EditorState["doc"]): number {
  if (doc.lines < 2 || doc.line(1).text.trim() !== "---") {
    return 0;
  }

  for (let lineNumber = 2; lineNumber <= doc.lines; lineNumber += 1) {
    if (doc.line(lineNumber).text.trim() === "---") {
      return lineNumber;
    }
  }

  return 0;
}

function insertWikiLinkTrigger(view: EditorView) {
  const { from, to } = view.state.selection.main;
  view.dispatch({
    changes: { from, to, insert: "[[" },
    selection: EditorSelection.cursor(from + 2),
  });
  view.focus();
  // Chain straight into the wiki-link completion source so picking "Wiki link"
  // lands the cursor in a live document search.
  startCompletion(view);
}
