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

The body of this skill lives at **`.agents/skills/create-extension/SKILL.md`**
so that Codex and other agents share one copy. This file is the Claude Code
entry point.

Read `.agents/skills/create-extension/SKILL.md` now and follow it.
