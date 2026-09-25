# CLAUDE.md

## Read `AGENTS.md` first — not optional

**`AGENTS.md` is the operating contract for this repo**, shared by Claude Code,
Codex, and any other agent. It is authoritative. Everything that used to live
here now lives there, so the two cannot drift apart.

Start with **`AGENTS.md` §0 "Start here"**, which covers:

- the read order (`AGENTS.md` → `docs/project-knowledge.md` → the plan doc for
  your area), and the task → doc map in §1;
- the verification norms (`npx tsc --noEmit`, `npm run lint`, `npm test`,
  `npm run build`), including the pre-existing lint baseline in
  `components/markdown/MarkdownEditor.tsx`;
- the doc-maintenance duties you owe after a meaningful change (§5/§6).

Do **not** implement from memory or assumptions about what this app is. It is
**Vault**, a self-hosted Next.js collaborative document/note platform — not
Obsidian, not a generic vault.

## Skills

Repo skills are indexed in **`.agents/SKILLS.md`** and their bodies live in
`.agents/skills/<name>/SKILL.md`, so Codex can reach them too. Files under
`.claude/skills/` are thin entry points that defer to that shared copy — when you
edit a skill, edit the `.agents` body, not the entry point.

The `update-docs` skill is the required procedure for `AGENTS.md` §5/§6 upkeep at
the end of a unit of work.
