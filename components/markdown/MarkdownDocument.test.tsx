import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server.node";
import { describe, expect, it, vi } from "vitest";

// Isolate lazy extension hosts; the real Markdown, task and sanitizer pipeline
// stays in this test, without loading server action modules through a block.
vi.mock("@/components/extensions/ExtensionBlockHost", () => ({ ExtensionBlockHost: () => null }));
vi.mock("@/components/extensions/ExtensionDocumentHost", () => ({
  ExtensionDocumentProvider: ({ children }: { children: ReactNode }) => children,
  ExtensionInlineHost: () => null,
}));
vi.mock("@/components/extensions/ExtensionLinkHost", () => ({
  ExtensionLinkHost: ({ children }: { children: ReactNode }) => children,
}));

import { MarkdownDocument } from "./MarkdownDocument";

function boxes(markdown: string, editable = true) {
  const html = renderToStaticMarkup(<MarkdownDocument markdown={markdown} onTaskToggle={editable ? () => {} : undefined} />);
  return [...html.matchAll(/<input\b[^>]*>/g)].map((match) => match[0]);
}

describe("Read-mode checkboxes", () => {
  it("enables duplicate tasks across frontmatter, extension blocks and embeds", () => {
    const inputs = boxes("---\ntitle: tasks\n---\n- [ ] Repeat\n\n:::tasks{}\n\n![[Other]]\n\n- [ ] Repeat");
    expect(inputs).toHaveLength(2);
    expect(inputs.every((input) => !input.includes("disabled"))).toBe(true);
  });

  it("enables tight, loose and nested task lists", () => {
    const inputs = boxes("- [ ] Parent\n\n  A note.\n\n  - [ ] Child\n\n- [ ] Sibling");
    expect(inputs).toHaveLength(3);
    expect(inputs.every((input) => !input.includes("disabled"))).toBe(true);
  });

  it("keeps same-document region tasks editable", () => {
    const inputs = boxes('- [ ] Repeat\n\n<!-- vault-region id="work" title="Work" -->\n\n- [ ] Repeat\n\n<!-- /vault-region -->');
    expect(inputs).toHaveLength(2);
    expect(inputs.every((input) => !input.includes("disabled"))).toBe(true);
  });

  it("keeps tasks after an asset group visible and editable", () => {
    const asset = "![[asset:11111111-1111-1111-1111-111111111111|Picture]]";
    const inputs = boxes(`:::assets\r\n${asset}\r\n:::\r\n\r\n- [ ] Repeat\r\n- [ ] Inspect ${asset}\r\n- [ ] Repeat`);
    expect(inputs).toHaveLength(3);
    expect(inputs.every((input) => !input.includes("disabled"))).toBe(true);
  });

  it("keeps reader checkboxes disabled", () => {
    expect(boxes("- [ ] Task", false)[0]).toContain("disabled");
  });

  it("does not grant the outer document's edit callback to an embedded document", () => {
    const html = renderToStaticMarkup(<MarkdownDocument
      markdown={"- [ ] Root\n\n![[Other]]"}
      onTaskToggle={() => {}}
      wikiLinks={{ "title:other": { status: "resolved", documentId: "other", embedMarkdown: "- [ ] Embedded" } }}
    />);
    const inputs = [...html.matchAll(/<input\b[^>]*>/g)].map((match) => match[0]);
    expect(inputs).toHaveLength(2);
    expect(inputs[0]).not.toContain("disabled");
    expect(inputs[1]).toContain("disabled");
  });
});


it("renders priority badges in the real Read pipeline with Tasks disabled", () => {
  const html = renderToStaticMarkup(<MarkdownDocument markdown="- [ ] Ship :priority[high]\n- [ ] Later :priority[low]" />);
  expect(html).toContain('data-priority="high"');
  expect(html).toContain('data-priority="low"');
  expect(html).toContain("High priority");
  expect(html).not.toContain(":priority[");
});
