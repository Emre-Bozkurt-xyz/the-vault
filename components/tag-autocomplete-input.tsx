"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Hash } from "lucide-react";

import { cn } from "@/lib/utils";

type TagSuggestion = {
  slug: string;
  displayName: string;
  category: string;
  assetCount: number;
  documentCount: number;
};

type TagAutocompleteInputProps = {
  value: string;
  onChange: (value: string) => void;
  onCommit?: (value: string) => void;
  placeholder?: string;
  className?: string;
  inputClassName?: string;
  scope?: "mine" | "public";
};

export function TagAutocompleteInput({
  value,
  onChange,
  onCommit,
  placeholder = "tag1 tag2 ...",
  className,
  inputClassName,
  scope = "mine",
}: TagAutocompleteInputProps) {
  const [suggestions, setSuggestions] = useState<TagSuggestion[]>([]);
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);
  const [cursorPosition, setCursorPosition] = useState(value.length);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const activeRange = useMemo(
    () => getActiveTagTokenRange(value, cursorPosition),
    [cursorPosition, value],
  );

  useEffect(() => {
    const controller = new AbortController();
    const timeout = window.setTimeout(() => {
      void fetch(
        `/api/tags/completions?q=${encodeURIComponent(activeRange.token)}&scope=${scope}`,
        { signal: controller.signal },
      )
        .then((response) => (response.ok ? response.json() : null))
        .then((payload: { tags?: TagSuggestion[] } | null) => {
          const next = payload?.tags ?? [];
          setSuggestions(next.filter((tag) => !tagAlreadyUsed(value, tag.slug)));
          setActiveIndex(0);
        })
        .catch(() => null);
    }, 120);

    return () => {
      window.clearTimeout(timeout);
      controller.abort();
    };
  }, [activeRange.token, scope, value]);

  useEffect(() => {
    function closeOnOutsidePointerDown(event: PointerEvent) {
      const target = event.target;

      if (target instanceof Node && containerRef.current?.contains(target)) {
        return;
      }

      setOpen(false);
    }

    document.addEventListener("pointerdown", closeOnOutsidePointerDown, true);
    return () =>
      document.removeEventListener("pointerdown", closeOnOutsidePointerDown, true);
  }, []);

  function selectSuggestion(suggestion: TagSuggestion) {
    const { value: next, cursor } = replaceActiveTagToken(
      value,
      activeRange,
      suggestion.slug,
    );
    onChange(next);
    onCommit?.(next);
    setOpen(false);
    window.requestAnimationFrame(() => {
      inputRef.current?.focus();
      inputRef.current?.setSelectionRange(cursor, cursor);
      setCursorPosition(cursor);
    });
  }

  return (
    <div ref={containerRef} className={cn("relative", className)}>
      <input
        ref={inputRef}
        value={value}
        onChange={(event) => {
          onChange(event.target.value);
          setCursorPosition(event.target.selectionStart ?? event.target.value.length);
          setOpen(true);
        }}
        onClick={(event) =>
          setCursorPosition(event.currentTarget.selectionStart ?? value.length)
        }
        onKeyUp={(event) =>
          setCursorPosition(event.currentTarget.selectionStart ?? value.length)
        }
        onFocus={(event) => {
          setCursorPosition(event.currentTarget.selectionStart ?? value.length);
          setOpen(true);
        }}
        onBlur={() => onCommit?.(value)}
        onKeyDown={(event) => {
          if (!open || suggestions.length === 0) {
            return;
          }

          if (event.key === "ArrowDown") {
            event.preventDefault();
            setActiveIndex((current) => (current + 1) % suggestions.length);
            return;
          }

          if (event.key === "ArrowUp") {
            event.preventDefault();
            setActiveIndex(
              (current) => (current - 1 + suggestions.length) % suggestions.length,
            );
            return;
          }

          if (event.key === "Enter" || event.key === "Tab") {
            event.preventDefault();
            selectSuggestion(suggestions[activeIndex]);
            return;
          }

          if (event.key === "Escape") {
            setOpen(false);
          }
        }}
        placeholder={placeholder}
        spellCheck={false}
        className={inputClassName}
      />

      {open && suggestions.length > 0 ? (
        <div className="absolute left-0 right-0 top-[calc(100%+0.25rem)] z-50 overflow-hidden rounded-md border border-border/70 bg-popover text-popover-foreground shadow-xl shadow-black/30">
          {suggestions.map((suggestion, index) => (
            <button
              key={suggestion.slug}
              type="button"
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => selectSuggestion(suggestion)}
              className={cn(
                "grid w-full grid-cols-[1rem_1fr_auto] items-center gap-2 px-3 py-2 text-left text-sm transition hover:bg-muted",
                index === activeIndex && "bg-muted",
              )}
            >
              <Hash className="size-3.5 text-muted-foreground" />
              <span className="min-w-0">
                <span className="block truncate font-medium">
                  {suggestion.slug}
                </span>
                <span className="block truncate text-[0.68rem] text-muted-foreground">
                  {suggestion.category}
                </span>
              </span>
              <span className="text-[0.68rem] text-muted-foreground">
                {suggestion.documentCount + suggestion.assetCount}
              </span>
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}

function getActiveTagTokenRange(value: string, cursorPosition: number) {
  const cursor = Math.max(0, Math.min(cursorPosition, value.length));
  let start = cursor;
  let end = cursor;

  while (start > 0 && !/\s/.test(value[start - 1] ?? "")) {
    start -= 1;
  }

  while (end < value.length && !/\s/.test(value[end] ?? "")) {
    end += 1;
  }

  return {
    start,
    end,
    token: value.slice(start, end).trim(),
  };
}

function replaceActiveTagToken(
  value: string,
  range: { start: number; end: number },
  tag: string,
) {
  const before = value.slice(0, range.start);
  const after = value.slice(range.end).replace(/^\s*/, "");
  const separator = after ? " " : "";
  const nextValue = `${before}${tag} ${separator}${after}`;
  return {
    value: nextValue,
    cursor: before.length + tag.length + 1,
  };
}

function tagAlreadyUsed(value: string, slug: string) {
  const tokens = value
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  return tokens.filter((token) => token === slug).length > 0;
}
