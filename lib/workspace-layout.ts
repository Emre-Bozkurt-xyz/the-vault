import type {
  WorkspaceLayoutState,
  WorkspacePanelMode,
  WorkspaceTab,
} from "@/components/workspace/workspace-types";

/**
 * Workspace chrome state (panel sizes/mode and open tabs) is persisted in
 * cookies rather than localStorage so the server can read it and render the
 * saved layout on the first paint — no flash of default state on load. These
 * helpers parse the cookies (server-safe) and write them (client-only).
 */

export const workspaceLayoutCookie = "vault.workspace.layout.v1";
export const workspaceTabsCookie = "vault.workspace.tabs.v1";

export const maxWorkspaceTabs = 12;

export const leftPanelWidthBounds = { min: 220, max: 440, default: 288 } as const;
export const rightPanelWidthBounds = { min: 260, max: 520, default: 320 } as const;

const cookieMaxAgeSeconds = 60 * 60 * 24 * 365;
const panelModes: WorkspacePanelMode[] = [
  "files",
  "search",
  "gallery",
  "assets",
  "docs",
  "admin",
];

export function clampWidth(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function safeDecode(raw: string) {
  try {
    return decodeURIComponent(raw);
  } catch {
    return raw;
  }
}

export function parseWorkspaceLayout(
  raw: string | undefined,
): Partial<WorkspaceLayoutState> {
  if (!raw) {
    return {};
  }

  try {
    const data = JSON.parse(safeDecode(raw)) as Record<string, unknown>;
    const result: Partial<WorkspaceLayoutState> = {};

    if (
      typeof data.panelMode === "string" &&
      panelModes.includes(data.panelMode as WorkspacePanelMode)
    ) {
      result.panelMode = data.panelMode as WorkspacePanelMode;
    }
    if (typeof data.leftCollapsed === "boolean") {
      result.leftCollapsed = data.leftCollapsed;
    }
    if (typeof data.rightCollapsed === "boolean") {
      result.rightCollapsed = data.rightCollapsed;
    }
    if (typeof data.leftWidth === "number" && Number.isFinite(data.leftWidth)) {
      result.leftWidth = clampWidth(
        data.leftWidth,
        leftPanelWidthBounds.min,
        leftPanelWidthBounds.max,
      );
    }
    if (
      typeof data.rightWidth === "number" &&
      Number.isFinite(data.rightWidth)
    ) {
      result.rightWidth = clampWidth(
        data.rightWidth,
        rightPanelWidthBounds.min,
        rightPanelWidthBounds.max,
      );
    }

    return result;
  } catch {
    return {};
  }
}

export function parseWorkspaceTabs(raw: string | undefined): WorkspaceTab[] {
  if (!raw) {
    return [];
  }

  try {
    const data = JSON.parse(safeDecode(raw)) as unknown;
    if (!Array.isArray(data)) {
      return [];
    }

    const tabs: WorkspaceTab[] = [];
    const seen = new Set<string>();

    for (const item of data) {
      if (!isWorkspaceTab(item) || seen.has(item.href)) {
        continue;
      }
      seen.add(item.href);
      tabs.push({
        id: item.href,
        title: item.title,
        href: item.href,
        type: item.type,
      });
      if (tabs.length >= maxWorkspaceTabs) {
        break;
      }
    }

    return tabs;
  } catch {
    return [];
  }
}

function isWorkspaceTab(value: unknown): value is WorkspaceTab {
  if (!value || typeof value !== "object") {
    return false;
  }
  const candidate = value as Partial<WorkspaceTab>;
  return (
    typeof candidate.title === "string" &&
    typeof candidate.href === "string" &&
    typeof candidate.type === "string"
  );
}

function writeCookie(name: string, value: string) {
  if (typeof document === "undefined") {
    return;
  }
  document.cookie = `${name}=${encodeURIComponent(value)}; path=/; max-age=${cookieMaxAgeSeconds}; samesite=lax`;
}

export function writeWorkspaceLayoutCookie(state: WorkspaceLayoutState) {
  writeCookie(workspaceLayoutCookie, JSON.stringify(state));
}

export function writeWorkspaceTabsCookie(tabs: WorkspaceTab[]) {
  writeCookie(workspaceTabsCookie, JSON.stringify(tabs));
}
