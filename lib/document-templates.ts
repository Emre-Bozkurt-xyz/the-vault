/**
 * Templates for the New document dialog. Built-in ones live here; your own are
 * the documents in a folder named "Templates". Both may use placeholders,
 * filled in when the document is made: `{{title}}`, `{{date}}` (YYYY-MM-DD),
 * `{{time}}` (HH:MM) and `{{weekday}}`, in the creator's local time.
 */
export type BuiltInTemplate = {
  id: string;
  name: string;
  description: string;
  /** The title the dialog suggests (placeholders allowed). */
  defaultTitle: string;
  markdown: string;
  /** How the card's thumbnail is drawn. */
  preview: "blank" | "lines" | "checklist" | "columns";
};

export const BUILT_IN_TEMPLATES: readonly BuiltInTemplate[] = [
  {
    id: "blank",
    name: "Blank",
    description: "An empty page",
    defaultTitle: "Untitled document",
    markdown: "",
    preview: "blank",
  },
  {
    id: "board",
    name: "Board",
    description: "To do, Doing, Done. Opens as a board",
    defaultTitle: "Untitled board",
    markdown: ["---", "view: board", "---", "", "## To do", "", "## Doing", "", "## Done", ""].join("\n"),
    preview: "columns",
  },
  {
    id: "sprint",
    name: "Sprint board",
    description: "Ideas, Doing, Review, Done",
    defaultTitle: "Sprint {{date}}",
    markdown: [
      "---",
      "view: board",
      "tags: [sprint]",
      "---",
      "",
      "## Ideas",
      "",
      "## Doing",
      "",
      "## Review",
      "",
      "## Done",
      "",
    ].join("\n"),
    preview: "columns",
  },
  {
    id: "meeting",
    name: "Meeting notes",
    description: "Attendees, agenda, notes and action items",
    defaultTitle: "Meeting {{date}}",
    markdown: [
      "**Date:** {{weekday}} {{date}}, {{time}}",
      "**Attendees:** ",
      "",
      "## Agenda",
      "- ",
      "",
      "## Notes",
      "",
      "",
      "## Action items",
      "- [ ] ",
      "",
    ].join("\n"),
    preview: "lines",
  },
  {
    id: "journal",
    name: "Daily journal",
    description: "Today's date, how it went, what's next",
    defaultTitle: "{{weekday}} {{date}}",
    markdown: [
      "## How it's going",
      "",
      "",
      "## Today",
      "- [ ] ",
      "",
      "## Grateful for",
      "- ",
      "",
    ].join("\n"),
    preview: "lines",
  },
  {
    id: "brief",
    name: "Project brief",
    description: "Goal, scope, milestones, open questions",
    defaultTitle: "Untitled project",
    markdown: [
      "---",
      "status: draft",
      "---",
      "",
      "## Goal",
      "",
      "",
      "## Scope",
      "- **In:** ",
      "- **Out:** ",
      "",
      "## Milestones",
      "- [ ] ",
      "",
      "## Open questions",
      "- ",
      "",
    ].join("\n"),
    preview: "lines",
  },
  {
    id: "checklist",
    name: "Checklist",
    description: "A list of things to tick off",
    defaultTitle: "Checklist",
    markdown: ["- [ ] ", "- [ ] ", "- [ ] ", ""].join("\n"),
    preview: "checklist",
  },
  {
    id: "reading",
    name: "Reading notes",
    description: "Source, key ideas and quotes",
    defaultTitle: "Notes on ",
    markdown: [
      "**Source:** ",
      "",
      "## Key ideas",
      "- ",
      "",
      "## Quotes",
      "> ",
      "",
      "## My take",
      "",
    ].join("\n"),
    preview: "lines",
  },
];

export function findBuiltInTemplate(id: string): BuiltInTemplate | null {
  return BUILT_IN_TEMPLATES.find((template) => template.id === id) ?? null;
}

export type TemplateValues = { title: string; date: string; time: string; weekday: string };

/** The creator's local date, time and weekday, for {@link fillTemplate}. */
export function localTemplateValues(now: Date, title = ""): TemplateValues {
  const pad = (value: number) => String(value).padStart(2, "0");
  return {
    title,
    date: `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`,
    time: `${pad(now.getHours())}:${pad(now.getMinutes())}`,
    weekday: now.toLocaleDateString("en", { weekday: "long" }),
  };
}

/** Replaces `{{title}}`, `{{date}}`, `{{time}}` and `{{weekday}}`; other `{{…}}` stay as written. */
export function fillTemplate(text: string, values: TemplateValues): string {
  return text.replace(/\{\{\s*(title|date|time|weekday)\s*\}\}/gi, (_match, key: string) => {
    return values[key.toLowerCase() as keyof TemplateValues];
  });
}

/** Whether a folder holds templates: one named "Templates" (any case). */
export function isTemplatesFolderName(name: string): boolean {
  return name.trim().toLowerCase() === "templates";
}
