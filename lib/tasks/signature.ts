/**
 * Which lines the task index reads, as one comparable string: task lines, the
 * indented lines under them (notes, nested items) and headings, each with its
 * line number. Empty when there are no task lines. Cheap enough to run on
 * every pause in typing, so a parse only happens when a task really changed.
 *
 * `scripts/collab-server.mjs` keeps a plain-JS twin of this rule (it cannot
 * import TypeScript) to decide when a store announces a task change. Like it,
 * this is deliberately looser than `parseTasks` (it ignores fences): a false
 * positive costs one parse.
 */
const sourceLinePattern = /^[ \t>]*(?:(?:[-*+]|\d{1,9}[.)])[ \t]+\[[ xX/-]\](?=[ \t]|$)|#{1,6}[ \t])/;
const headingPattern = /^[ \t>]*#/;
const continuationPattern = /^[ \t>]*[ \t]\S/;

export function taskSourceSignature(markdown: string): string {
  const kept: string[] = [];
  let hasTask = false;
  let inTask = false;

  markdown.split("\n").forEach((line, index) => {
    if (sourceLinePattern.test(line)) {
      const isHeading = headingPattern.test(line);
      hasTask ||= !isHeading;
      inTask = !isHeading;
      kept.push(`${index}:${line}`);
    } else if (inTask && continuationPattern.test(line)) {
      kept.push(`${index}:${line}`);
    } else {
      inTask = false;
    }
  });

  return hasTask ? kept.join("\n") : "";
}
