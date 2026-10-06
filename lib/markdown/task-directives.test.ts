import rehypeRaw from "rehype-raw";
import rehypeSanitize from "rehype-sanitize";
import rehypeStringify from "rehype-stringify";
import remarkParse from "remark-parse";
import remarkRehype from "remark-rehype";
import { unified } from "unified";
import { describe, expect, it } from "vitest";

import { directiveRemarkPlugins, remarkInlineDirectives } from "@/lib/markdown/directives";
import { rehypeSanitizeContent, safeHtmlSchema } from "@/lib/markdown/sanitize";
import { formatTaskDateAbsolute, remarkTasks } from "@/lib/markdown/task-directives";

/**
 * Mirrors the plugin list in `MarkdownDocument.tsx` (tasks before extension directives), so the
 * task elements are proven to survive both sanitizer passes.
 */
function render(markdown: string): string {
  return unified()
    .use(remarkParse)
    .use(directiveRemarkPlugins)
    .use(remarkTasks)
    .use(remarkInlineDirectives, { names: new Set(["calc"]), keyPrefix: "0" })
    .use(remarkRehype, { allowDangerousHtml: true })
    .use(rehypeRaw)
    .use(rehypeSanitize, safeHtmlSchema)
    .use(rehypeSanitizeContent)
    .use(rehypeStringify, { allowDangerousHtml: true })
    .processSync(markdown)
    .toString();
}

describe("remarkTasks", () => {
  it("turns task dates into elements that survive sanitization", () => {
    const html = render("- [ ] Ship :due[2026-10-02 14:30] :done[2026-09-30]");

    expect(html).toContain('<vault-task-date data-kind="due" data-value="2026-10-02 14:30"></vault-task-date>');
    expect(html).toContain('<vault-task-date data-kind="done" data-value="2026-09-30"></vault-task-date>');
    expect(html).not.toContain(":due[");
  });

  it("leaves dates outside tasks, and invalid ones, as literal text", () => {
    expect(render("Meet :due[2026-10-02] soon")).toContain(":due[2026-10-02]");
    expect(render("- plain :due[2026-10-02]")).toContain(":due[2026-10-02]");
    expect(render("- [ ] bad :due[2026-02-30]")).toContain(":due[2026-02-30]");
    expect(render("- [ ] bad :done[2026-10-02 10:00]")).toContain(":done[2026-10-02 10:00]");
  });

  it("does not claim a date on a plain sub-bullet under a task", () => {
    const html = render("- [ ] parent\n  - plain :due[2026-10-02]");
    expect(html).toContain(":due[2026-10-02]");
  });

  it("renders [/] and [-] items as checkbox tasks with a status", () => {
    const html = render("- [/] started\n- [-] dropped\n- [ ] open");

    expect(html).toContain('data-task-status="in_progress"');
    expect(html).toContain('data-task-status="cancelled"');
    expect(html.match(/type="checkbox"/g)).toHaveLength(3);
    expect(html).not.toContain("[/]");
    expect(html).not.toContain("[-]");
  });

  it("still restores unrelated directives and renders calc", () => {
    const html = render("- [ ] cost :calc[2 + 2] :note[x]");
    expect(html).toContain("<vault-extension-inline");
    expect(html).toContain(":note[x]");
  });

  it("adds subtask progress over direct children, ignoring cancelled ones", () => {
    const html = render(
      ["- [ ] parent", "  - [x] one", "  - [ ] two", "  - [-] dropped", "    - [x] grandchild", "- [ ] lone"].join("\n"),
    );

    expect(html).toContain('<vault-task-progress data-done="1" data-total="2"></vault-task-progress>');
    expect(html.match(/vault-task-progress data/g)).toHaveLength(2); // parent, and "dropped" over its child
  });

  it("formats dates without reading the clock", () => {
    expect(formatTaskDateAbsolute("2026-10-02")).toBe("Fri 2 Oct 2026");
    expect(formatTaskDateAbsolute("2026-10-02 14:30")).toBe("Fri 2 Oct 2026, 14:30");
  });
});


it("renders valid task priorities through both sanitizers and leaves other occurrences literal", () => {
  expect(render("- [ ] Ship :priority[high]")).toContain('<vault-task-priority data-value="high"></vault-task-priority>');
  for (const source of ["- [ ] Ship :priority[urgent]", "prose :priority[high]", "- [ ] `:priority[low]`"]) {
    expect(render(source)).toContain(":priority[");
    expect(render(source)).not.toContain("<vault-task-priority");
  }
});
