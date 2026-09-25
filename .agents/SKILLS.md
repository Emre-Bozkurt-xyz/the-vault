# Skills available in this repo

A **skill** is a markdown file of procedural knowledge for a specific kind of
task. Claude Code discovers these automatically; **Codex and other agents must
load them by hand** — that is what this index is for.

## How to use this index (Codex, and any agent without a skill loader)

1. Before starting a unit of work, scan the **When to load** column below.
2. If a row matches, read that `SKILL.md` **in full** before writing code.
3. Follow it. A skill's instructions outrank your default approach, but never
   outrank `AGENTS.md` or an explicit instruction from the user.
4. Some skills have supporting files next to them (`rules/`, `references/`).
   Only open those when the `SKILL.md` tells you to — that is the point of the
   two-level layout.

Do not read every skill "just in case". Loading an irrelevant skill wastes
context and pulls you toward advice that does not apply here.

## Index

| Skill | When to load | Path |
|---|---|---|
| `update-docs` | **At the END of any unit of work that changed how the codebase behaves** — new/changed feature, route or API, component behavior, DB schema or migration, new dependency, behavior-changing bug fix, new architectural decision, or starting/finishing a planned phase. Skip for questions, code reading, reverted work, and cosmetic edits. | [`.agents/skills/update-docs/SKILL.md`](skills/update-docs/SKILL.md) |
| `shadcn` | Adding, styling, composing, or debugging shadcn/ui components and registries. This repo has a `components.json`, so it applies to most UI work. | [`.agents/skills/shadcn/SKILL.md`](skills/shadcn/SKILL.md) |
| `frontend-design` | Building or restyling a page, view, or component where visual quality matters — not routine wiring of an existing pattern. | [`.agents/skills/frontend-design/SKILL.md`](skills/frontend-design/SKILL.md) |
| `github-actions-docs` | Writing, debugging, or securing anything under `.github/workflows/`. | [`.agents/skills/github-actions-docs/SKILL.md`](skills/github-actions-docs/SKILL.md) |
| `find-skills` | The user asks whether a skill exists for some task, or wants to install one. Installs land in `.agents/skills/` via `npx skills add`. | [`.agents/skills/find-skills/SKILL.md`](skills/find-skills/SKILL.md) |

## Adding a skill

- Installed skills: `npx skills add <package>`, which writes to `.agents/skills/`
  and records a hash in `skills-lock.json`. Do not hand-edit installed skills or
  that lock file.
- Hand-written skills: create `.agents/skills/<name>/SKILL.md` with `name` and
  `description` frontmatter, then **add a row to the index above** — otherwise
  Codex will never find it.
- If Claude Code should also surface it as a first-class skill, add a short entry
  point at `.claude/skills/<name>/SKILL.md` whose body defers to the `.agents`
  copy (see `update-docs` for the pattern). Keep the body in one place only.
