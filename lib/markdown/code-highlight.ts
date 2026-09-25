import type { Element, Root, RootContent } from "hast";
import { createLowlight } from "lowlight";
import bash from "highlight.js/lib/languages/bash";
import c from "highlight.js/lib/languages/c";
import cpp from "highlight.js/lib/languages/cpp";
import csharp from "highlight.js/lib/languages/csharp";
import css from "highlight.js/lib/languages/css";
import haskell from "highlight.js/lib/languages/haskell";
import java from "highlight.js/lib/languages/java";
import javascript from "highlight.js/lib/languages/javascript";
import json from "highlight.js/lib/languages/json";
import markdown from "highlight.js/lib/languages/markdown";
import python from "highlight.js/lib/languages/python";
import sql from "highlight.js/lib/languages/sql";
import typescript from "highlight.js/lib/languages/typescript";
import xml from "highlight.js/lib/languages/xml";
import yaml from "highlight.js/lib/languages/yaml";
import { MAX_CODE_HIGHLIGHT_LENGTH, resolveCodeLanguage } from "@/lib/code/languages";

const highlighter = createLowlight({ bash, c, cpp, csharp, css, haskell, java, javascript, json, markdown, python, sql, typescript, xml, yaml });

export function codeInfoFromClassName(classes: unknown): string {
  const tokens = Array.isArray(classes) ? classes : typeof classes === "string" ? classes.split(/\s+/) : [];
  const token = tokens.find((value): value is string => typeof value === "string" && /^(language|lang)-/.test(value));
  return token?.replace(/^(language|lang)-/, "") ?? "";
}

export function codeNodeText(node: RootContent): string {
  if (node.type === "text") return node.value;
  if (node.type === "element") return node.children.map(codeNodeText).join("");
  return "";
}

/** Runs AFTER both sanitizers. Only trusted grammars generate these spans. */
export function rehypeCodeHighlight() {
  return (tree: Root) => {
    let remaining = 128 * 1024;
    function visit(node: Root | Element) {
      if (node.type === "element" && node.tagName === "pre") {
        for (const code of node.children) {
          if (code.type !== "element" || code.tagName !== "code" || code.children.some((child) => child.type !== "text")) continue;
          const language = resolveCodeLanguage(codeInfoFromClassName(code.properties.className));
          const source = codeNodeText(code);
          if (!language || source.length > MAX_CODE_HIGHLIGHT_LENGTH || source.length > remaining) continue;
          remaining -= source.length;
          try {
            code.children = highlighter.highlight(language.highlight, source).children.filter((child) => child.type === "text" || child.type === "element");
          } catch {
            // Incomplete/oversized/unknown code must never break document rendering.
          }
        }
        return;
      }
      for (const child of node.children) if (child.type === "element") visit(child);
    }
    visit(tree);
  };
}
