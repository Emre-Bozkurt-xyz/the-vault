"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useSyncExternalStore,
} from "react";

/**
 * Whether the side panel a component lives in is currently showing.
 *
 * A collapsed desktop panel stays mounted (its uploads and drafts belong to it
 * and must survive a collapse), so its data hooks consult this instead and
 * defer refreshes until it is shown again. Anything outside a panel is visible.
 */
const PanelVisibilityContext = createContext(true);

export const PanelVisibilityProvider = PanelVisibilityContext.Provider;

export function usePanelVisible() {
  return useContext(PanelVisibilityContext);
}

/**
 * Wraps a panel's `load` so it only runs while the panel is visible. A request
 * made while hidden marks the data dirty and runs once when the panel shows.
 * The returned function is stable for a given `load`.
 */
export function useVisibleRefresh(load: () => void) {
  const visible = usePanelVisible();
  const visibleRef = useRef(visible);
  const dirtyRef = useRef(false);
  const loadRef = useRef(load);

  useEffect(() => {
    loadRef.current = load;
  }, [load]);

  useEffect(() => {
    visibleRef.current = visible;

    if (visible && dirtyRef.current) {
      dirtyRef.current = false;
      loadRef.current();
    }
  }, [visible]);

  return useCallback(() => {
    if (visibleRef.current) {
      loadRef.current();
    } else {
      dirtyRef.current = true;
    }
  }, []);
}

function subscribeToMedia(query: string) {
  return (onChange: () => void) => {
    const media = window.matchMedia(query);
    media.addEventListener("change", onChange);
    return () => media.removeEventListener("change", onChange);
  };
}

/**
 * `matchMedia(query)`, reporting `serverValue` while server rendering and
 * hydrating so the first client render matches the server's markup.
 */
export function useMediaQuery(query: string, serverValue: boolean) {
  const subscribe = useCallback(
    (onChange: () => void) => subscribeToMedia(query)(onChange),
    [query],
  );

  return useSyncExternalStore(
    subscribe,
    () => window.matchMedia(query).matches,
    () => serverValue,
  );
}

const noopSubscribe = () => () => {};

/** False during server rendering and hydration, true afterwards. */
export function useHydrated() {
  return useSyncExternalStore(
    noopSubscribe,
    () => true,
    () => false,
  );
}
