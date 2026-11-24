import { describe, expect, it } from "vitest";

import {
  BUILT_IN_TEMPLATES,
  fillTemplate,
  findBuiltInTemplate,
  isTemplatesFolderName,
  localTemplateValues,
} from "@/lib/document-templates";

describe("document templates", () => {
  const values = localTemplateValues(new Date(2026, 10, 24, 9, 5), "Standup");

  it("fills placeholders in the creator's local time", () => {
    expect(values).toEqual({ title: "Standup", date: "2026-11-24", time: "09:05", weekday: "Tuesday" });
    expect(fillTemplate("# {{title}} — {{ weekday }} {{date}} {{time}} {{other}}", values)).toBe(
      "# Standup — Tuesday 2026-11-24 09:05 {{other}}",
    );
  });

  it("has unique ids and a blank first", () => {
    const ids = BUILT_IN_TEMPLATES.map((template) => template.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(BUILT_IN_TEMPLATES[0].id).toBe("blank");
    expect(findBuiltInTemplate("meeting")?.name).toBe("Meeting notes");
    expect(findBuiltInTemplate("nope")).toBeNull();
  });

  it("recognises a Templates folder", () => {
    expect(isTemplatesFolderName(" templates ")).toBe(true);
    expect(isTemplatesFolderName("Templates 2")).toBe(false);
  });
});
