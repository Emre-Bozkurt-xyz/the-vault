import "server-only";

import sharp from "sharp";

import {
  RENDITIONS,
  RENDITION_MAX_INPUT_PIXELS,
  type RenditionName,
} from "@/lib/asset-renditions";

// One process serves many requests: don't keep decoded images in libvips'
// cache, and leave cores for everything else on a small home server.
sharp.cache(false);
sharp.concurrency(2);

/**
 * The bytes could not be turned into renditions: not a decodable image,
 * truncated past repair, or over the pixel limit. Permanent for these bytes,
 * unlike a storage error, so the caller records it and does not retry.
 */
export class RenditionDecodeError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "RenditionDecodeError";
  }
}

export type RenderedRendition = { body: Buffer; width: number; height: number };

export type RenderedRenditions = {
  /** Size of the original as displayed, i.e. after EXIF orientation. */
  width: number;
  height: number;
  animated: boolean;
  outputs: Record<RenditionName, RenderedRendition>;
};

/**
 * Makes every rendition of one image. Display first, from the original, then
 * the thumbnail from the display copy, so a 24-megapixel camera JPEG is
 * decoded once. Output is WebP with all metadata dropped (EXIF, GPS, camera
 * serials), already rotated to its EXIF orientation. Animated GIF/WebP stay
 * animated.
 */
export async function renderRenditions(
  bytes: Buffer | Uint8Array,
  mimeType: string,
  options: { maxInputPixels?: number } = {},
): Promise<RenderedRenditions> {
  const maxInputPixels = options.maxInputPixels ?? RENDITION_MAX_INPUT_PIXELS;
  const mayAnimate = mimeType === "image/gif" || mimeType === "image/webp";
  const inputOptions = {
    limitInputPixels: maxInputPixels,
    animated: mayAnimate,
    // Camera files are sometimes slightly truncated; render what decodes and
    // only give up on real errors.
    failOn: "error" as const,
  };

  try {
    const metadata = await sharp(bytes, inputOptions).metadata();
    if (!metadata.width || !metadata.height) {
      throw new RenditionDecodeError("Image has no dimensions.");
    }

    const animated = (metadata.pages ?? 1) > 1;
    // Animated input stacks frames vertically; one frame is `pageHeight` tall.
    const frameHeight = animated ? (metadata.pageHeight ?? metadata.height) : metadata.height;
    const pixels = metadata.width * frameHeight * (metadata.pages ?? 1);
    if (pixels > maxInputPixels) {
      throw new RenditionDecodeError("Image is too large to render.");
    }

    // EXIF orientations 5-8 are rotated a quarter turn: width and height swap.
    const quarterTurn = !animated && (metadata.orientation ?? 1) >= 5;
    const width = quarterTurn ? frameHeight : metadata.width;
    const height = quarterTurn ? metadata.width : frameHeight;

    const display = await renderOne(bytes, inputOptions, "display", !animated);
    const thumb = await renderOne(display.body, { ...inputOptions, limitInputPixels: false }, "thumb", false);

    return { width, height, animated, outputs: { display, thumb } };
  } catch (error) {
    if (error instanceof RenditionDecodeError) throw error;
    throw new RenditionDecodeError(
      error instanceof Error ? error.message : "Could not decode image.",
      { cause: error },
    );
  }
}

async function renderOne(
  input: Buffer | Uint8Array,
  inputOptions: sharp.SharpOptions,
  name: RenditionName,
  orient: boolean,
): Promise<RenderedRendition> {
  const spec = RENDITIONS[name];
  let pipeline = sharp(input, inputOptions);
  if (orient) pipeline = pipeline.rotate();

  const { data, info } = await pipeline
    .resize({
      width: spec.maxWidth,
      height: spec.maxHeight,
      fit: "inside",
      withoutEnlargement: true,
    })
    .webp({ quality: spec.quality, effort: 4 })
    .toBuffer({ resolveWithObject: true });

  return {
    body: data,
    width: info.width,
    // Animated output reports the stacked height; one frame is what shows.
    height: info.pageHeight ?? info.height,
  };
}
