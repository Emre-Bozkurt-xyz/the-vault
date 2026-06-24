const productionSiteUrl = "https://vault.ems-place.com";

export function getSiteUrl() {
  const rawUrl =
    process.env.NEXTAUTH_URL ?? process.env.NEXT_PUBLIC_APP_URL ?? productionSiteUrl;

  try {
    return new URL(rawUrl).origin;
  } catch {
    return productionSiteUrl;
  }
}

export function getAbsoluteSiteUrl(pathname = "/") {
  return new URL(pathname, getSiteUrl()).toString();
}
