"use client";

import * as React from "react";
import { Dialog as DialogPrimitive } from "@base-ui/react/dialog";
import { XIcon } from "lucide-react";

import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { useCloseOnBack } from "@/components/ui/use-close-on-back";

/** Finger travel toward the sheet's edge that closes it. */
const SWIPE_CLOSE_PX = 70;

/**
 * Inside an open sheet or dialog: Back closes it (`useCloseOnBack`) by
 * pressing a hidden Close, so the dialog's own close path runs.
 */
function BackClose({ closeRef }: { closeRef: React.RefObject<HTMLButtonElement | null> }) {
  useCloseOnBack(() => closeRef.current?.click());
  return null;
}

/**
 * Swipe a sheet back toward the edge it came from to close it: it follows the
 * finger, then slides off past {@link SWIPE_CLOSE_PX} (or springs back). Only
 * a mostly horizontal swipe counts, so vertical scrolling inside is untouched.
 */
function useSwipeToClose(
  popup: HTMLDivElement | null,
  closeRef: React.RefObject<HTMLButtonElement | null>,
  side: "left" | "right",
) {
  // Keyed on the element: the popup only exists while the sheet is open.
  React.useEffect(() => {
    if (!popup) return;
    const direction = side === "right" ? 1 : -1;
    let start: { x: number; y: number } | null = null;
    let tracking = false;
    let offset = 0;

    const reset = () => {
      popup.style.transition = "transform 150ms ease-out";
      popup.style.transform = "";
      window.setTimeout(() => (popup.style.transition = ""), 160);
    };
    const onStart = (event: TouchEvent) => {
      if (event.touches.length !== 1) return;
      start = { x: event.touches[0].clientX, y: event.touches[0].clientY };
      tracking = false;
      offset = 0;
    };
    const onMove = (event: TouchEvent) => {
      if (!start) return;
      const dx = event.touches[0].clientX - start.x;
      const dy = event.touches[0].clientY - start.y;
      if (!tracking) {
        // Decide once: toward the edge and more sideways than up/down.
        if (Math.abs(dx) < 8 && Math.abs(dy) < 8) return;
        if (dx * direction <= 0 || Math.abs(dx) < Math.abs(dy) * 1.2) {
          start = null;
          return;
        }
        tracking = true;
        popup.style.transition = "none";
      }
      offset = Math.max(0, dx * direction);
      popup.style.transform = `translateX(${offset * direction}px)`;
    };
    const onEnd = () => {
      if (tracking && offset > SWIPE_CLOSE_PX) {
        popup.style.transition = "transform 150ms ease-out";
        popup.style.transform = `translateX(${direction * 100}%)`;
        window.setTimeout(() => {
          // Already off-screen: skip the closing slide animation.
          popup.style.animation = "none";
          closeRef.current?.click();
        }, 140);
      } else if (tracking) {
        reset();
      }
      start = null;
      tracking = false;
    };

    popup.addEventListener("touchstart", onStart, { passive: true });
    popup.addEventListener("touchmove", onMove, { passive: true });
    popup.addEventListener("touchend", onEnd);
    popup.addEventListener("touchcancel", onEnd);
    return () => {
      popup.removeEventListener("touchstart", onStart);
      popup.removeEventListener("touchmove", onMove);
      popup.removeEventListener("touchend", onEnd);
      popup.removeEventListener("touchcancel", onEnd);
    };
  }, [popup, closeRef, side]);
}

function Sheet({ ...props }: DialogPrimitive.Root.Props) {
  return <DialogPrimitive.Root data-slot="sheet" {...props} />;
}

function SheetTrigger({ ...props }: DialogPrimitive.Trigger.Props) {
  return <DialogPrimitive.Trigger data-slot="sheet-trigger" {...props} />;
}

function SheetClose({ ...props }: DialogPrimitive.Close.Props) {
  return <DialogPrimitive.Close data-slot="sheet-close" {...props} />;
}

function SheetOverlay({ className, ...props }: DialogPrimitive.Backdrop.Props) {
  return (
    <DialogPrimitive.Backdrop
      data-slot="sheet-overlay"
      className={cn(
        "fixed inset-0 z-50 bg-black/20 duration-150 supports-backdrop-filter:backdrop-blur-xs data-open:animate-in data-open:fade-in-0 data-closed:animate-out data-closed:fade-out-0",
        className,
      )}
      {...props}
    />
  );
}

function SheetContent({
  className,
  children,
  side = "right",
  showCloseButton = true,
  ...props
}: DialogPrimitive.Popup.Props & {
  side?: "left" | "right";
  showCloseButton?: boolean;
}) {
  const [popup, setPopup] = React.useState<HTMLDivElement | null>(null);
  const backCloseRef = React.useRef<HTMLButtonElement>(null);
  useSwipeToClose(popup, backCloseRef, side);

  return (
    <DialogPrimitive.Portal>
      <SheetOverlay />
      <DialogPrimitive.Popup
        ref={setPopup}
        data-slot="sheet-content"
        className={cn(
          "fixed inset-y-0 z-50 flex h-full w-full max-w-md flex-col gap-4 overflow-y-auto bg-popover p-5 text-sm text-popover-foreground shadow-xl outline-none duration-150 data-open:animate-in data-closed:animate-out",
          side === "right"
            ? "right-0 border-l border-border/70 data-open:slide-in-from-right data-closed:slide-out-to-right"
            : "left-0 border-r border-border/70 data-open:slide-in-from-left data-closed:slide-out-to-left",
          className,
        )}
        {...props}
      >
        {children}
        <DialogPrimitive.Close ref={backCloseRef} tabIndex={-1} aria-hidden className="hidden" />
        <BackClose closeRef={backCloseRef} />
        {showCloseButton && (
          <DialogPrimitive.Close
            data-slot="sheet-close"
            render={
              <Button
                variant="ghost"
                size="icon-sm"
                className="absolute top-3 right-3"
              />
            }
          >
            <XIcon />
            <span className="sr-only">Close</span>
          </DialogPrimitive.Close>
        )}
      </DialogPrimitive.Popup>
    </DialogPrimitive.Portal>
  );
}

function SheetHeader({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="sheet-header"
      className={cn("flex flex-col gap-1 border-b border-border/60 pb-4", className)}
      {...props}
    />
  );
}

function SheetTitle({ className, ...props }: DialogPrimitive.Title.Props) {
  return (
    <DialogPrimitive.Title
      data-slot="sheet-title"
      className={cn("font-heading text-lg leading-tight font-semibold", className)}
      {...props}
    />
  );
}

function SheetDescription({
  className,
  ...props
}: DialogPrimitive.Description.Props) {
  return (
    <DialogPrimitive.Description
      data-slot="sheet-description"
      className={cn("text-sm text-muted-foreground", className)}
      {...props}
    />
  );
}

export {
  Sheet,
  SheetClose,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetOverlay,
  SheetTitle,
  SheetTrigger,
};
