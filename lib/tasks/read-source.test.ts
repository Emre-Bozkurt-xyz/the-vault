import { describe, expect, it } from "vitest";
import { transformAssetEmbeds } from "@/lib/asset-embeds";
import { stripDocumentFrontmatter } from "@/lib/content-metadata";
import { mapReadTaskSources } from "@/lib/tasks/read-source";

describe("Read-mode task source mapping", () => {
  it("keeps identical lines distinct after frontmatter and render splits", () => {
    const markdown = "---\ntitle: tasks\n---\n- [ ] Repeat\n\n:::tasks{}\n\n![[Other]]\n\n- [ ] Repeat";
    const handles = mapReadTaskSources(markdown, stripDocumentFrontmatter(markdown), (line) => line);
    expect([...handles].map(([line, task]) => [line, task.line])).toEqual([[0, 3], [6, 9]]);
  });

  it("tracks tasks after asset groups collapse and inline assets change text", () => {
    const asset = "![[asset:11111111-1111-1111-1111-111111111111|Picture]]";
    const markdown = `:::assets\n${asset}\n:::\n\n- [ ] Repeat\n- [ ] Inspect ${asset}\n- [ ] Repeat`;
    const handles = mapReadTaskSources(markdown, transformAssetEmbeds(markdown), transformAssetEmbeds);
    expect([...handles.values()].map((task) => task.line)).toEqual([4, 5, 6]);
    expect([...handles.values()][1].rawLine).toContain(asset);
  });

  it("refuses ambiguous duplicates if a transform removed a task", () => {
    const handles = mapReadTaskSources("- [ ] Repeat\n- [ ] Repeat\n- [ ] Unique", "- [ ] Repeat\n- [ ] Unique", (line) => line);
    expect([...handles].map(([line, task]) => [line, task.line])).toEqual([[1, 2]]);
  });
});
