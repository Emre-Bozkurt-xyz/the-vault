"use client";

/**
 * Poster frames for uploaded videos, captured in the uploader's browser (the
 * server has no video decoder). Reads the local file through a blob: URL —
 * nothing is downloaded — draws one frame to a canvas, and sends it with the
 * duration and size to `POST /api/assets/:id/poster`, which re-encodes it like
 * any photo. Every failure (a codec this browser can't decode, a timeout)
 * resolves quietly and asks the server to make one with ffmpeg instead
 * ({@link requestServerPoster}); until then the video shows an icon tile.
 */

const MAX_POSTER_WIDTH = 1280;
// Generous: capture runs while the machine may be busy uploading.
const LOAD_TIMEOUT_MS = 30_000;

function once(target: HTMLMediaElement, event: string, timeoutMs: number) {
  return new Promise<void>((resolve, reject) => {
    const timer = window.setTimeout(() => {
      cleanup();
      reject(new Error(`Timed out waiting for ${event}.`));
    }, timeoutMs);
    const onEvent = () => {
      cleanup();
      resolve();
    };
    const onError = () => {
      cleanup();
      reject(new Error("The browser could not decode this video."));
    };
    const cleanup = () => {
      window.clearTimeout(timer);
      target.removeEventListener(event, onEvent);
      target.removeEventListener("error", onError);
    };
    target.addEventListener(event, onEvent, { once: true });
    target.addEventListener("error", onError, { once: true });
  });
}

function toBlob(canvas: HTMLCanvasElement, type: string, quality: number) {
  return new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, type, quality));
}

export async function captureVideoPoster(file: Blob) {
  const url = URL.createObjectURL(file);
  const video = document.createElement("video");
  video.muted = true;
  video.playsInline = true;
  video.preload = "auto";

  try {
    video.src = url;
    await once(video, "loadeddata", LOAD_TIMEOUT_MS);

    const duration = Number.isFinite(video.duration) ? video.duration : 0;
    // A second in (or 10% of a short clip) skips the black first frame.
    const target = Math.min(1, duration * 0.1);
    if (target > 0) {
      video.currentTime = target;
      await once(video, "seeked", LOAD_TIMEOUT_MS);
    }

    if (!video.videoWidth || !video.videoHeight) return null;
    const scale = Math.min(1, MAX_POSTER_WIDTH / video.videoWidth);
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(video.videoWidth * scale));
    canvas.height = Math.max(1, Math.round(video.videoHeight * scale));
    canvas.getContext("2d")?.drawImage(video, 0, 0, canvas.width, canvas.height);

    const poster =
      (await toBlob(canvas, "image/webp", 0.85)) ?? (await toBlob(canvas, "image/jpeg", 0.85));
    if (!poster) return null;

    return {
      poster,
      durationMs: duration > 0 ? Math.round(duration * 1000) : null,
      width: video.videoWidth,
      height: video.videoHeight,
    };
  } catch {
    return null;
  } finally {
    video.removeAttribute("src");
    video.load();
    URL.revokeObjectURL(url);
  }
}

/**
 * A poster from a video element that is already playing (the viewer), for
 * videos whose poster capture at upload didn't happen. The element must be
 * same-origin, which Vault's content route is, or the canvas would be tainted.
 */
export async function captureFromVideoElement(video: HTMLVideoElement) {
  if (!video.videoWidth || !video.videoHeight) return null;
  const scale = Math.min(1, MAX_POSTER_WIDTH / video.videoWidth);
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(video.videoWidth * scale));
  canvas.height = Math.max(1, Math.round(video.videoHeight * scale));
  try {
    canvas.getContext("2d")?.drawImage(video, 0, 0, canvas.width, canvas.height);
    const poster =
      (await toBlob(canvas, "image/webp", 0.85)) ?? (await toBlob(canvas, "image/jpeg", 0.85));
    if (!poster) return null;
    const duration = Number.isFinite(video.duration) ? video.duration : 0;
    return {
      poster,
      durationMs: duration > 0 ? Math.round(duration * 1000) : null,
      width: video.videoWidth,
      height: video.videoHeight,
    };
  } catch {
    return null;
  }
}

/** Captures and uploads a poster; resolves to whether one was stored. */
export async function attachVideoPoster(
  assetId: string,
  source: Blob | HTMLVideoElement,
  options: { bearerToken?: string | null } = {},
) {
  const captured =
    source instanceof Blob ? await captureVideoPoster(source) : await captureFromVideoElement(source);
  // This browser can't decode it: the server makes one instead.
  if (!captured) return requestServerPoster(assetId, options);

  const form = new FormData();
  form.set("poster", captured.poster, "poster");
  if (captured.durationMs !== null) form.set("durationMs", String(captured.durationMs));
  form.set("width", String(captured.width));
  form.set("height", String(captured.height));

  try {
    const response = await fetch(`/api/assets/${assetId}/poster`, {
      method: "POST",
      body: form,
      headers: options.bearerToken ? { Authorization: `Bearer ${options.bearerToken}` } : undefined,
    });
    return response.ok;
  } catch {
    return false;
  }
}

/**
 * Asks the server to make the poster with ffmpeg (a codec this browser can't
 * decode). Resolves true once one is stored; false when it failed or is still
 * running after the server's wait (it then lands on a later refresh).
 */
export async function requestServerPoster(
  assetId: string,
  options: { bearerToken?: string | null } = {},
) {
  try {
    const response = await fetch(`/api/assets/${assetId}/poster?generate=1`, {
      method: "POST",
      headers: options.bearerToken ? { Authorization: `Bearer ${options.bearerToken}` } : undefined,
    });
    if (!response.ok) return false;
    const body = (await response.json().catch(() => null)) as { stored?: boolean } | null;
    return body?.stored === true;
  } catch {
    // The daily backfill catches anything missed.
    return false;
  }
}
