# Metadata, Tags, Search, and Popularity Plan

## Summary

Vault will use one shared metadata system for documents and assets. Documents
author metadata through Obsidian-style YAML frontmatter. Assets author metadata
through the asset detail panel. Both sync into normalized Postgres tables for
search, gallery filters, and future Ctrl+K search.

## Decisions

- Document properties live in Markdown frontmatter and are mirrored into
  database metadata tables.
- Asset tags live in the asset detail panel and use the same tag system.
- Tags are global canonical records.
- Tag input is space-separated: `forest research pine_forest` is three tags.
- Multi-word tags use underscores, Danbooru-style.
- Tag aliases exist in V1 but are admin-managed only.
- V1 tag categories are `general`, `topic`, `person`, `place`, `project`, and
  `technical`.
- Public documents and public assets expose tags and summaries by default.
- Search uses a mixed default query. Bare words are ANDed across searchable text
  and exact tag matches, while `tags:` starts a space-separated tag run until
  another known filter token or the end of the query.
- Supported V1 filter tokens are `tags:`, `tag:`, `kind:`, `type:`, `owner:`,
  `visibility:`, and `sort:`.
- Likes are signed-in only.
- Views are daily unique-ish counts.
- Public gallery shows likes, views, and score.
- Trending ranks recent engagement from the last seven days with a light
  all-time fallback.

## V1 Document Properties

Supported indexed frontmatter fields:

```yaml
---
tags: forest research pine_forest
aliases:
  - RSS notes
summary: Notes on scenario visualization.
status: draft
project: vault
---
```

Rules:

- `tags` may be a space-separated string or a YAML list.
- Unknown frontmatter keys are preserved but not indexed in V1.
- Malformed frontmatter should not destroy document content.
- Search and gallery read from normalized metadata tables, not from raw Markdown
  parsing at query time.

## Implementation Order

1. Add frontmatter/tag parsing utilities.
2. Add normalized schema for tags, document tags, asset tags, content metadata,
   likes, and views.
3. Sync document metadata on document save/collaboration store.
4. Sync asset tags on asset metadata save.
5. Add document Properties UI and asset tag editor.
6. Replace gallery filtering with metadata-backed search.
7. Add signed-in likes, daily unique-ish views, score, and trending sorts.
8. Add Ctrl+K readable-content search.

## Acceptance Criteria

- A document saved with `tags: forest research pine_forest` creates three
  canonical tags and links them to the document.
- Asset metadata can use the same tag vocabulary.
- Public search never leaks private-only tag counts or private content.
- Existing Markdown, asset rendering, sharing, and publishing behavior remains
  unchanged while metadata sync is added.
