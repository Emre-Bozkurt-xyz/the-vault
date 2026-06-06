---
title: Safe HTML and embeds
slug: html-and-embeds
category: Security
order: 10
public: true
---

# Safe HTML and embeds

Vault allows a constrained subset of raw HTML in Markdown. The goal is to support useful document authoring without allowing arbitrary scripts or unsafe browser behavior.

## What is filtered out

Vault sanitizes rendered HTML. Unsafe content is removed or normalized, including:

- `<script>` tags
- event handler attributes such as `onclick`
- unsafe URL protocols such as `javascript:`
- unknown iframe providers
- iframe URLs that are not HTTPS
- broad browser capabilities not included in Vault's iframe allowlist

Inline styles are also sanitized. Only a constrained set of style properties is allowed by Vault's style sanitizer.

## Supported HTML

Common semantic and formatting elements are allowed, including:

```txt
div
span
section
article
aside
details
summary
mark
small
sub
sup
kbd
abbr
dl
dt
dd
time
figure
figcaption
img
iframe
```

## Iframe providers

Vault allows HTTPS iframe embeds from these providers:

```txt
youtube.com / www.youtube.com / youtube-nocookie.com
open.spotify.com
embed.tidal.com
player.vimeo.com
w.soundcloud.com
embed.music.apple.com
bandcamp.com
```

Provider paths are restricted. For example, YouTube embeds must use `/embed/...`, and TIDAL embeds must use supported media paths such as `/tracks/...`.

## Live mode caveat

Single-line iframe HTML can render in live mode. Multi-line raw HTML stays as source in live mode because CodeMirror has strict rules around replacing multiple editable lines with rendered blocks.

Use Preview or Split mode to inspect multi-line HTML rendering.
