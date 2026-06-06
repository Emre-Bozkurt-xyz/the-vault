export const maxMarkdownLength = 1_000_000;

export function createMarkdownExcerpt(markdown: string, maxLength = 180) {
  const plainText = markdown
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/`([^`]*)`/g, "$1")
    .replace(/<[^>]+>/g, " ")
    .replace(/^>\s?\[![^\]]+\].*$/gim, " ")
    .replace(/^>\s?/gim, "")
    .replace(/^#{1,6}\s+/gm, "")
    .replace(/!\[([^\]]*)\]\([^)]+\)/g, "$1")
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .replace(/[*_~>#-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  if (!plainText) {
    return "A public Vault note.";
  }

  if (plainText.length <= maxLength) {
    return plainText;
  }

  return `${plainText.slice(0, maxLength - 1).trimEnd()}...`;
}
