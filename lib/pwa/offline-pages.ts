/**
 * Asks the service worker (`public/sw.js`) to drop its offline copies of
 * visited pages. Called on sign-out so the next person using this browser
 * cannot reach the previous user's pages offline. A no-op without a worker.
 */
export function clearOfflinePages() {
  if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) {
    return;
  }

  navigator.serviceWorker.controller?.postMessage("CLEAR_PAGES");
}
