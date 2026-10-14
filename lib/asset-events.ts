// Tells open asset views (the library page, the assets side panel) that the
// user's assets changed somewhere else, e.g. an upload finished in the panel.

const assetsChangedEventName = "vault:assets-changed";

export function dispatchAssetsChanged() {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new Event(assetsChangedEventName));
}

export function subscribeToAssetsChanged(listener: () => void) {
  if (typeof window === "undefined") return () => undefined;
  window.addEventListener(assetsChangedEventName, listener);
  return () => window.removeEventListener(assetsChangedEventName, listener);
}
