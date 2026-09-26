---
name: create-extension
description: >-
  Build or change a Vault extension under extensions/<name>/ through the
  extension SDK. Load when adding a new extension, adding a block, command,
  setting, state schema or agent action to one, or when a request would
  otherwise mean editing core files (MarkdownEditor, MarkdownDocument,
  live-blocks, pages) for one extension's sake. Not for core Markdown features
  (callouts, math, tables, asset groups, embeds, code blocks), which stay core.
---

# Creating or changing an extension

`extensions/README.md` is the reference (model, rules, API). This skill is the
process. Read the README first if you have not this session.

## Before writing code

1. **Is it an extension?** Optional capabilities are (calendars, stickers,
   widgets, diagrams). Core Markdown features are not; see plan 12 §8. If
   unsure, ask the user.
2. **Can the SDK express it?** Check the README's "Not supported yet" list. If
   the extension needs a missing host capability (container blocks, overlays,
   a new host service), that is a host change: build it generically in
   `lib/extension-host` / `lib/extension-api` for every extension, following
   `docs/23_EXTENSION_SDK_PLAN.md`, and say so to the user before starting. Never
   add a special case for one extension to a core file.
3. **Decide render vs authoring** for each piece: part of the document (render,
   shown to every reader) or a tool for writing it (editor, enabled users only)?

## Steps

1. **Scaffold** a new extension: `npm run ext:new -- <name>` (add `--render`,
   `--editor`, `--server` to create only some modules). Never create the
   registry files by hand; `npm run ext:registry` regenerates them.
2. **Manifest first.** Id `vault.<folder>`, permissions (only what actions
   need), `syntax` claims, commands, slash items, settings schema and sections.
3. **Render**, if any: components behind `load: () => import(...)` only. Handle
   `ctx.documentId === null` with a notice. Use `useExtensionState` for state
   and `ExtensionMarkdown` for Markdown.
4. **Editor**, if any: a handler for every manifest command; toolbar items with
   a lucide icon.
5. **Server**, if any: state schemas for every state key you write, actions
   with zod input/output, `agent: false` for UI-only actions. No `db` imports.
6. **Fixtures**: at least one `fixtures/<name>.md` exercising every block, plus
   a `.state.json` with a public and a private row if the extension has state.
7. **Tests**: `runCommand` for each command; unit tests for pure logic and
   action handlers. The contract test covers the rest automatically.
8. **Styles** in `app/styles/components.css` per `docs/CSS_CONTRACT.md`.

## Verify

Run, and fix everything you introduced:

```bash
npx tsc --noEmit
npm run lint      # compare against the pre-existing baseline in AGENTS.md
npm test
```

Then open `/dev/extensions/<id>` with `npm run dev` and check every fixture in
all four panes: Live (edit, run each command, move the cursor through a block),
Read, Public (private state must not show) and Extension disabled (content still
renders). Change each setting and confirm it applies live. Report what you
checked, and anything you could not check (for example flows that need a
signed-in workspace).

`npm run build` for larger changes, and confirm the extension's block
components did not land in page entry chunks if you touched `render.tsx`
loading.

## Finish

Invoke the `update-docs` skill. A new extension is a new feature: changelog row,
`docs/project-knowledge.md` §3 if you added host files, and the tracker.
