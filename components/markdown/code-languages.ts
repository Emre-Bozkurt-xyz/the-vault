import { LanguageDescription, LanguageSupport, StreamLanguage } from "@codemirror/language";
import { codeLanguages, resolveCodeLanguage } from "@/lib/code/languages";

const descriptions = new Map(codeLanguages.map((language) => [language.id, LanguageDescription.of({
  name: language.label,
  alias: [language.id, ...language.aliases],
  async load() {
    switch (language.id) {
      case "javascript": case "jsx": case "typescript": case "tsx":
        return (await import("@codemirror/lang-javascript")).javascript({ jsx: language.id === "jsx" || language.id === "tsx", typescript: language.id === "typescript" || language.id === "tsx" });
      case "python": return (await import("@codemirror/lang-python")).python();
      case "java": return (await import("@codemirror/lang-java")).java();
      case "c": case "cpp": return (await import("@codemirror/lang-cpp")).cpp();
      case "csharp": return new LanguageSupport(StreamLanguage.define((await import("@codemirror/legacy-modes/mode/clike")).csharp));
      case "haskell": return new LanguageSupport(StreamLanguage.define((await import("@codemirror/legacy-modes/mode/haskell")).haskell));
      case "json": return (await import("@codemirror/lang-json")).json();
      case "html": return (await import("@codemirror/lang-html")).html();
      case "css": return (await import("@codemirror/lang-css")).css();
      case "yaml": return (await import("@codemirror/lang-yaml")).yaml();
      case "sql": return (await import("@codemirror/lang-sql")).sql();
      case "bash": return new LanguageSupport(StreamLanguage.define((await import("@codemirror/legacy-modes/mode/shell")).shell));
      default: return (await import("@codemirror/lang-markdown")).markdown();
    }
  },
})]));

export function fencedCodeLanguage(info: string) {
  return descriptions.get(resolveCodeLanguage(info)?.id ?? "") ?? null;
}
