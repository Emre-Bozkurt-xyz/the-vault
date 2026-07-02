# Polish, Hardening, and CSS Snippets Plan

## 1. Goal

Two connected outcomes:

1. Mature the existing rendering/styling/security structure so it can safely
   carry user-authored CSS.
2. Implement **snippets**: user-defined CSS rules that style the author's
   documents, and that other viewers (public or explicitly shared) also see
   applied — without any possibility of a malicious snippet harming viewers.

Target checkpoint:

```txt
A document owner can author a CSS snippet in a dedicated editor with live
preview and server-side validation, attach it to their documents, and every
permitted viewer of those documents sees the styling applied — while the
snippet is provably unable to touch app chrome, other tabs/pages, the viewer's
session, or the network, and every viewer can turn custom styling off.
```

This plan builds on:

```txt
components/markdown/MarkdownDocument.tsx   (render pipeline + sanitize schema)
lib/html-style.ts                          (existing inline-style allowlist)
app/globals.css                            (all vault-md-* / callout styling)
db/schema.ts                               (documents, permissions, user_settings)
docs/13_SETTINGS_AND_EXTENSION_BROWSER_PLAN.md (settings modal shell)
docs/14_METADATA_TAGS_SEARCH_PLAN.md       (gallery/public content patterns)
```

---

## 2. Current-State Audit — What Is Lacking

This section records the review findings that motivate Phase 0. Items marked
**[blocker]** must land before any user CSS ships.

### 2.1 Security / rendering findings

- **[blocker] No CSP or security headers anywhere.** `next.config.ts` sets
  only `output: "standalone"`; there is no `middleware.ts`, no
  `Content-Security-Policy`, no `X-Frame-Options`/`frame-ancestors`, no
  `X-Content-Type-Options`, no `Referrer-Policy`. The workspace is currently
  frameable (clickjacking) and there is no style/script source policy to
  anchor snippet serving on.
  **DONE (Phase 0):** `proxy.ts` (Next 16 middleware) now emits an enforced CSP
  (`frame-ancestors`/`object-src`/`base-uri`/`form-action`), a report-only
  strict nonce policy (`lib/security/csp.ts`), and `nosniff`/`X-Frame-Options`/
  `Referrer-Policy`/`Permissions-Policy`.
- **[blocker] `className` is allowed on `*` in `safeHtmlSchema`.** User raw
  HTML can borrow *any* class that exists in the compiled stylesheet. That
  includes Tailwind utilities emitted for app chrome (`fixed`, `inset-0`,
  `z-50`, `bg-background`, …) and app component classes
  (`vault-calendar-overlay`, `callout`, `vault-md-hidden-anchor`). A public or
  shared document can therefore already paint a full-viewport overlay inside
  the workspace shell or on `/public/[slug]` — UI spoofing/redressing against
  other viewers. This is exactly the class of attack snippets must prevent, and
  it exists today without snippets.
- `style` is allowed on `*` and sanitized by `rehypeSanitizeInlineStyles`
  (good), but the allowlist in `lib/html-style.ts` permits `display`,
  `opacity`, and unbounded `margin`/`width`/`height`. Harmless alone; combined
  with the class-borrowing hole above it strengthens overlay attacks. Fixing
  the class hole largely defuses this.
- External `http(s)` images are allowed in markdown (`allowedImageProtocol`).
  Accepted risk today (tracking pixels on public notes), but it sets the
  reference point for the snippet `url()` policy: CSS `url()` is *worse*
  (selector-conditional loading = reactive beacons), so snippets must not get
  it even though `<img>` has it.
- No rate limiting on content APIs (known: MCP plan Phase 4 pending). Snippet
  save/compile endpoints will be CPU-bearing (CSS parsing) and need limits from
  day one.

### 2.2 Structure / CSS architecture findings

- **`app/globals.css` is a ~2,900-line monolith** mixing design tokens, app
  chrome, workspace shell, markdown rendering, editor live-preview, callouts,
  asset embeds, and the calendar extension. There is no separation between
  "app-internal styling" and "document-content styling", which is precisely the
  boundary snippets must be scoped to.
- **The `vault-md-*` class vocabulary is already a de facto public API**
  (users can target it via the `className` allowance, and snippet authors will
  depend on it), but it is undocumented and unversioned. Renaming a class today
  silently breaks user content; with snippets it would break user styling at
  scale.
- **Rendering is duplicated across two pipelines**: `MarkdownDocument`
  (ReactMarkdown, 7 route surfaces) and the CodeMirror live-preview widgets in
  `live-blocks.ts` (which internally re-render through `MarkdownDocument`).
  Snippet injection needs a single, well-defined application point per surface,
  or live preview and read view will drift.
- Surface inconsistency: `/public/[slug]` adds `vault-public-markdown`,
  workspace doc view and share view wrap differently, preview cards
  (`WorkspaceDocumentPreviewCard`, gallery cards) render scaled-down markdown.
  There is no shared "document canvas container" component; snippets need one
  to hang the scope attribute and containment on.

### 2.3 Testing / verification findings

- **No automated tests exist.** `@playwright/test` is installed but there is no
  test script, and the sanitize pipeline (`safeHtmlSchema`,
  `sanitizeInlineStyle`, callout parsing, wiki/asset transforms) — the app's
  main security boundary — has zero regression coverage. A CSS sanitizer
  cannot responsibly ship without a test suite; neither should the current
  HTML sanitizer.

### 2.4 UX findings (polish targets)

- Settings modal has the right shape but no "user styling" home; appearance
  settings stop at theme choice.
- No per-viewer control over author-supplied presentation exists yet (needed
  as the snippet kill switch, and useful today for e.g. heavy public docs).
- Command palette actions are registered ad hoc via
  `lib/document-command-events.ts`; snippet actions (attach/detach/edit) should
  reuse that bus rather than invent another path.
- Authoring docs (`content/docs/`) have no "styling your notes" guide; the
  `vault-md-*` contract from 2.2 should be published there.

---

## 3. Product Direction — Snippets

### 3.1 What a snippet is

- A named, user-owned CSS stylesheet (source + server-compiled safe output).
- Attached explicitly to documents by the document owner (per-document
  attachment list, ordered).
- Applied for **every viewer of the document** in read/rendered contexts:
  workspace doc view, `/public/[slug]`, `/workspace/public/[slug]`,
  `/share/[token]`, and (Phase 4) the editor's Live mode.
- Scoped to the **document body only** (`.vault-markdown` subtree). Never the
  workspace shell, tabs, panels, dialogs, or any other page region.
- Viewers can always disable custom styling (per-document toggle + global
  preference).

Obsidian analogy: like Obsidian CSS snippets, but because Vault documents are
*shared*, snippets are a trust boundary, not a personal preference. Personal
(self-only) workspace snippets are a later phase (7.6).

### 3.2 Authoring targets

Snippet authors get a documented, stable selector surface:

```txt
1. The published vault-md-* / callout / vault-asset-* class contract
   (e.g. .vault-md-h1, .callout[data-callout="tip"], .vault-md-blockquote).
2. Author-defined hook classes in raw HTML, restricted to a `snip-` prefix:
   <div class="snip-hero"> ... </div>
3. Theme CSS variables (read-only usage inside the scope, e.g.
   color: var(--muted-foreground)), plus snippet-defined --snip-* variables.
```

### 3.3 Non-goals (V1)

- No arbitrary JavaScript, ever (unchanged extension-registry stance).
- No `url()` / external resource loading from snippet CSS (no fonts, no
  images, no beacons). Same-origin asset `url()` is a possible later phase.
- No snippet marketplace/gallery in V1 (owner-authored, owner-attached only).
- No per-element inline snippet editing; snippets are document-level sheets.
- Embedded documents (`![[doc]]`) do not carry their own snippets into a host
  document; only the host document's snippets apply (V1 decision).

---

## 4. Threat Model and Security Invariants

The author fully controls their document's *content* already, so styling
tricks inside the document body (hiding text, restyling their own prose) are
not an escalation. The boundary snippets must never cross:

| # | Invariant |
|---|---|
| S1 | Snippet CSS can never affect elements outside its document's body container (app chrome, other tabs, dialogs, sibling documents, other embeds). |
| S2 | Snippet CSS can never cause a network request (no `url()`, `image-set()`, `@import`, `@font-face`, `element()`, remote anything). |
| S3 | Snippet CSS can never execute script or interact with the DOM beyond declarative styling (no `expression()`, behaviors/bindings; serving path never injects unsanitized text into HTML). |
| S4 | Snippet CSS can never visually escape the document body region (no fixed/sticky positioning; container enforces `contain: layout paint style` + `isolation: isolate` so absolute positioning, z-index, filters, and transforms are trapped). |
| S5 | Raw user CSS is never served. Only server-compiled output — parsed, validated, scope-rewritten, and re-serialized from the AST — reaches any viewer, delivered under a CSP that permits it explicitly. |
| S6 | Viewers keep control: one-click per-document disable, a global "never apply others' custom styling" preference, and `prefers-reduced-motion` is honored by stripping/pausing snippet animations. |
| S7 | Bounded cost: size, rule-count, selector-complexity, and per-document snippet-count caps; compile endpoint rate-limited; compiled CSS cached. |

Notes on why these are sufficient:

- With S2 there is no exfiltration channel; conditional selectors (`:has()`,
  attribute selectors) have nothing to leak *to*.
- With S1+S4 there is no phishing/overlay channel against chrome; scope
  prefixing makes selectors unable to *match* outside, containment makes
  boxes unable to *paint* outside.
- Keyframe names are rewritten with a per-snippet prefix so snippets cannot
  hijack app `@keyframes` by name collision.
- `!important` is acceptable *inside* the scope (it cannot beat the boundary).

---

## 5. Storage

### 5.1 New tables

```txt
snippets
  id            uuid pk
  owner_id      -> users.id
  name          text (unique per owner, slug-like)
  description   text nullable
  source_css    text            -- what the author wrote (cap ~50 KB)
  compiled_css  text            -- sanitized, UNSCOPED canonical output
  compiled_hash text            -- content hash for cache keys
  status        'ok' | 'invalid' | 'disabled_by_admin'
  created_at / updated_at

document_snippets
  document_id  -> documents.id
  snippet_id   -> snippets.id
  sort_order   integer
  pk (document_id, snippet_id)
```

Decisions:

- `compiled_css` stores the sanitized sheet **without** the per-document scope
  prefix; the scope attribute value is stable (`data-vault-snippet-scope` set
  to the document id), so per-document scoping is applied at compile time per
  attachment or at render time by prefixing — chosen approach: compile once
  with a placeholder scope token and substitute the attribute value at render
  (pure string substitution of a validated uuid, never of user text).
- Deleting a snippet cascades `document_snippets`. Documents render fine with
  zero snippets.
- Caps enforced server-side: max snippets per user (e.g. 50), max attached per
  document (e.g. 5), max source size 50 KB, max compiled size 75 KB.

### 5.2 Viewer preference

New `user_settings` key `appearance/snippets`:

```txt
{ "applyAuthorStyling": true }   -- global opt-out when false
```

Per-document viewer disable is client-side session state (plus optional
persisted map later); anonymous viewers get a toggle on the public page.

---

## 6. The Sanitizer / Compiler Pipeline (server-only)

New module `lib/snippets/compile.ts` (+ `server/snippets.ts` for actions).

### 6.1 Parser

Add **`css-tree`** as a dependency (pure-JS CSS parser with lexer-based
property/value validation). Parsing and compilation run **only on the server**
(save-time and on-demand recompile), never in the viewer's browser.

### 6.2 Compile steps

```txt
1. Byte cap check (50 KB) → reject oversize.
2. Parse with css-tree in strict mode → syntax errors reject with positions
   (surfaced in the editor UI).
3. Walk at-rules:
   - allow: @media, @supports, @container, @keyframes, @layer
   - reject: @import, @font-face, @property, @page, @namespace, @charset,
     and any unknown at-rule.
   - @keyframes names rewritten to `snip-<snippetId>-<name>`; animation /
     animation-name values rewritten to match; references to unknown keyframe
     names rejected (prevents targeting app keyframes).
4. Walk selectors of every rule:
   - reject selectors containing :root, html, body, or any pseudo/functional
     form that could match above the scope.
   - rewrite every complex selector to
     `[data-vault-snippet-scope="%SCOPE%"] <selector>` (descendant prefix).
     `&`-less top-level nesting is flattened by css-tree before prefixing.
   - cap selector compound depth (e.g. 10) and total rule count (e.g. 1,000).
5. Walk declarations:
   - property must be on the snippet property allowlist (superset of
     lib/html-style.ts: typography, color, background-color/gradients,
     borders, outline, spacing, sizing, flex/grid layout, gap, border-radius,
     box-shadow, text-shadow, transform, transition, animation, filter,
     backdrop-filter, clip-path, list-style [no url], columns, cursor,
     opacity, visibility, overflow, object-fit/position, aspect-ratio,
     counters, content [string values only], custom properties `--snip-*`).
   - blocked properties: position values `fixed`/`sticky` (property allowed,
     those two values rejected), all `*-image`/`background` long/shorthands
     containing url()/image-set()/element()/paint(), `behavior`, `-moz-binding`,
     `pointer-events` outside the scope is impossible so it is allowed,
     `will-change` (perf), `contain`, `content-visibility`, `all`.
   - value scan: reject any declaration whose value contains url(, image-set(,
     element(, expression(, javascript:, or non-`--snip-` var() definitions...
     (custom property *reads* of theme vars are allowed; *definitions* must be
     --snip-*).
   - gradients (linear/radial/conic) are allowed since they load nothing.
6. Re-serialize from the AST (never echo input bytes). Store as compiled_css
   with %SCOPE% placeholder. Return structured diagnostics
   (errors + "dropped declaration" warnings) for the editor UI.
```

### 6.3 Tests (required, same phase)

Vitest (or node:test) unit suite: golden allowed/blocked cases for every
at-rule, escape-attempt selectors (`:root`, `html body`,
`[data-vault-snippet-scope] ~ *` — note: sibling combinators are safe once
prefixed, include as regression), url smuggling via comments/escapes/unicode
(`u\72 l(`), keyframe-collision, oversized input, and idempotent recompile.
This suite also becomes the home for the *existing* HTML-sanitizer regression
tests from Phase 0.

---

## 7. Application / Serving

### 7.1 Document canvas container

New shared component `components/markdown/DocumentCanvas.tsx`:

```txt
<div
  className="vault-document-canvas"
  data-vault-snippet-scope={documentId}   // only when snippets active
>
  <MarkdownDocument ... />
</div>
```

CSS for `.vault-document-canvas[data-vault-snippet-scope]`:

```css
contain: layout paint style;
isolation: isolate;
position: relative;
```

All read surfaces adopt it: workspace doc view, `/public/[slug]`,
`/workspace/public/[slug]`, `/share/[token]`. Preview cards and search results
do **not** apply snippets (explicit decision: consistent thumbnails, bounded
cost).

### 7.2 Style delivery

- Server components fetch attached snippets (`ok` status only, owner's
  attachment order), substitute the scope token, concatenate, and render a
  single `<style data-vault-snippets nonce={cspNonce}>` element adjacent to the
  canvas. React text rendering escapes `</style>` breakouts structurally, and
  the compiler additionally rejects `<` / `>` in output as belt-and-braces.
- CSP (from Phase 0) uses nonce-based `style-src`; the snippet style tag gets
  the request nonce like first-party styles.
- Compiled CSS is cached by `compiled_hash` (in-memory LRU first; HTTP caching
  irrelevant since it ships inline with the page).

### 7.3 Viewer controls

- A small "Custom styling by @author" pill near the document header on every
  surface where snippets are active; clicking toggles them off/on for that
  view (removes the `data-vault-snippet-scope` attribute + style tag
  client-side).
- Signed-in global preference `applyAuthorStyling=false` renders all surfaces
  without snippet fetch entirely.
- Snippet `animation`/`transition` declarations are wrapped at compile time in
  `@media (prefers-reduced-motion: no-preference)`.

### 7.4 Editor integration (later phase)

Live mode wraps `.cm-content` in the same scope attribute so authors see
snippets while writing; Source mode never applies them. The snippet editor
preview (8.2) reuses `DocumentCanvas`.

---

## 8. Creation & Management UX

### 8.1 Snippet manager

- New settings modal section **"Snippets"** (under Appearance group): list of
  owned snippets with status, size, attached-document count; create / rename /
  delete; enable-disable per snippet.
- Server actions in `server/snippets-actions.ts` gated by
  `requireActiveUser()`; rate-limited compile.

### 8.2 Snippet editor

- Full-tab workspace surface (like the doc editor, registered in the tab
  system + command palette): CodeMirror with CSS language mode
  (`@codemirror/lang-css`), manual save.
- Right panel: live preview of a sample document (or a picked owned document)
  rendered through `DocumentCanvas` with the *draft compiled* output —
  compile-on-debounce via a server action so the preview always shows the
  sanitized result, never raw CSS (the author sees exactly what viewers see,
  including dropped declarations).
- Inline diagnostics from the compiler (error line/col, "dropped: position:
  fixed (not allowed)" warnings).

### 8.3 Attaching to documents

- Document context panel (right panel) gains a "Styling" card: attach/detach
  owned snippets, reorder; visible to owners only.
- Command palette: "Attach snippet…", "Manage snippets" via the existing
  document-command event bus.
- Attachment implies consent to show to all viewers of that document; the
  publish flow warning (like private-asset warnings) is not needed since
  snippets carry no private data, but the share dialog gets a one-line note
  that custom styling is visible to recipients.

### 8.4 Documentation

- New `content/docs/` guide: "Styling your notes with snippets" — the
  supported selector contract (2.2 / 3.2), the allowlist summary, examples.
- The `vault-md-*` contract doc doubles as the internal stability policy:
  classes in the published contract require a deprecation path.

---

## 9. Phases

### Phase 0 — Hardening & structure prerequisites [blockers] — DONE

- [x] Security headers via `proxy.ts` (Next 16 middleware): enforced CSP
      (`frame-ancestors`/`object-src`/`base-uri`/`form-action`) + report-only
      strict nonce policy (`lib/security/csp.ts`), `nosniff`,
      `X-Frame-Options`, `Referrer-Policy`, `Permissions-Policy`.
- [x] **Closed the `className` hole**: `lib/html-class.ts` keeps only
      `snip-*`, `language-*`/`lang-*`, and the exact generated asset/wiki/region
      classes; wired via `rehypeSanitizeContent` in the extracted
      `lib/markdown/sanitize.ts`. Style allowlist audited alongside.
- [x] Test harness (vitest) + regression tests for the sanitize pipeline,
      class/style allowlists, CSP, and rate limiter (`npm test`).
- [x] Split `app/globals.css` into `styles/tokens.css` / `base.css` /
      `components.css` / `snippets.css` / `utilities.css` (import order
      preserved; build-verified). Finer split of `components.css` into
      markdown/editor/extensions is a safe follow-up.
- [x] `vault-md-*` selector contract doc: `docs/CSS_CONTRACT.md`.
- [x] Introduced `DocumentCanvas` (containment + scope) — adopted on all four
      read surfaces during Phase 3.
- [x] Rate-limit helper `lib/rate-limit.ts`.

### Phase 1 — Schema + compiler — DONE

- [x] Migration `0018_*`: `snippets`, `document_snippets`; caps in
      `lib/config/snippet-limits.ts`.
- [x] `css-tree` dependency; `lib/snippets/compile.ts` per section 6 with the
      golden allowed/blocked unit suite (`lib/snippets/compile.test.ts`).
- [x] `server/snippets.ts` + `server/snippets-actions.ts`: CRUD, compile-on-
      save, attachment CRUD with owner checks, rate-limited compile preview.
      (Recompile-all admin utility deferred.)

### Phase 2 — Manager + editor UX — DONE (editor is in-modal, not a full tab)

- [x] Settings modal "Snippets" section (list/create/delete/status +
      global styling opt-out).
- [x] Snippet editor with `@codemirror/lang-css`, debounced draft-compile
      preview against `DocumentCanvas`, inline diagnostics. Implemented inside
      the settings section rather than a standalone workspace tab (lower-risk
      V1; full-tab surface is a follow-up).
- [x] Authoring guide `content/docs/customization/css-snippets.md` rewritten
      for the shipped feature.
- [ ] Command palette + workspace-tab registration (follow-up).

### Phase 3 — Viewer application — DONE

- [x] Attached-snippet fetch + scoped nonce'd `<style>` injection on the four
      read surfaces; containment CSS on `DocumentCanvas`.
- [x] "Custom styling" pill + per-view toggle (`DocumentStyling`, works
      anonymous).
- [x] `appearance/snippets` global preference + settings toggle.
- [x] Document context-panel "Styling" card (`DocumentSnippetsPanel`).
- [x] Serve-path integration test (`lib/snippets/serve.test.ts`): an
      overlay/`:root`/`url()` escape attempt compiles to inert, document-scoped
      CSS. (Browser Playwright smoke still a follow-up; it needs a running
      dev server + auth session.)

### Phase 4 — Editor live mode + polish

- [ ] Apply snippets to Live mode editor content (scope on `.cm-content`
      wrapper); Source mode untouched; author preview parity.
- [ ] Authoring guide in `content/docs/`; examples gallery in the guide.
- [ ] Perf pass: compile cache, per-page style dedupe when multiple tabs show
      the same document.

### Phase 5 — Later / optional

- [ ] Same-origin asset `url()` allowance (`/api/assets/...` only, permission
      re-checked at render) for background images.
- [ ] Personal (self-only) workspace snippets with a broader allowlist.
- [ ] Public snippet sharing/gallery + admin moderation
      (`disabled_by_admin` status is already reserved), report flow.
- [ ] Per-viewer persisted per-document styling preferences.

---

## 10. Open Questions

- Should snippet attachment be mirrored in frontmatter (`snippets:` key) for
  portability, or stay purely relational? (Lean: relational only in V1;
  frontmatter mirroring adds sync complexity like tags did.)
- Does `/share/[token]` editor-role handoff show snippets during *editing* or
  only in read view? (Lean: read view only until Phase 4 lands.)
- Cap values (50 KB / 5 per doc / 50 per user) need confirmation once real
  snippets exist.
- CSP rollout: how long to run report-only in production before enforcing.
