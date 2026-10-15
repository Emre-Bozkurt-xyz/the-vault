"use client";

import { useSyncExternalStore } from "react";

import { useSavedConfirmMoveToBin } from "@/components/workspace/WorkspaceChrome";
import { setConfirmMoveToBinAction } from "@/server/user-settings-actions";

/**
 * "Ask before Move to Bin", shared by every Move to Bin entry point (the file
 * tree's menus and the document panel's Archive button) and the Files & assets
 * settings toggle. The server value arrives through WorkspaceChrome; a change
 * made in this tab is kept here as an override, so all of them agree at once
 * without waiting for a layout refresh. The settings modal sits outside
 * WorkspaceChrome, hence a module store rather than context state.
 */
let override: boolean | null = null;
const listeners = new Set<() => void>();

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Records a change made elsewhere (the settings toggle saves on its own). */
export function noteConfirmMoveToBinChanged(value: boolean) {
  override = value;
  listeners.forEach((listener) => listener());
}

/** Changes the preference here and persists it. */
export function setConfirmMoveToBin(value: boolean) {
  noteConfirmMoveToBinChanged(value);
  void setConfirmMoveToBinAction(value);
}

export function useConfirmMoveToBin(): boolean {
  const saved = useSavedConfirmMoveToBin();
  const current = useSyncExternalStore(
    subscribe,
    () => override,
    () => null,
  );
  return current ?? saved;
}
