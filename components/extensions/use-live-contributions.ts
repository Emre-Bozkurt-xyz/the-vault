"use client";

import type { Extension } from "@codemirror/state";
import { useEffect, useMemo, useState } from "react";

import { renderModules } from "@/extensions/registry.render";
import type { ExtensionRenderContext } from "@/lib/extension-api";

export type LoadedLiveContribution = {
  extensionId: string;
  create: (ctx: ExtensionRenderContext) => Extension;
};

// Shared across editors and documents: a module loads once per session, like
// the host's editor modules.
const loaded = new Map<string, Promise<LoadedLiveContribution["create"]>>();

function loadLive(extensionId: string) {
  let pending = loaded.get(extensionId);
  const contribution = renderModules.find(
    (renderModule) => renderModule.manifestId === extensionId,
  )?.live;

  if (!pending && contribution) {
    pending = contribution.load().then((module) => module.default);
    // A failed chunk must be retryable, and must not take the editor down.
    pending.catch(() => loaded.delete(extensionId));
    loaded.set(extensionId, pending);
  }

  return pending ?? null;
}

/**
 * The `live` contributions (`docs/23_EXTENSION_SDK_PLAN.md` §6) of `ids`,
 * loaded lazily and returned in `ids` order once each arrives. The editor
 * passes the document's render set plus the author's enabled extensions:
 * rendering follows content, and an author who enabled an extension sees its
 * syntax drawn as they type it.
 */
export function useLiveContributions(
  ids: readonly string[],
): readonly LoadedLiveContribution[] {
  const [contributions, setContributions] = useState<
    Readonly<Partial<Record<string, LoadedLiveContribution["create"]>>>
  >({});
  const key = ids.join("|");

  useEffect(() => {
    let cancelled = false;

    for (const extensionId of key ? key.split("|") : []) {
      loadLive(extensionId)
        ?.then((create) => {
          if (cancelled) return;
          setContributions((current) =>
            current[extensionId] === create ? current : { ...current, [extensionId]: create },
          );
        })
        .catch((cause: unknown) => {
          console.error(`Live contribution for "${extensionId}" failed to load`, cause);
        });
    }

    return () => {
      cancelled = true;
    };
  }, [key]);

  // Stable between loads: the editor rebuilds its extensions when this changes.
  return useMemo(
    () =>
      (key ? key.split("|") : []).flatMap((extensionId) => {
        const create = contributions[extensionId];
        return create ? [{ extensionId, create }] : [];
      }),
    [key, contributions],
  );
}
