/**
 * Extension fixtures (`docs/23_EXTENSION_SDK_PLAN.md` §18.3): sample documents
 * under `extensions/<name>/fixtures/`, rendered by the playground and checked
 * by the contract test.
 *
 *   <fixture>.md          the document
 *   <fixture>.state.json  optional state rows: { "<stateKey>": { "state": …,
 *                         "visibility": "private" | "public" | "editor-only" } }
 *
 * In state files, the string `"@today"`, `"@today+N"` or `"@today-N"` becomes a
 * `YYYY-MM-DD` day key relative to now, so date-shaped fixtures stay visible.
 */
import type {
  ExtensionStateRow,
  ExtensionStateValue,
  ExtensionStateVisibility,
} from "@/lib/extension-api";

export type ExtensionFixture = {
  name: string;
  markdown: string;
  state: Record<string, ExtensionStateRow>;
};

const visibilities: ReadonlySet<string> = new Set(["private", "public", "editor-only"]);

function dayKey(date: Date): string {
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

function resolveTokens(value: unknown, now: Date): unknown {
  if (typeof value === "string") {
    const match = /^@today(?:([+-])(\d+))?$/.exec(value);
    if (!match) return value;
    const date = new Date(now);
    const offset = match[2] ? Number(match[2]) * (match[1] === "-" ? -1 : 1) : 0;
    date.setDate(date.getDate() + offset);
    return dayKey(date);
  }
  if (Array.isArray(value)) return value.map((item) => resolveTokens(item, now));
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [key, resolveTokens(item, now)]),
    );
  }
  return value;
}

/** Parses a fixture's state file, throwing on anything malformed. */
export function parseFixtureState(
  json: string,
  now: Date = new Date(),
): Record<string, ExtensionStateRow> {
  const raw = JSON.parse(json) as unknown;
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    throw new Error("A fixture state file must be an object keyed by state key.");
  }

  const rows: Record<string, ExtensionStateRow> = {};
  for (const [stateKey, row] of Object.entries(raw)) {
    const { state, visibility = "private" } = (row ?? {}) as {
      state?: unknown;
      visibility?: string;
    };
    if (!state || typeof state !== "object" || Array.isArray(state)) {
      throw new Error(`Fixture state "${stateKey}" needs an object "state".`);
    }
    if (!visibilities.has(visibility)) {
      throw new Error(`Fixture state "${stateKey}" has unknown visibility "${visibility}".`);
    }
    rows[stateKey] = {
      state: resolveTokens(state, now) as ExtensionStateValue,
      visibility: visibility as ExtensionStateVisibility,
      version: 1,
    };
  }
  return rows;
}
