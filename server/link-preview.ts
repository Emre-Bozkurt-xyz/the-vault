import "server-only";

import { lookup } from "node:dns/promises";

import { isBlockedAddress, parseLinkPreview, type LinkPreviewData } from "@/lib/link-preview/parse";

const TIMEOUT_MS = 5000;
const MAX_BYTES = 512 * 1024;
const MAX_REDIRECTS = 3;
const CACHE_TTL_MS = 6 * 60 * 60 * 1000;
const FAILURE_TTL_MS = 30 * 60 * 1000;
const CACHE_MAX = 400;

type CacheEntry = { at: number; ttl: number; data: LinkPreviewData | null };
const cache = new Map<string, CacheEntry>();

function remember(key: string, data: LinkPreviewData | null) {
  if (cache.size >= CACHE_MAX) cache.delete(cache.keys().next().value as string);
  cache.set(key, { at: Date.now(), ttl: data ? CACHE_TTL_MS : FAILURE_TTL_MS, data });
}

/** Rejects anything but a public http(s) address on the standard ports. */
async function assertFetchable(url: URL) {
  if (url.protocol !== "https:" && url.protocol !== "http:") throw new Error("Only web links have previews.");
  if (url.username || url.password) throw new Error("Links with credentials aren't fetched.");
  if (url.port && url.port !== "80" && url.port !== "443") throw new Error("Only standard ports are fetched.");
  const addresses = await lookup(url.hostname, { all: true });
  if (addresses.length === 0 || addresses.some(({ address }) => isBlockedAddress(address))) {
    throw new Error("That address isn't public.");
  }
}

async function readCapped(response: Response): Promise<string> {
  const reader = response.body?.getReader();
  if (!reader) return "";
  const chunks: Uint8Array[] = [];
  let size = 0;
  while (size < MAX_BYTES) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    size += value.byteLength;
  }
  await reader.cancel().catch(() => undefined);
  return new TextDecoder("utf-8", { fatal: false }).decode(Buffer.concat(chunks).subarray(0, MAX_BYTES));
}

/**
 * A web page's preview for a link's hover card (`parseLinkPreview`), fetched
 * with guards: public addresses only (checked again on every redirect), a
 * timeout, a size cap, HTML only, and no cookies or user details sent. Cached
 * for hours (failures for half an hour), so hovering is cheap. Null when the
 * page has nothing to show or can't be fetched.
 */
export async function getLinkPreview(rawUrl: string): Promise<LinkPreviewData | null> {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    return null;
  }
  url.hash = "";
  const key = url.toString();
  const cached = cache.get(key);
  if (cached && Date.now() - cached.at < cached.ttl) return cached.data;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    let current = url;
    for (let hop = 0; hop <= MAX_REDIRECTS; hop += 1) {
      await assertFetchable(current);
      const response = await fetch(current, {
        redirect: "manual",
        signal: controller.signal,
        headers: {
          "user-agent": "Mozilla/5.0 (compatible; VaultLinkPreview/1.0)",
          accept: "text/html,application/xhtml+xml",
        },
      });
      if (response.status >= 300 && response.status < 400) {
        const location = response.headers.get("location");
        await response.body?.cancel().catch(() => undefined);
        if (!location) break;
        current = new URL(location, current);
        continue;
      }
      const type = response.headers.get("content-type") ?? "";
      if (!response.ok || !/text\/html|application\/xhtml/i.test(type)) {
        await response.body?.cancel().catch(() => undefined);
        break;
      }
      const preview = parseLinkPreview(await readCapped(response), current.toString());
      remember(key, preview);
      return preview;
    }
  } catch {
    // Unreachable, blocked, slow or malformed: no preview.
  } finally {
    clearTimeout(timer);
  }
  remember(key, null);
  return null;
}
