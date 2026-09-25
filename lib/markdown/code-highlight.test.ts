import { describe, expect, it } from "vitest";
import { unified } from "unified";
import remarkParse from "remark-parse";
import remarkRehype from "remark-rehype";
import rehypeRaw from "rehype-raw";
import rehypeSanitize from "rehype-sanitize";
import rehypeStringify from "rehype-stringify";
import { rehypeCodeHighlight } from "./code-highlight";
import { safeHtmlSchema, rehypeSanitizeContent } from "./sanitize";

const render = async (source: string) => String(await unified().use(remarkParse)
  .use(remarkRehype, { allowDangerousHtml: true }).use(rehypeRaw)
  .use(rehypeSanitize, safeHtmlSchema).use(rehypeSanitizeContent)
  .use(rehypeCodeHighlight).use(rehypeStringify).process(source));

describe("safe code rendering", () => {
  it.each([
    ["python", 'print("hello")'], ["js", "const x = 1;"],
    ["java", "public class Main {}"], ["haskell", 'main = putStrLn "hello"'],
    ["c", "int main() { return 0; }"], ["c++", "int main() { return 0; }"],
    ["c#", 'Console.WriteLine("hello");'],
  ])("highlights %s", async (language, source) => {
    expect(await render("```" + language + "\n" + source + "\n```")).toContain('class="hljs-');
  });
  it("keeps authored HTML code inert and strips spoofed token classes outside code", async () => {
    const out = await render('```html\n<script>alert(1)</script>\n```\n\n<span class="hljs-keyword fixed" onclick="alert(2)">outside</span>');
    expect(out).not.toContain("<script");
    expect(out).not.toContain("onclick");
    expect(out).not.toContain("fixed");
    expect(out).toContain("&#x3C;");
    expect(out).toContain("<span>outside</span>");
  });
  it("leaves inline, unknown and oversized code plain", async () => {
    expect(await render("`const x = 1`\n\n```unknown\nconst x = 1\n```")).not.toContain("hljs-");
    expect(await render("```js\n" + "x".repeat(33 * 1024) + "\n```")).not.toContain("hljs-");
  });
});
