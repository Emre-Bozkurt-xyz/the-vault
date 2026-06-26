// Keyboard-binding helpers shared by the editor keymap, the global shortcut
// matcher, and the settings capture UI. Bindings are stored in CodeMirror key
// format ("Mod-Shift-k", "Mod-Alt-1"): `Mod` resolves to Cmd on macOS and Ctrl
// elsewhere. This module is framework-agnostic and safe to import on the server
// (every DOM access is guarded).

export type ParsedBinding = {
  mod: boolean;
  ctrl: boolean;
  meta: boolean;
  alt: boolean;
  shift: boolean;
  key: string;
};

const MODIFIER_EVENT_KEYS = new Set([
  "Control",
  "Shift",
  "Alt",
  "Meta",
  "OS",
  "CapsLock",
]);

export function isMacPlatform(): boolean {
  if (typeof navigator === "undefined") {
    return false;
  }
  const source = navigator.platform || navigator.userAgent || "";
  return /mac|iphone|ipad|ipod/i.test(source);
}

export function parseBinding(binding: string): ParsedBinding | null {
  if (!binding) {
    return null;
  }

  const parsed: ParsedBinding = {
    mod: false,
    ctrl: false,
    meta: false,
    alt: false,
    shift: false,
    key: "",
  };

  for (const token of binding.split("-")) {
    const lower = token.toLowerCase();

    if (lower === "mod") parsed.mod = true;
    else if (lower === "ctrl" || lower === "control") parsed.ctrl = true;
    else if (lower === "meta" || lower === "cmd" || lower === "command")
      parsed.meta = true;
    else if (lower === "alt" || lower === "option") parsed.alt = true;
    else if (lower === "shift") parsed.shift = true;
    else if (token) parsed.key = normalizeKeyToken(token);
  }

  return parsed.key ? parsed : null;
}

function normalizeKeyToken(token: string): string {
  if (token === " ") return "Space";
  return token.length === 1 ? token.toLowerCase() : token;
}

function serializeBinding(parsed: ParsedBinding): string {
  const parts: string[] = [];
  if (parsed.mod) parts.push("Mod");
  if (parsed.ctrl) parts.push("Ctrl");
  if (parsed.meta) parts.push("Meta");
  if (parsed.alt) parts.push("Alt");
  if (parsed.shift) parts.push("Shift");
  parts.push(parsed.key);
  return parts.join("-");
}

/** Re-serializes into canonical modifier order so equivalent chords compare equal. */
export function canonicalizeBinding(binding: string): string | null {
  const parsed = parseBinding(binding);
  return parsed ? serializeBinding(parsed) : null;
}

export function isValidBinding(binding: string): boolean {
  return parseBinding(binding) !== null;
}

/**
 * Derives the logical key from a keyboard event, preferring `code` for the
 * digit/letter rows so the captured chord is stable regardless of Shift (e.g.
 * Shift+8 still yields "8", not "*").
 */
function captureKey(event: KeyboardEvent): string | null {
  const code = event.code;

  if (/^Digit[0-9]$/.test(code)) return code.slice(5);
  if (/^Numpad[0-9]$/.test(code)) return code.slice(6);
  if (/^Key[A-Z]$/.test(code)) return code.slice(3).toLowerCase();

  if (MODIFIER_EVENT_KEYS.has(event.key)) return null;
  if (event.key === " ") return "Space";
  return event.key.length === 1 ? event.key.toLowerCase() : event.key;
}

/** Builds a canonical binding string from a captured event, or null for a bare modifier. */
export function bindingFromKeyboardEvent(event: KeyboardEvent): string | null {
  const key = captureKey(event);
  if (!key) {
    return null;
  }

  return serializeBinding({
    mod: event.ctrlKey || event.metaKey,
    ctrl: false,
    meta: false,
    alt: event.altKey,
    shift: event.shiftKey,
    key,
  });
}

export function matchesBinding(
  event: KeyboardEvent,
  binding: string,
  isMac: boolean,
): boolean {
  const parsed = parseBinding(binding);
  if (!parsed) {
    return false;
  }

  const needCtrl = parsed.ctrl || (parsed.mod && !isMac);
  const needMeta = parsed.meta || (parsed.mod && isMac);

  if (
    event.ctrlKey !== needCtrl ||
    event.metaKey !== needMeta ||
    event.altKey !== parsed.alt ||
    event.shiftKey !== parsed.shift
  ) {
    return false;
  }

  const key = captureKey(event);
  return key !== null && key.toLowerCase() === parsed.key.toLowerCase();
}

export function formatBindingForDisplay(binding: string, isMac: boolean): string {
  const parsed = parseBinding(binding);
  if (!parsed) {
    return "";
  }

  const parts: string[] = [];
  if (parsed.mod) parts.push(isMac ? "⌘" : "Ctrl");
  if (parsed.ctrl) parts.push(isMac ? "⌃" : "Ctrl");
  if (parsed.meta) parts.push(isMac ? "⌘" : "Win");
  if (parsed.alt) parts.push(isMac ? "⌥" : "Alt");
  if (parsed.shift) parts.push(isMac ? "⇧" : "Shift");
  parts.push(parsed.key.length === 1 ? parsed.key.toUpperCase() : parsed.key);

  return isMac ? parts.join("") : parts.join("+");
}
