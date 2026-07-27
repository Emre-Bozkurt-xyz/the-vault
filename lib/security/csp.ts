/**
 * Content-Security-Policy construction.
 *
 * Two policies are emitted per request:
 *
 *  - An ENFORCED policy carrying only directives we are confident cannot break
 *    the app: `frame-ancestors` (clickjacking), `object-src`, `base-uri`,
 *    `form-action`. These ship immediately.
 *  - A REPORT-ONLY policy carrying the full strict, nonce-based script/style
 *    policy. It never blocks; it lets us validate before flipping to enforce.
 *
 * The nonce is generated per request in middleware and threaded to inline
 * `<style>`/`<script>` elements (including snippet stylesheets in a later
 * phase) so the strict policy can be enforced without `'unsafe-inline'` on
 * elements. Inline `style=""` attributes remain permitted via
 * `style-src-attr 'unsafe-inline'` because the render pipeline sanitizes them.
 */

// Hosts allowed for `<iframe>` embeds. Keep in sync with the
// `allowedIframeProviders` allowlist in components/markdown/MarkdownDocument.tsx.
const iframeFrameSrc = [
  "https://www.youtube.com",
  "https://youtube.com",
  "https://www.youtube-nocookie.com",
  "https://youtube-nocookie.com",
  "https://open.spotify.com",
  "https://embed.tidal.com",
  "https://player.vimeo.com",
  "https://w.soundcloud.com",
  "https://embed.music.apple.com",
  "https://*.bandcamp.com",
];

// Default frame-ancestors origin for the `/embed/...` route family when
// `EMBED_FRAME_ANCESTORS` is unset. Keep this the only Den-specific value in
// this file — the mechanism itself is generic (any allow-listed origin family
// could be configured here for a future embed consumer).
const defaultEmbedFrameAncestors = ["https://den.ems-place.com"];

/**
 * Comma-separated allow-list of origins permitted to frame `/embed/...`
 * routes, read from `EMBED_FRAME_ANCESTORS`. Falls back to the default Den
 * origin when unset or empty — this never silently degrades to `*`: a
 * misconfigured env var (e.g. accidentally set to `*` or a blank string)
 * still resolves to the safe default rather than opening framing to anyone.
 */
function embedFrameAncestors(): string[] {
  const raw = process.env.EMBED_FRAME_ANCESTORS;

  if (!raw || !raw.trim()) {
    return defaultEmbedFrameAncestors;
  }

  const origins = raw
    .split(",")
    .map((origin) => origin.trim())
    .filter((origin) => origin.length > 0 && origin !== "*");

  return origins.length > 0 ? origins : defaultEmbedFrameAncestors;
}

function collabConnectSrc(): string[] {
  const collabUrl = process.env.NEXT_PUBLIC_COLLAB_URL;

  if (!collabUrl) {
    return [];
  }

  try {
    const url = new URL(collabUrl);
    // Allow both the ws(s) origin used by the browser client and its http(s)
    // equivalent for good measure.
    const wsOrigin = url.origin;
    const httpOrigin = url.origin.replace(/^ws/, "http");
    return Array.from(new Set([wsOrigin, httpOrigin]));
  } catch {
    return [];
  }
}

function serialize(directives: Record<string, string[]>): string {
  return Object.entries(directives)
    .map(([name, values]) =>
      values.length > 0 ? `${name} ${values.join(" ")}` : name,
    )
    .join("; ");
}

export type CspOptions = {
  /**
   * Set for requests under `/embed/...`: swaps `frame-ancestors 'self'` for
   * the configured embed allow-list so the route can be framed by Den (or
   * whatever origin `EMBED_FRAME_ANCESTORS` names). Every other route keeps
   * `'self'` — framing stays locked down by default.
   */
  embed?: boolean;
};

export function buildEnforcedCsp(options: CspOptions = {}): string {
  return serialize({
    "frame-ancestors": options.embed ? embedFrameAncestors() : ["'self'"],
    "object-src": ["'none'"],
    "base-uri": ["'self'"],
    "form-action": ["'self'"],
  });
}

export function buildReportOnlyCsp(nonce: string, options: CspOptions = {}): string {
  const nonceSource = `'nonce-${nonce}'`;

  return serialize({
    "default-src": ["'self'"],
    "script-src": ["'self'", nonceSource, "'strict-dynamic'"],
    // `<style>` elements must carry the nonce; inline style="" attributes are
    // sanitized by the render pipeline and allowed via -attr.
    "style-src": ["'self'", nonceSource],
    "style-src-attr": ["'unsafe-inline'"],
    "img-src": ["'self'", "https:", "data:", "blob:"],
    "font-src": ["'self'", "data:"],
    "connect-src": ["'self'", ...collabConnectSrc()],
    "frame-src": iframeFrameSrc,
    "frame-ancestors": options.embed ? embedFrameAncestors() : ["'self'"],
    "object-src": ["'none'"],
    "base-uri": ["'self'"],
    "form-action": ["'self'"],
  });
}

export function generateNonce(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  let binary = "";
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary);
}
