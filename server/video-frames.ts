import "server-only";

import { spawn } from "node:child_process";

/**
 * Server-side video reading with ffmpeg/ffprobe, for poster frames the
 * uploader's browser couldn't capture: a codec it can't decode (Motion-JPEG
 * from older digicams, some HEVC), or an upload from somewhere that never
 * tried. Reads the stored object over a short-lived signed URL, so ffmpeg
 * fetches only the byte ranges it needs instead of the whole file.
 *
 * Hardening: arguments are an array (no shell); only HTTP(S) inputs are
 * allowed; the demuxer is fixed by the stored MIME type rather than guessed
 * from content; output is capped and every run has a timeout. The frame goes
 * through the normal rendition pipeline afterwards, like any photo.
 *
 * `FFMPEG_PATH` / `FFPROBE_PATH` override the binaries (default: on PATH).
 * Without them every call rejects with {@link VideoToolMissingError}, and
 * callers simply leave the video without a poster.
 */

const RUN_TIMEOUT_MS = 60_000;
const MAX_FRAME_BYTES = 16 * 1024 * 1024;
const MAX_PROBE_BYTES = 256 * 1024;
/** Longest edge of the extracted frame; renditions resize further. */
const MAX_FRAME_EDGE = 1920;

const PROTOCOLS = "https,http,tcp,tls,crypto";

/** The demuxer for each accepted video type (docs: server/assets.ts allow-list). */
const DEMUXERS: Record<string, string> = {
  "video/mp4": "mov",
  "video/x-m4v": "mov",
  "video/quicktime": "mov",
  "video/webm": "matroska",
};

export class VideoToolMissingError extends Error {
  constructor(tool: string) {
    super(`${tool} is not installed (set FFMPEG_PATH/FFPROBE_PATH or add it to the image).`);
    this.name = "VideoToolMissingError";
  }
}

/** ffmpeg couldn't read this video: a permanent failure for this file. */
export class VideoDecodeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "VideoDecodeError";
  }
}

export function canReadVideoType(mimeType: string) {
  return Object.hasOwn(DEMUXERS, mimeType);
}

function demuxerFor(mimeType: string) {
  const demuxer = DEMUXERS[mimeType];
  if (!demuxer) throw new VideoDecodeError(`Unsupported video type ${mimeType}.`);
  return demuxer;
}

function run(command: string, args: string[], maxBytes: number) {
  return new Promise<Buffer>((resolve, reject) => {
    const child = spawn(command, args, { stdio: ["ignore", "pipe", "pipe"], windowsHide: true });
    const chunks: Buffer[] = [];
    let size = 0;
    let stderr = "";
    let settled = false;
    const finish = (error: Error | null, value?: Buffer) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (error) {
        child.kill("SIGKILL");
        reject(error);
      } else {
        resolve(value!);
      }
    };
    const timer = setTimeout(
      () => finish(new VideoDecodeError(`${command} timed out.`)),
      RUN_TIMEOUT_MS,
    );

    child.stdout.on("data", (chunk: Buffer) => {
      size += chunk.length;
      if (size > maxBytes) {
        finish(new VideoDecodeError(`${command} output exceeded ${maxBytes} bytes.`));
        return;
      }
      chunks.push(chunk);
    });
    child.stderr.on("data", (chunk: Buffer) => {
      stderr = (stderr + chunk.toString("utf8")).slice(-2000);
    });
    child.on("error", (error: NodeJS.ErrnoException) => {
      finish(error.code === "ENOENT" ? new VideoToolMissingError(command) : error);
    });
    child.on("close", (code) => {
      if (code === 0) finish(null, Buffer.concat(chunks));
      else finish(new VideoDecodeError(stderr.trim() || `${command} exited with ${code}.`));
    });
  });
}

export type VideoProbe = { durationMs: number | null; width: number | null; height: number | null };

/** Duration and display size (rotation applied) of a stored video. */
export async function probeVideo(url: string, mimeType: string): Promise<VideoProbe> {
  const output = await run(
    process.env.FFPROBE_PATH || "ffprobe",
    [
      "-v", "error",
      "-protocol_whitelist", PROTOCOLS,
      "-f", demuxerFor(mimeType),
      "-select_streams", "v:0",
      "-show_entries", "format=duration:stream=width,height:stream_side_data=rotation:stream_tags=rotate",
      "-of", "json",
      url,
    ],
    MAX_PROBE_BYTES,
  );
  return parseProbe(output.toString("utf8"));
}

/** Parses ffprobe's JSON; exported for tests. */
export function parseProbe(json: string): VideoProbe {
  let data: {
    format?: { duration?: string };
    streams?: {
      width?: number;
      height?: number;
      side_data_list?: { rotation?: number }[];
      tags?: { rotate?: string };
    }[];
  };
  try {
    data = JSON.parse(json);
  } catch {
    return { durationMs: null, width: null, height: null };
  }
  const seconds = Number(data.format?.duration);
  const stream = data.streams?.[0];
  const rotation = Math.abs(
    Number(stream?.side_data_list?.find((side) => side.rotation !== undefined)?.rotation ?? stream?.tags?.rotate ?? 0),
  );
  const sideways = rotation % 180 === 90;
  const width = stream?.width && stream.width > 0 ? stream.width : null;
  const height = stream?.height && stream.height > 0 ? stream.height : null;
  return {
    durationMs: Number.isFinite(seconds) && seconds > 0 ? Math.round(seconds * 1000) : null,
    width: sideways ? height : width,
    height: sideways ? width : height,
  };
}

/**
 * One frame as PNG, `atSeconds` in (ffmpeg seeks the input, so it reads
 * little of a long file), upright and at most {@link MAX_FRAME_EDGE} wide.
 */
export async function extractVideoFrame(url: string, mimeType: string, atSeconds: number) {
  const frame = await run(
    process.env.FFMPEG_PATH || "ffmpeg",
    [
      "-v", "error",
      "-nostdin",
      "-protocol_whitelist", PROTOCOLS,
      "-f", demuxerFor(mimeType),
      "-ss", Math.max(0, atSeconds).toFixed(3),
      "-i", url,
      "-map", "0:v:0",
      "-frames:v", "1",
      "-an", "-sn", "-dn",
      "-vf", `scale='min(${MAX_FRAME_EDGE},iw)':-2`,
      "-f", "image2pipe",
      "-c:v", "png",
      "pipe:1",
    ],
    MAX_FRAME_BYTES,
  );
  if (frame.length === 0) throw new VideoDecodeError("ffmpeg produced no frame.");
  return frame;
}

/** Where to take the poster: a second in, or 10% into a short clip. */
export function posterTimeSeconds(durationMs: number | null) {
  if (durationMs === null) return 0;
  return Math.min(1, (durationMs / 1000) * 0.1);
}
