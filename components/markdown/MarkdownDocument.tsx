import { TaskRepeatBadge } from "@/components/tasks/TaskRepeatBadge";
import { TaskPriorityBadge } from "@/components/tasks/TaskPriorityBadge";
import {
  AlertTriangle,
  Bug,
  Check,
  CheckCircle2,
  Flame,
  FileText,
  HelpCircle,
  Info,
  Lightbulb,
  ListTodo,
  Quote,
  type LucideIcon,
  Pencil,
  XCircle,
} from "lucide-react";
import {
  Children,
  type ChangeEvent,
  cloneElement,
  isValidElement,
  type CSSProperties,
  type ReactElement,
  type ReactNode,
} from "react";
import ReactMarkdown, { type Components } from "react-markdown";
import rehypeKatex from "rehype-katex";
import rehypeRaw from "rehype-raw";
import rehypeSanitize from "rehype-sanitize";

import {
  transformAssetEmbeds,
  type AssetEmbedResolutionMap,
} from "@/lib/asset-embeds";
import { ExtensionBlockHost } from "@/components/extensions/ExtensionBlockHost";
import {
  ExtensionDocumentProvider,
  ExtensionInlineHost,
} from "@/components/extensions/ExtensionDocumentHost";
import { CalloutIcon } from "@/components/markdown/CalloutIcon";
import { CodeBlock, InlineCode } from "@/components/markdown/CodeBlock";
import { codeInfoFromClassName, codeNodeText, rehypeCodeHighlight } from "@/lib/markdown/code-highlight";
import { ExtensionLinkHost } from "@/components/extensions/ExtensionLinkHost";
import { extensionDirectiveOwners } from "@/lib/extension-host/blocks";
import { planExtensionParts } from "@/lib/extension-host/plan";
import {
  createRenderContext,
  type AnalyzableDocument,
  type DocumentExtensions,
} from "@/lib/extension-api";
import {
  createDirectivePlanState,
  type DirectivePart,
  type DirectivePlanState,
} from "@/lib/markdown/directive-occurrences";
import {
  directiveRemarkPlugins,
  EXTENSION_INLINE_ELEMENT,
  EXTENSION_INLINE_KEY_ATTRIBUTE,
  remarkInlineDirectives,
} from "@/lib/markdown/directives";
import { stripDocumentFrontmatter } from "@/lib/content-metadata";
import { inlineStyleToReactStyle } from "@/lib/html-style";
import {
  rehypeSanitizeContent,
  safeHtmlSchema,
} from "@/lib/markdown/sanitize";
import { cn } from "@/lib/utils";
import {
  buildWikiLinkTargetsByHref,
  extractMarkdownTarget,
  hrefWithoutFragment,
  normalizeWikiFragmentForHref,
  splitWikiDocumentEmbeds,
  slugifyMarkdownHeading,
  transformWikiLinks,
  type WikiDocumentEmbedBlock,
  type WikiLinkTarget,
  type WikiLinkResolutionMap,
} from "@/lib/wiki-links";
import {
  TASK_DATE_ELEMENT_NAME,
  TASK_PRIORITY_ELEMENT_NAME,
  TASK_REPEAT_ELEMENT_NAME,
  TASK_PROGRESS_ELEMENT_NAME,
  formatTaskDateAbsolute,
  remarkTasks,
} from "@/lib/markdown/task-directives";
import type { ParsedTask } from "@/lib/tasks/parse";
import { mapReadTaskSources } from "@/lib/tasks/read-source";

type ReadTaskToggle = (task: Pick<ParsedTask, "line" | "rawLine">, checked: boolean) => void;

type MarkdownDocumentProps = {
  markdown: string;
  className?: string;
  compact?: boolean;
  contained?: boolean;
  disableLinks?: boolean;
  wikiLinks?: WikiLinkResolutionMap;
  assetLinks?: AssetEmbedResolutionMap;
  embedDepth?: number;
  embedTrail?: string[];
  /**
   * What the page resolved about extensions (`resolveDocumentExtensions`):
   * the context extension blocks render with (their document, settings and
   * prefetched state), the FX table for `:calc`, and the viewer's
   * definition-emphasis preference. Passed in rather than fetched so
   * `MarkdownDocument` stays synchronous and usable from client components.
   *
   * Only the top-level render of a document passes it. Nested renders (document
   * embeds, previews, text inside a block) omit it, so a block there gets an
   * anonymous, document-less context and can never read or write the outer
   * document's state.
   */
  extensions?: DocumentExtensions | null;
  /** Only the authenticated editor's Read preview supplies this. */
  onTaskToggle?: ReadTaskToggle;
  /** Internal source handles for a region of the same editable document. */
  taskSource?: { tasks: Map<number, ParsedTask>; offset: number };
};

const maxWikiEmbedDepth = 2;

const allowedLinkProtocol = /^(https?:|mailto:|\/|#)/i;
const allowedImageProtocol = /^(https?:|\/)/i;
const iframeSandbox =
  "allow-same-origin allow-scripts allow-forms allow-popups allow-popups-to-escape-sandbox";
const iframeAllow =
  "accelerometer; autoplay; clipboard-write; encrypted-media; fullscreen; gyroscope; picture-in-picture; web-share";
const allowedIframeProviders = [
  {
    hosts: new Set(["www.youtube.com", "youtube.com"]),
    path: /^\/embed\//,
  },
  {
    hosts: new Set(["www.youtube-nocookie.com", "youtube-nocookie.com"]),
    path: /^\/embed\//,
  },
  {
    hosts: new Set(["open.spotify.com"]),
    path: /^\/embed\//,
  },
  {
    hosts: new Set(["embed.tidal.com"]),
    path: /^\/(tracks|albums|playlists|mixes|videos)\//,
  },
  {
    hosts: new Set(["player.vimeo.com"]),
    path: /^\/video\//,
  },
  {
    hosts: new Set(["w.soundcloud.com"]),
    path: /^\/player\//,
  },
  {
    hosts: new Set(["embed.music.apple.com"]),
    path: /^\//,
  },
  {
    hosts: new Set<string>(),
    hostPattern: /(^|\.)bandcamp\.com$/,
    path: /^\/EmbeddedPlayer\//,
  },
] as const;

type CalloutDefinition = {
  type: string;
  title: string;
  icon: LucideIcon;
  iconName: string;
};

const calloutDefinitions = {
  note: {
    type: "note",
    title: "Note",
    icon: Pencil,
    iconName: "lucide-pencil",
  },
  abstract: {
    type: "abstract",
    title: "Abstract",
    icon: ListTodo,
    iconName: "lucide-list",
  },
  info: {
    type: "info",
    title: "Info",
    icon: Info,
    iconName: "lucide-info",
  },
  todo: {
    type: "todo",
    title: "Todo",
    icon: CheckCircle2,
    iconName: "lucide-check-circle-2",
  },
  tip: {
    type: "tip",
    title: "Tip",
    icon: Lightbulb,
    iconName: "lucide-lightbulb",
  },
  success: {
    type: "success",
    title: "Success",
    icon: Check,
    iconName: "lucide-check",
  },
  question: {
    type: "question",
    title: "Question",
    icon: HelpCircle,
    iconName: "lucide-help-circle",
  },
  warning: {
    type: "warning",
    title: "Warning",
    icon: AlertTriangle,
    iconName: "lucide-alert-triangle",
  },
  failure: {
    type: "failure",
    title: "Failure",
    icon: XCircle,
    iconName: "lucide-x-circle",
  },
  danger: {
    type: "danger",
    title: "Danger",
    icon: Flame,
    iconName: "lucide-flame",
  },
  bug: {
    type: "bug",
    title: "Bug",
    icon: Bug,
    iconName: "lucide-bug",
  },
  example: {
    type: "example",
    title: "Example",
    icon: ListTodo,
    iconName: "lucide-list",
  },
  quote: {
    type: "quote",
    title: "Quote",
    icon: Quote,
    iconName: "lucide-quote",
  },
} satisfies Record<string, CalloutDefinition>;

const calloutAliases = new Map<string, keyof typeof calloutDefinitions>([
  ["summary", "abstract"],
  ["tldr", "abstract"],
  ["hint", "tip"],
  ["important", "tip"],
  ["check", "success"],
  ["done", "success"],
  ["help", "question"],
  ["faq", "question"],
  ["caution", "warning"],
  ["attention", "warning"],
  ["fail", "failure"],
  ["missing", "failure"],
  ["error", "danger"],
  ["cite", "quote"],
]);

function styledProps(
  baseClassName: string,
  className?: string,
  style?: unknown,
) {
  return {
    className: cn(baseClassName, className),
    style: inlineStyleToReactStyle(style),
  };
}

function hasMarkdownClass(className: unknown, targetClassName: string) {
  return typeof className === "string" && className.split(/\s+/).includes(targetClassName);
}

function safeIframeSrc(src: unknown) {
  if (typeof src !== "string") {
    return null;
  }

  let url: URL;

  try {
    url = new URL(src);
  } catch {
    return null;
  }

  if (url.protocol !== "https:") {
    return null;
  }

  const hostname = url.hostname.toLowerCase();
  const allowed = allowedIframeProviders.some((provider) => {
    const hostMatches =
      provider.hosts.has(hostname) ||
      ("hostPattern" in provider && provider.hostPattern.test(hostname));

    return hostMatches && provider.path.test(url.pathname);
  });

  return allowed ? url.toString() : null;
}

function iframeDimension(value: unknown, fallback: number, max: number) {
  const parsed =
    typeof value === "number"
      ? value
      : typeof value === "string"
        ? Number.parseInt(value, 10)
        : Number.NaN;

  if (!Number.isFinite(parsed) || parsed <= 0) {
    return fallback;
  }

  return Math.min(parsed, max);
}

/** Claimed inline directive names, for the render plugin. */
const inlineDirectiveNames: ReadonlySet<string> = new Set(
  extensionDirectiveOwners.inline.keys(),
);

function normalizeSelfClosingIframes(markdown: string) {
  return markdown.replace(/<iframe\b([^>]*)\/>/gi, "<iframe$1></iframe>");
}

function createMarkdownComponents(
  disableLinks: boolean,
  headingIds: Map<string, number>,
  /**
   * Resolved wiki-link targets, keyed by href. Empty when the surface has no
   * resolution map, or inside a hover card — see `a` below.
   */
  linkTargets: Map<string, WikiLinkTarget>,
  /**
   * Links to each target seen so far in this document, so an extension's
   * preview can treat a repeat mention differently (the dictionary's "first
   * mention" emphasis).
   */
  linkOccurrences: Map<string, number>,
  extensions: DocumentExtensions | null,
  startLine: number,
  readTasks: Map<number, ParsedTask> | null,
  onTaskToggle?: ReadTaskToggle,
): Components {
  const headingProps = (
    children: ReactNode,
    baseClassName: string,
    className?: string,
    style?: unknown,
  ) => {
    const baseSlug = slugifyMarkdownHeading(reactNodeToText(children));
    const count = headingIds.get(baseSlug) ?? 0;
    headingIds.set(baseSlug, count + 1);

    return {
      id: count === 0 ? baseSlug : `${baseSlug}-${count}`,
      ...styledProps(baseClassName, className, style),
    };
  };

  return {
  h1({ children, className, style }) {
    return <h1 {...headingProps(children, "vault-md-h1", className, style)}>{children}</h1>;
  },
  h2({ children, className, style }) {
    return <h2 {...headingProps(children, "vault-md-h2", className, style)}>{children}</h2>;
  },
  h3({ children, className, style }) {
    return <h3 {...headingProps(children, "vault-md-h3", className, style)}>{children}</h3>;
  },
  h4({ children, className, style }) {
    return <h4 {...headingProps(children, "vault-md-h4", className, style)}>{children}</h4>;
  },
  h5({ children, className, style }) {
    return <h5 {...headingProps(children, "vault-md-h5", className, style)}>{children}</h5>;
  },
  h6({ children, className, style }) {
    return <h6 {...headingProps(children, "vault-md-h6", className, style)}>{children}</h6>;
  },
  p({ children, className, style }) {
    return <p {...styledProps("vault-md-p", className, style)}>{children}</p>;
  },
  div({ children, className, style }) {
    return <div {...styledProps("vault-md-html-block", className, style)}>{children}</div>;
  },
  span({ children, className, style }) {
    return <span {...styledProps("vault-md-html-inline", className, style)}>{children}</span>;
  },
  section({ children, className, style }) {
    return <section {...styledProps("vault-md-section", className, style)}>{children}</section>;
  },
  article({ children, className, style }) {
    return <article {...styledProps("vault-md-section", className, style)}>{children}</article>;
  },
  aside({ children, className, style }) {
    return <aside {...styledProps("vault-md-aside", className, style)}>{children}</aside>;
  },
  header({ children, className, style }) {
    return <header {...styledProps("vault-md-html-block", className, style)}>{children}</header>;
  },
  footer({ children, className, style }) {
    return <footer {...styledProps("vault-md-html-block", className, style)}>{children}</footer>;
  },
  figure({ children, className, style }) {
    return <figure {...styledProps("vault-md-figure", className, style)}>{children}</figure>;
  },
  figcaption({ children, className, style }) {
    return <figcaption {...styledProps("vault-md-figcaption", className, style)}>{children}</figcaption>;
  },
  details({ children, className, style }) {
    return <details {...styledProps("vault-md-details", className, style)}>{children}</details>;
  },
  summary({ children, className, style }) {
    return <summary {...styledProps("vault-md-summary", className, style)}>{children}</summary>;
  },
  mark({ children, className, style }) {
    return <mark {...styledProps("vault-md-mark", className, style)}>{children}</mark>;
  },
  small({ children, className, style }) {
    return <small {...styledProps("vault-md-small", className, style)}>{children}</small>;
  },
  sub({ children, className, style }) {
    return <sub {...styledProps("vault-md-sub", className, style)}>{children}</sub>;
  },
  sup({ children, className, style }) {
    return <sup {...styledProps("vault-md-sup", className, style)}>{children}</sup>;
  },
  kbd({ children, className, style }) {
    return <kbd {...styledProps("vault-md-kbd", className, style)}>{children}</kbd>;
  },
  abbr({ children, title, className, style }) {
    return (
      <abbr title={title} {...styledProps("vault-md-abbr", className, style)}>
        {children}
      </abbr>
    );
  },
  dl({ children, className, style }) {
    return <dl {...styledProps("vault-md-dl", className, style)}>{children}</dl>;
  },
  dt({ children, className, style }) {
    return <dt {...styledProps("vault-md-dt", className, style)}>{children}</dt>;
  },
  dd({ children, className, style }) {
    return <dd {...styledProps("vault-md-dd", className, style)}>{children}</dd>;
  },
  img({ src, alt, title, className, style }) {
    const safeSrc =
      typeof src === "string" && allowedImageProtocol.test(src) ? src : null;

    if (!safeSrc) {
      return null;
    }

    return (
      <span className="vault-md-image-frame">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={safeSrc}
          alt={alt ?? ""}
          title={title}
          loading="lazy"
          decoding="async"
          {...styledProps("vault-md-img", className, style)}
        />
        <span className="vault-md-image-fallback">
          Image unavailable
        </span>
      </span>
    );
  },
  iframe({ src, title, width, height, className, style }) {
    const safeSrc = safeIframeSrc(src);

    if (!safeSrc) {
      return null;
    }

    const embedWidth = iframeDimension(width, 560, 1200);
    const embedHeight = iframeDimension(height, 315, 900);

    return (
      <iframe
        src={safeSrc}
        title={typeof title === "string" ? title : "Embedded media"}
        width={embedWidth}
        height={embedHeight}
        allow={iframeAllow}
        allowFullScreen
        loading="lazy"
        referrerPolicy="strict-origin-when-cross-origin"
        sandbox={iframeSandbox}
        {...styledProps("vault-md-iframe", className, style)}
      />
    );
  },
  ul({ children, className, style }) {
    return <ul {...styledProps("vault-md-ul", className, style)}>{children}</ul>;
  },
  ol({ children, className, style }) {
    return <ol {...styledProps("vault-md-ol", className, style)}>{children}</ol>;
  },
  li({ children, className, style, node, ...rest }) {
    const status = (rest as { "data-task-status"?: string })["data-task-status"];
    const localLine = node?.position?.start.line;
    const task = localLine ? readTasks?.get(startLine + localLine - 1) : null;
    const taskChildren = task && onTaskToggle
      ? enableReadTaskCheckbox(children, (checked) => onTaskToggle(task, checked))
      : children;
    return (
      <li
        {...styledProps("vault-md-li", className, style)}
        data-task-status={status === "in_progress" || status === "cancelled" ? status : undefined}
      >
        {groupTaskItemChildren(taskChildren)}
      </li>
    );
  },
  blockquote({ children, className, style }) {
    const callout = parseCalloutChildren(children);

    if (callout) {
      return <Callout {...callout} />;
    }

    return <blockquote {...styledProps("vault-md-blockquote", className, style)}>{children}</blockquote>;
  },
  hr() {
    return <hr className="vault-md-hr" />;
  },
  table({ children }) {
    return (
      <div className="vault-md-table-wrap">
        <table className="vault-md-table">{children}</table>
      </div>
    );
  },
  th({ children }) {
    return <th className="vault-md-th">{children}</th>;
  },
  td({ children }) {
    return <td className="vault-md-td">{children}</td>;
  },
  pre({ children, className, style, node }) {
    const code = node?.children.find((child) => child.type === "element" && child.tagName === "code");
    if (!code || code.type !== "element") return <pre {...styledProps("vault-md-pre", className, style)}>{children}</pre>;
    // Mark the block's own <code> so the `code` renderer below can tell it from
    // inline code. Context would be the usual tool, but this tree also renders
    // as a server component and through `renderToStaticMarkup`, where there is
    // no provider to read.
    const marked = Children.map(children, (child) => (isValidElement(child) ? cloneElement(child as ReactElement<{ inBlock?: boolean }>, { inBlock: true }) : child));
    return <CodeBlock source={codeNodeText(code)} info={codeInfoFromClassName(code.properties.className)} {...styledProps("vault-md-pre", className, style)}>{marked}</CodeBlock>;
  },
  code({ children, className, style, inBlock }: { children?: ReactNode; className?: string; style?: CSSProperties; inBlock?: boolean }) {
    if (inBlock) return <code {...styledProps("vault-md-code", className, style)}>{children}</code>;
    return <InlineCode {...styledProps("vault-md-code", className, style)}>{children}</InlineCode>;
  },
  strong({ children, className, style }) {
    return <strong {...styledProps("vault-md-strong", className, style)}>{children}</strong>;
  },
  em({ children, className, style }) {
    return <em {...styledProps("vault-md-em", className, style)}>{children}</em>;
  },
  a({ href, children, className, style, target, rel }) {
    const isAssetFileCard = hasMarkdownClass(className, "vault-asset-embed--file");
    const isAssetFileAction = hasMarkdownClass(className, "vault-asset-file-action");
    const baseClassName = isAssetFileCard || isAssetFileAction ? "" : "vault-md-link";

    if (disableLinks) {
      return <span {...styledProps(baseClassName, className, style)}>{children}</span>;
    }

    const safeHref = href && allowedLinkProtocol.test(href) ? href : "#";
    const safeTarget = target === "_blank" ? "_blank" : undefined;
    const linkTarget =
      safeTarget ??
      (safeHref.startsWith("/") || safeHref.startsWith("#") ? undefined : "_blank");
    const targetKey = hrefWithoutFragment(safeHref);
    const wikiTarget =
      isAssetFileCard || isAssetFileAction ? undefined : linkTargets.get(targetKey);
    const plainLink = (
      <a
        href={safeHref}
        rel={linkTarget === "_blank" ? (rel || "noreferrer") : undefined}
        target={linkTarget}
        {...styledProps(baseClassName, className, style)}
      >
        {children}
      </a>
    );

    if (wikiTarget) {
      // Counted during render exactly like `headingIds`: the map is created
      // fresh per `MarkdownDocument` render, so a StrictMode double render
      // starts from zero both times.
      const occurrence = linkOccurrences.get(targetKey) ?? 0;
      linkOccurrences.set(targetKey, occurrence + 1);

      // Extensions decide whether this link gets a hover card (the
      // dictionary's definition previews); without one it is `plainLink`.
      return (
        <ExtensionLinkHost
          link={{
            target: wikiTarget.label,
            label: wikiTarget.label,
            href: safeHref,
            resolved: true,
            isDefinition: wikiTarget.isDefinition,
            preview: wikiTarget.preview,
            occurrence,
          }}
          extensions={extensions}
          fallback={plainLink}
        >
          {children}
        </ExtensionLinkHost>
      );
    }

    return plainLink;
  },
  input(props) {
    return <input {...props} className="vault-md-checkbox" disabled={props.disabled !== false} />;
  },
  [TASK_REPEAT_ELEMENT_NAME]: (props: { "data-value"?: string }) => <TaskRepeatBadge repeat={props["data-value"]} />,
  [TASK_PRIORITY_ELEMENT_NAME]: (props: { "data-value"?: string }) => <TaskPriorityBadge priority={props["data-value"]} />,
  [TASK_DATE_ELEMENT_NAME]: (props: { "data-kind"?: string; "data-value"?: string }) => {
    const value = props["data-value"] ?? "";
    const kind = props["data-kind"] === "done" ? "done" : "due";
    if (!/^\d{4}-\d{2}-\d{2}( \d{2}:\d{2})?$/.test(value)) return null;
    return (
      <time
        className="vault-md-task-date"
        data-kind={kind}
        dateTime={value.replace(" ", "T")}
        title={kind === "done" ? `Completed ${value}` : `Due ${value}`}
      >
        {kind === "done" ? "✓ " : ""}{formatTaskDateAbsolute(value)}
      </time>
    );
  },
  [TASK_PROGRESS_ELEMENT_NAME]: (props: { "data-done"?: string; "data-total"?: string }) => {
    const done = Number(props["data-done"]);
    const total = Number(props["data-total"]);
    if (!Number.isInteger(done) || !Number.isInteger(total) || total <= 0 || done < 0 || done > total) return null;
    return (
      <span className="vault-md-task-progress" data-complete={String(done === total)} title={`${done} of ${total} subtasks done`}>
        {done}/{total}
      </span>
    );
  },
  // `remarkInlineDirectives` emits this element, carrying only a key, for each
  // claimed inline directive (`:calc[…]`). The extension's component supplies
  // every class, which keeps them out of the raw-HTML className filter in
  // `rehypeSanitizeContent`.
  [EXTENSION_INLINE_ELEMENT]: (props: Record<string, string | undefined>) => (
    <ExtensionInlineHost occurrenceKey={props[EXTENSION_INLINE_KEY_ATTRIBUTE]} />
  ),
  } as Components;
}

const taskItemBlockTags = new Set([
  "ul", "ol", "p", "div", "blockquote", "pre", "table", "hr",
  "h1", "h2", "h3", "h4", "h5", "h6",
]);

function enableReadTaskCheckbox(children: ReactNode, onChange: (checked: boolean) => void): ReactNode {
  return Children.map(children, (child) => {
    if (!isValidElement(child)) return child;
    if ((child.props as { type?: unknown }).type === "checkbox") {
      return cloneElement(child as ReactElement<{ disabled?: boolean; onChange?: (event: ChangeEvent<HTMLInputElement>) => void }>, {
        disabled: false,
        onChange: (event) => onChange(event.target.checked),
      });
    }
    // Loose task lists put the box inside a paragraph. Do not descend into a
    // nested list, whose checkboxes belong to their own list items.
    if ((child.props as { node?: { tagName?: unknown } }).node?.tagName === "p") {
      const paragraph = child as ReactElement<{ children?: ReactNode }>;
      return cloneElement(paragraph, {
        children: enableReadTaskCheckbox(paragraph.props.children, onChange),
      });
    }
    return child;
  });
}

function groupTaskItemChildren(children: ReactNode): ReactNode {
  const items = Children.toArray(children);
  const isCheckbox = (item: ReactNode) =>
    isValidElement(item) && (item.props as { type?: unknown }).type === "checkbox";
  if (!items.some(isCheckbox)) return children;

  const isBlock = (item: ReactNode) => {
    if (!isValidElement(item)) return false;
    const tagName = (item.props as { node?: { tagName?: unknown } }).node?.tagName;
    return typeof tagName === "string" && taskItemBlockTags.has(tagName);
  };
  const grouped: ReactNode[] = [];
  let run: ReactNode[] = [];
  const flush = () => {
    if (run.some((item) => typeof item !== "string" || item.trim() !== "")) {
      grouped.push(<span key={`task-text-${grouped.length}`} className="vault-md-task-text">{run}</span>);
    }
    run = [];
  };
  for (const item of items) {
    if (isCheckbox(item) || isBlock(item)) {
      flush();
      grouped.push(item);
    } else run.push(item);
  }
  flush();
  return grouped;
}

function Callout({
  inputType,
  canonicalType,
  metadata,
  title,
  body,
}: {
  inputType: string;
  canonicalType: string;
  metadata: string;
  title: string;
  body: ReactNode[];
}) {
  const definition =
    calloutDefinitions[canonicalType as keyof typeof calloutDefinitions] ??
    calloutDefinitions.note;
  const Icon = definition.icon;
  const header = (
    <div className="callout-title">
      <CalloutIcon fallbackIconName={definition.iconName}>
        <Icon className="size-5" />
      </CalloutIcon>
      <span className="callout-title-inner">{title || definition.title}</span>
    </div>
  );

  if (metadata === "+" || metadata === "-") {
    return (
      <details
        className="callout"
        data-callout={inputType}
        data-callout-fold={metadata}
        data-callout-resolved={definition.type}
        open={metadata === "+"}
      >
        <summary className="callout-summary">{header}</summary>
        {body.length > 0 ? <div className="callout-content">{body}</div> : null}
      </details>
    );
  }

  return (
    <div
      className="callout"
      data-callout={inputType}
      data-callout-resolved={definition.type}
    >
      {header}
      {body.length > 0 ? <div className="callout-content">{body}</div> : null}
    </div>
  );
}

function parseCalloutChildren(children: ReactNode) {
  const childArray = Children.toArray(children);
  const firstElementIndex = childArray.findIndex((child) => isValidElement(child));
  const firstChild = childArray[firstElementIndex];
  const restChildren = childArray.slice(firstElementIndex + 1);

  if (!isValidElement(firstChild)) {
    return null;
  }

  const firstParagraphChildren = getElementChildren(firstChild);
  const rawFirstParagraphText = reactNodeToText(firstParagraphChildren);
  const markerOffset =
    rawFirstParagraphText.length - rawFirstParagraphText.trimStart().length;
  const firstParagraphText = rawFirstParagraphText.slice(markerOffset);
  const [markerLine = "", ...sameParagraphBodyLines] =
    firstParagraphText.split(/\r?\n/);
  const match = markerLine.match(/^\[!([^\]\s]+)\]([+-])?\s*(.*)$/i);

  if (!match) {
    return null;
  }

  const inputType = normalizeCalloutType(match[1]);
  const metadata = match[2] ?? "";
  const canonicalType = calloutAliases.get(inputType) ?? inputType;
  const definition =
    calloutDefinitions[canonicalType as keyof typeof calloutDefinitions] ??
    calloutDefinitions.note;
  const title = match[3]?.trim() || definition.title;
  const sameParagraphBody = trimLeadingWhitespaceFromNodes(
    extractReactNodesAfterTextOffset(
      firstParagraphChildren,
      markerOffset + markerLine.length,
    ),
  );

  return {
    inputType,
    canonicalType,
    metadata,
    title,
    body: [
      ...createCalloutBodyFromMarkerParagraph(
        sameParagraphBodyLines,
        sameParagraphBody,
      ),
      ...restChildren,
    ],
  };
}

function createCalloutBodyFromMarkerParagraph(
  bodyLines: string[],
  preservedBodyChildren: ReactNode[],
) {
  if (preservedBodyChildren.length > 0) {
    const lines = splitReactNodesByLine(preservedBodyChildren)
      .map((line) => trimLeadingWhitespaceFromNodes(line))
      .filter((line) => reactNodeToText(line).trim().length > 0);

    if (lines.length > 0) {
      return lines.map((line, index) => (
        <p key={`callout-body-${index}`} className="vault-md-p">
          {line}
        </p>
      ));
    }
  }

  const bodyText = bodyLines.join("\n").trim();

  if (!bodyText) {
    return [];
  }

  return bodyText
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line, index) => (
      <p key={`callout-body-${index}`} className="vault-md-p">
        {line}
      </p>
    ));
}

function splitReactNodesByLine(nodes: ReactNode[]) {
  const lines: ReactNode[][] = [[]];

  const pushNode = (node: ReactNode) => {
    lines[lines.length - 1].push(node);
  };

  const pushLineBreaks = (parts: string[]) => {
    parts.forEach((part, index) => {
      if (index > 0) {
        lines.push([]);
      }

      if (part) {
        pushNode(part);
      }
    });
  };

  nodes.forEach((node) => {
    if (node === null || node === undefined || typeof node === "boolean") {
      return;
    }

    if (typeof node === "string" || typeof node === "number") {
      pushLineBreaks(String(node).split(/\r?\n/));
      return;
    }

    pushNode(node);
  });

  return lines;
}

function getElementChildren(element: ReactElement) {
  return (element.props as { children?: ReactNode }).children;
}

function extractReactNodesAfterTextOffset(node: ReactNode, offset: number) {
  const extracted: ReactNode[] = [];
  let consumed = 0;

  const visit = (child: ReactNode) => {
    if (child === null || child === undefined || typeof child === "boolean") {
      return;
    }

    if (typeof child === "string" || typeof child === "number") {
      const text = String(child);
      const nextConsumed = consumed + text.length;

      if (nextConsumed > offset) {
        extracted.push(consumed < offset ? text.slice(offset - consumed) : child);
      }

      consumed = nextConsumed;
      return;
    }

    if (Array.isArray(child)) {
      child.forEach(visit);
      return;
    }

    if (isValidElement(child)) {
      const childText = reactNodeToText(getElementChildren(child));
      const nextConsumed = consumed + childText.length;

      if (nextConsumed <= offset) {
        consumed = nextConsumed;
        return;
      }

      if (consumed >= offset) {
        extracted.push(child);
        consumed = nextConsumed;
        return;
      }

      const nestedChildren = extractReactNodesAfterTextOffset(
        getElementChildren(child),
        offset - consumed,
      );
      extracted.push(
        cloneElement(
          child as ReactElement<{ children?: ReactNode }>,
          undefined,
          ...nestedChildren,
        ),
      );
      consumed = nextConsumed;
    }
  };

  Children.toArray(node).forEach(visit);

  return extracted;
}

function trimLeadingWhitespaceFromNodes(nodes: ReactNode[]) {
  let foundContent = false;
  const trimmed: ReactNode[] = [];

  for (const node of nodes) {
    if (foundContent) {
      trimmed.push(node);
      continue;
    }

    if (typeof node === "string" || typeof node === "number") {
      const value = String(node).replace(/^\s+/, "");

      if (value) {
        foundContent = true;
        trimmed.push(value);
      }

      continue;
    }

    if (isValidElement(node)) {
      const children = getElementChildren(node);
      const trimmedChildren = trimLeadingWhitespaceFromNodes(
        Children.toArray(children),
      );

      if (trimmedChildren.length > 0) {
        foundContent = true;
        trimmed.push(
          cloneElement(
            node as ReactElement<{ children?: ReactNode }>,
            undefined,
            ...trimmedChildren,
          ),
        );
      }

      continue;
    }

    trimmed.push(node);
    foundContent = true;
  }

  return trimmed;
}

function reactNodeToText(node: ReactNode): string {
  if (typeof node === "string" || typeof node === "number") {
    return String(node);
  }

  if (Array.isArray(node)) {
    return node.map(reactNodeToText).join("");
  }

  if (isValidElement(node)) {
    return reactNodeToText(getElementChildren(node));
  }

  return "";
}

function normalizeCalloutType(type: string) {
  return type.trim().toLowerCase().replace(/[^a-z0-9_-]/g, "-");
}

export function MarkdownDocument({
  markdown,
  className,
  compact = false,
  contained = true,
  disableLinks = false,
  wikiLinks,
  assetLinks,
  embedDepth = 0,
  embedTrail = [],
  extensions,
  onTaskToggle,
  taskSource,
}: MarkdownDocumentProps) {
  const bodyMarkdown = stripDocumentFrontmatter(markdown || "").trim()
    ? stripDocumentFrontmatter(markdown || "")
    : "_No content yet._";
  const sourceMarkdown = transformAssetEmbeds(
    normalizeSelfClosingIframes(bodyMarkdown),
    assetLinks,
  );
  const blocks = splitWikiDocumentEmbeds(sourceMarkdown, wikiLinks);
  const headingIds = new Map<string, number>();
  // Created per render and threaded down the same path as `headingIds`, because
  // a link's occurrence has to count across every Markdown segment of the
  // document, not restart in each one.
  const linkOccurrences = new Map<string, number>();
  const readTasks = onTaskToggle
    ? taskSource?.tasks ?? mapReadTaskSources(markdown || "", sourceMarkdown,
        (line) => transformAssetEmbeds(normalizeSelfClosingIframes(line), assetLinks))
    : null;
  const strippedLineCount = taskSource
    ? (markdown.slice(0, markdown.length - stripDocumentFrontmatter(markdown).length).match(/\n/g)?.length ?? 0)
    : 0;
  const sourceOffset = (taskSource?.offset ?? 0) + strippedLineCount;

  // Extension directives are planned once, here, before anything renders: an
  // extension's `analyze` (calc binding names top to bottom) needs every
  // occurrence in document order, but the document renders as several
  // independent `MarkdownSegment`s. One plan state numbers pieces across the
  // whole document. Pure in its inputs (the state is fresh per render), so a
  // StrictMode double-render produces identical keys.
  const plan = createDirectivePlanState();
  const blockParts = blocks.map((block) =>
    block.type === "markdown" ? planExtensionParts(block.markdown, plan) : null,
  );
  const extensionDocuments = groupOccurrences(plan, markdown || "");

  const rendered = (
    <div
      className={cn(
        "vault-markdown",
        contained ? "mx-auto max-w-3xl" : null,
        compact ? "vault-markdown-compact" : null,
        className,
      )}
    >
      {blocks.map((block, index) =>
        block.type === "markdown" ? (
          <MarkdownBlock
            key={`markdown-${index}`}
            parts={blockParts[index] ?? []}
            disableLinks={disableLinks}
            wikiLinks={wikiLinks}
            assetLinks={assetLinks}
            headingIds={headingIds}
            linkOccurrences={linkOccurrences}
            extensions={extensions ?? null}
            documentMarkdown={markdown || ""}
            readTasks={readTasks}
            onTaskToggle={onTaskToggle}
            startLine={sourceOffset + block.startLine}
          />
        ) : block.type === "region" ? (
          <VaultRegion
            key={`region-${index}-${block.id}`}
            block={block}
            disableLinks={disableLinks}
            wikiLinks={wikiLinks}
            assetLinks={assetLinks}
            embedDepth={embedDepth}
            embedTrail={embedTrail}
            onTaskToggle={onTaskToggle}
            taskSource={readTasks ? { tasks: readTasks, offset: sourceOffset + block.startLine } : undefined}
          />
        ) : (
          <WikiDocumentEmbed
            key={`embed-${index}-${block.target}`}
            block={block}
            disableLinks={disableLinks}
            wikiLinks={wikiLinks}
            assetLinks={assetLinks}
            embedDepth={embedDepth}
            embedTrail={embedTrail}
          />
        ),
      )}
    </div>
  );

  // Only documents with occurrences carry the provider (and its data) to the
  // client; the rest render exactly as they did.
  return Object.keys(extensionDocuments).length > 0 ? (
    <ExtensionDocumentProvider
      extensions={extensions ?? null}
      documents={extensionDocuments}
    >
      {rendered}
    </ExtensionDocumentProvider>
  ) : (
    rendered
  );
}

/**
 * Per extension, the occurrences `analyze` receives. The document's text is
 * reduced to its frontmatter, the only part an analyzer reads beyond its own
 * occurrences (calc's `calc_currency`), so the page does not carry the whole
 * body to the browser twice.
 */
function groupOccurrences(
  plan: DirectivePlanState,
  markdown: string,
): Record<string, AnalyzableDocument> {
  const documents: Record<string, AnalyzableDocument> = {};
  const frontmatter = /^---\r?\n[\s\S]*?\r?\n---(?:\r?\n|$)/.exec(markdown)?.[0] ?? "";

  for (const found of plan.occurrences) {
    const { owner, ...occurrence } = found;
    (documents[owner] ??= { markdown: frontmatter, occurrences: [] }).occurrences.push(
      occurrence,
    );
  }

  return documents;
}

function VaultRegion({
  block,
  disableLinks,
  wikiLinks,
  assetLinks,
  embedDepth,
  embedTrail,
  onTaskToggle,
  taskSource,
}: {
  block: Extract<WikiDocumentEmbedBlock, { type: "region" }>;
  disableLinks: boolean;
  wikiLinks?: WikiLinkResolutionMap;
  assetLinks?: AssetEmbedResolutionMap;
  embedDepth: number;
  embedTrail: string[];
  onTaskToggle?: ReadTaskToggle;
  taskSource?: { tasks: Map<number, ParsedTask>; offset: number };
}) {
  const body = block.markdown ? (
    <MarkdownDocument
      markdown={block.markdown}
      wikiLinks={wikiLinks}
      assetLinks={assetLinks}
      disableLinks={disableLinks}
      embedDepth={embedDepth}
      embedTrail={embedTrail}
      contained={false}
      className="vault-md-region-body"
      onTaskToggle={onTaskToggle}
      taskSource={taskSource}
    />
  ) : null;

  if (block.foldable) {
    return (
      <details
        id={block.id}
        className="vault-md-region vault-md-region-foldable"
        data-region-id={block.id}
        open={!block.collapsed}
      >
        <summary className="vault-md-region-summary">
          <span className="vault-md-region-caret" aria-hidden="true" />
          <span className="vault-md-region-title">{block.title}</span>
        </summary>
        {body}
      </details>
    );
  }

  return (
    <section
      id={block.id}
      className="vault-md-region vault-md-region-static"
      data-region-id={block.id}
    >
      {body}
    </section>
  );
}

function MarkdownBlock({
  parts,
  disableLinks,
  wikiLinks,
  assetLinks,
  headingIds,
  linkOccurrences,
  extensions,
  documentMarkdown,
  readTasks,
  onTaskToggle,
  startLine,
}: {
  parts: DirectivePart[];
  disableLinks: boolean;
  wikiLinks?: WikiLinkResolutionMap;
  assetLinks?: AssetEmbedResolutionMap;
  headingIds: Map<string, number>;
  linkOccurrences: Map<string, number>;
  extensions: DocumentExtensions | null;
  documentMarkdown: string;
  readTasks: Map<number, ParsedTask> | null;
  onTaskToggle?: ReadTaskToggle;
  startLine: number;
}) {
  return (
    <>
      {parts.map((part, index) => {
        if (part.kind === "leaf" || part.kind === "container") {
          return (
            <ExtensionBlockHost
              key={`block-${index}-${part.source}`}
              // Read mode is read-only for every block; editing happens in
              // Live mode, whose widget passes the page's own `canEdit`.
              ctx={{
                ...createRenderContext(extensions, part.owner),
                canEdit: false,
              }}
              name={part.name}
              attributes={part.attributes}
              source={part.source}
              body={part.kind === "container" ? part.body : null}
              occurrenceKey={part.kind === "container" ? part.key : null}
              links={{ wikiLinks, assetLinks }}
              documentMarkdown={documentMarkdown}
            />
          );
        }

        if (!part.markdown.trim()) {
          return null;
        }

        return (
          <MarkdownSegment
            key={`markdown-${index}`}
            markdown={part.markdown}
            disableLinks={disableLinks}
            wikiLinks={wikiLinks}
            assetLinks={assetLinks}
            headingIds={headingIds}
            linkOccurrences={linkOccurrences}
            extensions={extensions}
            keyPrefix={String(part.pieceIndex)}
            readTasks={readTasks}
            onTaskToggle={onTaskToggle}
            startLine={startLine + part.startLine}
          />
        );
      })}
    </>
  );
}

function MarkdownSegment({
  markdown,
  disableLinks,
  wikiLinks,
  assetLinks,
  headingIds,
  linkOccurrences,
  extensions,
  keyPrefix,
  readTasks,
  onTaskToggle,
  startLine,
}: {
  markdown: string;
  disableLinks: boolean;
  wikiLinks?: WikiLinkResolutionMap;
  assetLinks?: AssetEmbedResolutionMap;
  headingIds: Map<string, number>;
  linkOccurrences: Map<string, number>;
  extensions: DocumentExtensions | null;
  keyPrefix: string;
  readTasks: Map<number, ParsedTask> | null;
  onTaskToggle?: ReadTaskToggle;
  startLine: number;
}) {
  const renderedMarkdown = transformWikiLinks(
    transformAssetEmbeds(markdown, assetLinks),
    wikiLinks,
  );
  // Derived rather than threaded down beside `wikiLinks`: the derivation is
  // cached against the map's identity, so asking per segment costs one lookup.
  // A card's own inner render passes no `wikiLinks`, which is how nesting stops.
  const linkTargets = buildWikiLinkTargetsByHref(wikiLinks);

  return (
    <ReactMarkdown
      // `directiveRemarkPlugins` is shared with the pre-pass that collected the
      // occurrences: both must walk identical trees or a key assigned here
      // would point at another occurrence.
      remarkPlugins={[
        ...directiveRemarkPlugins,
        remarkTasks,
        [
          remarkInlineDirectives,
          { names: inlineDirectiveNames, keyPrefix },
        ],
      ]}
      rehypePlugins={[
        rehypeRaw,
        [rehypeSanitize, safeHtmlSchema],
        rehypeSanitizeContent,
        rehypeCodeHighlight,
        rehypeKatex,
      ]}
      components={createMarkdownComponents(
        disableLinks,
        headingIds,
        linkTargets,
        linkOccurrences,
        extensions,
        startLine,
        readTasks,
        onTaskToggle,
      )}
    >
      {renderedMarkdown}
    </ReactMarkdown>
  );
}

function WikiDocumentEmbed({
  block,
  disableLinks,
  wikiLinks,
  assetLinks,
  embedDepth,
  embedTrail,
}: {
  block: Extract<WikiDocumentEmbedBlock, { type: "embed" }>;
  disableLinks: boolean;
  wikiLinks?: WikiLinkResolutionMap;
  assetLinks?: AssetEmbedResolutionMap;
  embedDepth: number;
  embedTrail: string[];
}) {
  const resolution = block.resolution;
  const title = resolution?.label || block.label || block.target;
  const documentId = resolution?.documentId;
  const href =
    resolution?.href && block.fragment
      ? `${resolution.href}#${encodeURIComponent(normalizeWikiFragmentForHref(block.fragment))}`
      : resolution?.href;
  const isRecursive = Boolean(documentId && embedTrail.includes(documentId));
  const canRender =
    resolution?.status === "resolved" &&
    typeof resolution.embedMarkdown === "string" &&
    !isRecursive &&
    embedDepth < maxWikiEmbedDepth;

  return (
    <section
      className={cn(
        "vault-md-document-embed",
        canRender ? null : "vault-md-document-embed-unavailable",
      )}
      data-embed-status={resolution?.status ?? "unresolved"}
    >
      <div className="vault-md-document-embed-header">
        <span className="vault-md-document-embed-icon" aria-hidden="true">
          <FileText className="size-4" />
        </span>
        {href && !disableLinks ? (
          <a className="vault-md-document-embed-title" href={href}>
            {title}
          </a>
        ) : (
          <span className="vault-md-document-embed-title">{title}</span>
        )}
      </div>
      {canRender ? (
        <MarkdownDocument
          markdown={extractMarkdownTarget(
            resolution.embedMarkdown ?? "",
            block.fragment,
          )}
          wikiLinks={wikiLinks}
          assetLinks={assetLinks}
          disableLinks={disableLinks}
          embedDepth={embedDepth + 1}
          embedTrail={documentId ? [...embedTrail, documentId] : embedTrail}
          contained={false}
          className="vault-md-document-embed-body"
        />
      ) : (
        <p className="vault-md-document-embed-message">
          {isRecursive
            ? "Recursive embed skipped."
            : embedDepth >= maxWikiEmbedDepth
              ? "Embed depth limit reached."
              : resolution?.status === "private"
                ? "Document is private or unavailable here."
                : resolution?.status === "ambiguous"
                  ? "Ambiguous document embed."
                  : "Document embed could not be resolved."}
        </p>
      )}
    </section>
  );
}
