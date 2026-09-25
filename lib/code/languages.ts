export type CodeLanguage = {
  id: string;
  label: string;
  aliases: readonly string[];
  highlight: string;
  formatter?: "babel" | "typescript" | "json" | "html" | "css" | "yaml";
};

/** Presentation capabilities only. A language hint never selects executable code. */
export const codeLanguages: readonly CodeLanguage[] = [
  { id: "javascript", label: "JavaScript", aliases: ["js", "mjs", "node"], highlight: "javascript", formatter: "babel" },
  { id: "jsx", label: "JSX", aliases: [], highlight: "javascript", formatter: "babel" },
  { id: "typescript", label: "TypeScript", aliases: ["ts"], highlight: "typescript", formatter: "typescript" },
  { id: "tsx", label: "TSX", aliases: [], highlight: "typescript", formatter: "typescript" },
  { id: "python", label: "Python", aliases: ["py", "python3"], highlight: "python" },
  { id: "java", label: "Java", aliases: [], highlight: "java" },
  { id: "haskell", label: "Haskell", aliases: ["hs"], highlight: "haskell" },
  { id: "c", label: "C", aliases: [], highlight: "c" },
  { id: "cpp", label: "C++", aliases: ["c++", "cxx"], highlight: "cpp" },
  { id: "csharp", label: "C#", aliases: ["cs", "c#"], highlight: "csharp" },
  { id: "json", label: "JSON", aliases: [], highlight: "json", formatter: "json" },
  { id: "html", label: "HTML", aliases: ["htm"], highlight: "xml", formatter: "html" },
  { id: "css", label: "CSS", aliases: [], highlight: "css", formatter: "css" },
  { id: "yaml", label: "YAML", aliases: ["yml"], highlight: "yaml", formatter: "yaml" },
  { id: "sql", label: "SQL", aliases: [], highlight: "sql" },
  { id: "bash", label: "Shell", aliases: ["sh", "shell"], highlight: "bash" },
  { id: "markdown", label: "Markdown", aliases: ["md"], highlight: "markdown" },
];

const byName = new Map(codeLanguages.flatMap((language) =>
  [language.id, ...language.aliases].map((alias) => [alias, language] as const),
));

export function codeLanguageHint(info: string): string {
  return info.trim().split(/\s+/, 1)[0].toLowerCase();
}

export function resolveCodeLanguage(info: string): CodeLanguage | undefined {
  return byName.get(codeLanguageHint(info));
}

export function codeLanguageLabel(info: string): string {
  return resolveCodeLanguage(info)?.label || codeLanguageHint(info).slice(0, 40) || "Plain text";
}

export const MAX_CODE_FORMAT_LENGTH = 128 * 1024;
export const MAX_CODE_HIGHLIGHT_LENGTH = 32 * 1024;
