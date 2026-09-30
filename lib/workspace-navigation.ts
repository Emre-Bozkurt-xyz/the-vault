// Client-side navigation for UI that renders outside Next's router context —
// chiefly React roots mounted inside CodeMirror widgets (Live-mode blocks),
// where `useRouter` and `<Link>` are unavailable. The workspace chrome listens
// and calls `router.push`; with nobody listening (a page outside the
// workspace) it falls back to a normal page load.

const eventName = "vault:navigate";

type NavigateDetail = { href: string; handled: boolean };

export function navigateWorkspace(href: string) {
  if (typeof window === "undefined") return;

  const detail: NavigateDetail = { href, handled: false };
  window.dispatchEvent(new CustomEvent<NavigateDetail>(eventName, { detail }));

  if (!detail.handled) {
    window.location.assign(href);
  }
}

export function subscribeToWorkspaceNavigation(handler: (href: string) => void) {
  if (typeof window === "undefined") return () => {};

  const listener = (event: Event) => {
    const detail = (event as CustomEvent<NavigateDetail>).detail;
    detail.handled = true;
    handler(detail.href);
  };

  window.addEventListener(eventName, listener);
  return () => window.removeEventListener(eventName, listener);
}
