import { formatCode } from "./format";

self.onmessage = async (event: MessageEvent<{ source: string; language: string }>) => {
  try {
    const formatted = await formatCode(event.data.source, event.data.language);
    self.postMessage({ formatted });
  } catch (error) {
    self.postMessage({ error: error instanceof Error ? error.message.slice(0, 1200) : "Could not format this code." });
  }
};
