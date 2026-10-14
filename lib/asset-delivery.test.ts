import { describe, expect, it } from "vitest";

import { assetDeliveryHeaders, fileExtensionFromName } from "./asset-delivery";

describe("assetDeliveryHeaders", () => {
  it("renders allow-listed media inline with its sniffed type", () => {
    const headers = assetDeliveryHeaders({
      kind: "image",
      mimeType: "image/png",
      displayName: "cat.png",
    });

    expect(headers["Content-Type"]).toBe("image/png");
    expect(headers["Content-Disposition"]).toBe('inline; filename="cat.png"');
    expect(headers["Content-Security-Policy"]).toBeUndefined();
  });

  it("never renders an arbitrary file inline, whatever its stored type", () => {
    const headers = assetDeliveryHeaders({
      kind: "file",
      mimeType: "text/html",
      displayName: "page.html",
    });

    expect(headers["Content-Type"]).toBe("application/octet-stream");
    expect(headers["Content-Disposition"]).toBe('attachment; filename="page.html"');
    expect(headers["Content-Security-Policy"]).toBe("sandbox");
    expect(headers["X-Content-Type-Options"]).toBe("nosniff");
  });

  it("strips header-breaking characters from the filename", () => {
    const headers = assetDeliveryHeaders({
      kind: "file",
      mimeType: "application/octet-stream",
      displayName: 'a"b\r\nc.txt',
    });

    expect(headers["Content-Disposition"]).toBe('attachment; filename="a_b__c.txt"');
  });
});

describe("fileExtensionFromName", () => {
  it.each([
    ["notes.MD", "md"],
    ["archive.tar.gz", "gz"],
    ["  data.csv  ", "csv"],
    ["README", null],
    ["weird.ex e", null],
    ["dotfile.", null],
    [`long.${"x".repeat(17)}`, null],
  ])("%s -> %s", (name, expected) => {
    expect(fileExtensionFromName(name)).toBe(expected);
  });
});
