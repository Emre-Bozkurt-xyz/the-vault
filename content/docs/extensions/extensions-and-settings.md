---
title: Extensions and settings
slug: extensions-and-settings
category: Extensions
order: 10
public: true
---

# Extensions and settings

Extensions add optional capabilities to Vault — a calculator inside your prose, a
month calendar in a document, a dictionary of defined terms. They ship with Vault
and are **off by default**, so nothing appears until you turn it on.

## Opening settings

Press **Ctrl/Cmd+K** and run *Open settings*, or use the settings button in the
workspace sidebar.

The sidebar of the settings window lists Vault's own pages first — Account,
Workspace, Editor, Appearance, Snippets, Files & assets, Hotkeys, Core features,
Advanced. Below a divider comes the **Extensions** group.

## Turning an extension on

The **Extensions** page lists every extension with its description, the
permissions it asks for, and what it contributes (slash commands, document
blocks, workspace commands, agent actions). Each one has an **Enable** /
**Disable** button.

Enabling an extension takes effect immediately — its slash commands appear in any
editor you have open, and there is no need to reload.

## An extension's own settings

An enabled extension that has options gets **its own page** in the Extensions
group, listed by name under the Extensions page. A **Settings** button on the
extension's card jumps straight to it.

Extension pages are intentionally plainer than Vault's own settings pages. Every
change saves as you make it, and **Reset to defaults** at the bottom puts that
extension's options back to how they shipped.

Disabling an extension removes its page. Your settings are kept, so turning it
back on restores them.

## Enabled for authoring, not for reading

Turning an extension on affects what *you* can write. It does not change what
readers see:

- A `:calc` value someone wrote still shows its result to every reader.
- A definition still previews on hover for every reader, including someone
  reading a published page without an account.

This is deliberate. A document has to read the same way for everyone, whatever
each person has switched on for themselves. What the switch controls is whether
*you* get the slash commands, buttons, and blocks for writing that content.

## What is available

| Extension | What it does | Guide |
|---|---|---|
| Dictionary | Define terms as documents and hover to read them | [[guide:dictionary]] |
| Calc | Inline computed values and currency conversion in prose | [[guide:calc]] |
| Calendar | A month calendar of tasks and events inside a document | [[guide:calendar]] |
| Stickers | Place image assets freely on a document page | — |

## Agent actions

Several extensions contribute **agent actions**: operations an AI assistant
connected to your vault can run on your behalf, listed on the extension's card
under *Contributes*. They follow the same rule as everything else — an action
belongs to an extension, so it is only available while that extension is enabled
for your account, and it can only do what the extension's permissions allow.
