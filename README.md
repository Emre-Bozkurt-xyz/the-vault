# Vault

Vault is a self-hosted Markdown workspace for private notes, collaborative
documents, public publishing, and user-owned assets.

Live app:

```txt
https://vault.ems-place.com
```

## Why It Exists

I wanted to use an editor tailored to my needs, and also why not.
It combines an Obsidian-like workspace with server-enforced privacy, role-based
sharing, real-time Markdown collaboration, and private-by-default uploaded
content storage.

## What It Does

- Create private Markdown documents in a workspace with tabs and side panels.
- Edit in Source, Live, or Read mode using CodeMirror.
- Share documents with owner, editor, and viewer roles.
- Collaborate in real time through Yjs and Hocuspocus.
- Publish selected documents as public read-only pages.
- Upload images and PDFs to private Cloudflare R2 storage.
- Embed assets with controlled layout attributes and grouped image grids.
- Publish individual assets to the public gallery without publishing the
  documents that use them.

## Architecture

```txt
Browser
  -> Cloudflare DNS
  -> DigitalOcean VPS / Caddy
  -> FRP tunnel
  -> Mini-PC Docker Compose
     -> Next.js web app
     -> PostgreSQL
     -> Hocuspocus collaboration service
     -> Cloudflare R2 asset bucket
```

The app uses Next.js App Router, TypeScript, React, Tailwind, Auth.js,
PostgreSQL, Drizzle ORM, CodeMirror, Yjs, Hocuspocus, Docker Compose, and
private R2 object storage.

## Security Model

Private content stays private by default. Document and asset reads go through
server-side permission checks; inaccessible private resources return not-found
style responses instead of exposing existence. Public document publishing does
not publish embedded private assets. Assets become public only through explicit
asset publishing controls.

## Documentation

User guides live in `content/docs` and are rendered in the app under `/docs`.

- [Markdown basics](content/docs/getting-started/markdown-basics.md)
- [Wiki links and embeds](content/docs/getting-started/wiki-links-and-embeds.md)
- [Asset library](content/docs/assets/asset-library.md)
- [Asset embeds and layout](content/docs/assets/asset-embeds-and-layout.md)
- [Sharing and permissions](content/docs/collaboration/sharing-and-permissions.md)
- [Callouts](content/docs/customization/callouts.md)
- [Safe HTML and embeds](content/docs/security/html-and-embeds.md)

Engineering notes and implementation plans live in `docs/`:

- [Architecture](docs/02_ARCHITECTURE.md)
- [Data model](docs/03_DATA_MODEL.md)
- [Auth and permissions](docs/04_AUTH_AND_PERMISSIONS.md)
- [Editor and collaboration](docs/05_EDITOR_AND_COLLAB.md)
- [Deployment](docs/06_DEPLOYMENT.md)
- [Asset storage plan](docs/11_ASSET_STORAGE_AND_LIBRARY_PLAN.md)
- [Current codebase knowledge](docs/project-knowledge.md)

## Local Development

```bash
npm install
docker compose up -d postgres
npm run db:migrate
npm run dev
```

In another shell:

```bash
npm run collab
```

Open `http://localhost:3000`. In non-production, `/login` includes dev login
buttons so local work does not require OAuth setup.

Useful checks:

```bash
npx tsc --noEmit
npm run build
```

## Portfolio Summary

Built and deployed Vault, a self-hosted Obsidian-style document platform with
OAuth login, PostgreSQL persistence, server-enforced permissions, CRDT-powered
real-time Markdown collaboration, private R2 asset storage, and a Dockerized
home-lab deployment behind a public VPS edge.
