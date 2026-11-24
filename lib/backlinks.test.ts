import { describe, expect, it } from "vitest";

import { backlinkKeys, findBacklinkMentions } from "@/lib/backlinks";

const target = { id: "5e1c0a00-0000-4000-8000-00000000a0c1", title: "Trip Notes", aliases: ["Lisbon"] };
const keys = backlinkKeys(target);

describe("findBacklinkMentions", () => {
  it("finds links by title, alias and id, with their lines", () => {
    const markdown = [
      "# Plans",
      "See [[trip notes]] for the hotel.",
      "Also [[Lisbon|the city]] and [[doc:5E1C0A00-0000-4000-8000-00000000A0C1#Day 1]].",
      "Unrelated [[Other doc]].",
    ].join("\n");
    expect(findBacklinkMentions(markdown, keys)).toEqual([
      { line: 2, text: "See [[trip notes]] for the hotel.", embed: false },
      { line: 3, text: "Also [[Lisbon|the city]] and [[doc:5E1C0A00-0000-4000-8000-00000000A0C1#Day 1]].", embed: false },
    ]);
  });

  it("marks embeds, and ignores code", () => {
    const markdown = ["![[Trip Notes]]", "`[[Trip Notes]]` in code", "```", "[[Trip Notes]]", "```", "[[Trip Notes]] and ![[Trip Notes]]"].join("\n");
    expect(findBacklinkMentions(markdown, keys)).toEqual([
      { line: 1, text: "![[Trip Notes]]", embed: true },
      { line: 6, text: "[[Trip Notes]] and ![[Trip Notes]]", embed: false },
    ]);
  });

  it("finds nothing in a document that doesn't link", () => {
    expect(findBacklinkMentions("Trip Notes, mentioned but not linked.", keys)).toEqual([]);
  });
});
