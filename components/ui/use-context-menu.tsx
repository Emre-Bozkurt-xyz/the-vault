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
  /** Spread on `<DropdownMenu>`: makes the menu's open state controllable. */
  rootProps: {
    open: boolean;
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
 * The menu is non-modal so a right-click on another row while one is open
 * lands on that row (a modal menu's backdrop would swallow it) — the outside
 * press closes this menu and the row's own handler opens its menu.
 */
export function useContextMenu(): ContextMenuController {
  const [open, setOpen] = useState(false);
  const [anchor, setAnchor] = useState<MenuAnchor>(undefined);
  const openRef = useRef(false);

  const setOpenState = useCallback((next: boolean) => {
    openRef.current = next;
    setOpen(next);
  }, []);

  const onContextMenu = useCallback(
    (event: MouseEvent<HTMLElement>) => {
      if (event.shiftKey || isEditableTarget(event.target)) {
        return;
      }

      event.preventDefault();
      // Nested rows (a doc inside a folder) only open the innermost menu.
      event.stopPropagation();

      const { clientX: x, clientY: y } = event;
      const row = event.currentTarget;
      setAnchor(
        x === 0 && y === 0
          ? row
          : {
              getBoundingClientRect: () =>
                DOMRect.fromRect({ x, y, width: 0, height: 0 }),
            },
      );
      setOpenState(true);
    },
    [setOpenState],
  );

  return useMemo<ContextMenuController>(
    () => ({
      rootProps: {
        open,
        onOpenChange: setOpenState,
        // Drop the cursor anchor only once the close animation has finished,
        // so the popup doesn't jump to the "⋯" button on its way out — and
        // not if a new right-click reopened it in the meantime.
        onOpenChangeComplete: (nextOpen: boolean) => {
          if (!nextOpen && !openRef.current) {
            setAnchor(undefined);
          }
        },
        modal: false,
      },
      contentProps: anchor ? { anchor, align: "start", sideOffset: 2 } : {},
      onContextMenu,
    }),
    [anchor, onContextMenu, open, setOpenState],
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
