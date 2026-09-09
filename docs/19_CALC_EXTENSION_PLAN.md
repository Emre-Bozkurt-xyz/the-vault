# Vault Calc Extension Plan

## 1. Goal

Inline computed values in prose, so a document can hold a small finance report
without degenerating into a Markdown table that emulates Excel.

```md
Hosting is :calc[rent = 1200 CAD] per month.
Domains came to :calc[domains = 42 USD].
Q1 total: :calc[rent * 3 + domains in USD].
```

The extension is `vault.calc` — **a calculator, of which currency is one unit**,
not a currency widget that happens to do math. `:calc[3 * 7]` is as valid as
`:calc[rent in USD]`. This framing is load-bearing: building the money feature
first produces a component that has to be rewritten the moment anyone writes
`rent * 3`.

---

## 2. Non-Negotiable Invariants

These are the decisions that everything else depends on. Changing one is a
redesign, not a tweak.

### Conversion never rewrites the Markdown

The source keeps whatever was authored. Converting CAD to USD is a **render**
concern, resolved per view.

Rationale: "swap back freely" then costs nothing, because the CAD was never
lost. Rewriting `1200 CAD` to `880.14 USD` destroys the input *and* freezes a
rate with no provenance, so the figure silently becomes wrong next week. Display
currency lives in `document_extension_states`, not in the document text.

### Errors are values, never exceptions

A malformed expression renders as an inline error chip. It must never blank a
paragraph, a page, or a published document. `lib/calc` returns `CalcOutcome<T>`
throughout and has no `throw` on any authoring-mistake path.

### No `eval`, no `new Function`, ever

Documents here are shared and publishable. A string-eval path is remote code
execution in a reader's browser. The parser is hand-written recursive descent.

### It is an expression grammar, not a language

No conditionals, no loops, no strings, and — the restriction that actually holds
the line — **no user-defined functions**. Named values only.

The failure mode was never the parser; it is scope creep. Once authors can
define abstractions, a note app contains a language runtime. A document needing
that needs a code block instead.

### Definition precedes use

Names bind top-to-bottom in one linear pass. This makes reference cycles
impossible *by construction* rather than by cycle detection, and matches how a
reader scans the page: a total near the bottom can only depend on figures
already read.

### The engine is pure and framework-free

`lib/calc/` imports no React, no server modules, and no network. The same code
evaluates in RSC render, in the CodeMirror live decoration, and in an agent
action, so a figure can never differ between where it is read and where it is
edited. Same discipline as `lib/calendar.ts`.

---

## 3. Syntax

`:calc[expression]{attrs}` — the inline sibling of the `:::calendar{id=…}` block
convention already used in `lib/calendar.ts`. One directive family for every
Vault extension, block and inline.

### Why not inline code

`` `= 1200 CAD` `` was the first candidate and is wrong:

- A doc *about* this feature containing `` `rent = 1200` `` would evaluate
  itself, and inline code **is** Markdown's escape hatch — there is no second
  one to escape with.
- Real code is full of `=`: `` `--out=dist` ``, `` `x = 5` ``, `` `a == b` ``.
- Any prefix sigil is a heuristic applied to the one node type whose entire
  purpose is "do not interpret this."

With a directive, immunity is **structural**: inline code and directives are
different mdast node types, so neither can ever be mistaken for the other, at
any false-positive rate. Writing about the syntax is just `` `:calc[…]` ``.

### Why not `$…$`

`remark-math` already owns `$`, with `singleDollarTextMath` on by default (see
`MarkdownDocument.tsx`, `remarkPlugins={[remarkGfm, remarkMath]}`). A doc
containing `$100 … $200` likely already renders as math today — worth verifying
and fixing independently of this feature.

### The gotcha: never read the parsed children

Directive content between `[…]` is parsed as inline Markdown, so
`:calc[a * b * c]` has two asterisks that pair into **emphasis** before the
evaluator sees them; `_` in identifiers has the same problem.

**Always slice the expression from raw source via `node.position`.** The
interior must be fully opaque. "Just read `node.children`" is the obvious wrong
path and will silently corrupt expressions.

### Attributes

`{attrs}` is the slot for per-value display options — `{as=USD}`,
`{precision=0}` — so these never need new syntax. Rate pinning is document-level,
not per-value.

### Block form

`:::calc` comes free from the same family and suits the finance-report case:
declare inputs once in an auditable block, reference them inline in prose.

```md
:::calc
rent     = 1200 CAD
domains  = 42 USD
tax_rate = 0.13
:::
```

---

## 4. Currency: Three Tiers

Arbitrary `123.45 XXX` is impossible, and the blocker is parsing, not FX
coverage: if any three uppercase letters were a currency, `rent * VAT` could not
be told from a unit and `3 FOO` would silently become money. The set must be
closed at tokenize time — but "closed" does not mean "a hardcoded handful."

| Tier | Source | Failure mode |
|---|---|---|
| Is it a currency? | ISO 4217 table (~180 codes), bundled | Parse error. Offline, deterministic |
| How is it displayed? | Same table: symbol + minor units | Never fails; always offline |
| Can it convert? | FX provider at runtime | One value shows `missing-rate`; document still renders |

So `:calc[123.45 MGA]` parses and formats today with zero network, and only
degrades if asked to convert to a currency the provider does not carry.

The ISO table is needed regardless: minor-unit exponents are what make rounding
correct (JPY 0, USD 2, KWD 3, CLF 4). Rounding all money to two places is the
exact bug the table prevents.

### Disambiguation rules

- **Currency codes are uppercase.** `CAD` is a unit, `cad` is a variable.
- **ISO codes are reserved names.** `:calc[CHF = 5]` is a `reserved-name` error,
  not a variable shadowing the Swiss franc.

### Deliberately deferred

Currency symbols (`$` is triply ambiguous — USD/CAD/AUD — and `remark-math`
owns it), crypto (not ISO, not on ECB), and user-defined units. All additive;
none change the core.

---

## 5. Unit Algebra

One dimension only: currency. A value is money or dimensionless (`currency:
null`). The complete algebra:

```txt
CAD + CAD -> CAD          CAD + USD -> converts, or missing-rate
CAD + 3   -> error        CAD * 3   -> CAD
CAD * CAD -> error        CAD / CAD -> dimensionless
CAD / 3   -> CAD          3 / CAD   -> error
```

On a cross-currency `+`, the **left operand decides** the reported currency, so
`rent + fee` reports in whatever `rent` is denominated in — predictable without
knowing the rate table.

`20%` is a dimensionless hundredth. `100 CAD * 20%` is 20 CAD;
`100 CAD + 20%` is a deliberate error rather than Soulver-style contextual
percent, because the latter is ambiguous enough to be silently wrong in a
report. Authors write `* 1.2`.

General dimensional analysis (`1200 CAD/mo * 3 mo`) is a much larger system and
is out of scope. Nothing here forecloses it.

---

## 6. FX Layer (built — see §9b)

The requirement that shapes the infra is **reproducibility**: a report that
totals differently on each page load is not a report.

- **Server-side fetch only.** The browser never contacts the provider — that
  leaks the key and rate-limits per viewer.
- **Cache in Postgres**: `fx_rates` keyed `(base, quote, rate_date)` with
  provider and `fetched_at`. Daily close rates, not ticks.
- **Fetch a whole base table per day**, not per pair; one request serves every
  conversion in every document.
- **Provenance in the UI**: hovering a converted value shows
  `1 CAD = 0.7335 USD · ECB · 2026-09-08`.
- **Pinnable rate date** per document, in extension state. Freezing a report at
  a date is what separates this from a toy.
- **Never fail the render.** Provider down → last known rate, marked stale.
  Documents must render with no network.

Provider: ECB daily reference rates (via `frankfurter.dev` or ECB XML) — no API
key, authoritative, covers the majors; triangulate cross-rates through EUR.
Behind a one-method `FxProvider` interface so swapping is a file, not a refactor.

The evaluator takes an injected `RateResolver`, so it stays pure and
offline-testable; `NO_RATES` is the slice-1 default.

---

## 7. Registry Gaps This Forces

Per `docs/12_EXTENSION_REGISTRY_PLAN.md`, this is the extension that proves the
**inline** contribution point, as stickers proved overlays. Current gaps:

- `components/markdown/live-blocks.ts` is **block-only** — no inline concept.
- `MarkdownRendererContribution` is a `{ id, priority }` placeholder; the real
  read-mode pipeline is hardcoded in `MarkdownDocument.tsx`.
- No per-render data channel for an extension to receive resolved data (the rate
  table) during render.
- ~~`ExtensionSlashCommand.insert` routes through `insertBlock`, documented as
  placing text "on its own line". An inline `:calc[]` must not break the
  paragraph, so the contribution needs an inline variant.~~ **Closed.**
  `SlashCommandContribution["insert"]` gained `placement?: "block" | "inline"`
  (default `"block"`, so every existing contribution is unchanged), and the
  editor supplies an `insertInline` action alongside `insertBlock`. `/calc`
  declares `placement: "inline"` and lands `:calc[]` at the cursor mid-sentence.

  Still open on the same field: `chainCompletion` — wiki-link-style, opening a
  completion source after inserting (see *Typing ergonomics* below).

### Typing ergonomics

`:calc[` is not shortened to buy back keystrokes — that would trade away the
structural immunity. Solve it at the editor layer, following the existing
wiki-link precedent in `slash-commands.ts`, which inserts `[[`, seats the cursor,
then calls `startCompletion(view)`:

- `/calc` inserts `:calc[]`, cursor inside, then opens a completion source.
  **Half done**: the insertion and cursor seating ship; the completion source
  does not.
- That source offers currency codes and names already bound **earlier in this
  document**, so `:calc[re` completes to `rent`. **Not built.**

Alongside them, `/calcblock` inserts `:::calc\n\n:::` with the cursor on the
blank statement line, and a toolbar button (`applyFormat("calcBlock")`, gated on
the extension being enabled for the user, like the calendar's) does the same —
except that it wraps a selection when there is one, so lines already written as
`rent = 1200 CAD` become a block in place.

`findSlashQuery` already matches `/` after whitespace as well as at line start,
so inline invocation needs no change there. `isInsideCode` already recognizes
`InlineCode` and is reusable by the live-mode scanner.

---

## 8. Slices

| # | Slice | Status |
|---|---|---|
| 1 | `lib/calc/` pure engine — decimal, tokenizer, parser, evaluator, ISO table | **Done** |
| 2 | Read-mode `:calc[…]` rendering, **no conversion** — formatted money, names, arithmetic | **Done**, browser-verified in both themes |
| 3 | `fx_rates` table + provider + server resolver + provenance hover; enables `in USD` | **Done**, verified against live ECB rates |
| 4 | Live-mode inline decorations (the new registry contribution point) + cursor reveal | **Done**, browser-verified in the editor |
| 5 | Per-document display currency + pinned rate date, in **frontmatter** (see 9d) | **Done**, browser-verified |
| 6 | Agent actions: `listValues`, `evaluate` | **Done** |
| 7 | Authoring ergonomics: toolbar button, slash commands, operand autocomplete (see 9e) | **Done**, browser-verified |

Slices 1–2 ship real value with zero network and zero schema change. Slice 3 is
the first that touches the database.

---

## 9. Slice 1 Implementation Notes

```txt
lib/calc/
  decimal.ts     bigint-backed exact decimal
  currency.ts    ISO 4217 table + Intl formatting
  types.ts       CalcValue, CalcError, CalcOutcome, RateResolver
  tokenizer.ts   lexer; currency/identifier disambiguation
  parser.ts      recursive descent -> CalcNode
  evaluate.ts    unit algebra, functions, document fold
  index.ts       public surface
```

### Why hand-rolled decimal instead of `decimal.js`

Money in IEEE 754 is wrong where it matters (`0.1 + 0.2 !== 0.3`), and a finance
report is exactly the document that surfaces it. The operation set here is tiny;
`+`, `-`, `*` are *exactly* provable with `bigint` (they only align or add
scales), and that is where money bugs actually live. Division is the sole lossy
op, pinned to `DIVISION_SCALE = 20` with half-even rounding.

Half-even ("banker's") rounding is the reporting convention because
half-away-from-zero biases a column of totals upward.

It is one module, so swapping in a library later is contained.

### Guards

No loops in the grammar, but `9^9^9` is three tokens and would otherwise hang a
tab. Caps: expression length (500), tokens (200), nesting depth (32), evaluation
steps (2000), integer digits (30), retained scale (28).

### Locale is pinned

`DEFAULT_CALC_LOCALE = "en-US"`. Leaving `Intl` to the runtime default would
resolve the **server's** locale during RSC render and the **browser's** on
hydration; any disagreement on grouping or symbol placement is a React
hydration mismatch. Configurable via extension settings later, but it must stay
one value per render.

### `tsconfig` target

Bumped `ES2017` → `ES2020` for `bigint` literals. `lib` already included
`esnext`, so only the literal syntax was gated. With `noEmit: true` and Next
compiling via SWC against its own browser targets, this is effectively
type-check-only, and ES2020 stays below the `useDefineForClassFields` flip at
ES2022.

---

## 9a. Slice 2 Implementation Notes

### Rendering defaults are context-sensitive

The two contexts want opposite defaults and both are unambiguous in place, so
the common cases need no attribute at all:

| Context | Source | Renders |
|---|---|---|
| `:::calc` block | `rent = 1200 CAD` | `rent = CA$1,200.00` |
| `:::calc` block | `rent * 3` | `rent * 3 = CA$3,600.00` |
| inline | `rent = 1200 CAD` | `CA$1,200.00` — and still binds |
| inline | `rent * 3` | `CA$3,600.00` |

A declarations block of bare numbers is unreadable; "Hosting is rent =
CA$1,200.00 per month" is not a sentence. Overrides go in `{show=…}`, never a
sigil inside the brackets — presentation must not leak into the expression
grammar, or the AST stops being purely semantic.

### Evaluation is a pre-pass

Names bind top-to-bottom across the whole document, but a document renders as
several independent `MarkdownSegment`s (split by wiki embeds and calendars), so
no segment can evaluate on its own. `MarkdownDocument` therefore splits once,
evaluates once via `buildCalcDocument`, and every renderer only *looks up*
results.

Keys are `"<pieceIndex>:<ordinal>"`. Ordinals, not character offsets, because
`MarkdownSegment` rewrites wiki links and asset embeds into HTML *before*
parsing — which shifts every offset but cannot add or remove a `:calc`.

The pre-pass and the render pass share `calcRemarkPlugins` and one traversal
order. If they walked different trees a rendered value would show another
expression's result, so the agreement is structural rather than a convention.

### Scope is one `MarkdownDocument` render

Wiki-embedded documents recurse into their own `MarkdownDocument` and get their
own scope, which is correct. Foldable regions do too, which is a **limitation**:
a name defined outside a region is invisible inside it. It fails loudly as
`unknown-name` (a visible error chip), never as a silently wrong number.

### Adding `remark-directive` is a global parsing change

It changes parsing for *every* document, so text that merely looks like a
directive (`:::calendar{id=…}` with no `documentId` in scope, a stray
`:foo[bar]`) would become a node nothing handles and render as **nothing** —
silently deleting content that renders fine today. `remarkCalc` therefore
restores every directive it does not claim to its literal source text.

### The sanitizer boundary

`rehypeSanitize` drops unlisted tags and `rehypeSanitizeContent` filters
`className` on every element through the raw-HTML allowlist. So:

- `remarkCalc` emits `<vault-calc data-calc-key>` and nothing else. The tag is
  allowed in `safeHtmlSchema`, with the attribute scoped to that tag rather than
  added to `"*"`.
- Every contract class is applied by `CalcValue`/`CalcBlock`, which run *after*
  the rehype pipeline — so calc needs no `lib/html-class.ts` entry and authored
  raw HTML cannot mint its classes.

Worst case for authored raw HTML writing `<vault-calc data-calc-key="…">` is
re-displaying a value already computed in the *same* document; the lookup map is
built per render and reaches no private or cross-document data.

`lib/markdown/calc-pipeline.test.ts` guards this end to end, including that the
schema addition stayed narrow (an unknown `<vault-danger>` is still stripped).

### Collapsible blocks

`:::calc{collapsed}` renders as native `<details>` — no JavaScript, no stored
state. The flag is the *authored default*, exactly like `<details open>`; a
reader's toggle is ephemeral and resets on reload. That is correct rather than a
shortcut: a viewer cannot edit the document, so their fold should not outlive
their visit. An editor toggling it would write one word to the markdown, which
is a normal edit — that control is not built yet.

## 9b. Slice 3 Implementation Notes

### What shipped

`fx_rates` (migration `0021`), `lib/calc/fx.ts` (pure triangulation),
`lib/fx/provider.ts` (the `FxProvider` interface + Frankfurter/ECB), and
`server/fx-rates.ts` (cache + refresh). `MarkdownDocument` takes an `fxTable`
prop; the five server surfaces that render a whole document fetch it, and the
doc page also threads it into `MarkdownEditor` so an author's read-mode preview
shows the same figures a reader gets.

### Latency: a render never waits on the provider

If any table is cached it is returned immediately and the refresh is *not*
awaited. Only a completely cold database blocks, because otherwise conversion
could never start working. `MAX_CACHE_AGE_MS` (6h) is what stops a re-fetch on
every render during the window between "today" and ECB's next publication —
without it, `rate_date != today` would trigger a request every page load, every
weekend.

Verified live: one cached table (29 pairs, one `fetched_at`) survived many page
loads.

### Provenance cites the LAST conversion

Found by looking at the rendered page, not by a test. Showing the *first*
conversion annotated a `{as=USD}` figure with the EUR->CAD rate from an earlier
step of the same expression, and made a round trip (`(rent in USD) in CAD`)
cite its outbound leg for an inbound result — a rate that does not explain the
number beside it is worse than no rate.

The last conversion is the one that produced the currency on screen. An
expression mixing three currencies still has no single honest one-line rate, so
only the final hop is claimed.

### `{as=XXX}` fails soft

When no rate is available the value renders in its own currency rather than
becoming an error: the figure is still correct, just not re-denominated, and a
display hint must never invalidate a sound number. Like `dp`, it never touches
the bound value — a downstream total reads the original.

### Verified against live rates

With ECB 2026-09-08 (EUR base: USD 1.1614, CAD 1.6033, JPY 179.2):

```txt
300 EUR in CAD            -> CA$480.99
1200 CAD * 3 + 300 EUR    -> CA$4,080.99   (left operand decides: CAD)
   same, {as=USD}         -> $2,956.19
1200 CAD in USD           -> $869.26
(1200 CAD in USD) in CAD  -> CA$1,200.00   exact round trip
1200 CAD in JPY           -> ¥134,123      (zero minor units)
1200 CAD in MGA           -> missing-rate  (ECB does not carry ariary)
```

The exact round trip is the signal worth keeping: 20-digit division precision
survives a there-and-back conversion with no drift.

## 9c. Slice 4 Implementation Notes

### The inline contribution point

`components/markdown/live-calc.ts` is the inline half the registry was missing.
`live-blocks.ts` replaces whole line ranges with block widgets; an inline value
needs `Decoration.replace` over a mid-paragraph range, revealed the moment the
cursor touches it. Same `StateField<DecorationSet>` shape, rebuilt on document
*and* selection changes — selection matters because moving the cursor into a
value is what reveals its source.

### Two locators, one resolver

Read mode locates occurrences by parsing with remark; that is far too expensive
per keystroke, so Live mode uses a regex scan (`lib/calc/scan.ts`) plus
CodeMirror's syntax tree for code exclusions.

Two locators is a drift risk, contained two ways:

1. `lib/calc/scan.test.ts` runs both over a shared corpus and asserts they find
   the same occurrences in the same order.
2. Both hand their occurrences to the **same** `resolveCalcOccurrences`
   (`lib/calc/resolve.ts`), and both draw from the same `calcValueMarkup`. So
   evaluation, formatting, state, provenance, and DOM structure have exactly one
   implementation each.

`resolve.ts` was split out of `calc-document.ts` for this: the resolver is pure
and markdown-free, so importing it into the editor does not drag remark along.

### Offset order is document order

In the editor the document is one flat text, so sorting occurrences by offset
gives the binding order directly — block statements and inline values interleave
by position exactly as a reader meets them. No piece model is needed.

### Widget equality is by content

`CalcInlineWidget.eq` compares rendered content, not identity. Every edit
re-resolves every value in the document; without content equality, every widget
on the page would be torn down and rebuilt on each keystroke.

### Blocks render as the Read-mode card in Live mode

`CalcBlockWidget` is a `Decoration.replace({ block: true })` over the fence
range, drawing the same `.vault-calc-block` definition list a reader gets —
names and figures in a grid with the `=` aligned down the block — and revealing
its source when the cursor enters, matching the callout and table specs.

An in-place variant was tried (statement lines left as real text with the value
appended, fences hidden behind a label) to make clicking work. It did make the
cursor behave, but at the cost of the design: no card, no aligned `=`, source
instead of `name = value`. **The two are separable and were wrongly traded
against each other** — the card is back, and the cursor problems are addressed
directly, below.

An authored `{collapsed}` block still shows its rows in the editor with a
`collapsed for readers` marker: the fold is for readers, and hiding declarations
from the person writing them would make the block impossible to work on.

### Two hazards a block widget carries

**A block widget must never carry vertical margin.** CodeMirror measures it with
`getBoundingClientRect()`, which excludes margins, so the `margin: 1rem 0` on
`.vault-calc-block` was invisible to the height map and **every line below the
block in the document** sat 32px lower than CodeMirror believed — clicks landed
on the wrong line for the rest of the page, not just inside the widget. The
widget renders the card inside a `.vault-cm-calc-block-frame` that carries the
gap as padding. `live-blocks.ts` has `applyStableBlockWidgetSpacing` for the same
reason; anything reaching for `Decoration.replace({ block: true })` must do one
or the other.

**A replace widget is opaque to the cursor.** CodeMirror cannot know which
source character a pixel inside a widget stands for, so every click resolves to
the widget's `from` or `to` — clicking the row you meant to edit dumps you at the
top or bottom of the block. Each rendered row corresponds to exactly one
statement line, so the widget can do better: a `mousedown` handler records which
row was pressed, and a `mouseup` handler moves the cursor to the end of that
row's source line — but only when the selection is empty, i.e. it was a click
rather than a drag. Recording on mousedown and acting on mouseup is what keeps
CodeMirror's own selection handling, and therefore drag-select, untouched.


## 9d. Slices 5 and 6

### Document settings live in frontmatter, not extension state

```md
---
calc_currency: USD
calc_rate_date: 2026-09-08
---
```

The plan originally put these in `document_extension_states`. Frontmatter is
better, and the reason is what they *are*: a pinned rate date is not a view
preference, it is the claim that makes a report reproducible and auditable, so
it must travel with the document, survive export, and be visible in source.
"This report is denominated in USD" is equally authorial.

This does not weaken the invariant that conversion never rewrites the markdown:
authored amounts are untouched, only the lens over them is declared.
`lib/content-metadata.ts` preserves unknown frontmatter keys, so these survive
edits made through the Properties UI.

### Precedence

```txt
{as=XXX}            explicit per value          wins
in XXX              explicit in the expression  next
calc_currency       document default            last
```

Anything the author spelled out beats a document-wide preference. Without the
middle rule, `:calc[rent in EUR]` inside a `calc_currency: CAD` document would
convert to EUR and then get silently dragged back to CAD. Found by an agent
action test, not by design.

`calc_currency` is read inside `MarkdownDocument` from its own markdown, so
every surface honours it including previews and embeds. `calc_rate_date` cannot
work that way: it decides which table to *fetch*, which happens before render,
so the pages parse it. In Live mode a changed currency re-denominates as you
type; a changed pin takes effect on the next load.

### A pinned past day is never re-fetched

Settled history does not change, so `getFxRateTable` treats any cached table for
a past target as current regardless of age. Without this a pinned report would
re-request its day's rates every six hours forever.

### Agent actions

`vault.calc.listValues` returns the document's settings, its bindings, and every
value with its formatted result, state, and provenance.
`vault.calc.evaluate` runs an ad-hoc expression against the names the document
binds, without editing it.

Both are read-only. The point of returning *formatted results* rather than raw
inputs is that the model should not re-do the document's arithmetic: the
document already states its own figures, exactly, and an LLM re-adding them is a
new opportunity to be wrong.

Rates reach handlers through a new `context.fx.getTable()`, lazy so an action
that never converts pays nothing. It sits behind **no permission**
deliberately: `fx_rates` is provider-sourced public reference data with no
owner, so gating it would be theatre.

## 9e. Slice 7 Implementation Notes — operand autocomplete

`components/markdown/calc-completions.ts`, registered as one more source in the
editor's single `autocompletion({ override })` list. It therefore reuses the
wiki-link/asset/slash tooltip wholesale: keyboard navigation, fuzzy filtering,
match highlighting, and styling all come free, and there is no second popup to
keep in visual sync.

### Position decides what may be completed

A menu that offered all 160-odd ISO codes beside every bound name at every
cursor would be noise, and most of those options would not *parse* where they
were offered. The grammar is small enough to do better, and its own
disambiguation rule (`lib/calc/currency.ts`) does most of the work: an uppercase
token is money, a lowercase one is an identifier.

| Left of the token | Offered |
|---|---|
| `… in` / `… to` | currencies only — the parser *requires* a code there |
| a bare amount, e.g. `1200 ` | currencies only — an identifier cannot follow a number |
| anything else | bound names + functions; currencies once the token is uppercase |

So `re` offers `rent` and never `Real`; `CA` offers `CAD`. The bare-amount test
carries a leading boundary so `rent2 ` reads as a name, not an amount —
without it every name ending in a digit would flip the menu to currencies.

`validFor` re-filters as the token grows, but **re-queries when the token
crosses the case boundary**: an empty token carries no currencies, so `C` has to
re-ask rather than filter a list that never contained `CAD`. That is a change in
which options *exist*, not merely which ones match.

### Scope is positional, like the evaluator's

Names come from the real `evaluateDocument`, run over the occurrences whose
`sourceFrom` lies above the statement being edited — so the menu holds exactly
what the evaluator would hold at that point. A name bound below is not offered
(it would render `unknown-name` the instant it was accepted), and neither is one
whose own binding expression failed, because a failed binding does not bind.
Pattern-matching for `name =` would have got both wrong.

This is why `locateOccurrences` became the exported `locateCalcOccurrences` and
gained `sourceFrom`. Every statement in a block previously reported the block's
own `from` — fine for the decoration, which covers the whole block, but it makes
"which names are bound above this line" collapse to all-or-nothing.

Each name carries its current value as the hint (`rent — CA$1,200.00`), in the
currency it was bound in. A document-level `calc_currency` may re-denominate it
on the page; the hint answers "what did I call `1200 CAD`?", which is the
question a half-typed name is asking.

### Where it opens

Inline `:calc[…]` (matched on the line, since expressions cannot span lines) and
`:::calc` block bodies (via `findCalcBlockBody`, which excludes both fences — a
cursor on `:::calc` is on the fence, not in a statement). Never inside inline or
fenced code, where the syntax is quoted rather than meant.

Gated on the calc extension but **not** on the slash-menu setting: these are the
document's own names, and an author who never opens an insert menu still needs
them spelled correctly.

## 10. Open Questions

- Should `:calc[rent = 1200 CAD]` render as `CA$1,200.00` or
  `rent = CA$1,200.00`? The first reads better in prose; the second is
  self-documenting when a reference appears 20 lines later. Possibly a
  per-document setting; pick one first.
- Cross-document references (`[[doc#rent]]`) — deferred. Drags permission checks
  and cache invalidation into every render.
- Should calc values be included in version history / restore points? Following
  the calendar precedent: not initially.
