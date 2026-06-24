# Settings Modal and Extension Browser Plan

## 1. Goal

Vault needs a mature workspace-style settings surface before optional
extensions such as stickers are added.

The target checkpoint is:

```txt
Vault can register, enable, configure, and surface trusted built-in extensions
through a settings modal and extension browser, and the stickers extension can
be added without hardcoding a one-off settings page, overlay mount, or runtime
toggle.
```

This plan builds on:

```txt
docs/12_EXTENSION_REGISTRY_PLAN.md
db.document_extension_states
lib/extensions/*
components/extensions/DocumentOverlayHost.tsx
components/extensions/use-document-extension-state.ts
```

## 2. Product Direction

Settings should become a workspace modal, not a standalone page.

Reference shape:

- Obsidian organizes settings into app options, appearance, hotkeys, core
  plugins, and community plugins.
- Obsidian plugins can contribute commands, views, settings tabs, and persistent
  data.
- VS Code-like products make preferences command-accessible and searchable.

Vault should use the same product pattern, adapted for a self-hosted web app
with private documents and stricter extension security.

Initial settings sections:

```txt
Account
Workspace
Editor
Appearance
Files & assets
Hotkeys
Core features
Extension browser
Installed extensions
Advanced
```

Settings can remain route-addressable for compatibility, but the user
experience should be modal-first:

```txt
Settings icon / command / Ctrl+, -> modal opens over current workspace tab
/dashboard/settings -> workspace opens with settings modal focused
```

## 3. Non-Goals

Do not implement arbitrary third-party JavaScript execution in this phase.

Do not treat remote GitHub repos as installable runtime plugins yet.

Do not store user app preferences in `document_extension_states`. That table is
for document-scoped extension state such as sticker positions, drawing state, or
widget instance data.

Do not make stickers public by default. Public rendering should require explicit
state visibility and document visibility decisions later.

## 4. Required Storage

### user_settings

User-level preferences that apply across the workspace.

```txt
user_settings
  id UUID PRIMARY KEY
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE
  namespace TEXT NOT NULL
  key TEXT NOT NULL
  value JSONB NOT NULL
  created_at TIMESTAMP NOT NULL DEFAULT now()
  updated_at TIMESTAMP NOT NULL DEFAULT now()

  UNIQUE(user_id, namespace, key)
```

Examples:

```txt
namespace = appearance
key = theme
value = { "themeId": "dark" }

namespace = editor
key = defaults
value = { "mode": "live", "readableLineLength": true, "lineNumbers": false }

namespace = workspace
key = tabs
value = { "restoreTabs": true, "openLinksInNewTab": false }
```

Rules:

- Use server helpers for all reads and writes.
- Validate known namespaces with zod.
- Unknown namespaces are not accepted until extension settings need them.
- Keep localStorage only as a first-paint fallback for theme and shell layout.

### user_extension_settings

Per-user extension enablement and settings.

```txt
user_extension_settings
  id UUID PRIMARY KEY
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE
  extension_id TEXT NOT NULL
  enabled BOOLEAN NOT NULL DEFAULT false
  settings JSONB NOT NULL DEFAULT '{}'
  version INTEGER NOT NULL DEFAULT 1
  created_at TIMESTAMP NOT NULL DEFAULT now()
  updated_at TIMESTAMP NOT NULL DEFAULT now()

  UNIQUE(user_id, extension_id)
```

Examples:

```txt
extension_id = vault.stickers
enabled = true
settings = {
  "defaultVisibility": "private",
  "showHandles": "on-select",
  "snapToGrid": false
}
```

Rules:

- The registry defines allowed extension ids.
- Settings are validated against the extension's registered schema.
- Built-in core features may be shown in settings, but disabling a core feature
  should only be allowed when it is actually optional.
- Extension enablement is per user first. Admin/global controls can come later.

### Future global_extension_settings

Not needed for the stickers-ready checkpoint.

Keep in mind for later:

```txt
global_extension_settings
  extension_id TEXT PRIMARY KEY
  globally_enabled BOOLEAN NOT NULL DEFAULT true
  release_channel TEXT NOT NULL DEFAULT 'stable'
  updated_by UUID REFERENCES users(id) ON DELETE SET NULL
  updated_at TIMESTAMP NOT NULL DEFAULT now()
```

## 5. Registry Additions

Extend `VaultExtension` so the settings UI can be generated from registry
metadata.

Target shape:

```ts
type VaultExtension = {
  id: string;
  name: string;
  version: number;
  kind: "core" | "built-in";
  description?: string;
  category?: "editor" | "document" | "workspace" | "assets" | "visual";
  permissions?: ExtensionPermission[];
  defaultEnabled?: boolean;

  settings?: {
    schema?: ZodType;
    defaults?: Record<string, unknown>;
    sections?: ExtensionSettingsSection[];
  };

  markdown?: { ... };
  documentState?: { ... };
  workspace?: { ... };
};
```

Recommended settings field model:

```ts
type ExtensionSettingsSection = {
  id: string;
  label: string;
  fields: ExtensionSettingsField[];
};

type ExtensionSettingsField =
  | { type: "toggle"; key: string; label: string; description?: string }
  | { type: "select"; key: string; label: string; options: Array<{ label: string; value: string }> }
  | { type: "number"; key: string; label: string; min?: number; max?: number; step?: number }
  | { type: "text"; key: string; label: string; placeholder?: string };
```

Custom React settings panels can be added later for trusted built-ins, but the
first version should support generated forms. Generated forms make the future
verified plugin path easier.

## 6. Theme and Appearance Model

Current state:

```txt
components/theme-provider.tsx stores "dark" or "light" in localStorage.
```

Target:

```txt
themeId = dark | light | midnight | graphite | paper | system
```

Implementation direction:

- Use `data-theme="<themeId>"` on `<html>` for named themes.
- Continue toggling `.dark` only for Tailwind/shadcn dark variants where needed.
- Store signed-in user preference in `user_settings`.
- Keep localStorage mirror for first paint before server/user settings load.
- Use CSS variables for colors, editor surfaces, callouts, cards, and document
  typography.

Initial settings:

```txt
Theme
Accent color
Editor font size
Reading font size
Monospace font
Readable line length
```

Do not implement arbitrary CSS snippets until there is a clear sanitizer and
public-page policy. User CSS snippets are presentation settings, not document
content.

## 7. Settings Modal UX

Component target:

```txt
components/settings/SettingsModal.tsx
components/settings/SettingsNav.tsx
components/settings/sections/AccountSettings.tsx
components/settings/sections/WorkspaceSettings.tsx
components/settings/sections/EditorSettings.tsx
components/settings/sections/AppearanceSettings.tsx
components/settings/sections/FilesAssetsSettings.tsx
components/settings/sections/HotkeysSettings.tsx
components/settings/sections/CoreFeaturesSettings.tsx
components/settings/sections/ExtensionBrowserSettings.tsx
components/settings/sections/InstalledExtensionsSettings.tsx
components/settings/sections/AdvancedSettings.tsx
```

Modal behavior:

- Large desktop dialog, about `min(72rem, calc(100vw - 2rem))` wide.
- `80vh` max height.
- Internal left nav and main pane scroll areas.
- Escape closes.
- Focus trap.
- Search input at top of nav or header.
- Deep section state in query param:

```txt
?settings=appearance
?settings=extension:vault.stickers
```

Route compatibility:

```txt
/dashboard/settings
  loads workspace shell
  opens SettingsModal with account section
```

Existing account/profile/OAuth controls should be extracted from
`app/(workspace)/dashboard/settings/page.tsx` rather than rewritten.

## 8. Extension Browser UX

### Local Built-Ins

First checkpoint browser only lists local built-in extensions shipped with
Vault.

Card fields:

```txt
Name
Description
Kind: Built-in
Category
Version
Enabled toggle
Permissions
Contributes: document overlay, workspace panel, command, Markdown block
Settings button if settings schema exists
```

Search/filter:

```txt
All
Enabled
Disabled
Document
Workspace
Visual
Assets
```

The browser should make extension capability clear before enabling it.

### Installed Extensions

Installed is just enabled/known built-ins for now.

Controls:

- Enable/disable.
- Open settings.
- View commands.
- Reset extension settings.
- Later: clear extension document state.

### Future Verified Extensions

Later shape, not implemented now:

```txt
Verified plugin registry metadata -> admin review -> bundled import -> per-user enable
```

Remote repo installation should require a separate security design. A web app
with private documents cannot safely load arbitrary plugin JavaScript into the
same origin without a sandbox or review pipeline.

## 9. Hotkeys and Commands

Stickers needs commands eventually:

```txt
Add sticker
Toggle sticker layer
Delete selected sticker
Bring sticker forward
Send sticker backward
```

The settings checkpoint should introduce command metadata even if editable
hotkeys are a later slice.

Registry target:

```ts
type CommandContribution = {
  id: string;
  label: string;
  description?: string;
  sourceExtensionId: string;
  defaultKeymap?: KeyBinding[];
};
```

Hotkeys settings first pass:

- List commands from core and enabled extensions.
- Search commands.
- Show default shortcut.
- Show conflict detection placeholder.

Editable custom hotkeys can be a later checkpoint.

## 10. Runtime Enablement Rules

Extension enablement must be applied consistently.

When a user disables an extension:

- Its workspace panels/pages do not appear.
- Its commands do not appear.
- Its document overlays do not mount.
- Its Markdown blocks should still fail gracefully.

Markdown content extensions have a special rule:

```txt
Existing document Markdown must remain readable even if an optional extension is
disabled. The source should remain visible or render a safe placeholder.
```

Document-state extensions have a different rule:

```txt
Existing state remains stored, but the extension overlay/panel does not mount
until re-enabled.
```

For stickers:

- Disabled means no sticker layer UI.
- Existing sticker state remains in `document_extension_states`.
- Re-enabling restores the saved layer.

## 11. Stickers-Ready Extension Contract

The settings and registry work is complete enough for stickers when a built-in
extension can define:

```ts
{
  id: "vault.stickers",
  name: "Stickers",
  kind: "built-in",
  defaultEnabled: false,
  permissions: [
    "document:read",
    "document:write-extension-state",
    "asset:read"
  ],
  settings: {
    defaults: {
      defaultVisibility: "private",
      snapToGrid: false,
      showHandles: "on-select"
    },
    schema: stickersSettingsSchema,
    sections: [...]
  },
  documentState: {
    schemas: [stickersLayerStateSchema],
    overlays: [...]
  },
  workspace: {
    panels: [...],
    commands: [...]
  }
}
```

And the app can:

- Show it in Extension browser.
- Enable it for the current user.
- Persist settings to `user_extension_settings`.
- Validate settings against the registered schema.
- Hide/show its overlay contribution based on enablement.
- Load/save its document state through existing extension-state helpers.
- Show its settings form without a custom one-off page.

## 12. Implementation Slices

### Slice 1: Planning and Existing Settings Extraction

- Add this plan.
- Extract the current profile/OAuth settings UI into reusable account settings
  components.
- Keep `/dashboard/settings` behavior unchanged during extraction.

Acceptance:

- Existing profile and OAuth settings still work.
- Build passes.

### Slice 2: Settings Modal Shell

- Add `SettingsModal`.
- Add section nav and modal state.
- Wire Settings icon rail to open modal.
- Keep route compatibility for `/dashboard/settings`.

Acceptance:

- Settings opens without losing the active workspace tab.
- Escape/close restores the previous workspace view.
- `/dashboard/settings` still works for direct navigation.

### Slice 3: User Settings Schema and Server Helpers

- Add `user_settings`.
- Add server helpers:
  - `getUserSetting`
  - `listUserSettings`
  - `upsertUserSetting`
  - `deleteUserSetting`
- Add zod schemas for known namespaces.
- Add client hook for modal sections.

Acceptance:

- Appearance/editor/workspace settings can persist server-side.
- Unknown setting namespaces are rejected.

### Slice 4: Named Theme Runtime

- Expand theme provider from dark/light to named themes.
- Add `data-theme`.
- Mirror chosen theme to localStorage for first paint.
- Persist signed-in theme to `user_settings`.
- Add Appearance section controls.

Acceptance:

- Existing dark/light behavior remains.
- At least one additional named theme can be selected.
- Theme selection persists across reload/sign-in.

### Slice 5: Extension Settings Schema

- Extend `lib/extensions/types.ts` with settings metadata.
- Extend registry selectors:
  - `getExtensions`
  - `getEnabledExtensions`
  - `getExtensionSettingsSchema`
  - `getWorkspaceContributions`
  - `getDocumentOverlayContributions`
  - `getCommandContributions`
- Keep existing core Live block behavior unchanged.

Acceptance:

- Registry can enumerate extension metadata without importing UI-only modules on
  the server.
- Core extensions still register current Live block specs.

### Slice 6: User Extension Settings Storage

- Add `user_extension_settings`.
- Add server helpers:
  - `listUserExtensionSettings`
  - `getUserExtensionSetting`
  - `setUserExtensionEnabled`
  - `upsertUserExtensionSettings`
  - `resetUserExtensionSettings`
- Validate extension ids against the registry.
- Validate settings against extension schemas.

Acceptance:

- Built-in extension enablement persists per user.
- Invalid extension ids/settings are rejected server-side.

### Slice 7: Extension Browser UI

- Add Extension browser section.
- Add Installed extensions section.
- Show local built-ins from registry metadata.
- Show permissions and contribution types.
- Enable/disable built-ins.
- Render generated settings forms.

Acceptance:

- A dummy built-in extension can be enabled, disabled, and configured.
- UI does not imply remote plugin installation yet.

### Slice 8: Runtime Gating

- Filter workspace contributions by enabled extensions.
- Filter document overlay contributions by enabled extensions.
- Filter commands by enabled extensions.
- Keep core Markdown/rendering stable.

Acceptance:

- Disabled optional extension contributions do not mount.
- Existing document state is not deleted when disabled.
- Core document editing still works with no optional extensions enabled.

### Slice 9: Stickers Preflight Dummy

- Add a no-op `vault.stickers` manifest with settings schema and disabled-by
  default.
- Do not implement sticker placement yet.
- Confirm settings/browser/runtime behavior with the manifest.

Acceptance:

- `vault.stickers` appears in Extension browser.
- Enabling it persists.
- Its settings persist.
- Its overlay contribution can be gated on/off with a placeholder overlay.

After this slice, the real stickers extension can start.

## 13. Stickers Extension Checkpoint

Do not begin real sticker placement until all of these are true:

```txt
[x] Settings modal opens from workspace without replacing the current tab.
[x] Existing account/profile/OAuth settings work inside the modal.
[x] User appearance/editor/workspace settings persist server-side.
[x] Theme runtime supports named themes through data-theme and CSS variables.
[~] Extension registry exposes settings metadata and contribution selectors.
[x] user_extension_settings persists enablement and settings per user.
[~] Extension browser lists local built-ins with permissions and settings.
[~] Runtime contribution mounting respects per-user enablement.
[~] vault.stickers dummy extension can be enabled/configured.
[x] Build passes.
```

Current priority note:

```txt
Do not prioritize real stickers work yet. Finish the settings modal, generated
settings forms, runtime preference consumption, and extension-browser foundation
before returning to sticker-specific overlay behavior.
```

## 14. Security Notes

- Server-side validation is required for every persisted setting.
- User extension settings must never grant permissions by themselves; they only
  enable registered capabilities already declared in code.
- Extension state reads/writes must continue through
  `server/document-extensions.ts`.
- Asset-backed extensions must use asset ids and Vault asset routes, never raw
  R2 URLs.
- Public pages must not render private extension state.
- Remote repo extensions are explicitly out of scope until there is a verified
  bundling or sandboxing model.

## 15. Documentation Updates Per Slice

When implementing the slices:

- Update `docs/01_PROGRESS_TRACKER.md`.
- Update `docs/project-knowledge.md`.
- Update `docs/03_DATA_MODEL.md` for new settings tables.
- Update `docs/12_EXTENSION_REGISTRY_PLAN.md` when registry contracts change.
- Add or update user-facing guides once settings and extension browser are
  usable.
