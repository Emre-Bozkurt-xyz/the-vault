---
title: Folders and default tags
slug: folders-and-default-tags
category: Getting started
order: 40
public: true
---

# Folders and default tags

Folders group documents in the file browser, and they can do two things beyond
that: share everything inside them with someone, and give everything inside them
a set of tags.

## Working with folders

Use the file browser in the workspace sidebar. A folder's three-dot menu holds its
actions — create a document inside it, rename it, open its settings, delete it.
Drag a document onto a folder to move it, and drag folders into each other to
nest them.

Deleting a folder does **not** delete the documents inside it. They are unfiled
and stay in your vault.

## Which folder a document is in

Above a document's title, Vault shows the folder path it lives in, so two
documents that share a name are still tellable apart. Hovering a document's tab
shows the same path.

The path is plain text, not a row of links — the folder tree is one click away in
the sidebar, and a line of clickable crumbs above the title competes with the
title for attention.

## Folder settings

Open **Folder settings…** from a folder's menu. Everything here applies to every
document inside the folder, subfolders included.

### Default tags

Give a folder a set of tags, and every document inside it carries them.

This is how a `Recipes` folder can tag its contents `recipe` without you typing it
into each document, or how a `Definitions` folder makes everything inside it a
definition (see [[guide:dictionary]]).

Type tags separated by spaces, using underscores for multi-word tags. They save
when you leave the field.

**Inherited from above** shows tags a parent folder contributes. Edit those where
they are defined — on that parent.

### Sharing

Share a folder with someone as a **viewer** or **editor**, and they get that
access to everything inside it. See [[guide:sharing-and-permissions]].

## How inherited tags behave

A tag a document gets from its folder is **not** written into the document. It is
not in your Markdown and not in the `tags` property.

That means:

- **Searching and the gallery treat it as a real tag.** A document in a folder
  tagged `recipe` is found by searching `tag:recipe`.
- **The Properties panel shows it, and will not let you edit it.** Inherited tags
  appear as separate chips with a padlock, next to the tag field rather than in
  it. To remove one, move the document out of the folder — or change the tag on
  the folder, for every document at once.
- **Moving a document rewrites nothing.** Filing a document into a folder does not
  edit its text, and moving it out leaves no orphaned tags behind.
- **Exported Markdown does not carry them.** What you export is what you wrote.

A tag a document writes in its own properties *and* inherits from a folder stays
yours to edit — it shows in the tag field, not as a locked chip.

Only a folder's **owner** can set its default tags. Someone you have shared a
folder with as an editor can file documents into it, but deciding how your whole
subtree is tagged stays with you.
