import type { AdapterAccountType } from "@auth/core/adapters";
import { relations, sql } from "drizzle-orm";
import {
  bigint,
  boolean,
  customType,
  index,
  integer,
  jsonb,
  primaryKey,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  type AnyPgColumn,
} from "drizzle-orm/pg-core";

import { ASSET_LIMITS } from "../lib/config/asset-limits";

export type DocumentRole = "owner" | "editor" | "viewer";
export type FolderRole = "editor" | "viewer";
export type DocumentVisibility = "private" | "public";
export type DocumentShareLinkScope = "anyone" | "members";
export type DocumentShareLinkRole = "viewer" | "editor";
export type UserRole = "user" | "admin";
export type AssetKind = "image" | "pdf";
export type AssetVisibility = "private" | "public";
export type AssetStatus = "pending" | "ready" | "failed" | "deleted";
export type TagCategory =
  | "general"
  | "topic"
  | "person"
  | "place"
  | "project"
  | "technical";
export type ContentTargetKind = "document" | "asset";
export type DocumentExtensionStateVisibility =
  | "private"
  | "public"
  | "editor-only";
export type UserSettingNamespace =
  | "appearance"
  | "editor"
  | "workspace"
  | "files-assets"
  | "hotkeys"
  | "advanced";
export type OfficialDocStatus = "draft" | "published" | "archived";
export type FriendRequestStatus =
  | "pending"
  | "accepted"
  | "rejected"
  | "cancelled";

const bytea = customType<{ data: Buffer; driverData: Buffer }>({
  dataType() {
    return "bytea";
  },
});

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
    storageUsedBytes: bigint("storage_used_bytes", { mode: "number" })
      .notNull()
      .default(0),
    storageQuotaBytes: bigint("storage_quota_bytes", { mode: "number" })
      .notNull()
      .default(ASSET_LIMITS.defaultUserStorageQuotaBytes),
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

export const folders = pgTable(
  "folders",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    ownerId: uuid("owner_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    parentId: uuid("parent_id").references((): AnyPgColumn => folders.id, {
      onDelete: "cascade",
    }),
    name: text("name").notNull(),
    sortOrder: integer("sort_order").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .default(sql`now()`),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .default(sql`now()`),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
  },
  (table) => [
    index("folders_owner_id_idx").on(table.ownerId),
    index("folders_parent_id_idx").on(table.parentId),
    index("folders_deleted_at_idx").on(table.deletedAt),
  ],
);

export const folderPermissions = pgTable(
  "folder_permissions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    folderId: uuid("folder_id")
      .notNull()
      .references(() => folders.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    role: text("role").$type<FolderRole>().notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .default(sql`now()`),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .default(sql`now()`),
  },
  (table) => [
    uniqueIndex("folder_permissions_folder_user_unique").on(
      table.folderId,
      table.userId,
    ),
    index("folder_permissions_folder_id_idx").on(table.folderId),
    index("folder_permissions_user_id_idx").on(table.userId),
  ],
);

export const documents = pgTable(
  "documents",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    ownerId: uuid("owner_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    folderId: uuid("folder_id").references(() => folders.id, {
      onDelete: "set null",
    }),
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
    index("documents_folder_id_idx").on(table.folderId),
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

export const documentShareLinks = pgTable(
  "document_share_links",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    documentId: uuid("document_id")
      .notNull()
      .references(() => documents.id, { onDelete: "cascade" }),
    tokenHash: text("token_hash").notNull(),
    scope: text("scope")
      .$type<DocumentShareLinkScope>()
      .notNull()
      .default("members"),
    role: text("role")
      .$type<DocumentShareLinkRole>()
      .notNull()
      .default("viewer"),
    enabled: integer("enabled").notNull().default(1),
    expiresAt: timestamp("expires_at", { withTimezone: true }),
    createdBy: uuid("created_by").references(() => users.id, {
      onDelete: "set null",
    }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .default(sql`now()`),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .default(sql`now()`),
  },
  (table) => [
    uniqueIndex("document_share_links_token_hash_unique").on(table.tokenHash),
    index("document_share_links_document_id_idx").on(table.documentId),
    index("document_share_links_enabled_idx").on(table.enabled),
    index("document_share_links_expires_at_idx").on(table.expiresAt),
  ],
);

export const documentCollabStates = pgTable("document_collab_states", {
  documentId: uuid("document_id")
    .primaryKey()
    .references(() => documents.id, { onDelete: "cascade" }),
  yjsState: bytea("yjs_state").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .default(sql`now()`),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .default(sql`now()`),
});

export const documentExtensionStates = pgTable(
  "document_extension_states",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    documentId: uuid("document_id")
      .notNull()
      .references(() => documents.id, { onDelete: "cascade" }),
    extensionId: text("extension_id").notNull(),
    stateKey: text("state_key").notNull().default("default"),
    state: jsonb("state").$type<Record<string, unknown>>().notNull(),
    version: integer("version").notNull().default(1),
    visibility: text("visibility")
      .$type<DocumentExtensionStateVisibility>()
      .notNull()
      .default("private"),
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
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
  },
  (table) => [
    uniqueIndex("document_extension_states_document_key_unique").on(
      table.documentId,
      table.extensionId,
      table.stateKey,
    ),
    index("document_extension_states_document_id_idx").on(table.documentId),
    index("document_extension_states_extension_id_idx").on(table.extensionId),
    index("document_extension_states_visibility_idx").on(table.visibility),
    index("document_extension_states_deleted_at_idx").on(table.deletedAt),
  ],
);

export const userSettings = pgTable(
  "user_settings",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    namespace: text("namespace").$type<UserSettingNamespace>().notNull(),
    key: text("key").notNull(),
    value: jsonb("value").$type<Record<string, unknown>>().notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .default(sql`now()`),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .default(sql`now()`),
  },
  (table) => [
    uniqueIndex("user_settings_user_namespace_key_unique").on(
      table.userId,
      table.namespace,
      table.key,
    ),
    index("user_settings_user_id_idx").on(table.userId),
    index("user_settings_namespace_idx").on(table.namespace),
  ],
);

export const userExtensionSettings = pgTable(
  "user_extension_settings",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    extensionId: text("extension_id").notNull(),
    enabled: boolean("enabled").notNull().default(false),
    settings: jsonb("settings")
      .$type<Record<string, unknown>>()
      .notNull()
      .default(sql`'{}'::jsonb`),
    version: integer("version").notNull().default(1),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .default(sql`now()`),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .default(sql`now()`),
  },
  (table) => [
    uniqueIndex("user_extension_settings_user_extension_unique").on(
      table.userId,
      table.extensionId,
    ),
    index("user_extension_settings_user_id_idx").on(table.userId),
    index("user_extension_settings_extension_id_idx").on(table.extensionId),
    index("user_extension_settings_enabled_idx").on(table.enabled),
  ],
);

export const assets = pgTable(
  "assets",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    ownerId: uuid("owner_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    uploaderId: uuid("uploader_id").references(() => users.id, {
      onDelete: "set null",
    }),
    storageDriver: text("storage_driver").notNull().default("r2"),
    storageBucket: text("storage_bucket").notNull(),
    storageKey: text("storage_key").notNull(),
    originalFilename: text("original_filename").notNull(),
    displayName: text("display_name").notNull(),
    description: text("description"),
    altText: text("alt_text"),
    mimeType: text("mime_type").notNull(),
    detectedMimeType: text("detected_mime_type").notNull(),
    fileExtension: text("file_extension").notNull(),
    sizeBytes: bigint("size_bytes", { mode: "number" }).notNull(),
    width: integer("width"),
    height: integer("height"),
    kind: text("kind").$type<AssetKind>().notNull(),
    visibility: text("visibility").$type<AssetVisibility>().notNull().default("private"),
    status: text("status").$type<AssetStatus>().notNull().default("pending"),
    checksumSha256: text("checksum_sha256"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .default(sql`now()`),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .default(sql`now()`),
    publishedAt: timestamp("published_at", { withTimezone: true }),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
  },
  (table) => [
    index("assets_owner_id_idx").on(table.ownerId),
    index("assets_kind_idx").on(table.kind),
    index("assets_visibility_status_idx").on(table.visibility, table.status),
    index("assets_created_at_idx").on(table.createdAt),
    index("assets_deleted_at_idx").on(table.deletedAt),
    uniqueIndex("assets_storage_key_unique").on(table.storageKey),
  ],
);

export const documentAssets = pgTable(
  "document_assets",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    documentId: uuid("document_id")
      .notNull()
      .references(() => documents.id, { onDelete: "cascade" }),
    assetId: uuid("asset_id")
      .notNull()
      .references(() => assets.id, { onDelete: "cascade" }),
    linkedBy: uuid("linked_by").references(() => users.id, {
      onDelete: "set null",
    }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .default(sql`now()`),
  },
  (table) => [
    uniqueIndex("document_assets_document_asset_unique").on(
      table.documentId,
      table.assetId,
    ),
    index("document_assets_document_id_idx").on(table.documentId),
    index("document_assets_asset_id_idx").on(table.assetId),
    index("document_assets_linked_by_idx").on(table.linkedBy),
  ],
);

export const tags = pgTable(
  "tags",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    slug: text("slug").notNull(),
    displayName: text("display_name").notNull(),
    category: text("category").$type<TagCategory>().notNull().default("general"),
    description: text("description"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .default(sql`now()`),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .default(sql`now()`),
  },
  (table) => [
    uniqueIndex("tags_slug_unique").on(table.slug),
    index("tags_category_idx").on(table.category),
  ],
);

export const tagAliases = pgTable(
  "tag_aliases",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    aliasSlug: text("alias_slug").notNull(),
    tagId: uuid("tag_id")
      .notNull()
      .references(() => tags.id, { onDelete: "cascade" }),
    createdBy: uuid("created_by").references(() => users.id, {
      onDelete: "set null",
    }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .default(sql`now()`),
  },
  (table) => [
    uniqueIndex("tag_aliases_alias_slug_unique").on(table.aliasSlug),
    index("tag_aliases_tag_id_idx").on(table.tagId),
  ],
);

export const documentMetadata = pgTable(
  "document_metadata",
  {
    documentId: uuid("document_id")
      .primaryKey()
      .references(() => documents.id, { onDelete: "cascade" }),
    aliases: jsonb("aliases")
      .$type<string[]>()
      .notNull()
      .default(sql`'[]'::jsonb`),
    summary: text("summary"),
    status: text("status"),
    project: text("project"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .default(sql`now()`),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .default(sql`now()`),
  },
  (table) => [
    index("document_metadata_status_idx").on(table.status),
    index("document_metadata_project_idx").on(table.project),
  ],
);

export const documentTags = pgTable(
  "document_tags",
  {
    documentId: uuid("document_id")
      .notNull()
      .references(() => documents.id, { onDelete: "cascade" }),
    tagId: uuid("tag_id")
      .notNull()
      .references(() => tags.id, { onDelete: "cascade" }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .default(sql`now()`),
  },
  (table) => [
    primaryKey({ columns: [table.documentId, table.tagId] }),
    index("document_tags_tag_id_idx").on(table.tagId),
  ],
);

export const assetTags = pgTable(
  "asset_tags",
  {
    assetId: uuid("asset_id")
      .notNull()
      .references(() => assets.id, { onDelete: "cascade" }),
    tagId: uuid("tag_id")
      .notNull()
      .references(() => tags.id, { onDelete: "cascade" }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .default(sql`now()`),
  },
  (table) => [
    primaryKey({ columns: [table.assetId, table.tagId] }),
    index("asset_tags_tag_id_idx").on(table.tagId),
  ],
);

export const contentLikes = pgTable(
  "content_likes",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    targetKind: text("target_kind").$type<ContentTargetKind>().notNull(),
    documentId: uuid("document_id").references(() => documents.id, {
      onDelete: "cascade",
    }),
    assetId: uuid("asset_id").references(() => assets.id, {
      onDelete: "cascade",
    }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .default(sql`now()`),
  },
  (table) => [
    uniqueIndex("content_likes_document_user_unique").on(
      table.documentId,
      table.userId,
    ),
    uniqueIndex("content_likes_asset_user_unique").on(table.assetId, table.userId),
    index("content_likes_target_kind_idx").on(table.targetKind),
    index("content_likes_created_at_idx").on(table.createdAt),
  ],
);

export const contentViews = pgTable(
  "content_views",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    targetKind: text("target_kind").$type<ContentTargetKind>().notNull(),
    documentId: uuid("document_id").references(() => documents.id, {
      onDelete: "cascade",
    }),
    assetId: uuid("asset_id").references(() => assets.id, {
      onDelete: "cascade",
    }),
    userId: uuid("user_id").references(() => users.id, {
      onDelete: "set null",
    }),
    anonymousHash: text("anonymous_hash"),
    viewDay: text("view_day").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .default(sql`now()`),
  },
  (table) => [
    uniqueIndex("content_views_document_user_day_unique").on(
      table.documentId,
      table.userId,
      table.viewDay,
    ),
    uniqueIndex("content_views_document_anon_day_unique").on(
      table.documentId,
      table.anonymousHash,
      table.viewDay,
    ),
    uniqueIndex("content_views_asset_user_day_unique").on(
      table.assetId,
      table.userId,
      table.viewDay,
    ),
    uniqueIndex("content_views_asset_anon_day_unique").on(
      table.assetId,
      table.anonymousHash,
      table.viewDay,
    ),
    index("content_views_target_kind_idx").on(table.targetKind),
    index("content_views_created_at_idx").on(table.createdAt),
  ],
);

export const foldersRelations = relations(folders, ({ one, many }) => ({
  owner: one(users, {
    fields: [folders.ownerId],
    references: [users.id],
  }),
  parent: one(folders, {
    fields: [folders.parentId],
    references: [folders.id],
    relationName: "folder_parent",
  }),
  children: many(folders, { relationName: "folder_parent" }),
  permissions: many(folderPermissions),
  documents: many(documents),
}));

export const folderPermissionsRelations = relations(
  folderPermissions,
  ({ one }) => ({
    folder: one(folders, {
      fields: [folderPermissions.folderId],
      references: [folders.id],
    }),
    user: one(users, {
      fields: [folderPermissions.userId],
      references: [users.id],
    }),
  }),
);

export const documentsRelations = relations(documents, ({ one, many }) => ({
  owner: one(users, {
    fields: [documents.ownerId],
    references: [users.id],
  }),
  folder: one(folders, {
    fields: [documents.folderId],
    references: [folders.id],
  }),
  collabState: one(documentCollabStates, {
    fields: [documents.id],
    references: [documentCollabStates.documentId],
  }),
  permissions: many(documentPermissions),
  versions: many(documentVersions),
  shareLinks: many(documentShareLinks),
  extensionStates: many(documentExtensionStates),
  assets: many(documentAssets),
  metadata: one(documentMetadata, {
    fields: [documents.id],
    references: [documentMetadata.documentId],
  }),
  tags: many(documentTags),
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

export const documentShareLinksRelations = relations(
  documentShareLinks,
  ({ one }) => ({
    document: one(documents, {
      fields: [documentShareLinks.documentId],
      references: [documents.id],
    }),
    creator: one(users, {
      fields: [documentShareLinks.createdBy],
      references: [users.id],
    }),
  }),
);

export const documentCollabStatesRelations = relations(
  documentCollabStates,
  ({ one }) => ({
    document: one(documents, {
      fields: [documentCollabStates.documentId],
      references: [documents.id],
    }),
  }),
);

export const documentExtensionStatesRelations = relations(
  documentExtensionStates,
  ({ one }) => ({
    document: one(documents, {
      fields: [documentExtensionStates.documentId],
      references: [documents.id],
    }),
    creator: one(users, {
      fields: [documentExtensionStates.createdBy],
      references: [users.id],
    }),
    updater: one(users, {
      fields: [documentExtensionStates.updatedBy],
      references: [users.id],
    }),
  }),
);

export const userSettingsRelations = relations(userSettings, ({ one }) => ({
  user: one(users, {
    fields: [userSettings.userId],
    references: [users.id],
  }),
}));

export const userExtensionSettingsRelations = relations(
  userExtensionSettings,
  ({ one }) => ({
    user: one(users, {
      fields: [userExtensionSettings.userId],
      references: [users.id],
    }),
  }),
);

export const assetsRelations = relations(assets, ({ one, many }) => ({
  owner: one(users, {
    fields: [assets.ownerId],
    references: [users.id],
  }),
  uploader: one(users, {
    fields: [assets.uploaderId],
    references: [users.id],
  }),
  documentAssets: many(documentAssets),
}));

export const documentAssetsRelations = relations(documentAssets, ({ one }) => ({
  document: one(documents, {
    fields: [documentAssets.documentId],
    references: [documents.id],
  }),
  asset: one(assets, {
    fields: [documentAssets.assetId],
    references: [assets.id],
  }),
  linker: one(users, {
    fields: [documentAssets.linkedBy],
    references: [users.id],
  }),
}));

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
