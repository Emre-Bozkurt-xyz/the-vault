"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { RotateCw, Trash2 } from "lucide-react";

import { useDocumentExtensionState } from "@/components/extensions/use-document-extension-state";
import { DocumentOverlayItem } from "@/components/extensions/DocumentOverlayHost";
import {
  stickersStateSchema,
  type StickerItem,
  type StickersState,
} from "@/lib/extensions/catalog";
import type { PickerAsset } from "@/server/asset-picker-actions";
import type { PublicStickerItem } from "@/server/sticker-state";
import { cn } from "@/lib/utils";

const MARGIN = 200;
const MIN_SIZE = 40;
const MAX_SIZE = 500;
const ROTATION_SNAP_DEG = 90;
const ROTATION_SNAP_THRESHOLD = 12;

function snapRotation(deg: number): number {
  const normalized = ((deg % 360) + 360) % 360;
  const nearest = Math.round(normalized / ROTATION_SNAP_DEG) * ROTATION_SNAP_DEG;
  const dist = Math.min(
    Math.abs(normalized - nearest),
    360 - Math.abs(normalized - nearest),
  );
  return dist <= ROTATION_SNAP_THRESHOLD ? nearest % 360 : normalized;
}

type StickerLayerProps = {
  documentId: string;
  canEdit: boolean;
  pendingAsset: PickerAsset | null;
  onPendingAssetPlaced: () => void;
};

type LiveStickerItem = StickerItem & { id: string };

export function StickerLayer({
  documentId,
  canEdit,
  pendingAsset,
  onPendingAssetPlaced,
}: StickerLayerProps) {
  const { state, setState, status } = useDocumentExtensionState({
    documentId,
    extensionId: "vault.stickers",
    stateKey: "layout",
    version: 1,
    visibility: "public",
    disabled: !canEdit,
  });

  const [selectedId, setSelectedId] = useState<string | null>(null);

  const stickersState: StickersState = (() => {
    if (!state) return { items: {} };
    const result = stickersStateSchema.safeParse(state);
    return result.success ? result.data : { items: {} };
  })();

  const stickers: LiveStickerItem[] = Object.entries(stickersState.items).map(
    ([id, item]) => ({ id, ...item }),
  );

  useEffect(() => {
    if (!pendingAsset || !canEdit || status === "loading") return;

    const id = `s_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;
    const offset = stickers.length * 18;
    const newItem: StickerItem = {
      assetId: pendingAsset.id,
      left: 60 + (offset % 120),
      top: 220 + (offset % 80),
      width: 120,
      rotation: 0,
    };

    setState({
      ...stickersState,
      items: { ...stickersState.items, [id]: newItem },
    });
    setSelectedId(id);
    onPendingAssetPlaced();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pendingAsset]);

  function updateSticker(id: string, patch: Partial<StickerItem>) {
    setState({
      ...stickersState,
      items: {
        ...stickersState.items,
        [id]: { ...stickersState.items[id]!, ...patch },
      },
    });
  }

  function removeSticker(id: string) {
    const { [id]: _removed, ...rest } = stickersState.items;
    setState({ ...stickersState, items: rest });
    setSelectedId(null);
  }

  useEffect(() => {
    if (!selectedId) return;
    function handlePointerDown(e: PointerEvent) {
      const target = e.target as Element;
      if (!target.closest("[data-sticker-id]")) setSelectedId(null);
    }
    document.addEventListener("pointerdown", handlePointerDown, true);
    return () =>
      document.removeEventListener("pointerdown", handlePointerDown, true);
  }, [selectedId]);

  if (!canEdit || stickers.length === 0) return null;

  return (
    <>
      {stickers.map((sticker) => (
        <EditableStickerItem
          key={sticker.id}
          sticker={sticker}
          selected={selectedId === sticker.id}
          onSelect={() => setSelectedId(sticker.id)}
          onMove={(left, top) => updateSticker(sticker.id, { left, top })}
          onResize={(left, top, width) =>
            updateSticker(sticker.id, { left, top, width })
          }
          onRotate={(rotation) => updateSticker(sticker.id, { rotation })}
          onRemove={() => removeSticker(sticker.id)}
        />
      ))}
    </>
  );
}

// ─── Read-only layer for public doc page ─────────────────────────────────────

export function ReadOnlyStickerLayer({ items }: { items: PublicStickerItem[] }) {
  if (items.length === 0) return null;
  return (
    <>
      {items.map((item) => (
        <DocumentOverlayItem
          key={item.id}
          style={{ left: item.left, top: item.top, width: item.width }}
        >
          <div
            style={{
              transform: `rotate(${item.rotation ?? 0}deg)`,
              transformOrigin: "center center",
              pointerEvents: "none",
            }}
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={`/api/assets/${item.assetId}/content`}
              alt=""
              draggable={false}
              style={{ width: item.width, height: item.width }}
              className="block rounded-sm object-cover"
              loading="lazy"
            />
          </div>
        </DocumentOverlayItem>
      ))}
    </>
  );
}

// ─── Editable sticker item ────────────────────────────────────────────────────

type EditableStickerItemProps = {
  sticker: LiveStickerItem;
  selected: boolean;
  onSelect: () => void;
  onMove: (left: number, top: number) => void;
  onResize: (left: number, top: number, width: number) => void;
  onRotate: (rotation: number) => void;
  onRemove: () => void;
};

function EditableStickerItem({
  sticker,
  selected,
  onSelect,
  onMove,
  onResize,
  onRotate,
  onRemove,
}: EditableStickerItemProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);

  const moveDragRef = useRef<{
    // Offset from sticker's left/top to where the user grabbed it, in layer px.
    // Stored once at pointerdown so applyMovePosition can compute new position
    // purely from the pointer's current clientX/Y + the layer's live rect.
    anchorX: number;
    anchorY: number;
    origLeft: number;
    origTop: number;
    origWidth: number;
    moved: boolean;
    lastClientX: number;
    lastClientY: number;
  } | null>(null);

  const resizeDragRef = useRef<{
    centerX: number;
    centerY: number;
    rad: number;
  } | null>(null);

  const rotateDragRef = useRef<{
    centerX: number;
    centerY: number;
    startAngle: number;
    startRotation: number;
  } | null>(null);

  // Always-current ref so the scroll listener never closes over a stale onMove
  const onMoveRef = useRef(onMove);
  onMoveRef.current = onMove;

  const scrollCleanupRef = useRef<(() => void) | null>(null);

  // Clean up scroll listener if the component unmounts mid-drag
  useEffect(() => () => { scrollCleanupRef.current?.(); }, []);

  function getLayer() {
    return (
      containerRef.current?.closest<HTMLElement>(
        ".vault-document-overlay-layer",
      ) ?? null
    );
  }

  function toLayerCoords(clientX: number, clientY: number) {
    const rect = getLayer()?.getBoundingClientRect();
    if (!rect) return { x: clientX, y: clientY };
    return { x: clientX - rect.left, y: clientY - rect.top };
  }

  // Recompute sticker position from the pointer's current clientX/Y.
  // getBoundingClientRect() is always current, so this is correct regardless
  // of which element is the scroll container or how far the page has scrolled.
  function applyMovePosition(clientX: number, clientY: number) {
    const drag = moveDragRef.current;
    if (!drag) return;
    const layer = getLayer();
    const layerRect = layer?.getBoundingClientRect();
    if (!layerRect) return;
    const newLeft = clientX - layerRect.left - drag.anchorX;
    const newTop = clientY - layerRect.top - drag.anchorY;
    // Use origLeft/Top for moved-threshold so scrolling counts as movement
    const dx = newLeft - drag.origLeft;
    const dy = newTop - drag.origTop;
    if (!drag.moved && (Math.abs(dx) > 3 || Math.abs(dy) > 3)) drag.moved = true;
    if (!drag.moved) return;
    const layerW = layer?.offsetWidth ?? 800;
    const layerH = layer?.offsetHeight ?? 4000;
    const w = drag.origWidth;
    onMoveRef.current(
      Math.min(Math.max(newLeft, -MARGIN), layerW - w + MARGIN),
      Math.min(Math.max(newTop, 0), layerH - w + MARGIN),
    );
  }

  // ── Move ──────────────────────────────────────────────────────────────────

  const handleMoveDown = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      if (e.button !== 0) return;
      e.currentTarget.setPointerCapture(e.pointerId);
      const layer = containerRef.current?.closest<HTMLElement>(
        ".vault-document-overlay-layer",
      );
      const layerRect = layer?.getBoundingClientRect();
      moveDragRef.current = {
        anchorX: layerRect ? e.clientX - layerRect.left - sticker.left : 0,
        anchorY: layerRect ? e.clientY - layerRect.top - sticker.top : 0,
        origLeft: sticker.left,
        origTop: sticker.top,
        origWidth: sticker.width,
        moved: false,
        lastClientX: e.clientX,
        lastClientY: e.clientY,
      };
      // scroll events don't bubble, so capture at document level to catch
      // any inner scroll container (not just window scroll).
      const onScroll = () => {
        const drag = moveDragRef.current;
        if (drag) applyMovePosition(drag.lastClientX, drag.lastClientY);
      };
      document.addEventListener("scroll", onScroll, {
        passive: true,
        capture: true,
      });
      scrollCleanupRef.current = () =>
        document.removeEventListener("scroll", onScroll, { capture: true });
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [sticker.left, sticker.top, sticker.width],
  );

  const handleMoveMove = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      const drag = moveDragRef.current;
      if (!drag) return;
      drag.lastClientX = e.clientX;
      drag.lastClientY = e.clientY;
      applyMovePosition(e.clientX, e.clientY);
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

  const handleMoveUp = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      e.currentTarget.releasePointerCapture(e.pointerId);
      scrollCleanupRef.current?.();
      scrollCleanupRef.current = null;
      if (!moveDragRef.current?.moved) onSelect();
      moveDragRef.current = null;
    },
    [onSelect],
  );

  // ── Resize (shared across all 4 corners) ─────────────────────────────────

  const handleCornerDown = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      e.stopPropagation();
      e.currentTarget.setPointerCapture(e.pointerId);
      if (!selected) onSelect();
      const rad = ((sticker.rotation ?? 0) * Math.PI) / 180;
      resizeDragRef.current = {
        centerX: sticker.left + sticker.width / 2,
        centerY: sticker.top + sticker.width / 2,
        rad,
      };
    },
    [selected, onSelect, sticker.left, sticker.top, sticker.width, sticker.rotation],
  );

  const handleCornerMove = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      const drag = resizeDragRef.current;
      if (!drag) return;
      const { x, y } = toLayerCoords(e.clientX, e.clientY);
      const dx = x - drag.centerX;
      const dy = y - drag.centerY;
      // Un-rotate pointer delta into sticker local space
      const localX = dx * Math.cos(drag.rad) + dy * Math.sin(drag.rad);
      const localY = -dx * Math.sin(drag.rad) + dy * Math.cos(drag.rad);
      const halfSize = Math.min(
        MAX_SIZE / 2,
        Math.max(MIN_SIZE / 2, Math.max(Math.abs(localX), Math.abs(localY))),
      );
      const newWidth = halfSize * 2;
      onResize(drag.centerX - halfSize, drag.centerY - halfSize, newWidth);
    },
    [onResize],
  );

  const handleCornerUp = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      e.currentTarget.releasePointerCapture(e.pointerId);
      resizeDragRef.current = null;
    },
    [],
  );

  // ── Rotate ────────────────────────────────────────────────────────────────

  const handleRotateDown = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      e.stopPropagation();
      e.currentTarget.setPointerCapture(e.pointerId);
      if (!selected) onSelect();
      const { x, y } = toLayerCoords(e.clientX, e.clientY);
      const centerX = sticker.left + sticker.width / 2;
      const centerY = sticker.top + sticker.width / 2;
      rotateDragRef.current = {
        centerX,
        centerY,
        startAngle: Math.atan2(y - centerY, x - centerX),
        startRotation: sticker.rotation ?? 0,
      };
    },
    [selected, onSelect, sticker.left, sticker.top, sticker.width, sticker.rotation],
  );

  const handleRotateMove = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      const drag = rotateDragRef.current;
      if (!drag) return;
      const { x, y } = toLayerCoords(e.clientX, e.clientY);
      const currentAngle = Math.atan2(y - drag.centerY, x - drag.centerX);
      const deltaDeg = (currentAngle - drag.startAngle) * (180 / Math.PI);
      onRotate(snapRotation(drag.startRotation + deltaDeg));
    },
    [onRotate],
  );

  const handleRotateUp = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      e.currentTarget.releasePointerCapture(e.pointerId);
      rotateDragRef.current = null;
    },
    [],
  );

  const rotation = sticker.rotation ?? 0;

  return (
    <DocumentOverlayItem
      style={{ left: sticker.left, top: sticker.top, width: sticker.width }}
    >
      <div
        ref={containerRef}
        data-sticker-id={sticker.id}
        style={{
          transform: `rotate(${rotation}deg)`,
          transformOrigin: "center center",
          touchAction: "none",
        }}
        onPointerDown={handleMoveDown}
        onPointerMove={handleMoveMove}
        onPointerUp={handleMoveUp}
        className="relative cursor-grab select-none active:cursor-grabbing"
      >
        {/* Selection ring */}
        {selected && (
          <div className="pointer-events-none absolute inset-0 z-10 rounded-sm ring-2 ring-primary/60 ring-offset-1" />
        )}

        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={`/api/assets/${sticker.assetId}/content`}
          alt=""
          draggable={false}
          style={{ width: sticker.width, height: sticker.width }}
          className="block rounded-sm object-cover"
        />

        {selected && (
          <>
            {/* Delete — sits above the sticker, clear of the NE corner handle.
                stopPropagation on pointerdown prevents the container from
                capturing the pointer, which would otherwise steal the click. */}
            <button
              type="button"
              onPointerDown={(e) => e.stopPropagation()}
              onClick={(e) => {
                e.stopPropagation();
                onRemove();
              }}
              className="absolute -right-2 -top-9 z-20 grid size-6 place-items-center rounded-full border border-border/60 bg-card text-muted-foreground shadow-sm transition hover:bg-destructive hover:text-destructive-foreground"
              aria-label="Remove sticker"
            >
              <Trash2 className="size-3" />
            </button>

            {/* Rotation handle */}
            <div
              className="absolute left-1/2 z-20 flex -translate-x-1/2 flex-col items-center"
              style={{ top: "-36px" }}
            >
              <div
                onPointerDown={handleRotateDown}
                onPointerMove={handleRotateMove}
                onPointerUp={handleRotateUp}
                className="grid size-5 cursor-grab place-items-center rounded-full border border-border/60 bg-card text-muted-foreground shadow-sm transition hover:text-foreground active:cursor-grabbing"
                title="Rotate"
              >
                <RotateCw className="size-2.5" />
              </div>
              <div className="h-2.5 w-px bg-border/60" />
            </div>

            {/* Corner resize handles */}
            {(["nw", "ne", "sw", "se"] as const).map((corner) => (
              <div
                key={corner}
                onPointerDown={handleCornerDown}
                onPointerMove={handleCornerMove}
                onPointerUp={handleCornerUp}
                className={cn(
                  "absolute z-20 size-3 rounded-sm border-2 border-primary bg-card shadow-sm",
                  corner === "nw" && "-left-1.5 -top-1.5 cursor-nw-resize",
                  corner === "ne" && "-right-1.5 -top-1.5 cursor-ne-resize",
                  corner === "sw" && "-left-1.5 -bottom-1.5 cursor-sw-resize",
                  corner === "se" && "-right-1.5 -bottom-1.5 cursor-se-resize",
                )}
              />
            ))}
          </>
        )}
      </div>
    </DocumentOverlayItem>
  );
}
