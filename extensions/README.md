# Writing a Vault extension

An extension is one folder in `extensions/`. It talks to Vault only through the
SDK in `lib/extension-api`, and Vault's core never names it. Add a folder and
the extension exists; delete it and it is gone. The design and its reasons are
in [`docs/23_EXTENSION_SDK_PLAN.md`](../docs/23_EXTENSION_SDK_PLAN.md); this page
is how to build one.

`extensions/calendar/` is the reference extension. Read it alongside this guide.

## The model in one page

**Four modules, one question each.**

| File | Answers | Loaded |
|---|---|---|
| `manifest.ts` | What is this extension? Id, name, permissions, settings, which syntax it owns, command metadata. Plain data. | Everywhere, always |
| `render.tsx` | What do readers see? Block components, as lazy loaders. | Everywhere, statically; components load per block |
| `editor.tsx` | What do authors use? Commands and toolbar buttons. | In the browser, once per session, only for users who enabled it |
| `server.ts` | What runs on the server? State schemas, actions, data a page needs before rendering. | Server only |

Only the manifest is required.

**Rendering follows content; authoring follows the user.** A document that
contains `:::calendar{id=x}` shows the calendar to every reader, including
people who never enabled the extension and anonymous readers of a published
page. Toolbar buttons, slash items and commands appear only for users who
enabled the extension and can edit the document. When deciding where something
goes, ask: is it part of the document, or a tool for writing it?

**Syntax is a directive or a fence.** A block is `:::name{attributes}` on its
own line. An inline value is `:name[…]{…}`. A diagram-style renderer claims a
fence language. Claim names in the manifest's `syntax`; never invent new
Markdown grammar. A document whose extension is gone then still reads as its
source.

## The rules

These are enforced: ESLint for imports, the contract test
(`extensions/contract.test.ts`) for the rest. `npm run lint` and `npm test` tell
you when you break one.

1. **Import only your own folder (relative paths), `@/lib/extension-api`,
   `@/components/ui/*` and `@/lib/utils`**, plus packages. If you need something
   from Vault that the SDK does not offer, the answer is to add it to the SDK,
   not to reach around it.
2. **Never import a component statically into `render.tsx`.** Use
   `load: () => import("./MyBlock")`. Next bundles every client component a
   server page can reach into that page's entry chunk, so one static import puts
   your extension on every page of the site.
3. **Never touch the database.** Server code gets everything through the
   context the host hands it: state, documents, assets, FX rates. Each is
   gated by the permissions your manifest declares.
4. **Namespace everything** under your id: commands, slash items, actions
   (`vault.calendar.insert`). A mismatch is a type error.
5. **Settings defaults come from the schema.** `defaults`, if you write it,
   must equal `schema.parse({})`.

## Walkthrough

### 1. Scaffold

```bash
npm run ext:new -- stopwatch            # all modules
npm run ext:new -- stopwatch --editor   # just the ones you ask for
```

This creates `extensions/stopwatch/` with working code and a test, and
regenerates the registries. It passes the type check, lint and the contract
test as generated. Replace the `TODO`s.

The registry files (`extensions/manifests.ts`, `registry.*.ts`) are
generated. Never edit them; `npm run ext:registry` (also run before `dev` and
`build`) rewrites them from the folders present.

### 2. The manifest

```ts
export default defineManifest({
  id: "vault.stopwatch",           // vault.<folder>
  name: "Stopwatch",
  version: 1,
  category: "editor",
  description: "One sentence for Settings → Extensions.",
  defaultEnabled: false,
  permissions: ["document:write-extension-state"],
  syntax: { blocks: ["stopwatch"] },
  commands: [{ id: "vault.stopwatch.insert", label: "Insert stopwatch" }],
  slashCommands: [
    { id: "vault.stopwatch.slash", label: "stopwatch", title: "Stopwatch",
      directive: "stopwatch", run: { command: "vault.stopwatch.insert" } },
  ],
  settings: { schema: stopwatchSettings, sections: [/* fields */] },
});
```

`settings.sections` become the extension's settings page automatically.

### 3. A block

```tsx
// render.tsx
export default defineRender(manifest, {
  blocks: {
    stopwatch: { form: "leaf", live: "widget", load: () => import("./StopwatchBlock") },
  },
});
```

```tsx
// StopwatchBlock.tsx
"use client";

export default function StopwatchBlock({ ctx, attributes, links }: BlockProps) {
  const { value, set } = useExtensionState(ctx, `stopwatch:${attributes.id}`, {
    schema: stopwatchStateSchema,
  });
  // ...
}
```

The same component renders in Read mode, on public pages and as the Live-mode
widget. `ctx` tells it where:

- `ctx.surface`: `workspace`, `public`, `share`, `guide` or `embed`.
- `ctx.canEdit`: false everywhere except the Live-mode widget of an editor.
  `set` is a no-op when it is false, so call it unconditionally.
- `ctx.documentId`: null when the block renders outside its document (inside
  an embed of another document, a preview). Show a notice then, never state.
- `ctx.settings`: the viewer's settings, or schema defaults if they have not
  enabled the extension.
- `ctx.enabled`: whether the viewer enabled the extension, for authoring
  affordances inside rendered content.

Render Markdown inside a block with `ExtensionMarkdown` from
`@/lib/extension-api/react`, passing `links`. Call your own server actions with
`useExtensionAction(ctx, "vault.stopwatch.someAction")`.

The host handles lazy loading, Suspense, source reveal in Live mode, fenced-code
exclusion, and errors: a block that throws shows its source, never a broken
page.

### 4. Commands and toolbar

```tsx
// editor.tsx
export default defineEditor(manifest, {
  commands: {
    "vault.stopwatch.insert": (editor) => editor.insertBlock(`:::stopwatch{id=${newId()}}`),
  },
  toolbar: [{ command: "vault.stopwatch.insert", label: "Insert stopwatch", icon: Timer }],
});
```

Every manifest command needs a handler (a type error otherwise). Commands reach
the author three ways with no extra code: the toolbar, slash items that `run`
them, and the command palette.

### 5. Server

```ts
// server.ts
import "server-only";

export default defineServer(manifest, {
  state: [{ version: 1, schema: stopwatchStateSchema }],
  actions: [/* agent actions; `agent: false` for UI-only ones */],
  loadRenderData: async (context) => null, // data a page must fetch first
});
```

Actions are what MCP agents call, and what your own UI calls through
`useExtensionAction`: one permission-checked dispatcher for both.

## Testing

- **Unit tests** live next to the code. `runCommand(editor, commandId, "text|")`
  from `@/lib/extension-api/testing` runs a command against a bare editor state
  and returns the Markdown; `|` marks the cursor. `createTestContext(manifest)`
  builds a render context.
- **The contract test** checks every extension automatically: manifest
  invariants, unique syntax claims, no static client imports in render modules,
  every claimed block rendered, every command handled, fixture state valid.
- **Fixtures** are sample documents in `fixtures/<name>.md`, with optional
  state in `fixtures/<name>.state.json`:

  ```json
  { "stopwatch:a": { "visibility": "public", "state": { "startedAt": "@today" } } }
  ```

  `"@today"`, `"@today+N"` and `"@today-N"` become day keys relative to now.

- **The playground** at `/dev/extensions` (development only) renders every
  fixture four ways from in-memory state: Live, Read, Public (public state only)
  and with the extension disabled. It has a settings panel generated from your
  manifest and buttons for your commands. Use it to check the
  render/authoring split and visibility rules without two accounts and a
  published page.

## Not supported yet

The SDK grows with each extension moved behind it (plan §14):

- **Container blocks** (`:::name` … `:::` with a body) and inline directives are
  claimed in `syntax.containers` / `syntax.inline`, but the host does not
  render them yet (calc, slice 6).
- **Overlays** (stickers, slice 4), **link decorators** (dictionary, slice 5)
  and **fence renderers** are designed in the plan but not built.
- **Styles** live in `app/styles/components.css`, following
  [`docs/CSS_CONTRACT.md`](../docs/CSS_CONTRACT.md); extensions do not ship
  their own stylesheet yet.

If your extension needs one of these, build it into the host first, generally,
for every extension. Never special-case your extension in core.
