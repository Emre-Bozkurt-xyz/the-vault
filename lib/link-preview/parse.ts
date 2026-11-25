/**
 * What a web page says about itself, for a link's hover card: its OpenGraph /
 * Twitter card tags, falling back to `<title>`, the meta description and the
 * favicon. Pure: the fetching (with its safety checks) is in `server/link-preview.ts`.
 */
export type LinkPreviewData = {
  url: string;
  /** The site's name, else its host. */
  siteName: string;
  title: string | null;
  description: string | null;
  /** An absolute http(s) image URL. */
  image: string | null;
  favicon: string | null;
};

const entities: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", "#39": "'" };

function decode(text: string): string {
  return text
    .replace(/&(#x[0-9a-f]+|#\d+|\w+);/gi, (match, code: string) => {
      if (code[0] === "#") {
        const value = code[1].toLowerCase() === "x" ? parseInt(code.slice(2), 16) : parseInt(code.slice(1), 10);
        return Number.isFinite(value) && value > 0 && value < 0x110000 ? String.fromCodePoint(value) : match;
      }
      return entities[code.toLowerCase()] ?? match;
    })
    .replace(/\s+/g, " ")
    .trim();
}

function attribute(tag: string, name: string): string | null {
  const match = tag.match(new RegExp(`\\b${name}\\s*=\\s*("([^"]*)"|'([^']*)'|([^\\s>]+))`, "i"));
  return match ? (match[2] ?? match[3] ?? match[4] ?? null) : null;
}

function absolute(value: string | null, base: string): string | null {
  if (!value) return null;
  try {
    const url = new URL(decode(value), base);
    return url.protocol === "https:" || url.protocol === "http:" ? url.toString() : null;
  } catch {
    return null;
  }
}

function clip(value: string | null, max: number): string | null {
  if (!value) return null;
  const text = decode(value);
  if (!text) return null;
  return text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text;
}

export function parseLinkPreview(html: string, pageUrl: string): LinkPreviewData {
  // Everything useful is in <head>; don't scan a whole article.
  const head = html.slice(0, html.search(/<\/head\s*>/i) > 0 ? html.search(/<\/head\s*>/i) : 200_000);
  const meta = new Map<string, string>();
  for (const tag of head.match(/<meta\b[^>]*>/gi) ?? []) {
    const key = (attribute(tag, "property") ?? attribute(tag, "name"))?.toLowerCase();
    const content = attribute(tag, "content");
    if (key && content && !meta.has(key)) meta.set(key, content);
  }
  let favicon: string | null = null;
  for (const tag of head.match(/<link\b[^>]*>/gi) ?? []) {
    const rel = attribute(tag, "rel")?.toLowerCase() ?? "";
    if (/\bicon\b/.test(rel) && !favicon) favicon = absolute(attribute(tag, "href"), pageUrl);
  }
  const host = new URL(pageUrl).hostname.replace(/^www\./, "");

  return {
    url: pageUrl,
    siteName: clip(meta.get("og:site_name") ?? null, 60) ?? host,
    title: clip(meta.get("og:title") ?? meta.get("twitter:title") ?? head.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] ?? null, 160),
    description: clip(meta.get("og:description") ?? meta.get("twitter:description") ?? meta.get("description") ?? null, 300),
    image: absolute(meta.get("og:image") ?? meta.get("og:image:url") ?? meta.get("twitter:image") ?? null, pageUrl),
    favicon: favicon ?? absolute("/favicon.ico", pageUrl),
  };
}

/**
 * Whether an IP address is one the server must never fetch from (its own
 * network, loopback, link-local, metadata endpoints…): link previews fetch
 * URLs users write, and must not become a way into the server's network.
 */
export function isBlockedAddress(address: string): boolean {
  const ip = address.toLowerCase().replace(/^\[|\]$/g, "");
  const mapped = ip.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
  if (mapped) return isBlockedAddress(mapped[1]);
  const v4 = ip.match(/^(\d+)\.(\d+)\.(\d+)\.(\d+)$/);
  if (v4) {
    const [a, b] = [Number(v4[1]), Number(v4[2])];
    return (
      a === 0 || a === 10 || a === 127 || a >= 224 ||
      (a === 100 && b >= 64 && b <= 127) ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      (a === 192 && b === 0) ||
      (a === 198 && (b === 18 || b === 19))
    );
  }
  if (ip.includes(":")) {
    return ip === "::" || ip === "::1" || /^f[cd]/.test(ip) || /^fe[89ab]/.test(ip) || /^ff/.test(ip);
  }
  return true;
}
