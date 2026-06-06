---
title: Sharing and permissions
slug: sharing-and-permissions
category: Collaboration
order: 10
public: true
---

# Sharing and permissions

Vault documents are private by default. Access is checked server-side for every document read or write.

## Roles

Vault supports three document roles.

| Role | Can read | Can edit | Can share | Can publish | Can archive |
| --- | --- | --- | --- | --- | --- |
| Owner | Yes | Yes | Yes | Yes | Yes |
| Editor | Yes | Yes | No | No | No |
| Viewer | Yes | No | No | No | No |

## Friends and sharing

You can search for users by nickname, username, or email when adding friends or sharing a document. Sharing stores permissions against the stable internal user ID, not the username.

That means users can change their username without breaking friendships, shared documents, or collaboration access.

## Public documents

Owners can publish selected documents. Published documents receive a stable public slug and are readable without signing in.

Unpublishing makes the document private again while keeping the slug reserved.

## Collaboration

Owner and editor sessions can connect to the collaboration server. Viewers can read the document but cannot join as editors.
