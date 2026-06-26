import { canonicalizeBinding } from "@/lib/shortcuts/binding";
import { shortcuts } from "@/lib/shortcuts/registry";

/** Per-shortcut effective binding: a chord string, or null when disabled. */
export type ResolvedKeybindings = Record<string, string | null>;

/** Sparse user overrides keyed by shortcut id (string = custom, null = disabled). */
export type KeybindingOverrides = Record<string, string | null>;

/** Merges registry defaults with the user's sparse overrides. */
export function resolveKeybindings(
  overrides: KeybindingOverrides | undefined | null,
): ResolvedKeybindings {
  const resolved: ResolvedKeybindings = {};

  for (const def of shortcuts) {
    if (overrides && Object.prototype.hasOwnProperty.call(overrides, def.id)) {
      resolved[def.id] = overrides[def.id];
    } else {
      resolved[def.id] = def.defaultBinding;
    }
  }

  return resolved;
}

/**
 * Ids whose effective chord collides with another shortcut's. Globals fire
 * regardless of focus, so a global chord that equals an editor chord conflicts
 * inside the editor — all enabled bindings share one namespace here.
 */
export function findConflicts(resolved: ResolvedKeybindings): Set<string> {
  const byChord = new Map<string, string[]>();

  for (const [id, binding] of Object.entries(resolved)) {
    if (!binding) {
      continue;
    }

    const canonical = canonicalizeBinding(binding);
    if (!canonical) {
      continue;
    }

    const ids = byChord.get(canonical) ?? [];
    ids.push(id);
    byChord.set(canonical, ids);
  }

  const conflicts = new Set<string>();
  for (const ids of byChord.values()) {
    if (ids.length > 1) {
      for (const id of ids) {
        conflicts.add(id);
      }
    }
  }

  return conflicts;
}
