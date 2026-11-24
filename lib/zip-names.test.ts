import { describe, expect, it } from "vitest";

import { zipEntryNames, zipFileName } from "@/lib/zip-names";

describe("zipEntryNames", () => {
  it("keeps folder paths and suffixes clashes within a folder, case-insensitively", () => {
    const names = zipEntryNames([
      { displayName: "IMG_1.JPG", path: "" },
      { displayName: "img_1.jpg", path: "" },
      { displayName: "IMG_1.JPG", path: "Day 1" },
      { displayName: "IMG_1.JPG", path: "" },
      { displayName: "README", path: "" },
      { displayName: "README", path: "" },
    ]).map((entry) => entry.name);
    expect(names).toEqual([
      "IMG_1.JPG",
      "img_1 (2).jpg",
      "Day 1/IMG_1.JPG",
      "IMG_1 (3).JPG",
      "README",
      "README (2)",
    ]);
  });

  it("can't be steered out of the zip or into reserved characters", () => {
    const [entry] = zipEntryNames([{ displayName: 'a/..\\b:"c"?.jpg', path: "../x/./y" }]);
    expect(entry.name).toBe("x/y/a_.._b__c__.jpg");
    expect(entry.name.startsWith("..")).toBe(false);
    expect(entry.name).not.toContain("\\");
    expect(zipEntryNames([{ displayName: "", path: "" }])[0].name).toBe("file");
  });

  it("names the zip after the folder", () => {
    expect(zipFileName("Lisbon: Day 1")).toBe("Lisbon_ Day 1.zip");
    expect(zipFileName("")).toBe("folder.zip");
  });
});
