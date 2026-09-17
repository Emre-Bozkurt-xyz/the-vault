"use client";

import { createContext, useContext } from "react";

/**
 * Lets content inside a settings page move the modal to another page — the
 * Extensions list uses it to jump to an extension's own settings. A no-op
 * outside the modal.
 *
 * Kept apart from `settings-pages.ts` because that module is imported by the
 * server-side page builder, and `createContext` cannot run there.
 */
export const SettingsNavigationContext = createContext<(pageId: string) => void>(
  () => undefined,
);

export function useSettingsNavigation() {
  return useContext(SettingsNavigationContext);
}
