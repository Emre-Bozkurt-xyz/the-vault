"use client";

import {
  useCallback,
  useMemo,
  useRef,
  useState,
  type MouseEvent,
  type ReactNode,
} from "react";
import type { Menu as MenuPrimitive } from "@base-ui/react/menu";

type MenuAnchor = MenuPrimitive.Positioner.Props["anchor"];

export type ContextMenuController = {
  /** Pass as `ref` to the menu's `<DropdownMenuTrigger>` (the "⋯" button). */
  triggerRef: (node: HTMLButtonElement | null) => void;
  /** Spread on `<DropdownMenu>`. */
  rootProps: {
    onOpenChange: (open: boolean) => void;
    onOpenChangeComplete: (open: boolean) => void;
    modal: false;
  };
  /**
   * Spread on `<DropdownMenuContent>` AFTER its own `align`: while the menu was
   * opened by a right-click it anchors at the cursor instead of the "⋯" button.
   */
  contentProps: { anchor?: MenuAnchor; align?: "start"; sideOffset?: number };
  /** Attach to the row/card whose right-click should open the menu. */
  onContextMenu: (event: MouseEvent<HTMLElement>) => void;
};

/**
 * Lets a row's right-click open the same "⋯" dropdown its button opens, at the
 * cursor, in place of the browser's context menu. Shift+right-click still gets
 * the native menu (e.g. "Open link in new tab"), and right-clicks inside text
 * fields are left alone. Keyboard context-menu presses (no pointer position)
 * anchor the menu to the row instead.
 *
 * The right-click opens the menu by clicking its "⋯" trigger rather than by
 * driving a controlled `open` prop. Base UI only treats a menu as click-opened
 * when its open event was a click; opened any other way, it assumes hover and
 * closes the popup as soon as the pointer leaves it.
 *
 * The menu is non-modal so a right-click on another row while one is open
 * lands on that row (a modal menu's backdrop would swallow it) — the outside
 * press closes this menu and the row's own handler opens its menu.
 */
export function useContextMenu(): ContextMenuController {
  const [anchor, setAnchor] = useState<MenuAnchor>(undefined);
  const triggerElementRef = useRef<HTMLButtonElement | null>(null);
  const openRef = useRef(false);

  // A callback ref, not the ref object, so the returned controller holds no
  // ref values and components can read it freely during render.
  const triggerRef = useCallback((node: HTMLButtonElement | null) => {
    triggerElementRef.current = node;
  }, []);

  const onOpenChange = useCallback((open: boolean) => {
    openRef.current = open;
  }, []);

  // Drop the cursor anchor only once the close animation has finished, so the
  // popup doesn't jump to the "⋯" button on its way out — and not if a new
  // right-click reopened it in the meantime.
  const onOpenChangeComplete = useCallback((open: boolean) => {
    if (!open && !openRef.current) {
      setAnchor(undefined);
    }
  }, []);

  const onContextMenu = useCallback((event: MouseEvent<HTMLElement>) => {
    const trigger = triggerElementRef.current;
    if (!trigger || event.shiftKey || isEditableTarget(event.target)) {
      return;
    }

    event.preventDefault();
    // Nested rows (a doc inside a folder) only open the innermost menu.
    event.stopPropagation();

    const row = event.currentTarget;
    // A right-click inside the open popup reaches the row through the React
    // portal; leave the menu where it is.
    if (!row.contains(event.target as Node)) {
      return;
    }

    const { clientX: x, clientY: y } = event;
    setAnchor(
      x === 0 && y === 0
        ? row
        : {
            getBoundingClientRect: () =>
              DOMRect.fromRect({ x, y, width: 0, height: 0 }),
          },
    );

    // Already open (keyboard menu key, or a right-click inside the popup):
    // the new anchor just moves it, where a click would toggle it shut.
    if (!openRef.current) {
      trigger.click();
    }
  }, []);

  return useMemo<ContextMenuController>(
    () => ({
      triggerRef,
      rootProps: { onOpenChange, onOpenChangeComplete, modal: false },
      contentProps: anchor ? { anchor, align: "start", sideOffset: 2 } : {},
      onContextMenu,
    }),
    [anchor, onContextMenu, onOpenChange, onOpenChangeComplete, triggerRef],
  );
}

/**
 * Render-prop form of {@link useContextMenu} for rows rendered inside a
 * `.map()`, where a hook can't be called per item.
 */
export function WithContextMenu({
  children,
}: {
  children: (menu: ContextMenuController) => ReactNode;
}) {
  return children(useContextMenu());
}

function isEditableTarget(target: EventTarget) {
  return (
    target instanceof HTMLElement &&
    (target.isContentEditable ||
      target.closest("input, textarea, select, [contenteditable='true']") !==
        null)
  );
}
