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

The `docs/` folder is a historical log of what the codebase is and how it got
there. Your job is to keep it true with the **minimum** reading/writing needed.

## Decide first: does this change deserve an entry?

Do this BEFORE touching any doc, so you don't waste time.

**Log it** (one consolidated entry at the end of the work) when the session
produced any of:
- a new or changed feature, component behavior, extension, route, or API
- a bug fix that changes runtime behavior (not an internal-only refactor)
- a DB schema / migration change
- a new dependency
- a new architectural decision, invariant, or known bug
- the start or completion of a planned phase / a large new initiative

**Skip it entirely** (touch no docs) when the session was only:
- questions, explanations, or reading code
- exploration or work that was reverted/abandoned
- cosmetic edits with no behavioral impact (typos, formatting, comments, pure
  renames), unless they ride along with a larger change you're already logging
- something already fully captured by an entry you added earlier this session

When unsure, lean toward one short changelog line. One line is cheap; a missing
history is not. Never spread one session across multiple changelog rows.

## The files

- `docs/project-knowledge.md` — living source of truth (large, ~130KB). Numbered
  sections `1`–`20`. **Do not read it whole.**
- `docs/01_PROGRESS_TRACKER.md` — phase checklists using `[ ] [~] [x] [!]`.
- `docs/NN_<NAME>_PLAN.md` — one per large initiative/phase (sequential number).

## How (the cheap path)

1. **Always:** append one row to §20 Changelog and bump §1 "Last updated".
   - Read only the last ~8 changelog rows (e.g. `tail`/`Read` with offset near
     end) to match style and see the latest date. Don't load the whole file.
   - Row format, matching existing style (imperative title, one rich notes
     sentence naming the key behavior/files):
     ```
     | YYYY-MM-DD | Added/Fixed/Made <thing> | <what changed, where, and the user-visible effect> |
     ```
   - Update the `Last updated:` date block in §1 to today.

2. **Only if a documented subsystem's behavior changed,** open that one numbered
   section and update it (e.g. `8 Document System`, `9 Editor Implementation`,
   `5 Database State`). Edit just the relevant lines.

3. **If it maps to a tracked phase/task,** tick or add a row in
   `01_PROGRESS_TRACKER.md` (`[~]`→`[x]`, or a new task line under the phase).

4. **Conditionally, when it applies:**
   - New significant decision → add a row to §17 Important Decisions Made.
   - New rule the change must keep true → add a bullet to §18 invariants.
   - A bug you found but did not fix → add a row to §16 Known Bugs / Issues.
   - A large new multi-step initiative → create `docs/NN_<NAME>_PLAN.md` with the
     next number and reference it from §1 "Planned direction". Then add tracker
     phase rows for it.

5. Keep §19 Next Best Tasks current if your work changed what's next.

Use absolute dates (today), never "recently"/"now". Prefer extending existing
sections over adding new ones.
