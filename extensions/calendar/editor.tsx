import { CalendarPlus } from "lucide-react";

import { defineEditor } from "@/lib/extension-api";

import { formatCalendarFence, generateCalendarId } from "./lib/calendar";
import manifest from "./manifest";

export default defineEditor(manifest, {
  commands: {
    // A fresh id per insertion: two calendars never share state.
    "vault.calendar.insert": (editor) =>
      editor.insertBlock(formatCalendarFence(generateCalendarId())),
  },
  toolbar: [
    { command: "vault.calendar.insert", label: "Insert calendar", icon: CalendarPlus },
  ],
});
