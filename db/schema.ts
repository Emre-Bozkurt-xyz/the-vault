import type { AdapterAccountType } from "@auth/core/adapters";
import { relations, sql } from "drizzle-orm";
import {
  index,
  integer,
  primaryKey,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

export type DocumentRole = "owner" | "editor" | "viewer";
export type DocumentVisibility = "private" | "public";
export type UserRole = "user" | "admin";
export type OfficialDocStatus = "draft" | "published" | "archived";
export type FriendRequestStatus =
  | "pending"
  | "accepted"
  | "rejected"
  | "cancelled";

export const users = pgTable(
  "users",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    name: text("name"),
    email: text("email"),
    emailVerified: timestamp("email_verified", { mode: "date" }),
    image: text("image"),
    username: text("username"),
    role: text("role").$type<UserRole>().notNull().default("user"),
    bannedAt: timestamp("banned_at", { withTimezone: true }),
    bannedUntil: timestamp("banned_until", { withTimezone: true }),
    banReason: text("ban_reason"),
    profileCompletedAt: timestamp("profile_completed_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .default(sql`now()`),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .default(sql`now()`),
  },
  (table) => [
    uniqueIndex("users_email_unique").on(table.email),
    uniqueIndex("users_username_unique").on(table.username),
    index("users_name_idx").on(table.name),
    index("users_role_idx").on(table.role),
    index("users_banned_until_idx").on(table.bannedUntil),
  ],
);

export const accounts = pgTable(
  "accounts",
  {
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    type: text("type").$type<AdapterAccountType>().notNull(),
    provider: text("provider").notNull(),
    providerAccountId: text("provider_account_id").notNull(),
    refresh_token: text("refresh_token"),
    access_token: text("access_token"),
    expires_at: integer("expires_at"),
    token_type: text("token_type"),
    scope: text("scope"),
    id_token: text("id_token"),
    session_state: text("session_state"),
  },
  (table) => [
    primaryKey({
      columns: [table.provider, table.providerAccountId],
    }),
    index("accounts_user_id_idx").on(table.userId),
  ],
);

export const sessions = pgTable(
  "sessions",
  {
    sessionToken: text("session_token").primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    expires: timestamp("expires", { mode: "date" }).notNull(),
  },
  (table) => [index("sessions_user_id_idx").on(table.userId)],
);

export const verificationTokens = pgTable(
  "verification_tokens",
  {
    identifier: text("identifier").notNull(),
    token: text("token").notNull(),
    expires: timestamp("expires", { mode: "date" }).notNull(),
  },
  (table) => [
    primaryKey({
      columns: [table.identifier, table.token],
    }),
  ],
);

export const usersRelations = relations(users, ({ many }) => ({
  accounts: many(accounts),
  sessions: many(sessions),
}));

export const accountsRelations = relations(accounts, ({ one }) => ({
  user: one(users, {
    fields: [accounts.userId],
    references: [users.id],
  }),
}));

export const sessionsRelations = relations(sessions, ({ one }) => ({
  user: one(users, {
    fields: [sessions.userId],
    references: [users.id],
  }),
}));

export const documents = pgTable(
  "documents",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    ownerId: uuid("owner_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    title: text("title").notNull(),
    markdown: text("markdown").notNull().default(""),
    visibility: text("visibility").$type<DocumentVisibility>().notNull().default("private"),
    publicSlug: text("public_slug"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .default(sql`now()`),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .default(sql`now()`),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
  },
  (table) => [
    index("documents_owner_id_idx").on(table.ownerId),
    index("documents_visibility_idx").on(table.visibility),
    index("documents_updated_at_idx").on(table.updatedAt),
    uniqueIndex("documents_public_slug_unique").on(table.publicSlug),
  ],
);

export const documentPermissions = pgTable(
  "document_permissions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    documentId: uuid("document_id")
      .notNull()
      .references(() => documents.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    role: text("role").$type<DocumentRole>().notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .default(sql`now()`),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .default(sql`now()`),
  },
  (table) => [
    uniqueIndex("document_permissions_document_user_unique").on(
      table.documentId,
      table.userId,
    ),
    index("document_permissions_document_id_idx").on(table.documentId),
    index("document_permissions_user_id_idx").on(table.userId),
  ],
);

export const documentVersions = pgTable(
  "document_versions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    documentId: uuid("document_id")
      .notNull()
      .references(() => documents.id, { onDelete: "cascade" }),
    createdBy: uuid("created_by").references(() => users.id, {
      onDelete: "set null",
    }),
    title: text("title").notNull(),
    markdown: text("markdown").notNull(),
    reason: text("reason").notNull().default("auto"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .default(sql`now()`),
  },
  (table) => [
    index("document_versions_document_created_at_idx").on(
      table.documentId,
      table.createdAt,
    ),
    index("document_versions_created_by_idx").on(table.createdBy),
  ],
);

export const documentsRelations = relations(documents, ({ one, many }) => ({
  owner: one(users, {
    fields: [documents.ownerId],
    references: [users.id],
  }),
  permissions: many(documentPermissions),
  versions: many(documentVersions),
}));

export const documentPermissionsRelations = relations(
  documentPermissions,
  ({ one }) => ({
    document: one(documents, {
      fields: [documentPermissions.documentId],
      references: [documents.id],
    }),
    user: one(users, {
      fields: [documentPermissions.userId],
      references: [users.id],
    }),
  }),
);

export const documentVersionsRelations = relations(
  documentVersions,
  ({ one }) => ({
    document: one(documents, {
      fields: [documentVersions.documentId],
      references: [documents.id],
    }),
    author: one(users, {
      fields: [documentVersions.createdBy],
      references: [users.id],
    }),
  }),
);

export const friendRequests = pgTable(
  "friend_requests",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    requesterId: uuid("requester_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    recipientId: uuid("recipient_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    status: text("status").$type<FriendRequestStatus>().notNull().default("pending"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .default(sql`now()`),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .default(sql`now()`),
  },
  (table) => [
    uniqueIndex("friend_requests_requester_recipient_unique").on(
      table.requesterId,
      table.recipientId,
    ),
    index("friend_requests_requester_id_idx").on(table.requesterId),
    index("friend_requests_recipient_id_idx").on(table.recipientId),
    index("friend_requests_status_idx").on(table.status),
  ],
);

export const friendships = pgTable(
  "friendships",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userLowId: uuid("user_low_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    userHighId: uuid("user_high_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .default(sql`now()`),
  },
  (table) => [
    uniqueIndex("friendships_user_pair_unique").on(table.userLowId, table.userHighId),
    index("friendships_user_low_id_idx").on(table.userLowId),
    index("friendships_user_high_id_idx").on(table.userHighId),
  ],
);

export const officialDocs = pgTable(
  "official_docs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    slug: text("slug").notNull(),
    title: text("title").notNull(),
    category: text("category").notNull().default("Guides"),
    sortOrder: integer("sort_order").notNull().default(0),
    markdown: text("markdown").notNull().default(""),
    status: text("status")
      .$type<OfficialDocStatus>()
      .notNull()
      .default("draft"),
    createdBy: uuid("created_by").references(() => users.id, {
      onDelete: "set null",
    }),
    updatedBy: uuid("updated_by").references(() => users.id, {
      onDelete: "set null",
    }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .default(sql`now()`),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .default(sql`now()`),
    publishedAt: timestamp("published_at", { withTimezone: true }),
  },
  (table) => [
    uniqueIndex("official_docs_slug_unique").on(table.slug),
    index("official_docs_status_updated_at_idx").on(
      table.status,
      table.updatedAt,
    ),
    index("official_docs_category_sort_idx").on(table.category, table.sortOrder),
    index("official_docs_created_by_idx").on(table.createdBy),
  ],
);

export const officialDocsRelations = relations(officialDocs, ({ one }) => ({
  creator: one(users, {
    fields: [officialDocs.createdBy],
    references: [users.id],
  }),
  updater: one(users, {
    fields: [officialDocs.updatedBy],
    references: [users.id],
  }),
}));
