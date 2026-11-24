import { describe, expect, it } from "vitest";

import { transformAssetEmbeds, type AssetEmbedResolution, findEmbedLine } from "@/lib/asset-embeds";

const id = "0b6f2a5e-2f0c-4a8e-9a43-1d2f3c4b5a69";
const base: AssetEmbedResolution = {
  id,
  kind: "image",
  url: `/api/assets/${id}/content?doc=d1`,
  altText: "A photo",
  displayName: "DSC0001.JPG",
  mimeType: "image/jpeg",
  sizeBytes: 12_000_000,
};

describe("image embeds", () => {
  it("show the display copy when there is one", () => {
    const html = transformAssetEmbeds(`![[asset:${id}]]`, {
      [id]: { ...base, displayUrl: `${base.url}&r=display&v=2` },
    });
    expect(html).toContain(`src="/api/assets/${id}/content?doc=d1&amp;r=display&amp;v=2"`);
  });

  it("fall back to the original without one (not rendered, or rendering failed)", () => {
    for (const displayUrl of [undefined, null]) {
      const html = transformAssetEmbeds(`![[asset:${id}]]`, { [id]: { ...base, displayUrl } });
      expect(html).toContain(`src="/api/assets/${id}/content?doc=d1"`);
    }
  });

  it("keep layout attributes and captions on the display copy", () => {
    const html = transformAssetEmbeds(`![[asset:${id}]]{width=small caption="Arrival"}`, {
      [id]: { ...base, displayUrl: `${base.url}&r=display&v=2` },
    });
    expect(html).toContain("r=display");
    expect(html).toContain("Arrival");
  });

  it("never use a display copy for videos or files, which render as cards", () => {
    const html = transformAssetEmbeds(`![[asset:${id}]]`, {
      [id]: { ...base, kind: "video", mimeType: "video/mp4", displayUrl: `${base.url}&r=display&v=2` },
    });
    expect(html).not.toContain("<img");
    expect(html).toContain("Video");
  });
});

describe("findEmbedLine", () => {
  const id = "3f2a6c1e-0000-4000-8000-000000000001";
  it("finds the first line embedding the file, with its text", () => {
    const markdown = ["# Trip", "", "Some words.", `![[asset:${id}|Harbour]]{width=50%}`, `again ![[asset:${id}]]`].join("\n");
    expect(findEmbedLine(markdown, id)).toEqual({ line: 3, text: `![[asset:${id}|Harbour]]{width=50%}` });
  });

  it("matches regardless of case and returns null when absent", () => {
    expect(findEmbedLine(`![[asset:${id.toUpperCase()}]]`, id)).toEqual({ line: 0, text: `![[asset:${id.toUpperCase()}]]` });
    expect(findEmbedLine("no embeds here", id)).toBeNull();
  });
});
