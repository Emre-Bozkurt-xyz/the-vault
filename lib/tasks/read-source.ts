import { parseTasks, type ParsedTask } from "@/lib/tasks/parse";

/**
 * Task handles keyed by their line in the transformed render source. Match the
 * whole task sequence before allowing duplicates: transforms can remove lines
 * (asset groups) and change their text (inline asset cards), but task order must
 * remain intact. If that invariant fails, only unique exact matches are safe.
 */
export function mapReadTaskSources(
  markdown: string,
  renderSource: string,
  transformLine: (line: string) => string,
): Map<number, ParsedTask> {
  const original = parseTasks(markdown);
  const rendered = parseTasks(renderSource);
  const expected = original.map((task) => transformLine(task.rawLine));
  const handles = new Map<number, ParsedTask>();

  if (original.length === rendered.length && rendered.every((task, index) => task.rawLine === expected[index])) {
    rendered.forEach((task, index) => handles.set(task.line, original[index]));
    return handles;
  }

  const byLine = new Map<string, ParsedTask | null>();
  original.forEach((task, index) => {
    const line = expected[index];
    byLine.set(line, byLine.has(line) ? null : task);
  });
  const counts = new Map<string, number>();
  for (const task of rendered) counts.set(task.rawLine, (counts.get(task.rawLine) ?? 0) + 1);
  for (const task of rendered) {
    const source = byLine.get(task.rawLine);
    if (source && counts.get(task.rawLine) === 1) handles.set(task.line, source);
  }
  return handles;
}
