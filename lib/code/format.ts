import { MAX_CODE_FORMAT_LENGTH, resolveCodeLanguage } from "./languages";

/** Called inside the browser worker; exported separately for integration tests. */
export async function formatCode(source: string, language: string): Promise<string> {
  const parser = resolveCodeLanguage(language)?.formatter;
  if (!parser) throw new Error("Formatting is not available for this language yet.");
  if (source.length > MAX_CODE_FORMAT_LENGTH) throw new Error("This code block is too large to format (128 KiB limit).");
  const prettier = await import("prettier/standalone");
  const plugins = await (async () => {
    switch (parser) {
      case "babel": return [await import("prettier/plugins/babel"), await import("prettier/plugins/estree")];
      case "typescript": return [await import("prettier/plugins/typescript"), await import("prettier/plugins/estree")];
      case "json": return [await import("prettier/plugins/babel"), await import("prettier/plugins/estree")];
      case "html": return [await import("prettier/plugins/html")];
      case "css": return [await import("prettier/plugins/postcss")];
      case "yaml": return [await import("prettier/plugins/yaml")];
    }
  })();
  return prettier.format(source, {
    parser, plugins, printWidth: 80, tabWidth: 2, useTabs: false,
    endOfLine: "lf", embeddedLanguageFormatting: "off",
  });
}
