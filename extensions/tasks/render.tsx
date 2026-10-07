import { defineRender } from "@/lib/extension-api";

import manifest from "./manifest";

export default defineRender(manifest, {
  blocks: {
    tasks: { form: "leaf", live: "widget", load: () => import("./TaskQueryBlock") },
  },
});
