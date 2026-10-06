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

import { clientExtensions } from "@/extensions/registry.client";
import type { EditorModule } from "@/lib/extension-api";
import { selectEditorModulesToLoad } from "@/lib/extension-host/loading";

type LoadedModules = Record<string, { editor?: EditorModule }>;

type ExtensionHostValue = {
  /** Extensions the signed-in user enabled. */
  enabledIds: readonly string[];
  /** Their settings (schema defaults for disabled ones). */
  settings: Readonly<Record<string, Record<string, unknown>>>;
  /** Editor modules loaded so far this session, by extension id. */
  modules: LoadedModules;
};

const ExtensionHostContext = createContext<ExtensionHostValue | null>(null);

/**
 * The workspace's extension host (`docs/23_EXTENSION_SDK_PLAN.md` §9).
 * Mounted once in the workspace layout, which persists across document
 * navigation: enabled extensions' editor modules start loading when the
 * workspace opens and stay resident for the session, as Obsidian loads plugins
 * at app start. (Render code needs no loading here: render modules are light
 * and always present, and their components load per block.)
 *
 * Settings changes re-render the layout with new props, so enabling an
 * extension loads its editor module without a reload (§16 decision 2).
 */
export function ExtensionHostProvider({
  enabledIds,
  settings,
  children,
}: {
  enabledIds: readonly string[];
  settings: Readonly<Record<string, Record<string, unknown>>>;
  children: ReactNode;
}) {
  const [modules, setModules] = useState<LoadedModules>({});
  const requestedRef = useRef(new Set<string>());
  const enabledKey = enabledIds.join("|");

  useEffect(() => {
    const requests = selectEditorModulesToLoad(
      clientExtensions,
      enabledKey ? enabledKey.split("|") : [],
      requestedRef.current,
    );

    for (const request of requests) {
      requestedRef.current.add(request.extensionId);
      request
        .load()
        .then((loaded) => {
          setModules((current) => ({
            ...current,
            [request.extensionId]: { editor: loaded.default },
          }));
        })
        .catch((cause: unknown) => {
          // Allow a retry next time; a failed chunk must not take the
          // workspace down (§18.5).
          requestedRef.current.delete(request.extensionId);
          console.error(
            `Editor module for "${request.extensionId}" failed to load`,
            cause,
          );
        });
    }
  }, [enabledKey]);

  const value = useMemo<ExtensionHostValue>(
    () => ({ enabledIds, settings, modules }),
    [enabledIds, settings, modules],
  );

  return (
    <ExtensionHostContext.Provider value={value}>
      {children}
    </ExtensionHostContext.Provider>
  );
}

/** The workspace extension host; null outside the workspace (public pages, embeds). */
export function useExtensionHost(): ExtensionHostValue | null {
  return useContext(ExtensionHostContext);
}
