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
import { BookOpen, FileText, Globe2, ImageIcon, Search, X } from "lucide-react";

import { cn } from "@/lib/utils";

type CommandSearchResult = {
  id: string;
  kind: "document" | "public" | "asset" | "guide";
  title: string;
  href: string;
  detail: string;
};

export function WorkspaceCommandPalette() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<CommandSearchResult[]>([]);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [loading, setLoading] = useState(false);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const trimmedQuery = query.trim();
  const groupedResults = useMemo(() => groupResults(results), [results]);

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
    if (!open) {
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
  }, [open, trimmedQuery]);

  useEffect(() => {
    setSelectedIndex(0);
  }, [results]);

  const label = useMemo(
    () => (trimmedQuery ? "Search results" : "Quick open"),
    [trimmedQuery],
  );

  if (!open) {
    return null;
  }

  function closePalette() {
    setOpen(false);
  }

  function navigateToResult(result: CommandSearchResult) {
    closePalette();
    router.push(result.href);
  }

  function onInputKeyDown(event: ReactKeyboardEvent<HTMLInputElement>) {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setSelectedIndex((current) =>
        results.length === 0 ? 0 : (current + 1) % results.length,
      );
      return;
    }

    if (event.key === "ArrowUp") {
      event.preventDefault();
      setSelectedIndex((current) =>
        results.length === 0
          ? 0
          : (current - 1 + results.length) % results.length,
      );
      return;
    }

    if (event.key === "Enter") {
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
          <Search className="size-4 text-muted-foreground" />
          <input
            ref={inputRef}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={onInputKeyDown}
            placeholder="Search docs, assets, guides, tags..."
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
            {loading ? "Searching" : label}
          </p>
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
        </div>
      </div>
    </div>
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
