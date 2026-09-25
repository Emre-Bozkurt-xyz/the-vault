---
name: update-docs
description: >-
  Keep the docs/ historical tracker complete by recording meaningful repo
  changes. Invoke at the END of a unit of work, after it is verified, whenever
  you changed how the codebase behaves: a new or changed feature, extension,
  route/API, component behavior, DB schema/migration, new dependency, a bug fix
  that alters runtime behavior, a new architectural decision or invariant, or
  starting/finishing a planned phase. Coalesce all related edits from the
  session into ONE entry. SKIP entirely for pure questions, code reading,
  exploration, reverted/abandoned work, or trivial cosmetic edits (typos,
  formatting, comments, renames) with no behavioral impact. Stay cheap: never
  read the whole knowledge file — append to the changelog and open only the
  specific sections the change actually touched.
---

# Updating the docs tracker

The body of this skill lives at **`.agents/skills/update-docs/SKILL.md`** so that
Codex and other agents share one copy. This file is the Claude Code entry point.

## Decide first: does this change deserve an entry?

**Skip it entirely** — touch no docs, do not read further — when the session was
only: questions, explanations, or reading code; exploration or work that was
reverted/abandoned; cosmetic edits with no behavioral impact (typos, formatting,
comments, pure renames); or something already captured by an entry you added
earlier this session.

**Otherwise**, read `.agents/skills/update-docs/SKILL.md` now and follow it.
