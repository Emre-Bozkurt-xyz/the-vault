import type { CSSProperties } from "react";

const allowedStyleProperties = new Set([
  "background",
  "background-color",
  "border",
  "border-color",
  "border-radius",
  "border-style",
  "border-width",
  "color",
  "color-scheme",
  "display",
  "font-size",
  "font-style",
  "font-weight",
  "height",
  "letter-spacing",
  "line-height",
  "margin",
  "margin-bottom",
  "margin-left",
  "margin-right",
  "margin-top",
  "max-height",
  "max-width",
  "min-height",
  "min-width",
  "opacity",
  "padding",
  "padding-bottom",
  "padding-left",
  "padding-right",
  "padding-top",
  "text-align",
  "text-decoration",
  "text-transform",
  "vertical-align",
  "white-space",
  "width",
]);

const blockedStyleValue = /(?:url\s*\(|expression\s*\(|@import|javascript:|vbscript:|data:|<|>)/i;

export function sanitizeInlineStyle(style: unknown) {
  if (typeof style !== "string") {
    return undefined;
  }

  const declarations = style
    .split(";")
    .map((declaration) => declaration.trim())
    .filter(Boolean)
    .map((declaration) => {
      const separatorIndex = declaration.indexOf(":");

      if (separatorIndex <= 0) {
        return null;
      }

      const property = declaration.slice(0, separatorIndex).trim().toLowerCase();
      const value = declaration.slice(separatorIndex + 1).trim();

      if (
        !allowedStyleProperties.has(property) ||
        !value ||
        blockedStyleValue.test(value)
      ) {
        return null;
      }

      return `${property}: ${value}`;
    })
    .filter((declaration): declaration is string => Boolean(declaration));

  return declarations.length > 0 ? declarations.join("; ") : undefined;
}

export function inlineStyleToReactStyle(style: unknown): CSSProperties | undefined {
  if (style && typeof style === "object" && !Array.isArray(style)) {
    return style as CSSProperties;
  }

  const sanitizedStyle = sanitizeInlineStyle(style);

  if (!sanitizedStyle) {
    return undefined;
  }

  const reactStyle: Record<string, string> = {};

  for (const declaration of sanitizedStyle.split(";")) {
    const separatorIndex = declaration.indexOf(":");

    if (separatorIndex <= 0) {
      continue;
    }

    const property = declaration.slice(0, separatorIndex).trim();
    const value = declaration.slice(separatorIndex + 1).trim();
    const camelProperty = property.replace(/-([a-z])/g, (_, letter: string) =>
      letter.toUpperCase(),
    );

    reactStyle[camelProperty] = value;
  }

  return reactStyle as CSSProperties;
}
