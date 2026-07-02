/**
 * Canonical CSS snippet policy defaults (product policy, versioned in-repo).
 * Enforced server-side by the compiler and snippet actions.
 */
export const SNIPPET_LIMITS = {
  /** Max source CSS a user may submit, in bytes. */
  maxSourceBytes: 50 * 1024, // 50 KB
  /** Max compiled output we will store/serve, in bytes. */
  maxCompiledBytes: 75 * 1024, // 75 KB
  /** Max style rules (selector blocks) in one snippet. */
  maxRules: 1000,
  /** Max compound-selector depth (descendant chain length) per selector. */
  maxSelectorDepth: 10,
  /** Max snippets a single user may own. */
  maxSnippetsPerUser: 50,
  /** Max snippets attached to a single document. */
  maxSnippetsPerDocument: 5,
  /** Rate limit for the compile action: N compiles per window per user. */
  compileRateLimit: 30,
  compileRateWindowMs: 60_000,
} as const;

export type SnippetStatus = "ok" | "invalid" | "disabled_by_admin";
