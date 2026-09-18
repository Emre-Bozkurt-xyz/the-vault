---
title: Dictionary
slug: dictionary
category: Extensions
order: 20
public: true
---

# Dictionary

The Dictionary extension lets you define a term once and refer to it anywhere.
Hovering a defined term shows its definition in a small card, so a reader never
has to leave the sentence they are reading.

```md
The handler must be [[Idempotence|idempotent]], or a retry double-charges.
```

Turn it on from **Settings → Extensions** (see [[guide:extensions-and-settings]]).

## A definition is just a document

There is no separate place where definitions live. A definition is an ordinary
document:

| Part of a definition | Where it lives |
|---|---|
| The term | the document's **title** |
| Other names for it | the `aliases` property |
| The text shown on hover | the `summary` property |
| "this is a definition" | the `definition` tag |

Because a definition is a document, everything you already know still applies:
you can share it, publish it, restore an old version, embed it, and find it in
search.

## Defining a term while you write

Type `/def` in the editor. If you had a word selected, it arrives already filled
in. Give it a definition line and press **Enter**.

Vault then:

1. creates the definition document,
2. inserts a link to it where your cursor was,
3. leaves you exactly where you were typing.

It does not jump you to the new document. If you left the definition line empty,
the stub opens in a **background tab** so you can finish it later; if you filled
it in, nothing opens, because there is nothing left to write.

If a definition with that title already exists, Vault links to the existing one
rather than making a second. Your existing definition text is never overwritten.

### Defining a term you already mentioned

Writing `[[Backpressure]]` before anything defines it is fine — the link simply
shows as unresolved. Hover it and the card says *Not defined yet* with a
**Define** button, which opens the same dialog with the term filled in. No
retyping, and no second link inserted.

## Referring to a definition

Any wiki link to a definition document is a reference to it:

```md
[[Idempotence]]                      the term itself
[[Idempotence|idempotent]]           a different word in the sentence
[[Idempotence#Formal statement]]     a section of the definition
```

Type `/term` to search **only** your definitions, instead of every document.

### Aliases work as links

An alias on a definition resolves as a link target too. Give *Idempotence* the
alias `idempotent`, and `[[idempotent]]` finds it. A real document title always
wins over someone else's alias, and two documents claiming the same alias make
that link ambiguous — the same as two documents with the same title.

There is no guessing about word endings: `[[idempotency]]` will not find
*Idempotence* unless you list it as an alias. This is on purpose, so a link never
quietly points somewhere you did not choose.

## How defined terms look

A link to a definition sits in your prose slightly bolder than the text around
it. No underline, no colour, no icon — a paragraph can easily mention a dozen
defined terms, and anything louder turns prose into a warning label.

If that is still too much, set **Emphasize defined terms** to *First mention in a
document* on the Dictionary settings page. Later mentions stay linked and still
preview on hover; they simply read as ordinary text.

That setting describes how **you** read. It never changes what anyone else sees.

## The hover card

Hovering a defined term shows its `summary`. If a definition has no summary, the
card shows the start of its body instead — its first paragraph or list, never a
half-opened code block.

The card is scrollable when the text is long, and has an **Open** link to the
definition itself. You can move the pointer into the card to read or scroll it
without it closing.

A definition with neither a summary nor any body has nothing to show, so its
links render as plain wiki links until you write something.

Cards appear on every surface a document renders: while editing in Live mode, in
Read mode, and on published pages for readers without an account. They are a
pointer-device affordance, so they do not appear on touch — tapping the term
opens the definition.

## Keeping definitions together

By default `/def` files a new definition in the **same folder as the document you
are writing in**. To keep them in one place, choose a folder under **New
definition folder** on the Dictionary settings page.

There is a second way, which needs no setting at all: make a `Definitions` folder
and give it `definition` as a **default tag**. Everything you file there becomes
a definition automatically, with no properties to fill in. See
[[guide:folders-and-default-tags]].

If a folder you chose is later deleted or you lose access to it, `/def` quietly
falls back to the current document's folder rather than failing.

## Asking an assistant about your definitions

With Dictionary enabled, an AI assistant connected to your vault can:

- **list your definitions**, with their aliases and summaries — so it answers
  "what does X mean here" from your own glossary rather than from general
  knowledge;
- **list undefined terms in a document** — the wiki links that reach no
  definition, most-referenced first, which is a reading list of the gaps;
- **define a term**, optionally with its definition line. An existing definition
  is never overwritten.

## The `definition` tag

`definition` is a reserved tag that Vault gives meaning to, so it appears in your
tag list marked as a system tag. You can add it by hand in a document's
Properties, or let a folder supply it — both work, and both make the document a
definition.
