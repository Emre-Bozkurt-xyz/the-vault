/** How long to keep bringing the sticker into view while the page settles. */
const SETTLE_MS = 5000;

/**
 * Shows one sticker when something asks (`useRevealRequest`, e.g. the delete
 * warning's "used in … · Stickers" link): scrolls it to the middle of the
 * screen and pulses a ring around it.
 *
 * The request usually lands right after navigating, when the sticker layout
 * has loaded but the document text (which gives the page its height) may not
 * have, so the first scroll can have nowhere to go, or the editor may reset
 * the scroll as it loads. Hence it keeps checking for a few seconds and
 * re-scrolls until the sticker has stayed in view, then pulses once.
 */
export function revealSticker(stickerId: string) {
  const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const deadline = Date.now() + SETTLE_MS;
  let scrolled = false;
  let pulsed = false;
  let steady = 0;

  const step = () => {
    const element = document.querySelector<HTMLElement>(`[data-sticker-id="${CSS.escape(stickerId)}"]`);
    let wait = 250;
    if (element) {
      const rect = element.getBoundingClientRect();
      const inView = rect.top >= 0 && rect.bottom <= window.innerHeight;
      if (!inView) {
        // Smooth the first time; after that the page moved under us, so jump.
        const smooth = !scrolled && !reduceMotion;
        element.scrollIntoView({ block: "center", inline: "nearest", behavior: smooth ? "smooth" : "auto" });
        scrolled = true;
        steady = 0;
        if (smooth) wait = 700;
      } else {
        steady += 1;
        if (!pulsed) {
          pulsed = true;
          element.animate(
            [
              { boxShadow: "0 0 0 0 color-mix(in oklch, var(--primary) 85%, transparent)" },
              { boxShadow: "0 0 0 10px color-mix(in oklch, var(--primary) 0%, transparent)" },
            ],
            { duration: 700, iterations: reduceMotion ? 1 : 3, easing: "ease-out" },
          );
        }
      }
    }
    // Done once it has stayed in view for a moment, or out of time.
    if (steady < 3 && Date.now() < deadline) window.setTimeout(step, wait);
  };

  requestAnimationFrame(() => requestAnimationFrame(step));
}
