# Vault Workspace UI Revamp Plan

## 1. Goal

Move Vault from a dashboard-and-document-app feel toward an Obsidian-like
workspace:

```txt
Vault should feel like an editor workspace first.
Documents, guides, settings, gallery pages, and public content are pages opened
inside that workspace.
The dashboard should stop being the center of the product.
```

The intended direction is:

- More editor/file-browser than Google Docs.
- More functional modern-minimalist than glossy web dashboard.
- Dense, dark, direct, and durable.
- Markdown documents feel like files in a vault.
- Navigation is persistent and compact.
- Browser URLs stay meaningful for the active page.

This is a large product/navigation change. Implement it in vertical slices and
keep the app deployable after each slice.

---

## 2. Current Problem

Current Vault has strong document/editor primitives:

- Markdown-native document source.
- Live preview.
- Wiki links and document embeds.
- Public note rendering.
- Sharing and collaboration.
- Official docs.
- Admin tools.

But the product shell still has older dashboard assumptions:

- `/dashboard` is the main navigation hub.
- Document pages still have a top app bar and side action area.
- Public/gallery-like discovery is not a first-class workspace page.
- Settings/admin/docs feel like separate web pages, not pages in an editor
  workspace.
- The app often feels like cards around an editor rather than a continuous
  workspace.

The new shell should make writing, opening, switching, and browsing content the
primary experience.

---

## 3. Product Model

### Workspace

The workspace is the persistent application frame.

It contains:

```txt
left icon rail
collapsible left browser panel
top page/tab bar
main active page area
optional right context panel
status/footer strip where useful
```

### Pages

A "page" is any piece of content or app surface that can be opened in the
workspace.

Initial page types:

```txt
document       private/shared editable document
public         published user document
guide          official documentation page
gallery        public content browser
settings       user/account settings
admin          admin surfaces, only for admins
new            empty workspace/new tab page
```

Future page types:

```txt
asset          uploaded image/file viewer
collection     curated content collection
profile        public user profile
search         saved search result page
tag            tag landing page
```

### Tabs

Tabs are a client-side workspace convenience.

Each tab should contain:

```ts
type WorkspaceTab = {
  id: string;
  type:
    | "document"
    | "public"
    | "guide"
    | "gallery"
    | "settings"
    | "admin"
    | "new";
  title: string;
  href: string;
  dirty?: boolean;
  pinned?: boolean;
};
```

Open tabs should be persisted in browser storage, probably `localStorage`, not
the database for the first implementation.

Important:

- The active tab determines the browser URL.
- Other open tabs do not need to be encoded into the URL.
- Refresh should keep the current route and restore the last known tab list if
  available.
- Closing the active tab should navigate to the nearest remaining tab or the new
  tab page.

---

## 4. URL Philosophy

Do not make the whole app live at only `/`.

Vault should have an Obsidian-like workspace feeling while preserving web-native
URLs.

Recommended rule:

```txt
The browser URL reflects the active page.
The tab list is client workspace state.
```

Examples:

```txt
/workspace                     empty/new tab workspace
/docs/abc                      active tab is private/shared document abc
/docs/abc?share=token          active tab is document abc through a share link
/gallery                       active tab is public gallery
/dashboard/settings            active tab is settings, eventually can become /settings
/docs/guides/wiki-links        active tab is guide page
/public/course-options         anonymous public canonical page
```

Avoid this as the main model:

```txt
/workspace?tabs=doc1,doc2,settings&active=doc1
```

Reasons:

- Long URLs.
- Private document IDs leak into copied workspace URLs.
- Browser history gets harder to understand.
- Sharing a single document link becomes ambiguous.
- Auth redirects and public previews become messier.

Query params are still useful for specific active-page state:

```txt
/docs/abc?share=token
/docs/abc?modal=share
/gallery?q=markdown&tag=guide
/gallery?type=document&sort=updated
```

Use query params when the state is useful to share or restore directly. Keep
pure workspace layout state in client storage.

---

## 5. Target Shell Layout

### Desktop

```txt
+--------------------------------------------------------------------------------+
| icon rail | left browser panel | tab bar                                        |
|           |                    |------------------------------------------------|
|           |                    | active page content              | right panel |
|           |                    |                                  |             |
|           |                    |                                  |             |
+--------------------------------------------------------------------------------+
```

### Left Icon Rail

Small vertical rail with icons and tooltips.

Initial icons:

```txt
Files       document tree/list
Search      global quick search
Gallery     public content browser
Graph       future backlinks/graph
Docs        official guides
Settings    account/app settings
Admin       admin only
```

The rail changes the left panel mode, not necessarily the active page. For
example, clicking Files opens the file panel; clicking a document inside it opens
a document page/tab.

### Left Browser Panel

Default mode: file/document browser.

Initial sections:

```txt
My documents
Shared with me
Published
Recent
```

Future sections:

```txt
Folders or collections
Tags
Saved searches
Assets
Templates
```

This should feel like an editor sidebar, not a dashboard:

- Compact rows.
- Active document highlight.
- Icon plus title.
- Optional small badges for public/shared/dirty.
- New document button in the panel header.
- Search/filter affordance.

### Top Tab Bar

Browser/editor-like tabs:

- One row.
- Compact.
- Active tab has a subtle background.
- Close icon on hover or always visible when active.
- Plus button opens a new tab page.
- Dirty indicator when a page has unsaved local changes.

Tabs should not be huge pills. They should feel like editor tabs.

### Main Content Area

The active page owns this area.

Document editor:

- No dashboard header.
- No big card around the editor.
- Title, toolbar, and editor live in the main workspace.
- Share/publish/history can move to top-right controls or right panel.

Gallery:

- Dense content browser.
- Filters/search at top.
- Grid/list toggle later.

Settings:

- Functional settings page inside workspace.
- Not a marketing-style page.

Guides:

- Can use the same Markdown renderer.
- Sidebar docs navigation can integrate with left panel or local guide nav.

### Right Context Panel

Contextual tools for the active page.

Document context:

```txt
Properties
Share
History
Backlinks
Outgoing links
Outline
Publish status
Collaboration/presence
```

Guide context:

```txt
Table of contents
Related guides
```

Gallery context:

```txt
Filter details
Selected tag info
```

Settings context:

```txt
Optional, probably hidden
```

The right panel should be collapsible and should remember its state.

---

## 6. Visual Direction

Target feel:

```txt
Obsidian-like editor workspace
Linux utility
functional modern-minimalist
dense dark UI
less web dashboard
```

Rules:

- Avoid large dashboard cards as the primary navigation surface.
- Use flatter panels with subtle borders.
- Reduce corner radius on structural panels to about `4px` to `6px`.
- Keep buttons and small controls allowed to be slightly rounder if they remain
  readable and ergonomic.
- Prefer compact icon buttons with tooltips for workspace controls.
- Preserve clear text labels where discoverability matters.
- Use theme tokens, not hard-coded one-off colors.
- Keep spacing dense but not cramped.
- Maintain strong keyboard accessibility.

Suggested CSS/token direction:

```txt
workspace background: app-level surface
panel background: slightly raised surface
panel border: low contrast
active row: muted foreground mix
active tab: panel background + top/side border
accent: current primary color or future user theme token
radius-panel: 4px or 6px
radius-control: existing button radius or 6px
```

Avoid:

- Floating card stacks.
- Oversized hero-like typography inside the app shell.
- Large rounded panels for structural workspace elements.
- Decorative gradients/orbs.
- Marketing-page composition inside authenticated workspace.

---

## 7. Navigation and Route Strategy

### Keep Existing Routes Working

Do not break current deep links:

```txt
/docs/[docId]
/public/[slug]
/docs
/docs/guides/[slug]
/dashboard/settings
/dashboard/admin
/dashboard/admin/docs
/share/[token]
```

Instead, gradually wrap signed-in app routes in the workspace shell.

### Dashboard Compatibility

`/dashboard` should stop being exposed as the main product surface, but it does
not need to disappear immediately.

Recommended transition:

```txt
Phase 1:
  /dashboard renders the new workspace home/new tab page.

Phase 2:
  Main navigation points to /workspace.
  /dashboard redirects to /workspace, or remains an alias.

Phase 3:
  Remove dashboard-specific UI once no code depends on it.
```

### Public Pages

Anonymous public routes should remain clean canonical pages:

```txt
/public/[slug]
```

If a signed-in user opens a public page from inside Vault, it can be opened as a
workspace tab, but the canonical anonymous route should still work for social
previews, messaging apps, and public sharing.

### Share Links

Keep:

```txt
/share/[token]
```

Current behavior still makes sense:

- Anonymous users see read-only access when allowed.
- Signed-in members using an edit link get routed to the workspace/document page
  with `?share=token`.

Later:

```txt
/docs/[docId]?share=token&modal=share
```

could be used if opening a modal from a link becomes useful.

---

## 8. Workspace State

### Client State

Store in `localStorage` first:

```txt
open tabs
active left panel mode
left panel collapsed width/state
right panel collapsed state
last active route
tab ordering
```

Do not store these in Postgres in the first pass. Database-backed workspace
layouts can come later if needed.

### Server State

Server remains authoritative for:

```txt
authentication
document permissions
document content
sharing
publishing
collaboration authorization
admin access
```

Client workspace state must never grant access. It only decides what UI is open.

### Refresh Behavior

On refresh:

1. Render the route normally.
2. Load stored tabs from localStorage.
3. Ensure the current route exists as a tab.
4. Focus that tab.

If no stored tabs exist, create a tab from the current route.

---

## 9. Component Architecture

Proposed files:

```txt
components/workspace/
  VaultWorkspaceShell.tsx
  WorkspaceTabBar.tsx
  WorkspaceTabStore.tsx
  WorkspaceIconRail.tsx
  WorkspaceLeftPanel.tsx
  WorkspaceFileBrowser.tsx
  WorkspaceRightPanel.tsx
  WorkspaceCommandButton.tsx
  WorkspaceNewTab.tsx
```

Potential route wrappers:

```txt
app/(workspace)/
  layout.tsx
  workspace/page.tsx
  docs/[docId]/page.tsx
  gallery/page.tsx
  settings/page.tsx
```

However, do not rush route group migration. A safer first slice is:

```txt
components/workspace/VaultWorkspaceShell.tsx
app/workspace/page.tsx
wrap /docs/[docId] manually
then move routes into a route group later
```

The shell should accept:

```ts
type VaultWorkspaceShellProps = {
  activePage: WorkspacePageDescriptor;
  leftPanel?: React.ReactNode;
  rightPanel?: React.ReactNode;
  children: React.ReactNode;
};
```

Page descriptor:

```ts
type WorkspacePageDescriptor = {
  type: WorkspaceTab["type"];
  title: string;
  href: string;
  icon?: string;
};
```

---

## 10. Document Editor Changes

### Current Document Page Pieces

Current document route includes:

- Back to dashboard link.
- Theme toggle.
- Visibility badge.
- Role badge.
- Share modal button.
- Editor area.
- History/publish/archive side panel.

### Target Document Page

Inside workspace:

```txt
top tab bar:
  document title as tab label

left file panel:
  document list

main:
  document title
  mode controls
  toolbar
  editor
  save/collab status

right panel:
  share
  history
  publish
  archive
  backlinks/outline later
```

Remove from main document page:

- Back to dashboard link.
- Big top header.
- Standalone page-like chrome.

Keep:

- Permission checks.
- Share modal.
- History.
- Publish/unpublish.
- Archive.
- Collaboration presence.

Potential refinement:

- Share button can live in the right panel header or as a compact top-right
  editor control.
- History can become a right-panel tab.
- Publish state can be a property row in the right panel.

---

## 11. Gallery Plan

The gallery is a new workspace page for browsing public content.

Initial v1:

```txt
/gallery
  lists published documents
  supports search by title/user
  uses existing public document data
  can reuse public/document preview cards if useful
```

Do not build the full booru-style tag system in the first UI shell pass.

Future gallery content types:

```txt
document
image
asset
collection
profile/user
```

Future gallery filters:

```txt
title
author
tag
content type
visibility
created date
updated date
score/rating
safe/nsfw/moderation status, if ever needed
```

The gallery should be designed as a place where tags and uploaded images can
land later, not as a blocker for the workspace shell.

---

## 12. Tags and Search Future Plan

This is intentionally a later feature.

The rough model should avoid storing arbitrary duplicate strings directly on
content.

Possible future schema:

```txt
tags
  id
  normalized_name
  display_name
  description
  category
  created_by
  created_at
  updated_at

tag_aliases
  id
  tag_id
  normalized_alias
  created_by
  created_at

content_tags
  id
  content_type
  content_id
  tag_id
  added_by
  created_at
```

Questions to decide later:

- Are tags global, per-user, or both?
- Can any user create tags?
- Who can merge aliases?
- Are tags moderated?
- Can private docs have private tags?
- Do public docs expose all tags or only public tags?
- Are ratings/scores user votes, owner metadata, or moderation metadata?
- Should tags support namespaces like `artist:`, `topic:`, `course:`,
  `status:`?

Do not implement tags as part of the initial workspace shell unless the scope is
explicitly reduced to a small metadata-only slice.

---

## 13. Uploaded Images and Assets Future Plan

Image/file storage has its own detailed plan:

```txt
docs/11_ASSET_STORAGE_AND_LIBRARY_PLAN.md
```

The workspace shell should leave room for:

- An `/assets` workspace page for the user's own uploaded content.
- A masonry-style grid for images and PDF/file cards.
- An asset detail/configuration panel.
- Explicit asset publishing controls.
- Public gallery integration for assets marked public by their owner.

Important product rule:

```txt
Publishing a document does not automatically publish its embedded assets.
```

Uploaded assets are private by default, stored in private R2 object storage, and
served through Vault permission checks. Do not block the workspace UI revamp on
asset storage, but do not reintroduce raw public storage URLs as the asset model.

---

## 14. Implementation Phases

### Phase A - Planning and UI Foundations

Status: not started.

Tasks:

- Finalize workspace route philosophy.
- Decide initial shell dimensions and breakpoint behavior.
- Add CSS variables for workspace panel radius and surfaces.
- Audit existing big-card UI and identify structural panels to flatten.
- Keep current routes working.

Exit criteria:

```txt
The team agrees on the shell model and the first implementation slice.
```

### Phase B - Workspace Shell Skeleton

Tasks:

- Add `components/workspace`.
- Implement `VaultWorkspaceShell`.
- Implement icon rail.
- Implement collapsible left panel.
- Implement top tab bar with localStorage state.
- Implement placeholder right panel.
- Add `/workspace` new tab page.
- Make `/dashboard` render or redirect to the new workspace home.

Exit criteria:

```txt
Signed-in users can open /workspace and see the new shell with persistent tabs.
No document editor behavior changes yet.
```

### Phase C - File Browser and New Document Flow

Tasks:

- Add document list query suited for sidebar display.
- Show My documents, Shared with me, Published, Recent.
- Add compact new document button.
- Open documents from the sidebar into tabs.
- Add empty/new tab actions:
  - New document
  - Open recent
  - Search
  - Gallery

Exit criteria:

```txt
The old dashboard document lists are no longer the primary way to open docs.
```

### Phase D - Document Editor Inside Workspace

Tasks:

- Wrap `/docs/[docId]` in the workspace shell.
- Remove dashboard-style header from document editor.
- Move share/history/publish/archive into right context panel.
- Keep collaboration, saving, share links, and permissions unchanged.
- Ensure mobile still works.

Exit criteria:

```txt
Opening a document feels like opening a file inside the workspace.
Existing document URLs and share links still work.
```

### Phase E - Settings, Guides, and Public Pages as Workspace Pages

Tasks:

- Make settings open as a workspace page/tab.
- Make official guides open as workspace pages when signed in.
- Keep anonymous `/docs` and `/docs/guides/[slug]` usable.
- Decide whether signed-in `/public/[slug]` opens inside workspace or remains a
  public page with an "Open in Vault" action.

Exit criteria:

```txt
Most non-auth surfaces can be opened as tabs without breaking public routes.
```

### Phase F - Gallery v1

Tasks:

- Add `/gallery`.
- List public documents.
- Add title/author search.
- Add content type filter, even if only documents exist initially.
- Reuse Markdown preview cards only where they fit the new dense style.
- Add route/query support for search filters.

Exit criteria:

```txt
Users can browse public Vault content without using the old dashboard public tab.
```

### Phase G - Right Panel Tools

Tasks:

- Add right-panel tabs or sections:
  - Properties
  - Share
  - History
  - Outline
  - Backlinks
- Move existing share/history UI into panel sections.
- Keep modals only where they improve focus.
- Add panel collapse persistence.

Exit criteria:

```txt
Document actions feel like editor tools, not page-level dashboard controls.
```

### Phase H - Visual Refinement Pass

Tasks:

- Reduce panel/card border radii globally where appropriate.
- Flatten dashboard-era surfaces.
- Normalize spacing density.
- Add tooltip behavior for icon rail and compact controls.
- Audit desktop and mobile screenshots.
- Run accessibility checks for keyboard navigation and focus rings.

Exit criteria:

```txt
Vault visually reads as one cohesive editor workspace.
```

### Phase I - Later Content Systems

These are not part of the first UI revamp implementation, but the shell should
leave room for them:

- Tag system.
- Uploaded document assets.
- Image paste/upload.
- Asset gallery.
- Scoring/rating/search metadata.
- Public profiles.
- Collections.

Exit criteria:

```txt
Separate design docs exist before schema work begins.
```

---

## 15. Mobile Strategy

Mobile should not try to exactly copy the desktop shell.

Recommended mobile behavior:

```txt
top compact bar
drawer for left browser
bottom or top tab switcher
main page full width
right panel becomes modal/drawer
```

Rules:

- Document editor gets maximum width.
- File browser opens as drawer.
- Right context tools open as modal/drawer.
- Tab bar may become horizontal scroll or a compact tab switcher.
- Avoid permanently visible side panels on phone widths.

---

## 16. Risks

### Routing Complexity

Risk:

```txt
The workspace shell could accidentally fight Next.js routing.
```

Mitigation:

- Keep active page URL real.
- Store only secondary tab list in localStorage.
- Do not hide document identity solely inside client state.

### Permission Leaks

Risk:

```txt
Sidebar/file browser accidentally lists inaccessible private documents.
```

Mitigation:

- All sidebar document queries must use existing server-side access rules.
- Treat workspace UI as display only, not authorization.

### Scope Creep

Risk:

```txt
Gallery, tags, and assets can balloon into a separate product.
```

Mitigation:

- Shell first.
- Gallery v1 only lists public docs.
- Tags/assets require separate design docs.

### Mobile Regression

Risk:

```txt
Desktop editor shell makes mobile cramped again.
```

Mitigation:

- Test mobile after each shell slice.
- Use drawers for panels.
- Keep editor full width.

### Collaboration Regression

Risk:

```txt
Moving document page chrome breaks Yjs mount/sync behavior.
```

Mitigation:

- Do not rewrite `MarkdownEditor` internals during the shell slice.
- Wrap existing editor first.
- Verify owner/editor/share-link collaboration after moving chrome.

---

## 17. Acceptance Criteria for Finished Revamp

The workspace revamp is done when:

- `/workspace` is the primary signed-in landing surface.
- `/dashboard` no longer exposes the old card-first document hub.
- Documents open as tabs in a persistent workspace shell.
- Browser URL reflects the active page.
- Open tabs survive refresh on the same browser.
- Left sidebar can browse and open documents.
- Gallery exists as a workspace page.
- Settings/guides/admin routes can be opened in the workspace model where
  appropriate.
- Document editor no longer feels embedded in a large page/card shell.
- Share/history/publish actions are available in context tools.
- Existing deep links still work.
- Public anonymous pages still work and keep OpenGraph previews.
- Share links still work.
- Collaboration still works.
- Mobile remains usable.

---

## 18. First Slice Recommendation

Start with this exact slice:

```txt
1. Add /workspace with the new shell skeleton.
2. Add top tab bar backed by localStorage.
3. Add left icon rail and placeholder file panel.
4. Make /dashboard render the same new-tab workspace home or redirect there.
5. Do not move /docs/[docId] yet.
```

Reason:

```txt
This proves the workspace model without touching the editor, collaboration,
permissions, or public routes.
```

Second slice:

```txt
Add real document sidebar data and open documents from the workspace.
```

Third slice:

```txt
Wrap /docs/[docId] in the workspace shell and move document actions into the
right context panel.
```

