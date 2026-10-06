import type { JsonValue } from "@/lib/extension-api";

/**
 * Session events (`docs/23_EXTENSION_SDK_PLAN.md` §6, §7): how an extension's
 * command reaches its own components on the same document, e.g. the stickers
 * "Add sticker" command handing the picked asset to the sticker overlay.
 *
 * In-memory and browser-only. Scoped by document and extension, so an event
 * never reaches another extension or another open document.
 */
export type SessionEventScope = {
  extensionId: string;
  documentId: string | null;
};

type Listener = (payload: JsonValue | undefined) => void;

const listeners = new Map<string, Set<Listener>>();

function channel(scope: SessionEventScope, name: string): string {
  return `${scope.documentId ?? ""}\u0000${scope.extensionId}\u0000${name}`;
}

export function emitSessionEvent(
  scope: SessionEventScope,
  name: string,
  payload?: JsonValue,
): void {
  for (const listener of [...(listeners.get(channel(scope, name)) ?? [])]) {
    try {
      listener(payload);
    } catch (cause) {
      console.error(`Session event "${name}" for "${scope.extensionId}" failed`, cause);
    }
  }
}

export function subscribeSessionEvent(
  scope: SessionEventScope,
  name: string,
  listener: Listener,
): () => void {
  const key = channel(scope, name);
  let set = listeners.get(key);
  if (!set) {
    set = new Set();
    listeners.set(key, set);
  }
  set.add(listener);

  return () => {
    set.delete(listener);
    if (set.size === 0) listeners.delete(key);
  };
}
