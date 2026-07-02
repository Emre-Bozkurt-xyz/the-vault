import { headers } from "next/headers";

/** Read the per-request CSP nonce set by middleware. */
export async function getCspNonce(): Promise<string | undefined> {
  const headerList = await headers();
  return headerList.get("x-nonce") ?? undefined;
}
