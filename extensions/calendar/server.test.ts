import { describe, expect, it } from "vitest";
import server from "./server";

describe("Calendar agenda contribution", () => {
  it("includes only events in range from owned state supplied by the host", () => {
    const load = server.loadWorkspaceAgendaEvents!;
    const events = load({
      from: "2026-10-06", to: "2026-10-13",
      rows: [{
        documentId: "doc-1", documentTitle: "Plan", stateKey: "calendar:work",
        state: { entries: {
          meeting: { type: "event", day: "2026-10-08", time: "10:30", text: "Review", order: 0 },
          old: { type: "event", day: "2026-10-01", text: "Old", order: 1 },
          task: { type: "task", day: "2026-10-08", text: "Prepare", done: false, order: 2 },
        } },
      }],
    });
    expect(events).toEqual([{
      id: "doc-1:calendar:work:meeting", documentId: "doc-1", documentTitle: "Plan",
      day: "2026-10-08", time: "10:30", text: "Review",
    }]);
  });
});
