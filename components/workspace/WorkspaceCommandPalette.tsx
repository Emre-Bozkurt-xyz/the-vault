"use client";

import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
} from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  Archive,
  Blocks,
  BookOpen,
  FilePlus,
  FileText,
  Globe2,
  Home,
  ImageIcon,
  LayoutGrid,
  Link2,
  LogOut,
  Palette,
  Save,
  Search,
  Settings,
  Slash,
  UserRound,
  X,
  type LucideIcon,
} from "lucide-react";

import { useVaultTheme } from "@/components/theme-provider";
import { openWorkspaceSettings } from "@/components/settings/SettingsModalController";
import { useActiveDocumentCommand } from "@/components/workspace/WorkspaceChrome";
import { signOutAction } from "@/server/auth-actions";
import {
  archiveDocumentAction,
  createDocumentAction,
  createManualDocumentVersionAction,
  publishDocumentAction,
  unpublishDocumentAction,
} from "@/server/documents";
import { cn } from "@/lib/utils";

type CommandSearchResult = {
  id: string;
  kind: "document" | "public" | "asset" | "guide";
  title: string;
  href: string;
  detail: string;
};

type WorkspaceCommand = {
  id: string;
  label: string;
  group: string;
  /** Extra terms (besides label/group) used for `/...` filtering. */
  keywords: string;
  icon: LucideIcon;
  run: () => void | Promise<void>;
};

/** A `documentId`-only FormData for the document server actions. */
function documentForm(documentId: string): FormData {
  const form = new FormData();
  form.set("documentId", documentId);
  return form;
}

export function WorkspaceCommandPalette() {
  const router = useRouter();
  const { setTheme } = useVaultTheme();
  const activeDocument = useActiveDocumentCommand();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<CommandSearchResult[]>([]);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [loading, setLoading] = useState(false);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const trimmedQuery = query.trim();

  // `/` flips the bar from search into command mode; the text after the slash
  // filters the command list (space-separated terms, all must match).
  const isCommandMode = query.trimStart().startsWith("/");
  const commandTerm = isCommandMode
    ? query.trimStart().slice(1).trim().toLowerCase()
    : "";

  const commands = useMemo<WorkspaceCommand[]>(() => {
    const navigate = (href: string) => () => {
      router.push(href);
    };

    const list: WorkspaceCommand[] = [
      {
        id: "new-document",
        label: "New document",
        group: "Create",
        keywords: "create note doc",
        icon: FilePlus,
        run: () => {
          void createDocumentAction();
        },
      },
      {
        id: "go-home",
        label: "Go to workspace",
        group: "Go to",
        keywords: "home workspace",
        icon: Home,
        run: navigate("/workspace"),
      },
      {
        id: "go-gallery",
        label: "Open gallery",
        group: "Go to",
        keywords: "public explore",
        icon: LayoutGrid,
        run: navigate("/gallery"),
      },
      {
        id: "go-assets",
        label: "Open assets",
        group: "Go to",
        keywords: "images library files",
        icon: ImageIcon,
        run: navigate("/assets"),
      },
      {
        id: "go-guides",
        label: "Open guides",
        group: "Go to",
        keywords: "docs help official",
        icon: BookOpen,
        run: navigate("/docs"),
      },
      {
        id: "open-settings",
        label: "Open settings",
        group: "Settings",
        keywords: "preferences config",
        icon: Settings,
        run: () => openWorkspaceSettings(),
      },
      {
        id: "open-extensions",
        label: "Open extensions",
        group: "Settings",
        keywords: "plugins add-ons calendar stickers",
        icon: Blocks,
        run: () => openWorkspaceSettings("extension-browser"),
      },
      {
        id: "open-account",
        label: "Open account settings",
        group: "Settings",
        keywords: "profile login email",
        icon: UserRound,
        run: () => openWorkspaceSettings("account"),
      },
    ];

    const themes: { id: Parameters<typeof setTheme>[0]; label: string }[] = [
      { id: "dark", label: "Dark" },
      { id: "light", label: "Light" },
      { id: "midnight", label: "Midnight" },
      { id: "graphite", label: "Graphite" },
      { id: "paper", label: "Paper" },
      { id: "system", label: "System" },
    ];

    for (const theme of themes) {
      list.push({
        id: `theme-${theme.id}`,
        label: `Theme: ${theme.label}`,
        group: "Appearance",
        keywords: `theme appearance ${theme.id}`,
        icon: Palette,
        run: () => setTheme(theme.id),
      });
    }

    if (activeDocument) {
      const doc = activeDocument;

      if (doc.canPublish) {
        if (doc.visibility === "public") {
          list.push({
            id: "doc-unpublish",
            label: "Unpublish document",
            group: "This document",
            keywords: "private hide public",
            icon: Globe2,
            run: () => unpublishDocumentAction(documentForm(doc.id)),
          });
        } else {
          list.push({
            id: "doc-publish",
            label: "Publish document",
            group: "This document",
            keywords: "public share web",
            icon: Globe2,
            run: () => publishDocumentAction(documentForm(doc.id)),
          });
        }
      }

      if (doc.visibility === "public" && doc.publicSlug) {
        const slug = doc.publicSlug;
        list.push({
          id: "doc-copy-link",
          label: "Copy public link",
          group: "This document",
          keywords: "url share clipboard",
          icon: Link2,
          run: () => {
            void navigator.clipboard?.writeText(
              `${window.location.origin}/public/${slug}`,
            );
          },
        });
      }

      if (doc.canEdit) {
        list.push({
          id: "doc-snapshot",
          label: "Save restore point",
          group: "This document",
          keywords: "version snapshot history backup",
          icon: Save,
          run: () => createManualDocumentVersionAction(documentForm(doc.id)),
        });
      }

      if (doc.canDelete) {
        list.push({
          id: "doc-archive",
          label: "Archive document",
          group: "This document",
          keywords: "delete remove trash",
          icon: Archive,
          run: () => archiveDocumentAction(documentForm(doc.id)),
        });
      }
    }

    list.push({
      id: "logout",
      label: "Sign out",
      group: "Account",
      keywords: "log out exit",
      icon: LogOut,
      run: () => signOutAction(),
    });

    return list;
  }, [router, setTheme, activeDocument]);

  const filteredCommands = useMemo(() => {
    if (!isCommandMode) {
      return [];
    }

    if (!commandTerm) {
      return commands;
    }

    const terms = commandTerm.split(/\s+/).filter(Boolean);
    return commands.filter((command) => {
      const haystack =
        `${command.label} ${command.group} ${command.keywords}`.toLowerCase();
      return terms.every((term) => haystack.includes(term));
    });
  }, [isCommandMode, commandTerm, commands]);

  const groupedResults = useMemo(() => groupResults(results), [results]);
  const groupedCommands = useMemo(
    () => groupCommands(filteredCommands),
    [filteredCommands],
  );
  const itemCount = isCommandMode ? filteredCommands.length : results.length;

  useEffect(() => {
    function onKeyDown(event: globalThis.KeyboardEvent) {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setOpen(true);
      }

      if (event.key === "Escape") {
        setOpen(false);
      }
    }

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  useEffect(() => {
    if (!open) {
      return;
    }

    const frame = window.requestAnimationFrame(() => inputRef.current?.focus());
    return () => window.cancelAnimationFrame(frame);
  }, [open]);

  useEffect(() => {
    // Command mode is local; only search mode hits the content API.
    if (!open || isCommandMode) {
      return;
    }

    const controller = new AbortController();
    const timeout = window.setTimeout(() => {
      setLoading(true);
      void fetch(`/api/content/search?q=${encodeURIComponent(trimmedQuery)}`, {
        signal: controller.signal,
      })
        .then((response) => (response.ok ? response.json() : null))
        .then((payload: { results?: CommandSearchResult[] } | null) => {
          setResults(payload?.results ?? []);
        })
        .catch(() => null)
        .finally(() => setLoading(false));
    }, 120);

    return () => {
      window.clearTimeout(timeout);
      controller.abort();
    };
  }, [open, isCommandMode, trimmedQuery]);

  useEffect(() => {
    setSelectedIndex(0);
  }, [isCommandMode, commandTerm, results]);

  const label = useMemo(() => {
    if (isCommandMode) {
      return "Commands";
    }
    return trimmedQuery ? "Search results" : "Quick open";
  }, [isCommandMode, trimmedQuery]);

  if (!open) {
    return null;
  }

  function closePalette() {
    setOpen(false);
    setQuery("");
  }

  function navigateToResult(result: CommandSearchResult) {
    closePalette();
    router.push(result.href);
  }

  function runCommand(command: WorkspaceCommand) {
    closePalette();
    void command.run();
  }

  function onInputKeyDown(event: ReactKeyboardEvent<HTMLInputElement>) {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setSelectedIndex((current) =>
        itemCount === 0 ? 0 : (current + 1) % itemCount,
      );
      return;
    }

    if (event.key === "ArrowUp") {
      event.preventDefault();
      setSelectedIndex((current) =>
        itemCount === 0 ? 0 : (current - 1 + itemCount) % itemCount,
      );
      return;
    }

    if (event.key === "Enter") {
      if (isCommandMode) {
        const selected = filteredCommands[selectedIndex];
        if (selected) {
          event.preventDefault();
          runCommand(selected);
        }
        return;
      }

      const selected = results[selectedIndex];
      if (selected) {
        event.preventDefault();
        navigateToResult(selected);
      }
    }
  }

  return (
    <div className="fixed inset-0 z-[80] bg-background/72 backdrop-blur-sm">
      <div className="mx-auto mt-[12vh] w-[min(44rem,calc(100vw-1.5rem))] overflow-hidden rounded-md border border-border/80 bg-card shadow-2xl shadow-black/45">
        <div className="flex h-12 items-center gap-3 border-b border-border/70 px-3">
          {isCommandMode ? (
            <Slash className="size-4 text-muted-foreground" />
          ) : (
            <Search className="size-4 text-muted-foreground" />
          )}
          <input
            ref={inputRef}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={onInputKeyDown}
            placeholder="Search docs, assets, guides... or type / for commands"
            className="min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground"
          />
          <button
            type="button"
            aria-label="Close command palette"
            onClick={closePalette}
            className="grid size-7 place-items-center rounded text-muted-foreground transition hover:bg-muted hover:text-foreground"
          >
            <X className="size-4" />
          </button>
        </div>
        <div className="max-h-[min(32rem,65vh)] overflow-y-auto p-2">
          <p className="px-2 py-1 text-[0.68rem] font-semibold uppercase tracking-[0.16em] text-muted-foreground">
            {loading && !isCommandMode ? "Searching" : label}
          </p>
          {isCommandMode ? (
            <div className="grid gap-3">
              {groupedCommands.length > 0 ? (
                groupedCommands.map((group) => (
                  <section key={group.label} className="grid gap-1">
                    <p className="px-2 text-[0.62rem] font-semibold uppercase tracking-[0.16em] text-muted-foreground/80">
                      {group.label}
                    </p>
                    {group.items.map(({ command, index }) => (
                      <CommandActionRow
                        key={command.id}
                        command={command}
                        selected={index === selectedIndex}
                        onFocus={() => setSelectedIndex(index)}
                        onRun={() => runCommand(command)}
                      />
                    ))}
                  </section>
                ))
              ) : (
                <p className="px-2 py-8 text-center text-sm text-muted-foreground">
                  No matching command.
                </p>
              )}
            </div>
          ) : (
            <div className="grid gap-3">
              {groupedResults.length > 0 ? (
                groupedResults.map((group) => (
                  <section key={group.label} className="grid gap-1">
                    <p className="px-2 text-[0.62rem] font-semibold uppercase tracking-[0.16em] text-muted-foreground/80">
                      {group.label}
                    </p>
                    {group.items.map(({ result, index }) => (
                      <CommandResultLink
                        key={result.id}
                        result={result}
                        selected={index === selectedIndex}
                        onFocus={() => setSelectedIndex(index)}
                        onNavigate={closePalette}
                      />
                    ))}
                  </section>
                ))
              ) : (
                <p className="px-2 py-8 text-center text-sm text-muted-foreground">
                  {loading ? "Searching..." : "No matching content."}
                </p>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function CommandActionRow({
  command,
  selected,
  onFocus,
  onRun,
}: {
  command: WorkspaceCommand;
  selected: boolean;
  onFocus: () => void;
  onRun: () => void;
}) {
  const Icon = command.icon;

  return (
    <button
      type="button"
      data-selected={selected || undefined}
      onMouseEnter={onFocus}
      onFocus={onFocus}
      onClick={onRun}
      className={cn(
        "grid grid-cols-[1.5rem_1fr] items-center gap-3 rounded-md px-3 py-2.5 text-left text-sm transition hover:bg-muted",
        selected && "bg-muted text-foreground",
        "text-card-foreground",
      )}
    >
      <Icon className="size-4 text-muted-foreground" />
      <span className="min-w-0 truncate font-medium">{command.label}</span>
    </button>
  );
}

function CommandResultLink({
  result,
  selected,
  onFocus,
  onNavigate,
}: {
  result: CommandSearchResult;
  selected: boolean;
  onFocus: () => void;
  onNavigate: () => void;
}) {
  const Icon =
    result.kind === "asset"
      ? ImageIcon
      : result.kind === "guide"
        ? BookOpen
        : result.kind === "public"
          ? Globe2
          : FileText;

  return (
    <Link
      href={result.href}
      aria-selected={selected}
      onMouseEnter={onFocus}
      onFocus={onFocus}
      onClick={onNavigate}
      className={cn(
        "grid grid-cols-[1.5rem_1fr] gap-3 rounded-md px-3 py-2.5 text-sm transition hover:bg-muted",
        selected && "bg-muted text-foreground",
        "text-card-foreground",
      )}
    >
      <Icon className="mt-0.5 size-4 text-muted-foreground" />
      <span className="min-w-0">
        <span className="block truncate font-medium">{result.title}</span>
        <span className="mt-0.5 block truncate text-xs text-muted-foreground">
          {result.detail}
        </span>
      </span>
    </Link>
  );
}

function groupCommands(commands: WorkspaceCommand[]) {
  const groups = new Map<
    string,
    { label: string; items: { command: WorkspaceCommand; index: number }[] }
  >();

  commands.forEach((command, index) => {
    const group = groups.get(command.group) ?? {
      label: command.group,
      items: [],
    };
    group.items.push({ command, index });
    groups.set(command.group, group);
  });

  return [...groups.values()];
}

function groupResults(results: CommandSearchResult[]) {
  const groups = new Map<
    string,
    { label: string; items: { result: CommandSearchResult; index: number }[] }
  >();

  results.forEach((result, index) => {
    const label = getResultGroupLabel(result);
    const group = groups.get(label) ?? { label, items: [] };
    group.items.push({ result, index });
    groups.set(label, group);
  });

  return [...groups.values()];
}

function getResultGroupLabel(result: CommandSearchResult) {
  if (result.kind === "guide") {
    return "Guides";
  }

  if (result.kind === "asset") {
    return "My assets";
  }

  if (result.kind === "public") {
    return "Public";
  }

  if (result.detail.startsWith("Shared")) {
    return "Shared with me";
  }

  return "My documents";
}
