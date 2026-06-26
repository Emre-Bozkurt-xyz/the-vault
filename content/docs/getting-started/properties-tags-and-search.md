---
title: Properties, tags, and search
slug: properties-tags-and-search
category: Getting started
order: 30
public: true
---

# Properties, tags, and search

Vault can index extra information about documents and assets so they are easier
to find later.

Documents store this information in Markdown frontmatter. Assets store it in
their asset detail panel. Both use the same tag vocabulary and both can appear
in search and the public gallery when they are visible to the current reader.

## Document properties

Open a document and expand **Properties** near the editor controls.

The Properties panel edits a YAML frontmatter block at the top of the document:

```yaml
---
tags: school math course_options
aliases:
  - Course planning
  - Math electives
summary: Notes for comparing course options.
status: draft
project: degree_planning
---
```

Vault hides this block in Live and Read mode, but Source mode shows the raw
Markdown.

## Indexed document fields

These fields are indexed today:

| Field | Format | Used for |
| --- | --- | --- |
| `tags` | Space-separated tags or a YAML list | Tag search, tag autocomplete, gallery filters |
| `aliases` | YAML list, one alias per line | Search terms for alternate names |
| `summary` | Short text | Search and public/document previews |
| `status` | Short text | Search, future workflow filters |
| `project` | Short text | Search, future project grouping |

Unknown frontmatter keys are preserved when Properties rewrites the known
fields, but they are not indexed yet.

## Tags

Tags are shared by documents and assets.

Use spaces between tags:

```yaml
tags: school math course_options
```

Use underscores for multi-word tags:

```yaml
tags: course_options final_project
```

Do not rely on punctuation. Tag input is normalized to lowercase letters,
numbers, and underscores. Hyphens become underscores. Commas and spaces split
the input into separate tags.

For example:

```txt
Course Options, math-notes
```

becomes:

```txt
course options math_notes
```

That creates three tags: `course`, `options`, and `math_notes`.

## Tag autocomplete

Tag fields suggest tags as you type.

Autocomplete is scoped:

| Scope | What it can suggest |
| --- | --- |
| Private document or asset editing | Tags from your owned assets and readable owned/shared documents |
| Public gallery search | Tags used by public documents and public assets |

This keeps private tags from leaking through public suggestions.

## Canonical tags

Vault stores each normalized tag once in a global tag table. Admins can manage
canonical tags from the admin tag page.

Canonical tags have:

| Field | Purpose |
| --- | --- |
| Slug | The stable normalized tag, such as `course_options` |
| Display name | A nicer label for UI surfaces |
| Category | One of `general`, `topic`, `person`, `place`, `project`, `technical` |
| Description | Optional explanation for what the tag means |

Aliases are admin-managed. They are meant for future cleanup and merge flows,
not for normal per-document editing.

## Asset metadata

Assets use the same tags as documents, but their metadata lives in the asset
library instead of Markdown frontmatter.

Asset metadata fields include:

| Field | Used for |
| --- | --- |
| Display name | Library names, gallery cards, autocomplete labels |
| Alt text | Image accessibility and fallback embed text |
| Description | Search and public gallery details |
| Tags | Shared document/asset tag search |
| Visibility | Whether the asset is private or public |

Private assets only show to users who can read the asset or a linked document.
Public assets can appear in the gallery.

## Search basics

Search accepts normal words and filter tokens.

Bare words are combined with AND behavior. Every bare word must match the item
somewhere.

This search:

```txt
math project
```

finds content that matches both `math` and `project`.

Bare words can match:

- document titles
- document Markdown content
- document aliases, summary, status, and project
- asset display names
- asset descriptions and alt text
- MIME type for assets
- owner name or username
- public slugs
- exact tag names

## Search tokens

Tokens are written as `key:value`.

| Token | Meaning | Examples |
| --- | --- | --- |
| `tag:` | Require one or more tags | `tag:math` |
| `tags:` | Same as `tag:` | `tags:school math` |
| `kind:` | Filter by content kind | `kind:document`, `kind:image`, `kind:pdf` |
| `type:` | Alias for `kind:` | `type:asset`, `type:note` |
| `owner:` | Match owner name or username | `owner:emre`, `owner:@lilem` |
| `visibility:` | Match visibility where that surface supports it | `visibility:public`, `visibility:private` |
| `sort:` | Request a ranking mode in gallery search | `sort:score`, `sort:trending` |

`tag:` and `tags:` consume a run of space-separated tags until another known
filter token appears.

This:

```txt
tags:school math kind:document
```

means:

- require `school`
- require `math`
- only show documents

## Kind values

Supported `kind:` and `type:` values depend on the search surface.

| Surface | Useful values |
| --- | --- |
| Public gallery | `document`, `doc`, `note`, `public`, `asset`, `image`, `pdf` |
| Asset library | `image`, `pdf`, `asset` |
| Ctrl/Cmd+K search | `document`, `guide`, `image`, `pdf`, `asset`, `public` |

When a kind does not apply to the current surface, Vault returns no matching
results instead of silently showing unrelated content.

## Sorting public content

The gallery supports two score-based sort tokens:

```txt
sort:score
sort:trending
```

`sort:score` uses all-time likes and views.

`sort:trending` favors activity from the last seven days with a small all-time
fallback.

These sort tokens only affect public gallery results. The private asset library
uses its own sort control.

## Search examples

Find public math content from a user:

```txt
math owner:@lilem visibility:public
```

Find public images tagged for a project:

```txt
kind:image tag:final_project
```

Find public course notes and rank by engagement:

```txt
course_options sort:score
```

Find documents with two tags:

```txt
tags:school math kind:document
```

Find PDFs with a specific tag:

```txt
type:pdf tag:assignment
```

Find content by an alternate document name:

```txt
Math electives
```

If that phrase exists in a document alias or summary, search can find it even
when the title is different.

## Public and private behavior

Search respects permissions.

Private metadata can be searched only by users who can already read that
document or asset. Public gallery search only uses public documents, public
assets, and public tag counts.

Publishing a document exposes its title, Markdown body, public slug, owner
display, tags, and indexed frontmatter fields to public gallery search.

Publishing an asset exposes its display name, description, alt text, owner
display, tags, kind, and MIME type to public gallery search.

## Current limitations

- Search tokens do not support quoted multi-word values yet.
- `owner:` is best used with usernames or one-word name fragments.
- Tag aliases are admin-managed and are not a normal user-facing editing
  workflow yet.
- Unknown document frontmatter keys are preserved, but not indexed.
- The public gallery search page is the richest public search surface. Some
  smaller workspace panels may still use lightweight client-side filtering.
