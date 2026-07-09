"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import {
  DynamicIcon,
  iconNames,
  type IconName,
} from "lucide-react/dynamic";

/**
 * Callout icon with Obsidian-style `--callout-icon` support.
 *
 * The built-in icon (chosen by callout type) is rendered on the server and as
 * the initial client render, so SSR and no-JS surfaces always show a correct
 * icon and there is no hydration mismatch. After mount, a client effect reads
 * the *computed* `--callout-icon` custom property — which a CSS snippet may set
 * per `data-callout` type — and, when it names a different Lucide icon, swaps
 * the SVG in. This mirrors how Obsidian resolves `--callout-icon`.
 *
 * Safety: the snippet compiler rejects any value containing `<`/`>`, so the
 * raw-`<svg>` form Obsidian also accepts can never reach us — only the
 * `lucide-<name>` form survives, and unknown names are ignored. No SVG or
 * markup from a snippet is ever injected.
 */

const lucideIconPattern = /^lucide-([a-z0-9]+(?:-[a-z0-9]+)*)$/;
const knownIconNames = new Set<string>(iconNames);

/** Parse a computed `--callout-icon` value into a known Lucide icon name. */
function parseLucideIconName(rawValue: string): IconName | null {
  const value = rawValue
    .trim()
    .replace(/^["']|["']$/g, "")
    .trim()
    .toLowerCase();
  const match = lucideIconPattern.exec(value);

  if (!match) {
    return null;
  }

  const name = match[1];
  return knownIconNames.has(name) ? (name as IconName) : null;
}

export function CalloutIcon({
  fallbackIconName,
  children,
}: {
  /** The built-in icon's `lucide-*` marker, e.g. `lucide-pencil`. */
  fallbackIconName: string;
  /**
   * The built-in icon element for this callout type, rendered by the (possibly
   * server) parent and shown for SSR / no-JS / while a custom icon loads. Passed
   * as children (a serializable node) rather than a component, so this client
   * component works when its parent renders as a Server Component.
   */
  children: ReactNode;
}) {
  const ref = useRef<HTMLSpanElement>(null);
  const [customIconName, setCustomIconName] = useState<IconName | null>(null);

  useEffect(() => {
    const element = ref.current;

    if (!element) {
      return;
    }

    const resolve = () => {
      const raw = getComputedStyle(element).getPropertyValue("--callout-icon");
      const name = parseLucideIconName(raw);
      // Only override when a snippet named a different icon than the built-in.
      setCustomIconName(name && `lucide-${name}` !== fallbackIconName ? name : null);
    };

    resolve();

    // Re-resolve when the author's snippet scope/<style> is toggled on or off
    // (the viewer "Custom styling" pill mutates the canvas), so a custom icon
    // reverts to the built-in along with the rest of the snippet styling.
    const scope = element.closest(
      "[data-vault-snippet-scope], .vault-document-canvas",
    );

    if (!scope) {
      return;
    }

    const observer = new MutationObserver(resolve);
    observer.observe(scope, {
      attributes: true,
      attributeFilter: ["data-vault-snippet-scope"],
      childList: true,
    });

    return () => observer.disconnect();
  }, [fallbackIconName]);

  return (
    <span
      ref={ref}
      className="callout-icon"
      data-callout-icon={customIconName ? `lucide-${customIconName}` : fallbackIconName}
      aria-hidden="true"
    >
      {customIconName ? (
        <DynamicIcon
          name={customIconName}
          className="size-5"
          fallback={() => <>{children}</>}
        />
      ) : (
        children
      )}
    </span>
  );
}
