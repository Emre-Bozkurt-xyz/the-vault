import { defineRender } from "@/lib/extension-api";

import manifest from "./manifest";

export default defineRender(manifest, {
  blocks: {
    // `:::calendar{id=…}` anchors a month calendar whose entries live in
    // extension state (`calendar:<id>`), not in the Markdown. The same
    // component renders in Read mode, on public pages and as the Live widget.
    calendar: {
      form: "leaf",
      live: "widget",
      load: () => import("./CalendarBlock"),
    },
  },
});
