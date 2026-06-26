"use client";

import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";

import { isMacPlatform, matchesBinding } from "@/lib/shortcuts/binding";
import {
  resolveKeybindings,
  type ResolvedKeybindings,
} from "@/lib/shortcuts/resolve";

const keybindingsChangedEvent = "vault:keybindings-changed";

type KeybindingsChangedDetail = {
  bindings: ResolvedKeybindings;
  editorShortcutsEnabled: boolean;
};

type KeybindingsContextValue = {
  bindings: ResolvedKeybindings;
  editorShortcutsEnabled: boolean;
  isMac: boolean;
};

const KeybindingsContext = createContext<KeybindingsContextValue | null>(null);

/**
 * Notifies mounted consumers (editor, palette, toolbar) of a settings change so
 * rebindings apply without a reload. The settings section dispatches this after
 * persisting; the provider below updates its state in response.
 */
export function dispatchKeybindingsChanged(detail: KeybindingsChangedDetail) {
  if (typeof window === "undefined") {
    return;
  }
  window.dispatchEvent(
    new CustomEvent<KeybindingsChangedDetail>(keybindingsChangedEvent, {
      detail,
    }),
  );
}

export function KeybindingsProvider({
  bindings,
  editorShortcutsEnabled,
  children,
}: {
  bindings: ResolvedKeybindings;
  editorShortcutsEnabled: boolean;
  children: ReactNode;
}) {
  const [state, setState] = useState({ bindings, editorShortcutsEnabled });
  // Resolved post-mount to avoid an SSR/client hydration mismatch.
  const [isMac, setIsMac] = useState(false);

  useEffect(() => {
    setIsMac(isMacPlatform());
  }, []);

  // Re-sync when the server-provided props change (navigation / revalidation).
  useEffect(() => {
    setState({ bindings, editorShortcutsEnabled });
  }, [bindings, editorShortcutsEnabled]);

  useEffect(() => {
    function onChanged(event: Event) {
      if (!(event instanceof CustomEvent)) {
        return;
      }
      const detail = event.detail as KeybindingsChangedDetail | undefined;
      if (detail?.bindings) {
        setState({
          bindings: detail.bindings,
          editorShortcutsEnabled: detail.editorShortcutsEnabled,
        });
      }
    }

    window.addEventListener(keybindingsChangedEvent, onChanged);
    return () => window.removeEventListener(keybindingsChangedEvent, onChanged);
  }, []);

  const value = useMemo<KeybindingsContextValue>(
    () => ({
      bindings: state.bindings,
      editorShortcutsEnabled: state.editorShortcutsEnabled,
      isMac,
    }),
    [state, isMac],
  );

  return (
    <KeybindingsContext.Provider value={value}>
      {children}
    </KeybindingsContext.Provider>
  );
}

const fallbackValue: KeybindingsContextValue = {
  bindings: resolveKeybindings({}),
  editorShortcutsEnabled: true,
  isMac: false,
};

export function useKeybindings(): KeybindingsContextValue {
  return useContext(KeybindingsContext) ?? fallbackValue;
}

/**
 * Registers window-level handlers for global-scope shortcut ids. Skips events
 * already consumed (e.g. by the editor keymap), so an editor binding equal to a
 * global one doesn't double-fire.
 */
export function useGlobalShortcuts(handlers: Record<string, () => void>) {
  const { bindings, isMac } = useKeybindings();
  const handlersRef = useRef(handlers);

  useEffect(() => {
    handlersRef.current = handlers;
  });

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.defaultPrevented) {
        return;
      }

      for (const [id, handler] of Object.entries(handlersRef.current)) {
        const binding = bindings[id];
        if (binding && matchesBinding(event, binding, isMac)) {
          event.preventDefault();
          handler();
          return;
        }
      }
    }

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [bindings, isMac]);
}
