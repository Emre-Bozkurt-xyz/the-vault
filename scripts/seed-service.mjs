#!/usr/bin/env node
// Idempotent bootstrap for a `services` row + its principal `users` row + an
// initial `service_token` (Den embed bridge, docs/DEN_EMBED_BRIDGE.md §C.8,
// "Design settled 2026-07-27" — "Approval surface: seed script now, admin
// page later"). This is v1's ONLY way to approve a service: promoting a
// registered `mcp_clients` row into a `services` row and minting its bearer
// credential is a script run until `/dashboard/admin/services` exists
// (tracked as future work, not built here).
//
// Usage:
//   node scripts/seed-service.mjs --slug den --name "Den" [--icon "💬"]
//     [--label "initial token"] [--oauth-client-id <mcp_clients.id>]
//
// Re-running with the same --slug is a no-op that prints the existing
// service's id (idempotent bootstrap). Pass --new-token to mint an
// additional service_token for an already-seeded service (e.g. after losing
// the original plaintext) without touching the principal or existing tokens.
//
// The principal user this script creates must NEVER be able to sign in:
//   - Its email lives under the `.invalid` TLD (RFC 2606: reserved, and
//     guaranteed to never resolve or be issued to anyone), so no GitHub/Google
//     account can ever present it as a verified email.
//   - No `accounts` row is created for it, so Auth.js's OAuth sign-in flow
//     (`adapter.getUserByAccount`) never finds a linked provider account for
//     it in the first place.
//   - Verified against auth.ts: this app sets no `allowDangerousEmailAccountLinking`
//     (confirmed via `docs/04_AUTH_AND_PERMISSIONS.md` §4, "Do not enable
//     global allowDangerousEmailAccountLinking without a specific security
//     review" — it isn't enabled anywhere in this codebase), so even in the
//     hypothetical where an attacker could get an OAuth provider to vouch for
//     an `.invalid` email (not possible in practice), Auth.js's default
//     behavior refuses to silently link a new OAuth account to an existing
//     user by matching email — sign-in would still fail closed.
//   - Session strategy is `"database"` (auth.ts), so without a `sessions` row
//     (only ever created through a completed sign-in) there is no other path
//     to a session for this user at all.

import { createHash, randomBytes } from "node:crypto";

import nextEnv from "@next/env";
import postgres from "postgres";

nextEnv.loadEnvConfig(process.cwd());

const args = parseArgs(process.argv.slice(2));
const slug = args.get("slug");
const displayName = args.get("name");
const icon = args.get("icon") ?? null;
const label = args.get("label") ?? "initial token";
const oauthClientId = args.get("oauth-client-id") ?? null;
const mintAdditionalToken = args.has("new-token");

if (!slug || !displayName) {
  console.error(
    "Usage: node scripts/seed-service.mjs --slug <slug> --name <display name> [--icon <emoji>] [--label <token label>] [--oauth-client-id <mcp_clients.id>] [--new-token]",
  );
  process.exit(1);
}

if (!/^[a-z0-9][a-z0-9-]{1,62}$/.test(slug)) {
  console.error("--slug must be lowercase alphanumeric with hyphens (e.g. 'den').");
  process.exit(1);
}

const databaseUrl =
  process.env.DATABASE_URL ?? "postgres://vault:vault@localhost:5432/vault";
const sql = postgres(databaseUrl, { max: 1 });

try {
  const [existing] = await sql`
    select id, principal_user_id
    from services
    where slug = ${slug}
    limit 1
  `;

  if (existing) {
    console.log(`Service "${slug}" already exists (id=${existing.id}). No changes made.`);

    if (mintAdditionalToken) {
      const token = await mintServiceToken(sql, existing.id, label);
      printToken(existing.id, existing.principal_user_id, token);
    } else {
      console.log("Pass --new-token to mint an additional service_token for it.");
    }

    process.exit(0);
  }

  // RFC 2606 reserved TLD: guaranteed to never resolve or be issued to
  // anyone, so no OAuth provider can ever vouch for this address as verified.
  const sentinelEmail = `${slug}@services.vault.invalid`;
  const username = `svc-${slug}`;

  const result = await sql.begin(async (tx) => {
    const [user] = await tx`
      insert into users (name, email, username, role)
      values (${displayName}, ${sentinelEmail}, ${username}, 'user')
      returning id
    `;

    // Deliberately no INSERT into accounts here — that's the load-bearing
    // omission that keeps this principal from ever completing an OAuth
    // sign-in (see the file header for the full auth-path verification).

    const [service] = await tx`
      insert into services (slug, display_name, icon, oauth_client_id, principal_user_id)
      values (${slug}, ${displayName}, ${icon}, ${oauthClientId}, ${user.id})
      returning id
    `;

    return { userId: user.id, serviceId: service.id };
  });

  const token = await mintServiceToken(sql, result.serviceId, label);

  console.log(`Created service "${slug}".`);
  printToken(result.serviceId, result.userId, token);
} finally {
  await sql.end();
}

async function mintServiceToken(db, serviceId, tokenLabel) {
  const plaintext = `vst_${randomBytes(32).toString("base64url")}`;
  const tokenHash = createHash("sha256").update(plaintext).digest("hex");

  await db`
    insert into service_tokens (token_hash, service_id, label)
    values (${tokenHash}, ${serviceId}, ${tokenLabel})
  `;

  return plaintext;
}

function printToken(serviceId, principalUserId, token) {
  console.log(`  serviceId:        ${serviceId}`);
  console.log(`  principalUserId:  ${principalUserId}`);
  console.log(`  service_token:    ${token}`);
  console.log(
    "\nThis token is shown ONCE and is not recoverable — store it now (e.g. in the calling service's secrets). Only its SHA-256 hash is kept in the database.",
  );
}

function parseArgs(argv) {
  const map = new Map();

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];

    if (!arg.startsWith("--")) {
      continue;
    }

    const key = arg.slice(2);
    const eqIndex = key.indexOf("=");

    if (eqIndex !== -1) {
      map.set(key.slice(0, eqIndex), key.slice(eqIndex + 1));
      continue;
    }

    const next = argv[i + 1];

    if (next !== undefined && !next.startsWith("--")) {
      map.set(key, next);
      i += 1;
    } else {
      map.set(key, "true");
    }
  }

  return map;
}
