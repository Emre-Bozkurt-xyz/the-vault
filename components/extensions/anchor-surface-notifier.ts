/**
 * Change notification shared by the overlay anchor surfaces: coalesced to one
 * call per animation frame (layout reports come in bursts), with a version
 * counter for `useSyncExternalStore`. `onActive` starts observing when the
 * first listener subscribes and returns how to stop after the last leaves.
 */
export function createAnchorNotifier(onActive?: (notify: () => void) => () => void) {
  const listeners = new Set<() => void>();
  let version = 0;
  let frame = 0;
  let stop: (() => void) | null = null;

  function notify() {
    if (frame) return;
    frame = requestAnimationFrame(() => {
      frame = 0;
      version += 1;
      for (const listener of listeners) listener();
    });
  }

  return {
    notify,
    version: () => version,
    subscribe(listener: () => void) {
      listeners.add(listener);
      if (listeners.size === 1 && onActive) stop = onActive(notify);
      return () => {
        listeners.delete(listener);
        if (listeners.size === 0) {
          stop?.();
          stop = null;
          if (frame) cancelAnimationFrame(frame);
          frame = 0;
        }
      };
    },
  };
}
