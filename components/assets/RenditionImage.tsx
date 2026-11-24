"use client";

import { useState, type ReactNode } from "react";

/**
 * An asset rendition (`?r=thumb|display`) with a fallback for when there is
 * none: no URL (not an image, or rendering failed), or the request fails (a
 * 404, or a 503 while storage is down). It never falls back to the original,
 * which for a camera photo can be tens of megabytes.
 *
 * Pass the asset's pixel `width`/`height` when known: with `h-auto w-full` the
 * browser reserves the right box from them before the image arrives, so a
 * masonry column doesn't jump as thumbnails load (no inline styles needed,
 * which the CSP would refuse anyway).
 */
export function RenditionImage({
  src,
  alt,
  width,
  height,
  className,
  loading = "lazy",
  fallback,
}: {
  src: string | null;
  alt: string;
  width?: number | null;
  height?: number | null;
  className?: string;
  loading?: "lazy" | "eager";
  fallback: ReactNode;
}) {
  // Remember which URL failed, so a new `src` gets a fresh try.
  const [failedSrc, setFailedSrc] = useState<string | null>(null);

  if (!src || failedSrc === src) {
    return <>{fallback}</>;
  }

  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      // Server-rendered images start loading before hydration, so a fast 404
      // can fire `error` before React listens. Catch that on mount: a
      // finished request with no pixels is a failed one.
      ref={(image) => {
        if (image?.complete && image.naturalWidth === 0) setFailedSrc(src);
      }}
      src={src}
      alt={alt}
      width={width ?? undefined}
      height={height ?? undefined}
      className={className}
      loading={loading}
      decoding="async"
      onError={() => setFailedSrc(src)}
    />
  );
}
